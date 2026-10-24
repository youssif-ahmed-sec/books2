"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyOrderPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/pos"); }, [router]);
  return <p className="p-8 text-center">جارٍ فتح نقطة البيع...</p>;
}
