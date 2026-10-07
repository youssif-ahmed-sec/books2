"use client";

import type { ReactNode } from "react";
import RoleGate from "@/components/RoleGate";

const adminRoles = ["ADMIN"] as const;

export default function AdminGate({ children }: { children: ReactNode }) {
  return <RoleGate allowedRoles={adminRoles}>{children}</RoleGate>;
}
