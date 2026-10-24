"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyQuotationPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/pos"); }, [router]);
  return <p className="p-8 text-center">جارٍ فتح نقطة البيع...</p>;
}
