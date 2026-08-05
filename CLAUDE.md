# Maker Project Planner

A Reminders-style planner for DIY/maker projects, built as a plain HTML/CSS/JS
web app (also the public website) that will later be wrapped with Capacitor
for native iOS and Android apps. Backend is Firebase (Auth, Firestore, Cloud
Functions, Hosting, App Check).

This file is read automatically at the start of every Claude Code session in
this repo. It contains the Product Brief, Data Model, and Security Principles
that govern every phase of the build. Do not re-derive or contradict these —
update this file itself if a decision changes.

## Product Brief

What it is: A Reminders-style planner for DIY/maker projects. A user creates
Projects; each Project contains an ordered list of Steps (a checklist). Steps
can optionally note materials/tools needed. A Project can be shared with
collaborators via an invite — everyone with access can add and check off
steps, and sees changes live. A later phase adds an AI-generated time
estimate per step.

Platforms: one responsive web app codebase, which also serves as the public
website, wrapped with Capacitor to produce native iOS and Android apps.

UI language: English.

Backend: Firebase — Authentication, Firestore, Cloud Functions, Hosting, App
Check.

Explicitly NOT in MVP: payments, push notifications, offline mode, AI
estimation (that's the stretch phase at the end).

## Data Model

```
users/{uid}
  displayName: string
  email: string
  createdAt: timestamp

projects/{projectId}
  name: string
  category: "diy"
  ownerId: uid
  createdAt, updatedAt: timestamp

projects/{projectId}/steps/{stepId}
  title: string
  notes: string
  materials: array<string>
  tools: array<string>
  done: boolean
  order: number
  createdBy: uid
  createdAt, updatedAt: timestamp

projects/{projectId}/invites/{token}   // doc ID *is* the random token
  createdBy: uid
  expiresAt: timestamp
  redeemedBy: uid | null
  redeemedAt: timestamp | null

projects/{projectId}/members/{uid}     // doc ID = the collaborator's own uid
  uid: uid
  token: string             // the (now-spent) invite token used to join
  joinedAt: timestamp
```

Note: this deviates from the original plan, which had a single top-level
`invites/{inviteId}` collection with a `projectId` field, redeemed only via
a `redeemInvite` Cloud Function. See Security Principles below for why, and
`SECURITY.md` for exactly how access control is enforced instead.

## Security Principles (non-negotiable — apply from Phase 1 onward)

- The Firebase client config (apiKey etc.) is safe to ship in frontend code —
  it is not a secret. Access control is enforced server-side by Security
  Rules + Auth, not by hiding this key. Do not put it in a "secret" env file
  and don't treat it as sensitive.
- Firestore Security Rules default-deny everything. Every collection gets an
  explicit, narrow allow rule.
- **Deliberate exception, decided 2026-08-05:** invite creation/redemption
  is implemented via Security Rules only, with no Cloud Function, because
  Cloud Functions require the Firebase project to be on the Blaze
  (pay-as-you-go) plan, and the user chose to stay on the free Spark plan
  rather than add a billing method. The originally-planned design (a
  top-level `invites/{inviteId}` collection, redeemed only via a
  `redeemInvite` Cloud Function using the Admin SDK) would have been
  strictly more secure and is still written and ready to deploy in
  `functions/index.js` — it's just not currently active. The rules-only
  replacement (see Data Model above) uses the invite document's ID as the
  unguessable secret (`allow get` but never `allow list`, so invites can't
  be enumerated) and Firestore's per-document write serialization to make
  redemption single-use (`allow update` only if `redeemedBy` is still
  `null`). It is well-tested (`firestore-tests/`) but has one known,
  accepted gap: it isn't a single atomic operation the way a transactional
  Cloud Function would be, so if a client crashes between claiming the
  invite and being granted membership, that one invite is burned and the
  owner needs to issue a new one. If the project ever moves to Blaze
  (Phase 7 will require it anyway, for the Claude API key), prefer
  switching back to the Cloud Function version.
- Real secrets — the Firebase Admin service account, and later the
  Claude/LLM API key — live only in Cloud Functions config/secret manager.
  Never in client code, never committed to git.
- Enable Firebase App Check as soon as Auth exists (Phase 4).
- Once real domains/bundle IDs exist, restrict the web API key by HTTP
  referrer and mobile keys by bundle ID / package name in Google Cloud
  Console.
- Validate and sanitize all input server-side (Security Rules and/or Cloud
  Functions) — client-side validation is UX only, never the security
  boundary.

## Project structure

- `public/` — the Firebase Hosting root. All browser-facing code lives here
  (`index.html`, `css/`, `js/`). This is also the directory Capacitor will
  later wrap for the iOS/Android builds.
- `src/` — reserved for shared, non-browser source (e.g. code shared between
  tooling/scripts) added in later phases. Empty for now.
- `functions/` — Cloud Functions source (Admin SDK code, callable functions
  added from Phase 5 onward).
- `firestore.rules` / `firestore.indexes.json` — Firestore Security Rules and
  index definitions.
- `firebase.json` / `.firebaserc` — Firebase project configuration.
- `firestore-tests/` — automated test suite for `firestore.rules`, run
  against the Firestore emulator. See `SECURITY.md` for how to run it.
- `SECURITY.md` — plain-language access-control guarantees, how to run the
  rules test suite, and the API key restriction reminder.

## Local development

No build step is required (plain HTML/CSS/JS). To preview `public/` locally:

```
npx serve public
```

or open `public/index.html` directly in a browser. Once a real Firebase
project exists and `.firebaserc` points at it, you can also use:

```
npx firebase-tools emulators:start
```

## Deploying

Requires a real Firebase project. Fill in `public/js/firebaseConfig.js` and
`.firebaserc` with the real project's values, then:

```
npx firebase-tools login
npx firebase-tools deploy
```

## Git workflow

- After finishing a phase and confirming it works (manually, per that
  phase's "done when" checklist), commit with a clear message:
  `git add .` then `git commit -m "Phase N: <short description>"`.
- Push with `git push -u origin main` every time (not just the first
  push) — using `-u` repeatedly is harmless and prevents ever hitting a
  missing-upstream error again.
- Before every commit, check `git status` (and diff if unsure) and make
  sure nothing sensitive is staged — no `.env` files, no
  `serviceAccountKey.json` or other Admin SDK credentials, no API keys of
  any kind. (The Firebase client `apiKey` in `firebaseConfig.js` is the
  one exception — see Security Principles above, it's not a secret.)
- `.gitignore` must at minimum exclude: `node_modules/`, `.env`, `.env.*`,
  `*serviceAccountKey*.json`, `.DS_Store`, and any build output folders.
- Never commit a real secret "temporarily, to fix in the next commit" —
  if something sensitive is accidentally staged, stop and tell the user
  instead of committing it. Removing it in a later commit does not remove
  it from git history.
- If a commit or push fails, show the exact error instead of retrying
  blindly or suggesting a new repo.

## Build phases

The app is built in 8 phases (0 through 7): setup, auth, projects CRUD,
steps CRUD, security hardening pass with an emulator rules test suite,
collaboration via invites (Cloud Functions only), Capacitor wrap for
iOS/Android, and finally AI step-time estimation via a Cloud Function
calling the Claude API. Work through phases in order; each has explicit
manual "done when" acceptance checks (including cross-account access
checks) that must be verified by hand, not just by a successful build.
