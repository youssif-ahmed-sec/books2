"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { TopNavSearchPortal } from "@/lib/topNavSearchPortal";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { getUserRole } from "@/utils/auth";

type SaleItem = { id: string; product_id: string; unit_id: string; product_name: string; unit_name: string; quantity_requested: number; price_level: string; unit_price: number };
type Sale = { id: string; public_number: number; customer_id: string | null; customer_name?: string | null; customer_address?: string | null; status: string; source: string; payment_method: string; shipping_cost: number; discount_amount: number; discount_percent: number | null; wallet_fee_amount: number; notes: string | null; total_amount: number; amount_received?: number; received_method?: string | null; expected_collection_method?: string | null; next_due_date?: string | null; items: SaleItem[] };
type Unit = { id: string; unit_name: string; prices: { price_level: string; price: number }[] };
type Product = { id: string; name_ar: string; sku: string; is_bundle: boolean; current_stock: number; units: Unit[] };
type Line = { key: string; original_item_id?: string; product_id: string; unit_id: string; name: string; unit_name: string; price_level: string; quantity: string; unit_price: number };
type Warehouse = { id: string; name: string };
type Customer = { id: string; name: string; phone: string | null; address: string | null; addresses: string[] };
const methods = [{ value: "Cash", label: "نقدي" }, { value: "Credit Card", label: "بطاقة" }, { value: "Instapay", label: "إنستاباي" }, { value: "Wallet", label: "محفظة" }, { value: "Deferred Payment", label: "آجل" }];
const collectionMethods = methods.filter(method => !["Deferred Payment", "Wallet"].includes(method.value));
const levels: Record<string, string> = { Retail: "قطاعي", "Semi Wholesale": "نصف جملة", Wholesale: "جملة", "Super Wholesale": "سوبر جملة", VIP: "خاص" };

