"use client";

export type SalesPoint = { date: string; sales: number; returns: number; net: number };
export type ActivityPoint = { date: string; incoming: number; outgoing: number };

const money = (value: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(value);
const dayLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });

export function SalesTrendChart({ points }: { points: SalesPoint[] }) {
  if (!points.length) return <p className="app-muted py-12 text-center">لا توجد بيانات للرسم.</p>;
  const values = points.map(point => point.net);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const left = 16, top = 16, width = 608, height = 184;
  const x = (index: number) => left + index * width / Math.max(points.length - 1, 1);
  const y = (value: number) => top + (max - value) * height / span;
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.net).toFixed(1)}`).join(" ");
  const zero = y(0);
  const fill = `${line} L${x(points.length - 1)},${zero} L${x(0)},${zero} Z`;
  const first = points[0].date;
  const last = points[points.length - 1].date;
  return <div>
    <div className="h-56 w-full" dir="ltr">
      <svg className="h-full w-full overflow-visible" viewBox="0 0 640 220" preserveAspectRatio="none" role="img" aria-label={`صافي المبيعات اليومي من ${dayLabel(first)} إلى ${dayLabel(last)}`}>
        <defs><linearGradient id="sales-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff6b00" stopOpacity=".32" /><stop offset="100%" stopColor="#ff6b00" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map(ratio => <line key={ratio} x1="16" x2="624" y1={top + height * ratio} y2={top + height * ratio} stroke="currentColor" opacity=".12" strokeDasharray="4 5" />)}
        <line x1="16" x2="624" y1={zero} y2={zero} stroke="currentColor" opacity=".25" />
        <path d={fill} fill="url(#sales-chart-fill)" />
        <path d={line} fill="none" stroke="#ff6b00" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(point.net)} r="5" fill="#ff6b00" stroke="var(--color-surface-container)" strokeWidth="2"><title>{`${dayLabel(point.date)}: صافي ${money(point.net)} ج.م، مبيعات ${money(point.sales)}، مرتجعات ${money(point.returns)}`}</title></circle>)}
      </svg>
    </div>
    <div className="app-muted flex justify-between text-xs"><span>{dayLabel(first)}</span><span>{dayLabel(last)}</span></div>
    <table className="sr-only"><caption>بيانات صافي المبيعات اليومية</caption><thead><tr><th>اليوم</th><th>المبيعات</th><th>المرتجعات</th><th>الصافي</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{point.sales}</td><td>{point.returns}</td><td>{point.net}</td></tr>)}</tbody></table>
  </div>;
}

export function SalesCompositionChart({ points }: { points: SalesPoint[] }) {
  if (!points.length || !points.some(point => point.sales || point.returns)) {
    return <p className="app-muted py-12 text-center text-sm">ستظهر مقارنة المبيعات والمرتجعات بعد تسجيل أول عملية.</p>;
  }
  const peak = Math.max(1, ...points.flatMap(point => [point.sales, point.returns]));
  return <div>
    <div className="flex h-48 items-end gap-1.5 border-b border-white/10 pb-1" dir="ltr" role="img" aria-label="مقارنة المبيعات والمرتجعات اليومية">
      {points.map(point => <div key={point.date} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${dayLabel(point.date)}: مبيعات ${money(point.sales)} ج.م، مرتجعات ${money(point.returns)} ج.م`}>
        <div className="w-1/2 min-h-[2px] rounded-t-sm bg-primary" style={{ height: `${point.sales / peak * 100}%` }} />
        <div className="w-1/2 min-h-[2px] rounded-t-sm bg-[#22b8a7]" style={{ height: `${point.returns / peak * 100}%` }} />
      </div>)}
    </div>
    <div className="app-muted mt-2 flex justify-between text-xs"><span>{dayLabel(points[0].date)}</span><span>{dayLabel(points[points.length - 1].date)}</span></div>
    <div className="mt-4 flex gap-5 text-xs"><span><i className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-primary" />المبيعات</span><span><i className="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-[#22b8a7]" />المرتجعات</span></div>
    <table className="sr-only"><caption>المبيعات والمرتجعات اليومية</caption><thead><tr><th>اليوم</th><th>المبيعات</th><th>المرتجعات</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{point.sales}</td><td>{point.returns}</td></tr>)}</tbody></table>
  </div>;
}

