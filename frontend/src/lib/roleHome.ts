export function roleHome(role?: string): string {
  const destinations: Record<string, string> = {
    ADMIN: "/dashboard",
    INVENTORY_CONTROLLER: "/inventory",
    CASHIER_ORDERS: "/pos",
    SENIOR_SALES: "/reports",
    SALES_ASSISTANT: "/customers",
  };
  return destinations[role || ""] || "/login";
}
