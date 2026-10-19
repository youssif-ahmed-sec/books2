"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import AdminGate from "@/components/AdminGate";
import { readSectionSnapshot, sectionSnapshotRevision, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { RankedBars, SalesCompositionChart, SalesTrendChart, SourceDonut, type SalesPoint } from "@/components/analytics/Charts";
import { orderSourceLabels } from "@/lib/orderLabels";

type Overview = {
  total_revenue: number; total_orders: number; pending_orders: number; total_products: number; active_products: number;
  today_sales: number; monthly_sales: number; gross_profit: number | null; net_profit: number | null;
  cash_movement: number; open_drawer_cash: number; customer_debt: number;
  low_stock_count: number; out_of_stock_count: number;
  stock_alerts: { product_id: string; name: string; stock: number; minimum: number; severity: string }[];
  sales_trend: SalesPoint[];
};
type RankedRow = { id: string; name: string; net_sales: number };
type Details = {
  top_products: RankedRow[]; top_categories: RankedRow[]; top_customers: RankedRow[];
  sales_by_source: Record<string, number>; new_customers: number; returning_customers: number;
  delayed_orders_count: number; delayed_orders: { id: string; hours: number }[];
  suppliers: { id: string; name: string; balance: number | null; statement_incomplete: boolean; orders: number; received_orders: number }[];
};

const money = (value: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value);
const moneyLabel = (value: number | null) => value === null ? "غير مكتمل" : `${money(value)} ج.م`;
type TrendDays = 7 | 14 | 30;
const periodOptions: TrendDays[] = [7, 14, 30];
const DASHBOARD_REQUEST_TIMEOUT_MS = 30000;
const toneStyles = {
  orange: { glow: "from-orange-500/15", icon: "text-primary" },
  teal: { glow: "from-teal-500/15", icon: "text-teal-400" },
  blue: { glow: "from-blue-500/15", icon: "text-blue-400" },
  rose: { glow: "from-rose-500/15", icon: "text-rose-400" },
};

function Metric({ label, value, note, icon, href, tone = "orange" }: {
  label: string; value: string; note: string; icon: string; href?: string; tone?: keyof typeof toneStyles;
}) {
  const content = <>
    <div className={`pointer-events-none absolute inset-0 bg-gradient-to-bl ${toneStyles[tone].glow} via-transparent to-transparent`} aria-hidden="true" />
    <div className="relative flex items-start justify-between gap-4"><span className="app-muted text-sm font-semibold">{label}</span><span className={`material-symbols-outlined rounded-xl bg-white/10 p-2 ${toneStyles[tone].icon}`} aria-hidden="true">{icon}</span></div>
    <strong className="relative mt-4 block text-2xl font-black tabular-nums sm:text-[1.8rem]">{value}</strong>
    <span className="app-muted relative mt-2 block text-xs">{note}</span>
  </>;
  const className = "app-panel relative block min-w-0 overflow-hidden rounded-2xl p-5 transition-colors hover:border-primary/30";
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

function DashboardLoading() {
  const cards = (count: number) => <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: count }, (_, index) =>
    <div key={index} className="app-panel relative space-y-4 overflow-hidden rounded-2xl p-5" aria-hidden="true">
      <div className="flex items-start justify-between gap-4"><span className="app-skeleton h-4 w-28" /><span className="app-skeleton h-9 w-9 rounded-xl" /></div>
      <span className="app-skeleton h-8 w-36 max-w-full" /><span className="app-skeleton h-3 w-40 max-w-full" />
    </div>)}</div>;
  const chart = (width: string) => <div className="app-panel min-w-0 rounded-2xl p-5 sm:p-6" aria-hidden="true">
    <span className="app-skeleton h-5 w-40 max-w-full" /><span className="app-skeleton mt-2 h-3 w-56 max-w-full" />
    <span className={`app-skeleton mt-5 h-56 max-w-full rounded-xl ${width}`} />
  </div>;
  return <div className="space-y-6" role="status" aria-label="جاري تحميل اللوحة الرئيسية">
    <span className="sr-only">جاري تحميل اللوحة الرئيسية</span>
    {cards(4)}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">{chart("w-full")}{chart("w-full")}</div>
    {cards(4)}
    <div className="grid gap-4 lg:grid-cols-2">{chart("w-full")}{chart("w-full")}</div>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className="app-panel space-y-4 rounded-2xl p-5 sm:p-6" aria-hidden="true"><span className="app-skeleton h-5 w-32" /><span className="app-skeleton h-3 w-48 max-w-full" />{[0, 1, 2].map(row => <div key={row} className="flex justify-between gap-4"><span className="app-skeleton h-4 w-24" /><span className="app-skeleton h-4 w-20" /></div>)}</div>)}</div>
  </div>;
}

