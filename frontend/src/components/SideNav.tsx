"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import BrandMark from "./BrandMark";

const navItems = [
  { href: "/dashboard", icon: "dashboard", label: "لوحة التحكم", disabled: false },
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, disabled: false },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", disabled: false },
  { href: "/categories", icon: "category", label: "التصنيفات", disabled: false },
  { href: "/pos", icon: "point_of_sale", label: "نقطة البيع", disabled: false },
  { href: "/orders", icon: "shopping_cart", label: "الطلبات", disabled: false },
  { href: "/inbox", icon: "inbox", label: "متابعة الطلبات", disabled: false },
  { href: "/customers", icon: "group", label: "العملاء", disabled: false },
  { href: "/financials", icon: "account_balance_wallet", label: "المالية", disabled: false },
  { href: "/reports", icon: "analytics", label: "التقارير", disabled: false },
];

export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const userData = await fetchApi("/auth/me");
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
    const role = user?.role;
    if (!role) return false;
    if (item.href === "/dashboard") {
      return role === "ADMIN";
    }
    if (item.href === "/reports") {
      return role === "ADMIN";
    }
    if (["/inventory", "/suppliers", "/categories"].includes(item.href)) {
      return role === "ADMIN" || role === "INVENTORY_CONTROLLER";
    }
    if (["/pos", "/orders", "/inbox"].includes(item.href)) {
      return role === "ADMIN" || role === "CASHIER_ORDERS";
    }
    if (item.href === "/financials") return role === "ADMIN";
    return true;
  });

  return (
    <>
    <button
      type="button"
      aria-label={mobileOpen ? "إغلاق القائمة" : "فتح القائمة"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen(!mobileOpen)}
      className="fixed right-8 top-8 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white lg:hidden"
    >
      <span className="material-symbols-outlined">{mobileOpen ? "close" : "menu"}</span>
    </button>
    {mobileOpen && <button type="button" aria-label="إغلاق القائمة" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-50 bg-black/70 lg:hidden" />}
    <aside className={`fixed bottom-0 right-0 top-0 z-[60] w-[min(22rem,88vw)] overflow-hidden rounded-none glass shadow-xl transition-transform duration-200 lg:bottom-8 lg:right-8 lg:top-8 lg:w-80 lg:translate-x-0 lg:rounded-2xl ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}>
      <div className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar" dir="ltr">
        <div className="flex flex-col p-8 min-h-full" dir="rtl">
          {/* Logo & Brand */}
          <div className="mb-12 flex flex-col items-center gap-4 text-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/10 blur-3xl rounded-full" />
              <BrandMark />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-primary tracking-tight">مكتبة سعود الشافعي</h1>
              <p className="text-sm text-[#e2bfb0]/70">إدارة المكتبة والمبيعات</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 flex flex-col gap-y-2">
            {visibleNavItems.map((item) => {
              const isActive = pathname === item.href;
              const Wrapper = Link;
              return (
                <Wrapper
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-4 p-4 rounded-full transition-all font-bold ${
                    isActive
                      ? "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98]"
                      : item.disabled
                      ? "text-[#e2bfb0]/30 cursor-not-allowed"
                      : "text-[#e2bfb0] hover:bg-white/5 hover:-translate-x-1"
                  }`}
                >
                  <span
                    className="material-symbols-outlined"
                    style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Wrapper>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="mt-auto pt-6 flex flex-col gap-4">
            {user?.role === "ADMIN" && <Link
              href="/settings"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-4 p-4 rounded-full transition-all font-bold ${
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
