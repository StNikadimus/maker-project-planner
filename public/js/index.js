import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { auth } from "./firebase-init.js";

const authLinks = document.getElementById("auth-links");

onAuthStateChanged(auth, (user) => {
  authLinks.innerHTML = user
    ? '<a class="btn" href="dashboard.html">Go to dashboard</a>'
    : '<a class="btn" href="signin.html">Sign in</a><a class="btn btn--secondary" href="signup.html">Sign up</a>';
});
