// The active workspace is a client-only preference (see CLAUDE.md > the
// Business/Education workspaces design decision) — dashboard.js is the only
// place that ever writes this key. Reused here so every page with a tab bar
// can decide whether to show the Team tab without duplicating the same
// localStorage read four times.
export function readActiveWorkspaceId(uid) {
  return window.localStorage.getItem(`activeWorkspace:${uid}`);
}

export function isBusinessWorkspaceActive(uid, businessWorkspaceId) {
  return !!businessWorkspaceId && readActiveWorkspaceId(uid) === businessWorkspaceId;
}
