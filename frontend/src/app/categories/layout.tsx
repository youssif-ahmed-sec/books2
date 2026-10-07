"use client";

import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";
import { inventoryRoles } from "@/lib/routeRoles";

export default function CategoriesLayout({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={inventoryRoles}>{children}</RoleGate>;
}
