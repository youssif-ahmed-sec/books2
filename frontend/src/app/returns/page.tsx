"use client";

import { useEffect, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { getUserRole } from "@/utils/auth";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

type Order = { id: string; status: string; total_amount: number; customer_id: string | null };
type EligibleItem = { order_item_id: string; product_name: string; remaining_quantity: number; unit_price: number };
type Eligibility = { warehouse_id: string; payment_method: string; customer_price_level: string; items: EligibleItem[] };
type Product = { id: string; name_ar: string; units: { id: string; unit_name: string; prices: { price_level: string; price: number }[] }[] };
type ReturnRecord = { id: string; kind: string; refund_amount: number; charge_amount: number; payment_method: string; created_at: string };

export default function ReturnsPage() {
  const [orders, setOrders] = useState<Order[]>(() => readSectionSnapshot<Order[]>("returnable-orders") || []);
  const [orderId, setOrderId] = useState("");
  useSectionSearchSelection(setOrderId);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<"REFUND" | "EXCHANGE">("REFUND");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [replacement, setReplacement] = useState<{ product_id: string; unit_id: string; price_level: string; quantity: number } | null>(null);
  const [history, setHistory] = useState<ReturnRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchApi("/orders").then((data: Order[]) => { const rows = data.filter(order => ["Delivered", "Closed"].includes(order.status)); setOrders(rows); writeSectionSnapshot("returnable-orders", rows); }).catch(error => setMessage(errorMessage(error, "تعذر تحميل الفواتير")));
  }, []);

  useEffect(() => {
    if (!orderId) { const timer = window.setTimeout(() => { setEligibility(null); setHistory([]); }, 0); return () => window.clearTimeout(timer); }
    const messageTimer = window.setTimeout(() => setMessage(""), 0);
    Promise.all([fetchApi(`/returns/eligibility/${orderId}`), fetchApi(`/returns?order_id=${orderId}`)])
      .then(([eligible, records]) => { setEligibility(eligible); setHistory(records); setQuantities({}); })
      .catch(error => { setEligibility(null); setMessage(errorMessage(error, "الفاتورة غير قابلة للإرجاع")); });
    return () => window.clearTimeout(messageTimer);
  }, [orderId]);

  useEffect(() => {
    if (!search.trim() || kind !== "EXCHANGE") { const timer = window.setTimeout(() => setProducts([]), 0); return () => window.clearTimeout(timer); }
    const timer = setTimeout(() => {
      fetchApi(`/pos/search?q=${encodeURIComponent(search)}`).then(setProducts).catch(() => setProducts([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, kind]);

  const selectedProduct = products.find(product => product.id === replacement?.product_id);
  const selectedUnit = selectedProduct?.units.find(unit => unit.id === replacement?.unit_id);
  const selectedPrice = selectedUnit?.prices.find(price => price.price_level === replacement?.price_level);
  const selectedLines = eligibility?.items.filter(item => (quantities[item.order_item_id] || 0) > 0) || [];
  const estimatedReturn = selectedLines.reduce((sum, item) => sum + item.unit_price * quantities[item.order_item_id], 0);
  const estimatedReplacement = (replacement?.quantity || 0) * (selectedPrice?.price || 0);

  async function submit() {
    if (!orderId || !eligibility || !selectedLines.length) { setMessage("اختر كمية مرتجعة أولًا"); return; }
    if (kind === "EXCHANGE" && (!replacement || !selectedPrice || replacement.quantity <= 0)) { setMessage("اختر صنف الاستبدال ووحدته وكميته"); return; }
    const action = kind === "REFUND" ? "رد المبلغ بنفس وسيلة الدفع" : "إتمام الاستبدال وتسوية الفرق بنفس وسيلة الدفع";
    if (!window.confirm(`تأكيد ${action} (${eligibility.payment_method})؟ تأكد من تنفيذ أي رد مال لدى مزود الدفع قبل التأكيد.`)) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        request_id: crypto.randomUUID(), order_id: orderId, warehouse_id: eligibility.warehouse_id, kind,
        settlement_confirmed: true,
        lines: selectedLines.map(item => ({ order_item_id: item.order_item_id, quantity: quantities[item.order_item_id] })),
        replacements: kind === "EXCHANGE" && replacement ? [replacement] : [],
      };
      const record = await fetchApi("/returns", { method: "POST", body: JSON.stringify(payload) });
      setMessage(`تم التسجيل. ${record.refund_amount > 0 ? `المرتد: ${record.refund_amount}` : `المحصّل: ${record.charge_amount}`} ج.م عبر ${record.payment_method}`);
      const [eligible, records] = await Promise.all([fetchApi(`/returns/eligibility/${orderId}`), fetchApi(`/returns?order_id=${orderId}`)]);
      setEligibility(eligible); setHistory(records); setQuantities({}); setReplacement(null); setSearch("");
    } catch (error) { setMessage(errorMessage(error, "تعذر تسجيل المرتجع")); }
    finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-[#131313] text-white flex" dir="rtl">
    <SideNav /><TopNav title="المرتجعات والاستبدال" />
    <main className="mx-4 mt-28 mb-8 flex-1 min-w-0 lg:mr-[364px] lg:mt-36 space-y-5">
      <h1 className="text-2xl font-bold">المرتجعات والاستبدال</h1>
      {message && <p role="status" className="rounded-xl border border-primary/40 bg-primary/10 p-4">{message}</p>}
      <section className="glass rounded-2xl p-5 space-y-4">
        <label className="block text-sm">الفاتورة</label>
        <select className="w-full rounded-xl bg-black p-3" value={orderId} onChange={event => setOrderId(event.target.value)}>
          <option value="">اختر فاتورة مدفوعة أو مسلّمة</option>
          {orders.map(order => <option value={order.id} key={order.id}>{order.id.slice(0, 8)} — {order.total_amount.toFixed(2)} ج.م</option>)}
        </select>
        {eligibility && <p className="text-sm text-white/70">وسيلة التسوية الأصلية: {eligibility.payment_method}</p>}
      </section>
      {eligibility && <section className="glass rounded-2xl p-5 space-y-4">
        <h2 className="text-lg font-bold">الأصناف المتاحة للإرجاع</h2>
        {eligibility.items.every(item => item.remaining_quantity <= 0) && <p className="text-white/60">تم إرجاع كل كميات الفاتورة.</p>}
        {eligibility.items.filter(item => item.remaining_quantity > 0).map(item => <div key={item.order_item_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>{item.product_name} <span className="text-white/50 text-sm">(متاح {item.remaining_quantity}، سعر الوحدة {item.unit_price} ج.م)</span></div>
          <input aria-label={`كمية إرجاع ${item.product_name}`} type="number" min="0" max={item.remaining_quantity} step="0.01" className="w-28 rounded-lg bg-black p-2" value={quantities[item.order_item_id] || ""} onChange={event => setQuantities(previous => ({ ...previous, [item.order_item_id]: Math.min(item.remaining_quantity, Math.max(0, Number(event.target.value) || 0)) }))} />
        </div>)}
        <div className="flex gap-4"><label><input type="radio" checked={kind === "REFUND"} onChange={() => setKind("REFUND")} /> رد بنفس وسيلة الدفع</label><label><input type="radio" checked={kind === "EXCHANGE"} onChange={() => setKind("EXCHANGE")} /> استبدال</label></div>
        {kind === "EXCHANGE" && <div className="space-y-3 rounded-xl border border-white/10 p-4">
          <input className="w-full rounded-lg bg-black p-3" placeholder="ابحث عن الصنف البديل" value={search} onChange={event => setSearch(event.target.value)} />
          {products.length > 0 && <select className="w-full rounded-lg bg-black p-3" value={replacement?.product_id || ""} onChange={event => {
            const product = products.find(candidate => candidate.id === event.target.value);
            const unit = product?.units[0]; const price = unit?.prices.find(candidate => candidate.price_level === eligibility.customer_price_level) || unit?.prices[0];
            setReplacement(product && unit && price ? { product_id: product.id, unit_id: unit.id, price_level: price.price_level, quantity: 1 } : null);
          }}><option value="">اختر صنفًا</option>{products.map(product => <option key={product.id} value={product.id}>{product.name_ar}</option>)}</select>}
          {selectedProduct && replacement && <div className="flex flex-wrap gap-3">
            <select className="rounded-lg bg-black p-3" value={replacement.unit_id} onChange={event => { const unit = selectedProduct.units.find(candidate => candidate.id === event.target.value); setReplacement({ ...replacement, unit_id: event.target.value, price_level: unit?.prices.find(candidate => candidate.price_level === eligibility.customer_price_level)?.price_level || unit?.prices[0]?.price_level || "Retail" }); }}>{selectedProduct.units.map(unit => <option key={unit.id} value={unit.id}>{unit.unit_name}</option>)}</select>
            <select className="rounded-lg bg-black p-3" disabled={getUserRole() !== "ADMIN"} value={replacement.price_level} onChange={event => setReplacement({ ...replacement, price_level: event.target.value })}>{selectedUnit?.prices.map(price => <option key={price.price_level} value={price.price_level}>{price.price_level} — {price.price} ج.م</option>)}</select>
            <input aria-label="كمية الصنف البديل" type="number" min="0.01" step="0.01" className="w-28 rounded-lg bg-black p-3" value={replacement.quantity} onChange={event => setReplacement({ ...replacement, quantity: Number(event.target.value) || 0 })} />
          </div>}
        </div>}
        <p className="text-sm text-white/60">تقدير قبل خصم الفاتورة: المرتجع {estimatedReturn.toFixed(2)} ج.م، البديل {estimatedReplacement.toFixed(2)} ج.م. القيمة النهائية يحسبها النظام عند الحفظ.</p>
        <button disabled={busy || !selectedLines.length} onClick={submit} className="app-primary-button disabled:opacity-40">{busy ? "جارٍ الحفظ..." : "تأكيد العملية"}</button>
      </section>}
      {history.length > 0 && <section className="glass rounded-2xl p-5 space-y-3"><h2 className="text-lg font-bold">سجل عمليات الفاتورة</h2>{history.map(record => <p key={record.id} className="border-b border-white/10 pb-2">{record.kind === "REFUND" ? "مرتجع" : "استبدال"} — رد {record.refund_amount} / تحصيل {record.charge_amount} ج.م — {new Date(record.created_at).toLocaleString("ar-EG")}</p>)}</section>}
    </main>
  </div>;
}
