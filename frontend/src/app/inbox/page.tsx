"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { orderStatusLabels } from "@/lib/orderLabels";

interface InboxOrder {
  id: string;
  status: string;
  customer_name?: string | null;
  total_amount: number;
  allowed_next_statuses: string[];
}

const inboxStatuses = ["New Lead", "Draft Order", "Waiting Quotation", "Quotation Sent", "Waiting Customer Approval"];

export default function InboxPage() {
  const [orders, setOrders] = useState<InboxOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const data = await fetchApi("/orders");
      // Filter for inbox-relevant statuses
      const inboxOrders = data.filter((o: InboxOrder) =>
        inboxStatuses.includes(o.status)
      );
      setOrders(inboxOrders);
    } catch (err) {
      console.error("Failed to load inbox orders:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApi("/orders")
      .then((data: InboxOrder[]) => setOrders(data.filter((o) => inboxStatuses.includes(o.status))))
      .catch((err) => console.error("Failed to load inbox orders:", err))
      .finally(() => setIsLoading(false));
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
      <TopNav title="متابعة الطلبات" />
      <main className="app-main">
        <div className="space-y-6">
          <div>
            <h1 className="app-heading">متابعة الطلبات</h1>
            <p className="app-subtitle">المسودات وعروض الأسعار وموافقات العملاء</p>
          </div>

      {isLoading ? (
        <div className="app-panel app-muted p-8">جاري تحميل الطلبات...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
          {/* New Leads / Drafts */}
          <div className="app-panel p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white border-b border-white/10 pb-3">طلبات جديدة ومسودات</h2>
            {orders.filter(o => ["New Lead", "Draft Order"].includes(o.status)).map(order => (
              <div key={order.id} className="bg-white/5 rounded-2xl p-4 flex flex-col gap-3 border border-white/5">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="app-muted text-xs font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs">
                    {orderStatusLabels[order.status] || order.status}
                  </span>
                </div>
                <div className="text-lg font-bold text-primary">{Number(order.total_amount).toLocaleString("ar-EG")} ج.م</div>
                <div className="flex gap-2 mt-2">
                  <button disabled={!order.allowed_next_statuses.length} onClick={() => updateStatus(order.id, order.allowed_next_statuses[0])} className="app-secondary-button flex-1">
                    الخطوة التالية
                  </button>
                </div>
              </div>
            ))}
            {!orders.some(o => ["New Lead", "Draft Order"].includes(o.status)) && <p className="app-muted py-8 text-center text-sm">لا توجد طلبات جديدة</p>}
          </div>

          {/* Quotations */}
          <div className="app-panel p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white border-b border-white/10 pb-3">عروض الأسعار</h2>
            {orders.filter(o => ["Waiting Quotation", "Quotation Sent"].includes(o.status)).map(order => (
              <div key={order.id} className="bg-white/5 rounded-2xl p-4 flex flex-col gap-3 border border-white/5">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="app-muted text-xs font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs">
                    {orderStatusLabels[order.status] || order.status}
                  </span>
                </div>
                <div className="text-lg font-bold text-primary">{Number(order.total_amount).toLocaleString("ar-EG")} ج.م</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handlePrintQuotation(order.id)} className="app-secondary-button flex-1">
                    طباعة / PDF
                  </button>
                  <button disabled={!order.allowed_next_statuses.length} onClick={() => updateStatus(order.id, order.allowed_next_statuses[0])} className="app-primary-button flex-1">
                    الخطوة التالية
                  </button>
                </div>
              </div>
            ))}
            {!orders.some(o => ["Waiting Quotation", "Quotation Sent"].includes(o.status)) && <p className="app-muted py-8 text-center text-sm">لا توجد عروض أسعار قيد المتابعة</p>}
          </div>

          {/* Waiting Approval */}
          <div className="app-panel p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-white border-b border-white/10 pb-3">في انتظار الموافقة</h2>
            {orders.filter(o => o.status === "Waiting Customer Approval").map(order => (
              <div key={order.id} className="bg-white/5 rounded-2xl p-4 flex flex-col gap-3 border border-white/5">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="app-muted text-xs font-mono">#{order.id.slice(0,8)}</span>
                    <h3 className="text-white font-medium">{order.customer_name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs">
                    {orderStatusLabels[order.status]}
                  </span>
                </div>
                <div className="text-lg font-bold text-primary">{Number(order.total_amount).toLocaleString("ar-EG")} ج.م</div>
                <div className="flex gap-2 mt-2">
                  <button disabled={!order.allowed_next_statuses.includes("Approved")} onClick={() => updateStatus(order.id, "Approved")} className="app-primary-button flex-1">
                    اعتماد الطلب
                  </button>
                </div>
              </div>
            ))}
            {!orders.some(o => o.status === "Waiting Customer Approval") && <p className="app-muted py-8 text-center text-sm">لا توجد طلبات تنتظر الموافقة</p>}
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
