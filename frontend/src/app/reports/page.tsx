"use client";

import { useEffect, useMemo, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { LoadingTableRows } from "@/components/LoadingState";
import { SalesTrendChart, ActivityBars, type SalesPoint, type ActivityPoint } from "@/components/analytics/Charts";
import { fetchApi } from "@/lib/api";
import { roleHome } from "@/lib/roleHome";
import { orderSourceLabels, orderStatusLabels } from "@/lib/orderLabels";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { cachedCurrentUser } from "@/lib/currentUser";

type SalesRow = { id: string; customer_name?: string; employee_name?: string | null; source: string; status: string; final_total: number; created_at: string };
type InventoryRow = { id: string; employee_name?: string | null; quantity_changed: number; transaction_type: string; reference_document?: string; notes?: string; created_at: string };
type Page<T> = { data: T[]; offset: number; limit: number; has_more: boolean };
type FinancialSummary = { sales: number; returns: number; net_sales: number; gross_profit: number | null; net_profit: number | null; expenses: number; other_income: number; cash_movement: number; customer_debt: number; profit_incomplete: boolean };
type SalesReport = Page<SalesRow> & { metrics: { total_revenue: number; completed_orders: number; total_orders: number }; financial: FinancialSummary };
type Tab = "sales" | "inventory";
type Snapshot = { key: string; sales: SalesReport | null; inventory: Page<InventoryRow> | null; financial: FinancialSummary | null; salesTrend: SalesPoint[]; inventoryTrend: ActivityPoint[] };

const PAGE_SIZE = 50;
const inventoryTypeLabels: Record<string, string> = {
  Receiving: "استلام بضاعة", Issuing: "صرف بضاعة", Transfer: "نقل مخزون",
  Adjustment: "تسوية", Counting: "جرد",
};
const money = (value: number) => `${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value)} ج.م`;
const dateLabel = (value: string) => new Date(value).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });

