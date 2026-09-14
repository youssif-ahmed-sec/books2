"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      setIsLoading(true);
      try {
        const metrics = await fetchApi("/dashboards/management");
        setData(metrics);
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadDashboard();
  }, []);

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="لوحة القيادة" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">لوحة القيادة (Dashboard)</h1>
            <p className="text-sm text-zinc-400 mt-1">نظرة عامة على أداء المتجر والمبيعات</p>
          </div>

          {isLoading ? (
            <div className="text-zinc-400">جاري التحميل...</div>
          ) : data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-zinc-400 text-sm font-medium">إجمالي المبيعات (المحصلة)</h3>
                <p className="text-3xl font-bold text-white mt-2">{data.total_revenue} ر.س</p>
              </div>
              
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-zinc-400 text-sm font-medium">إجمالي الطلبات</h3>
                <p className="text-3xl font-bold text-white mt-2">{data.total_orders}</p>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-zinc-400 text-sm font-medium">الطلبات المعلقة</h3>
                <p className="text-3xl font-bold text-orange-400 mt-2">{data.pending_orders}</p>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-zinc-400 text-sm font-medium">إجمالي المنتجات</h3>
                <p className="text-3xl font-bold text-blue-400 mt-2">{data.total_products}</p>
              </div>
            </div>
          ) : (
            <div className="text-red-500">فشل في تحميل البيانات</div>
          )}
        </div>
      </main>
    </div>
  );
}
