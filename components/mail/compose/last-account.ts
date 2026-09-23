// The account new mail defaults to: the last one read or sent from. Per browser, best effort.
const KEY = "superfer.lastAccountId";

export function readLastAccount(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberAccount(accountId: string) {
  try {
    window.localStorage.setItem(KEY, accountId);
  } catch {
    // Private mode or blocked storage: fall back to the first account.
  }
}
