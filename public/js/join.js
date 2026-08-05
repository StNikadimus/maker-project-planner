import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("projectId");
const token = params.get("token");

const statusEl = document.getElementById("status");
const signinLink = document.getElementById("signin-link");

if (!projectId || !token) {
  statusEl.textContent = "This invite link is missing information.";
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      statusEl.textContent = "Sign in to accept this invite.";
      const next = `join.html?projectId=${projectId}&token=${token}`;
      signinLink.href = `signin.html?next=${encodeURIComponent(next)}`;
      signinLink.hidden = false;
      return;
    }

    try {
      // Already a member? (e.g. they revisited the link) — just go there.
      const memberSnap = await getDoc(doc(db, "projects", projectId, "members", user.uid));
      if (memberSnap.exists()) {
        window.location.href = `project.html?id=${projectId}`;
        return;
      }

      // Step 1: claim the invite. This single-document update is what makes
      // the invite single-use — it only succeeds if redeemedBy is still
      // null and it hasn't expired.
      await updateDoc(doc(db, "projects", projectId, "invites", token), {
        redeemedBy: user.uid,
        redeemedAt: serverTimestamp(),
      });

      // Step 2: now that the invite is provably claimed, grant membership.
      await setDoc(doc(db, "projects", projectId, "members", user.uid), {
        uid: user.uid,
        token,
        joinedAt: serverTimestamp(),
      });

      statusEl.textContent = "Joined! Redirecting…";
      window.location.href = `project.html?id=${projectId}`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = "This invite link is invalid, expired, or already used.";
    }
  });
}
