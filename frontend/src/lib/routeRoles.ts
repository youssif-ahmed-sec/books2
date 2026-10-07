import type { UserRole } from "@/utils/auth";

export const salesRoles: readonly UserRole[] = ["ADMIN", "CASHIER_ORDERS"];
export const inventoryRoles: readonly UserRole[] = ["ADMIN", "INVENTORY_CONTROLLER"];
export const adminRoles: readonly UserRole[] = ["ADMIN"];
