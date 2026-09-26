# PT app platform — working rules

**This file is committed to each of the four client repo roots.** A cloud session
clones the repo and has no access to local configuration, so the rules have to
travel with the code. A local session picks it up from the repo root too.

## What this is

A PWA personal-training app platform: one owner/coach (John, "juha") and three
clients. **Four GitHub repos** under the `yellowg-dev` org, each deployed by
GitHub Pages from `main`:

| Repo | Client | localStorage prefix |
|---|---|---|
| `Juha-PTapp` | Juha (owner + coach) | `ptAppParent_` |
| `Henna-PTapp` | Henna | `ptAppHenna_` |
| `Joonatan-PTapp` | Joonatan | `ptAppJoonatan_` |
| `Ville-PTapp` | Ville | `ptAppVille_` |

A fifth repo, `Coach-PTapp`, is the read-only coach dashboard at
`coach.yellowg.fi`. It is NOT part of the four-repo rules below.

Backend is Supabase (project `qpkdqyazdzhoohowkouy`). localStorage is the source
of truth; Supabase is a replica. The app must work fully offline and signed out.

## Hard rules — breaking any of these loses client data or breaks a live app

1. **`STORAGE_PREFIX` must never change.** All four apps share one browser-storage
   namespace on `yellowg-dev.github.io`, so the prefix is the only thing keeping
   one client's log out of another's. Changing it orphans every logged day.
2. **`src/app.jsx` is byte-identical across all four client repos.** Everything
   client-specific lives in `src/config.jsx` and `src/core/program-<client>.js`.
   After editing `app.jsx`, copy the SAME file to all four and verify the hashes
   match.
3. **Only one task may edit `app.jsx` at a time.** If asked to edit it, say so
   before starting.
4. **Exercise IDs are permanent and movement-specific.** Never reuse an ID for a
   different movement; historical logs resolve through them.
5. **Never hand-edit `bundle.js` or `styles.css`.** They are build outputs. Run
   the build.
6. **Imported wearable data pre-fills, never overwrites** a client's own log.
7. Programs are versioned by effective date, **forward-only**. A change never
   applies retroactively.

## Conventions

- Exercise naming: **"dumbbell"**, never "DB" — the pattern library matches on it.
- Superset pairings go in the `presc` field, never in the exercise `name`.
- Old blocks stay in `blocks` but are hidden from `slotOptions`, so historical
  days still resolve. A block with no picker option is intentional.
- Slot colours and labels come from `PROGRAM.slotMeta`, never from a hardcoded
  hex. Colour tokens in `programView` are `accent`, `accent2`, `cat:<name>`.
- Read slot metadata and blocks ONLY through the accessors in
  `src/core/program-schema.js` (`slotMetaFor`, `slotOptionsFor`, `blocksFor`,
  `mobilityFor`). Never `PROGRAM.slotMeta[slot]` directly — a delivered
  programme can introduce a slot this bundle never compiled.

## Build and verify

From a repo root. In a fresh clone (which is every cloud session) install first:

```
npm install                          # node_modules is not committed
node verify-program-delivery.mjs     # MUST print "51 passed, 0 failed"
npm run build                        # esbuild + tailwind, both, already wired
```

- **Never build if the verify script does not pass.** It is the gate.
- `npm run build` writes `bundle.js` and `styles.css`. Commit both.
- On John's laptop, Node and npm are a portable install with no admin rights.
  Do not try to install system-wide software there. A cloud VM has its own Node
  and can reach the npm registry normally.
- `styles.css` depends on `bundle.js`, because Tailwind scans the committed
  bundle. An unexplained `styles.css` diff is usually benign.

## Git

- **Work on a branch for anything touching `app.jsx`.** GitHub Pages deploys from
  `main`, so a push to `main` goes straight to four live client apps. Four real
  people use these daily, and one of them started this week.
- A cloud session pushes its own branch by design — never retarget it at `main`.
- Deploy order when merging: **Henna, Joonatan, Ville, Juha.** Least-critical
  first, the owner last.
- Do not push to `main` without being asked to.
- Bump `APP_VERSION` in each `src/core/program-<client>.js` on a functional
  change — all four carry the same version string.

## Verifying a deploy

`raw.githubusercontent.com` can serve a stale, partially-updated view for a
minute or so after a push, including a mix of fresh and stale paths in the same
sweep. If a repo looks behind, **wait and re-check before concluding anything or
editing files** — a false negative here causes real damage.

```
for r in Juha Henna Joonatan Ville; do
  curl -s "https://raw.githubusercontent.com/yellowg-dev/$r-PTapp/main/src/app.jsx?cb=$RANDOM" | sha256sum
done
```

All four must print the same hash.

## Who to ask

John is the owner. He is new to coding and has never used Python — propose and
explain any new tool before using it. He wants the reasoning behind a choice, not
just the instruction, kept short. He has caught real architectural mistakes
before; if he pushes back, take it seriously rather than defending.
