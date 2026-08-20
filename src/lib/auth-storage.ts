const TOKEN_KEY = "authToken";
const USER_KEY = "currentUser";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function getStoredAuthToken(): string | null {
  if (!hasWindow()) return null;
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function storeAuthSession(token: string, user: unknown, remember: boolean): void {
  if (!hasWindow()) return;
  clearStoredAuthSession();
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, token);
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function storeCurrentUser(user: unknown): void {
  if (!hasWindow()) return;
  const storage = sessionStorage.getItem(TOKEN_KEY) ? sessionStorage : localStorage;
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredAuthSession(): void {
  if (!hasWindow()) return;
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
}
