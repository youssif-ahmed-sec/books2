"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { getUserRole } from "@/utils/auth";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { printSalesReturnReceipt } from "@/lib/localPrint";
import { emptyBarcodeScanCapture, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";

type Order = { id: string; public_number: number; status: string; total_amount: number; customer_id: string | null };
type EligibleItem = { order_item_id: string; product_name: string; unit_name: string; remaining_quantity: number; unit_price: number; manual_review: boolean };
type Eligibility = { warehouse_id: string; payment_method: string; customer_price_level: string; items: EligibleItem[] };
type ProductUnit = { id: string; unit_name: string; conversion_factor: number; prices: { price_level: string; price: number }[] };
type Product = { id: string; name_ar: string; current_stock: number; units: ProductUnit[] };
type Replacement = { product: Product; unit_id: string; price_level: string; quantity: number };
type Preview = { payment_method: string; returned_value: number; replacement_value: number; refund_amount: number; charge_amount: number };
type ReturnRecord = { id: string; kind: string; refund_amount: number; charge_amount: number; payment_method: string; created_at: string };
const statusLabel: Record<string, string> = { Delivered: "تم التسليم", Closed: "مغلق", Returned: "مسترجع" };
const RETURNABLE_PAGE_SIZE = 50;
const paymentLabel: Record<string, string> = {
  Cash: "نقدي", Wallet: "محفظة", "Credit Card": "فيزا", "Vodafone Cash": "فودافون كاش",
  Instapay: "إنستاباي", "Bank Transfer": "تحويل بنكي", "Deferred Payment": "آجل",
};

export default function ReturnsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [hasMoreOrders, setHasMoreOrders] = useState(true);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showRecentOrders, setShowRecentOrders] = useState(false);
  const [orderFilter, setOrderFilter] = useState("");
  const [orderId, setOrderId] = useState("");
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<"REFUND" | "EXCHANGE">("REFUND");
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [history, setHistory] = useState<ReturnRecord[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [settlementConfirmed, setSettlementConfirmed] = useState(false);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [printStatus, setPrintStatus] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const reviewSequence = useRef(0);
  const scanKeys = useRef(emptyBarcodeScanCapture());

  useEffect(() => {
    if (getUserRole() !== "ADMIN") return;
    const roleTimer = window.setTimeout(() => setIsAdmin(true), 0);
    let active = true;
    const cached = readSectionSnapshot<Order[]>("returnable-orders");
    if (cached) window.setTimeout(() => { if (active) setOrders(cached); }, 0);
    fetchApi(`/orders?group=returnable&limit=${RETURNABLE_PAGE_SIZE}&offset=0`).then((data: Order[]) => {
      if (!active) return;
      setOrders(data);
      setHasMoreOrders(data.length === RETURNABLE_PAGE_SIZE);
      writeSectionSnapshot("returnable-orders", data);
    }).catch(error => { if (active) setMessage(errorMessage(error, "تعذر تحميل الفواتير")); });
    return () => { active = false; window.clearTimeout(roleTimer); };
  }, []);

  const loadOrder = useCallback(async (id: string) => {
    const [eligible, records] = await Promise.all([
      fetchApi(`/returns/eligibility/${id}`), fetchApi(`/returns?order_id=${id}`),
    ]);
    return { eligible: eligible as Eligibility, records: records as ReturnRecord[] };
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    const loadingTimer = window.setTimeout(() => { if (active) setLoadingOrder(true); }, 0);
    loadOrder(orderId).then(({ eligible, records }) => {
      if (!active) return;
      setEligibility(eligible); setHistory(records); setMessage("");
    }).catch(error => {
      if (!active) return;
      setEligibility(null); setHistory([]);
      setMessage(errorMessage(error, "تعذر تحميل الفاتورة"));
    }).finally(() => { if (active) setLoadingOrder(false); });
    return () => { active = false; window.clearTimeout(loadingTimer); };
  }, [orderId, loadOrder]);

  useEffect(() => {
    if (kind !== "EXCHANGE" || !search.trim() || !eligibility) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetchApi(`/pos/search?q=${encodeURIComponent(search.trim())}&warehouse_id=${encodeURIComponent(eligibility.warehouse_id)}&limit=20`)
        .then((data: Product[]) => { if (active) setProducts(data); })
        .catch(error => { if (active) { setProducts([]); setMessage(errorMessage(error, "تعذر البحث عن البديل")); } })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search, kind, eligibility]);

  const invalidatePreview = () => { ++reviewSequence.current; setPreview(null); setSettlementConfirmed(false); requestRef.current = null; setMessage(""); setActionError(""); };
  const selectOrder = (id: string) => {
    if (busy) return;
    invalidatePreview(); setOrderId(id); setEligibility(null); setHistory([]); setQuantities({});
    setReplacements([]); setProducts([]); setSearch(""); setSearching(false); setLoadingOrder(false); setSuccess("");
  };
  async function lookupOrder() {
    const number = orderFilter.trim();
    if (!number || busy || lookingUp) return;
    selectOrder(""); setLookingUp(true); setMessage("");
    try {
      const invoice = await fetchApi(`/returns/lookup/${encodeURIComponent(number)}`, { invalidateSnapshots: false }) as { id: string };
      selectOrder(invoice.id);
    } catch (error) {
      setMessage(errorMessage(error, "لم تُعثر على فاتورة مكتملة بهذا الرقم"));
    } finally { setLookingUp(false); }
  }
  useSectionSearchSelection(selectOrder);
  const selectedLines = eligibility?.items.filter(item => Number(quantities[item.order_item_id]) > 0) || [];
  const quantitiesValid = selectedLines.every(item => {
    const value = quantities[item.order_item_id];
    return Number.isFinite(value) && value > 0 && value <= item.remaining_quantity && !item.manual_review && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
  });
  const replacementQuantities = new Map<string, number>();
  for (const item of replacements) {
    const unit = item.product.units.find(candidate => candidate.id === item.unit_id);
    replacementQuantities.set(item.product.id, (replacementQuantities.get(item.product.id) || 0) + item.quantity * Number(unit?.conversion_factor || 0));
  }
  const replacementsValid = kind === "REFUND" || (replacements.length > 0 && replacements.every(item => {
    const unit = item.product.units.find(candidate => candidate.id === item.unit_id);
    const price = unit?.prices.find(candidate => candidate.price_level === item.price_level);
    return Boolean(unit && price && Number(price.price) > 0 && item.quantity > 0 &&
      Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) < 1e-6 &&
      (replacementQuantities.get(item.product.id) || 0) <= item.product.current_stock);
  }));
  const canPreview = Boolean(eligibility && selectedLines.length && quantitiesValid && replacementsValid && !busy);
  const shownOrders = orders.filter(order => String(order.public_number).includes(orderFilter.trim()) || order.id.toLowerCase().includes(orderFilter.trim().toLowerCase()));
  const money = (value: number) => Number(value).toFixed(2);

  const payload = (id: string, confirmed: boolean) => ({
    request_id: id, order_id: orderId, warehouse_id: eligibility!.warehouse_id, kind,
    settlement_confirmed: confirmed,
    lines: selectedLines.map(item => ({ order_item_id: item.order_item_id, quantity: quantities[item.order_item_id] })),
    replacements: kind === "EXCHANGE" ? replacements.map(item => ({
      product_id: item.product.id, unit_id: item.unit_id, price_level: item.price_level, quantity: item.quantity,
    })) : [],
  });

  async function review() {
    if (!canPreview) return;
    const sequence = ++reviewSequence.current;
    setBusy(true); setShiftOpen(null); setMessage(""); setActionError(""); setSuccess("");
    try {
      const draft = payload(crypto.randomUUID(), false);
      const fingerprint = JSON.stringify({ ...draft, request_id: undefined, settlement_confirmed: undefined });
      const id = requestRef.current?.fingerprint === fingerprint ? requestRef.current.id : draft.request_id;
      requestRef.current = { fingerprint, id };
      const quote = await fetchApi("/returns/preview", {
        method: "POST", body: JSON.stringify({ ...draft, request_id: id }), invalidateSnapshots: false,
      }) as Preview;
      if (sequence !== reviewSequence.current) return;
      setPreview(quote); setSettlementConfirmed(false);
      if (quote.payment_method === "Cash" && (quote.refund_amount > 0 || quote.charge_amount > 0)) {
        fetchApi("/cash-register/current")
          .then(shift => { if (sequence === reviewSequence.current) setShiftOpen(Boolean(shift)); })
          .catch(() => { if (sequence === reviewSequence.current) setShiftOpen(null); });
      }
    } catch (error) { if (sequence === reviewSequence.current) setActionError(errorMessage(error, "تعذر حساب التسوية")); }
    finally { if (sequence === reviewSequence.current) setBusy(false); }
  }

  async function submit() {
    if (!preview || busy) return;
    if (!requestRef.current || !canPreview) {
      setActionError("تغيّرت بيانات العملية. راجع المبلغ مرة أخرى قبل التسجيل.");
      return;
    }
    if (preview.payment_method === "Cash" && (preview.refund_amount > 0 || preview.charge_amount > 0) && shiftOpen !== true) {
      setActionError(shiftOpen === null ? "تعذر التأكد من الوردية. أعد مراجعة المبلغ." : "افتح ورديتك أولًا لإتمام التسوية النقدية.");
      return;
    }
    if (preview.payment_method !== "Deferred Payment" && (preview.refund_amount > 0 || preview.charge_amount > 0) && !settlementConfirmed) {
      setActionError("أكّد رد المبلغ أو تحصيل الفرق قبل التسجيل.");
      return;
    }
    setBusy(true); setMessage(""); setActionError("");
    try {
      const record = await fetchApi("/returns", { method: "POST", body: JSON.stringify({
        ...payload(requestRef.current.id, settlementConfirmed),
        expected_refund_amount: preview.refund_amount,
        expected_charge_amount: preview.charge_amount,
      }) }) as ReturnRecord;
      const label = record.kind === "REFUND" ? "الاسترجاع" : "الاستبدال";
      setSuccess(`تم تسجيل ${label}. ${Number(record.refund_amount) > 0 ? `المرتد ${money(record.refund_amount)} ج.م` : Number(record.charge_amount) > 0 ? `المحصّل ${money(record.charge_amount)} ج.م` : "لا يوجد فرق مالي"}.`);
      setHistory(previous => [record, ...previous.filter(item => item.id !== record.id)]);
      setPrintStatus("جارٍ إرسال الإيصال لتطبيق الطباعة المحلي...");
      void printSalesReturnReceipt(record.id)
        .then(() => setPrintStatus("أُرسل الإيصال لتطبيق الطباعة. راجع خروج الورقة من الطابعة."))
        .catch(error => setPrintStatus(errorMessage(error, "تعذر إرسال الإيصال. يمكنك إعادة طباعته من السجل.")));
      setQuantities({}); setReplacements([]); setSearch(""); setProducts([]);
      setPreview(null); setSettlementConfirmed(false); requestRef.current = null;
      try {
        const { eligible, records } = await loadOrder(orderId);
        setEligibility(eligible); setHistory(records);
        if (isAdmin) {
          const orderRows = await fetchApi(`/orders?group=returnable&limit=${RETURNABLE_PAGE_SIZE}&offset=0`) as Order[];
          setOrders(orderRows); setHasMoreOrders(orderRows.length === RETURNABLE_PAGE_SIZE);
          writeSectionSnapshot("returnable-orders", orderRows);
        }
      } catch (refreshError) {
        setMessage(errorMessage(refreshError, "تم التسجيل لكن تعذر تحديث الفاتورة. حدّث الصفحة لعرض الحالة الجديدة."));
      }
    } catch (error) {
      const detail = errorMessage(error, "تعذر تسجيل العملية. يمكنك إعادة المحاولة بنفس الطلب.");
      if (detail.includes("settlement changed")) { setPreview(null); setSettlementConfirmed(false); requestRef.current = null; }
      setActionError(detail);
    } finally { setBusy(false); }
  }

  async function reprint(recordId: string) {
    if (printingId) return;
    setPrintingId(recordId); setPrintStatus("");
    try {
      await printSalesReturnReceipt(recordId);
      setPrintStatus("أُرسل الإيصال لتطبيق الطباعة. راجع خروج الورقة من الطابعة.");
    } catch (error) {
      setPrintStatus(errorMessage(error, "تعذر إرسال الإيصال لتطبيق الطباعة المحلي."));
    } finally { setPrintingId(null); }
  }

  function addReplacement(product: Product) {
    if (busy) return;
    const level = eligibility?.customer_price_level || "Retail";
    const unit = product.units.find(candidate => candidate.prices.some(price => price.price_level === level && Number(price.price) > 0)) ||
      (getUserRole() === "ADMIN" ? product.units.find(candidate => candidate.prices.some(price => Number(price.price) > 0)) : undefined);
    const price = unit?.prices.find(candidate => candidate.price_level === level && Number(candidate.price) > 0) ||
      (getUserRole() === "ADMIN" ? unit?.prices.find(candidate => Number(candidate.price) > 0) : undefined);
    if (!unit || !price || product.current_stock <= 0) return;
    invalidatePreview();
    setReplacements(previous => previous.some(item => item.product.id === product.id && item.unit_id === unit.id)
      ? previous.map(item => item.product.id === product.id && item.unit_id === unit.id ? { ...item, quantity: item.quantity + 1 } : item)
      : [...previous, { product, unit_id: unit.id, price_level: price.price_level, quantity: 1 }]);
    setSearch(""); setProducts([]);
    setSearching(false);
  }

  async function loadMoreReturnableOrders() {
    if (!hasMoreOrders || loadingMoreOrders) return;
    setLoadingMoreOrders(true);
    try {
      const page = await fetchApi(`/orders?group=returnable&limit=${RETURNABLE_PAGE_SIZE}&offset=${orders.length}`) as Order[];
      const combined = [...orders, ...page.filter(order => !orders.some(existing => existing.id === order.id))];
      setOrders(combined);
      setHasMoreOrders(page.length === RETURNABLE_PAGE_SIZE);
      writeSectionSnapshot("returnable-orders", combined);
    } catch (error) {
      setMessage(errorMessage(error, "تعذر تحميل المزيد من الفواتير"));
    } finally {
      setLoadingMoreOrders(false);
    }
  }

  return <div className="min-h-screen" dir="rtl">

    <main className="app-main space-y-4">
      <h1 className="sr-only">الاسترجاع والاستبدال</h1>
      {message && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{message}</p>}
      {(success || printStatus) && <div role="status" className="fixed bottom-5 left-5 right-5 z-[80] ml-auto max-w-sm rounded-xl border border-green-500/30 bg-[var(--color-surface-container-low)] p-3 text-sm shadow-lg">
        {success && <p className="font-semibold">{success}</p>}
        {printStatus && <p className="app-muted mt-1">{printStatus}</p>}
        <button type="button" className="app-muted mt-2 text-xs underline" onClick={() => { setSuccess(""); setPrintStatus(""); }}>إغلاق</button>
      </div>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
      <section className="app-panel space-y-3 rounded-2xl p-4">
        <h2 className="font-bold">الفاتورة الأصلية</h2>
          <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void lookupOrder(); }}>
            <input className="app-field min-w-40 flex-1" aria-label="رقم الفاتورة المطبوع" placeholder="رقم الفاتورة المطبوع" value={orderFilter} disabled={busy || lookingUp} onChange={event => { setOrderFilter(event.target.value); if (orderId) selectOrder(""); }} />
            <button type="submit" className="app-primary-button disabled:opacity-50" disabled={busy || lookingUp || !orderFilter.trim()}>{lookingUp ? "جارٍ البحث..." : "فتح الفاتورة"}</button>
          </form>
          {isAdmin && orders.length > 0 && <div>
            <button type="button" className="app-muted text-sm underline underline-offset-4" aria-expanded={showRecentOrders} onClick={() => setShowRecentOrders(value => !value)}>
              {showRecentOrders ? "إخفاء الفواتير الأخيرة" : "عرض الفواتير الأخيرة"}
            </button>
            {showRecentOrders && <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-current/10 p-2">
              {shownOrders.map(order => <button type="button" key={order.id} disabled={busy} onClick={() => { setOrderFilter(String(order.public_number)); selectOrder(order.id); setShowRecentOrders(false); }}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-primary/10 disabled:opacity-50">
                <span>فاتورة {order.public_number} · {statusLabel[order.status] || order.status}</span><strong>{money(order.total_amount)} ج.م</strong>
              </button>)}
              {shownOrders.length === 0 && <p className="app-muted p-2 text-sm">لا توجد فاتورة مطابقة في القائمة الأخيرة؛ افتحها برقمها أعلاه.</p>}
              {hasMoreOrders && <button type="button" className="app-secondary-button w-full" disabled={busy || loadingMoreOrders} onClick={loadMoreReturnableOrders}>
                {loadingMoreOrders ? "جارٍ التحميل..." : "تحميل فواتير أقدم"}
              </button>}
            </div>}
          </div>}
        {loadingOrder && <div className="space-y-3 rounded-xl border border-current/10 p-4" role="status" aria-label="جارٍ تحميل الفاتورة"><span className="sr-only">جارٍ تحميل الفاتورة</span><span aria-hidden="true" className="app-skeleton h-5 w-40" /><span aria-hidden="true" className="app-skeleton h-4 w-64 max-w-full" /><span aria-hidden="true" className="app-skeleton h-12 w-full rounded-xl" /></div>}
        {eligibility && <p className="text-sm font-semibold">فاتورة {orderFilter || orderId.slice(-12)} <span className="app-muted font-normal">· {paymentLabel[eligibility.payment_method] || eligibility.payment_method}</span></p>}
      </section>

      {eligibility && <section className="app-panel space-y-3 rounded-2xl p-4">
        <h2 className="font-bold">الأصناف المسترجعة</h2>
        {eligibility.items.every(item => item.remaining_quantity <= 0) && <p className="app-muted">لا توجد كميات متبقية للاسترجاع.</p>}
        <div className="grid gap-3">
          {eligibility.items.filter(item => item.remaining_quantity > 0).map(item => <div key={item.order_item_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-current/10 p-3">
            <div><strong>{item.product_name}</strong><p className="app-muted text-sm">{item.unit_name} · متاح {item.remaining_quantity} · سعر البيع {money(item.unit_price)} ج.م</p>
              {item.manual_review && <p className="text-sm text-amber-600">يلزم مراجعة مكونات هذا الصنف قبل إرجاعه.</p>}</div>
            <label className="text-sm">كمية الإرجاع<ZeroHintNumberInput className="app-field mt-1 w-32" aria-label={`كمية إرجاع ${item.product_name}`} inputMode="decimal" min="0" max={item.remaining_quantity} step="0.01" disabled={item.manual_review || busy}
              value={quantities[item.order_item_id] || ""} onChange={event => { invalidatePreview(); setQuantities(previous => ({ ...previous, [item.order_item_id]: Number(event.target.value) || 0 })); }} /></label>
          </div>)}
        </div>
      </section>}
      </div>
      <div className="min-w-0 space-y-4">

      {eligibility && eligibility.items.some(item => item.remaining_quantity > 0) && <section className="app-panel space-y-4 rounded-2xl p-4 md:p-5">
        <h2 className="font-bold">نوع العملية</h2>
        <div className="flex flex-wrap gap-3">
          <label className="app-secondary-button cursor-pointer"><input type="radio" className="ml-2" checked={kind === "REFUND"} disabled={busy} onChange={() => { invalidatePreview(); setKind("REFUND"); }} />استرجاع</label>
          <label className="app-secondary-button cursor-pointer"><input type="radio" className="ml-2" checked={kind === "EXCHANGE"} disabled={busy} onChange={() => { invalidatePreview(); setKind("EXCHANGE"); }} />استبدال</label>
        </div>
        {kind === "EXCHANGE" && <div className="space-y-3">
          <input className="app-field" aria-label="ابحث عن الصنف البديل" placeholder="ابحث عن الصنف البديل بالاسم أو الباركود" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setProducts([]); }} onKeyDown={event => {
            if (event.key !== "Enter") {
              if (!event.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, event);
              return;
            }
            const code = englishBarcodeFromScan(scanKeys.current, event.currentTarget.value.trim());
            if (code) { event.preventDefault(); setSearch(code); setProducts([]); }
          }} />
          {searching && <p className="app-muted text-sm">جارٍ البحث...</p>}
          {products.length > 0 && <div className="grid gap-2">{products.map(product => {
            const level = eligibility.customer_price_level;
            const unit = product.units.find(candidate => candidate.prices.some(price => price.price_level === level && Number(price.price) > 0)) ||
              (getUserRole() === "ADMIN" ? product.units.find(candidate => candidate.prices.some(price => Number(price.price) > 0)) : undefined);
            const price = unit?.prices.find(candidate => candidate.price_level === level && Number(candidate.price) > 0) ||
              (getUserRole() === "ADMIN" ? unit?.prices.find(candidate => Number(candidate.price) > 0) : undefined);
            return <button key={product.id} type="button" onClick={() => addReplacement(product)} disabled={busy || product.current_stock <= 0 || !price}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-current/10 p-3 text-right disabled:opacity-50">
              <span>{product.name_ar} <span className="app-muted text-xs">· متاح {product.current_stock}</span></span><strong>{price ? `${money(price.price)} ج.م` : "بلا سعر"}</strong>
            </button>;
          })}</div>}
          {replacements.map((item, index) => {
            const unit = item.product.units.find(candidate => candidate.id === item.unit_id);
            return <div key={`${item.product.id}-${index}`} className="space-y-2 rounded-xl border border-current/10 p-3">
              <div className="flex justify-between gap-2"><strong>{item.product.name_ar}</strong><button type="button" className="text-red-500" disabled={busy} onClick={() => { invalidatePreview(); setReplacements(previous => previous.filter((_, i) => i !== index)); }}>حذف</button></div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="text-sm">الوحدة<select className="app-field mt-1" value={item.unit_id} disabled={busy} onChange={event => {
                  invalidatePreview(); const nextUnit = item.product.units.find(candidate => candidate.id === event.target.value)!;
                  const price = nextUnit.prices.find(candidate => candidate.price_level === eligibility.customer_price_level) || (getUserRole() === "ADMIN" ? nextUnit.prices[0] : undefined);
                  setReplacements(previous => previous.map((row, i) => i === index ? { ...row, unit_id: nextUnit.id, price_level: price?.price_level || "" } : row));
                }}>{item.product.units.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.unit_name}</option>)}</select></label>
                <label className="text-sm">فئة السعر<select className="app-field mt-1" value={item.price_level} disabled={busy || getUserRole() !== "ADMIN"} onChange={event => { invalidatePreview(); setReplacements(previous => previous.map((row, i) => i === index ? { ...row, price_level: event.target.value } : row)); }}>
                  {unit?.prices.map(price => <option key={price.price_level} value={price.price_level}>{price.price_level} · {money(price.price)} ج.م</option>)}</select></label>
                <label className="text-sm">الكمية<ZeroHintNumberInput className="app-field mt-1" inputMode="decimal" min="0.01" step="0.01" value={item.quantity} disabled={busy} onChange={event => { invalidatePreview(); setReplacements(previous => previous.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) || 0 } : row)); }} /></label>
              </div>
            </div>;
          })}
        </div>}
        {!quantitiesValid && selectedLines.length > 0 && <p className="text-sm text-red-500">راجع كميات الإرجاع المتاحة.</p>}
        {!replacementsValid && kind === "EXCHANGE" && replacements.length > 0 && <p className="text-sm text-red-500">راجع سعر وكمية الصنف البديل والمخزون المتاح.</p>}
        <button type="button" className="app-primary-button disabled:opacity-50" disabled={!canPreview} onClick={review}>{busy && !preview ? "جارٍ الحساب..." : "مراجعة المبلغ"}</button>
        {actionError && !preview && <p role="alert" className="text-sm text-red-500">{actionError}</p>}
      </section>}

      {preview && <section className="app-panel space-y-4 rounded-2xl border-primary/30 p-4 md:p-5" aria-label="مراجعة التسوية">
        <h2 className="font-bold">مراجعة التسوية</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2"><p>قيمة المرتجع بعد خصم الفاتورة: <strong>{money(preview.returned_value)} ج.م</strong></p>
          <p>قيمة البديل: <strong>{money(preview.replacement_value)} ج.م</strong></p></div>
        <p className="text-lg font-bold">{preview.refund_amount > 0 ? `يُرد للعميل ${money(preview.refund_amount)} ج.م` : preview.charge_amount > 0 ? `يُحصّل من العميل ${money(preview.charge_amount)} ج.م` : "لا يوجد فرق مالي"}</p>
        <p className="app-muted text-sm">وسيلة التسوية: {paymentLabel[preview.payment_method] || preview.payment_method}</p>
        {preview.payment_method === "Cash" && (preview.refund_amount > 0 || preview.charge_amount > 0) && shiftOpen !== true &&
          <p className="text-sm text-amber-600">يلزم فتح وردية الصندوق لإتمام التسوية النقدية. <Link href="/cash-register" className="underline">فتح الصندوق</Link></p>}
        {preview.payment_method !== "Deferred Payment" && (preview.refund_amount > 0 || preview.charge_amount > 0) &&
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={settlementConfirmed} disabled={busy} onChange={event => { setSettlementConfirmed(event.target.checked); setActionError(""); }} />
            <span>تأكدت من {preview.refund_amount > 0 ? "رد المبلغ" : "تحصيل الفرق"} عبر وسيلة الدفع الأصلية قبل تسجيل العملية.</span></label>}
        <button type="button" className="app-primary-button disabled:opacity-50" disabled={busy} onClick={submit}>
          {busy ? "جارٍ التسجيل..." : kind === "REFUND" ? "تسجيل الاسترجاع" : "تسجيل الاستبدال"}</button>
        {actionError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{actionError}</p>}
      </section>}
      </div>
      </div>

      {history.length > 0 && <details className="app-panel rounded-2xl p-4"><summary className="cursor-pointer font-bold">عمليات سابقة على الفاتورة ({history.length})</summary>
        <div className="mt-3 space-y-3">{history.map(record => <div key={record.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 pb-2 text-sm">
          <p>{record.kind === "REFUND" ? "استرجاع" : "استبدال"} · رد {money(record.refund_amount)} / تحصيل {money(record.charge_amount)} ج.م · {new Date(record.created_at).toLocaleString("ar-EG")}</p>
          <button type="button" className="app-secondary-button disabled:opacity-50" disabled={printingId !== null} onClick={() => reprint(record.id)}>
            {printingId === record.id ? "جارٍ الإرسال..." : "إعادة طباعة الإيصال"}
          </button>
        </div>)}</div></details>}
    </main>
  </div>;
}
