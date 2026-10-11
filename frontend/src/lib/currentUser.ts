import { fetchApi } from "@/lib/api";
import type { UserRole } from "@/utils/auth";

export interface CurrentUser { email: string; role: UserRole }

let cached: { token: string; user: CurrentUser; until: number } | null = null;
let pending: { token: string; promise: Promise<CurrentUser> } | null = null;

function currentToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

export function cachedCurrentUser(): CurrentUser | null {
  const token = currentToken();
  return token && cached?.token === token && cached.until > Date.now() ? cached.user : null;
}

export function getCurrentUser(): Promise<CurrentUser> {
  const token = currentToken();
  const existing = cachedCurrentUser();
  if (existing) return Promise.resolve(existing);
  if (token && pending?.token === token) return pending.promise;
  const promise = fetchApi("/auth/me") as Promise<CurrentUser>;
  pending = { token: token || "", promise };
  return promise.then(user => {
    if (token && currentToken() === token) cached = { token, user, until: Date.now() + 10_000 };
    return user;
  }).finally(() => { if (pending?.promise === promise) pending = null; });
}
