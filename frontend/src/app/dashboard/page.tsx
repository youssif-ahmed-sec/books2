"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import AdminGate from "@/components/AdminGate";

export default function DashboardPage() {
  return <AdminGate><DashboardContent /></AdminGate>;
}

function DashboardContent() {
  const [data, setData] = useState<{
    total_revenue: number;
    total_orders: number;
    pending_orders: number;
    total_products: number;
  } | null>(null);
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
      <main className="app-main">
        <div className="space-y-6">
          <div>
            <h1 className="app-heading">لوحة التحكم</h1>
            <p className="app-subtitle">ملخص الطلبات والمبيعات والمنتجات</p>
          </div>

          {isLoading ? (
            <div className="app-panel app-muted p-8">جاري تحميل الملخص...</div>
          ) : data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="app-panel p-8">
                <h3 className="app-muted text-sm font-bold">إجمالي المبيعات المحصلة</h3>
                <p className="mt-3 text-3xl font-black text-primary">{Number(data.total_revenue).toLocaleString("en-US")} <span className="text-sm">ج.م</span></p>
              </div>
              
              <div className="app-panel p-8">
                <h3 className="app-muted text-sm font-bold">إجمالي الطلبات</h3>
                <p className="mt-3 text-3xl font-black text-white">{data.total_orders.toLocaleString("en-US")}</p>
              </div>

              <div className="app-panel p-8">
                <h3 className="app-muted text-sm font-bold">الطلبات المعلقة</h3>
                <p className="mt-3 text-3xl font-black text-primary">{data.pending_orders.toLocaleString("en-US")}</p>
              </div>

              <div className="app-panel p-8">
                <h3 className="app-muted text-sm font-bold">إجمالي المنتجات</h3>
                <p className="mt-3 text-3xl font-black text-white">{data.total_products.toLocaleString("en-US")}</p>
              </div>
            </div>
          ) : (
            <div className="app-panel p-8 text-[#ffb4ab]">تعذر تحميل الملخص. حاول تحديث الصفحة.</div>
          )}
        </div>
      </main>
    </div>
  );
}
