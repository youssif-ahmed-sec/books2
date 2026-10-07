"use client";

import { useState, useEffect } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { roleHome } from "@/lib/roleHome";
import { orderSourceLabels, orderStatusLabels } from "@/lib/orderLabels";

interface SalesReport {
  metrics: { total_revenue: number; completed_orders: number; total_orders: number };
  data: { id: string; customer_name?: string; source: string; status: string; final_total: number; created_at: string }[];
}

interface InventoryReportRow {
  id: string;
  quantity_changed: number;
  transaction_type: string;
  reference_document?: string;
  notes?: string;
  created_at: string;
}

export default function ReportsPage() {
  const [role, setRole] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"sales" | "inventory">("sales");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  const [salesData, setSalesData] = useState<SalesReport | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchApi("/auth/me").then(user => {
      if (user.role === "ADMIN") {
        setRole(user.role);
      }
      else window.location.href = roleHome(user.role);
    }).catch(() => setRole(null));
  }, []);

  useEffect(() => {
    if (!role) return;
    const queryParams = new URLSearchParams();
    if (startDate) queryParams.append("start_date", new Date(startDate).toISOString());
    if (endDate) queryParams.append("end_date", new Date(endDate).toISOString());
    let active = true;
    const endpoint = activeTab === "sales" ? "/reports/sales" : "/reports/inventory";
    fetchApi(`${endpoint}?${queryParams.toString()}`)
      .then(res => {
        if (!active) return;
        if (activeTab === "sales") setSalesData(res);
        else setInventoryData(res);
      })
      .catch(console.error)
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [role, activeTab, startDate, endDate]);

  if (!role) return null;

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="التقارير" />
      <main className="app-main">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="app-heading">التقارير</h1>
              <p className="app-subtitle">المبيعات وحركات المخزون</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="app-muted block text-xs mb-1">من تاريخ</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setIsLoading(true); }}
                  className="app-field text-sm"
                />
              </div>
              <div>
                <label className="app-muted block text-xs mb-1">إلى تاريخ</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setIsLoading(true); }}
                  className="app-field text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-4 border-b border-white/10">
            {role === "ADMIN" && <button
              onClick={() => { setActiveTab("sales"); setIsLoading(true); }}
              className={`pb-4 px-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "sales"
                  ? "border-primary text-primary"
                  : "border-transparent app-muted hover:text-white"
              }`}
            >
              تقرير المبيعات
            </button>}
            <button
              onClick={() => { setActiveTab("inventory"); setIsLoading(true); }}
              className={`pb-4 px-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "inventory"
                  ? "border-primary text-primary"
                  : "border-transparent app-muted hover:text-white"
              }`}
            >
              حركات المخزون
            </button>
          </div>

          {isLoading ? (
            <div className="app-panel app-muted py-10 text-center">جاري التحميل...</div>
          ) : activeTab === "sales" && salesData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="app-panel p-8">
                  <h3 className="app-muted text-sm font-bold">إجمالي المبيعات</h3>
                  <p className="text-3xl font-black text-primary mt-2">{Number(salesData.metrics.total_revenue).toLocaleString("ar-EG")} <span className="text-sm">ج.م</span></p>
                </div>
                <div className="app-panel p-8">
                  <h3 className="app-muted text-sm font-bold">الطلبات المكتملة</h3>
                  <p className="text-3xl font-black text-white mt-2">{salesData.metrics.completed_orders}</p>
                </div>
                <div className="app-panel p-8">
                  <h3 className="app-muted text-sm font-bold">إجمالي الطلبات بكل الحالات</h3>
                  <p className="text-3xl font-black text-white mt-2">{salesData.metrics.total_orders}</p>
                </div>
              </div>
              
              <div className="app-panel overflow-x-auto">
                <table className="w-full text-sm text-right text-[#e5e2e1]">
                  <thead className="app-table-head text-xs">
                    <tr>
                      <th className="px-6 py-4 font-medium">رقم الطلب</th>
                      <th className="px-6 py-4 font-medium">العميل</th>
                      <th className="px-6 py-4 font-medium">المصدر</th>
                      <th className="px-6 py-4 font-medium">الحالة</th>
                      <th className="px-6 py-4 font-medium">الإجمالي</th>
                      <th className="px-6 py-4 font-medium">تاريخ الإنشاء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesData.data.map(order => (
                      <tr key={order.id} className="app-table-row">
                        <td className="px-6 py-4 font-medium text-white">{order.id.split("-")[0]}</td>
                        <td className="px-6 py-4">{order.customer_name || "غير محدد"}</td>
                        <td className="px-6 py-4">{orderSourceLabels[order.source] || order.source}</td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-full text-xs">{orderStatusLabels[order.status] || order.status}</span>
                        </td>
                        <td className="px-6 py-4 font-bold text-primary">{Number(order.final_total).toLocaleString("ar-EG")} ج.م</td>
                        <td className="px-6 py-4">{new Date(order.created_at).toLocaleDateString("ar-EG")}</td>
                      </tr>
                    ))}
                    {salesData.data.length === 0 && (
                      <tr>
                        <td colSpan={6} className="app-muted px-6 py-8 text-center">لا توجد بيانات لهذه الفترة</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === "inventory" && inventoryData ? (
            <div className="app-panel overflow-x-auto">
              <table className="w-full text-sm text-right text-[#e5e2e1]">
                <thead className="app-table-head text-xs">
                  <tr>
                    <th className="px-6 py-4 font-medium">نوع الحركة</th>
                    <th className="px-6 py-4 font-medium">تغير الكمية</th>
                    <th className="px-6 py-4 font-medium">المصدر (رقم مرجعي)</th>
                    <th className="px-6 py-4 font-medium">ملاحظات</th>
                    <th className="px-6 py-4 font-medium">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryData.map(tx => (
                    <tr key={tx.id} className="app-table-row">
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs ${
                          tx.quantity_changed > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                        }`}>
                          {tx.transaction_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold" dir="ltr">
                        {tx.quantity_changed > 0 ? `+${tx.quantity_changed}` : tx.quantity_changed}
                      </td>
                      <td className="px-6 py-4">{tx.reference_document || "-"}</td>
                      <td className="px-6 py-4">{tx.notes || "-"}</td>
                      <td className="px-6 py-4">{new Date(tx.created_at).toLocaleString("ar-EG")}</td>
                    </tr>
                  ))}
                  {inventoryData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="app-muted px-6 py-8 text-center">لا توجد حركات مخزون لهذه الفترة</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
