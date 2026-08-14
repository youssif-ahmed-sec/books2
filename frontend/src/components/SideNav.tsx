"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";

const navItems = [
  { href: "/", icon: "dashboard", label: "لوحة التحكم", disabled: false },
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, disabled: false },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", disabled: false },
  { href: "/categories", icon: "category", label: "التصنيفات", disabled: false },
  { href: "/pos", icon: "point_of_sale", label: "نقطة البيع", disabled: false },
  { href: "/orders", icon: "shopping_cart", label: "الطلبات", disabled: true },
  { href: "/customers", icon: "group", label: "العملاء", disabled: true },
  { href: "/reports", icon: "analytics", label: "التقارير", disabled: true },
];

export default function SideNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed top-8 right-8 bottom-8 w-80 rounded-2xl glass shadow-xl z-50 overflow-hidden">
      <div className="h-full w-full overflow-y-auto overflow-x-hidden custom-scrollbar" dir="ltr">
        <div className="flex flex-col p-8 min-h-full" dir="rtl">
          {/* Logo & Brand */}
          <div className="mb-12 flex flex-col items-center gap-4 text-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/10 blur-3xl rounded-full" />
              <div className="w-20 h-20 rounded-2xl relative bg-[#2a2a2a] p-3 border border-white/5 flex items-center justify-center overflow-hidden">
                <Image
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuCsAr2ME7HLBHZ_z3mPFL-g3Y20I_50Jz-1q88-0bwn5SmlBnn4FcUtss84_n9uZT9hDPG4hrGYob9MMoI0QJNAg_oa1DOtnw5Q9VZ1RpeLBDTPArRpxxVNM8sewINmX3_zoLjfhLp28ks8nsqoTbONEuHcOaeQixzCshapd_tqcy9lX7AbEme5jJxtacDkJeEXF8ENBHykjWCjNbNo8I4EOECEwuMWdTbl-H7TxL9Hgn-H7SB5Szov"
                  alt="Bookstore Logo"
                  width={80}
                  height={80}
                  className="object-contain"
                  unoptimized
                />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-primary tracking-tight">مكتبة سعود الشافعي</h1>
              <p className="text-sm text-[#e2bfb0]/70">نظام الإدارة المتكامل</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 flex flex-col gap-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Wrapper = item.disabled ? "div" : Link;
              return (
                <Wrapper
                  key={item.href}
                  href={(item.disabled ? "" : item.href) as any}
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
            <div
              className="flex items-center gap-4 p-4 rounded-full text-[#e2bfb0]/30 cursor-not-allowed transition-all"
            >
              <span className="material-symbols-outlined">settings</span>
              <span className="font-bold">الإعدادات</span>
            </div>
            <div className="flex items-center gap-4 p-3 glass rounded-full border border-white/5">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                MS
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold truncate">مدير النظام</p>
                <p className="text-[10px] text-[#e2bfb0]/60 truncate">admin@future-stationery.com</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
