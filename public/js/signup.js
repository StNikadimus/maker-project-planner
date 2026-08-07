import {
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;
const PIN_PATTERN = /^[0-9]{8}$/;

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("error");
const signinLink = document.getElementById("signin-link");
const isStudentCheckbox = document.getElementById("is-student");
const teacherPinWrap = document.getElementById("teacher-pin-wrap");
const teacherPinInput = document.getElementById("teacher-pin");

const next = new URLSearchParams(window.location.search).get("next");
if (next) {
  signinLink.href = `signin.html?next=${encodeURIComponent(next)}`;
}

isStudentCheckbox.addEventListener("change", () => {
  teacherPinWrap.hidden = !isStudentCheckbox.checked;
  teacherPinInput.required = isStudentCheckbox.checked;
  if (!isStudentCheckbox.checked) teacherPinInput.value = "";
});

const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  submitBtn.classList.add("is-loading");

  const displayName = form.displayName.value.trim();
  const username = form.username.value.trim().toLowerCase();
  const email = form.email.value.trim();
  const password = form.password.value;
  const teacherPin = isStudentCheckbox.checked ? teacherPinInput.value.trim() : "";

  if (!USERNAME_PATTERN.test(username)) {
    errorEl.textContent = "Username must be 3-20 characters, lowercase letters/numbers/underscores, starting with a letter.";
    submitBtn.classList.remove("is-loading");
    return;
  }

  if (isStudentCheckbox.checked && !PIN_PATTERN.test(teacherPin)) {
    errorEl.textContent = "Teacher PIN must be exactly 8 digits.";
    submitBtn.classList.remove("is-loading");
    return;
  }

  try {
    const usernameSnap = await getDoc(doc(db, "usernames", username));
    if (usernameSnap.exists()) {
      errorEl.textContent = formatAuthError({ code: "app/username-taken" });
      submitBtn.classList.remove("is-loading");
      return;
    }

    // Resolve the teacher PIN before creating the account — fail fast on a
    // bad code, same reasoning as the username pre-check above.
    let teacherLink = null;
    if (isStudentCheckbox.checked) {
      const pinSnap = await getDoc(doc(db, "teacherPins", teacherPin));
      if (!pinSnap.exists()) {
        errorEl.textContent = "That teacher PIN wasn't found. Check it and try again.";
        submitBtn.classList.remove("is-loading");
        return;
      }
      teacherLink = pinSnap.data();
    }

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await updateProfile(credential.user, { displayName });
      const batch = writeBatch(db);
      batch.set(doc(db, "users", credential.user.uid), {
        displayName,
        username,
        email,
        createdAt: serverTimestamp(),
        photoURL: null,
        businessWorkspaceId: null,
        teacherWorkspaceId: null,
        studentOfTeacherUid: teacherLink ? teacherLink.teacherUid : null,
        studentOfWorkspaceId: teacherLink ? teacherLink.workspaceId : null,
      });
      batch.set(doc(db, "usernames", username), {
        uid: credential.user.uid,
        displayName,
        photoURL: null,
      });
      if (teacherLink) {
        batch.set(doc(db, "workspaces", teacherLink.workspaceId, "students", credential.user.uid), {
          uid: credential.user.uid,
          username,
          displayName,
          joinedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      window.location.href = next || "dashboard.html";
    } catch (batchErr) {
      // Someone else won the username race after our pre-check — the
      // account was created but has no profile yet. Roll it back cleanly
      // (session is seconds old, no reauth needed) rather than leaving an
      // orphaned auth account with no users/{uid} doc.
      await deleteUser(credential.user);
      const rollbackErr = new Error("Username taken during signup, account rolled back.");
      rollbackErr.code = "app/username-taken";
      rollbackErr.cause = batchErr;
      throw rollbackErr;
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = formatAuthError(err);
    submitBtn.classList.remove("is-loading");
  }
});
