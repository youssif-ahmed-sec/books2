"use client";

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';

const navigation = [
  { name: 'لوحة التحكم', href: '/dashboard', icon: 'dashboard' },
  { name: 'المنتجات', href: '/products', icon: 'category' },
  { name: 'المخزون', href: '/inventory', icon: 'inventory_2' },
  { name: 'نقطة البيع', href: '/pos', icon: 'point_of_sale' },
  { name: 'الطلبات', href: '/orders', icon: 'shopping_cart' },
  { name: 'العملاء', href: '/customers', icon: 'group' },
  { name: 'التقارير', href: '/reports', icon: 'analytics' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, role, isLoading, initialize, signOut } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };

  const getPageTitle = () => {
    const nav = navigation.find(n => pathname?.startsWith(n.href));
    return nav ? nav.name : 'مكتبة سعود الشافعي';
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface overflow-x-hidden selection:bg-primary/30" dir="rtl">

      {/* SideNavBar */}
      <aside className="fixed top-8 right-8 bottom-8 w-80 rounded-2xl glass shadow-xl z-50 flex flex-col p-8 rtl overflow-hidden">
        <div className="mb-12 flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 blur-3xl rounded-full"></div>
            <img
              alt="Bookstore Logo"
              className="w-20 h-20 rounded-2xl relative object-contain bg-surface-container-high p-3 border border-white/5"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCsAr2ME7HLBHZ_z3mPFL-g3Y20I_50Jz-1q88-0bwn5SmlBnn4FcUtss84_n9uZT9hDPG4hrGYob9MMoI0QJNAg_oa1DOtnw5Q9VZ1RpeLBDTPArRpxxVNM8sewINmX3_zoLjfhLp28ks8nsqoTbONEuHcOaeQixzCshapd_tqcy9lX7AbEme5jJxtacDkJeEXF8ENBHykjWCjNbNo8I4EOECEwuMWdTbl-H7TxL9Hgn-H7SB5Szov"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary tracking-tight">مكتبة سعود الشافعي</h1>
            <p className="text-sm text-on-surface-variant/70">نظام الإدارة المتكامل</p>
          </div>
        </div>

        <nav className="flex-1 flex flex-col gap-y-2">
          {navigation.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={isActive ?
                  "flex items-center gap-4 p-4 rounded-full bg-primary text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98]" :
                  "flex items-center gap-4 p-4 rounded-full text-on-surface-variant hover:bg-white/5 transition-all hover:translate-x-[-4px]"
                }
              >
                <span className="material-symbols-outlined" style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}>
                  {item.icon}
                </span>
                <span className="font-bold">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6 flex flex-col gap-4">
          <Link href="/settings" className="flex items-center gap-4 p-4 rounded-full text-on-surface-variant hover:bg-white/5 transition-all">
            <span className="material-symbols-outlined">settings</span>
            <span className="font-bold">الإعدادات</span>
          </Link>
          <div className="flex items-center gap-4 p-3 glass rounded-full border border-white/5 cursor-pointer hover:bg-white/5 transition-all" onClick={handleLogout}>
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-sm">
              {user.email?.substring(0, 2).toUpperCase() || 'MS'}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">مدير النظام</p>
              <p className="text-[10px] text-on-surface-variant/60 truncate" dir="ltr">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* TopNavBar */}
      <header className="fixed top-8 left-8 right-[364px] h-20 glass rounded-full z-40 flex items-center justify-between px-10 rtl transition-all">
        <div className="flex items-center gap-12 flex-1">
          <h2 className="text-xl font-bold text-primary whitespace-nowrap">{getPageTitle()}</h2>
          <div className="relative w-full max-w-lg">
            <span className="material-symbols-outlined absolute right-5 top-1/2 -translate-y-1/2 text-on-surface-variant/60">search</span>
            <input
              className="w-full bg-surface-container-low/40 border border-white/5 rounded-full py-2.5 pr-14 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-container transition-all"
              placeholder="بحث سريع عن صنف أو باركود..."
              type="text"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="w-11 h-11 flex items-center justify-center rounded-full glass hover:bg-white/10 transition-all text-on-surface-variant relative">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-primary rounded-full border-2 border-surface"></span>
          </button>
          <button className="w-11 h-11 flex items-center justify-center rounded-full glass hover:bg-white/10 transition-all text-on-surface-variant">
            <span className="material-symbols-outlined">account_circle</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mr-[364px] ml-8 pt-40 pb-16 space-y-10">
        {children}
      </main>

    </div>
  );
}
