import {
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";
import { isBusinessWorkspaceActive } from "./active-workspace.js";

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;
const MAX_PIN_ATTEMPTS = 5;

const loadingEl = document.getElementById("loading");
const profileEl = document.getElementById("profile");
const signOutBtn = document.getElementById("signout");

const currentUsernameEl = document.getElementById("current-username");
const currentDisplayNameEl = document.getElementById("current-displayname");
const currentEmailEl = document.getElementById("current-email");

const usernameForm = document.getElementById("username-form");
const newUsernameInput = document.getElementById("new-username");
const usernameErrorEl = document.getElementById("username-error");

const passwordForm = document.getElementById("password-form");
const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const passwordErrorEl = document.getElementById("password-error");

const resetBtn = document.getElementById("reset-password");
const resetErrorEl = document.getElementById("reset-error");

const deleteBtn = document.getElementById("delete-profile");
const deleteErrorEl = document.getElementById("delete-error");

const studentNoteEl = document.getElementById("student-note");
const businessClosedEl = document.getElementById("business-closed");
const businessOpenEl = document.getElementById("business-open");
const openBusinessBtn = document.getElementById("open-business-btn");
const educationClosedEl = document.getElementById("education-closed");
const educationOpenEl = document.getElementById("education-open");
const openEducationBtn = document.getElementById("open-education-btn");
const teacherPinDisplayEl = document.getElementById("teacher-pin-display");
const workspaceErrorEl = document.getElementById("workspace-error");
const teamTabEl = document.getElementById("team-tab");

let userData = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signin.html";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    userData = snap.exists() ? snap.data() : { displayName: user.email, username: "", email: user.email };
    renderAccount();
    await renderWorkspaces();
    loadingEl.hidden = true;
    profileEl.hidden = false;
  } catch (err) {
    console.error(err);
    loadingEl.hidden = true;
    deleteErrorEl.textContent = "Couldn't load your profile.";
  }
});

function renderAccount() {
  currentUsernameEl.textContent = userData.username || "(none)";
  currentDisplayNameEl.textContent = userData.displayName;
  currentEmailEl.textContent = userData.email;
}

async function renderWorkspaces() {
  const isStudent = !!userData.studentOfTeacherUid;
  studentNoteEl.hidden = !isStudent;
  teamTabEl.hidden = !isBusinessWorkspaceActive(auth.currentUser.uid, userData.businessWorkspaceId);

  const hasBusiness = !!userData.businessWorkspaceId;
  businessClosedEl.hidden = hasBusiness || isStudent;
  businessOpenEl.hidden = !hasBusiness;

  const hasEducation = !!userData.teacherWorkspaceId;
  educationClosedEl.hidden = hasEducation || isStudent;
  educationOpenEl.hidden = !hasEducation;
  if (hasEducation) {
    try {
      const workspaceSnap = await getDoc(doc(db, "workspaces", userData.teacherWorkspaceId));
      teacherPinDisplayEl.textContent = workspaceSnap.exists() ? workspaceSnap.data().teacherPin : "";
    } catch (err) {
      console.error(err);
      teacherPinDisplayEl.textContent = "";
    }
  }
}

function randomPin() {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
}

openBusinessBtn.addEventListener("click", async () => {
  workspaceErrorEl.textContent = "";
  openBusinessBtn.classList.add("is-loading");
  try {
    const user = auth.currentUser;
    const workspaceRef = doc(collection(db, "workspaces"));
    const batch = writeBatch(db);
    batch.set(workspaceRef, {
      type: "business",
      ownerId: user.uid,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "users", user.uid), { businessWorkspaceId: workspaceRef.id });
    await batch.commit();

    userData.businessWorkspaceId = workspaceRef.id;
    await renderWorkspaces();
  } catch (err) {
    console.error(err);
    workspaceErrorEl.textContent = "Couldn't open Business profile.";
  } finally {
    openBusinessBtn.classList.remove("is-loading");
  }
});

