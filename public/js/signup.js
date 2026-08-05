import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("error");
const signinLink = document.getElementById("signin-link");

const next = new URLSearchParams(window.location.search).get("next");
if (next) {
  signinLink.href = `signin.html?next=${encodeURIComponent(next)}`;
}

const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  submitBtn.classList.add("is-loading");

  const displayName = form.displayName.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName });
    await setDoc(doc(db, "users", credential.user.uid), {
      displayName,
      email,
      createdAt: serverTimestamp(),
    });
    window.location.href = next || "dashboard.html";
  } catch (err) {
    console.error(err);
    errorEl.textContent = formatAuthError(err);
    submitBtn.classList.remove("is-loading");
  }
});
