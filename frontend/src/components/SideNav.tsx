"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cachedCurrentUser, getCurrentUser } from "@/lib/currentUser";
import { errorMessage } from "@/lib/errors";
import BrandMark from "./BrandMark";
import { warehouseOnlyMode } from "@/lib/warehouseMode";
import { useBadgeCounts } from "@/lib/badgeCounts";

// Desktop Inventory sections (placed below approvals as standalone direct buttons)
const inventoryNavItems = [
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/offers", icon: "sell", label: "العروض", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", roles: ["ADMIN"] },
  { href: "/audit", icon: "history", label: "سجل التدقيق", roles: ["ADMIN"] },
];

// Mobile flat navigation: Parent wrappers removed, all actual sub-pages listed directly
const mobileNavItems = [
  // ما بداخل الإدارة والتقارير
  { href: "/dashboard", icon: "dashboard", label: "لوحة التحكم", roles: ["ADMIN"] },
  { href: "/financials", icon: "account_balance_wallet", label: "المالية", roles: ["ADMIN"] },
  { href: "/reports", icon: "analytics", label: "التقارير", roles: ["ADMIN"] },

  // ما بداخل المبيعات والصندوق
  { href: "/pos", icon: "point_of_sale", label: "نقطة البيع", roles: ["ADMIN", "CASHIER_ORDERS"] },
  { href: "/cash-register", icon: "payments", label: "الصندوق", roles: ["ADMIN", "CASHIER_ORDERS"] },
  { href: "/orders", icon: "receipt_long", label: "الفواتير", roles: ["ADMIN"] },
  { href: "/returns", icon: "assignment_return", label: "المرتجعات", roles: ["ADMIN", "CASHIER_ORDERS"] },

  // العملاء
  { href: "/customers", icon: "group", label: "العملاء", roles: ["ADMIN", "CASHIER_ORDERS"] },

  // ما بداخل المشتريات والرقابة
  { href: "/purchases", icon: "receipt_long", label: "المشتريات", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/product-approvals", icon: "rule", label: "طلبات المنتجات", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/count-approvals", icon: "fact_check", label: "موافقات الجرد", roles: ["ADMIN"] },

  // أقسام المخزون
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/stock-operations", icon: "swap_horiz", label: "النقل والجرد", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/categories", icon: "category", label: "التصنيفات والعلامات", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/offers", icon: "sell", label: "العروض", roles: ["ADMIN", "INVENTORY_CONTROLLER"] },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", roles: ["ADMIN"] },
  { href: "/audit", icon: "history", label: "سجل التدقيق", roles: ["ADMIN"] },
];

let rememberedNavScrollTop = 0;

