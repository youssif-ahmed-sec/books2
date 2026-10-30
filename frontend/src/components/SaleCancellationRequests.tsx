"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";
import { useConfirmAction } from "@/components/ConfirmationProvider";

type Request = { id: string; order_id: string; public_number: number; status: "PENDING" | "AWAITING_SETTLEMENT" | "APPROVED" | "REJECTED";
  total_amount: string; payment_method: string; is_owner: boolean; manual_review: boolean; rereview_requested: boolean; reason: string | null; rejection_reason: string | null };

export default function SaleCancellationRequests({ admin, revision, onOpenInvoice, onChanged }: { admin: boolean; revision: number; onOpenInvoice: (id: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Request[]>([]);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const confirm = useConfirmAction();
  const load = useCallback(async () => {
    try { const data = await fetchApi("/sale-cancellations?limit=50", { silentErrors: true }) as Request[]; setRows(data); setHasMore(data.length === 50); setError(""); }
    catch (cause) { setError(errorMessage(cause, "تعذر تحميل طلبات الإلغاء")); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, revision]);

  async function decide(row: Request, action: "approve" | "reject") {
    if (action === "approve" && !await confirm({ title: "اعتماد إلغاء البيعة؟",
      message: row.manual_review || row.status === "AWAITING_SETTLEMENT" ? "راجع الفاتورة يدويًا قبل الموافقة. ينتظر الطلب تأكيد الكاشير للتسوية، ولا تتغير الحسابات أو المخزون قبل ذلك." : "ينتظر الطلب تأكيد الكاشير للتسوية، ولا تتغير الحسابات أو المخزون قبل ذلك.",
      confirmLabel: "اعتماد الإلغاء", tone: "danger" })) return;
    if (action === "reject" && reason.trim().length < 3) return;
    setBusy(row.id);
    try {
      await fetchApi(`/sale-cancellations/${row.id}/${action}`, { method: "POST", body: JSON.stringify(
        action === "approve" ? { manual_review_confirmed: row.manual_review || row.status === "AWAITING_SETTLEMENT" } : { reason: reason.trim() },
      ) });
      notifySuccess(action === "approve" ? "تمت الموافقة والطلب بانتظار تأكيد التسوية" : "تم رفض الطلب");
      setRejectId(null); setReason(""); refreshNotificationBell(); onChanged(); await load();
    } catch (cause) {
      const message = errorMessage(cause, "تعذر تنفيذ القرار");
      if (message.includes("مراجعة يدوية")) setRows(previous => previous.map(item => item.id === row.id ? { ...item, manual_review: true } : item));
      notifyError(message);
    }
    finally { setBusy(null); }
  }

  async function settle(row: Request) {
    setBusy(row.id);
    let financiallyConfirmed = false;
    try {
      const quote = await fetchApi(`/sale-cancellations/${row.id}/settlement-preview`) as { refund_amount: string; debt_amount: string; retained_fees: string; payment_method: string | null; already_returned: boolean; settlement_type: "DEBT" | "REFUND" | "MIXED" };
      const method = ({ Cash: "نقدي", "Credit Card": "بطاقة", Instapay: "إنستاباي", Wallet: "محفظة", "Vodafone Cash": "فودافون كاش", "Bank Transfer": "تحويل بنكي" } as Record<string, string>)[quote.payment_method || ""] || quote.payment_method;
      const retained = Number(quote.retained_fees) > 0 ? ` الشحن ورسوم المحفظة بقيمة ${quote.retained_fees} ج.م تظل محسوبة ولا تُرد.` : "";
      if (!await confirm({ title: "تأكيد رد المبلغ وإلغاء البيعة؟",
        message: (quote.already_returned ? "الأصناف وقيمتها اتردوا بالكامل سابقًا. أكد تسجيل الإلغاء دون حركات إضافية." : quote.settlement_type === "DEBT" ? `سيُخصم ${quote.debt_amount} ج.م من مديونية العميل وتُعاد الأصناف المتبقية للمخزن. لا يوجد مبلغ نقدي للرد.` : quote.settlement_type === "MIXED" ? `أكد أنك رددت ${quote.refund_amount} ج.م للعميل بطريقة ${method}. ستُخصم أيضًا ${quote.debt_amount} ج.م من مديونيته وتُعاد الأصناف للمخزن.` : `أكد أنك رددت ${quote.refund_amount} ج.م للعميل بطريقة ${method}. بعد التأكيد تُعاد الأصناف المتبقية للمخزن ويُسجل رد المبلغ.`) + retained,
        confirmLabel: quote.already_returned ? "تأكيد الإلغاء" : quote.settlement_type === "DEBT" ? "تأكيد تسوية المديونية" : "أكدت رد المبلغ", tone: "danger" })) return;
      financiallyConfirmed = Number(quote.refund_amount) > 0 && quote.settlement_type !== "DEBT";
      await fetchApi(`/sale-cancellations/${row.id}/settle`, { method: "POST", body: JSON.stringify({ confirmed_refund: quote.refund_amount, confirmed_debt: quote.debt_amount, confirmed_method: quote.payment_method, refund_confirmed: true }) });
      notifySuccess("تمت تسوية الإلغاء"); onChanged(); await load();
    } catch (cause) {
      const message = errorMessage(cause, "تعذرت تسوية الإلغاء");
      if (!financiallyConfirmed && message.includes("مراجعة يدوية جديدة")) {
        try { await fetchApi(`/sale-cancellations/${row.id}/request-review`, { method: "POST" }); await load(); notifySuccess("أُبلغ المدير بطلب المراجعة مجددًا"); }
        catch (reviewError) { notifyError(errorMessage(reviewError, message)); }
      } else notifyError(financiallyConfirmed ? `${message} إذا تم رد المبلغ، راجع حالة الطلب والمدير قبل تكراره.` : message);
    }
    finally { setBusy(null); }
  }

  return <section className="app-panel space-y-3 p-5" aria-label="طلبات إلغاء المبيعات">
    <h2 className="text-lg font-bold">طلبات إلغاء المبيعات</h2>
    <p className="app-muted text-sm">بعد موافقة المدير يؤكد صاحب الطلب التسوية لإتمام الإلغاء.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {!error && rows.length === 0 && <p className="app-muted text-sm">لا توجد طلبات إلغاء.</p>}
    <div className="max-h-80 space-y-2 overflow-y-auto overscroll-contain">{rows.map(row => <article key={row.id} className="rounded-xl border border-white/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>فاتورة {row.public_number}</strong><span>{row.status === "PENDING" ? "بانتظار المدير" : row.status === "AWAITING_SETTLEMENT" ? "بانتظار تأكيد التسوية" : row.status === "APPROVED" ? "إلغاء مكتمل" : "مرفوض"}</span></div>
      <button type="button" onClick={() => onOpenInvoice(row.order_id)} className="mt-2 inline-block text-primary underline">عرض الفاتورة</button>
      {row.manual_review && <p className="mt-2 text-amber-300">تحتاج مراجعة يدوية: مرتجع سابق أو وردية مقفولة أو غير معروفة.</p>}
      {row.reason && <p className="app-muted mt-2">السبب: {row.reason}</p>}
      {row.rejection_reason && <p className="app-muted mt-2">سبب الرفض: {row.rejection_reason}</p>}
      {admin && row.status === "PENDING" && <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy === row.id} className="app-primary-button" onClick={() => void decide(row, "approve")}>موافقة</button><button type="button" disabled={busy === row.id} className="app-secondary-button" onClick={() => setRejectId(row.id)}>رفض</button></div>}
      {admin && row.status === "AWAITING_SETTLEMENT" && row.rereview_requested && <button type="button" disabled={busy === row.id} className="app-secondary-button mt-3" onClick={() => void decide(row, "approve")}>مراجعة بعد تغير حالة الفاتورة</button>}
      {row.is_owner && row.status === "AWAITING_SETTLEMENT" && <button type="button" disabled={busy === row.id} className="app-primary-button mt-3" onClick={() => void settle(row)}>تأكيد التسوية وإتمام الإلغاء</button>}
      {rejectId === row.id && <div className="mt-3 space-y-2"><label className="block">سبب الرفض<textarea className="app-field mt-1" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="button" className="app-primary-button" disabled={busy === row.id || reason.trim().length < 3} onClick={() => void decide(row, "reject")}>تأكيد الرفض</button><button type="button" className="app-secondary-button" onClick={() => setRejectId(null)}>تراجع</button></div>}
    </article>)}</div>
    {hasMore && <button type="button" className="app-secondary-button" onClick={() => void (async () => {
      try { const page = await fetchApi(`/sale-cancellations?limit=50&offset=${rows.length}`, { silentErrors: true }) as Request[]; setRows(previous => [...previous, ...page]); setHasMore(page.length === 50); }
      catch (cause) { notifyError(errorMessage(cause, "تعذر تحميل المزيد")); }
    })()}>عرض المزيد</button>}
  </section>;
}
