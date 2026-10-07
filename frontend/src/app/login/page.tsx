"use client";

import { useState } from "react";
import { roleHome } from "@/lib/roleHome";
import { errorMessage } from "@/lib/errors";
import BrandMark from "@/components/BrandMark";
import ThemeToggle from "@/components/ThemeToggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    
    try {
      const formData = new URLSearchParams();
      formData.append("username", email);
      formData.append("password", password);

      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "فشل تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.");
      }

      const data = await res.json();
      localStorage.setItem("access_token", data.access_token);
      window.location.href = roleHome(data.user?.role);
    } catch (err) {
      setError(errorMessage(err, "فشل تسجيل الدخول"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell min-h-screen" dir="rtl">
      <div className="absolute left-5 top-5 z-10 md:left-10 md:top-10"><ThemeToggle /></div>
      <section className="login-intro hidden lg:flex">
        <div className="relative z-10 flex h-full flex-col justify-between p-14 xl:p-20">
          <div className="flex items-center gap-5">
            <BrandMark />
            <div><p className="text-2xl font-bold">مكتبة سعود الشافعي</p><p className="mt-1 text-sm opacity-70">مساحة عمل واحدة لإدارة المكتبة</p></div>
          </div>
          <div className="max-w-lg">
            <span className="login-eyebrow">إدارة واضحة من أول خطوة</span>
            <h1 className="mt-6 text-5xl font-bold leading-[1.35] xl:text-6xl">كل تفاصيل المكتبة<br /><span className="text-primary">في مكان واحد.</span></h1>
            <p className="mt-6 max-w-md text-lg leading-9 opacity-70">تابع المنتجات والطلبات والمبيعات بسهولة، مع صلاحيات مناسبة لكل فرد في فريقك.</p>
          </div>
          <p className="text-sm opacity-50">نظام إدارة مكتبة سعود الشافعي</p>
        </div>
        <div className="login-art" aria-hidden="true"><span /><span /><span /></div>
      </section>
      <main className="flex min-h-screen items-center justify-center px-5 py-14 lg:col-span-1 lg:px-10">
        <div className="w-full max-w-[440px] animate-fade-in">
          <div className="mb-10 flex items-center gap-4 lg:hidden"><BrandMark /><p className="text-xl font-bold">مكتبة سعود الشافعي</p></div>
          <div className="mb-9">
            <p className="login-eyebrow">مرحبًا بعودتك</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">تسجيل الدخول</h2>
            <p className="app-muted mt-3 text-sm leading-7">أدخل بيانات حسابك للوصول إلى مساحة عملك.</p>
          </div>
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-2.5">
              <label htmlFor="username" className="block text-sm font-semibold">البريد الإلكتروني</label>
              <div className="relative">
                <span aria-hidden="true" className="material-symbols-outlined app-muted pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl">mail</span>
                <input
                  id="username"
                  name="username"
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="login-input w-full py-4 pl-12 pr-5 text-left text-base"
                />
              </div>
            </div>
            <div className="space-y-2.5">
              <label htmlFor="password" className="block text-sm font-semibold">كلمة المرور</label>
              <div className="relative">
                <span aria-hidden="true" className="material-symbols-outlined app-muted pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xl">lock</span>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  dir="ltr"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="login-input w-full py-4 pl-12 pr-12 text-left text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="app-muted absolute inset-y-0 right-0 flex items-center pr-4 hover:text-primary"
                >
                  <span className="material-symbols-outlined text-xl">{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex w-full items-center justify-center gap-3 rounded-xl bg-primary py-4 font-bold text-white shadow-[0_12px_24px_-12px_rgba(255,107,0,.55)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>جاري التحقق...</span>
                </>
              ) : (
                <>
                  <span>تسجيل الدخول</span>
                  <span className="material-symbols-outlined text-xl">arrow_back</span>
                </>
              )}
            </button>
          </form>
          <p className="app-muted mt-9 border-t border-white/10 pt-7 text-center text-xs leading-6">هذا النظام مخصص لفريق المكتبة. تواصل مع المدير إذا واجهت مشكلة في الدخول.</p>
        </div>
      </main>
    </div>
  );
}
