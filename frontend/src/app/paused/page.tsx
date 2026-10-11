"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { useEffect, useState } from "react";
import { getUserRole, type UserRole } from "@/utils/auth";

export default function PausedPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  useEffect(() => setRole(getUserRole()), []);
  const logout = () => {
    fetchApi("/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("access_token");
    router.replace("/login");
  };

  return <main className="flex min-h-screen items-center justify-center p-6" dir="rtl">
    <section className="app-panel max-w-xl space-y-5 p-8 text-center">
      <svg className="mx-auto h-12 w-12 text-primary" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="M5 20 24 8l19 12v23H5V20Z"/><path d="M13 43V25h22v18M13 31h22M24 25v18"/>
      </svg>
      <h1 className="text-2xl font-bold">العمل الحالي على المخازن</h1>
      <p className="app-muted leading-8">وظائف المبيعات والمالية والعملاء متوقفة مؤقتًا خلال تسليم المخازن. حسابات المخازن والإدارة تقدر تدخل إلى صفحات المخزون والمشتريات.</p>
      <div className="flex justify-center gap-3">
        {(role === "ADMIN" || role === "INVENTORY_CONTROLLER") && <Link className="app-primary-button" href="/inventory">الذهاب للمخزون</Link>}
        {!role && <Link className="app-primary-button" href="/login">تسجيل الدخول</Link>}
        <button className="app-secondary-button" onClick={logout}>تسجيل الخروج</button>
      </div>
    </section>
  </main>;
}
