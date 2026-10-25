"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchApi } from "@/lib/api";
import { searchSection, sectionSearchHasSnapshot, sectionSearchLabel, type SectionSearchResult } from "@/lib/sectionSearch";
import { cachedCurrentUser, getCurrentUser } from "@/lib/currentUser";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";
import { notifyError } from "@/lib/notifications";
import { useTopNavSearchSlot } from "@/lib/topNavSearchPortal";

interface TopNavProps { title: string }
interface CurrentUser { email: string | null; username?: string | null; full_name?: string | null; role: string }

const roleLabels: Record<string, string> = {
  ADMIN: "مدير النظام",
  INVENTORY_CONTROLLER: "مسؤول المخزون",
  CASHIER_ORDERS: "الكاشير والطلبات",
};

function revealResult(id: string) {
  let attempts = 0;
  const timer = window.setInterval(() => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-search-id]")).find(node => node.dataset.searchId === id && node.getClientRects().length > 0);
    if (element) { element.scrollIntoView({ behavior: "smooth", block: "center" }); element.classList.add("app-search-target"); window.clearInterval(timer); }
    if (++attempts >= 40) window.clearInterval(timer);
  }, 150);
}

export default function TopNav({ title }: TopNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchLabel = sectionSearchLabel(pathname);
  const { setSlot, active: customSearch, overlay: overlaySearch } = useTopNavSearchSlot();
  const [user, setUser] = useState<CurrentUser | null>(() => cachedCurrentUser());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SectionSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentUser().then((currentUser: CurrentUser) => {
      setUser(currentUser);
    }).catch(() => {});
    const closeOutside = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(""); setResults([]); setSearchOpen(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("focus");
    if (!id) return;
    revealResult(id);
  }, [pathname]);

  useEffect(() => {
    const value = query.trim();
    if (customSearch || value.length < 2 || !searchLabel) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const found = await searchSection(pathname, value, controller.signal);
        if (active) setResults(found.slice(0, 20));
      } catch {
        if (active) { setResults([]); setSearchError(true); }
      } finally {
        if (active) setSearching(false);
      }
    }, sectionSearchHasSnapshot(pathname) ? 0 : 200);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [query, pathname, searchLabel, customSearch]);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetchApi("/auth/logout", { method: "POST" });
      localStorage.removeItem("access_token");
      router.replace("/login");
    } catch {
      if (localStorage.getItem("access_token")) notifyError("تعذر إنهاء الجلسة. حاول مرة أخرى.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className={`app-top-nav fixed left-8 right-[380px] top-8 ${overlaySearch ? "z-[130]" : "z-40"} flex min-h-[76px] items-center gap-6 rounded-full px-7 py-3 lg:px-9`}>
      <div className="app-top-title shrink-0">
        <h2 className="text-lg font-bold text-primary">{title}</h2>
      </div>
      <div className="app-top-search relative min-w-0 w-[min(34vw,480px)]" ref={searchRef}>
        <div ref={setSlot} className={customSearch ? "min-w-0 w-full" : "hidden"} />
        {!customSearch && <div className="app-search app-search-focus flex h-10 items-center gap-2 rounded-full px-4">
          <span className="material-symbols-outlined text-xl app-muted" aria-hidden="true">search</span>
          <input type="search" value={query} disabled={!searchLabel}
            onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)} placeholder={searchLabel ? `ابحث عن ${searchLabel}...` : "لا توجد سجلات للبحث في هذا القسم"} aria-label={searchLabel ? `البحث عن ${searchLabel}` : "البحث غير متاح في هذا القسم"}
            className="app-hide-native-search-clear min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-60" />
          {query && <button type="button" onClick={() => { setQuery(""); setResults([]); }} aria-label="مسح البحث" className="app-muted text-xs hover:text-white">✕</button>}
        </div>}
        {!customSearch && searchOpen && query.trim().length >= 2 && (
          <div className="app-menu absolute left-0 right-0 top-[calc(100%+8px)] max-h-80 overflow-y-auto rounded-2xl p-2 shadow-2xl z-50">
            {searching ? <p className="app-muted p-3 text-sm">جاري البحث...</p> : searchError ? <p className="p-3 text-sm text-[#ffb4ab]">تعذر البحث حاليًا. حاول مرة أخرى.</p> : results.length ? results.map((result) => (
              <Link key={result.id} href={result.href} onClick={() => { setSearchOpen(false); setQuery(""); window.dispatchEvent(new CustomEvent("section-search-focus", { detail: result.id })); revealResult(result.id); }} className="app-search-result flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-white/5 transition-colors">
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{result.label}</span>
                  {result.detail && <span className="app-muted block truncate text-xs" dir="ltr">{result.detail}</span>}
                </div>
                {result.priceTag && (
                  <span className="shrink-0 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-bold text-primary tabular-nums">
                    {result.priceTag}
                  </span>
                )}
              </Link>
            )) : <p className="app-muted p-3 text-sm">لا توجد نتائج مطابقة</p>}
          </div>
        )}
      </div>
      <div className="app-top-spacer flex-1" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-3">
        <NotificationBell />
        <div className="relative" ref={accountRef}>
          <button type="button" aria-label="الحساب" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)} className="app-icon-button app-account-button">
            <span className="material-symbols-outlined">account_circle</span>
          </button>
          {accountOpen && (
            <div className="app-menu absolute left-0 top-[calc(100%+8px)] w-64 rounded-2xl p-3 shadow-xl">
              <p className="text-sm font-bold">{user ? roleLabels[user.role] || user.role : "الحساب"}</p>
              <p className="app-muted mt-1 truncate text-xs">{user?.full_name || user?.username || user?.email}</p>
              <div className="app-divider my-3" />
              {user?.role === "ADMIN" && <Link href="/settings" className="app-menu-action"><span className="material-symbols-outlined text-lg">settings</span>الإعدادات</Link>}
              <div className="app-menu-action justify-between"><span>المظهر</span><ThemeToggle /></div>
              <button type="button" onClick={() => void logout()} disabled={loggingOut} className="app-menu-action w-full text-[#d95143]"><span className="material-symbols-outlined text-lg">logout</span>{loggingOut ? "جاري تسجيل الخروج..." : "تسجيل الخروج"}</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
