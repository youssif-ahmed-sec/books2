"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cachedCurrentUser, getCurrentUser } from "@/lib/currentUser";
import { errorMessage } from "@/lib/errors";
import BrandMark from "./BrandMark";
import { warehouseOnlyMode } from "@/lib/warehouseMode";

const navItems = [
  { href: "/dashboard", icon: "dashboard", label: "لوحة التحكم", disabled: false },
  { href: "/pos", icon: "point_of_sale", label: "نقطة البيع", disabled: false },
  { href: "/cash-register", icon: "payments", label: "الصندوق", disabled: false },
  { href: "/orders", icon: "receipt_long", label: "الفواتير", disabled: false },
  { href: "/returns", icon: "assignment_return", label: "المرتجعات", disabled: false },
  { href: "/customers", icon: "group", label: "العملاء", disabled: false },
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, disabled: false },
  { href: "/stock-operations", icon: "swap_horiz", label: "النقل والجرد", disabled: false },
  { href: "/product-approvals", icon: "rule", label: "طلبات المنتجات", disabled: false },
  { href: "/count-approvals", icon: "fact_check", label: "موافقات الجرد", disabled: false },
  { href: "/categories", icon: "category", label: "التصنيفات والعلامات", disabled: false },
  { href: "/offers", icon: "sell", label: "العروض", disabled: false },
  { href: "/purchases", icon: "receipt_long", label: "المشتريات", disabled: false },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", disabled: false },
  { href: "/integrations/whatsapp", icon: "forum", label: "تكامل واتساب", disabled: false },
  { href: "/financials", icon: "account_balance_wallet", label: "المالية", disabled: false },
  { href: "/reports", icon: "analytics", label: "التقارير", disabled: false },
  { href: "/audit", icon: "history", label: "سجل التدقيق", disabled: false },
];

const navGroups = [
  { id: "sales", label: "المبيعات والصندوق", hrefs: ["/pos", "/cash-register", "/orders", "/returns", "/customers"] },
  { id: "inventory", label: "المخزون والمشتريات", hrefs: ["/inventory", "/stock-operations", "/categories", "/offers", "/purchases", "/suppliers"] },
  { id: "approvals", label: "الموافقات والرقابة", hrefs: ["/product-approvals", "/count-approvals", "/audit"] },
  { id: "management", label: "الإدارة والتقارير", hrefs: ["/dashboard", "/financials", "/reports", "/integrations/whatsapp"] },
] as const;

const groupForPath = (path: string) => navGroups.find(group => group.hrefs.some(href => path === href || path.startsWith(`${href}/`)));

// Preserve the scroll position across full page loads as well as client navigation.
let rememberedNavScrollTop = 0;

