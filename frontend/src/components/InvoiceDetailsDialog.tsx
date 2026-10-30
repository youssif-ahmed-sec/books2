"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { printOrderInvoice } from "@/lib/localPrint";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { orderStatusLabels } from "@/lib/orderLabels";
import { getUserRole } from "@/utils/auth";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { refreshNotificationBell } from "@/lib/notificationEvents";

type InvoiceDetail = {
  id: string; public_number: number; status: string; total_amount: number;
  payment_method: string; created_at: string; customer_name?: string | null;
  employee_name?: string | null; discount_amount: number; discount_percent?: number | null;
  shipping_cost: number; wallet_fee_amount: number; amount_received: number;
  next_due_date?: string | null;
  items: { id: string; product_name: string; unit_name: string; quantity_requested: number; total_price: number }[];
};
type InvoiceActivity = { remaining: number | null; events: { id: string; kind: string; at: string; amount: number; method: string; related_invoice: string | null }[] };

const completed = new Set(["Delivered", "Closed", "Returned", "Exchange"]);
const paymentLabels: Record<string, string> = { Cash: "نقدي", "Credit Card": "فيزا", Instapay: "إنستاباي", Wallet: "محفظة", "Vodafone Cash": "محفظة", "Bank Transfer": "تحويل بنكي", "Deferred Payment": "آجل" };
const money = (value: number) => `${Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const date = (value: string) => new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" });
const activityLabels: Record<string, string> = { sale: "دفعة بيع", collection: "تحصيل مديونية", refund: "رد مبلغ", return: "استرجاع", exchange: "استبدال", exchange_invoice: "فاتورة استبدال", correction: "تعديل الفاتورة", correction_invoice: "فاتورة مصححة" };

export default function InvoiceDetailsDialog({ invoiceId, onClose, onCancellation, onEdit }: { invoiceId: string; onClose: () => void; onCancellation?: () => void; onEdit?: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [activity, setActivity] = useState<InvoiceActivity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const requestId = useRef<string | null>(null);
  const confirm = useConfirmAction();

  useEffect(() => { const timer = window.setTimeout(() => setRole(getUserRole()), 0); return () => window.clearTimeout(timer); }, []);

  useEffect(() => {
    let active = true;
    fetchApi(`/orders/${encodeURIComponent(invoiceId)}/quotation`)
      .then((data: InvoiceDetail) => {
        if (!active) return;
        if (!completed.has(data.status)) { setLoadError("السجل ده ليس فاتورة بيع مكتملة"); return; }
        setDetail(data);
      })
      .catch(cause => { if (active) setLoadError(errorMessage(cause, "تعذر فتح تفاصيل الفاتورة")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [invoiceId]);

  useEffect(() => {
    if (role !== "ADMIN") return;
    let active = true;
    fetchApi(`/orders/${encodeURIComponent(invoiceId)}/activity`, { silentErrors: true })
      .then((data: InvoiceActivity) => { if (active) setActivity(data); })
      .catch(cause => { if (active) setActivityError(errorMessage(cause, "تعذر تحميل حركة الفاتورة")); });
    return () => { active = false; };
  }, [invoiceId, role]);

  async function cancelSale() {
    if (!detail || !role) return;
    setCancelling(true);
    try {
      let settlement: { confirmed_refund: string; confirmed_debt: string; confirmed_method: string | null; refund_confirmed: boolean } | undefined;
      if (role === "ADMIN") {
        const preview = await fetchApi(`/sale-cancellations/direct-preview/${encodeURIComponent(detail.id)}`) as { manual_review: boolean; refund_amount: string | null; debt_amount: string; retained_fees?: string; payment_method: string | null; settlement_type?: "DEBT" | "REFUND" | "MIXED" };
        if (preview.manual_review) {
          if (!await confirm({ title: "طلب مراجعة إلغاء البيعة؟", message: "الفاتورة عليها مرتجع أو ورديتها مقفولة أو غير معروفة. سيُسجل طلب للمراجعة دون رد مبلغ أو تغيير المخزون.", confirmLabel: "طلب مراجعة", tone: "danger" })) return;
        } else {
          const method = paymentLabels[preview.payment_method || ""] || preview.payment_method;
          const message = preview.settlement_type === "DEBT" ? `سيُخصم ${preview.debt_amount} ج.م من مديونية العميل وتُعاد الأصناف للمخزن. لا يوجد مبلغ نقدي للرد.` : preview.settlement_type === "MIXED" ? `أكد أنك رددت ${preview.refund_amount} ج.م للعميل بطريقة ${method}. ستُخصم أيضًا ${preview.debt_amount} ج.م من مديونيته وتُعاد الأصناف للمخزن.` : `أكد أنك رددت ${preview.refund_amount} ج.م للعميل بطريقة ${method}. بعد التأكيد تُعاد الأصناف للمخزن ويُسجل رد المبلغ.`;
          const retained = Number(preview.retained_fees || 0) > 0 ? ` الشحن ورسوم المحفظة بقيمة ${preview.retained_fees} ج.م تظل محسوبة ولا تُرد.` : "";
          if (!await confirm({ title: "تأكيد تسوية وإلغاء البيعة؟", message: message + retained, confirmLabel: preview.settlement_type === "DEBT" ? "تأكيد تسوية المديونية" : "أكدت رد المبلغ", tone: "danger" })) return;
          if (preview.refund_amount === null) throw new Error("تعذر تحديد مبلغ الرد");
          settlement = { confirmed_refund: preview.refund_amount, confirmed_debt: preview.debt_amount, confirmed_method: preview.payment_method, refund_confirmed: true };
        }
      } else if (!await confirm({ title: "طلب إلغاء البيعة؟", message: "سيُرسل الطلب للمدير دون تغيير المخزون أو الحسابات. بعد الموافقة أكّد التسوية لإتمام الإلغاء.", confirmLabel: "إرسال للمدير", tone: "danger" })) return;
      requestId.current ||= crypto.randomUUID();
      const result = await fetchApi("/sale-cancellations", { method: "POST", body: JSON.stringify({
        request_id: requestId.current, order_id: detail.id, ...settlement,
      }) });
      notifySuccess(result.status === "APPROVED" ? "تم تسجيل إلغاء البيعة" : "أُرسل الطلب لمراجعة المدير");
      refreshNotificationBell(); onCancellation?.(); onClose();
    } catch (cause) { notifyError(errorMessage(cause, "تعذر تسجيل طلب الإلغاء")); }
    finally { setCancelling(false); }
  }

  async function print() {
    if (!detail) return;
    setPrinting(true);
    try {
      await printOrderInvoice(detail.id);
      notifySuccess("أُرسلت الفاتورة لتطبيق الطباعة. راجع خروج الورقة من الطابعة.");
    } catch (cause) { notifyError(errorMessage(cause, "تعذر إرسال الفاتورة للطباعة")); }
    finally { setPrinting(false); }
  }

  return <div className="fixed inset-0 z-[110] flex justify-end bg-black/70" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label="تفاصيل الفاتورة" className="flex h-full w-full max-w-lg flex-col bg-[var(--color-surface-container-low)] shadow-2xl" dir="rtl">
      <header className="flex items-center justify-between border-b border-current/10 p-5">
        <h2 className="text-xl font-bold">فاتورة {detail?.public_number || ""}</h2>
        <button type="button" aria-label="إغلاق الفاتورة" className="app-icon-button !rounded-xl" onClick={onClose}><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5 text-sm">
        {loading && <p role="status" className="app-muted">جارٍ تحميل الفاتورة...</p>}
        {loadError && <p role="alert" className="text-red-400">{loadError}</p>}
        {detail && <>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="app-muted">العميل</dt><dd className="mt-1 font-semibold">{detail.customer_name || "عميل نقدي"}</dd></div>
            <div><dt className="app-muted">التاريخ</dt><dd className="mt-1 font-semibold">{date(detail.created_at)}</dd></div>
            <div><dt className="app-muted">الموظف</dt><dd className="mt-1 font-semibold">{detail.employee_name || "—"}</dd></div>
            <div><dt className="app-muted">طريقة الدفع</dt><dd className="mt-1 font-semibold">{paymentLabels[detail.payment_method] || detail.payment_method}</dd></div>
          </dl>
          <div className="divide-y divide-current/10 border-y border-current/10">
            {detail.items.map(item => <div key={item.id} className="flex justify-between gap-3 py-3">
              <div className="min-w-0"><p className="break-words font-medium">{item.product_name}</p><p className="app-muted">{item.quantity_requested} {item.unit_name}</p></div>
              <strong className="shrink-0">{money(item.total_price)}</strong>
            </div>)}
          </div>
          {(Number(detail.discount_amount) > 0 || Number(detail.shipping_cost) > 0 || Number(detail.wallet_fee_amount) > 0) && <dl className="space-y-2 border-b border-current/10 pb-4">
            {Number(detail.discount_amount) > 0 && <div className="flex justify-between gap-3"><dt className="app-muted">الخصم{detail.discount_percent ? ` (${detail.discount_percent}٪)` : ""}</dt><dd>{money(detail.discount_amount)}</dd></div>}
            {Number(detail.shipping_cost) > 0 && <div className="flex justify-between gap-3"><dt className="app-muted">رسوم التوصيل</dt><dd>{money(detail.shipping_cost)}</dd></div>}
            {Number(detail.wallet_fee_amount) > 0 && <div className="flex justify-between gap-3"><dt className="app-muted">رسوم المحفظة</dt><dd>{money(detail.wallet_fee_amount)}</dd></div>}
          </dl>}
          <div className="flex justify-between text-base font-bold"><span>الإجمالي</span><span>{money(detail.total_amount)}</span></div>
          {detail.payment_method === "Deferred Payment" && <div className="space-y-2 border-t border-current/10 pt-4">
            <div className="flex justify-between gap-3"><span className="app-muted">المدفوع وقت البيع</span><strong>{money(detail.amount_received)}</strong></div>
            {activity && <div className="flex justify-between gap-3"><span className="app-muted">الرصيد الحالي للفاتورة</span><strong>{activity.remaining === null ? "رصيد قديم غير محدد" : money(activity.remaining)}</strong></div>}
            {detail.next_due_date && <div className="flex justify-between gap-3"><span className="app-muted">موعد الدفعة القادمة</span><strong>{detail.next_due_date}</strong></div>}
          </div>}
          {role === "ADMIN" && <section className="border-t border-current/10 pt-4" aria-label="حركة الفاتورة">
            <h3 className="mb-2 font-semibold">حركة الفاتورة</h3>
            {!activity && !activityError && <p role="status" className="app-muted">جارٍ تحميل الحركة...</p>}
            {activityError && <p role="alert" className="text-red-400">{activityError}</p>}
            {activity && activity.events.length === 0 && <p className="app-muted">لا توجد حركة مسجلة.</p>}
            {activity && <div className="divide-y divide-current/10">{activity.events.map(event => <div key={`${event.kind}-${event.id}`} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0"><strong>{activityLabels[event.kind] || event.kind}</strong><p className="app-muted">{date(event.at)}{event.kind === "sale" || event.kind === "collection" || event.kind === "refund" ? ` · ${paymentLabels[event.method] || event.method}` : ""}</p></div>
              <span className="shrink-0 font-semibold">{money(event.amount)}</span>
            </div>)}</div>}
          </section>}
          <p className="app-muted">{orderStatusLabels[detail.status] || detail.status}</p>
        </>}
      </div>
      {detail && <footer className="flex flex-wrap gap-2 border-t border-current/10 p-5"><button type="button" className="app-primary-button flex-1" disabled={cancelling || printing} onClick={print}>{printing ? "جارٍ إرسال الفاتورة..." : "طباعة الفاتورة"}</button>{onEdit && <button type="button" className="app-secondary-button" disabled={cancelling || printing} onClick={onEdit}>تعديل الفاتورة</button>}<button type="button" className="app-secondary-button" disabled={cancelling || !role || !["ADMIN", "CASHIER_ORDERS"].includes(role)} onClick={() => void cancelSale()}>{cancelling ? "جارٍ الإرسال…" : role === "ADMIN" ? "إلغاء البيعة" : "طلب إلغاء البيعة"}</button></footer>}
    </aside>
  </div>;
}
