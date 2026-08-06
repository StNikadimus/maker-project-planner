const MESSAGES = {
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/invalid-email": "That email address doesn't look valid.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/requires-recent-login": "Please sign in again and retry — this action needs a fresh session.",
  "app/username-taken": "That username was just taken — please try another.",
};

export function formatAuthError(err) {
  return MESSAGES[err.code] || "Something went wrong. Please try again.";
}
