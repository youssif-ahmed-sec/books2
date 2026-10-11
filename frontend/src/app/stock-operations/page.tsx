"use client";

import { useEffect, useRef, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { warehouseOnlyMode } from "@/lib/warehouseMode";

type Warehouse = { id: string; name: string };
type Product = { id: string; name_ar: string; sku: string };
type Balance = { product_id: string; warehouse_id: string; current_stock: number };
type Pending = { fingerprint: string; requestId: string };

export default function StockOperationsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [observed, setObserved] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alerts, setAlerts] = useState<{ product_id: string; name: string; stock: number; minimum: number; severity: string }[]>([]);
  const pendingTransfer = useRef<Pending | null>(null);
  const pendingCount = useRef<Pending | null>(null);

  const loadBalances = () => fetchApi("/inventory/balances").then(setBalances);

  useEffect(() => {
    Promise.all([fetchApi("/inventory/warehouses"), fetchApi("/inventory/balances"), fetchApi("/reports/stock-alerts")])
      .then(([warehouseList, balanceList, lowStock]) => { setWarehouses(warehouseList); setBalances(balanceList); setAlerts(lowStock); })
      .catch(err => setError(errorMessage(err, "فشل تحميل المخزون")));
  }, []);

  useEffect(() => {
    if (!search.trim()) { setProducts([]); return; }
    const timer = setTimeout(() => {
      fetchApi(`/products?search=${encodeURIComponent(search)}&limit=30`)
        .then(page => setProducts(page.data || []))
        .catch(err => setError(errorMessage(err, "فشل البحث")));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const selectedSourceId = warehouses.length === 1 ? warehouses[0].id : sourceId;
  const current = Number(balances.find(row => row.product_id === productId && row.warehouse_id === selectedSourceId)?.current_stock || 0);

  const run = async (kind: "transfer" | "count") => {
    setError("");
    if (!productId || !selectedSourceId) { setError("حدد المنتج والمخزن"); return; }
    if (kind === "transfer" && (warehouseOnlyMode || !targetId || targetId === selectedSourceId || Number(quantity) <= 0)) {
      setError("حدد مخزنًا آخر وكمية موجبة"); return;
    }
    if (kind === "count" && (observed === "" || Number(observed) < 0)) {
      setError("أدخل الكمية الفعلية غير السالبة"); return;
    }
    if (kind === "count" && !window.confirm(`الرصيد الحالي ${current}، الرصيد بعد الجرد ${observed}. تسجيل التسوية؟`)) return;

    const details = kind === "transfer"
      ? { product_id: productId, source_warehouse_id: selectedSourceId, target_warehouse_id: targetId, quantity: Number(quantity) }
      : { product_id: productId, warehouse_id: selectedSourceId, observed_quantity: Number(observed) };
    const fingerprint = JSON.stringify(details);
    const pending = kind === "transfer" ? pendingTransfer : pendingCount;
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, requestId: crypto.randomUUID() };
    setBusy(true);
    try {
      await fetchApi(kind === "transfer" ? "/inventory/transfers" : "/inventory/counts", {
        method: "POST", body: JSON.stringify({ ...details, request_id: pending.current.requestId }),
      });
      pending.current = null;
      await loadBalances();
      setAlerts(await fetchApi("/reports/stock-alerts"));
      if (kind === "transfer") setQuantity(""); else setObserved("");
    } catch (err) {
      setError(errorMessage(err, "لم تكتمل العملية"));
    } finally {
      setBusy(false);
    }
  };

  return <div className="min-h-screen" dir="rtl">
    <SideNav /><TopNav title={warehouseOnlyMode ? "الجرد" : "النقل والجرد"} />
    <main className="app-main space-y-6">
      <div><h1 className="app-heading">{warehouseOnlyMode ? "الجرد" : "النقل والجرد"}</h1><p className="app-subtitle">الكميات هنا بالوحدة الأساسية للمنتج</p></div>
      {error && <div role="alert" className="app-panel p-4 text-red-300">{error}</div>}
      <section className="app-panel p-5"><h2 className="font-bold mb-3">تنبيهات المخزون المنخفض والنافد</h2>{alerts.length ? alerts.map(alert => <p key={alert.product_id} className="border-b border-white/10 py-2 text-sm">{alert.severity === "out" ? "نافد" : "منخفض"} — {alert.name}: {alert.stock} / الحد الأدنى {alert.minimum}</p>) : <p className="app-muted text-sm">لا توجد تنبيهات.</p>}</section>
      <section className="app-panel p-6 space-y-3">
        <label className="block text-sm">المنتج</label>
        <input className="app-field" placeholder="ابحث بالاسم أو الكود" value={search} onChange={event => setSearch(event.target.value)} />
        <ProductSelect label="المنتج" value={productId} onChange={setProductId} placeholder="اختر المنتج"
          options={products.map(product => ({ value: product.id, label: `${product.name_ar} · ${product.sku}` }))} />
        {warehouses.length === 1 ? <p className="app-muted text-sm">المخزن: <strong className="text-[#e5e2e1]">{warehouses[0].name}</strong></p> : warehouses.length > 1 ? <div className="space-y-2">
          <p className="app-muted text-sm">يوجد أكثر من مخزن مسجل؛ حدد المخزن المطلوب جرده.</p>
          <ProductSelect label="المخزن الحالي" value={sourceId} onChange={setSourceId} placeholder="اختر المخزن"
            options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} />
        </div> : <p role="alert" className="text-sm text-red-400">لا يوجد مخزن نشط للجرد.</p>}
        <p className="app-muted">الرصيد المسجل: {current}</p>
      </section>
      <div className={`grid gap-6 ${!warehouseOnlyMode && warehouses.length > 1 ? "lg:grid-cols-2" : "grid-cols-1"}`}>
        {!warehouseOnlyMode && warehouses.length > 1 && <section className="app-panel p-6 space-y-3">
          <h2 className="text-lg font-bold">نقل مخزني</h2>
          <ProductSelect label="المخزن المستلم" value={targetId} onChange={setTargetId} placeholder="المخزن المستلم"
            options={warehouses.filter(warehouse => warehouse.id !== selectedSourceId).map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} />
          <input className="app-field" type="number" min="0.01" step="0.01" placeholder="الكمية" value={quantity} onChange={event => setQuantity(event.target.value)} />
          <button className="app-primary-button" disabled={busy} onClick={() => run("transfer")}>تنفيذ النقل</button>
        </section>}
        <section className="app-panel p-6 space-y-3">
          <h2 className="text-lg font-bold">جرد وتسوية</h2>
          <input className="app-field" type="number" min="0" step="0.01" placeholder="الكمية الفعلية" value={observed} onChange={event => setObserved(event.target.value)} />
          <p className="app-muted">الفرق: {observed === "" ? "—" : (Number(observed) - current).toFixed(2)}</p>
          <button className="app-primary-button" disabled={busy || !selectedSourceId} onClick={() => run("count")}>تسجيل الجرد</button>
        </section>
      </div>
    </main>
  </div>;
}
