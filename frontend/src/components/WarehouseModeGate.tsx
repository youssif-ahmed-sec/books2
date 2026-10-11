"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { warehousePathEnabled } from "@/lib/warehouseMode";

export default function WarehouseModeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const enabled = warehousePathEnabled(pathname);

  useEffect(() => {
    if (!enabled) router.replace("/paused");
  }, [enabled, router]);

  return enabled ? <>{children}</> : null;
}
