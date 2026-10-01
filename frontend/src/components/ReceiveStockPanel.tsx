"use client";

import { useEffect, useState, type FormEvent } from "react";
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
      await fetchApi("/inventory/transactions", {
        method: "POST",
        body: JSON.stringify({
          product_id: productId,
          supplier_id: supplierId,
          warehouse_id: warehouseId,
          transaction_type: "Receiving",
          quantity_changed: quantity,
          unit_cost: unitCost,
          reference_document: reference || null,
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الاستلام");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={save} className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1c1b1b] border border-white/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">استلام مخزون</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">إغلاق</button>
        </div>
        <p className="text-xs text-zinc-400">أدخل تكلفة شراء الوحدة الأساسية في هذا الاستلام؛ ستُحفظ مع الحركة حتى لو تغير سعر المنتج لاحقًا.</p>
        <div className="flex gap-2">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم المنتج أو الرمز" className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 p-3" />
          <button type="button" onClick={searchProducts} className="rounded-lg bg-zinc-700 px-4">بحث</button>
        </div>
        <select required value={productId} onChange={event => setProductId(event.target.value)} className="w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3">
          <option value="">اختر المنتج</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.name_ar} ({product.sku})</option>)}
        </select>
        <select required value={supplierId} onChange={event => setSupplierId(event.target.value)} className="w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3">
          <option value="">اختر المورد</option>
          {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select required value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className="w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3">
          <option value="">اختر المخزن</option>
          {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">الكمية<input required type="number" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3" /></label>
          <label className="text-sm">تكلفة الوحدة<input required type="number" min="0" step="0.01" value={unitCost} onChange={event => setUnitCost(event.target.value)} className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3" /></label>
        </div>
        <label className="block text-sm">رقم المستند<input value={reference} onChange={event => setReference(event.target.value)} className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 p-3" /></label>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button disabled={saving} className="w-full rounded-lg bg-primary p-3 font-bold disabled:opacity-50">{saving ? "جارٍ الحفظ..." : "تسجيل الاستلام"}</button>
      </form>
    </div>
  );
}
