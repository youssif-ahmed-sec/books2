"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { errorMessage } from "@/lib/errors";
import { getUserRole } from "@/utils/auth";

type Purchase = {
  id: string; product_id: string; supplier_id: string; quantity: number;
  received_quantity: number; status: string; created_at: string;
};
type Option = { id: string; name: string };
type ProductOption = { id: string; name_ar: string };
type SupplierOption = { id: string; name: string; phone?: string | null };
type ReceiptDraft = { quantity: string; warehouseId: string };

const statusLabels: Record<string, string> = {
  REQUESTED: "طلب شراء", APPROVED: "معتمد", ORDERED: "أمر شراء",
  PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "مستلم", REJECTED: "مرفوض",
};

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>(() => readSectionSnapshot<{ purchases: Purchase[] }>("purchases")?.purchases || []);
  const [products, setProducts] = useState<ProductOption[]>(() => readSectionSnapshot<{ products: ProductOption[] }>("purchases")?.products || []);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(() => readSectionSnapshot<{ suppliers: SupplierOption[] }>("purchases")?.suppliers || []);
  const [warehouses, setWarehouses] = useState<Option[]>(() => readSectionSnapshot<{ warehouses: Option[] }>("purchases")?.warehouses || []);
  const [receipts, setReceipts] = useState<Record<string, ReceiptDraft>>({});
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [orders, productPage, supplierPage, warehouseList] = await Promise.all([
      fetchApi("/purchases"), fetchApi("/products?is_bundle=false&limit=100"),
      fetchApi("/suppliers?limit=100"), fetchApi("/inventory/warehouses"),
    ]);
    const loadedProducts: ProductOption[] = productPage.data || [];
    const loadedSuppliers: SupplierOption[] = supplierPage.data || [];
    const productIds = new Set(loadedProducts.map(product => product.id));
    const supplierIds = new Set(loadedSuppliers.map(supplier => supplier.id));
    const openOrders = (orders as Purchase[]).filter(order => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status));
    const missingProductIds = [...new Set(openOrders.map(order => order.product_id))].filter(id => !productIds.has(id));
    const missingSupplierIds = [...new Set(openOrders.map(order => order.supplier_id))].filter(id => !supplierIds.has(id));
    const [extraProducts, extraSuppliers] = await Promise.all([
      Promise.allSettled(missingProductIds.map(id => fetchApi(`/products/${id}`))),
      Promise.allSettled(missingSupplierIds.map(id => fetchApi(`/suppliers/${id}`))),
    ]);
    const allProducts = [...loadedProducts, ...extraProducts.filter(result => result.status === "fulfilled").map(result => result.value as ProductOption)];
    const allSuppliers = [...loadedSuppliers, ...extraSuppliers.filter(result => result.status === "fulfilled").map(result => result.value as SupplierOption)];
    setPurchases(orders);
    setProducts(allProducts);
    setSuppliers(allSuppliers);
    setWarehouses(warehouseList);
    writeSectionSnapshot("purchases", { purchases: orders, products: allProducts, suppliers: allSuppliers, warehouses: warehouseList });
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { setRole(getUserRole()); void load().catch(err => setError(errorMessage(err, "فشل تحميل المشتريات"))); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const act = async (endpoint: string, body?: object) => {
    setBusy(true);
    setError("");
    try {
      await fetchApi(endpoint, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      await load();
    } catch (err) {
      setError(errorMessage(err, "لم تكتمل العملية"));
    } finally {
      setBusy(false);
    }
  };

  const receive = async (purchase: Purchase) => {
    const row = receipts[purchase.id];
    const selectedWarehouseId = warehouses.length === 1 ? warehouses[0].id : row?.warehouseId;
    if (!selectedWarehouseId || Number(row?.quantity) <= 0) {
      setError("اختر المخزن وأدخل الكمية المستلمة");
      return;
    }
    await act(`/purchases/${purchase.id}/receive`, {
      warehouse_id: selectedWarehouseId, quantity: Number(row.quantity),
      request_id: crypto.randomUUID(),
    });
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="أوامر الشراء القديمة" />
      <main className="app-main space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="app-heading">أوامر الشراء القديمة</h1></div><Link href="/purchases" className="app-secondary-button">العودة للمشتريات</Link></div>
        {error && <div className="app-panel p-4 text-red-300" role="alert">{error}</div>}
        <div className="space-y-3">
          {purchases.map(purchase => {
            const receipt = receipts[purchase.id] || { quantity: "", warehouseId: "" };
            const product = products.find(item => item.id === purchase.product_id);
            const supplier = suppliers.find(item => item.id === purchase.supplier_id);
            return <article key={purchase.id} data-search-id={purchase.id} className="motion-surface app-panel p-5 space-y-3">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-bold">{product?.name_ar || purchase.product_id}</p>
                  <p className="app-muted text-sm">{supplier?.name || purchase.supplier_id}</p>
                </div>
                <div className="text-sm">{statusLabels[purchase.status] || purchase.status} · {purchase.received_quantity}/{purchase.quantity}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {role === "ADMIN" && purchase.status === "REQUESTED" && <>
                  <button className="app-primary-button" disabled={busy} onClick={() => act(`/purchases/${purchase.id}/approve`)}>موافقة سعود</button>
                  <button className="app-secondary-button" disabled={busy} onClick={() => act(`/purchases/${purchase.id}/reject`)}>رفض</button>
                </>}
                {role === "ADMIN" && purchase.status === "APPROVED" && <button className="app-primary-button" disabled={busy} onClick={() => act(`/purchases/${purchase.id}/place`)}>إصدار أمر الشراء</button>}
                {role === "ADMIN" && ["ORDERED", "PARTIALLY_RECEIVED"].includes(purchase.status) && <Link className="app-secondary-button inline-flex items-center gap-2" href={`/integrations/whatsapp?legacy_purchase_id=${purchase.id}`}><i className="bi bi-whatsapp" aria-hidden="true" />رسالة واتساب</Link>}
              </div>
              {["ORDERED", "PARTIALLY_RECEIVED"].includes(purchase.status) && <div className="grid gap-2 md:grid-cols-3">
                {warehouses.length === 1 ? <p className="app-muted self-center text-sm">الاستلام إلى: <strong className="text-[#e5e2e1]">{warehouses[0].name}</strong></p> : warehouses.length > 1 ?
                  <div className="space-y-1"><p className="app-muted text-xs">يوجد أكثر من مخزن مسجل؛ حدد المستلم.</p>
                    <ProductSelect label="المخزن المستلم" value={receipt.warehouseId} placeholder="المخزن المستلم"
                      onChange={value => setReceipts(previous => ({ ...previous, [purchase.id]: { ...receipt, warehouseId: value } }))}
                      options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} />
                  </div> : <p role="alert" className="text-sm text-red-400">لا يوجد مخزن نشط للاستلام.</p>}
                <input className="app-field" type="number" min="0.01" step="0.01" placeholder="الكمية المستلمة" value={receipt.quantity} onChange={event => setReceipts({ ...receipts, [purchase.id]: { ...receipt, quantity: event.target.value } })} />
                <button className="app-primary-button" disabled={busy || warehouses.length === 0} onClick={() => receive(purchase)}>تسجيل الاستلام</button>
              </div>}
            </article>;
          })}
        </div>
      </main>
    </div>
  );
}
