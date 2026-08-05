# Security

This document explains, in plain language, the access-control guarantees
this app relies on, how they're tested, and what to tighten once real
domains/bundle IDs exist. See `CLAUDE.md` for the full Security Principles
this project follows.

## Access-control guarantees

- **`users/{userId}`** — a signed-in user can only read or write their own
  profile document. No one can read or write anyone else's profile.
- **`projects/{projectId}`** — a signed-in user can only create a project
  they own (`ownerId` must be their own uid), and can only read, update, or
  delete a project they own. (Phase 5 will extend *read*, and later some
  writes, to collaborators added via invite — ownership stays required for
  delete.)
- **`projects/{projectId}/steps/{stepId}`** — the same ownership check as
  the parent project applies to its steps: only the project's owner can
  read, add, update, or delete steps in it.
- Everything not explicitly listed above is denied by default — the rules
  file (`firestore.rules`) starts from deny-all and only opens the narrow
  cases above.
- **`invites/{inviteId}`** (added in Phase 5) will be closed to all direct
  client access — reachable only through Cloud Functions using the Admin
  SDK, which bypasses these rules safely.

## Automated rules test suite

`firestore-tests/` contains an automated test suite (Node's built-in test
runner + `@firebase/rules-unit-testing`) that exercises `firestore.rules`
against the Firestore emulator — no real project, no real user data. For
every collection above it checks all three guarantees:

1. The **owner** can read/write their own data.
2. **Another signed-in user** cannot read or write someone else's data.
3. An **unauthenticated** request is denied everywhere.

### Running the tests

Requires a JDK (the Firestore emulator runs on the JVM) and Node.js.

```
cd firestore-tests
npm install        # first time only
cd ..
firebase emulators:exec --only firestore --project demo-maker-project-planner "npm --prefix firestore-tests test"
```

This starts a local Firestore emulator, runs the test suite against it, and
shuts the emulator down afterward. No network calls to the real Firebase
project are made. All 13 tests currently pass.

## App Check

Firebase App Check (reCAPTCHA v3 provider) is wired into `firebase-init.js`
so the client attaches an App Check token to its requests. **Enforcement is
not yet turned on** for Firestore in the Firebase Console — this is
intentional: enforcement should only be flipped on after confirming (via
the App Check metrics page) that the app is successfully sending valid
tokens, to avoid locking out real users due to a misconfiguration. Turn on
enforcement once that's confirmed.

## API key restriction (do this once real domains/bundle IDs exist)

The Firebase client config (`apiKey` etc. in `public/js/firebaseConfig.js`)
and the App Check reCAPTCHA site key are not secrets — see
`CLAUDE.md` > Security Principles. Access control is enforced by Security
Rules and Cloud Functions, not by hiding these values. Still, once the app
has its real production domain and mobile bundle IDs, restrict the API
keys in Google Cloud Console (APIs & Services > Credentials) as
defense-in-depth:

- **Web API key**: restrict by HTTP referrer to the production domain(s).
- **iOS key**: restrict by bundle ID.
- **Android key**: restrict by package name (and SHA-1 fingerprint).

This is not required for the app to function securely today (Security
Rules already enforce access control), but it reduces the chance of the
key being used to make unrelated Firebase API calls from outside the app.
