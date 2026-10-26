"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { getUserRole } from "@/utils/auth";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { formatCurrency } from "@/lib/formatters";

type Shift = { id: string; status: string; opening_cash: number | null; expected_cash: number | null; closing_cash: number | null; difference: number | null; opened_at: string; closed_at: string | null; email_report_status?: string };
type Snapshot = { current: Shift | null; history: Shift[] };

const CURRENCY_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1] as const;

const money = (value: number) => Number(value).toFixed(2);
const validMoney = (value: string) => {
  const trimmed = value.trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed) && Number.isFinite(Number(trimmed));
};

export default function CashRegisterPage() {
  const confirmAction = useConfirmAction();
  const snapshot = readSectionSnapshot<Snapshot>("cash-register");
  const [current, setCurrent] = useState<Shift | null>(snapshot?.current || null);
  const [history, setHistory] = useState<Shift[]>(snapshot?.history || []);
  const [opening, setOpening] = useState("0");
  const [counted, setCounted] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!snapshot);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showDenomCalc, setShowDenomCalc] = useState(false);
  const [denomCounts, setDenomCounts] = useState<Record<number, number>>({ 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
  const pendingAdjustment = useRef<{ fingerprint: string; id: string } | null>(null);

  const denomCalculatedTotal = CURRENCY_DENOMINATIONS.reduce((sum, denom) => sum + denom * (denomCounts[denom] || 0), 0);

  const reload = async () => {
    const [shift, shifts] = await Promise.all([
      fetchApi("/cash-register/current") as Promise<Shift | null>,
      fetchApi("/cash-register/history") as Promise<Shift[]>,
    ]);
    setCurrent(shift); setHistory(shifts);
    writeSectionSnapshot("cash-register", { current: shift, history: shifts });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch(cause => setError(errorMessage(cause, "تعذر تحميل بيانات الصندوق")))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function act(path: "open" | "close" | "adjustments", payload: object) {
    if (busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      let body = payload;
      if (path === "adjustments") {
        const fingerprint = JSON.stringify(payload);
        if (pendingAdjustment.current?.fingerprint !== fingerprint) {
          pendingAdjustment.current = { fingerprint, id: crypto.randomUUID() };
        }
        body = { ...payload, request_id: pendingAdjustment.current.id };
      }
      const saved = await fetchApi(`/cash-register/${path}`, { method: "POST", body: JSON.stringify(body) }) as Shift;
      if (path === "adjustments") pendingAdjustment.current = null;
      setCurrent(saved.status === "OPEN" ? saved : null);
      setHistory(previous => [saved, ...previous.filter(shift => shift.id !== saved.id)]);
      if (path === "close") setCounted("");
      if (path === "adjustments") { setReason(""); setAdjustment(""); }
      setMessage(path === "open" ? "تم فتح الوردية." : path === "close" ? "تم إغلاق الوردية وتسجيل المبلغ المعدود." : "تم تسجيل السحب النقدي.");
      if (path === "close" && isAdmin && saved.email_report_status === "SENT") setMessage("تم إغلاق الوردية وقبل Gmail إرسال ملخصها.");
      if (path === "close" && isAdmin && ["FAILED", "UNKNOWN"].includes(saved.email_report_status || "")) setError("أُغلقت الوردية، لكن تعذر إرسال ملخص البريد. راجع حالة الإرسال في الإعدادات.");
      if (path === "close" && isAdmin && saved.email_report_status === "NOT_CONFIGURED") setError("أُغلقت الوردية دون بريد؛ حدد البريد المستلم من الإعدادات لإرسال الملخصات القادمة.");
      try { await reload(); }
      catch (cause) { setError(errorMessage(cause, "تم التسجيل لكن تعذر تحديث بيانات الصندوق. حدّث الصفحة.")); }
    } catch (cause) {
      setError(errorMessage(cause, "تعذر تسجيل حركة الصندوق"));
    } finally { setBusy(false); }
  }

  const isAdmin = getUserRole() === "ADMIN";
  const countedValid = validMoney(counted);
  const difference = isAdmin && current?.expected_cash != null && countedValid
    ? Number((Number(counted) - Number(current.expected_cash)).toFixed(2)) : null;
  const adjustmentValid = validMoney(adjustment) && Number(adjustment) > 0 && reason.trim().length >= 3;
  const previousShifts = history.filter(shift => shift.status !== "OPEN");

  async function closeShift() {
    if (!current || !countedValid || busy) return;
    const text = isAdmin && current.expected_cash != null
      ? `الرصيد المتوقع ${money(current.expected_cash)} ج.م، والمعدود ${money(Number(counted))} ج.م. ` +
        (difference ? `فرق العدّ ${money(difference)} ج.م. ` : "لا يوجد فرق. ") + "تأكيد إغلاق الوردية؟"
      : `المبلغ المعدود ${money(Number(counted))} ج.م. تأكيد إغلاق الوردية؟`;
    if (await confirmAction({ title: "إغلاق الوردية؟", message: text, confirmLabel: "إغلاق الوردية" })) void act("close", { closing_cash: Number(counted) });
  }

  return <div className="min-h-screen" dir="rtl">

    <main className="app-main space-y-5">
      <header><h1 className="app-heading">وردية الصندوق</h1></header>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm">{message}</p>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.9fr)] xl:items-start">
      {loading ? <section className="app-panel space-y-4 rounded-3xl p-5 md:p-6" role="status" aria-label="جارٍ تحميل بيانات الصندوق"><span className="sr-only">جارٍ تحميل بيانات الصندوق</span><span aria-hidden="true" className="app-skeleton h-6 w-36" /><span aria-hidden="true" className="app-skeleton h-4 w-64 max-w-full" /><span aria-hidden="true" className="app-skeleton h-12 w-48 max-w-full rounded-xl" /></section> : !current ? <section className="app-panel min-w-0 space-y-5 rounded-3xl p-5 md:p-6">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><span className="material-symbols-outlined" aria-hidden="true">lock_open</span></span><h2 className="text-lg font-bold">فتح وردية</h2></div>
        <label className="block max-w-xs text-sm">رصيد البداية
          <ZeroHintNumberInput aria-label="رصيد البداية" className="app-field mt-1" inputMode="decimal" min="0" step="0.01" value={opening} disabled={busy} onChange={event => setOpening(event.target.value)} />
        </label>
        <button type="button" disabled={busy || !validMoney(opening)} className="app-primary-button disabled:opacity-50" onClick={() => void act("open", { opening_cash: Number(opening) })}>{busy ? "جارٍ الفتح..." : "فتح وردية"}</button>
      </section> : <section className="app-panel min-w-0 space-y-6 rounded-3xl p-5 md:p-6" aria-label="الوردية الحالية">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">الوردية الحالية</h2><p className="app-muted mt-1 text-xs">بدأت {new Date(current.opened_at).toLocaleString("ar-EG")}</p></div><span className="rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-500">مفتوحة الآن</span></div>
        {isAdmin && <div className="grid gap-4 border-y border-current/10 py-4 sm:grid-cols-2">
          {current.opening_cash !== null && <div><p className="app-muted text-xs">رصيد البداية</p><strong className="mt-1 block text-xl">{money(current.opening_cash)} ج.م</strong></div>}
          {current.expected_cash !== null && <div className="sm:border-r sm:border-current/10 sm:pr-4"><p className="app-muted text-xs">المتوقع في الدرج الآن</p><strong className="mt-1 block text-xl text-primary">{money(current.expected_cash)} ج.م</strong></div>}
        </div>}
        <div className="space-y-3"><h3 className="font-bold">سحب نقدي</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]">
            <label className="text-sm">مبلغ السحب<input aria-label="مبلغ السحب" className="app-field mt-1" type="number" inputMode="decimal" min="0.01" step="0.01" value={adjustment} disabled={busy} onChange={event => setAdjustment(event.target.value)} placeholder="0.00" /></label>
            <label className="text-sm">السبب<input aria-label="سبب السحب" className="app-field mt-1" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="مثلًا: مصروف توصيل" /></label>
          </div>
          <button type="button" disabled={busy || !adjustmentValid} onClick={() => void act("adjustments", { amount: -Number(adjustment), reason: reason.trim() })} className="app-secondary-button">{busy ? "جارٍ التسجيل…" : "تسجيل السحب"}</button>
        </div>
        <div className="space-y-4 border-t border-current/10 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-base">إغلاق الوردية</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowDenomCalc(!showDenomCalc)}
              className="app-secondary-button !px-3 !py-1.5 text-xs flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">calculate</span>
              <span>{showDenomCalc ? "إخفاء حاسبة الفئات" : "حاسبة فئات النقدية"}</span>
            </button>
          </div>

          {showDenomCalc && (
            <div className="rounded-2xl border border-white/10 bg-surface-container-low p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-bold text-on-surface">جدول فئات النقدية بالدرج</span>
                <span className="text-xs font-bold text-primary">المجموع: {formatCurrency(denomCalculatedTotal)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {CURRENCY_DENOMINATIONS.map(denom => (
                  <div key={denom} className="rounded-xl border border-white/10 bg-surface p-2.5 text-center">
                    <span className="text-xs font-bold block mb-1 text-on-surface-variant">{denom} جنيه</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      placeholder="0"
                      aria-label={`عدد ورقات ${denom} جنيه`}
                      value={denomCounts[denom] || ""}
                      onChange={e => {
                        const count = Math.max(0, parseInt(e.target.value) || 0);
                        setDenomCounts(prev => ({ ...prev, [denom]: count }));
                      }}
                      className="w-full text-center rounded-lg border border-current/10 bg-surface-container px-2 py-1 text-sm font-bold text-on-surface focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-[11px] app-muted block mt-1">={formatCurrency(denom * (denomCounts[denom] || 0))}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setDenomCounts({ 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 })}
                  className="text-xs text-[#ffb4ab] hover:underline"
                >
                  تفريغ الحاسبة
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCounted(denomCalculatedTotal.toFixed(2));
                  }}
                  className="app-primary-button !px-3 !py-1.5 text-xs font-bold"
                >
                  تطبيق {formatCurrency(denomCalculatedTotal)} على النقدية المعدودة
                </button>
              </div>
            </div>
          )}

          <label className="block max-w-xs text-sm">النقدية المعدودة
            <input aria-label="النقدية المعدودة" className="app-field mt-1 font-bold text-primary" type="number" inputMode="decimal" min="0" step="0.01" value={counted} disabled={busy} onChange={event => setCounted(event.target.value)} placeholder="أدخل المبلغ بعد العدّ" />
          </label>
          {difference !== null && <p className="text-sm">الفرق المتوقع عند الإغلاق: <strong className={difference === 0 ? "text-green-500" : "text-amber-500"}>{formatCurrency(difference)}</strong></p>}
          <button type="button" disabled={busy || !countedValid} onClick={closeShift} className="app-primary-button disabled:opacity-50">{busy ? "جارٍ الإغلاق..." : "مراجعة وإغلاق الوردية"}</button>
        </div>
      </section>}
      <section className="app-panel min-w-0 space-y-3 rounded-3xl p-5 md:p-6 xl:sticky xl:top-28" aria-label="سجل الورديات"><div className="flex items-center justify-between gap-3 border-b border-current/10 pb-3"><div><h2 className="text-lg font-bold">سجل الورديات</h2></div></div>
        {loading ? <div className="grid gap-2" role="status" aria-label="جارٍ تحميل الورديات السابقة"><span className="sr-only">جارٍ تحميل الورديات السابقة</span>{[0, 1].map(index => <div key={index} aria-hidden="true" className="space-y-2 border-b border-current/10 py-3"><span className="app-skeleton h-4 w-40" /><span className="app-skeleton h-3 w-64 max-w-full" /></div>)}</div> : previousShifts.length === 0 ? <p className="app-muted py-8 text-center text-sm">لا توجد ورديات مغلقة بعد.</p> : <div className="max-h-[min(68vh,640px)] divide-y divide-current/10 overflow-y-auto">{previousShifts.map(shift => <article key={shift.id} data-search-id={shift.id} className="space-y-2 py-4 text-sm">
          <strong>{new Date(shift.opened_at).toLocaleString("ar-EG")}</strong>
          {isAdmin ? <p className="app-muted text-xs">{shift.opening_cash !== null ? `رصيد البداية ${money(shift.opening_cash)} ج.م` : ""}{shift.closing_cash !== null ? ` · المعدود ${money(shift.closing_cash)} ج.م` : ""}</p> : <p className="app-muted text-xs">أُغلقت {shift.closed_at ? new Date(shift.closed_at).toLocaleString("ar-EG") : "الوردية"}</p>}
          {isAdmin && shift.difference !== null && <p className={`text-xs font-semibold ${shift.difference === 0 ? "text-green-500" : "text-amber-500"}`}>فرق العد: {money(shift.difference)} ج.م</p>}
        </article>)}</div>}
      </section>
      </div>
    </main>
  </div>;
}
