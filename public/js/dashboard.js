import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const loadingEl = document.getElementById("loading");
const dashboardEl = document.getElementById("dashboard");
const nameEl = document.getElementById("name");
const signOutBtn = document.getElementById("signout");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "signin.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  nameEl.textContent = userSnap.exists() ? userSnap.data().displayName : user.email;

  loadingEl.hidden = true;
  dashboardEl.hidden = false;
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "signin.html";
});
