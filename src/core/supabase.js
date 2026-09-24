// Supabase client + authentication.
//
// This file is deliberately thin. It knows how to create the client, send a
// magic link, and report who is signed in. It knows nothing about training
// data — that is sync.js.
//
// The app must work with no account and no signal. Every function here is
// safe to call when Supabase is not configured: it returns null or false
// rather than throwing, and the app carries on in local-only mode.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, STORAGE_PREFIX } from "../config.jsx";

let client = null;

/**
 * The shared client, or null if this build has no Supabase settings.
 * Null is a normal state, not an error — it means "local-only mode".
 */
export function getClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,      // survive closing the app
      autoRefreshToken: true,    // hourly token renewal, invisible to the user
      detectSessionInUrl: true,  // pick up the magic link when it lands

      // IMPORTANT. All three apps live on username.github.io, and localStorage
      // is scoped per ORIGIN, not per path — the same reason STORAGE_PREFIX
      // exists. Without a per-app key here, signing into one app would sign
      // the same browser into all three, as whoever logged in last.
      storageKey: `${STORAGE_PREFIX}auth`,
    },
  });
  return client;
}

/** Is this build wired to Supabase at all? */
export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Where the magic link should return to. Uses the page the user is actually
 * on, so it works for all three apps and on a phone's installed PWA without
 * anything hard-coded.
 */
function redirectTarget() {
  if (typeof window === "undefined") return undefined;
  return window.location.origin + window.location.pathname;
}

/**
 * Send a sign-in link. Resolves to { ok, error } — never throws, because a
 * typo or a dead network must not take the app down.
 */
export async function sendMagicLink(email) {
  const c = getClient();
  if (!c) return { ok: false, error: "This app is not connected to an account service." };

  const address = (email || "").trim();
  if (!address || !address.includes("@")) {
    return { ok: false, error: "That does not look like an email address." };
  }

  try {
    const { error } = await c.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: redirectTarget(),
        // No silent account creation. An unknown address gets an error rather
        // than a new empty account, so a typo cannot strand someone in a
        // blank app wondering where their history went.
        shouldCreateUser: false,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }
}

/**
 * Sign in with the 6-digit code from the same email as the link.
 * iOS opens a link from Mail in Safari, and an installed home-screen app has
 * its own separate storage, so a link can never sign in the installed app.
 * The code can, because it is typed inside the app itself.
 */
export async function verifyCode(email, code) {
  const c = getClient();
  if (!c) return { ok: false, error: "This app is not connected to an account service." };

  const address = (email || "").trim();
  const token = String(code || "").replace(/\D/g, "");
  if (!address || !address.includes("@")) {
    return { ok: false, error: "Enter the email address the code was sent to." };
  }
  if (token.length !== 6) return { ok: false, error: "The code is six digits." };

  try {
    const { error } = await c.auth.verifyOtp({ email: address, token, type: "email" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }
}

/** The signed-in user, or null. Never throws. */
export async function currentUser() {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return data?.session?.user || null;
  } catch (e) {
    return null;
  }
}

/**
 * Watch for sign-in and sign-out. Returns an unsubscribe function.
 * Fires on: signing in, signing out, and each silent token refresh.
 */
export function onAuthChange(handler) {
  const c = getClient();
  if (!c) return () => {};
  try {
    const { data } = c.auth.onAuthStateChange((_event, session) => {
      handler(session?.user || null);
    });
    return () => data?.subscription?.unsubscribe?.();
  } catch (e) {
    return () => {};
  }
}

/** Sign out on this device only. Local training data is NOT touched. */
export async function signOut() {
  const c = getClient();
  if (!c) return;
  try {
    await c.auth.signOut({ scope: "local" });
  } catch (e) {
    /* already gone, or offline — nothing to do */
  }
}

/* ------------------------------ Coach sharing ----------------------------- */
//
// Whether this person's coach can currently read their training data. The
// switch belongs to the client and nobody else: set_coach_sharing() is
// SECURITY DEFINER and updates only rows where client_id = auth.uid(), so a
// coach cannot turn a client's sharing back on.
//
// Note the asymmetry worth knowing about here: a coach has coach_links rows
// where they are the *coach*, and a client has a row where they are the
// *client*. Both are visible under the same policy, so the query below must
// filter on client_id explicitly — selecting the table unfiltered would hand
// a coach their clients' rows and make it look like they were being coached.

/**
 * This account's sharing state.
 * Resolves to { linked, enabled } — linked false means nobody is coaching
 * them, which is different from being linked with sharing switched off.
 * Never throws.
 */
export async function getCoachSharing() {
  const c = getClient();
  if (!c) return { linked: false, enabled: null };
  try {
    const u = await currentUser();
    if (!u) return { linked: false, enabled: null };
    const { data, error } = await c
      .from("coach_links")
      .select("sharing_enabled")
      .eq("client_id", u.id);
    if (error || !data || data.length === 0) return { linked: false, enabled: null };
    // More than one coach is not a current scenario, but if it ever happens,
    // "sharing" means sharing with all of them.
    return { linked: true, enabled: data.every((row) => row.sharing_enabled !== false) };
  } catch (e) {
    return { linked: false, enabled: null };
  }
}

/** Turn coach sharing on or off. Resolves to { ok, error }. Never throws. */
export async function setCoachSharing(enabled) {
  const c = getClient();
  if (!c) return { ok: false, error: "Not connected to an account." };
  try {
    const { error } = await c.rpc("set_coach_sharing", { enabled: Boolean(enabled) });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Could not reach the server." };
  }
}
