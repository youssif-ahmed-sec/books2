"use client";

import { useCallback, useEffect, useState } from "react";
import { ProductSelect } from "@/components/ProductSelect";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { getUserRole } from "@/utils/auth";

const tiers = [
  { value: "Retail", label: "قطاعي" }, { value: "Semi Wholesale", label: "نصف جملة" },
  { value: "Wholesale", label: "جملة" }, { value: "Super Wholesale", label: "سوبر جملة" },
  { value: "VIP", label: "كبار العملاء" },
];
type CatalogUnit = { id: string; unit_name: string; conversion_factor: number; prices: { price_level: string; price: string }[] };
type CatalogProduct = { id: string; name_ar: string; sku: string; is_active: boolean; units: CatalogUnit[] };
type OfferLine = { component_id: string; product_name: string; unit_id: string | null; unit_name: string | null; price_level: string | null; quantity: string };
type Offer = { id: string; name: string; is_active: boolean; sale_price: string | null; reference_total: string; components: OfferLine[] };
type DraftLine = { key: string; productId: string; unitId: string; priceLevel: string; quantity: string };
const money = (amount: number) => Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
const tierName = (value: string | null) => tiers.find(tier => tier.value === value)?.label || "غير محدد";

function OfferEditor({ offer, onClose, onSaved }: { offer: Offer | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(offer?.name || "");
  const [lines, setLines] = useState<DraftLine[]>(() => offer?.components.map(line => ({
    key: crypto.randomUUID(), productId: line.component_id, unitId: line.unit_id || "",
    priceLevel: line.price_level || "Retail", quantity: line.quantity,
  })) || []);
  const [products, setProducts] = useState<Record<string, CatalogProduct>>({});
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualPrice, setManualPrice] = useState(() => !!offer && Math.abs(Number(offer.sale_price) - Number(offer.reference_total)) > .005);
  const [priceInput, setPriceInput] = useState(offer?.sale_price || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!offer) return;
    let active = true;
    void Promise.allSettled(offer.components.map(line => fetchApi(`/products/${line.component_id}`))).then(values => {
      if (!active) return;
      const found = values.filter(result => result.status === "fulfilled").map(result => result.value as CatalogProduct);
      setProducts(Object.fromEntries(found.map(product => [product.id, product])));
    });
    return () => { active = false; };
  }, [offer]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetchApi(`/products?is_bundle=false&limit=30&search=${encodeURIComponent(search.trim())}`, { silentErrors: true })
        .then((page: { data?: CatalogProduct[] }) => { if (active) setResults(page.data || []); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);

  const addProduct = (product: CatalogProduct) => {
    const unit = product.units.find(item => item.prices.some(price => price.price_level === "Retail" && Number(price.price) > 0))
      || product.units.find(item => item.prices.some(price => Number(price.price) > 0));
    if (!unit) { setError("الصنف لا يملك وحدة بسعر صالح للعرض."); return; }
    const price = unit.prices.find(item => item.price_level === "Retail" && Number(item.price) > 0)
      || unit.prices.find(item => Number(item.price) > 0);
    setProducts(previous => ({ ...previous, [product.id]: product }));
    setLines(previous => [...previous, { key: crypto.randomUUID(), productId: product.id,
      unitId: unit.id, priceLevel: price?.price_level || "Retail", quantity: "1" }]);
    setSearch(""); setError("");
  };
  const updateLine = (key: string, changes: Partial<DraftLine>) =>
    setLines(previous => previous.map(line => line.key === key ? { ...line, ...changes } : line));
  const unitFor = (line: DraftLine) => products[line.productId]?.units.find(unit => unit.id === line.unitId);
  const priceFor = (line: DraftLine) => Number(unitFor(line)?.prices.find(price => price.price_level === line.priceLevel)?.price || 0);
  const referenceTotal = lines.reduce((sum, line) => sum + priceFor(line) * Number(line.quantity || 0), 0);
  const finalPrice = manualPrice ? Number(priceInput) : referenceTotal;
  const validLines = lines.length > 0 && lines.every(line => products[line.productId]?.is_active && unitFor(line)
    && priceFor(line) > 0 && Number.isInteger(Number(line.quantity)) && Number(line.quantity) > 0);
  const cannotSave = busy || name.trim().length < 2 || !validLines || !Number.isFinite(finalPrice) || finalPrice <= 0;

  const save = async () => {
    if (cannotSave) return;
    setBusy(true); setError("");
    try {
      await fetchApi(offer ? `/offers/${offer.id}` : "/offers", { method: offer ? "PUT" : "POST", body: JSON.stringify({
        name: name.trim(), sale_price: money(finalPrice),
        components: lines.map(line => ({ component_id: line.productId, unit_id: line.unitId,
          price_level: line.priceLevel, quantity: Number(line.quantity) })),
      }) });
      await onSaved(); onClose();
    } catch (cause) { setError(errorMessage(cause, "تعذر حفظ العرض")); }
    finally { setBusy(false); }
  };

  return <div className="motion-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6" dir="rtl" role="dialog" aria-modal="true" aria-label={offer ? "تعديل العرض" : "إضافة عرض"}>
    <div className="motion-dialog app-panel flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
        <div><h2 className="text-xl font-bold">{offer ? "تعديل العرض" : "عرض جديد"}</h2></div>
        <button type="button" onClick={onClose} className="app-icon-button" aria-label="إغلاق"><span className="material-symbols-outlined">close</span></button>
      </header>
      <div className="custom-scrollbar grid gap-6 overflow-y-auto p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="min-w-0 space-y-5">
          <label className="block text-sm font-bold">اسم العرض<input className="app-field mt-2" value={name} onChange={event => setName(event.target.value)} maxLength={160} placeholder="مثال: باقة العودة للمدارس" autoFocus /></label>
          <section className="space-y-3"><div><h3 className="font-bold">منتجات العرض</h3></div>
            <input className="app-field app-search-focus" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث عن صنف موجود..." aria-label="بحث عن منتج للعرض" />
            <div className="custom-scrollbar max-h-40 overflow-y-auto rounded-xl border border-white/10 p-1">
              {searching ? <p className="app-muted p-3 text-sm">جاري البحث...</p> : results.length ? results.map(product =>
                <button type="button" key={product.id} disabled={!product.is_active} onClick={() => addProduct(product)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-white/5 disabled:opacity-50"><span className="min-w-0 truncate">{product.name_ar} <span className="app-muted text-xs" dir="ltr">{product.sku}</span></span><span className="shrink-0 font-bold text-primary">إضافة +</span></button>) : <p className="app-muted p-3 text-sm">لا توجد أصناف مطابقة.</p>}
            </div>
          </section>
          <div className="space-y-3">{lines.length === 0 ? <div className="rounded-xl border border-dashed border-white/15 p-7 text-center app-muted">أضف أول منتج ليظهر حساب العرض.</div> : lines.map(line => {
            const product = products[line.productId]; const unit = unitFor(line);
            const available = unit?.prices.filter(price => Number(price.price) > 0) || [];
            return <div key={line.key} className="app-panel p-4">
              <div className="mb-3 flex items-start justify-between gap-3"><strong>{product?.name_ar || "جاري تحميل الصنف..."}</strong><button type="button" onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))} className="text-sm text-red-300 hover:underline">إزالة</button></div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="min-w-0 text-sm">الوحدة<ProductSelect label={`وحدة ${product?.name_ar || "الصنف"}`} value={line.unitId} placeholder="اختر الوحدة" options={(product?.units || []).map(item => ({ value: item.id, label: item.unit_name }))} onChange={value => {
                  const selected = product?.units.find(item => item.id === value);
                  const tier = selected?.prices.find(price => price.price_level === "Retail" && Number(price.price) > 0) || selected?.prices.find(price => Number(price.price) > 0);
                  updateLine(line.key, { unitId: value, priceLevel: tier?.price_level || "" });
                }} compact /></label>
                <label className="min-w-0 text-sm">التسعير<ProductSelect label={`تسعير ${product?.name_ar || "الصنف"}`} value={line.priceLevel} placeholder="اختر التسعير" options={available.map(price => ({ value: price.price_level, label: `${tierName(price.price_level)} · ${money(Number(price.price))} ج.م` }))} onChange={value => updateLine(line.key, { priceLevel: value })} compact /></label>
                <label className="text-sm">العدد من هذه الوحدة<ZeroHintNumberInput className="app-field mt-1 h-11" min="1" step="1" value={line.quantity} placeholder="1" onChange={event => updateLine(line.key, { quantity: event.target.value })} /></label>
              </div>
              <p className="app-muted mt-3 text-sm">{money(priceFor(line))} × {line.quantity || "0"} = <strong className="text-primary" dir="ltr">{money(priceFor(line) * Number(line.quantity || 0))} ج.م</strong></p>
            </div>;
          })}</div>
        </div>
        <aside className="app-panel h-fit space-y-4 p-5 lg:sticky lg:top-0"><h3 className="font-bold">معاينة السعر</h3>
          <div className="flex justify-between gap-3 text-sm"><span className="app-muted">مجموع الأسعار المختارة</span><strong dir="ltr">{money(referenceTotal)} ج.م</strong></div>
          <label className="block text-sm font-bold">سعر بيع العرض<ZeroHintNumberInput className="app-field mt-2 text-xl font-bold" min="0.01" step="0.01" value={manualPrice ? priceInput : money(referenceTotal)} onChange={event => { setManualPrice(true); setPriceInput(event.target.value); }} dir="ltr" /></label>
          {manualPrice && <button type="button" onClick={() => { setManualPrice(false); setPriceInput(""); }} className="text-sm font-semibold text-primary hover:underline">استخدم المجموع المحسوب</button>}
          {referenceTotal > 0 && finalPrice > 0 && <p className="app-muted border-t border-white/10 pt-3 text-sm">{finalPrice < referenceTotal ? `توفير ${money(referenceTotal - finalPrice)} ج.م` : finalPrice > referenceTotal ? `زيادة ${money(finalPrice - referenceTotal)} ج.م عن المجموع` : "السعر يساوي مجموع المنتجات"}</p>}
          <p className="app-muted text-xs leading-6">سعر العرض النهائي واحد لكل شرائح العملاء. المخزون يُخصم من المنتجات المكوِّنة عند البيع.</p>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button type="button" disabled={cannotSave} onClick={() => void save()} className="app-primary-button w-full">{busy ? "جاري الحفظ..." : offer ? "حفظ التعديلات" : "نشر العرض"}</button>
        </aside>
      </div>
    </div>
  </div>;
}

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>(() => readSectionSnapshot<Offer[]>("offers") || []);
  const [loading, setLoading] = useState(() => !readSectionSnapshot("offers"));
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Offer | "new" | null>(null);
  const [deleting, setDeleting] = useState<Offer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const load = useCallback(async () => {
    try { const data = await fetchApi("/offers") as Offer[]; setOffers(data); writeSectionSnapshot("offers", data); setError(""); }
    catch (cause) { setError(errorMessage(cause, "تعذر تحميل العروض")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { const role = getUserRole(); setCanCreate(role === "ADMIN" || role === "INVENTORY_CONTROLLER"); setCanManage(role === "ADMIN"); void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const toggle = async (offer: Offer) => {
    setBusyId(offer.id); setError("");
    try { await fetchApi(`/offers/${offer.id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !offer.is_active }) }); await load(); }
    catch (cause) { setError(errorMessage(cause, "تعذر تغيير حالة العرض")); }
    finally { setBusyId(null); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusyId(deleting.id); setError("");
    try { await fetchApi(`/offers/${deleting.id}`, { method: "DELETE" }); setDeleting(null); await load(); }
    catch (cause) { setError(errorMessage(cause, "تعذر حذف العرض")); }
    finally { setBusyId(null); }
  };
  return <div className="min-h-screen" dir="rtl">
    <main className="app-main space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="app-heading">العروض</h1></div>{canCreate && <button type="button" onClick={() => setEditing("new")} className="app-primary-button"><span className="material-symbols-outlined text-lg">add</span>إنشاء عرض</button>}</div>
      {error && <p role="alert" className="app-panel p-4 text-red-300">{error}</p>}
      {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="جاري تحميل العروض">{[0, 1, 2].map(index => <div key={index} className="app-panel space-y-4 p-5"><span className="app-skeleton h-5 w-36" /><span className="app-skeleton h-4 w-52 max-w-full" /><span className="app-skeleton h-4 w-28" /></div>)}</div> : offers.length === 0 ?
        <div className="app-panel p-10 text-center"><span className="material-symbols-outlined mb-2 text-4xl text-primary">sell</span><p className="font-bold">مفيش عروض مسجلة لسه</p><p className="app-muted mt-1 text-sm">ابدأ بتجميع أصناف من المخزون في عرض جديد.</p></div> :
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{offers.map(offer => {
          const sale = Number(offer.sale_price || 0); const reference = Number(offer.reference_total || 0);
          return <article key={offer.id} data-search-id={offer.id} className="app-panel flex flex-col gap-4 p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{offer.name}</h2><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${offer.is_active ? "bg-green-500/10 text-green-400" : "bg-white/10 app-muted"}`}>{offer.is_active ? "نشط" : "غير نشط"}</span></div><span className="material-symbols-outlined text-primary">sell</span></div>
            <ul className="min-h-14 space-y-1 text-sm">{offer.components.map((line, index) => <li key={`${line.component_id}-${index}`} className="app-muted">{line.product_name} · {line.quantity} {line.unit_name || "وحدة"} · {tierName(line.price_level)}</li>)}</ul>
            <div className="app-divider border-t pt-3"><div className="flex items-baseline justify-between gap-2"><span className="app-muted text-sm">سعر العرض</span><strong className="text-xl text-primary" dir="ltr">{money(sale)} ج.م</strong></div><p className="app-muted mt-1 text-xs">مجموع المنتجات: {money(reference)} ج.م{reference > sale ? ` · توفير ${money(reference - sale)} ج.م` : ""}</p></div>
            {canManage && <div className="mt-auto flex flex-wrap gap-2 border-t border-white/10 pt-3"><button type="button" disabled={!!busyId} onClick={() => setEditing(offer)} className="app-secondary-button !px-3 !py-2">تعديل</button><button type="button" disabled={!!busyId} onClick={() => void toggle(offer)} className="app-secondary-button !px-3 !py-2">{offer.is_active ? "إلغاء التفعيل" : "تفعيل"}</button><button type="button" disabled={!!busyId} onClick={() => setDeleting(offer)} className="app-secondary-button !px-3 !py-2 text-red-300">حذف</button></div>}</article>;
        })}</div>}
    </main>
    {editing && <OfferEditor offer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
    {deleting && <div className="motion-overlay fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="تأكيد حذف العرض"><div className="motion-dialog app-panel w-full max-w-md space-y-4 p-6"><h2 className="text-lg font-bold">حذف «{deleting.name}»؟</h2><p className="app-muted text-sm">سيختفي العرض من القائمة والبيع، مع بقاء سجل العمليات السابقة.</p>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex flex-wrap gap-2"><button type="button" disabled={!!busyId} onClick={() => void remove()} className="app-primary-button">تأكيد الحذف</button><button type="button" onClick={() => setDeleting(null)} className="app-secondary-button">إلغاء</button></div></div></div>}
  </div>;
}
