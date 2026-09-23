// Where esc on settings goes back to: the last mail view and thread in this tab. Best effort.
const KEY = "superfer.mailPath";

export function readMailPath(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberMailPath(path: string) {
  try {
    window.sessionStorage.setItem(KEY, path);
  } catch {
    // Blocked storage: settings goes back to inbox.
  }
}
