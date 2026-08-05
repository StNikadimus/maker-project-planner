import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebaseConfig.js";

const statusEl = document.getElementById("status");

try {
  const app = initializeApp(firebaseConfig);
  getAuth(app);
  getFirestore(app);
  statusEl.textContent = "Connected to Firebase";
  statusEl.classList.add("status--ok");
} catch (err) {
  statusEl.textContent = "Firebase connection failed: " + err.message;
  statusEl.classList.add("status--error");
  console.error(err);
}
