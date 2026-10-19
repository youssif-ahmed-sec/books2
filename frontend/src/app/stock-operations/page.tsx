"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/currentUser";
import { CountHistory, CountRecord, CountStatus, countErrorMessage, countStatusLabel, moneyText, quantityText, signedQuantity } from "@/lib/counts";
import { errorMessage } from "@/lib/errors";
import { notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { warehouseOnlyMode } from "@/lib/warehouseMode";

type Warehouse = { id: string; name: string };
type Product = { id: string; name_ar: string; sku: string; barcode: string | null; base_unit: string; cost: number | null; units: { barcode: string | null; conversion_factor: number }[] };
type Balance = { product_id: string; warehouse_id: string; warehouse_name?: string; current_stock: number };
type DraftLine = { product: Product; expected: number; observed: number; reason: string };
type Suggestion = { product_id: string; product_name: string; sku: string; last_counted_at: string | null; recent_variances: number };
type Pending = { fingerprint: string; requestId: string };
const validQuantity = (value: string) => /^(?:\d+|\d*\.\d{1,2})$/.test(value.trim()) && Number.isFinite(Number(value)) && Number(value) >= 0;

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="app-panel p-5"><p className="app-muted text-xs font-semibold">{label}</p><p className="mt-3 text-3xl font-bold tabular-nums" dir="auto">{value}</p><p className="app-muted mt-2 text-xs">{hint}</p></div>;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "").replace(/\r|\n/g, " ");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export default function StockOperationsPage() {
  const snapshot = () => readSectionSnapshot<{ warehouses: Warehouse[]; balances: Balance[] }>("stock-operations");
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => snapshot()?.warehouses || []);
  const [balances, setBalances] = useState<Balance[]>(() => snapshot()?.balances || []);
  const [loading, setLoading] = useState(() => !snapshot());
  const [countFeatureReady, setCountFeatureReady] = useState(false);
  const [checkingCountFeature, setCheckingCountFeature] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [observed, setObserved] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<CountHistory>({ items: [], total: 0 });
  const [historyFilter, setHistoryFilter] = useState<CountStatus | "ALL">("ALL");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const pendingSession = useRef<Pending | null>(null);
  const pendingTransfer = useRef<Pending | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const sourceId = warehouses.length === 1 ? warehouses[0].id : warehouseId;
  const productBalances = balances.filter(row => row.product_id === selectedProduct?.id);
  const inactiveStock = productBalances.filter(row => !warehouses.some(warehouse => warehouse.id === row.warehouse_id))
    .reduce((sum, row) => sum + Number(row.current_stock), 0);
  const current = Number(productBalances.find(row => row.warehouse_id === sourceId)?.current_stock || 0);
  const validObserved = validQuantity(observed);
  const difference = validObserved ? Number(observed) - current : null;
  const reasonNeeded = difference !== null && difference !== 0;
  const draftDifference = draft.filter(line => line.observed !== line.expected).length;
  const stockProductCount = new Set(balances.filter(row => Number(row.current_stock) > 0).map(row => row.product_id)).size;
  const matchingProducts = selectedProduct && !products.some(product => product.id === selectedProduct.id) ? [selectedProduct, ...products] : products;
  const targetStock = Number(balances.find(row => row.product_id === selectedProduct?.id && row.warehouse_id === targetId)?.current_stock || 0);

  const refreshData = async () => {
    const [warehouseRows, balanceRows] = await Promise.all([
      fetchApi("/inventory/warehouses") as Promise<Warehouse[]>,
      fetchApi("/inventory/balances") as Promise<Balance[]>,
    ]);
    setWarehouses(warehouseRows); setBalances(balanceRows);
    writeSectionSnapshot("stock-operations", { warehouses: warehouseRows, balances: balanceRows });
  };
  const refreshLists = async () => {
    const params = new URLSearchParams({ limit: "10" });
    if (historyFilter !== "ALL") params.set("status", historyFilter);
    const [nextSuggestions, nextHistory] = await Promise.all([
      fetchApi("/inventory/counts/suggestions") as Promise<Suggestion[]>,
      fetchApi(`/inventory/counts/history?${params}`) as Promise<CountHistory>,
    ]);
    setSuggestions(nextSuggestions); setHistory(nextHistory);
  };

  const loadHistory = async (nextFilter: CountStatus | "ALL", offset = 0) => {
    const params = new URLSearchParams({ limit: "10", offset: String(offset) });
    if (nextFilter !== "ALL") params.set("status", nextFilter);
    const page = await fetchApi(`/inventory/counts/history?${params}`, { silentErrors: true }) as CountHistory;
    setHistory(previous => offset ? { total: page.total, items: [...previous.items, ...page.items] } : page);
  };

  useEffect(() => {
    getCurrentUser().then(user => setIsAdmin(user.role === "ADMIN")).catch(() => setIsAdmin(null));
    Promise.all([
      fetchApi("/inventory/warehouses") as Promise<Warehouse[]>,
      fetchApi("/inventory/balances") as Promise<Balance[]>,
    ]).then(([warehouseRows, balanceRows]) => {
      setWarehouses(warehouseRows); setBalances(balanceRows);
      writeSectionSnapshot("stock-operations", { warehouses: warehouseRows, balances: balanceRows });
    })
      .catch(err => setError(errorMessage(err, "تعذر تحميل أرصدة المخزون")))
      .finally(() => setLoading(false));
    Promise.all([
      fetchApi("/inventory/counts/suggestions", { silentErrors: true }) as Promise<Suggestion[]>,
      fetchApi("/inventory/counts/history?limit=10", { silentErrors: true }) as Promise<CountHistory>,
    ]).then(([nextSuggestions, nextHistory]) => {
      setSuggestions(nextSuggestions); setHistory(nextHistory); setCountFeatureReady(true);
    }).catch(() => setCountFeatureReady(false)).finally(() => setCheckingCountFeature(false));
  }, []);

  useEffect(() => {
    if (!search.trim()) return;
    const timer = window.setTimeout(() => {
      fetchApi(`/products?is_bundle=false&search=${encodeURIComponent(search)}&limit=30`, { silentErrors: true })
        .then(page => setProducts(page.data || [])).catch(() => setProducts([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const chooseProduct = (product: Product) => {
    setSelectedProduct(product); setObserved(""); setReason(""); setError("");
  };

  const scanSearch = async () => {
    const code = search.trim();
    if (!code) return;
    try {
      const page = await fetchApi(`/products?is_bundle=false&search=${encodeURIComponent(code)}&limit=30`, { silentErrors: true });
      const found = (page.data as Product[]).find(product =>
        product.sku.toLowerCase() === code.toLowerCase() || product.barcode === code ||
        product.units?.some(unit => unit.barcode === code));
      if (found) chooseProduct(found);
      else setError("الباركود غير مطابق لمنتج. اختر المنتج من نتائج البحث.");
    } catch (err) { setError(errorMessage(err, "تعذر البحث عن الباركود")); }
  };

  const selectSuggested = async (item: Suggestion) => {
    try {
      const page = await fetchApi(`/products?is_bundle=false&search=${encodeURIComponent(item.sku)}&limit=10`, { silentErrors: true });
      const product = (page.data as Product[]).find(row => row.id === item.product_id);
      if (!product) { setError("تعذر تحميل المنتج المقترح"); return; }
      setSearch(item.sku); chooseProduct(product); searchRef.current?.focus();
    } catch (err) { setError(errorMessage(err, "تعذر تحميل المنتج المقترح")); }
  };

  const addLine = () => {
    setError(""); setMessage("");
    if (!countFeatureReady) { setError("جلسات الجرد تنتظر تحديث السيرفر وقاعدة البيانات"); return; }
    if (!selectedProduct || !sourceId) { setError("حدد المنتج والمخزن"); return; }
    if (inactiveStock > 0) { setError("رصيد المنتج في مخزن غير نشط؛ صحح المخزن قبل الجرد"); return; }
    if (!validObserved) { setError("أدخل كمية فعلية صحيحة حتى خانتين عشريتين"); return; }
    if (reasonNeeded && reason.trim().length < 3) { setError("اكتب سبب أي فرق جرد من ٣ أحرف على الأقل"); return; }
    if (reason.trim() && reason.trim().length < 3) { setError("سبب الجرد يجب أن يكون ٣ أحرف على الأقل"); return; }
    if (draft.some(line => line.product.id === selectedProduct.id)) { setError("المنتج موجود في الجلسة؛ استخدم تعديل لتغيير عدّه"); return; }
    setDraft(previous => [...previous, { product: selectedProduct, expected: current, observed: Number(observed), reason: reason.trim() }]);
    setSelectedProduct(null); setSearch(""); setProducts([]); setObserved(""); setReason("");
    searchRef.current?.focus();
  };

  const editLine = (line: DraftLine) => {
    setDraft(previous => previous.filter(item => item.product.id !== line.product.id));
    setSelectedProduct(line.product); setSearch(line.product.sku);
    setObserved(String(line.observed)); setReason(line.reason); searchRef.current?.focus();
  };

  const sendSession = async () => {
    if (!countFeatureReady || isAdmin === null || !sourceId || !draft.length || submitting) return;
    setSubmitting(true); setError("");
    const lines = draft.map(line => ({ product_id: line.product.id, expected_quantity: line.expected, observed_quantity: line.observed, reason: line.reason || null }));
    const fingerprint = JSON.stringify({ warehouse_id: sourceId, lines });
    if (pendingSession.current?.fingerprint !== fingerprint) pendingSession.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const result = await fetchApi("/inventory/count-sessions", {
        method: "POST", body: JSON.stringify({ request_id: pendingSession.current.requestId, warehouse_id: sourceId, lines }),
      }) as { items: { status: string }[] };
      pendingSession.current = null;
      setDraft([]); setConfirming(false);
      setMessage(result.items.some(item => item.status === "PENDING")
        ? "اتسجل الجرد. الأصناف اللي فيها فرق بانتظار موافقة المدير، والرصيد لم يتغير لها."
        : draftDifference ? "تم اعتماد فروق الجرد وتحديث رصيد المنتجات مباشرة." : "اتسجل الجرد من غير فروق.");
      refreshNotificationBell();
      await Promise.all([refreshData(), refreshLists()]);
      notifySuccess(isAdmin ? "تم تسجيل جرد المدير" : "تم إرسال جلسة الجرد");
    } catch (err) { setConfirming(false); setError(countErrorMessage(err, "تعذر إرسال جلسة الجرد")); }
    finally { setSubmitting(false); }
  };

  const transfer = async () => {
    if (!selectedProduct || !sourceId || !targetId || sourceId === targetId || !validQuantity(quantity) || Number(quantity) <= 0) return;
    if (Number(quantity) > current) { setError("الكمية المطلوبة أكبر من رصيد المخزن"); return; }
    const details = { product_id: selectedProduct.id, source_warehouse_id: sourceId, target_warehouse_id: targetId, quantity: Number(quantity) };
    const fingerprint = JSON.stringify(details);
    if (pendingTransfer.current?.fingerprint !== fingerprint) pendingTransfer.current = { fingerprint, requestId: crypto.randomUUID() };
    setTransferBusy(true); setError("");
    try {
      await fetchApi("/inventory/transfers", { method: "POST", body: JSON.stringify({ ...details, request_id: pendingTransfer.current.requestId }) });
      pendingTransfer.current = null; setQuantity(""); await refreshData(); notifySuccess("تم النقل المخزني");
    } catch (err) { setError(errorMessage(err, "تعذر النقل المخزني")); }
    finally { setTransferBusy(false); }
  };

  const exportHistory = async () => {
    setExporting(true); setError("");
    try {
      const rows: CountRecord[] = [];
      let total = 0;
      do {
        const params = new URLSearchParams({ limit: "100", offset: String(rows.length) });
        if (historyFilter !== "ALL") params.set("status", historyFilter);
        const page = await fetchApi(`/inventory/counts/history?${params}`, { silentErrors: true }) as CountHistory;
        total = page.total; rows.push(...page.items);
        if (!page.items.length) break;
      } while (rows.length < total);
      const columns = ["التاريخ", "المنتج", "الكود", "المسجل", "الفعلي", "الفرق", "سعر الشراء", "قيمة الفرق", "السبب", "الحالة", "القائم بالجرد", "المدير", "سبب الرفض"];
      const data = [columns, ...rows.map(row => [row.created_at, row.product_name, row.sku, row.expected_quantity,
        row.observed_quantity, row.difference, row.unit_cost, row.difference_value, row.reason,
        countStatusLabel[row.status], row.counter, row.reviewer, row.rejection_reason])];
      const url = URL.createObjectURL(new Blob(["\uFEFF" + data.map(line => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `inventory-counts-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(errorMessage(err, "تعذر تصدير الجرد")); }
    finally { setExporting(false); }
  };

  return <div className="min-h-screen" dir="rtl">
    <SideNav /><TopNav title={warehouseOnlyMode ? "الجرد" : "النقل والجرد"} />
    <main className="app-main space-y-7">
      <div><h1 className="app-heading">جلسة الجرد</h1></div>
      {error && <p role="alert" className="stock-ops-warning app-panel p-4 text-sm">{error}</p>}
      {!checkingCountFeature && !countFeatureReady && <p role="status" className="stock-ops-warning app-panel p-4 text-sm">جلسات الجرد وموافقات المدير قيد تفعيل السيرفر وقاعدة البيانات. إدخال جرد جديد متوقف مؤقتًا لحماية الأرصدة.</p>}
      {message && <p role="status" className="app-panel border border-primary/20 p-4 text-sm leading-7">{message}</p>}
      <div className="grid gap-4 sm:grid-cols-3"><Metric label="أصناف لها رصيد" value={loading ? "—" : quantityText(stockProductCount)} hint="في المخزون" /><Metric label="أصناف في الجلسة" value={quantityText(draft.length)} hint="جاهزة للمراجعة" /><Metric label={isAdmin ? "فروق ستُعتمد مباشرة" : "فروق تحتاج المدير"} value={quantityText(draftDifference)} hint={isAdmin ? "يتحدث رصيدها عند تسجيل الجلسة" : "لن يتغير رصيدها قبل موافقته"} /></div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="app-panel min-w-0 space-y-4 p-6">
          <div><h2 className="text-lg font-bold">عدّ منتج</h2></div>
          {warehouses.length > 1 && <div><label className="mb-2 block text-sm" htmlFor="count-warehouse">المخزن</label><select id="count-warehouse" className="app-field" value={sourceId} disabled={draft.length > 0} onChange={event => setWarehouseId(event.target.value)}><option value="">اختر المخزن</option>{warehouses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></div>}
          {!loading && warehouses.length === 0 && <p role="alert" className="stock-ops-warning text-sm">لا يوجد مخزن نشط للجرد.</p>}
          <div><label className="mb-2 block text-sm" htmlFor="count-product-search">الباركود أو اسم المنتج</label><input ref={searchRef} id="count-product-search" className="app-field" value={search} onChange={event => { setSearch(event.target.value); if (!event.target.value.trim()) setProducts([]); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void scanSearch(); } }} placeholder="امسح الباركود أو اكتب الاسم" /></div>
          <ProductSelect label="المنتج" value={selectedProduct?.id || ""} onChange={id => { const product = matchingProducts.find(row => row.id === id); if (product) chooseProduct(product); }} placeholder="اختر المنتج" options={matchingProducts.map(product => ({ value: product.id, label: `${product.name_ar} · ${product.sku}` }))} />
          {selectedProduct && <div className="app-divider flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-3 text-sm"><span className="app-muted">الرصيد المسجل</span><strong className="text-lg tabular-nums">{quantityText(current)} {selectedProduct.base_unit}</strong></div>}
          {inactiveStock > 0 && <p role="alert" className="stock-ops-warning text-sm">للمنتج رصيد في مخزن غير نشط. يلزم تصحيح المخزن قبل جرده.</p>}
          <div><label className="mb-2 block text-sm" htmlFor="count-observed">الكمية الفعلية{selectedProduct ? ` (${selectedProduct.base_unit})` : ""}</label><input id="count-observed" className="app-field" type="number" min="0" step="0.01" value={observed} onChange={event => setObserved(event.target.value)} placeholder="أدخل العدد الفعلي" /></div>
          {selectedProduct && difference !== null && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="app-muted">فرق الجرد المتوقع</span><strong dir="auto">{signedQuantity(difference)} {selectedProduct.base_unit}</strong></div>}
          {reasonNeeded && <div><label className="mb-2 block text-sm" htmlFor="count-reason">سبب فرق الجرد <span className="text-primary">إجباري</span></label><textarea id="count-reason" className="app-field min-h-24" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder={isAdmin ? "اكتب سبب الفرق لتوثيق تعديل الرصيد" : "اشرح سبب الفرق ليقدر المدير يراجعه"} /></div>}
          <button type="button" className="app-primary-button w-full" disabled={!countFeatureReady || loading || !selectedProduct || !sourceId || inactiveStock > 0 || !validObserved || (reasonNeeded && reason.trim().length < 3)} onClick={addLine}>إضافة للجلسة</button>
        </section>
        <section className="app-panel min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-5"><div><h2 className="text-lg font-bold">مراجعة الجلسة</h2><p className="app-muted mt-1 text-xs">{isAdmin ? "فروق جرد المدير تُعتمد عند تأكيد الجلسة." : "كل صنف له قرار منفصل عند المدير إذا ظهر فرق."}</p></div></div>
          {draft.length ? <div className="max-h-[35rem] overflow-y-auto">{draft.map(line => <div key={line.product.id} className="app-table-row px-6 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate">{line.product.name_ar}</strong><span className="app-muted mt-1 block text-xs">{line.product.sku}</span></div><div className="flex gap-2"><button type="button" className="app-muted text-xs underline" onClick={() => editLine(line)}>تعديل</button><button type="button" className="text-xs text-red-300 underline" onClick={() => setDraft(previous => previous.filter(item => item.product.id !== line.product.id))}>حذف</button></div></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>مسجل: {quantityText(line.expected)}</span><span>فعلي: {quantityText(line.observed)}</span><strong dir="auto">فرق: {signedQuantity(line.observed - line.expected)}</strong></div>{line.reason && <p className="app-muted mt-2 text-xs leading-6">السبب: {line.reason}</p>}{line.observed !== line.expected && <p className="app-muted mt-1 text-xs">قيمة الفرق بسعر الشراء: {moneyText((line.observed - line.expected) * Number(line.product.cost || 0))}</p>}</div>)}</div>
            : <p className="app-muted px-6 py-16 text-center text-sm">الجلسة فارغة. ابدأ بمنتج واحد، ثم أكمل باقي الأصناف.</p>}
          <div className="border-t border-white/10 px-6 py-5"><button type="button" className="app-primary-button w-full" disabled={!countFeatureReady || isAdmin === null || !draft.length || submitting || !sourceId} onClick={() => setConfirming(true)}>مراجعة وإرسال الجلسة</button></div>
        </section>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="app-panel min-w-0 p-6"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">جرد دوري مقترح</h2><p className="app-muted mt-1 text-xs">لم يُجرد منذ ٣٠ يومًا، أو تكررت فروقه مرتين خلال ٩٠ يومًا.</p></div><span className="material-symbols-outlined text-primary" aria-hidden="true">calendar_month</span></div><div className="mt-4 max-h-72 overflow-y-auto">{suggestions.length ? suggestions.map(item => <button key={item.product_id} type="button" className="app-table-row flex w-full items-center justify-between gap-3 py-3 text-start" onClick={() => void selectSuggested(item)}><span className="min-w-0"><strong className="block truncate text-sm">{item.product_name}</strong><span className="app-muted text-xs">{item.last_counted_at ? `آخر جرد ${new Date(item.last_counted_at).toLocaleDateString("ar-EG")}` : "لم يُجرد بعد"}{item.recent_variances >= 2 ? ` · ${item.recent_variances} فروق حديثة` : ""}</span></span><span className="material-symbols-outlined text-primary" aria-hidden="true">arrow_back</span></button>) : <p className="app-muted py-9 text-center text-sm">لا توجد أصناف مستحقة للجرد حاليًا.</p>}</div></section>
        <section className="app-panel min-w-0 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">سجل الجرد</h2></div><button type="button" className="app-secondary-button !px-4 !py-2" disabled={exporting || !countFeatureReady} onClick={() => void exportHistory()}>{exporting ? "جارٍ التصدير…" : "تصدير CSV"}</button></div><div className="mt-4 w-full sm:w-56"><ProductSelect label="تصفية سجل الجرد" value={historyFilter} placeholder="كل الجرد" filter allowClear={false} disabled={!countFeatureReady} options={[{ value: "ALL", label: "كل الجرد" }, { value: "PENDING", label: "بانتظار المدير" }, { value: "APPROVED", label: "المعتمد" }, { value: "REJECTED", label: "المرفوض" }]} onChange={value => { const next = value as CountStatus | "ALL"; setHistoryFilter(next); void loadHistory(next).catch(err => setError(errorMessage(err, "تعذر تحميل سجل الجرد"))); }} /></div><div className="mt-4 max-h-72 overflow-y-auto">{history.items.length ? history.items.map(item => <div key={item.id} className="app-table-row py-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.product_name}</strong><span className="text-xs">{countStatusLabel[item.status]}</span></div><p className="app-muted mt-1 text-xs">{new Date(item.created_at).toLocaleString("ar-EG")} · {item.counter} · مسجل {quantityText(item.expected_quantity)} / فعلي {quantityText(item.observed_quantity)}</p><p className="app-muted mt-1 text-xs">فرق {signedQuantity(item.difference)} · {item.difference_value === null ? "قيمة الفرق غير محفوظة" : moneyText(item.difference_value)}</p>{item.reason && <p className="app-muted mt-1 text-xs">السبب: {item.reason}</p>}{item.rejection_reason && <p className="stock-ops-warning mt-1 text-xs">سبب الرفض: {item.rejection_reason}</p>}{item.reviewer && <p className="app-muted mt-1 text-xs">المدير: {item.reviewer}</p>}</div>) : <p className="app-muted py-9 text-center text-sm">لا يوجد جرد مسجل بعد.</p>}</div>{history.items.length < history.total && <button type="button" className="app-secondary-button mt-3 w-full" onClick={() => void loadHistory(historyFilter, history.items.length).catch(err => setError(errorMessage(err, "تعذر تحميل المزيد")))}>عرض المزيد</button>}</section>
      </div>
      {!warehouseOnlyMode && warehouses.length > 1 && <section className="app-panel space-y-4 p-6"><h2 className="text-lg font-bold">نقل مخزني</h2><p className="app-muted text-sm">اختر المنتج من حقل البحث بالأعلى ثم حدد المخزن المستلم.</p><ProductSelect label="المخزن المستلم" value={targetId} onChange={setTargetId} placeholder="اختر المخزن" options={warehouses.filter(row => row.id !== sourceId).map(row => ({ value: row.id, label: row.name }))} /><label htmlFor="transfer-quantity" className="block text-sm">الكمية المنقولة</label><input id="transfer-quantity" className="app-field" type="number" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} /><p className="app-muted text-sm">المصدر بعد النقل: {selectedProduct && validQuantity(quantity) ? quantityText(current - Number(quantity)) : "—"} · المستلم بعد النقل: {selectedProduct && validQuantity(quantity) ? quantityText(targetStock + Number(quantity)) : "—"}</p><button type="button" className="app-primary-button" disabled={transferBusy || !selectedProduct || !targetId || !validQuantity(quantity) || Number(quantity) <= 0 || Number(quantity) > current} onClick={() => void transfer()}>تنفيذ النقل</button></section>}
      <p className="app-muted text-xs">{isAdmin ? "فروق جرد المدير تحدث الرصيد فور تسجيلها مع حفظ السبب والحركة." : "فروق الجرد تحتاج موافقة المدير قبل تحديث المنتج."} <Link href="/inventory" className="text-primary underline">العودة للمخزون</Link></p>
    </main>
    {confirming && createPortal(<div className="motion-overlay fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" dir="rtl" role="dialog" aria-modal="true" aria-label="تأكيد إرسال جلسة الجرد"><div className="motion-dialog app-panel w-full max-w-md space-y-5 p-6"><h2 className="text-lg font-bold">إرسال جلسة الجرد؟</h2><p className="app-muted text-sm leading-7">ستُسجّل {quantityText(draft.length)} أصناف. {draftDifference ? isAdmin ? `${quantityText(draftDifference)} منها بها فروق؛ سيتحدث رصيدها مباشرة بعد التأكيد.` : `${quantityText(draftDifference)} منها بها فروق ستصل للمدير، ولن يتغير رصيدها إلا بعد موافقته.` : "لا توجد فروق، وستُسجّل نتائج العد مباشرة."}</p><div className="flex flex-wrap gap-2"><button type="button" className="app-primary-button" disabled={submitting} onClick={() => void sendSession()}>{submitting ? "جارٍ الإرسال…" : "تأكيد الإرسال"}</button><button type="button" className="app-secondary-button" disabled={submitting} onClick={() => setConfirming(false)}>إلغاء</button></div></div></div>, document.body)}
  </div>;
}
