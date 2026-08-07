import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("projectId");
const token = params.get("token");

const statusEl = document.getElementById("status");
const signinLink = document.getElementById("signin-link");
const workspaceChoiceEl = document.getElementById("workspace-choice");
const workspaceChoiceButtonsEl = document.getElementById("workspace-choice-buttons");

function setStatus(message, { loading = false } = {}) {
  statusEl.textContent = "";
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "spinner spinner--inline";
    spinner.setAttribute("role", "status");
    spinner.setAttribute("aria-label", "Loading");
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(message));
}

if (!projectId || !token) {
  setStatus("This invite link is missing information.");
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setStatus("Sign in to accept this invite.");
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

      const profileSnap = await getDoc(doc(db, "users", user.uid));
      const profile = profileSnap.exists() ? profileSnap.data() : {};

      // Which of the joiner's OWN workspace tabs should this shared
      // project appear under? Only ask when there's an actual choice —
      // most accounts only have Personal open.
      const options = [{ id: user.uid, label: "Personal" }];
      if (profile.businessWorkspaceId) options.push({ id: profile.businessWorkspaceId, label: "Business" });
      if (profile.teacherWorkspaceId) options.push({ id: profile.teacherWorkspaceId, label: "Education (Teacher)" });

      if (options.length === 1) {
        await acceptInvite(user, profile, options[0].id);
        return;
      }

      setStatus("");
      workspaceChoiceEl.hidden = false;
      workspaceChoiceButtonsEl.innerHTML = "";
      for (const option of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = option.label;
        btn.addEventListener("click", async () => {
          workspaceChoiceEl.hidden = true;
          setStatus("Joining…", { loading: true });
          await acceptInvite(user, profile, option.id);
        });
        workspaceChoiceButtonsEl.appendChild(btn);
      }
    } catch (err) {
      console.error(err);
      setStatus("This invite link is invalid, expired, or already used.");
    }
  });
}

async function acceptInvite(user, profile, viewWorkspaceId) {
  try {
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
      displayName: profile.displayName || user.email,
      username: profile.username || "",
      viewWorkspaceId,
      joinedAt: serverTimestamp(),
    });

    setStatus("Joined! Redirecting…", { loading: true });
    window.location.href = `project.html?id=${projectId}`;
  } catch (err) {
    console.error(err);
    setStatus("This invite link is invalid, expired, or already used.");
  }
}