export default function DashboardPage() { return <AdminGate><DashboardContent /></AdminGate>; }

function DashboardContent() {
  const [trendDays, setTrendDays] = useState<TrendDays>(14);
  const [overview, setOverview] = useState<Overview | null>(() => readSectionSnapshot<Overview>("dashboard-overview-14"));
  const [details, setDetails] = useState<Details | null>(() => readSectionSnapshot<Details>("dashboard-details"));
  const [loading, setLoading] = useState(!readSectionSnapshot("dashboard-overview-14"));
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState(false);
  const [liveState, setLiveState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [revision, setRevision] = useState(0);
  const lastInvalidation = useRef(-1);
  const refresh = useCallback(() => { setLoading(true); setError(""); setDetailsError(false); setRevision(value => value + 1); }, []);
  const retryIfInvalidated = useCallback((startedAt: number) => {
    const current = sectionSnapshotRevision();
    if (current === startedAt) return false;
    if (lastInvalidation.current !== current) {
      lastInvalidation.current = current;
      refresh();
    }
    return true;
  }, [refresh]);
  const changePeriod = (days: TrendDays) => {
    if (days === trendDays) return;
    setTrendDays(days);
    setOverview(readSectionSnapshot<Overview>(`dashboard-overview-${days}`) ?? overview);
    setLoading(true);
    setError("");
  };

  useEffect(() => {
    let active = true;
    let invalidated = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DASHBOARD_REQUEST_TIMEOUT_MS);
    const startedAt = sectionSnapshotRevision();
    fetchApi(`/dashboards/management?trend_days=${trendDays}`, { silentErrors: true, signal: controller.signal }).then((value: Overview) => {
      if (!active) return;
      if (retryIfInvalidated(startedAt)) { invalidated = true; return; }
      setOverview(value);
      writeSectionSnapshot(`dashboard-overview-${trendDays}`, value);
    }).catch(() => { if (active) setError("تعذر تحديث مؤشرات اللوحة. البيانات المعروضة إن وجدت من آخر تحميل ناجح؛ حاول مرة أخرى."); })
      .finally(() => { window.clearTimeout(timeout); if (active && !invalidated) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [revision, trendDays, retryIfInvalidated]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DASHBOARD_REQUEST_TIMEOUT_MS);
    const startedAt = sectionSnapshotRevision();
    fetchApi("/dashboards/management-details", { silentErrors: true, signal: controller.signal }).then((value: Details) => {
      if (!active) return;
      if (retryIfInvalidated(startedAt)) return;
      setDetails(value);
      setDetailsError(false);
      writeSectionSnapshot("dashboard-details", value);
    }).catch(() => { if (active) setDetailsError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [revision, retryIfInvalidated]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let reconnectTimer: number | undefined;
    let eventTimer: number | undefined;
    let retryDelay = 1000;
    const stop = () => {
      controller?.abort();
      controller = null;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(eventTimer);
    };
    const scheduleRefresh = () => {
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(refresh, 150);
    };
    const connect = async () => {
      if (!active || document.visibilityState !== "visible") return;
      controller = new AbortController();
      const requestController = controller;
      let accessDenied = false;
      setLiveState("connecting");
      try {
        const token = localStorage.getItem("access_token");
        if (!token) return;
        const response = await fetch("/api/v1/dashboards/management/events", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: requestController.signal,
        });
        if (response.status === 401 || response.status === 403) {
          accessDenied = true;
          refresh();
          return;
        }
        if (!response.ok || !response.body) throw new Error("Live dashboard connection failed");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active && !requestController.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const message = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (message === "data: ready") {
              setLiveState("connected");
              retryDelay = 1000;
              scheduleRefresh();
            } else if (message === "data: changed") scheduleRefresh();
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // Reconnect below; the manual refresh remains available.
      } finally {
        if (controller === requestController) controller = null;
        if (active && document.visibilityState === "visible" && !requestController.signal.aborted && !accessDenied) {
          setLiveState("disconnected");
          reconnectTimer = window.setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void connect();
      else { stop(); setLiveState("connecting"); }
    };
    void connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const sourceRows = Object.entries(details?.sales_by_source || {}).map(([source, value]) => ({
    name: orderSourceLabels[source] || source, value: Number(value),
  }));
  const hasSales = overview?.sales_trend.some(point => point.sales !== 0 || point.returns !== 0) ?? false;
  const trendOutdated = overview?.sales_trend.length !== trendDays;
  const stockTotal = overview?.active_products ?? overview?.total_products ?? 0;
  const stockHealthy = overview ? Math.max(0, stockTotal - overview.low_stock_count - overview.out_of_stock_count) : 0;
  const healthyPercent = stockTotal ? stockHealthy / stockTotal * 100 : 0;
  const lowPercent = stockTotal ? overview!.low_stock_count / stockTotal * 100 : 0;

  return <div className="min-h-screen" dir="rtl"><SideNav /><TopNav title="لوحة الإدارة" />
    <main className="app-main"><div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="app-heading">اللوحة الرئيسية</h1></div>
        <button type="button" onClick={refresh} disabled={loading} className="app-secondary-button flex items-center gap-2 disabled:opacity-60"><span className="material-symbols-outlined text-lg" aria-hidden="true">refresh</span>{loading ? "جاري التحديث" : "تحديث الأرقام"}</button>
      </header>
      {error && <div role="alert" className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-xl border-red-500/30 p-4 text-sm text-red-300"><span>{error}</span><button type="button" className="underline" onClick={refresh}>إعادة المحاولة</button></div>}
      {detailsError && <div role="alert" className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-xl border-amber-500/30 p-4 text-sm text-amber-400"><span>تعذر تحديث تفاصيل الرسومات والقوائم. البيانات المعروضة إن وجدت من آخر تحميل ناجح.</span><button type="button" className="underline" onClick={refresh}>إعادة المحاولة</button></div>}
      {liveState === "disconnected" && <p role="status" className="app-muted text-xs">التحديث المباشر غير متصل حاليًا. يمكنك استخدام زر تحديث الأرقام.</p>}
      {loading && overview && <p role="status" className="app-muted text-xs">جاري تحديث الأرقام المعروضة...</p>}
      {loading && !overview ? <DashboardLoading /> : overview ? <>
        {overview.total_orders === 0 && overview.total_products === 0 && <section className="app-panel rounded-2xl border-primary/25 bg-gradient-to-l from-primary/10 to-transparent p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-bold">ابدأ بيانات التجربة</h2><p className="app-muted mt-1 text-sm">الرسومات تعرض العمليات الحقيقية فقط. أضف منتجًا ثم سجل عملية بيع لتظهر اتجاهات الأداء.</p></div><div className="flex flex-wrap gap-2"><Link className="app-secondary-button" href="/inventory">إضافة منتج</Link><Link className="app-secondary-button" href="/pos">فتح نقطة البيع</Link></div></div></section>}
        <section aria-label="المؤشرات الأساسية" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="مبيعات اليوم" value={moneyLabel(overview.today_sales)} note="صافي البيع بعد المرتجعات" icon="point_of_sale" href="/reports" />
          <Metric label="مبيعات الشهر" value={moneyLabel(overview.monthly_sales)} note="من بداية الشهر الحالي" icon="trending_up" href="/reports" tone="teal" />
          <Metric label="طلبات تحتاج متابعة" value={String(overview.pending_orders)} note={`من ${overview.total_orders} طلب إجمالًا`} icon="pending_actions" href="/orders" tone="blue" />
          <Metric label="نقدية الورديات المفتوحة" value={moneyLabel(overview.open_drawer_cash)} note="للإدارة فقط" icon="payments" href="/cash-register" tone="rose" />
        </section>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
          <section className="app-panel min-w-0 rounded-2xl p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-bold">اتجاه صافي المبيعات</h2><p className="app-muted text-xs">المبيعات بعد خصم المرتجعات · بتوقيت القاهرة</p></div><div className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1" aria-label="فترة الرسم">{periodOptions.map(days => <button key={days} type="button" aria-pressed={trendDays === days} onClick={() => changePeriod(days)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${trendDays === days ? "bg-primary text-white" : "app-muted hover:bg-white/10"}`}>{days} أيام</button>)}</div></div>{trendOutdated ? <div className="app-muted grid min-h-56 place-items-center text-sm">{loading ? `جاري تحميل رسم ${trendDays} يومًا...` : "تعذر تحميل الرسم لهذه الفترة. حاول التحديث."}</div> : hasSales ? <SalesTrendChart points={overview.sales_trend} /> : <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 text-center"><span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">show_chart</span><p className="app-muted text-sm">لا توجد مبيعات أو مرتجعات في آخر {trendDays} يومًا.</p><Link href="/reports" className="text-sm font-bold text-primary hover:underline">عرض التقارير</Link></div>}</section>
          <section className="app-panel rounded-2xl p-5 sm:p-6"><div className="mb-5"><h2 className="text-lg font-bold">صحة المخزون</h2></div><div className="flex flex-wrap items-center justify-center gap-6"><div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: stockTotal ? `conic-gradient(#22b8a7 0% ${healthyPercent}%, #f59e0b ${healthyPercent}% ${healthyPercent + lowPercent}%, #f87171 ${healthyPercent + lowPercent}% 100%)` : "conic-gradient(var(--color-surface-container-high) 0 100%)" }} role="img" aria-label={`${stockHealthy} متاح، ${overview.low_stock_count} منخفض، ${overview.out_of_stock_count} نافد`}><div className="app-panel grid h-28 w-28 place-content-center rounded-full text-center"><strong className="text-3xl font-black">{stockTotal}</strong><span className="app-muted text-xs">منتج</span></div></div><div className="min-w-36 space-y-3 text-sm"><div className="flex justify-between gap-5"><span><i className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-[#22b8a7]" />متاح</span><strong>{stockHealthy}</strong></div><div className="flex justify-between gap-5"><span><i className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />منخفض</span><strong>{overview.low_stock_count}</strong></div><div className="flex justify-between gap-5"><span><i className="ml-2 inline-block h-2.5 w-2.5 rounded-full bg-red-400" />نافد</span><strong>{overview.out_of_stock_count}</strong></div></div></div><Link href="/inventory" className="mt-6 block text-center text-sm font-bold text-primary hover:underline">مراجعة المخزون ←</Link></section>
        </div>
        <section aria-label="المؤشرات المالية والعملاء" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="صافي المبيعات التراكمي" value={moneyLabel(overview.total_revenue)} note="من بداية التسجيل" icon="receipt_long" tone="blue" />
          <Metric label="مجمل الربح" value={moneyLabel(overview.gross_profit)} note={overview.gross_profit === null ? "توجد تكاليف قديمة ناقصة" : "من بداية التسجيل"} icon="monitoring" tone="teal" />
          <Metric label="صافي الربح" value={moneyLabel(overview.net_profit)} note="بعد المصروفات والإيرادات الأخرى" icon="account_balance_wallet" />
          <Metric label="مديونية العملاء" value={moneyLabel(overview.customer_debt)} note="الرصيد الحالي" icon="account_balance" href="/customers" tone="rose" />
        </section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="app-panel min-w-0 rounded-2xl p-5 sm:p-6"><div className="mb-5"><h2 className="text-lg font-bold">المبيعات مقابل المرتجعات</h2></div>{trendOutdated ? <p className="app-muted py-12 text-center text-sm">{loading ? "جاري تحديث المقارنة..." : "تعذر تحديث المقارنة. حاول التحديث."}</p> : <SalesCompositionChart points={overview.sales_trend} />}</section>
          <section className="app-panel rounded-2xl p-5 sm:p-6"><div className="mb-5"><h2 className="text-lg font-bold">قنوات البيع · 30 يومًا</h2></div>{details ? <SourceDonut rows={sourceRows} /> : <p className="app-muted py-10 text-center text-sm">{detailsError ? "تعذر تحميل تفاصيل القنوات. حاول التحديث." : "جاري تحميل التفاصيل..."}</p>}</section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="mb-5 text-lg font-bold">أعلى المنتجات · 30 يومًا</h2>{details ? <RankedBars rows={details.top_products} /> : <p className="app-muted py-8 text-center text-sm">جاري تحميل التفاصيل...</p>}</section>
          <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="mb-5 text-lg font-bold">أعلى التصنيفات · 30 يومًا</h2>{details ? <RankedBars rows={details.top_categories} /> : <p className="app-muted py-8 text-center text-sm">جاري تحميل التفاصيل...</p>}</section>
          <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="mb-5 text-lg font-bold">أعلى العملاء · 30 يومًا</h2>{details ? <RankedBars rows={details.top_customers} /> : <p className="app-muted py-8 text-center text-sm">جاري تحميل التفاصيل...</p>}</section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">أولويات التشغيل</h2><div className="space-y-2 text-sm"><Link href="/orders" className="flex justify-between gap-3 rounded-xl bg-white/5 p-3 hover:bg-primary/10"><span>تجهيز متأخر</span><strong>{details?.delayed_orders_count ?? "…"}</strong></Link><Link href="/inventory" className="flex justify-between gap-3 rounded-xl bg-white/5 p-3 hover:bg-primary/10"><span>أصناف منخفضة أو نافدة</span><strong>{overview.low_stock_count + overview.out_of_stock_count}</strong></Link><Link href="/cash-register" className="flex justify-between gap-3 rounded-xl bg-white/5 p-3 hover:bg-primary/10"><span>حركة النقدية المسجلة</span><strong>{moneyLabel(overview.cash_movement)}</strong></Link></div>{overview.stock_alerts.length > 0 && <div className="mt-4 border-t border-white/10 pt-4"><p className="app-muted mb-2 text-xs">أولوية إعادة الطلب</p>{overview.stock_alerts.slice(0, 3).map(alert => <div key={alert.product_id} className="flex justify-between gap-3 py-1 text-sm"><span className="truncate">{alert.name}</span><span className="shrink-0 tabular-nums">{alert.stock} / {alert.minimum}</span></div>)}</div>}</section>
          <section className="app-panel rounded-2xl p-5 sm:p-6"><h2 className="text-lg font-bold">العملاء والموردون</h2>{details ? <div className="space-y-4 text-sm"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-white/5 p-4"><span className="app-muted text-xs">عملاء جدد اليوم</span><strong className="mt-2 block text-2xl">{details.new_customers}</strong></div><div className="rounded-xl bg-white/5 p-4"><span className="app-muted text-xs">عملاء متكررون</span><strong className="mt-2 block text-2xl">{details.returning_customers}</strong></div></div><div className="border-t border-white/10 pt-3"><p className="app-muted mb-2 text-xs">أرصدة الموردين</p>{details.suppliers.slice(0, 4).map(supplier => <div key={supplier.id} className="flex justify-between gap-3 py-1.5"><span className="truncate">{supplier.name}</span><strong className="shrink-0">{moneyLabel(supplier.balance)}</strong></div>)}{!details.suppliers.length && <p className="app-muted">لا يوجد موردون بعد.</p>}</div></div> : <p className="app-muted py-8 text-center text-sm">{detailsError ? "تعذر تحميل التفاصيل. حاول التحديث." : "جاري تحميل التفاصيل..."}</p>}</section>
        </div>
      </> : <div className="app-panel p-8 text-center">تعذر تحميل اللوحة. <button type="button" className="text-primary underline" onClick={refresh}>إعادة المحاولة</button></div>}
    </div></main>
  </div>;
}
