import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";

const form = document.getElementById("signin-form");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    errorEl.textContent = formatAuthError(err);
  }
});
