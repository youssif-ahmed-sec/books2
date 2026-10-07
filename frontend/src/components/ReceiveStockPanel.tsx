"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchApi } from "@/lib/api";

type Choice = { id: string; name?: string; name_ar?: string; sku?: string };

export default function ReceiveStockPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts] = useState<Choice[]>([]);
  const [suppliers, setSuppliers] = useState<Choice[]>([]);
  const [warehouses, setWarehouses] = useState<Choice[]>([]);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const receiptRequest = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchApi("/suppliers?limit=100"), fetchApi("/inventory/warehouses")])
      .then(([supplierResult, warehouseResult]) => {
        setSuppliers(supplierResult.data || []);
        setWarehouses(warehouseResult);
      })
      .catch(() => setError("تعذر تحميل الموردين أو المخازن"));
  }, []);

  async function searchProducts() {
    try {
      const result = await fetchApi(`/products?search=${encodeURIComponent(search)}&limit=100`);
      setProducts(result.data || []);
      setError("");
    } catch {
      setError("تعذر البحث عن المنتجات");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedCost = Number(unitCost);
    if (!productId || !supplierId || !warehouseId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedCost) || parsedCost < 0) {
      setError("اختر المنتج والمورد والمخزن، وأدخل كمية موجبة وتكلفة غير سالبة");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        product_id: productId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        transaction_type: "Receiving",
        quantity_changed: quantity,
        unit_cost: unitCost,
        reference_document: reference || null,
      };
      const fingerprint = JSON.stringify(payload);
      if (receiptRequest.current?.fingerprint !== fingerprint) {
        receiptRequest.current = { fingerprint, id: crypto.randomUUID() };
      }
      await fetchApi("/inventory/transactions", {
        method: "POST",
        body: JSON.stringify({ ...payload, request_id: receiptRequest.current.id }),
      });
      receiptRequest.current = null;
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الاستلام");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={save} className="app-panel w-full max-w-xl max-h-[90vh] overflow-y-auto p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">استلام مخزون</h2>
          <button type="button" onClick={onClose} className="app-muted hover:text-white">إغلاق</button>
        </div>
        <p className="app-muted text-sm">أدخل تكلفة شراء الوحدة الأساسية في هذا الاستلام؛ تُحفظ مع الحركة حتى لو تغير سعر المنتج لاحقًا.</p>
        <div className="flex gap-2">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم المنتج أو الرمز" className="app-field app-search-focus min-w-0 flex-1" />
          <button type="button" onClick={searchProducts} className="app-secondary-button">بحث</button>
        </div>
        <select required aria-label="المنتج" value={productId} onChange={event => setProductId(event.target.value)} className="app-field">
          <option value="">اختر المنتج</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.name_ar} ({product.sku})</option>)}
        </select>
        <select required aria-label="المورد" value={supplierId} onChange={event => setSupplierId(event.target.value)} className="app-field">
          <option value="">اختر المورد</option>
          {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select required aria-label="المخزن" value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className="app-field">
          <option value="">اختر المخزن</option>
          {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="app-muted text-sm">الكمية<input required type="number" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} className="app-field mt-1" /></label>
          <label className="app-muted text-sm">تكلفة الوحدة · ج.م<input required type="number" min="0" step="0.01" value={unitCost} onChange={event => setUnitCost(event.target.value)} className="app-field mt-1" /></label>
        </div>
        <label className="app-muted block text-sm">رقم المستند<input value={reference} onChange={event => setReference(event.target.value)} className="app-field mt-1" /></label>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button disabled={saving} className="app-primary-button w-full">{saving ? "جارٍ الحفظ..." : "تسجيل الاستلام"}</button>
      </form>
    </div>
  );
}
