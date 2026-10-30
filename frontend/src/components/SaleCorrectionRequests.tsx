"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";
import { useConfirmAction } from "@/components/ConfirmationProvider";

type Correction = { id: string; order_id: string; public_number: number; status: "PENDING" | "AWAITING_SETTLEMENT" | "APPLIED" | "REJECTED" | "WITHDRAWN";
  requester_name: string; is_owner: boolean; manual_review: boolean; rereview_requested: boolean; original_total: string; effective_original_total: string; has_prior_returns: boolean; rejection_reason: string | null;
  customer_changed: boolean; original_customer_name: string; corrected_customer_name: string;
  corrected_order_id: string | null; proposed_quote: { total: string; discount: string; shipping: string };
  proposal: { payment_method: string }; priced_lines: { product_name: string; unit_name: string; quantity: string; unit_price: string; original_item_id: string | null }[] };
type Settlement = { original_total: string; corrected_total: string; old_debt: string; new_debt: string; fingerprint: string; customer_changed: boolean; original_customer_name: string; corrected_customer_name: string; adjustments: { kind: "SALE" | "REFUND"; method: string; amount: string }[] };
const methods: Record<string, string> = { Cash: "نقدي", "Credit Card": "بطاقة", Instapay: "إنستاباي", Wallet: "محفظة", "Deferred Payment": "آجل" };