export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<{ email: string | null; username?: string | null; role: string } | null>(() => cachedCurrentUser());
  const [mobileMenu, setMobileMenu] = useState({ path: pathname, open: false });
  const mobileOpen = mobileMenu.path === pathname && mobileMenu.open;
  const [selectedGroup, setSelectedGroup] = useState<{ path: string; group: string }>(() => ({ path: pathname, group: groupForPath(pathname)?.id || "sales" }));
  const expandedGroup = selectedGroup.path === pathname ? selectedGroup.group : groupForPath(pathname)?.id || "sales";
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = rememberedNavScrollTop;
  }, []);

  useEffect(() => {
    async function loadUser() {
      try {
        const userData = await getCurrentUser();
        setUser(userData);
      } catch (err) {
        const message = errorMessage(err, "");
        if (message.includes("401") || message.includes("Unauthorized")) {
          localStorage.removeItem("access_token");
          router.push("/login");
        }
      }
    }
    loadUser();

  }, [router]);

  const visibleNavItems = navItems.filter((item) => {
    if (warehouseOnlyMode && !["/inventory", "/stock-operations", "/product-approvals", "/count-approvals", "/suppliers", "/purchases", "/integrations/whatsapp", "/categories", "/offers", "/audit"].includes(item.href)) return false;
    const role = user?.role;
    if (!role) return false;
    if (item.href === "/dashboard") {
      return role === "ADMIN";
    }
    if (item.href === "/count-approvals") return role === "ADMIN";
    if (item.href === "/reports") {
      return role === "ADMIN";
    }
    if (["/suppliers", "/integrations/whatsapp"].includes(item.href)) return role === "ADMIN";
    if (["/inventory", "/stock-operations", "/product-approvals", "/purchases", "/categories", "/offers"].includes(item.href)) {
      return role === "ADMIN" || role === "INVENTORY_CONTROLLER";
    }
    if (item.href === "/orders") return role === "ADMIN";
    if (["/pos", "/cash-register", "/returns", "/customers"].includes(item.href)) {
      return role === "ADMIN" || role === "CASHIER_ORDERS";
    }
    if (item.href === "/financials") return role === "ADMIN";
    if (item.href === "/audit") return role === "ADMIN";
    return true;
  });

  return (
    <>
    <button
      type="button"
      aria-label={mobileOpen ? "إغلاق القائمة" : "فتح القائمة"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileMenu({ path: pathname, open: !mobileOpen })}
      className="fixed right-8 top-8 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white xl:hidden"
    >
      <span className="material-symbols-outlined">{mobileOpen ? "close" : "menu"}</span>
    </button>
    {mobileOpen && <button type="button" aria-label="إغلاق القائمة" onClick={() => setMobileMenu({ path: pathname, open: false })} className="fixed inset-0 z-50 bg-black/70 xl:hidden" />}
    <aside className={`fixed bottom-0 right-0 top-0 z-[60] w-[min(22rem,88vw)] overflow-hidden rounded-none glass shadow-xl transition-transform duration-200 xl:bottom-4 xl:right-4 xl:top-4 xl:w-64 xl:translate-x-0 xl:rounded-2xl min-[1366px]:bottom-8 min-[1366px]:right-8 min-[1366px]:top-8 min-[1366px]:w-80 ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}>
      <div ref={scrollRef} onScroll={event => { rememberedNavScrollTop = event.currentTarget.scrollTop; }} className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar" dir="ltr">
        <div className="flex min-h-full flex-col p-6" dir="rtl">
          {/* Logo & Brand */}
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/10 blur-3xl rounded-full" />
              <BrandMark />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-primary tracking-tight">مكتبة سعود الشافعي</h1>
              <p className="app-muted text-sm">{warehouseOnlyMode ? "إدارة المخازن" : "إدارة المكتبة والمبيعات"}</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col gap-y-1">
            {navGroups.map(group => {
              const items = visibleNavItems.filter(item => group.hrefs.some(href => href === item.href));
              if (!items.length) return null;
              const expanded = expandedGroup === group.id;
              return <div key={group.id} className="border-b border-current/10 pb-2 last:border-b-0">
                <button type="button" aria-expanded={expanded} aria-controls={`nav-group-${group.id}`}
                  onClick={() => setSelectedGroup({ path: pathname, group: expanded ? "" : group.id })}
                  className="app-muted flex w-full items-center justify-between rounded-xl px-3 py-2 text-right text-xs font-bold hover:bg-white/5">
                  <span>{group.label}</span><span className="material-symbols-outlined text-base" aria-hidden="true">{expanded ? "expand_less" : "expand_more"}</span>
                </button>
                {expanded && <div id={`nav-group-${group.id}`} className="flex flex-col gap-y-1">{items.map(item => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return <Link key={item.href} href={item.href} onClick={() => setMobileMenu({ path: pathname, open: false })} aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-bold transition-colors ${isActive ? "bg-primary text-white" : "text-[#e2bfb0] hover:bg-white/5"}`}>
                    <span className="material-symbols-outlined" aria-hidden="true" style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>{item.icon}</span>
                    <span>{warehouseOnlyMode && item.href === "/stock-operations" ? "الجرد" : item.label}</span>
                  </Link>;
                })}</div>}
              </div>;
            })}
          </nav>

          {/* Footer */}
          <div className="mt-auto pt-6 flex flex-col gap-4">
            {user?.role === "ADMIN" && <Link
              href="/settings"
              onClick={() => setMobileMenu({ path: pathname, open: false })}
              className={`flex items-center gap-4 rounded-full px-4 py-3 transition-all font-bold ${
                pathname === "/settings"
                  ? "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98]"
                  : "text-[#e2bfb0] hover:bg-white/5 hover:-translate-x-1"
              }`}
            >
              <span className="material-symbols-outlined">settings</span>
              <span>الإعدادات</span>
            </Link>}

          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
