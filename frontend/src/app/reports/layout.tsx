"use client";

import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";
import { adminRoles } from "@/lib/routeRoles";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={adminRoles}>{children}</RoleGate>;
}
