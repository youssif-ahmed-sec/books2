"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { CountHistory, CountRecord, countErrorMessage, countStatusLabel, moneyText, quantityText, signedQuantity } from "@/lib/counts";
import { errorMessage } from "@/lib/errors";
import { notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";

type Filter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";
const filters: { value: Filter; label: string }[] = [
  { value: "PENDING", label: "بانتظار القرار" },
  { value: "APPROVED", label: "المعتمد" },
  { value: "REJECTED", label: "المرفوض" },
  { value: "ALL", label: "كل السجل" },
];

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r|\n/g, " ");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function historyUrl(filter: Filter, target: string | null, offset = 0, limit = 50): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (target?.startsWith("session:")) params.set("session_id", target.slice(8));
  else if (target) params.set("count_id", target);
  else if (filter !== "ALL") params.set("status", filter);
  return `/inventory/counts/history?${params}`;
}

export default function CountApprovalsPage() {
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [history, setHistory] = useState<CountHistory>({ items: [], total: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const targetId = useRef<string | null>(null);
  const initializedTarget = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(async (nextFilter: Filter, offset = 0) => {
    const page = await fetchApi(historyUrl(nextFilter, targetId.current, offset), { silentErrors: true }) as CountHistory;
    setHistory(previous => offset ? { total: page.total, items: [...previous.items, ...page.items] } : page);
    return page;
  }, []);

  useEffect(() => {
    let active = true;
    if (!initializedTarget.current) {
      const params = new URLSearchParams(window.location.search);
      targetId.current = params.has("session") ? `session:${params.get("session")}` : params.get("count");
      initializedTarget.current = true;
    }
    fetchApi(historyUrl(filter, targetId.current), { silentErrors: true }).then((page: CountHistory) => {
      if (!active) return;
      setHistory(page);
      const target = targetId.current;
      setFocused(target);
      const match = target ? page.items.find(item => target.startsWith("session:")
        ? item.session_id === target.slice(8) : item.id === target) : null;
      if (match) setSelectedId(match.id);
      else setSelectedId(previous => page.items.some(item => item.id === previous) ? previous : page.items[0]?.id || null);
      setError("");
    }).catch(err => { if (active) setError(String(err).includes("Not Found")
      ? "موافقات الجرد تنتظر تحديث السيرفر وقاعدة البيانات."
      : errorMessage(err, "تعذر تحميل طلبات الجرد")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter]);

  const selected = history.items.find(item => item.id === selectedId) || null;

  const decide = async () => {
    if (!selected || !decision || busy) return;
    if (decision === "reject" && rejectionReason.trim().length < 3) {
      setError("اكتب سبب الرفض من ٣ أحرف على الأقل"); return;
    }
    setBusy(true); setError("");
    try {
      await fetchApi(`/inventory/counts/${selected.id}/${decision}`, {
        method: "POST", body: JSON.stringify(decision === "reject" ? { reason: rejectionReason.trim() } : {}),
      });
      setDecision(null); setRejectionReason("");
      targetId.current = null; setFocused(null);
      const page = await load(filter);
      setSelectedId(page.items[0]?.id || null);
      refreshNotificationBell();
      notifySuccess(decision === "approve" ? "تم اعتماد الجرد وتحديث الرصيد" : "تم رفض الجرد وإبلاغ مسؤول المخزون");
    } catch (err) { setError(countErrorMessage(err, "تعذر إتمام القرار")); }
    finally { setBusy(false); }
  };

  const exportCsv = async () => {
    setExporting(true); setError("");
    try {
      const rows: CountRecord[] = [];
      let total = 0;
      do {
        const page = await fetchApi(historyUrl(filter, targetId.current, rows.length, 100), { silentErrors: true }) as CountHistory;
        total = page.total;
        rows.push(...page.items);
        if (!page.items.length) break;
      } while (rows.length < total);
      const header = ["التاريخ", "المنتج", "الكود", "المسجل", "الفعلي", "الفرق", "سعر الشراء", "قيمة الفرق", "السبب", "الحالة", "الجاد", "المدير", "سبب الرفض"];
      const lines = [header, ...rows.map(row => [row.created_at, row.product_name, row.sku,
        row.expected_quantity, row.observed_quantity, row.difference, row.unit_cost,
        row.difference_value, row.reason, countStatusLabel[row.status], row.counter,
        row.reviewer, row.rejection_reason])];
      const csv = "\uFEFF" + lines.map(line => line.map(csvCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `inventory-counts-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(errorMessage(err, "تعذر تصدير سجل الجرد")); }
    finally { setExporting(false); }
  };

  return <div className="min-h-screen" dir="rtl">

    <main className="app-main space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-white/10 pb-7">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.14em] text-primary">مراجعة المخزون</p>
          <h1 className="app-heading">قرارات الجرد</h1>
        </div>
        <button type="button" className="app-secondary-button" disabled={exporting} onClick={() => void exportCsv()}>
          <span className="material-symbols-outlined text-lg" aria-hidden="true">download</span>{exporting ? "جارٍ التصدير…" : "تصدير السجل"}
        </button>
      </header>
      {error && <p role="alert" className="stock-ops-warning text-sm">{error}</p>}
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10" aria-label="تصفية الجرد">
        {filters.map(item => <button key={item.value} type="button" onClick={() => { targetId.current = null; setFocused(null); setLoading(true); if (filter === item.value) void load(item.value).finally(() => setLoading(false)); else setFilter(item.value); }}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${filter === item.value ? "border-primary text-primary" : "app-muted border-transparent hover:text-primary"}`}>
          {item.label}
        </button>)}
        {focused && <button type="button" className="app-muted mb-3 text-xs underline" onClick={() => { targetId.current = null; setFocused(null); setLoading(true); void load(filter).finally(() => setLoading(false)); }}>عرض كل الطلبات</button>}
      </nav>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <section className="app-panel min-w-0 overflow-hidden" aria-label="طلبات الجرد">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><h2 className="font-bold">{filter === "PENDING" ? "طلبات بانتظار قرارك" : "سجل الجرد"}</h2></div>
          {loading ? <p role="status" className="app-muted p-8 text-center">جارٍ تحميل الجرد…</p>
            : history.items.length ? <div className="max-h-[68vh] overflow-y-auto">{history.items.map(item =>
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                className={`app-table-row w-full px-5 py-4 text-start ${selectedId === item.id ? "bg-primary/10" : ""}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-sm">{item.product_name}</strong><span className="app-muted mt-1 block text-xs">{item.sku} · {new Date(item.created_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</span></div><span className={`shrink-0 text-sm font-bold ${item.difference < 0 ? "text-red-300" : "text-primary"}`} dir="auto">{signedQuantity(item.difference)}</span></div>
                <p className="app-muted mt-2 truncate text-xs">{item.counter} · {countStatusLabel[item.status]}</p>
              </button>)}</div>
            : <p className="app-muted p-10 text-center text-sm">لا توجد أصناف في هذه القائمة.</p>}
          {history.items.length < history.total && <button type="button" className="app-menu-action w-full justify-center border-t border-white/10" onClick={() => void load(filter, history.items.length)}>عرض المزيد</button>}
        </section>
        <section className="app-panel min-w-0 p-6" aria-label="تفاصيل الجرد">
          {selected ? <div className="space-y-6">
            <div className="border-b border-white/10 pb-5"><p className="app-muted text-xs">{countStatusLabel[selected.status]}</p><h2 className="mt-2 text-xl font-bold leading-8">{selected.product_name}</h2><p className="app-muted mt-1 text-sm">{selected.sku} · {selected.counter}</p></div>
            <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="app-muted text-xs">المسجل</dt><dd className="mt-2 font-bold tabular-nums">{quantityText(selected.expected_quantity)}</dd></div><div><dt className="app-muted text-xs">الفعلي</dt><dd className="mt-2 font-bold tabular-nums">{quantityText(selected.observed_quantity)}</dd></div><div><dt className="app-muted text-xs">الفرق</dt><dd className="mt-2 font-bold tabular-nums" dir="auto">{signedQuantity(selected.difference)}</dd></div></dl>
            <div className="border-y border-white/10 py-4"><p className="app-muted text-xs">قيمة الفرق بسعر الشراء وقت الجرد</p><p className="mt-2 text-lg font-bold" dir="auto">{selected.difference_value === null ? "غير محفوظ للجرد القديم" : moneyText(selected.difference_value)}</p><p className="app-muted mt-1 text-xs">سعر الوحدة {selected.unit_cost === null ? "غير محفوظ" : moneyText(selected.unit_cost)}</p></div>
            <div><p className="app-muted text-xs">سبب فرق الجرد</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{selected.reason || "لا يوجد فرق"}</p></div>
            {selected.rejection_reason && <div><p className="app-muted text-xs">سبب الرفض</p><p className="mt-2 text-sm leading-7">{selected.rejection_reason}</p></div>}
            {selected.reviewed_at && <p className="app-muted text-xs">قرار {selected.reviewer || "المدير"} · {new Date(selected.reviewed_at).toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}</p>}
            {selected.status === "PENDING" && <div className="flex flex-wrap gap-2 border-t border-white/10 pt-5"><button type="button" className="app-primary-button" onClick={() => setDecision("approve")}>اعتماد وتحديث الرصيد</button><button type="button" className="app-secondary-button" onClick={() => setDecision("reject")}>رفض الجرد</button></div>}
          </div> : <div className="app-muted flex min-h-72 items-center justify-center text-center text-sm">اختر صنفًا لعرض تفاصيله.</div>}
        </section>
      </div>
    </main>
    {decision && selected && <div className="motion-overlay fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={decision === "approve" ? "تأكيد اعتماد الجرد" : "تأكيد رفض الجرد"}>
      <div className="motion-dialog app-panel w-full max-w-md space-y-5 p-6"><h2 className="text-lg font-bold">{decision === "approve" ? "اعتماد فرق الجرد؟" : "رفض فرق الجرد؟"}</h2>
        <p className="app-muted text-sm leading-7">{selected.product_name} · {decision === "approve" ? `سيصبح الرصيد ${quantityText(selected.observed_quantity)} بعد التحقق من عدم تغيّره.` : "لن يتغير الرصيد، وسيصل سبب الرفض لمسؤول الجرد."}</p>
        {decision === "reject" && <div><label htmlFor="count-rejection-reason" className="mb-2 block text-sm">سبب الرفض</label><textarea id="count-rejection-reason" className="app-field min-h-24" maxLength={500} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} /></div>}
        <div className="flex flex-wrap gap-2"><button type="button" className="app-primary-button" disabled={busy || (decision === "reject" && rejectionReason.trim().length < 3)} onClick={() => void decide()}>{busy ? "جارٍ الحفظ…" : "تأكيد القرار"}</button><button type="button" className="app-secondary-button" disabled={busy} onClick={() => { setDecision(null); setRejectionReason(""); }}>إلغاء</button></div>
      </div></div>}
  </div>;
}
