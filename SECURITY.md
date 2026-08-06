# Security

This document explains, in plain language, the access-control guarantees
this app relies on, how they're tested, and what to tighten once real
domains/bundle IDs exist. See `CLAUDE.md` for the full Security Principles
this project follows.

## Access-control guarantees

- **`users/{userId}`** — a signed-in user can only read or write their own
  profile document, including deleting it (used by the "delete profile"
  flow in the Profile tab). No one can read, write, or delete anyone else's
  profile.
- **`usernames/{username}`** — the doc ID *is* the unique, lowercase
  username, same "ID as the access-control mechanism" pattern as invites
  below. Anyone (even signed out) can `read` one exact, already-guessed
  username to check availability — that's the one deliberate exception to
  "everything requires auth" in this app, and it only reveals whether a
  single specific handle is taken, not the full list. Only a signed-in
  user can `create` a reservation, and only for their own uid. Firestore's
  create-vs-update routing means a `create` on an already-taken username
  has no matching rule and is denied — no read-then-write race is possible
  the way there would be with a manual "check if exists" step. `update` is
  never allowed; `delete` is owner-only (frees the handle when changing or
  deleting an account).
- **`users/{uid}/friends/{friendUid}`** — a mutual friendship edge, written
  to both users' subcollections. Either of the two named people (the
  subcollection owner or the friend referenced in the doc) can create or
  delete it on either side — that's what lets a single client write both
  sides at once for an instant QR-add or a request-accept. Blocked in
  either direction blocks creation. Only the subcollection owner can read
  their own list.
- **`users/{uid}/friendRequests/{requesterUid}`** — a pending request in
  the recipient's inbox. Only the requester can create it (never on
  someone else's behalf), and only if neither side has blocked the other
  and they're not already friends. Recipient and requester can each read
  it and delete it (decline / withdraw); no one else can.
- **`users/{uid}/blocked/{blockedUid}`** — self-only: only the list owner
  can create, read, or delete entries in their own blocked list.
- **`reports/{reportId}`** — create-only, and only as yourself
  (`reporterUid` must match the caller). No read access for anyone,
  including the reporter — intentionally minimal for now, see `CLAUDE.md`.
- **`projects/{projectId}`** — a signed-in user can only create a project
  they own (`ownerId` must be their own uid). Read and update are allowed
  for the owner **and** anyone with a `members/{uid}` document under that
  project (see below) — delete is owner-only, always.
- **`projects/{projectId}/steps/{stepId}`** — the same owner-or-member
  check as the parent project applies to its steps: owner and members can
  read/add/check off steps, but only the owner can delete a step.
- **`projects/{projectId}/invites/{token}`** — this is how sharing works
  without a Cloud Function (see "Invite mechanism" below for the full
  explanation). Only the project owner can create one. No one — not even
  the owner — can ever directly *read* an invite (`allow read: if false`),
  which is what stops anyone from browsing/enumerating them. The only
  write operations allowed are a narrow *update* that flips it from
  unredeemed-and-unexpired to redeemed-by-the-caller — once — and *delete*,
  owner-only, for cleaning up spent/expired invites.
- **`projects/{projectId}/members/{uid}`** — this is what actually grants
  collaborator access, via one of two mutually-exclusive creation shapes.
  Either a user creates the document with their *own* uid as the ID, only
  by proving server-side that they already hold a matching redeemed invite
  for this exact project — or the project **owner** creates it directly
  for anyone already in their own `users/{ownerUid}/friends` subcollection,
  no invite needed. The two shapes stay distinguishable in the data itself
  (`token` vs `addedVia: "friend"`).
- Everything not explicitly listed above is denied by default — the rules
  file (`firestore.rules`) starts from deny-all and only opens the narrow
  cases above.

## Invite mechanism (no Cloud Function)

The original plan for Phase 5 was a top-level `invites/{inviteId}`
collection redeemed only through a `redeemInvite` Cloud Function using the
Admin SDK — the safest possible design, since a trusted server can
atomically validate-and-consume a token in one step. That code still
exists in `functions/index.js` but isn't deployed, because Cloud Functions
require the Blaze (pay-as-you-go) plan, and this project deliberately
stays on the free Spark plan (see `CLAUDE.md` > Security Principles for the
full reasoning).

Instead, sharing is implemented with Security Rules alone:

1. The invite document's ID **is** the random token — e.g.
   `projects/{projectId}/invites/6f3a...`. Rules allow `get` (fetch by
   exact known ID) but never `list`, so an invite can only ever be reached
   by someone who already has the exact link — there's no way to browse or
   guess your way to one.
2. **Redeeming** is a single-document update: flip `redeemedBy` from
   `null` to your own uid. Firestore serializes concurrent writes to the
   same document, so if two people race to redeem the same link, only the
   first one can win — that's what makes it single-use.
3. Only after that update succeeds can the redeemer create
   `projects/{projectId}/members/{their-own-uid}` — the rule for that
   creation independently re-checks, server-side, that a matching invite
   really was redeemed by that exact uid.

**Known limitation**: steps 2 and 3 are two separate writes, not one atomic
transaction (a transaction can't see its own pending writes when it calls
`get()` inside a rule, so this couldn't be collapsed into one step without
a trusted server). If a client crashes between them, that invite is spent
but membership wasn't granted — the owner would need to issue a fresh
invite. This is a UX rough edge, not a security hole: it cannot be used to
gain unauthorized access, only to "waste" a single invite link.

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
project are made. All 64 tests currently pass, including the invite/member
rules described above (single-use redemption, expiry, cross-user token
misuse, self-only membership creation, the friend-direct-add shape), the
username uniqueness rules (create-once-wins, public read, owner-only
delete), and the friends/friendRequests/blocked/reports rules (two-party
create, block prevents new edges/requests, self-only inboxes, report is
write-only for everyone including the reporter).

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
