export type UserRole = "Admin" | "Cashier" | "Sales" | "Inventory Controller" | "Sales Assistant";

export function decodeJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      window.atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    return null;
  }
}

export function getUserRole(): UserRole | null {
  if (typeof window === "undefined") return null;
  
  const token = localStorage.getItem("access_token");
  if (!token) return null;
  
  const decoded = decodeJwt(token);
  return decoded?.role || null;
}

export function canViewCost(role: UserRole | null): boolean {
  return role === "Admin" || role === "Inventory Controller";
}

export function canEditProduct(role: UserRole | null): boolean {
  return role === "Admin" || role === "Inventory Controller";
}
