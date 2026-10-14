import { warehouseOnlyMode } from "@/lib/warehouseMode";

export function roleHome(role?: string): string {
  if (warehouseOnlyMode) {
    return role === "ADMIN" || role === "INVENTORY_CONTROLLER" ? "/inventory" : "/paused";
  }
  const destinations: Record<string, string> = {
    ADMIN: "/dashboard",
    INVENTORY_CONTROLLER: "/inventory",
    CASHIER_ORDERS: "/pos",
  };
  return destinations[role || ""] || "/login";
}
