export const warehouseOnlyMode = process.env.NEXT_PUBLIC_WAREHOUSE_ONLY === "1";

const warehousePaths = new Set([
  "/", "/login", "/paused", "/inventory", "/inventory/product", "/stock-operations", "/product-approvals", "/count-approvals",
  "/suppliers", "/purchases", "/purchases/legacy", "/integrations/whatsapp", "/categories", "/offers", "/settings", "/audit",
]);

export function warehousePathEnabled(pathname: string): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return !warehouseOnlyMode || warehousePaths.has(path);
}
