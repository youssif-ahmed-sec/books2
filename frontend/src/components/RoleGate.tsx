"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { roleHome } from "@/lib/roleHome";
import type { UserRole } from "@/utils/auth";

export default function RoleGate({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly UserRole[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchApi("/auth/me")
      .then((user: { role: UserRole }) => {
        if (!active) return;
        if (allowedRoles.includes(user.role)) setAllowed(true);
        else router.replace(roleHome(user.role));
      })
      .catch(() => {
        if (active) router.replace("/login");
      });
    return () => { active = false; };
  }, [allowedRoles, router]);

  return allowed ? <>{children}</> : null;
}
