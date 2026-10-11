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
    today_sales: number;
    monthly_sales: number;
    gross_profit: number | null;
    net_profit: number | null;
    cash_movement: number;
    open_drawer_cash: number;
    customer_debt: number;
    low_stock_count: number;
    out_of_stock_count: number;
    stock_alerts: { product_id: string; name: string; stock: number; minimum: number; severity: string }[];
    top_products: { id: string; name: string; net_sales: number }[];
    top_categories: { id: string; name: string; net_sales: number }[];
    top_customers: { id: string; name: string; net_sales: number }[];
    sales_by_source: Record<string, number>;
    new_customers: number;
    returning_customers: number;
    delayed_orders: { id: string; hours: number }[];
    suppliers: { id: string; name: string; balance: number | null; statement_incomplete: boolean; orders: number; received_orders: number }[];
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
            <div className="space-y-6"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
              {[{ label: "مبيعات اليوم", value: data.today_sales }, { label: "مبيعات الشهر", value: data.monthly_sales }, { label: "مجمل الربح", value: data.gross_profit }, { label: "صافي الربح", value: data.net_profit }, { label: "حركة النقدية المسجلة", value: data.cash_movement }, { label: "نقدية الورديات المفتوحة", value: data.open_drawer_cash }, { label: "مديونية العملاء", value: data.customer_debt }].map(card => <div key={card.label} className="app-panel p-8"><h3 className="app-muted text-sm font-bold">{card.label}</h3><p className="mt-3 text-2xl font-black text-primary">{card.value === null ? "غير مكتمل للبيانات القديمة" : `${Number(card.value).toFixed(2)} ج.م`}</p></div>)}
              <div className="app-panel p-8"><h3 className="app-muted text-sm font-bold">تنبيهات المخزون</h3><p className="mt-3 text-2xl font-black text-primary">منخفض {data.low_stock_count} / نافد {data.out_of_stock_count}</p></div>
            </div><div className="app-panel p-6"><h2 className="font-bold mb-3">أصناف تحتاج إعادة طلب</h2>{data.stock_alerts.length ? data.stock_alerts.map(alert => <p key={alert.product_id} className="border-b border-white/10 py-2">{alert.name} — رصيد {alert.stock} / حد أدنى {alert.minimum}</p>) : <p className="app-muted">لا توجد تنبيهات حاليًا.</p>}</div>
              <div className="grid md:grid-cols-3 gap-4">{[{ title: "أعلى المنتجات", rows: data.top_products }, { title: "أعلى التصنيفات", rows: data.top_categories }, { title: "أعلى العملاء", rows: data.top_customers }].map(group => <section key={group.title} className="app-panel p-6"><h2 className="font-bold mb-3">{group.title}</h2>{group.rows.map(row => <p key={row.id} className="border-b border-white/10 py-2 text-sm">{row.name} — {row.net_sales.toFixed(2)} ج.م</p>)}</section>)}</div>
              <section className="app-panel p-6 grid md:grid-cols-3 gap-4"><div>عملاء جدد اليوم: <strong>{data.new_customers}</strong></div><div>عملاء متكررون: <strong>{data.returning_customers}</strong></div><div>طلبات تأخر تجهيزها: <strong>{data.delayed_orders.length}</strong>{data.delayed_orders.map(order => <p key={order.id} className="text-sm">#{order.id.slice(0, 8)} — {order.hours} ساعة</p>)}</div></section>
              <div className="grid md:grid-cols-2 gap-4"><section className="app-panel p-6"><h2 className="font-bold mb-3">المبيعات حسب المصدر</h2>{Object.entries(data.sales_by_source).map(([source, value]) => <p key={source} className="py-2 border-b border-white/10">{source}: {Number(value).toFixed(2)} ج.م</p>)}</section><section className="app-panel p-6"><h2 className="font-bold mb-3">الموردون والأرصدة</h2>{data.suppliers.map(supplier => <p key={supplier.id} className="py-2 border-b border-white/10">{supplier.name} — {supplier.balance === null ? "الرصيد غير مكتمل للبيانات القديمة" : `${supplier.balance.toFixed(2)} ج.م`} — طلبات مستلمة {supplier.received_orders}/{supplier.orders}</p>)}</section></div>
            </div>
          ) : (
            <div className="app-panel p-8 text-[#ffb4ab]">تعذر تحميل الملخص. حاول تحديث الصفحة.</div>
          )}
        </div>
      </main>
    </div>
  );
}
