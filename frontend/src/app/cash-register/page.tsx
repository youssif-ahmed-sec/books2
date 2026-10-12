"use client";

import { useEffect, useState, useRef } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

type Shift = { id: string; status: string; opening_cash: number; expected_cash: number; closing_cash: number | null; difference: number | null; opened_at: string; closed_at: string | null };

export default function CashRegisterPage() {
  const [current, setCurrent] = useState<Shift | null>(() => readSectionSnapshot<{ current: Shift | null }>("cash-register")?.current || null);
  const [history, setHistory] = useState<Shift[]>(() => readSectionSnapshot<{ history: Shift[] }>("cash-register")?.history || []);
  const [opening, setOpening] = useState(0);
  const [counted, setCounted] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pendingAdjustment = useRef<{ fingerprint: string; id: string } | null>(null);

  const reload = async () => {
    const [shift, shifts] = await Promise.all([fetchApi("/cash-register/current"), fetchApi("/cash-register/history")]);
    setCurrent(shift); setHistory(shifts);
    writeSectionSnapshot("cash-register", { current: shift, history: shifts });
  };
  useEffect(() => { const timer = window.setTimeout(() => { void reload().catch(error => setMessage(errorMessage(error, "تعذر تحميل بيانات الصندوق"))); }, 0); return () => window.clearTimeout(timer); }, []);

  async function act(path: string, payload: object) {
    setBusy(true); setMessage("");
    try {
      let body = payload;
      if (path === "adjustments") {
        const fingerprint = JSON.stringify(payload);
        if (pendingAdjustment.current?.fingerprint !== fingerprint) pendingAdjustment.current = { fingerprint, id: crypto.randomUUID() };
        body = { ...payload, request_id: pendingAdjustment.current.id };
      }
      await fetchApi(`/cash-register/${path}`, { method: "POST", body: JSON.stringify(body) });
      if (path === "adjustments") pendingAdjustment.current = null;
      await reload(); setReason(""); setAdjustment(0); setCounted(0);
      setMessage("تم تسجيل حركة الصندوق");
    } catch (error) { setMessage(errorMessage(error, "تعذر تسجيل الحركة")); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-[#131313] text-white flex" dir="rtl">
    <SideNav /><TopNav title="الصندوق النقدي" />
    <main className="mx-4 mt-28 mb-8 flex-1 min-w-0 lg:mr-[364px] lg:mt-36 space-y-5">
      <h1 className="text-2xl font-bold">إدارة وردية الصندوق</h1>
      {message && <p role="status" className="rounded-xl bg-primary/10 p-4">{message}</p>}
      {!current ? <section className="glass rounded-2xl p-6 space-y-4">
        <p>افتح وردية قبل تسجيل مبيعات أو تحصيلات نقدية.</p>
        <label className="block">رصيد البداية</label>
        <input aria-label="رصيد البداية" className="app-field" type="number" min="0" step="0.01" value={opening} onChange={event => setOpening(Number(event.target.value) || 0)} />
        <button disabled={busy} className="app-primary-button" onClick={() => act("open", { opening_cash: opening })}>فتح وردية</button>
      </section> : <section className="glass rounded-2xl p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4"><p>رصيد البداية<br /><strong>{current.opening_cash.toFixed(2)} ج.م</strong></p><p>الرصيد المتوقع<br /><strong>{current.expected_cash.toFixed(2)} ج.م</strong></p><p>بدأت في<br /><strong>{new Date(current.opened_at).toLocaleString("ar-EG")}</strong></p></div>
        <div className="border-t border-white/10 pt-4 space-y-3"><h2 className="font-bold">حركة نقدية يدوية</h2><p className="text-sm text-white/60">أدخل مبلغًا موجبًا للإيداع وسالبًا للسحب، مع السبب.</p>
          <div className="flex flex-wrap gap-3"><input aria-label="مبلغ الحركة" className="app-field" type="number" step="0.01" value={adjustment || ""} onChange={event => setAdjustment(Number(event.target.value) || 0)} /><input aria-label="سبب الحركة" className="app-field" value={reason} onChange={event => setReason(event.target.value)} placeholder="السبب" /><button disabled={busy || !adjustment || reason.trim().length < 3} onClick={() => act("adjustments", { amount: adjustment, reason })} className="app-secondary-button disabled:opacity-40">تسجيل الحركة</button></div>
        </div>
        <div className="border-t border-white/10 pt-4 space-y-3"><h2 className="font-bold">إغلاق الوردية</h2><p className="text-sm text-white/60">عدّ النقدية الفعلية وسجلها؛ سيظهر الفرق عن المتوقع في السجل.</p><div className="flex flex-wrap gap-3"><input aria-label="النقدية المعدودة" className="app-field" type="number" min="0" step="0.01" value={counted || ""} onChange={event => setCounted(Number(event.target.value) || 0)} /><button disabled={busy} onClick={() => { if (window.confirm("تأكيد إغلاق الوردية؟")) act("close", { closing_cash: counted }); }} className="app-primary-button">إغلاق الوردية</button></div></div>
      </section>}
      <section className="glass rounded-2xl p-6 space-y-3"><h2 className="font-bold">الورديات السابقة</h2>{history.map(shift => <p key={shift.id} className="border-b border-white/10 pb-2 text-sm">{new Date(shift.opened_at).toLocaleString("ar-EG")} — {shift.status === "OPEN" ? "مفتوحة" : "مغلقة"} — متوقع {shift.expected_cash.toFixed(2)} ج.م{shift.closing_cash !== null ? ` — معدود ${shift.closing_cash.toFixed(2)} — فرق ${shift.difference?.toFixed(2)}` : ""}</p>)}</section>
    </main>
  </div>;
}