export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<{ email: string | null; username?: string | null; role: string } | null>(() => cachedCurrentUser());
  const [mobileMenu, setMobileMenu] = useState({ path: pathname, open: false });
  const mobileOpen = mobileMenu.path === pathname && mobileMenu.open;
  const scrollRef = useRef<HTMLDivElement>(null);
  const badgeCounts = useBadgeCounts();

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

  const canAccess = (roles?: string[]) => {
    if (!roles) return true;
    return !!user && roles.includes(user.role);
  };

  const renderNavLink = (item: { href: string; icon: string; label: string; filled?: boolean; roles?: string[] }, isSubItem = false) => {
    if (item.roles && !canAccess(item.roles)) return null;

    if (warehouseOnlyMode && !["/inventory", "/stock-operations", "/product-approvals", "/suppliers", "/purchases", "/categories", "/offers", "/audit"].includes(item.href)) {
      return null;
    }

    const isApprovals = item.href === "/purchases" || item.href === "/product-approvals";
    const isManagement = item.href === "/dashboard";
    const isSales = item.href === "/pos";
    const isInventory = item.href === "/inventory";

    const isActive = isSubItem
      ? (pathname === item.href || pathname.startsWith(`${item.href}/`))
      : isApprovals
      ? ["/purchases", "/product-approvals", "/count-approvals", "/approvals"].some(h => pathname === h || pathname.startsWith(`${h}/`))
      : isManagement
      ? ["/dashboard", "/financials", "/reports", "/management"].some(h => pathname === h || pathname.startsWith(`${h}/`))
      : isSales
      ? ["/pos", "/cash-register", "/orders", "/returns", "/sales"].some(h => pathname === h || pathname.startsWith(`${h}/`))
      : isInventory
      ? ["/inventory", "/stock-operations", "/categories", "/audit"].some(h => pathname === h || pathname.startsWith(`${h}/`))
      : (pathname === item.href || pathname.startsWith(`${item.href}/`));

    const count = item.href === "/purchases"
      ? badgeCounts.purchases + (isSubItem ? 0 : badgeCounts.product_approvals)
      : item.href === "/product-approvals"
      ? badgeCounts.product_approvals
      : 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileMenu({ path: pathname, open: false })}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-bold transition-colors ${
          isActive ? "bg-primary text-white shadow-md shadow-primary/20" : "text-[#e2bfb0] hover:bg-white/5"
        }`}
      >
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {item.icon}
        </span>
        <span>{warehouseOnlyMode && item.href === "/stock-operations" ? "الجرد" : item.label}</span>
        {count > 0 && (
          <span
            className={`mr-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
              isActive ? "bg-white text-primary" : "bg-primary text-white shadow-sm"
            }`}
          >
            {count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile Drawer Trigger Button */}
      <button
        type="button"
        aria-label={mobileOpen ? "إغلاق القائمة" : "فتح القائمة"}
        aria-expanded={mobileOpen}
        onClick={() => setMobileMenu({ path: pathname, open: !mobileOpen })}
        className="fixed right-8 top-8 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white xl:hidden shadow-lg"
      >
        <span className="material-symbols-outlined">{mobileOpen ? "close" : "menu"}</span>
      </button>

      {/* Mobile Backdrop Overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة"
          onClick={() => setMobileMenu({ path: pathname, open: false })}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm xl:hidden transition-opacity"
        />
      )}

      {/* Side Navigation Drawer */}
      <aside
        className={`app-side-nav fixed bottom-0 right-0 top-0 z-[60] w-[min(22rem,88vw)] overflow-hidden rounded-none transition-transform duration-200 xl:bottom-4 xl:right-4 xl:top-4 xl:w-72 xl:translate-x-0 xl:rounded-2xl ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div
          ref={scrollRef}
          onScroll={(event) => {
            rememberedNavScrollTop = event.currentTarget.scrollTop;
          }}
          className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar"
          dir="ltr"
        >
          <div className="flex min-h-full flex-col p-6" dir="rtl">
            {/* Logo & Brand Header */}
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

            {/* Navigation Body */}
            <nav className="flex flex-1 flex-col gap-y-1">
              {/* ─────────────────── DESKTOP NAVIGATION (xl:flex) ─────────────────── */}
              {/* Top-level direct buttons with sub-tabs in TopNav */}
              <div className="hidden xl:flex flex-col gap-y-1">
                {user?.role !== "ADMIN" && mobileNavItems.map((item) => renderNavLink(item, true))}
                {user?.role === "ADMIN" && <>
                {/* 1. الإدارة والتقارير */}
                {renderNavLink({ href: "/dashboard", icon: "dashboard", label: "الإدارة والتقارير" })}

                {/* 2. المبيعات والصندوق */}
                {renderNavLink({ href: "/pos", icon: "point_of_sale", label: "المبيعات والصندوق" })}

                {/* 3. العملاء */}
                {renderNavLink({ href: "/customers", icon: "group", label: "العملاء" })}

                {/* 4. المشتريات والرقابة */}
                {renderNavLink({ href: "/purchases", icon: "fact_check", label: "المشتريات والرقابة" })}

                {/* 5. أقسام المخزون (مباشرة بالأسفل بعد المشتريات والرقابة) */}
                {inventoryNavItems.map((item) => renderNavLink(item, false))}
                </>}
              </div>

              {/* ─────────────────── MOBILE NAVIGATION (xl:hidden) ─────────────────── */}
              {/* Pure flat list of all actual pages without parent group headers */}
              <div className="flex xl:hidden flex-col gap-y-1">
                {mobileNavItems.map((item) => renderNavLink(item, true))}
              </div>
            </nav>

            {/* Footer: Settings */}
            <div className="mt-auto pt-6 flex flex-col gap-4">
              {user?.role === "ADMIN" && (
                <Link
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
                </Link>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