function SummaryCard({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return <div className="app-panel min-w-0 rounded-2xl p-5"><p className="app-muted text-sm">{label}</p>{value === null ? <span className="app-skeleton mt-4 h-8 w-28" role="status" aria-label={`جاري تحميل ${label}`} /> : <strong className="mt-3 block text-2xl font-black tabular-nums text-primary">{value}</strong>}{note && <p className="app-muted mt-2 text-xs">{note}</p>}</div>;
}

export default function ReportsPage() {
  const saved = readSectionSnapshot<Snapshot>("reports-analytics");
  const [role, setRole] = useState<string | null>(() => cachedCurrentUser()?.role || null);
  const [tab, setTab] = useState<Tab>("sales");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [sales, setSales] = useState<SalesReport | null>(saved?.sales || null);
  const [inventory, setInventory] = useState<Page<InventoryRow> | null>(saved?.inventory || null);
  const [financial, setFinancial] = useState<FinancialSummary | null>(saved?.financial || null);
  const [salesTrend, setSalesTrend] = useState<SalesPoint[]>(saved?.salesTrend || []);
  const [inventoryTrend, setInventoryTrend] = useState<ActivityPoint[]>(saved?.inventoryTrend || []);
  const [loadedKey, setLoadedKey] = useState(saved?.key || "");
  const [financialKey, setFinancialKey] = useState(saved?.key || "");
  const [trendKey, setTrendKey] = useState(saved?.key || "");
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    fetchApi("/auth/me", { silentErrors: true }).then(user => {
      if (user.role !== "ADMIN") { window.location.href = roleHome(user.role); return; }
      setRole(user.role);
    }).catch(() => setRole(null));
  }, []);

  const invalidRange = Boolean(startDate && endDate && endDate < startDate);
  const key = `${tab}|${startDate}|${endDate}|${offset}`;
  const chartDays = useMemo(() => {
    if (!startDate) return 30;
    const until = endDate || new Date().toISOString().slice(0, 10);
    const span = Math.floor((Date.parse(until) - Date.parse(startDate)) / 86400000) + 1;
    return Math.max(7, Math.min(90, span || 30));
  }, [startDate, endDate]);

  useEffect(() => {
    if (!role || invalidRange) return;
    let active = true;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (startDate) params.set("start_date", new Date(`${startDate}T00:00:00`).toISOString());
    if (endDate) {
      const after = new Date(`${endDate}T00:00:00`);
      after.setDate(after.getDate() + 1);
      params.set("end_date", after.toISOString());
    }
    const chartParams = new URLSearchParams({ days: String(chartDays) });
    if (endDate) chartParams.set("end_day", endDate);
    const endpoint = tab === "sales" ? "/reports/sales" : "/reports/inventory";
    const trendEndpoint = tab === "sales" ? "/reports/sales-trend" : "/reports/inventory-trend";
    const currentKey = key;
    fetchApi(`${endpoint}?${params}`, { silentErrors: true }).then(result => {
      if (!active) return;
      if (tab === "sales") { setSales(result); setFinancial(result.financial); setFinancialKey(currentKey); }
      else setInventory(result);
      setLoadedKey(currentKey);
    }).catch(() => { if (active) setError("تعذر تحميل سجلات التقرير. حاول مرة أخرى."); })
      .finally(() => { if (active) setLoading(false); });
    fetchApi(`${trendEndpoint}?${chartParams}`, { silentErrors: true }).then(result => {
      if (!active) return;
      if (tab === "sales") setSalesTrend(result);
      else setInventoryTrend(result);
      setTrendKey(currentKey);
    }).catch(() => { if (active) setError("تعذر تحميل الرسم البياني."); })
      .finally(() => { if (active) setTrendLoading(false); });
    return () => { active = false; };
  }, [role, tab, startDate, endDate, offset, chartDays, invalidRange, key, revision]);

  useEffect(() => {
    if (loadedKey !== key) return;
    writeSectionSnapshot<Snapshot>("reports-analytics", { key,
      sales: tab === "sales" ? sales : null,
      inventory: tab === "inventory" ? inventory : null,
      financial: financialKey === key ? financial : null,
      salesTrend: tab === "sales" && trendKey === key ? salesTrend : [],
      inventoryTrend: tab === "inventory" && trendKey === key ? inventoryTrend : [],
    });
  }, [key, loadedKey, tab, sales, inventory, financial, financialKey, salesTrend, inventoryTrend, trendKey]);

  const switchTab = (next: Tab) => { setLoading(true); setTrendLoading(true); setError(""); setTab(next); setOffset(0); };
  const updateDate = (value: string, which: "start" | "end") => { setLoading(true); setTrendLoading(true); setError(""); if (which === "start") setStartDate(value); else setEndDate(value); setOffset(0); };
  const current = tab === "sales" ? sales : inventory;
  const showing = loadedKey === key;
  const shownFinancial = financialKey === key ? financial : null;
  const shownSalesTrend = trendKey === key ? salesTrend : [];
  const shownInventoryTrend = trendKey === key ? inventoryTrend : [];
  if (!role) return null;

  return <div className="min-h-screen" dir="rtl"><SideNav /><TopNav title="التقارير" /><main className="app-main"><div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="app-heading">التقارير</h1></div><div className="flex flex-wrap gap-2"><a className="app-secondary-button" href="/reports/product-activity">حركة الأصناف</a><button type="button" className="app-secondary-button" onClick={() => { setLoading(true); setTrendLoading(true); setError(""); setRevision(value => value + 1); }}>تحديث التقرير</button></div></header>
    <section className="app-panel flex flex-wrap items-end gap-3 rounded-2xl p-4 sm:p-5" aria-label="خيارات التقرير">
      <div className="flex flex-wrap gap-2">{role === "ADMIN" && <button type="button" onClick={() => switchTab("sales")} aria-pressed={tab === "sales"} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === "sales" ? "bg-primary text-white" : "bg-white/5 hover:bg-white/10"}`}>المبيعات والمالية</button>}<button type="button" onClick={() => switchTab("inventory")} aria-pressed={tab === "inventory"} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === "inventory" ? "bg-primary text-white" : "bg-white/5 hover:bg-white/10"}`}>حركة المخزون</button></div>
      <div className="flex flex-wrap gap-3 sm:mr-auto"><label className="text-xs app-muted">من تاريخ<input type="date" className="app-field mt-1 block text-sm" value={startDate} max={endDate || undefined} onChange={event => updateDate(event.target.value, "start")} /></label><label className="text-xs app-muted">إلى تاريخ<input type="date" className="app-field mt-1 block text-sm" value={endDate} min={startDate || undefined} onChange={event => updateDate(event.target.value, "end")} /></label>{(startDate || endDate) && <button type="button" className="self-end text-sm text-primary underline" onClick={() => { setLoading(true); setTrendLoading(true); setStartDate(""); setEndDate(""); setOffset(0); }}>مسح التاريخ</button>}</div>
    </section>
    {invalidRange && <p role="alert" className="text-red-300">تاريخ النهاية يجب أن يكون بعد تاريخ البداية.</p>}
    {error && <p role="alert" className="app-panel rounded-xl border-red-500/30 p-4 text-sm text-red-300">{error}</p>}
    {tab === "sales" ? <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="صافي المبيعات" value={showing && sales ? money(sales.metrics.total_revenue) : loading ? null : "—"} note="بعد المرتجعات للفترة المحددة" />
        <SummaryCard label="الطلبات المكتملة" value={showing && sales ? String(sales.metrics.completed_orders) : loading ? null : "—"} />
        <SummaryCard label="إجمالي الطلبات" value={showing && sales ? String(sales.metrics.total_orders) : loading ? null : "—"} />
        <SummaryCard label="مجمل الربح" value={shownFinancial ? shownFinancial.gross_profit === null ? "غير مكتمل" : money(shownFinancial.gross_profit) : loading ? null : "—"} note={shownFinancial?.profit_incomplete ? "توجد تكاليف قديمة ناقصة" : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]"><section className="app-panel min-w-0 rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">اتجاه المبيعات</h2><p className="app-muted mb-5 text-xs">صافي كل يوم · آخر {chartDays} يومًا من الفترة</p>{trendKey !== key && trendLoading ? <div className="app-skeleton h-56 w-full rounded-xl" role="status" aria-label="جاري تحميل اتجاه المبيعات" /> : <SalesTrendChart points={shownSalesTrend} />}</section><section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="mb-5 text-lg font-bold">تفاصيل مالية</h2>{shownFinancial ? <div className="space-y-3 text-sm">{[["مبيعات قبل المرتجعات", money(shownFinancial.sales)], ["المرتجعات", money(shownFinancial.returns)], ["المصروفات", money(shownFinancial.expenses)], ["إيرادات أخرى", money(shownFinancial.other_income)], ["صافي الربح", shownFinancial.net_profit === null ? "غير مكتمل" : money(shownFinancial.net_profit)], ["حركة النقدية", money(shownFinancial.cash_movement)], ["مديونية العملاء الحالية", money(shownFinancial.customer_debt)]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-white/10 py-2"><span className="app-muted">{label}</span><strong className="text-left tabular-nums">{value}</strong></div>)}</div> : <div className="space-y-4" role="status" aria-label="جاري تحميل التفاصيل المالية">{[0, 1, 2, 3].map(index => <div key={index} className="flex justify-between"><span className="app-skeleton h-4 w-28" /><span className="app-skeleton h-4 w-20" /></div>)}</div>}</section></div>
      <section className="app-panel overflow-hidden rounded-2xl"><div className="flex flex-wrap justify-between gap-3 p-5"><div><h2 className="font-bold">سجل الطلبات</h2></div>{loading && <span className="app-muted text-xs">جاري التحديث...</span>}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-right text-sm"><thead className="app-table-head text-xs"><tr><th className="p-4">الطلب</th><th className="p-4">العميل</th><th className="p-4">الموظف</th><th className="p-4">المصدر</th><th className="p-4">الحالة</th><th className="p-4">القيمة</th><th className="p-4">التاريخ</th></tr></thead><tbody>{!showing && loading ? <LoadingTableRows label="جاري تحميل سجل الطلبات" columns={7} /> : showing && sales?.data.map(row => <tr key={row.id} className="app-table-row"><td className="p-4 font-bold">{row.id.slice(0, 12)}</td><td className="p-4">{row.customer_name || "عميل عام"}</td><td className="p-4">{row.employee_name || "—"}</td><td className="p-4">{orderSourceLabels[row.source] || row.source}</td><td className="p-4">{orderStatusLabels[row.status] || row.status}</td><td className="p-4 font-bold tabular-nums">{money(row.final_total)}</td><td className="p-4">{dateLabel(row.created_at)}</td></tr>)}</tbody></table></div><div className="divide-y divide-white/10 md:hidden">{!showing && loading ? <div className="space-y-3 p-4" role="status" aria-label="جاري تحميل سجل الطلبات">{[0, 1, 2].map(index => <span key={index} className="app-skeleton h-14 w-full rounded-xl" />)}</div> : showing && sales?.data.map(row => <div key={row.id} className="space-y-2 p-4 text-sm"><div className="flex justify-between gap-2"><strong>#{row.id.slice(0, 12)}</strong><strong className="text-primary">{money(row.final_total)}</strong></div><p>{row.customer_name || "عميل عام"} · {row.employee_name || "—"} · {orderStatusLabels[row.status] || row.status}</p><p className="app-muted text-xs">{orderSourceLabels[row.source] || row.source} · {dateLabel(row.created_at)}</p></div>)}</div>{showing && !sales?.data.length && <p className="app-muted p-8 text-center">لا توجد طلبات في الفترة.</p>}</section>
    </> : <>
      <div className="grid gap-4 sm:grid-cols-2"><SummaryCard label="حركات هذه الصفحة" value={showing && inventory ? String(inventory.data.length) : loading ? null : "—"} note="السجل معروض على صفحات محدودة" /><SummaryCard label="الفترة المرسومة" value={`${chartDays} يومًا`} note="عدد العمليات اليومية، لا مجموع وحدات منتجات مختلفة" /></div>
      <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">نشاط المخزون</h2><p className="app-muted mb-5 text-xs">عدد الحركات الواردة والصادرة يوميًا</p>{trendKey !== key && trendLoading ? <div className="app-skeleton h-56 w-full rounded-xl" role="status" aria-label="جاري تحميل نشاط المخزون" /> : <ActivityBars points={shownInventoryTrend} />}</section>
      <section className="app-panel overflow-hidden rounded-2xl"><div className="flex justify-between gap-3 p-5"><h2 className="font-bold">سجل الحركات</h2>{loading && <span className="app-muted text-xs">جاري التحديث...</span>}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-right text-sm"><thead className="app-table-head text-xs"><tr><th className="p-4">نوع الحركة</th><th className="p-4">تغير الكمية</th><th className="p-4">المرجع</th><th className="p-4">الموظف</th><th className="p-4">ملاحظات</th><th className="p-4">التاريخ</th></tr></thead><tbody>{!showing && loading ? <LoadingTableRows label="جاري تحميل سجل الحركات" columns={6} /> : showing && inventory?.data.map(row => <tr key={row.id} className="app-table-row"><td className="p-4">{inventoryTypeLabels[row.transaction_type] || row.transaction_type}</td><td className="p-4 tabular-nums" dir="ltr">{row.quantity_changed > 0 ? "+" : ""}{row.quantity_changed}</td><td className="p-4">{row.reference_document || "—"}</td><td className="p-4">{row.employee_name || "—"}</td><td className="p-4">{row.notes || "—"}</td><td className="p-4">{dateLabel(row.created_at)}</td></tr>)}</tbody></table></div><div className="divide-y divide-white/10 md:hidden">{!showing && loading ? <div className="space-y-3 p-4" role="status" aria-label="جاري تحميل سجل الحركات">{[0, 1, 2].map(index => <span key={index} className="app-skeleton h-14 w-full rounded-xl" />)}</div> : showing && inventory?.data.map(row => <div key={row.id} className="space-y-2 p-4 text-sm"><div className="flex justify-between gap-3"><strong>{inventoryTypeLabels[row.transaction_type] || row.transaction_type}</strong><strong dir="ltr">{row.quantity_changed > 0 ? "+" : ""}{row.quantity_changed}</strong></div><p className="app-muted text-xs">{row.reference_document || "بدون مرجع"} · {row.employee_name || "—"} · {dateLabel(row.created_at)}</p>{row.notes && <p>{row.notes}</p>}</div>)}</div>{showing && !inventory?.data.length && <p className="app-muted p-8 text-center">لا توجد حركات في الفترة.</p>}</section>
    </>}
    <nav className="flex items-center justify-between gap-3" aria-label="صفحات التقرير"><button type="button" className="app-secondary-button disabled:opacity-40" disabled={loading || offset === 0} onClick={() => { setLoading(true); setTrendLoading(true); setOffset(value => Math.max(0, value - PAGE_SIZE)); }}>السابق</button><span className="app-muted text-sm">صفحة {Math.floor(offset / PAGE_SIZE) + 1}</span><button type="button" className="app-secondary-button disabled:opacity-40" disabled={loading || !showing || !current?.has_more} onClick={() => { setLoading(true); setTrendLoading(true); setOffset(value => value + PAGE_SIZE); }}>التالي</button></nav>
  </div></main></div>;
}
