"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchApi } from "@/lib/api";
import { sendLocalPrint } from "@/lib/localPrint";
import { ProductSelect } from "@/components/ProductSelect";

type Choice = { id: string; name?: string };
type Product = { id: string; name_ar: string; sku: string; barcode?: string; base_unit: string; units?: Array<{ barcode?: string }> };
type Line = { product: Product; quantity: string };
type Receipt = {
  id: string; created_at: string; supplier_name: string; warehouse_name: string;
  supplier_document?: string | null;
  lines: Array<{ product_id: string; product_name: string; unit_name: string; quantity: string }>;
};

export default function ReceiveStockPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<Choice[]>([]);
  const [warehouses, setWarehouses] = useState<Choice[]>([]);
  const [warehousesLoaded, setWarehousesLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const receiptRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([fetchApi("/suppliers?limit=100"), fetchApi("/inventory/warehouses")])
      .then(([supplierResult, warehouseResult]) => {
        setSuppliers(supplierResult.data || []);
        setWarehouses(warehouseResult);
        setWarehousesLoaded(true);
      })
      .catch(() => setError("تعذر تحميل الموردين أو المخازن"));
  }, []);

  function addProduct(product: Product) {
    setLines(previous => {
      const existing = previous.find(line => line.product.id === product.id);
      if (!existing) return [...previous, { product, quantity: "1" }];
      return previous.map(line => line.product.id === product.id
        ? { ...line, quantity: String(Number(line.quantity || 0) + 1) } : line);
    });
    setSearch("");
    setMatches([]);
    setError("");
    searchInput.current?.focus();
  }

  async function findProduct(event: FormEvent) {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    try {
      const result = await fetchApi(`/products?search=${encodeURIComponent(term)}&limit=20`);
      const found: Product[] = result.data || [];
      const exact = found.filter(product => [product.sku, product.barcode, product.name_ar, ...(product.units || []).map(unit => unit.barcode)]
        .some(value => value?.toLocaleLowerCase() === term.toLocaleLowerCase()));
      if (exact.length === 1) return addProduct(exact[0]);
      if (found.length === 1) return addProduct(found[0]);
      setMatches(found);
      setError(found.length ? "يوجد أكثر من صنف مطابق؛ اختر الصنف من النتائج." : "لم يُعثر على صنف بهذا الاسم أو الباركود.");
    } catch {
      setError("تعذر البحث عن المنتج");
    }
  }

  async function save() {
    const selectedWarehouseId = warehouses.length === 1 ? warehouses[0].id : warehouseId;
    if (!supplierId || !selectedWarehouseId || lines.length === 0 ||
        lines.some(line => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 99999999)) {
      setError("حدد المورد والمخزن وأضف أصنافًا بكميات موجبة.");
      return;
    }
    const payload = {
      supplier_id: supplierId, warehouse_id: selectedWarehouseId,
      supplier_document: reference.trim() || null,
      lines: lines.map(line => ({ product_id: line.product.id, quantity: line.quantity })),
    };
    const fingerprint = JSON.stringify(payload);
    if (receiptRequest.current?.fingerprint !== fingerprint) {
      receiptRequest.current = { fingerprint, id: crypto.randomUUID() };
    }
    setSaving(true);
    setError("");
    try {
      const saved = await fetchApi("/inventory/receipts", {
        method: "POST",
        body: JSON.stringify({ ...payload, request_id: receiptRequest.current.id }),
      }) as Receipt;
      setReceipt(saved);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ فاتورة الاستلام");
    } finally {
      setSaving(false);
    }
  }

  async function printReceipt() {
    if (!receipt) return;
    setPrinting(true);
    setError("");
    try {
      await sendLocalPrint({
        id: receipt.id, created_at: receipt.created_at,
        supplier_name: receipt.supplier_name, warehouse_name: receipt.warehouse_name,
        supplier_document: receipt.supplier_document,
        cart: receipt.lines.map(line => ({ name: line.product_name, unit: line.unit_name, qty: Number(line.quantity) })),
      }, "stock_receipt");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إرسال فاتورة الاستلام للطابعة");
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl">
      <div className="app-panel w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-7 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold">{receipt ? "فاتورة استلام المخزون" : "استلام مخزون"}</h2>
            <p className="app-muted text-sm">{receipt ? `رقم ${receipt.id}` : "الاستلام يزيد الكمية فقط. تعديل الأسعار من صفحة المنتج."}</p></div>
          <button type="button" onClick={onClose} className="app-muted hover:text-white">إغلاق</button>
        </div>
        {receipt ? <>
          <div className="grid gap-2 sm:grid-cols-2 text-sm"><p>المورد: <strong>{receipt.supplier_name}</strong></p><p>المخزن: <strong>{receipt.warehouse_name}</strong></p>
            <p>التاريخ: <strong>{new Date(receipt.created_at).toLocaleString("ar-EG")}</strong></p>
            {receipt.supplier_document && <p>مستند المورد: <strong>{receipt.supplier_document}</strong></p>}</div>
          <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-sm text-right"><thead className="bg-white/5"><tr><th className="p-3">الصنف</th><th className="p-3">الوحدة الأساسية</th><th className="p-3">الكمية المستلمة</th></tr></thead>
            <tbody>{receipt.lines.map(line => <tr key={line.product_id} className="border-t border-white/10"><td className="p-3">{line.product_name}</td><td className="p-3">{line.unit_name}</td><td className="p-3">{line.quantity}</td></tr>)}</tbody></table></div>
          <button type="button" disabled={printing} onClick={printReceipt} className="app-primary-button w-full">{printing ? "جارٍ الإرسال..." : "طباعة فاتورة الاستلام عبر التطبيق المحلي"}</button>
        </> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProductSelect label="المورد" value={supplierId} onChange={setSupplierId} placeholder="اختر المورد" options={suppliers.map(supplier => ({ value: supplier.id, label: supplier.name || "" }))} />
            {warehouses.length === 1 ? <p className="app-muted self-center text-sm">المخزن: <strong className="text-white">{warehouses[0].name}</strong></p> : warehouses.length > 1 ?
              <ProductSelect label="المخزن" value={warehouseId} onChange={setWarehouseId} placeholder="اختر المخزن" options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name || "" }))} /> :
              warehousesLoaded && <p role="alert" className="text-red-400">لا يوجد مخزن نشط.</p>}
          </div>
          <form onSubmit={findProduct} className="space-y-2"><label htmlFor="receiving-search" className="text-sm font-semibold">اسكن باركود الصنف أو اكتب اسمه ثم اضغط Enter</label>
            <div className="flex gap-2"><input id="receiving-search" ref={searchInput} autoFocus value={search} onChange={event => { setSearch(event.target.value); setMatches([]); }} placeholder="باركود أو اسم الصنف" className="app-field app-search-focus min-w-0 flex-1" />
              <button type="submit" className="app-secondary-button">إضافة</button></div></form>
          {matches.length > 0 && <div className="max-h-44 overflow-y-auto rounded-xl border border-white/10" role="listbox" aria-label="الأصناف المطابقة">{matches.map(product =>
            <button type="button" role="option" aria-selected="false" key={product.id} onClick={() => addProduct(product)} className="block w-full border-b border-white/10 px-3 py-2 text-right hover:bg-white/10">{product.name_ar} <span className="app-muted text-xs">{product.sku}</span></button>)}</div>}
          <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-sm text-right"><thead className="bg-white/5"><tr><th className="p-3">الصنف</th><th className="p-3">الكمية بالوحدة الأساسية</th><th className="p-3">حذف</th></tr></thead><tbody>
            {lines.length === 0 ? <tr><td colSpan={3} className="p-5 text-center app-muted">لم تُضف أصناف بعد</td></tr> : lines.map(line => <tr key={line.product.id} className="border-t border-white/10"><td className="p-3">{line.product.name_ar} <span className="app-muted">({line.product.base_unit})</span></td>
              <td className="p-3"><input aria-label={`كمية ${line.product.name_ar}`} type="number" min="0.01" max="99999999" step="0.01" value={line.quantity} onChange={event => setLines(previous => previous.map(item => item.product.id === line.product.id ? { ...item, quantity: event.target.value } : item))} className="app-field w-28 text-center" /></td>
              <td className="p-3"><button type="button" aria-label={`حذف ${line.product.name_ar}`} onClick={() => setLines(previous => previous.filter(item => item.product.id !== line.product.id))} className="text-red-300 hover:text-red-200">حذف</button></td></tr>)}</tbody></table></div>
          <label className="app-muted block text-sm">رقم مستند المورد · اختياري<input value={reference} onChange={event => setReference(event.target.value)} className="app-field mt-1" /></label>
          <button type="button" disabled={saving || warehouses.length === 0 || lines.length === 0} onClick={save} className="app-primary-button w-full">{saving ? "جارٍ الحفظ..." : "حفظ فاتورة الاستلام"}</button>
        </>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
