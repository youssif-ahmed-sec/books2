import { fetchApi } from "@/lib/api";
import type { UserRole } from "@/utils/auth";

export interface CurrentUser { id: string; email: string; username?: string | null; role: UserRole }

let cached: { token: string; user: CurrentUser } | null = null;
let pending: { token: string; promise: Promise<CurrentUser> } | null = null;

function currentToken() {
  return typeof window === "undefined" ? null : localStorage.getItem("access_token");
}

export function cachedCurrentUser(): CurrentUser | null {
  const token = currentToken();
  return token && cached?.token === token ? cached.user : null;
}

export function getCurrentUser(): Promise<CurrentUser> {
  const token = currentToken();
  if (token && pending?.token === token) return pending.promise;
  const promise = fetchApi("/auth/me") as Promise<CurrentUser>;
  pending = { token: token || "", promise };
  return promise.then(user => {
    if (token && currentToken() === token) cached = { token, user };
    return user;
  }).catch(error => {
    if (cached?.token === token) cached = null;
    throw error;
  }).finally(() => { if (pending?.promise === promise) pending = null; });
}