export function RankedBars({ rows, empty = "لا توجد مبيعات في الفترة." }: { rows: { id: string; name: string; net_sales: number }[]; empty?: string }) {
  if (!rows.length) return <p className="app-muted py-8 text-center text-sm">{empty}</p>;
  const largest = Math.max(1, ...rows.map(row => Math.max(row.net_sales, 0)));
  return <div className="space-y-4">{rows.map(row => <div key={row.id}>
    <div className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="truncate">{row.name}</span><strong className="shrink-0 tabular-nums">{money(row.net_sales)} ج.م</strong></div>
    <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, row.net_sales) / largest * 100}%` }} /></div>
  </div>)}</div>;
}

export function SourceDonut({ rows }: { rows: { name: string; value: number }[] }) {
  const positive = rows.filter(row => row.value > 0);
  const total = positive.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <p className="app-muted py-8 text-center text-sm">لا توجد مبيعات حسب المصدر في الفترة.</p>;
  const colors = ["#ff6b00", "#22b8a7", "#dcb27d", "#718fe7", "#d477b9"];
  return <div className="flex flex-col items-center gap-6 sm:flex-row">
    <div className="relative h-40 w-40 shrink-0" dir="ltr"><svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label="توزيع المبيعات حسب المصدر">
      <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" opacity=".09" strokeWidth="14" />
      {positive.map((row, index) => {
        const length = row.value / total * 276.46;
        const offset = positive.slice(0, index).reduce((sum, previous) => sum + previous.value / total * 276.46, 0);
        const segment = <circle key={row.name} cx="60" cy="60" r="44" fill="none" stroke={colors[index % colors.length]} strokeWidth="14" strokeDasharray={`${length} 276.46`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{`${row.name}: ${money(row.value)} ج.م`}</title></circle>;
        return segment;
      })}
    </svg><div className="absolute inset-0 flex flex-col items-center justify-center text-center"><strong className="text-lg tabular-nums">{money(total)}</strong><span className="app-muted text-xs">ج.م</span></div></div>
    <ul className="w-full space-y-2 text-sm">{positive.map((row, index) => <li key={row.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} /><span className="flex-1">{row.name}</span><strong className="tabular-nums">{Math.round(row.value / total * 100)}٪</strong></li>)}</ul>
  </div>;
}

export function ActivityBars({ points }: { points: ActivityPoint[] }) {
  if (!points.length) return <p className="app-muted py-8 text-center">لا توجد حركات مخزون في الفترة.</p>;
  const peak = Math.max(1, ...points.map(point => point.incoming + point.outgoing));
  return <div><div className="flex h-44 items-end gap-1.5" dir="ltr">{points.map(point => <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5" title={`${dayLabel(point.date)}: وارد ${point.incoming}، صادر ${point.outgoing}`}>
    <div className="w-full rounded-t-sm bg-[#22b8a7]" style={{ height: `${point.incoming / peak * 100}%` }} />
    <div className="w-full rounded-b-sm bg-primary" style={{ height: `${point.outgoing / peak * 100}%` }} />
  </div>)}</div><div className="app-muted mt-2 flex justify-between text-xs"><span>{dayLabel(points[0].date)}</span><span>{dayLabel(points[points.length - 1].date)}</span></div>
  <div className="mt-3 flex gap-4 text-xs"><span><i className="ml-1 inline-block h-2 w-2 rounded-full bg-[#22b8a7]" />وارد</span><span><i className="ml-1 inline-block h-2 w-2 rounded-full bg-primary" />صادر</span></div>
  <table className="sr-only"><caption>عدد حركات المخزون اليومية</caption><thead><tr><th>اليوم</th><th>وارد</th><th>صادر</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{point.incoming}</td><td>{point.outgoing}</td></tr>)}</tbody></table></div>;
}
