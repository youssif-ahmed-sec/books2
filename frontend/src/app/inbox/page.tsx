"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";

export default function InboxPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const data = await fetchApi("/orders");
      // Filter for inbox-relevant statuses
      const inboxOrders = data.filter((o: any) => 
        ["New Lead", "Draft", "Quotation", "Waiting Approval"].includes(o.status)
      );
      setOrders(inboxOrders);
    } catch (err) {
      console.error("Failed to load inbox orders:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const updateStatus = async (orderId: string, newStatus: string) => {
    try {
      await fetchApi(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, warehouse_id: null }),
      });
      await loadOrders();
    } catch (err) {
      console.error("Failed to update status:", err);
      alert("حدث خطأ أثناء تحديث الحالة");
    }
  };

  const handlePrintQuotation = (orderId: string) => {
    window.open(`/inbox/quotation?id=${orderId}`, '_blank');
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="البريد الوارد (أومني)" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">البريد الوارد (طلبات الأومني تشانل)</h1>
            <p className="text-sm text-zinc-400 mt-1">متابعة طلبات الواتساب، عروض الأسعار، والموافقات</p>
          </div>

      {isLoading ? (
        <div className="text-zinc-400">جاري التحميل...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* New Leads / Drafts */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4 shadow-sm">
            <h2 className="text-lg font-bold text-white border-b border-zinc-800 pb-2">طلبات جديدة / مسودة</h2>
            {orders.filter(o => ["New Lead", "Draft"].includes(o.status)).map(order => (
              <div key={order.id} className="bg-zinc-800 rounded-lg p-4 flex flex-col gap-3 border border-zinc-700/50">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-zinc-400 font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs">
                    {order.status}
                  </span>
                </div>
                <div className="text-lg font-bold text-emerald-400">{order.total_amount} ر.س</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => updateStatus(order.id, "Quotation")} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-1.5 rounded text-sm transition-colors">
                    إرسال عرض سعر
                  </button>
                  <button onClick={() => updateStatus(order.id, "Approved")} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded text-sm transition-colors">
                    موافقة
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Quotations */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4 shadow-sm">
            <h2 className="text-lg font-bold text-white border-b border-zinc-800 pb-2">عروض أسعار مرسلة</h2>
            {orders.filter(o => o.status === "Quotation").map(order => (
              <div key={order.id} className="bg-zinc-800 rounded-lg p-4 flex flex-col gap-3 border border-zinc-700/50">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-zinc-400 font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-orange-500/20 text-orange-400 px-2 py-1 rounded text-xs">
                    Quotation
                  </span>
                </div>
                <div className="text-lg font-bold text-emerald-400">{order.total_amount} ر.س</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handlePrintQuotation(order.id)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded text-sm transition-colors">
                    طباعة / PDF
                  </button>
                  <button onClick={() => updateStatus(order.id, "Approved")} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded text-sm transition-colors">
                    موافقة
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Waiting Approval */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4 shadow-sm">
            <h2 className="text-lg font-bold text-white border-b border-zinc-800 pb-2">في انتظار الموافقة</h2>
            {orders.filter(o => o.status === "Waiting Approval").map(order => (
              <div key={order.id} className="bg-zinc-800 rounded-lg p-4 flex flex-col gap-3 border border-zinc-700/50">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-zinc-400 font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs">
                    Waiting Approval
                  </span>
                </div>
                <div className="text-lg font-bold text-emerald-400">{order.total_amount} ر.س</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => updateStatus(order.id, "Approved")} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded text-sm transition-colors">
                    اعتماد الطلب
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
