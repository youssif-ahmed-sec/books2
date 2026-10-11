"use client";

import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";
import type { UserRole } from "@/utils/auth";

const reportingRoles: readonly UserRole[] = ["ADMIN", "SENIOR_SALES", "INVENTORY_CONTROLLER"];

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={reportingRoles}>{children}</RoleGate>;
}
