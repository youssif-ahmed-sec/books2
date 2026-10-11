"use client";

import { useEffect, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { getUserRole } from "@/utils/auth";

type Purchase = {
  id: string; product_id: string; supplier_id: string; quantity: number;
  received_quantity: number; status: string; created_at: string;
};
type Option = { id: string; name: string };
type ProductOption = { id: string; name_ar: string };
type SupplierOption = { id: string; name: string; phone?: string | null };
type ReceiptDraft = { quantity: string; unitCost: string; warehouseId: string };

const statusLabels: Record<string, string> = {
  REQUESTED: "طلب شراء", APPROVED: "معتمد", ORDERED: "أمر شراء",
  PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "مستلم", REJECTED: "مرفوض",
};

function whatsappNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const ascii = phone.replace(/[٠-٩۰-۹]/g, digit =>
    String("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹".indexOf(digit) % 10));
  const compact = ascii.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  if (/^01\d{9}$/.test(compact)) return `20${compact.slice(1)}`;
  const international = compact.startsWith("00") ? compact.slice(2) : compact.replace(/^\+/, "");
  if (international.startsWith("20") && !/^20\d{10}$/.test(international)) return null;
  if (!/^[1-9]\d{7,14}$/.test(international)) return null;
  if (!compact.startsWith("+") && !compact.startsWith("00") && !international.startsWith("20")) return null;
  return international;
}