export default function SaleCorrectionEditor({ invoiceId, onClose, onSubmitted }: { invoiceId: string; onClose: () => void; onSubmitted: () => void }) {
  const [sale, setSale] = useState<Sale | null>(null);
  const [warehouse, setWarehouse] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [payment, setPayment] = useState("");
  const [received, setReceived] = useState("0");
  const [receivedMethod, setReceivedMethod] = useState("Cash");
  const [collectionMethod, setCollectionMethod] = useState("Cash");
  const [dueDate, setDueDate] = useState("");
  const [discount, setDiscount] = useState("0");
  const [discountPercent, setDiscountPercent] = useState<number | null>(null);
  const [shipping, setShipping] = useState("0");
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"products" | "customers">("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerAddress, setCustomerAddress] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [unitId, setUnitId] = useState("");
  const [priceLevel, setPriceLevel] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const confirm = useConfirmAction();

  function chooseSearchMode(mode: "products" | "customers") {
    setSearchMode(mode); setSearch(""); setProducts([]); setCustomerResults([]); setSelected(null);
    window.requestAnimationFrame(() => searchInput.current?.focus());
  }

  useEffect(() => {
    let active = true;
    Promise.all([fetchApi(`/orders/${encodeURIComponent(invoiceId)}/quotation`),
      fetchApi(`/returns/eligibility/${encodeURIComponent(invoiceId)}`), fetchApi("/inventory/warehouses")])
      .then(async ([invoice, eligibility, stores]: [Sale, { warehouse_id: string; items: { order_item_id: string; remaining_quantity: number }[] }, Warehouse[]]) => {
        if (!active) return;
        const remaining = new Map(eligibility.items.map(item => [item.order_item_id, Number(item.remaining_quantity)]));
        if (invoice.items.some(item => !remaining.has(item.id))) throw new Error("تعذر تحديد الكميات المتبقية؛ راجع الفاتورة يدويًا.");
        const hasPreviousReturn = invoice.items.some(item => (remaining.get(item.id) || 0) < Number(item.quantity_requested));
        let remainingDiscount = Number(invoice.discount_amount || 0);
        if (hasPreviousReturn && eligibility.items.some(item => Number(item.remaining_quantity) > 0)) {
          const preview = await fetchApi("/returns/preview", { method: "POST", body: JSON.stringify({
            request_id: crypto.randomUUID(), order_id: invoice.id, warehouse_id: eligibility.warehouse_id, kind: "REFUND",
            lines: eligibility.items.filter(item => Number(item.remaining_quantity) > 0).map(item => ({ order_item_id: item.order_item_id, quantity: item.remaining_quantity })),
          }) }) as { returned_value: number | string };
          const subtotal = invoice.items.reduce((sum, item) => sum + (remaining.get(item.id) || 0) * Number(item.unit_price), 0);
          remainingDiscount = Math.max(0, Math.round((subtotal - Number(preview.returned_value)) * 100) / 100);
        }
        if (!active) return;
        setSale(invoice); setWarehouse(eligibility.warehouse_id); setWarehouses(stores);
        setLines(invoice.items.filter(item => (remaining.get(item.id) || 0) > 0).map(item => ({ key: item.id, original_item_id: item.id, product_id: item.product_id,
          unit_id: item.unit_id, name: item.product_name, unit_name: item.unit_name, price_level: item.price_level,
          quantity: String(remaining.get(item.id)), unit_price: Number(item.unit_price) })));
        setPayment(invoice.payment_method); setDiscount(String(remainingDiscount));
        setReceived(invoice.payment_method === "Deferred Payment" ? String(invoice.amount_received || 0) : "0");
        setReceivedMethod(invoice.received_method || "Cash"); setCollectionMethod(invoice.expected_collection_method || "Cash"); setDueDate(invoice.next_due_date || "");
        setDiscountPercent(hasPreviousReturn ? null : invoice.discount_percent); setShipping(String(invoice.shipping_cost || 0));
        setCustomer(invoice.customer_id ? { id: invoice.customer_id, name: invoice.customer_name || "عميل", phone: null,
          address: invoice.customer_address || null, addresses: invoice.customer_address ? [invoice.customer_address] : [] } : null);
        setCustomerAddress(invoice.customer_address || "");
      }).catch(cause => { if (active) setError(errorMessage(cause, "تعذر تحميل الفاتورة للتعديل")); });
    return () => { active = false; };
  }, [invoiceId]);

  useEffect(() => {
    if (!search.trim() || !warehouse || (searchMode === "customers" && search.trim().length < 2)) {
      const timer = window.setTimeout(() => { setProducts([]); setCustomerResults([]); setSearching(false); }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      const url = searchMode === "products" ? `/pos/search?q=${encodeURIComponent(search.trim())}&warehouse_id=${encodeURIComponent(warehouse)}&limit=20` : `/sale-corrections/customer-search?q=${encodeURIComponent(search.trim())}`;
      fetchApi(url, { signal: controller.signal, silentErrors: true })
        .then((rows: Product[] | Customer[]) => { if (!controller.signal.aborted) { if (searchMode === "products") setProducts(rows as Product[]); else setCustomerResults(rows as Customer[]); } })
        .catch(cause => { if (!controller.signal.aborted) notifyError(errorMessage(cause, searchMode === "products" ? "تعذر البحث عن الأصناف" : "تعذر البحث عن العملاء")); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, searchMode, warehouse]);

  const chosenUnit = selected?.units.find(unit => unit.id === unitId);
  const chosenPrice = chosenUnit?.prices.find(price => price.price_level === priceLevel);
  const estimatedBase = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * line.unit_price, 0) - Number(discount || 0) + Number(shipping || 0);
  const estimated = estimatedBase + (payment === "Wallet" ? Math.round(estimatedBase) / 100 : 0);
  const hasDebt = payment === "Deferred Payment" && Number(received) < estimatedBase;

  function selectProduct(product: Product) {
    setSelected(product);
    const unit = product.units[0];
    setUnitId(unit?.id || "");
    setPriceLevel(unit?.prices.find(price => price.price_level === "Retail")?.price_level || unit?.prices[0]?.price_level || "");
  }

  function addSelected() {
    if (!selected || !chosenUnit || !chosenPrice) return;
    setDiscountPercent(null);
    setLines(previous => [...previous, { key: crypto.randomUUID(), product_id: selected.id, unit_id: chosenUnit.id,
      name: selected.name_ar, unit_name: chosenUnit.unit_name, price_level: priceLevel, quantity: "1", unit_price: Number(chosenPrice.price) }]);
    setSelected(null); setSearch(""); setProducts([]);
  }

  async function submit() {
    if (!sale || busy || !warehouse || !lines.length || lines.some(line => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) return;
    setBusy(true); setError("");
    try {
      const proposal = { warehouse_id: warehouse, status: sale.status === "Delivered" ? "Delivered" : "Closed", source: sale.source,
        customer_id: customer?.id || undefined, customer_address: customerAddress || undefined,
        payment_method: payment, discount_amount: discount || "0", discount_percent: discountPercent,
        ...(payment === "Deferred Payment" ? { amount_received: received || "0", received_method: Number(received) > 0 ? receivedMethod : undefined,
          expected_collection_method: hasDebt ? collectionMethod : undefined, next_due_date: hasDebt ? dueDate || undefined : undefined } : {}),
        shipping_cost: shipping || "0", notes: sale.notes || undefined,
        items: lines.map(line => ({ product_id: line.product_id, unit_id: line.unit_id, quantity: line.quantity,
          price_level: line.price_level, original_item_id: line.original_item_id })) };
      const key = JSON.stringify(proposal);
      if (!request.current || request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
      const base = { order_id: sale.id, proposal: { ...proposal, request_id: request.current.id } };
      const quote = await fetchApi("/sale-corrections/quote", { method: "POST", body: JSON.stringify(base) }) as { quote: { total: string } };
      const admin = getUserRole() === "ADMIN";
      const customerChange = (sale.customer_id || null) !== (customer?.id || null) ? ` العميل تغير من ${sale.customer_name || "عميل نقدي"} إلى ${customer?.name || "عميل نقدي"}؛ ستُراجع حركتا الرد والتحصيل عند التسوية.` : "";
      if (!await confirm({ title: "مراجعة تعديل الفاتورة", message: `الإجمالي الأصلي ${Number(sale.total_amount).toFixed(2)} ج.م، والإجمالي المقترح ${quote.quote.total} ج.م.${customerChange} ${admin ? "سيُراجع الطلب قبل تأكيد التسوية." : "سيُرسل الطلب للمدير قبل تسوية أي فرق."}`, confirmLabel: admin ? "اعتماد الطلب" : "إرسال للمدير" })) return;
      const result = await fetchApi("/sale-corrections", { method: "POST", body: JSON.stringify({ ...base, proposal: { ...base.proposal, expected_total: quote.quote.total } }) }) as { status: string };
      notifySuccess(result.status === "AWAITING_SETTLEMENT" ? "تم اعتماد الطلب؛ راجع التسوية لإتمام التعديل" : "تم إرسال طلب تعديل الفاتورة");
      onSubmitted(); onClose();
    } catch (cause) { setError(errorMessage(cause, "تعذر تجهيز التعديل")); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/70 px-2 pb-3 pt-28 sm:px-6" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <TopNavSearchPortal overlay><div className="app-search app-search-focus flex h-10 items-center gap-2 rounded-full px-4">
      <span className="material-symbols-outlined app-muted" aria-hidden="true">search</span><input ref={searchInput} className="min-w-0 flex-1 bg-transparent outline-none" aria-label={searchMode === "products" ? "بحث عن صنف لإضافته للتعديل" : "بحث عن عميل لتعديل الفاتورة"} placeholder={searchMode === "products" ? "ابحث عن صنف أو باركود لإضافته" : "ابحث عن عميل بالاسم أو الهاتف"} maxLength={120} value={search} onChange={event => { setSearch(event.target.value); setProducts([]); setCustomerResults([]); }} />
      {search && <button type="button" aria-label="مسح البحث" onClick={() => setSearch("")}>×</button>}</div></TopNavSearchPortal>
    <section role="dialog" aria-modal="true" aria-label="تعديل فاتورة البيع" dir="rtl" className="app-panel flex max-h-full w-full max-w-6xl flex-col overflow-hidden shadow-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-current/10 p-4"><div><h2 className="text-lg font-bold">تعديل فاتورة {sale?.public_number || ""}</h2><p className="app-muted text-sm">ابحث من الشريط العلوي لإضافة صنف. السطور الأصلية تحتفظ بسعر البيع.</p></div><button type="button" className="app-secondary-button" disabled={busy} onClick={onClose}>إغلاق</button></header>
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_1.4fr]">
        <section className="space-y-3"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">البحث والإضافة</h3><button type="button" className="app-secondary-button" onClick={() => chooseSearchMode("products")}>صنف</button><button type="button" className="app-secondary-button" onClick={() => chooseSearchMode("customers")}>عميل</button></div>{searching && <p className="app-muted text-sm">جارٍ البحث...</p>}
          {search && !searching && (searchMode === "products" ? products.length === 0 : customerResults.length === 0) && <p className="app-muted text-sm">لا توجد نتائج مطابقة.</p>}
          <div className="max-h-44 space-y-2 overflow-y-auto">{searchMode === "products" ? products.map(product => <button type="button" key={product.id} className="app-secondary-button w-full text-start" onClick={() => selectProduct(product)}>{product.name_ar} · {product.sku}</button>) : customerResults.map(person => <button type="button" key={person.id} className="app-secondary-button w-full text-start" onClick={() => { setCustomer(person); setCustomerAddress(person.address || person.addresses[0] || ""); setSearch(""); setSearchMode("products"); }}>{person.name}{person.phone ? ` · ${person.phone}` : ""}</button>)}</div>
          {selected && <div className="app-panel space-y-2 p-3"><strong>{selected.name_ar}</strong><>
            <label className="block text-sm">الوحدة<select className="app-field mt-1 w-full" value={unitId} onChange={event => { const unit = selected.units.find(item => item.id === event.target.value); setUnitId(event.target.value); setPriceLevel(unit?.prices[0]?.price_level || ""); }}>{selected.units.map(unit => <option key={unit.id} value={unit.id}>{unit.unit_name}</option>)}</select></label>
            <label className="block text-sm">التسعيرة<select className="app-field mt-1 w-full" value={priceLevel} onChange={event => setPriceLevel(event.target.value)}>{chosenUnit?.prices.map(price => <option key={price.price_level} value={price.price_level}>{levels[price.price_level] || price.price_level} · {price.price} ج.م</option>)}</select></label>
            <button type="button" className="app-primary-button" disabled={!chosenPrice} onClick={addSelected}>إضافة للسلة</button></></div>}
        </section>
        <section className="space-y-3"><h3 className="font-semibold">سلة الفاتورة</h3>
          {lines.map(line => <div key={line.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-current/10 p-3"><div className="min-w-32 flex-1"><strong>{line.name}</strong><p className="app-muted text-sm">{line.unit_name} · {levels[line.price_level] || line.price_level} · {line.unit_price} ج.م {line.original_item_id ? "(سعر البيع)" : ""}</p></div><label className="text-sm">الكمية<input className="app-field ms-2 w-24" type="number" min="0.01" step="0.01" value={line.quantity} onChange={event => { setDiscountPercent(null); setLines(previous => previous.map(item => item.key === line.key ? { ...item, quantity: event.target.value } : item)); }} /></label><button type="button" className="app-secondary-button" onClick={() => { setDiscountPercent(null); setLines(previous => previous.filter(item => item.key !== line.key)); }}>إزالة</button></div>)}
          {!lines.length && <p className="app-muted text-sm">أضف صنفًا واحدًا على الأقل.</p>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">المخزن<select className="app-field mt-1 w-full" value={warehouse} onChange={event => setWarehouse(event.target.value)}>{warehouses.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            <label className="text-sm">طريقة الدفع<select className="app-field mt-1 w-full" value={payment} onChange={event => setPayment(event.target.value)}>{!methods.some(method => method.value === payment) && <option value={payment}>{payment} · تحتاج مراجعة</option>}{methods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
            {payment === "Deferred Payment" && <><label className="text-sm">المبلغ المحصل<input className="app-field mt-1 w-full" type="number" min="0" step="0.01" value={received} onChange={event => setReceived(event.target.value)} /></label>
              {Number(received) > 0 && <label className="text-sm">طريقة التحصيل<select className="app-field mt-1 w-full" value={receivedMethod} onChange={event => setReceivedMethod(event.target.value)}>{collectionMethods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>}
              {hasDebt && <><label className="text-sm">طريقة تحصيل الباقي<select className="app-field mt-1 w-full" value={collectionMethod} onChange={event => setCollectionMethod(event.target.value)}>{collectionMethods.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label><label className="text-sm">تاريخ الاستحقاق<input className="app-field mt-1 w-full" type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label></>}</>}
            <label className="text-sm">الخصم<input className="app-field mt-1 w-full" type="number" min="0" step="0.01" value={discount} onChange={event => { setDiscount(event.target.value); setDiscountPercent(null); }} /></label>
            {sale?.source === "Delivery" && <label className="text-sm">الشحن<input className="app-field mt-1 w-full" type="number" min="0" step="0.01" value={shipping} onChange={event => setShipping(event.target.value)} /></label>}</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">العميل: <strong>{customer?.name || "عميل نقدي"}</strong><button type="button" className="app-secondary-button" onClick={() => chooseSearchMode("customers")}>تغيير العميل</button>{customer && <button type="button" className="app-secondary-button" onClick={() => { setCustomer(null); setCustomerAddress(""); }}>عميل نقدي</button>}</div>
          {customer && (customer.address || customer.addresses.length > 0) && <label className="block text-sm">العنوان<select className="app-field mt-1 w-full" value={customerAddress} onChange={event => setCustomerAddress(event.target.value)}><option value="">بدون عنوان</option>{Array.from(new Set([customer.address || "", ...customer.addresses])).filter(Boolean).map(address => <option key={address} value={address}>{address}</option>)}</select></label>}
          <p className="font-semibold">الإجمالي التقديري: {Number.isFinite(estimated) ? estimated.toFixed(2) : "—"} ج.م</p>
          <p className="app-muted text-xs">يُحسب الإجمالي النهائي على السيرفر قبل إرسال الطلب. بعض حالات الرسوم وسجل المدفوعات تحتاج مراجعة يدوية.</p>
        </section>
      </div>
      {error && <p role="alert" className="px-4 text-sm text-red-400">{error}</p>}
      <footer className="flex justify-end gap-2 border-t border-current/10 p-4"><button type="button" className="app-secondary-button" disabled={busy} onClick={onClose}>تراجع</button><button type="button" className="app-primary-button" disabled={busy || !sale || !lines.length} onClick={() => void submit()}>{busy ? "جارٍ المراجعة..." : "مراجعة التعديل"}</button></footer>
    </section>
  </div>;
}
