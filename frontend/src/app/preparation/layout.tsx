"use client";
import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";
import type { UserRole } from "@/utils/auth";

const preparationRoles: readonly UserRole[] = ["ADMIN", "CASHIER_ORDERS"];
export default function PreparationLayout({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={preparationRoles}>{children}</RoleGate>;
}