export default function SaleCorrectionRequests({ admin, revision, onOpenInvoice, onChanged }: { admin: boolean; revision: number; onOpenInvoice: (id: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Correction[]>([]);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const confirm = useConfirmAction();
  const load = useCallback(async () => {
    try { const data = await fetchApi("/sale-corrections?limit=50", { silentErrors: true }) as Correction[]; setRows(data); setHasMore(data.length === 50); setError(""); }
    catch (cause) { setError(errorMessage(cause, "تعذر تحميل طلبات التعديل")); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, revision]);

  async function act(row: Correction, action: "approve" | "reject" | "withdraw") {
    if (action === "approve" && !await confirm({ title: "الموافقة على تعديل الفاتورة؟",
      message: row.manual_review || row.status === "AWAITING_SETTLEMENT" ? "راجع الفاتورة وحالتها يدويًا قبل الموافقة. لن تتغير الحسابات أو المخزون حتى يؤكد صاحب الطلب التسوية." : "لن تتغير الحسابات أو المخزون حتى يؤكد صاحب الطلب التسوية.",
      confirmLabel: "موافقة" })) return;
    if (action === "withdraw" && !await confirm({ title: "سحب طلب التعديل؟", message: "سيُغلق الطلب دون تغيير الفاتورة أو الحسابات.", confirmLabel: "سحب الطلب", tone: "danger" })) return;
    if (action === "reject" && reason.trim().length < 3) return;
    setBusy(row.id);
    try {
      const body = action === "approve" ? { manual_review_confirmed: row.manual_review || row.status === "AWAITING_SETTLEMENT" } : action === "reject" ? { reason: reason.trim() } : undefined;
      await fetchApi(`/sale-corrections/${row.id}/${action}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      notifySuccess(action === "approve" ? "تمت الموافقة والطلب بانتظار التسوية" : action === "reject" ? "تم رفض طلب التعديل" : "تم سحب الطلب");
      setRejectId(null); setReason(""); refreshNotificationBell(); onChanged(); await load();
    } catch (cause) { notifyError(errorMessage(cause, "تعذر تنفيذ الإجراء")); }
    finally { setBusy(null); }
  }

  async function settle(row: Correction) {
    setBusy(row.id);
    let financiallyConfirmed = false;
    try {
      const quote = await fetchApi(`/sale-corrections/${row.id}/settlement-preview`) as Settlement;
      const movements = quote.adjustments.length ? quote.adjustments.map(item => `${item.kind === "REFUND" ? "رد" : "تحصيل"} ${item.amount} ج.م ${methods[item.method] || item.method}${quote.customer_changed ? item.kind === "REFUND" ? ` للعميل ${quote.original_customer_name}` : ` من العميل ${quote.corrected_customer_name}` : ""}`).join("، ") : "لا يوجد فرق مالي";
      const debt = Number(quote.old_debt) || Number(quote.new_debt) ? ` سيتم إلغاء مديونية ${quote.original_customer_name} السابقة ${quote.old_debt} ج.م وتسجيل مديونية ${quote.corrected_customer_name} الجديدة ${quote.new_debt} ج.م.` : "";
      if (!await confirm({ title: "تأكيد تسوية تعديل الفاتورة؟", message: `الإجمالي السابق ${quote.original_total} ج.م، والمصحح ${quote.corrected_total} ج.م. ${movements}.${debt} أكد تنفيذ حركات الدفع المذكورة مع العميل؛ بعدها يتحدث المخزون وتُسجل الفاتورة المصححة.`, confirmLabel: quote.adjustments.length ? "أكدت التسوية" : "إتمام التعديل", tone: "danger" })) return;
      financiallyConfirmed = quote.adjustments.length > 0;
      const result = await fetchApi(`/sale-corrections/${row.id}/settle`, { method: "POST", body: JSON.stringify({ confirmed: true, fingerprint: quote.fingerprint }) }) as { corrected_order_id: string | null };
      notifySuccess("تمت تسوية التعديل وتسجيل الفاتورة المصححة"); refreshNotificationBell(); onChanged(); await load();
      if (result.corrected_order_id) onOpenInvoice(result.corrected_order_id);
    } catch (cause) {
      const message = errorMessage(cause, "تعذرت تسوية التعديل");
      if (!financiallyConfirmed && message.includes("مراجعة المدير")) {
        try { await fetchApi(`/sale-corrections/${row.id}/request-review`, { method: "POST" }); await load(); notifySuccess("أُبلغ المدير بطلب المراجعة مجددًا"); }
        catch (reviewError) { notifyError(errorMessage(reviewError, message)); }
      } else notifyError(financiallyConfirmed ? `${message} إذا تمت حركة الدفع، راجع حالة الطلب والمدير قبل تكرارها.` : message);
    }
    finally { setBusy(null); }
  }

  return <section className="app-panel space-y-3 p-5" aria-label="طلبات تعديل الفواتير"><h2 className="text-lg font-bold">طلبات تعديل الفواتير</h2><p className="app-muted text-sm">يعتمد المدير الطلب، ثم يؤكد صاحبه تسوية فرق الدفع لإتمام التعديل.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}{!error && !rows.length && <p className="app-muted text-sm">لا توجد طلبات تعديل.</p>}
    <div className="max-h-96 space-y-2 overflow-y-auto overscroll-contain">{rows.map(row => <article key={row.id} className="rounded-xl border border-current/10 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>فاتورة {row.public_number} · {row.requester_name}</strong><span>{row.status === "PENDING" ? "بانتظار المدير" : row.status === "AWAITING_SETTLEMENT" ? "بانتظار التسوية" : row.status === "APPLIED" ? "تم التعديل" : row.status === "WITHDRAWN" ? "تم سحب الطلب" : "مرفوض"}</span></div>
      <p className="mt-2">الإجمالي السابق: {row.original_total} ج.م{row.has_prior_returns && <> · المتبقي بعد المرتجعات: {row.effective_original_total} ج.م</>} · المقترح: <strong>{row.proposed_quote.total} ج.م</strong> · الدفع: {methods[row.proposal.payment_method] || row.proposal.payment_method}</p>
      {row.customer_changed && <p className="mt-2 text-amber-300">تغيير العميل: {row.original_customer_name} ← {row.corrected_customer_name}. ستُراجع حركتا الرد والتحصيل عند التسوية.</p>}
      <div className="mt-2 space-y-1">{row.priced_lines.map((line, index) => <p key={`${line.original_item_id || line.product_name}-${index}`} className="app-muted">{line.product_name} · {line.unit_name} · {line.quantity} × {line.unit_price} ج.م {line.original_item_id ? "(سعر البيع)" : ""}</p>)}</div>
      <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => onOpenInvoice(row.order_id)} className="text-primary underline">الفاتورة الأصلية</button>{row.corrected_order_id && <button type="button" onClick={() => onOpenInvoice(row.corrected_order_id!)} className="text-primary underline">الفاتورة المصححة</button>}</div>
      {row.manual_review && <p className="mt-2 text-amber-300">تحتاج الفاتورة مراجعة يدوية.</p>}{row.rejection_reason && <p className="mt-2">سبب الرفض: {row.rejection_reason}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{admin && row.status === "PENDING" && <><button type="button" disabled={busy === row.id} className="app-primary-button" onClick={() => void act(row, "approve")}>موافقة</button><button type="button" disabled={busy === row.id} className="app-secondary-button" onClick={() => setRejectId(row.id)}>رفض</button></>}
        {admin && row.status === "AWAITING_SETTLEMENT" && row.rereview_requested && <button type="button" disabled={busy === row.id} className="app-secondary-button" onClick={() => void act(row, "approve")}>مراجعة بعد تغير حالة الفاتورة</button>}
        {row.is_owner && row.status === "AWAITING_SETTLEMENT" && <button type="button" disabled={busy === row.id} className="app-primary-button" onClick={() => void settle(row)}>مراجعة الفروق وإتمام التعديل</button>}
        {row.is_owner && (row.status === "PENDING" || row.status === "AWAITING_SETTLEMENT") && <button type="button" disabled={busy === row.id} className="app-secondary-button" onClick={() => void act(row, "withdraw")}>سحب الطلب</button>}</div>
      {rejectId === row.id && <div className="mt-3 space-y-2"><label className="block">سبب الرفض<textarea className="app-field mt-1 w-full" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label><button type="button" className="app-primary-button" disabled={busy === row.id || reason.trim().length < 3} onClick={() => void act(row, "reject")}>تأكيد الرفض</button><button type="button" className="app-secondary-button" onClick={() => setRejectId(null)}>تراجع</button></div>}
    </article>)}</div>
    {hasMore && <button type="button" className="app-secondary-button" onClick={() => void (async () => { try { const page = await fetchApi(`/sale-corrections?limit=50&offset=${rows.length}`, { silentErrors: true }) as Correction[]; setRows(previous => [...previous, ...page]); setHasMore(page.length === 50); } catch (cause) { notifyError(errorMessage(cause, "تعذر تحميل المزيد")); } })()}>عرض المزيد</button>}
  </section>;
}
