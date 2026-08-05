import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "./firebase-init.js";
import { formatAuthError } from "./auth-errors.js";

const form = document.getElementById("signin-form");
const errorEl = document.getElementById("error");
const signupLink = document.getElementById("signup-link");

const next = new URLSearchParams(window.location.search).get("next");
if (next) {
  signupLink.href = `signup.html?next=${encodeURIComponent(next)}`;
}

const submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  submitBtn.classList.add("is-loading");

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = next || "dashboard.html";
  } catch (err) {
    console.error(err);
    errorEl.textContent = formatAuthError(err);
    submitBtn.classList.remove("is-loading");
  }
});
