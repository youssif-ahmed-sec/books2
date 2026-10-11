"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";

type Price = { price_level: string; price: string };
type Unit = { id: string; unit_name: string; conversion_factor: string; barcode?: string; prices: Price[] };
type Product = {
  id: string; name_ar: string; name_en?: string; sku: string; barcode?: string;
  category?: { name_ar: string }; subcategory?: { name_ar: string };
  brand?: { name_ar: string }; supplier?: { name: string };
  description?: string; image_url?: string; warehouse_location?: string;
  base_unit: string; current_stock: string; min_stock_level: string; max_stock_level: string;
  is_active: boolean; created_at: string; updated_at?: string; units: Unit[];
};
type Balance = { product_id: string; warehouse_name?: string; current_stock: string };
type Movement = { id: string; transaction_type: string; quantity_changed: string; created_at: string; notes?: string; reference_document?: string; warehouse_id: string };
type History = { id: string; action: string; created_at: string };

const priceNames: Record<string, string> = {
  Retail: "مستهلك", "Semi Wholesale": "نصف جملة", Wholesale: "جملة",
  "Super Wholesale": "سوبر جملة", VIP: "كبار العملاء",
};
const actionNames: Record<string, string> = {
  CREATE_PRODUCT: "إضافة المنتج", UPDATE_PRODUCT: "تعديل بيانات المنتج",
  DELETE_PRODUCT: "حذف المنتج", INVENTORY_MOVEMENT: "حركة مخزون",
  TRANSFER_STOCK: "نقل بين المخازن", COUNT_STOCK: "جرد مخزون",
};
const movementNames: Record<string, string> = {
  Receiving: "استلام بضاعة", Issuing: "صرف بضاعة", Transfer: "نقل مخزون",
  Adjustment: "تسوية", Counting: "جرد",
};

