"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { purchaseChatUrl } from "@/lib/whatsappPurchase";

type Supplier = { id: string; name: string; phone?: string | null };
type Document = { id: string; supplier_id: string; supplier_name: string; status: string; lines: {
  product_name: string; quantity: string; unit_name: string; base_unit_name: string;
  base_quantity: string; received_base_quantity: string;
}[] };
type LegacyOrder = { id: string; supplier_id: string; product_id: string; quantity: string; received_quantity: string; status: string };
type Choice = { key: string; label: string; supplierId: string; message: (supplierName: string) => string };

export default function WhatsAppIntegrationPage() {
  const query = useSearchParams();
  const purchaseId = query.get("purchase_id");
  const legacyPurchaseId = query.get("legacy_purchase_id");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [documents, oldOrders, supplierPage] = await Promise.all([
          fetchApi("/purchase-documents"), fetchApi("/purchases"), fetchApi("/suppliers?limit=1000"),
        ]);
        const vendors = (supplierPage.data || []) as Supplier[];
        const ready = (documents as Document[]).filter(doc => ["ORDERED", "PARTIALLY_RECEIVED"].includes(doc.status));
        const legacy = (oldOrders as LegacyOrder[]).filter(order => ["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status));
        const missingProducts = [...new Set(legacy.map(order => order.product_id))];
        const products = await Promise.allSettled(missingProducts.map(id => fetchApi(`/products/${id}`, { silentErrors: true })));
        const names = new Map(products.map((result, index) => [missingProducts[index], result.status === "fulfilled" ? (result.value as { name_ar: string }).name_ar : "صنف قديم"]));
        const supplierName = (id: string) => vendors.find(vendor => vendor.id === id)?.name || "المورد";
        const modernChoices: Choice[] = ready.map(doc => ({ key: `new:${doc.id}`, supplierId: doc.supplier_id,
          label: `${supplierName(doc.supplier_id) || doc.supplier_name} · ${doc.lines.length} أصناف · ${doc.id.slice(0, 8)}`,
          message: supplier => [
            `السلام عليكم ${supplier}،`, "معكم مكتبة سعود الشافعي. نرجو تأكيد أمر الشراء التالي:",
            `رقم الأمر: ${doc.id}`,
            ...doc.lines.map((line, index) => {
              const remaining = Number(line.base_quantity) - Number(line.received_base_quantity);
              return `${index + 1}. ${line.product_name}: المطلوب ${line.quantity} ${line.unit_name}، المتبقي ${remaining} ${line.base_unit_name}`;
            }),
            "برجاء تأكيد التوفر وموعد التسليم. شكرًا لكم.",
          ].join("\n"),
        }));
        const legacyChoices: Choice[] = legacy.map(order => ({ key: `legacy:${order.id}`, supplierId: order.supplier_id,
          label: `${supplierName(order.supplier_id)} · ${names.get(order.product_id)} · ${order.id.slice(0, 8)}`,
          message: supplier => [
            `السلام عليكم ${supplier}،`, "معكم مكتبة سعود الشافعي. نرجو تأكيد أمر الشراء التالي:",
            `رقم الأمر: ${order.id}`, `الصنف: ${names.get(order.product_id)}`,
            `الكمية المتبقية بالوحدة الأساسية: ${Number(order.quantity) - Number(order.received_quantity)}`,
            "برجاء تأكيد التوفر وموعد التسليم. شكرًا لكم.",
          ].join("\n"),
        }));
        if (!alive) return;
        setSuppliers(vendors); setChoices([...modernChoices, ...legacyChoices]);
        const target = purchaseId ? `new:${purchaseId}` : legacyPurchaseId ? `legacy:${legacyPurchaseId}` : "";
        const chosen = [...modernChoices, ...legacyChoices].find(item => item.key === target);
        if (chosen) { setSelected(chosen.key); setMessage(chosen.message(supplierName(chosen.supplierId))); }
        setError("");
      } catch (cause) { if (alive) setError(errorMessage(cause, "تعذر تحميل رسائل أوامر الشراء")); }
      finally { if (alive) setLoading(false); }
    };
    void load();
    return () => { alive = false; };
  }, [purchaseId, legacyPurchaseId]);

  const choice = choices.find(item => item.key === selected);
  const supplier = suppliers.find(item => item.id === choice?.supplierId);
  const url = choice && supplier ? purchaseChatUrl(supplier.phone || "", message) : null;
  const select = (key: string) => {
    setSelected(key);
    const picked = choices.find(item => item.key === key);
    const vendor = suppliers.find(item => item.id === picked?.supplierId);
    setMessage(picked?.message(vendor?.name || "المورد") || "");
  };

  return <div className="min-h-screen" dir="rtl"><SideNav /><TopNav title="تكامل واتساب" /><main className="app-main space-y-6"><header><h1 className="app-heading">تكامل واتساب</h1><p className="app-subtitle">جهّز رسالة أمر الشراء هنا، ثم افتح محادثة المورد في WhatsApp Web وراجعها قبل الإرسال.</p></header>
    <div className="app-panel max-w-3xl space-y-5 p-5 sm:p-7"><div className="flex items-center gap-3"><i className="bi bi-whatsapp text-3xl text-green-400" aria-hidden="true" /><div><h2 className="font-bold">رسالة المورد</h2><p className="app-muted text-sm">لا تُرسل أي رسالة تلقائيًا من النظام.</p></div></div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {loading ? <div className="space-y-3"><span className="app-skeleton h-11 w-full" /><span className="app-skeleton h-40 w-full" /></div> : <><label className="block text-sm font-bold">أمر الشراء<ProductSelect label="أمر الشراء" value={selected} placeholder="اختر أمر شراء جاهزًا" options={choices.map(item => ({ value: item.key, label: item.label }))} onChange={select} /></label>
        {choice && <><p className="app-muted text-sm">المورد: <strong>{supplier?.name || "غير معروف"}</strong> · رقم الواتساب: <span dir="ltr">{supplier?.phone || "غير مسجل"}</span></p><label className="block text-sm font-bold">نص الرسالة<textarea className="app-field mt-2 min-h-64 leading-7" value={message} onChange={event => setMessage(event.target.value)} maxLength={4000} /></label>
          {url ? <a className="app-primary-button inline-flex items-center gap-2" href={url} target="_blank" rel="noopener noreferrer"><i className="bi bi-whatsapp" aria-hidden="true" />فتح المحادثة بالرسالة المجهزة</a> : <p role="alert" className="text-sm text-amber-300">أضف رقم واتساب صالحًا للمورد قبل فتح المحادثة.</p>}</>}
        {!choice && <p className="app-muted text-sm">لا توجد رسالة محددة. اختر أمرًا حالته «تم الطلب» أو «استلام جزئي».</p>}</>}
    </div><p className="app-muted text-sm">النظام يعرف أن المحادثة فُتحت فقط؛ تأكيد إرسال الرسالة يكون داخل واتساب نفسه. <Link className="text-primary hover:underline" href="/purchases">الرجوع للمشتريات</Link></p></main></div>;
}
