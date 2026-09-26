/**
 * programs.js — deliver the training programme from the database.
 *
 * Before this, each app compiled its programme from src/core/program-<client>.js,
 * so a new block meant editing a file, redeploying, and separately inserting a
 * `programs` row — three things kept in step by hand. This module makes the
 * stored row the source and leaves the compiled file as the offline fallback.
 *
 * Two rules shape everything here:
 *
 * 1. localStorage stays the source of truth. The active programme is resolved
 *    SYNCHRONOUSLY from cache when the module loads, so the app renders the
 *    right session with no network and while signed out. The network refresh
 *    only updates the cache.
 *
 * 2. A programme never changes under a client mid-session. Someone standing in
 *    the gym looking at today's session must not have it swapped as they read
 *    it. A refresh that finds something new caches it and reports `changed`;
 *    the new programme applies on the next open, with a notice.
 */

import { validate, resolveForDate } from "./program-schema.js";

// supabase.js is imported LAZILY inside refreshPrograms rather than here. It
// pulls in config.jsx, which node cannot parse, so a top-level import would make
// this whole module untestable by a verification script. Everything above the
// refresh is pure and runs under plain node.

/** Cache key, suffixed onto the app's STORAGE_PREFIX. */
export const CACHE_KEY = "programsV2";

/* --------------------------------- cache ---------------------------------- */
// Every read and write is wrapped: localStorage throws in private mode and in
// some embedded webviews, and a programme that cannot be cached must still run.

function storage() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    return localStorage;
  } catch { return null; }
}

/** @returns {{rows: Array, fetchedAt: string|null, userId: string|null}} — never throws. */
export function readCache(prefix) {
  const empty = { rows: [], fetchedAt: null, userId: null };
  const s = storage();
  if (!s) return empty;
  try {
    const raw = s.getItem(prefix + CACHE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return empty;
    return { rows: parsed.rows, fetchedAt: parsed.fetchedAt || null, userId: parsed.userId || null };
  } catch { return empty; }
}

/**
 * The cache records WHOSE rows it holds. Startup cannot check that — the signed-in
 * user is only known asynchronously — but the next refresh can, and discards a
 * cache belonging to someone else. Without the stamp, a second account signing
 * into the same app would keep seeing the first client's programme, because
 * their own fetch returns no rows and so never overwrites it.
 */
export function writeCache(prefix, rows, userId) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(prefix + CACHE_KEY, JSON.stringify({
      rows, fetchedAt: new Date().toISOString(), userId: userId || null,
    }));
    return true;
  } catch { return false; }
}

/** Used on sign-out: one client's programme must not linger for the next. */
export function clearCache(prefix) {
  const s = storage();
  if (!s) return;
  try { s.removeItem(prefix + CACHE_KEY); } catch { /* nothing to do */ }
}

/* -------------------------------- selection -------------------------------- */

/**
 * Keep only rows this app is allowed to run, then resolve the one in force.
 *
 * The guards are not belt-and-braces; each one blocks something real:
 *
 *  - assigned_to: the coach is `owner_id` on EVERY row, and the SELECT policy is
 *    `owner_id = auth.uid() OR assigned_to = auth.uid()`. So in the coach's own
 *    client app an unfiltered query returns every client's programme. Proved on
 *    26 Sep 2026: resolving over that unfiltered set on 2026-09-28 returned
 *    `ville-2026-09` for John. The query filters too; this re-checks the answer.
 *
 *  - clientName: a second, independent guard on the same mistake. A definition
 *    built for another client cannot run here even if the query were wrong.
 *
 *  - validate(): a definition that fails the contract is dropped rather than
 *    rendered, because a missing slotMeta entry or a schedule naming a block
 *    that does not exist produces a broken day, not an obvious error.
 */