function ProductDetails() {
  const id = useSearchParams().get("id");
  const [product, setProduct] = useState<Product | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setError("لم يُحدد منتج لعرضه"); setLoading(false); return; }
    let active = true;
    Promise.all([
      fetchApi(`/products/${id}`),
      fetchApi("/inventory/balances"),
      fetchApi(`/inventory/transactions?product_id=${encodeURIComponent(id)}&limit=100`),
      fetchApi(`/products/${id}/history`),
    ]).then(([item, stock, transactions, events]) => {
      if (!active) return;
      setProduct(item);
      setBalances((stock as Balance[]).filter(balance => balance.product_id === id));
      setMovements(transactions.data || []);
      setHistory(events || []);
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : "تعذر تحميل تفاصيل المنتج"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const timeline = [
    ...movements.map(item => ({ id: item.id, date: item.created_at, title: movementNames[item.transaction_type] || item.transaction_type,
      detail: `${Number(item.quantity_changed) > 0 ? "+" : ""}${item.quantity_changed} ${product?.base_unit || ""}${item.reference_document ? ` · ${item.reference_document}` : ""}${item.notes ? ` · ${item.notes}` : ""}` })),
    ...history.filter(item => item.action !== "INVENTORY_MOVEMENT").map(item => ({ id: item.id, date: item.created_at,
      title: actionNames[item.action] || item.action, detail: "" })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return <div className="min-h-screen bg-[#131313] text-[#e5e2e1]" dir="rtl">
    <SideNav />
    <TopNav title="تفاصيل المنتج" />
    <main className="app-main space-y-6">
      <Link href="/inventory" className="inline-flex items-center gap-2 text-primary font-bold hover:underline">
        <span className="material-symbols-outlined">arrow_forward</span> قائمة المنتجات
      </Link>
      {loading ? <div className="app-panel p-8 space-y-5" aria-label="جاري تحميل تفاصيل المنتج">
        <span className="app-skeleton h-8 w-48" /><span className="app-skeleton h-28 w-full" /><span className="app-skeleton h-28 w-full" />
      </div> : error ? <div role="alert" className="app-panel p-8 text-red-300">{error}</div> : product && <>
        <header className="app-panel p-6 md:p-8 flex flex-wrap items-center gap-5">
          {product.image_url ? <img src={product.image_url} alt="" className="h-20 w-20 rounded-2xl object-cover" /> :
            <span className="material-symbols-outlined text-primary text-5xl" aria-hidden="true">inventory_2</span>}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{product.name_ar}</h1>
            {product.name_en && <p className="app-muted">{product.name_en}</p>}
            <p className="app-muted text-sm" dir="ltr">{product.sku}</p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-bold ${product.is_active ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-300"}`}>
            {product.is_active ? "نشط" : "غير نشط"}
          </span>
        </header>
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="بيانات المنتج">
          {[["التصنيف", product.category?.name_ar], ["الفئة الفرعية", product.subcategory?.name_ar],
            ["العلامة التجارية", product.brand?.name_ar], ["المورد الأساسي", product.supplier?.name]].map(([label, value]) =>
            <div key={label} className="app-panel p-5"><p className="app-muted text-sm">{label}</p><p className="font-bold mt-2">{value || "غير محدد"}</p></div>)}
        </section>
        {(product.description || product.warehouse_location) && <section className="app-panel p-6 grid gap-4 md:grid-cols-2">
          {product.description && <div><h2 className="font-bold mb-2">الوصف</h2><p className="app-muted whitespace-pre-wrap">{product.description}</p></div>}
          {product.warehouse_location && <div><h2 className="font-bold mb-2">مكان الصنف</h2><p className="app-muted">{product.warehouse_location}</p></div>}
        </section>}
        <section className="app-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">الرصيد بالمخازن</h2>
          <p className="text-primary font-bold text-lg">الإجمالي: {product.current_stock} {product.base_unit}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {balances.length ? balances.map((balance, index) => <div key={index} className="rounded-2xl border border-white/10 p-4 flex justify-between gap-3">
              <span>{balance.warehouse_name || "مخزن"}</span><strong>{balance.current_stock} {product.base_unit}</strong>
            </div>) : <p className="app-muted">لا يوجد رصيد مسجل في أي مخزن</p>}
          </div>
          <p className="app-muted text-sm">حد إعادة الطلب: {product.min_stock_level} · السعة المرجعية: {product.max_stock_level}</p>
        </section>
        <section className="app-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">الوحدات والباركود والتسعير</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {product.units.map(unit => <div key={unit.id} className="rounded-2xl border border-white/10 p-5 space-y-3">
              <div className="flex justify-between gap-3"><h3 className="font-bold">{unit.unit_name}</h3><span className="app-muted">= {unit.conversion_factor} {product.base_unit}</span></div>
              <p className="font-mono text-primary text-sm" dir="ltr">{unit.barcode || "لا يوجد باركود"}</p>
              <div className="grid grid-cols-2 gap-2">{unit.prices.map(price => <div key={price.price_level} className="text-sm rounded-xl bg-white/5 p-3">
                <span className="app-muted">{priceNames[price.price_level] || price.price_level}: </span><strong>{price.price} ج.م</strong>
              </div>)}</div>
            </div>)}
          </div>
        </section>
        <section className="app-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">سجل المنتج والحركات</h2>
          {timeline.length ? <ol className="space-y-3">{timeline.map(event => <li key={event.id} className="rounded-2xl border border-white/10 p-4 flex flex-wrap justify-between gap-3">
            <div><strong>{event.title}</strong>{event.detail && <p className="app-muted text-sm mt-1">{event.detail}</p>}</div>
            <time className="app-muted text-sm" dateTime={event.date}>{new Date(event.date).toLocaleString("ar-EG")}</time>
          </li>)}</ol> : <p className="app-muted">لا توجد حركات مسجلة</p>}
          <p className="app-muted text-xs">آخر 100 حركة مخزون وآخر 100 حدث للمنتج.</p>
        </section>
      </>}
    </main>
  </div>;
}

export default function ProductPage() {
  return <Suspense fallback={<div className="app-panel m-8 p-8">جاري تحميل تفاصيل المنتج…</div>}><ProductDetails /></Suspense>;
}