openEducationBtn.addEventListener("click", async () => {
  workspaceErrorEl.textContent = "";
  openEducationBtn.classList.add("is-loading");
  try {
    const user = auth.currentUser;
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt++) {
      const pin = randomPin();
      const workspaceRef = doc(collection(db, "workspaces"));
      try {
        // Two sequential writes, not one batch: the teacherPins/{pin}
        // create rule below looks this workspace up with get(), and a
        // get() inside a rule can't see another write still pending in
        // the same batch/transaction — the workspace has to actually
        // exist first.
        await setDoc(workspaceRef, {
          type: "education",
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          teacherPin: pin,
        });

        const batch = writeBatch(db);
        batch.set(doc(db, "teacherPins", pin), {
          workspaceId: workspaceRef.id,
          teacherUid: user.uid,
        });
        batch.update(doc(db, "users", user.uid), { teacherWorkspaceId: workspaceRef.id });
        await batch.commit();

        userData.teacherWorkspaceId = workspaceRef.id;
        await renderWorkspaces();
        return;
      } catch (err) {
        // Most likely the PIN was already taken (create-once-wins on
        // teacherPins/{pin}) — retry with a freshly generated PIN and a
        // fresh workspace doc. workspaces/{id} can never be deleted (see
        // firestore.rules — permanent by design), so the abandoned
        // workspace from this failed attempt is orphaned rather than
        // cleaned up; harmless since it's never referenced from anywhere
        // and a same-batch collision is astronomically rare (1 in 10^8
        // per attempt).
        lastErr = err;
      }
    }
    throw lastErr;
  } catch (err) {
    console.error(err);
    workspaceErrorEl.textContent = "Couldn't open Education profile.";
  } finally {
    openEducationBtn.classList.remove("is-loading");
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "signin.html";
});

const usernameSubmitBtn = usernameForm.querySelector('button[type="submit"]');

usernameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  usernameErrorEl.textContent = "";

  const newUsername = newUsernameInput.value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(newUsername)) {
    usernameErrorEl.textContent = "Username must be 3-20 characters, lowercase letters/numbers/underscores, starting with a letter.";
    return;
  }
  if (newUsername === userData.username) {
    usernameErrorEl.textContent = "That's already your username.";
    return;
  }

  usernameSubmitBtn.classList.add("is-loading");
  try {
    const takenSnap = await getDoc(doc(db, "usernames", newUsername));
    if (takenSnap.exists()) {
      usernameErrorEl.textContent = formatAuthError({ code: "app/username-taken" });
      return;
    }

    const user = auth.currentUser;
    const batch = writeBatch(db);
    if (userData.username) {
      batch.delete(doc(db, "usernames", userData.username));
    }
    batch.set(doc(db, "usernames", newUsername), {
      uid: user.uid,
      displayName: userData.displayName,
      photoURL: userData.photoURL ?? null,
    });
    batch.update(doc(db, "users", user.uid), { username: newUsername });
    await batch.commit();

    userData.username = newUsername;
    renderAccount();
    usernameForm.reset();
  } catch (err) {
    console.error(err);
    usernameErrorEl.textContent = "Couldn't update username.";
  } finally {
    usernameSubmitBtn.classList.remove("is-loading");
  }
});

const passwordSubmitBtn = passwordForm.querySelector('button[type="submit"]');

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordErrorEl.textContent = "";

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;

  passwordSubmitBtn.classList.add("is-loading");
  try {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    await updatePassword(user, newPassword);
    passwordForm.reset();
    passwordErrorEl.classList.add("success-text");
    passwordErrorEl.textContent = "Password updated.";
  } catch (err) {
    console.error(err);
    passwordErrorEl.classList.remove("success-text");
    passwordErrorEl.textContent = formatAuthError(err);
  } finally {
    passwordSubmitBtn.classList.remove("is-loading");
  }
});

resetBtn.addEventListener("click", async () => {
  resetErrorEl.textContent = "";
  resetBtn.classList.add("is-loading");
  try {
    await sendPasswordResetEmail(auth, auth.currentUser.email);
    resetErrorEl.classList.add("success-text");
    resetErrorEl.textContent = "Reset email sent — check your inbox.";
  } catch (err) {
    console.error(err);
    resetErrorEl.classList.remove("success-text");
    resetErrorEl.textContent = formatAuthError(err);
  } finally {
    resetBtn.classList.remove("is-loading");
  }
});

deleteBtn.addEventListener("click", async () => {
  deleteErrorEl.textContent = "";

  if (!window.confirm("Delete your account and any projects you own? This cannot be undone.")) return;
  const password = window.prompt("Enter your password to confirm account deletion:");
  if (!password) return;

  deleteBtn.classList.add("is-loading");
  try {
    const user = auth.currentUser;
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));

    const ownedSnap = await getDocs(query(collection(db, "projects"), where("ownerId", "==", user.uid)));
    for (const projectDoc of ownedSnap.docs) {
      await deleteDoc(projectDoc.ref);
    }

    await deleteDoc(doc(db, "users", user.uid));
    if (userData.username) {
      await deleteDoc(doc(db, "usernames", userData.username));
    }

    await deleteUser(user);
    window.location.href = "index.html";
  } catch (err) {
    console.error(err);
    deleteErrorEl.textContent = formatAuthError(err);
    deleteBtn.classList.remove("is-loading");
  }
});
