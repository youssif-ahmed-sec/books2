"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import ThemeToggle from "@/components/ThemeToggle";

interface TopNavProps { title: string }
interface SearchProduct { id: string; name_ar: string; sku: string }
interface CurrentUser { email: string; role: string }

const roleLabels: Record<string, string> = {
  ADMIN: "مدير النظام",
  INVENTORY_CONTROLLER: "مسؤول المخزون",
  CASHIER_ORDERS: "الكاشير والطلبات",
  SENIOR_SALES: "مبيعات أول",
  SALES_ASSISTANT: "مساعد مبيعات",
};

export default function TopNav({ title }: TopNavProps) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [hasOrderUpdates, setHasOrderUpdates] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchApi("/auth/me").then((currentUser: CurrentUser) => {
      setUser(currentUser);
      if (currentUser.role === "ADMIN" || currentUser.role === "CASHIER_ORDERS") {
        fetchApi("/dashboards/operational")
          .then((summary: { new_leads: number; active_orders: number }) => setHasOrderUpdates(summary.new_leads + summary.active_orders > 0))
          .catch(() => {});
      }
    }).catch(() => {});
    const closeOutside = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const response = await fetchApi(`/products?search=${encodeURIComponent(value)}&limit=6`);
        if (active) setResults(response.data || []);
      } catch {
        if (active) { setResults([]); setSearchError(true); }
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const logout = () => {
    localStorage.removeItem("access_token");
    router.replace("/login");
  };

  return (
    <header className="app-top-nav fixed left-8 right-[364px] top-8 z-40 flex min-h-[76px] items-center gap-6 rounded-full px-7 py-3 lg:px-9">
      <div className="app-top-title shrink-0">
        <h2 className="text-lg font-bold text-primary">{title}</h2>
      </div>
      <div className="app-top-search relative min-w-0 w-[min(34vw,480px)]" ref={searchRef}>
        <label className="app-search app-search-focus flex h-10 items-center gap-2 rounded-full px-4">
          <span className="material-symbols-outlined text-xl app-muted" aria-hidden="true">search</span>
          <input type="search" value={query}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); if (event.target.value.trim().length < 2) setResults([]); }}
            onFocus={() => setSearchOpen(true)} placeholder="بحث سريع عن صنف أو باركود..." aria-label="البحث عن منتج"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60" />
        </label>
        {searchOpen && query.trim().length >= 2 && (
          <div className="app-menu absolute left-0 right-0 top-[calc(100%+8px)] max-h-72 overflow-y-auto rounded-2xl p-2 shadow-xl">
            {searching ? <p className="app-muted p-3 text-sm">جاري البحث...</p> : searchError ? <p className="p-3 text-sm text-[#ffb4ab]">تعذر البحث حاليًا. حاول مرة أخرى.</p> : results.length ? results.map((product) => (
              <div key={product.id} className="app-search-result flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm">
                <span className="min-w-0 truncate font-semibold">{product.name_ar}</span>
                <span className="app-muted shrink-0 text-xs" dir="ltr">{product.sku}</span>
              </div>
            )) : <p className="app-muted p-3 text-sm">لا توجد منتجات مطابقة</p>}
          </div>
        )}
      </div>
      <div className="app-top-spacer flex-1" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-3">
        {(user?.role === "ADMIN" || user?.role === "CASHIER_ORDERS") && (
          <Link href="/inbox" aria-label="متابعة الطلبات والإشعارات" title="متابعة الطلبات" className="app-icon-button relative">
            <span className="material-symbols-outlined">notifications</span>
            {hasOrderUpdates && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />}
          </Link>
        )}
        <div className="relative" ref={accountRef}>
          <button type="button" aria-label="الحساب" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)} className="app-icon-button app-account-button">
            <span className="material-symbols-outlined">account_circle</span>
          </button>
          {accountOpen && (
            <div className="app-menu absolute left-0 top-[calc(100%+8px)] w-64 rounded-2xl p-3 shadow-xl">
              <p className="text-sm font-bold">{user ? roleLabels[user.role] || user.role : "الحساب"}</p>
              <p className="app-muted mt-1 truncate text-xs" dir="ltr">{user?.email}</p>
              <div className="app-divider my-3" />
              {user?.role === "ADMIN" && <Link href="/settings" className="app-menu-action"><span className="material-symbols-outlined text-lg">settings</span>الإعدادات</Link>}
              <div className="app-menu-action justify-between"><span>المظهر</span><ThemeToggle /></div>
              <button type="button" onClick={logout} className="app-menu-action w-full text-[#d95143]"><span className="material-symbols-outlined text-lg">logout</span>تسجيل الخروج</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
