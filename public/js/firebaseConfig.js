// The Firebase client config below is NOT a secret — it's safe to ship in
// frontend code and commit to git. Access control is enforced server-side
// by Firestore Security Rules and Cloud Functions, not by hiding this
// object. See CLAUDE.md > Security Principles.
//
// Replace these placeholder values with the real config from:
// Firebase Console > Project settings > General > Your apps > SDK setup.
export const firebaseConfig = {
  apiKey: "AIzaSyBvDsEXr6-dm35QpTQQxpURgeBKwsX9pks",
  authDomain: "maker-project-planner.firebaseapp.com",
  projectId: "maker-project-planner",
  storageBucket: "maker-project-planner.firebasestorage.app",
  messagingSenderId: "851892085886",
  appId: "1:851892085886:web:fd6a4db9e2ddd0784de42f",
  measurementId: "G-6293LS51F7",
};

// The reCAPTCHA v3 site key is also public/client-visible by design (like
// apiKey above) — it identifies the site, it doesn't authorize anything by
// itself. Verification happens server-side in App Check.
export const appCheckSiteKey = "6LeJanYtAAAAAPFticsygk6Rvur-tHBm1gJmGE8w";
