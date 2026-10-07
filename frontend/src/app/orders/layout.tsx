"use client";

import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";
import { salesRoles } from "@/lib/routeRoles";

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={salesRoles}>{children}</RoleGate>;
}
