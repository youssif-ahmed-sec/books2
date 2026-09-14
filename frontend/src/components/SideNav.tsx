"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";
import { fetchApi } from "@/lib/api";

const navItems = [
  { href: "/dashboard", icon: "dashboard", label: "لوحة التحكم", disabled: false },
  { href: "/inventory", icon: "inventory_2", label: "المخزون", filled: true, disabled: false },
  { href: "/suppliers", icon: "local_shipping", label: "الموردين", disabled: false },
  { href: "/categories", icon: "category", label: "التصنيفات", disabled: false },
  { href: "/pos", icon: "point_of_sale", label: "نقطة البيع", disabled: false },
  { href: "/orders", icon: "shopping_cart", label: "الطلبات", disabled: false },
  { href: "/inbox", icon: "inbox", label: "البريد الوارد (أومني)", disabled: false },
  { href: "/customers", icon: "group", label: "العملاء", disabled: false },
  { href: "/financials", icon: "account_balance_wallet", label: "المالية", disabled: false },
  { href: "/reports", icon: "analytics", label: "التقارير", disabled: false },
];

export default function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadUser() {
      try {
        const userData = await fetchApi("/auth/me");
        setUser(userData);
      } catch (err: any) {
        if (err.message?.includes("401") || err.message?.includes("Unauthorized")) {
          localStorage.removeItem("access_token");
          router.push("/login");
        }
      }
    }
    loadUser();

    // Close dropdown on click outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    router.push("/login");
  };

  const getInitials = (email: string) => {
    if (!email) return "U";
    return email.substring(0, 2).toUpperCase();
  };

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
            <Link
              href="/settings"
              className={`flex items-center gap-4 p-4 rounded-full transition-all font-bold ${
                pathname === "/settings"
                  ? "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98]"
                  : "text-[#e2bfb0] hover:bg-white/5 hover:-translate-x-1"
              }`}
            >
              <span className="material-symbols-outlined">settings</span>
              <span>الإعدادات</span>
            </Link>
            
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowDropdown(!showDropdown)}
                className="w-full flex items-center gap-4 p-3 glass rounded-full border border-white/5 hover:bg-white/5 transition-all text-right"
              >
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm flex-shrink-0 uppercase">
                  {user ? getInitials(user.email) : "?"}
                </div>
                <div className="overflow-hidden flex-1">
                  <p className="text-xs font-bold truncate text-white">
                    {user?.role === "ADMIN" ? "مدير النظام" : user?.role || "مستخدم"}
                  </p>
                  <p className="text-[10px] text-[#e2bfb0]/60 truncate" dir="ltr">{user?.email || "جاري التحميل..."}</p>
                </div>
                <span className="material-symbols-outlined text-[#e2bfb0]/50 text-sm">
                  {showDropdown ? "expand_less" : "expand_more"}
                </span>
              </button>

              {showDropdown && (
                <div className="absolute bottom-[110%] left-0 right-0 glass border border-white/10 rounded-2xl p-2 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-2">
                  <button 
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-all font-bold text-sm"
                  >
                    <span className="material-symbols-outlined text-lg">logout</span>
                    تسجيل الخروج
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
