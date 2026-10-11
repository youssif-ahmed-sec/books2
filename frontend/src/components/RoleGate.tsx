"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cachedCurrentUser, getCurrentUser } from "@/lib/currentUser";
import { roleHome } from "@/lib/roleHome";
import type { UserRole } from "@/utils/auth";
import SessionLoadingScreen from "@/components/SessionLoadingScreen";

export default function RoleGate({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly UserRole[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(() => {
    const user = cachedCurrentUser();
    return Boolean(user && allowedRoles.includes(user.role));
  });

  useEffect(() => {
    let active = true;
    getCurrentUser()
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

  return allowed ? <>{children}</> : <SessionLoadingScreen />;
}
