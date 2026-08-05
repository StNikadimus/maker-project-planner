import {
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";

const form = document.getElementById("signup-form");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

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
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    errorEl.textContent = formatAuthError(err);
  }
});
