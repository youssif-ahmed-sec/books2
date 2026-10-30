"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import { fetchApi } from "@/lib/api";
import { matchesSearch } from "@/lib/searchUtils";
import { TopNavSearchPortal } from "@/lib/topNavSearchPortal";

type Row = { product_id: string; name: string; base_unit: string; stock: number; minimum: number;
  quantity_sold: number; daily_rate: number; last_sold_at: string | null; days_since_sale: number | null;
  never_sold: boolean; dormant: boolean; low_stock: boolean; reorder_priority: boolean };
type Activity = { start_day: string; end_day: string; dormant_days: number; dormant_count: number;
  reorder_count: number; products: Row[] };
type View = "all" | "dormant" | "reorder";
const number = (value: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });

export default function ProductActivityPage() {
  const [endDay, setEndDay] = useState(today);
  const [startDay, setStartDay] = useState(() => `${today().slice(0, 7)}-01`);
  const [dormantDays, setDormantDays] = useState(90);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const invalid = endDay < startDay;

  useEffect(() => {
    if (invalid) return;
    let active = true;
    const params = new URLSearchParams({ start_day: startDay, end_day: endDay,
      dormant_days: String(dormantDays) });
    fetchApi(`/reports/product-activity?${params}`, { silentErrors: true })
      .then((result: Activity) => { if (active) { setData(result); setError(""); } })
      .catch(() => { if (active) setError("تعذر تحميل حركة الأصناف. حاول التحديث."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [startDay, endDay, dormantDays, invalid, revision]);

  const rows = useMemo(() => (data?.products || []).filter(row =>
    (view === "all" || (view === "dormant" ? row.dormant : row.reorder_priority)) &&
    matchesSearch(query, row.name)), [data, view, query]);
  const setSeason = (months: number) => {
    const end = new Date(`${today()}T12:00:00Z`);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - months);
    setStartDay(start.toISOString().slice(0, 10));
    setEndDay(today());
    setLoading(true);
  };

  return <AdminGate><div className="min-h-screen" dir="rtl">
    <main className="app-main space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><Link href="/reports" className="app-muted text-sm hover:text-primary">التقارير ←</Link><h1 className="app-heading">حركة الأصناف</h1></div><button type="button" className="app-secondary-button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>تحديث</button></header>
      <section className="app-panel flex flex-wrap items-end gap-3 rounded-2xl p-4" aria-label="فترة التقرير">
        <button type="button" className="app-secondary-button" onClick={() => { const now = today(); setStartDay(`${now.slice(0, 7)}-01`); setEndDay(now); setLoading(true); }}>الشهر الحالي</button>
        <button type="button" className="app-secondary-button" onClick={() => setSeason(3)}>آخر ٣ أشهر</button>
        <button type="button" className="app-secondary-button" onClick={() => setSeason(6)}>آخر ٦ أشهر</button>
        <label className="text-sm">من<input type="date" className="app-field mt-1 block" value={startDay} onChange={event => { setStartDay(event.target.value); setLoading(true); }} /></label>
        <label className="text-sm">إلى<input type="date" className="app-field mt-1 block" value={endDay} onChange={event => { setEndDay(event.target.value); setLoading(true); }} /></label>
        <label className="text-sm">خامل بعد<input type="number" min={30} max={365} className="app-field mt-1 block w-28" value={dormantDays} onChange={event => setDormantDays(Math.min(365, Math.max(30, Number(event.target.value) || 90)))} /></label>
      </section>
      {invalid && <p role="alert" className="text-red-300">تاريخ النهاية يسبق البداية.</p>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <section className="app-panel rounded-2xl p-4 sm:p-5">
        <TopNavSearchPortal><input type="search" className="app-search app-search-focus h-10 w-full rounded-full px-4 text-sm" placeholder="ابحث باسم الصنف في التقرير" aria-label="بحث الأصناف في التقرير" value={query} onChange={event => setQuery(event.target.value)} /></TopNavSearchPortal>
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2">{(["all", "dormant", "reorder"] as const).map(key => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`rounded-xl px-3 py-2 text-sm ${view === key ? "bg-primary text-white" : "bg-white/5"}`}>{key === "all" ? `كل الأصناف ${data?.products.length ?? ""}` : key === "dormant" ? `خاملة ${data?.dormant_count ?? ""}` : `تحتاج إعادة طلب ${data?.reorder_count ?? ""}`}</button>)}</div></div>
        <p className="app-muted mt-3 text-xs">المعدل بالوحدة الأساسية يوميًا خلال الفترة. الخمول محسوب من آخر بيع، أو تاريخ إضافة الصنف إن لم يُبع.</p>
        <div className="mt-4 space-y-2 md:hidden">{rows.map(row => <div key={row.product_id} className="rounded-xl border border-white/10 p-3 text-sm"><div className="flex items-start justify-between gap-3"><strong>{row.name}</strong><span className="shrink-0 text-primary">{row.dormant ? "راكد" : row.reorder_priority ? "راجع الطلب" : row.never_sold ? "جديد" : "نشط"}</span></div><div className="app-muted mt-2 flex flex-wrap gap-x-4 gap-y-1"><span>بيع {number(row.quantity_sold)} {row.base_unit}</span><span>يوميًا {number(row.daily_rate)}</span><span>المخزون {number(row.stock)}</span><span>آخر بيع {row.last_sold_at ? new Date(row.last_sold_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" }) : "لا يوجد"}</span></div></div>)}</div>
        <div className="mt-4 hidden overflow-x-auto md:block"><table className="w-full min-w-[660px] text-right text-sm"><thead className="app-table-head"><tr><th className="p-3">الصنف</th><th className="p-3">البيع</th><th className="p-3">المعدل اليومي</th><th className="p-3">آخر بيع</th><th className="p-3">المخزون</th><th className="p-3">التقييم</th></tr></thead><tbody>{rows.map(row => <tr key={row.product_id} className="app-table-row"><td className="p-3 font-bold">{row.name}</td><td className="p-3 tabular-nums">{number(row.quantity_sold)} {row.base_unit}</td><td className="p-3 tabular-nums">{number(row.daily_rate)}</td><td className="p-3">{row.last_sold_at ? new Date(row.last_sold_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" }) : "لم يُبع"}</td><td className="p-3 tabular-nums">{number(row.stock)}</td><td className="p-3">{row.dormant ? "راكد · راجع العرض" : row.reorder_priority ? "بيع نشط · راجع الطلب" : row.never_sold ? "صنف جديد · لم يُبع" : "طبيعي"}</td></tr>)}</tbody></table></div>
        {!loading && !rows.length && <p className="app-muted py-8 text-center text-sm">لا توجد أصناف مطابقة.</p>}
        {loading && <p role="status" className="app-muted py-5 text-center text-sm">جاري تحديث التقرير...</p>}
      </section>
    </main></div></AdminGate>;
}