export function selectRows({ rows, userId, clientName }) {
  const kept = [];
  const rejected = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") { rejected.push({ id: null, why: "not an object" }); continue; }
    const id = row.id || "(no id)";
    if (userId && row.assigned_to && row.assigned_to !== userId) {
      rejected.push({ id, why: `assigned to another user (${row.assigned_to})` });
      continue;
    }
    const def = row.definition;
    if (!def || typeof def !== "object") { rejected.push({ id, why: "no definition" }); continue; }
    if (clientName && def.clientName && def.clientName !== clientName) {
      rejected.push({ id, why: `definition is for ${def.clientName}, this app is ${clientName}` });
      continue;
    }
    const v = validate(def);
    if (!v.ok) { rejected.push({ id, why: `invalid: ${v.errors.join("; ")}` }); continue; }
    kept.push(row);
  }
  return { kept, rejected };
}

/**
 * Decide which programme to run.
 * @returns {{program, source: "delivered"|"compiled", rowId: string|null, rejected: Array}}
 */
export function pickActive({ compiled, rows, date, userId, clientName }) {
  const { kept, rejected } = selectRows({ rows, userId, clientName });
  const row = resolveForDate(kept, date || new Date());
  if (row && row.definition) {
    return { program: row.definition, source: "delivered", rowId: row.id || null, rejected };
  }
  return { program: compiled, source: "compiled", rowId: null, rejected };
}

/**
 * Resolve at module load, from cache only. Synchronous by design: the app must
 * render the correct session offline, signed out, and before any fetch returns.
 */
export function activeProgramAtStartup(compiled, prefix, opts) {
  const o = opts || {};
  const { rows } = readCache(prefix);
  if (!rows.length) {
    return { program: compiled, source: "compiled", rowId: null, rejected: [], fromCache: false };
  }
  const picked = pickActive({
    compiled, rows, date: o.date, userId: o.userId, clientName: o.clientName,
  });
  return { ...picked, fromCache: true };
}

/** Every cached row, for scoring a past day against the version in force then. */
export function cachedRows(prefix) {
  return readCache(prefix).rows;
}

/* --------------------------------- refresh --------------------------------- */

/**
 * Fetch this user's programmes and cache them.
 *
 * Returns `changed: true` when the programme now in force differs from the one
 * the app is running, which is the signal for the "programme updated" notice.
 * It deliberately does NOT swap the running programme — see rule 2 at the top.
 *
 * Any failure is non-fatal: the cache and the running programme are left alone.
 */
export async function refreshPrograms({ prefix, compiled, userId, clientName, activeRowId, date, client }) {
  if (!userId) return { ok: false, changed: false, reason: "signed out" };

  // A cache stamped for a different account is not ours to keep or to fall back on.
  const cached = readCache(prefix);
  if (cached.userId && cached.userId !== userId) clearCache(prefix);

  let rows;
  try {
    // `client` is injectable so tests can drive this without a network or a
    // bundler; in the app it resolves to the shared Supabase client.
    const c = client || (await import("./supabase.js")).getClient();
    // Filtered explicitly. RLS would also permit the coach's own rows here,
    // which is exactly the bug this avoids — see selectRows above.
    const { data, error } = await c
      .from("programs")
      .select("id,assigned_to,effective_from,definition")
      .eq("assigned_to", userId);
    if (error) return { ok: false, changed: false, reason: error.message };
    rows = Array.isArray(data) ? data : [];
  } catch (err) {
    return { ok: false, changed: false, reason: (err && err.message) || "fetch failed" };
  }

  if (!rows.length) {
    // No programme published for this client yet. Keep the compiled fallback and
    // do NOT cache an empty list over a good one.
    return { ok: true, changed: false, reason: "no rows assigned", rows: [] };
  }

  const picked = pickActive({ compiled, rows, date, userId, clientName });
  if (picked.source === "delivered") writeCache(prefix, rows, userId);

  return {
    ok: true,
    changed: picked.source === "delivered" && picked.rowId !== activeRowId,
    source: picked.source,
    rowId: picked.rowId,
    rejected: picked.rejected,
    rows,
  };
}
