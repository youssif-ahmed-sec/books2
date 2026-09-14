"use client";

import { useState, useEffect } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<"sales" | "inventory">("sales");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  
  const [salesData, setSalesData] = useState<any>(null);
  const [inventoryData, setInventoryData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [activeTab, startDate, endDate]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.append("start_date", new Date(startDate).toISOString());
      if (endDate) queryParams.append("end_date", new Date(endDate).toISOString());

      if (activeTab === "sales") {
        const res = await fetchApi(`/reports/sales?${queryParams.toString()}`);
        setSalesData(res);
      } else {
        const res = await fetchApi(`/reports/inventory?${queryParams.toString()}`);
        setInventoryData(res);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="التقارير" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">التقارير الشاملة</h1>
              <p className="text-sm text-zinc-400 mt-1">تقارير المبيعات وحركات المخزون</p>
            </div>
            <div className="flex gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">من تاريخ</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">إلى تاريخ</label>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          </div>

          <div className="flex space-x-4 border-b border-zinc-800 rtl:space-x-reverse">
            <button
              onClick={() => setActiveTab("sales")}
              className={`pb-4 px-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "sales"
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              تقرير المبيعات
            </button>
            <button
              onClick={() => setActiveTab("inventory")}
              className={`pb-4 px-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "inventory"
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              حركات المخزون
            </button>
          </div>

          {isLoading ? (
            <div className="text-zinc-400 py-10 text-center">جاري التحميل...</div>
          ) : activeTab === "sales" && salesData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-zinc-400 text-sm font-medium">إجمالي المبيعات</h3>
                  <p className="text-3xl font-bold text-emerald-400 mt-2">{salesData.metrics.total_revenue} ر.س</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-zinc-400 text-sm font-medium">الطلبات المكتملة</h3>
                  <p className="text-3xl font-bold text-white mt-2">{salesData.metrics.completed_orders}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-zinc-400 text-sm font-medium">إجمالي الطلبات (بكل الحالات)</h3>
                  <p className="text-3xl font-bold text-white mt-2">{salesData.metrics.total_orders}</p>
                </div>
              </div>
              
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm text-right text-zinc-300">
                  <thead className="text-xs text-zinc-400 bg-zinc-800/50 uppercase">
                    <tr>
                      <th className="px-6 py-4 font-medium">رقم الطلب</th>
                      <th className="px-6 py-4 font-medium">العميل</th>
                      <th className="px-6 py-4 font-medium">المصدر</th>
                      <th className="px-6 py-4 font-medium">الحالة</th>
                      <th className="px-6 py-4 font-medium">الإجمالي</th>
                      <th className="px-6 py-4 font-medium">تاريخ الإنشاء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {salesData.data.map((order: any) => (
                      <tr key={order.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="px-6 py-4 font-medium text-white">{order.id.split("-")[0]}</td>
                        <td className="px-6 py-4">{order.customer_name || "غير محدد"}</td>
                        <td className="px-6 py-4">{order.source}</td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 bg-zinc-800 rounded-full text-xs">{order.status}</span>
                        </td>
                        <td className="px-6 py-4 font-bold text-emerald-400">{order.final_total} ر.س</td>
                        <td className="px-6 py-4">{new Date(order.created_at).toLocaleDateString("ar-EG")}</td>
                      </tr>
                    ))}
                    {salesData.data.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">لا توجد بيانات لهذه الفترة</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === "inventory" && inventoryData ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm text-right text-zinc-300">
                <thead className="text-xs text-zinc-400 bg-zinc-800/50 uppercase">
                  <tr>
                    <th className="px-6 py-4 font-medium">نوع الحركة</th>
                    <th className="px-6 py-4 font-medium">تغير الكمية</th>
                    <th className="px-6 py-4 font-medium">المصدر (رقم مرجعي)</th>
                    <th className="px-6 py-4 font-medium">ملاحظات</th>
                    <th className="px-6 py-4 font-medium">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {inventoryData.map((tx: any) => (
                    <tr key={tx.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs ${
                          tx.type === "in" || tx.type === "return" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                        }`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold" dir="ltr">
                        {tx.quantity_change > 0 ? `+${tx.quantity_change}` : tx.quantity_change}
                      </td>
                      <td className="px-6 py-4">{tx.reference_type}</td>
                      <td className="px-6 py-4">{tx.notes || "-"}</td>
                      <td className="px-6 py-4">{new Date(tx.created_at).toLocaleString("ar-EG")}</td>
                    </tr>
                  ))}
                  {inventoryData.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">لا توجد حركات مخزون لهذه الفترة</td>
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
