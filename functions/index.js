// NOT CURRENTLY DEPLOYED. Cloud Functions require the Firebase project to
// be on the Blaze (pay-as-you-go) plan, which this project intentionally
// isn't yet (see CLAUDE.md > Security Principles for the tradeoff this
// implies). This is the originally-designed, more secure invite flow —
// kept here so it can be deployed later with no rewrite if the project
// upgrades to Blaze (e.g. Phase 7 will need Blaze anyway for the Claude
// API key). The invite feature currently in use is implemented purely via
// Security Rules instead — see the projects/{id}/invites and
// projects/{id}/members subcollections in firestore.rules.
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

exports.createInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const projectId = request.data?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new HttpsError("invalid-argument", "projectId is required.");
  }

  const projectRef = db.doc(`projects/${projectId}`);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    throw new HttpsError("not-found", "Project not found.");
  }
  if (projectSnap.data().ownerId !== uid) {
    throw new HttpsError("permission-denied", "Only the project owner can create invites.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await db.collection("invites").add({
    projectId,
    token,
    createdBy: uid,
    expiresAt,
    redeemedBy: null,
    redeemedAt: null,
  });

  return { token, expiresAt: expiresAt.toISOString() };
});

exports.redeemInvite = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const token = request.data?.token;
  if (typeof token !== "string" || !token) {
    throw new HttpsError("invalid-argument", "token is required.");
  }

  const inviteQuery = await db.collection("invites").where("token", "==", token).limit(1).get();
  if (inviteQuery.empty) {
    throw new HttpsError("not-found", "This invite link is invalid.");
  }
  const inviteRef = inviteQuery.docs[0].ref;

  const projectId = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    const invite = inviteSnap.data();

    if (invite.redeemedBy) {
      throw new HttpsError("failed-precondition", "This invite has already been used.");
    }
    if (invite.expiresAt.toDate() < new Date()) {
      throw new HttpsError("failed-precondition", "This invite has expired.");
    }

    const projectRef = db.doc(`projects/${invite.projectId}`);
    const projectSnap = await tx.get(projectRef);
    if (!projectSnap.exists) {
      throw new HttpsError("not-found", "The invited project no longer exists.");
    }

    tx.update(projectRef, {
      collaboratorIds: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviteRef, {
      redeemedBy: uid,
      redeemedAt: FieldValue.serverTimestamp(),
    });

    return invite.projectId;
  });

  return { projectId };
});
