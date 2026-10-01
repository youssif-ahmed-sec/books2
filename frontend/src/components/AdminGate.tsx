"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { roleHome } from "@/lib/roleHome";

export default function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchApi("/auth/me")
      .then(user => {
        if (!mounted) return;
        if (user.role === "ADMIN") setAllowed(true);
        else router.replace(roleHome(user.role));
      })
      .catch(() => {
        if (mounted) router.replace("/login");
      });
    return () => { mounted = false; };
  }, [router]);

  return allowed ? <>{children}</> : null;
}