function purchaseWhatsAppUrl(purchase: Purchase, supplier: SupplierOption, product: ProductOption): string | null {
  const phone = whatsappNumber(supplier.phone);
  if (!phone) return null;
  const lines = [
    `السلام عليكم ${supplier.name}،`,
    "معكم مكتبة سعود الشافعي. نرجو تأكيد أمر الشراء التالي:",
    `رقم الأمر: ${purchase.id}`,
    `المنتج: ${product.name_ar}`,
    `الكمية بالوحدة الأساسية: ${purchase.quantity}`,
  ];
  if (purchase.status === "PARTIALLY_RECEIVED") {
    lines.push(`الكمية المتبقية: ${Math.max(0, purchase.quantity - purchase.received_quantity)}`);
  }
  lines.push("برجاء تأكيد التوفر وموعد التسليم. شكرًا لكم.");
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [draft, setDraft] = useState({ productId: "", supplierId: "", quantity: "" });
  const [receipts, setReceipts] = useState<Record<string, ReceiptDraft>>({});
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [orders, productPage, supplierPage, warehouseList] = await Promise.all([
      fetchApi("/purchases"), fetchApi("/products?limit=100"),
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
    setPurchases(orders);
    setProducts([...loadedProducts, ...extraProducts.filter(result => result.status === "fulfilled").map(result => result.value as ProductOption)]);
    setSuppliers([...loadedSuppliers, ...extraSuppliers.filter(result => result.status === "fulfilled").map(result => result.value as SupplierOption)]);
    setWarehouses(warehouseList);
  };

  useEffect(() => {
    setRole(getUserRole());
    load().catch(err => setError(errorMessage(err, "فشل تحميل المشتريات")));
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
    if (!selectedWarehouseId || Number(row?.quantity) <= 0 || Number(row?.unitCost) < 0 || !row?.unitCost) {
      setError("اختر المخزن وأدخل الكمية والتكلفة الفعلية");
      return;
    }
    await act(`/purchases/${purchase.id}/receive`, {
      warehouse_id: selectedWarehouseId, quantity: Number(row.quantity),
      unit_cost: Number(row.unitCost), request_id: crypto.randomUUID(),
    });
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="المشتريات" />
      <main className="app-main space-y-6">
        <div><h1 className="app-heading">طلبات وأوامر الشراء</h1><p className="app-subtitle">الموافقة ثم الطلب والاستلام بالمخزن</p></div>
        {error && <div className="app-panel p-4 text-red-300" role="alert">{error}</div>}
        <form className="app-panel p-6 grid gap-3 md:grid-cols-4" onSubmit={event => {
          event.preventDefault();
          if (!draft.productId || !draft.supplierId || Number(draft.quantity) <= 0) {
            setError("حدد المنتج والمورد وكمية موجبة");
            return;
          }
          act("/purchases", { product_id: draft.productId, supplier_id: draft.supplierId, quantity: Number(draft.quantity) });
        }}>
          <ProductSelect label="المنتج" value={draft.productId} onChange={value => setDraft(previous => ({ ...previous, productId: value }))}
            placeholder="المنتج" options={products.map(product => ({ value: product.id, label: product.name_ar }))} />
          <ProductSelect label="المورد" value={draft.supplierId} onChange={value => setDraft(previous => ({ ...previous, supplierId: value }))}
            placeholder="المورد" options={suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))} />
          <input className="app-field" type="number" min="0.01" step="0.01" placeholder="الكمية بالوحدة الأساسية" value={draft.quantity} onChange={event => setDraft({ ...draft, quantity: event.target.value })} />
          <button className="app-primary-button" disabled={busy}>طلب شراء</button>
        </form>
        <div className="space-y-3">
          {purchases.map(purchase => {
            const receipt = receipts[purchase.id] || { quantity: "", unitCost: "", warehouseId: "" };
            const product = products.find(item => item.id === purchase.product_id);
            const supplier = suppliers.find(item => item.id === purchase.supplier_id);
            const whatsappUrl = product && supplier ? purchaseWhatsAppUrl(purchase, supplier, product) : null;
            return <article key={purchase.id} className="app-panel p-5 space-y-3">
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
                {["ORDERED", "PARTIALLY_RECEIVED"].includes(purchase.status) && (whatsappUrl ?
                  <a className="app-secondary-button inline-flex items-center gap-2" href={whatsappUrl} target="_blank" rel="noopener noreferrer" title="تُفتح رسالة جاهزة للمراجعة قبل إرسالها من واتساب" aria-label={`فتح رسالة واتساب جاهزة للمورد ${supplier?.name}`}>
                    <i className="bi bi-whatsapp" aria-hidden="true" />مراسلة المورد عبر واتساب
                  </a> :
                  <span className="app-muted self-center text-sm" title="أضف رقم المورد بصيغة دولية أو رقم محمول مصري، وتأكد من بيانات المنتج">واتساب غير متاح: رقم المورد أو بيانات المنتج غير مكتملة</span>)}
              </div>
              {["ORDERED", "PARTIALLY_RECEIVED"].includes(purchase.status) && <div className="grid gap-2 md:grid-cols-4">
                {warehouses.length === 1 ? <p className="app-muted self-center text-sm">الاستلام إلى: <strong className="text-[#e5e2e1]">{warehouses[0].name}</strong></p> : warehouses.length > 1 ?
                  <div className="space-y-1"><p className="app-muted text-xs">يوجد أكثر من مخزن مسجل؛ حدد المستلم.</p>
                    <ProductSelect label="المخزن المستلم" value={receipt.warehouseId} placeholder="المخزن المستلم"
                      onChange={value => setReceipts(previous => ({ ...previous, [purchase.id]: { ...receipt, warehouseId: value } }))}
                      options={warehouses.map(warehouse => ({ value: warehouse.id, label: warehouse.name }))} />
                  </div> : <p role="alert" className="text-sm text-red-400">لا يوجد مخزن نشط للاستلام.</p>}
                <input className="app-field" type="number" min="0.01" step="0.01" placeholder="الكمية المستلمة" value={receipt.quantity} onChange={event => setReceipts({ ...receipts, [purchase.id]: { ...receipt, quantity: event.target.value } })} />
                <input className="app-field" type="number" min="0" step="0.01" placeholder="تكلفة الوحدة الفعلية" value={receipt.unitCost} onChange={event => setReceipts({ ...receipts, [purchase.id]: { ...receipt, unitCost: event.target.value } })} />
                <button className="app-primary-button" disabled={busy || warehouses.length === 0} onClick={() => receive(purchase)}>تسجيل الاستلام</button>
              </div>}
            </article>;
          })}
        </div>
      </main>
    </div>
  );
}
