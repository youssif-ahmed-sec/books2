"use client";

import { notifyError } from "@/lib/notifications";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { orderStatusLabels } from "@/lib/orderLabels";
import { errorMessage } from "@/lib/errors";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

interface InboxOrder {
  id: string;
  status: string;
  customer_name?: string | null;
  total_amount: number;
  allowed_next_statuses: string[];
  customer_id?: string | null;
  source: string;
  priority: string;
  updated_at: string | null;
  notes: string | null;
}

const inboxStatuses = ["New Lead", "Draft Order", "Waiting Quotation", "Quotation Sent", "Waiting Customer Approval"];

export default function InboxPage() {
  const [orders, setOrders] = useState<InboxOrder[]>(() => readSectionSnapshot<InboxOrder[]>("inbox-orders") || []);
  const [isLoading, setIsLoading] = useState(() => !readSectionSnapshot("inbox-orders"));
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [leadCustomer, setLeadCustomer] = useState("");
  const [leadSource, setLeadSource] = useState("Phone Call");
  const [leadNotes, setLeadNotes] = useState("");
  const [leadPriority, setLeadPriority] = useState("Normal");
  const [message, setMessage] = useState("");
  const [delays, setDelays] = useState<{ id: string; hours: number; escalate_to_admin: boolean }[]>([]);

  const loadOrders = async () => {
    if (!readSectionSnapshot("inbox-orders")) setIsLoading(true);
    try {
      const data = await fetchApi("/orders");
      // Filter for inbox-relevant statuses
      const inboxOrders = data.filter((o: InboxOrder) =>
        inboxStatuses.includes(o.status)
      );
      setOrders(inboxOrders);
      writeSectionSnapshot("inbox-orders", inboxOrders);
    } catch (err) {
      console.error("Failed to load inbox orders:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApi("/customers").then(setCustomers).catch(console.error);
    fetchApi("/orders/preparation-alerts").then(setDelays).catch(console.error);
    fetchApi("/orders")
      .then((data: InboxOrder[]) => { const rows = data.filter((o) => inboxStatuses.includes(o.status)); setOrders(rows); writeSectionSnapshot("inbox-orders", rows); })
      .catch((err) => console.error("Failed to load inbox orders:", err))
      .finally(() => setIsLoading(false));
  }, []);

  const createLead = async () => {
    try {
      await fetchApi("/orders/leads", { method: "POST", body: JSON.stringify({ customer_id: leadCustomer || null, source: leadSource, notes: leadNotes, priority: leadPriority }) });
      setLeadNotes(""); setMessage("تم تسجيل الاستفسار"); await loadOrders();
    } catch (error) { setMessage(errorMessage(error, "تعذر تسجيل الاستفسار")); }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    try {
      await fetchApi(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, warehouse_id: null }),
      });
      await loadOrders();
    } catch (err) {
      console.error("Failed to update status:", err);
      notifyError("حدث خطأ أثناء تحديث الحالة");
    }
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
          {message && <p role="status" className="app-panel p-3">{message}</p>}
          {delays.length > 0 && <section className="app-panel p-5 border border-amber-500/30"><h2 className="font-bold mb-2">تأخر تجهيز الطلبات</h2>{delays.map(delay => <p key={delay.id} className="text-sm">طلب #{delay.id.slice(0, 8)} — {delay.hours} ساعة {delay.escalate_to_admin ? "— تجاوز 4 ساعات ويحتاج تدخل المدير" : ""}</p>)}</section>}
          <section className="app-panel p-5 space-y-3"><h2 className="font-bold">تسجيل استفسار هاتفي أو مباشر</h2><div className="flex flex-wrap gap-3"><select className="app-field" value={leadCustomer} onChange={event => setLeadCustomer(event.target.value)}><option value="">عميل غير مسجل</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select><select className="app-field" value={leadSource} onChange={event => setLeadSource(event.target.value)}><option value="Phone Call">هاتف</option><option value="Walk-In Customer">حضور مباشر</option><option value="Manual Entry">إدخال يدوي</option></select><select className="app-field" value={leadPriority} onChange={event => setLeadPriority(event.target.value)}><option value="Low">أولوية منخفضة</option><option value="Normal">عادية</option><option value="High">عالية</option></select></div><textarea className="app-field w-full" placeholder="طلب العميل أو ملخص الاستفسار" value={leadNotes} onChange={event => setLeadNotes(event.target.value)} /><button className="app-primary-button" disabled={leadNotes.trim().length < 2} onClick={createLead}>تسجيل الاستفسار</button></section>

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
                    <h3 className="text-white font-medium">{customers.find(customer => customer.id === order.customer_id)?.name || "عميل غير مسجل"}</h3>
                  </div>
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs">
                    {orderStatusLabels[order.status] || order.status}
                  </span>
                </div>
                <div className="text-lg font-bold text-primary">{Number(order.total_amount).toLocaleString("ar-EG")} ج.م</div>
                <p className="app-muted text-xs">{order.source} — {order.priority} — آخر نشاط {order.updated_at ? new Date(order.updated_at).toLocaleString("ar-EG") : "—"}</p>
                {order.notes && <p className="text-sm">{order.notes}</p>}
                <div className="flex gap-2 mt-2">
                  {order.status === "New Lead" && <a href={`/orders?lead_id=${order.id}`} className="app-primary-button flex-1 text-center">تحويل إلى مسودة</a>}
                  <button disabled={order.status === "New Lead" || !order.allowed_next_statuses.length} onClick={() => updateStatus(order.id, order.allowed_next_statuses[0])} className="app-secondary-button flex-1">
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
