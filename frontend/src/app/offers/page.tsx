"use client";

import { useCallback, useEffect, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { AddProductPanel } from "@/components/AddProductPanel";
import { EditProductPanel } from "@/components/EditProductPanel";
import { fetchApi } from "@/lib/api";
import { getUserRole } from "@/utils/auth";

interface OfferRecord {
  id: string;
  name_ar: string;
  is_bundle: boolean;
  bundle_components: Array<{ component_id: string; unit_id: string | null; price_level: string | null; quantity: number }>;
  units: Array<{ id: string; unit_name: string; conversion_factor: number; prices: Array<{ price_level: string; price: string }> }>;
}

export default function OffersPage() {
  const [products, setProducts] = useState<OfferRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchApi("/products?limit=1000");
      setProducts(result.data || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل العروض");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setCanManage(getUserRole() === "ADMIN"); void load(); }, [load]);
  const offers = products.filter(product => product.is_bundle);
  const productName = (id: string) => products.find(product => product.id === id)?.name_ar || "صنف غير متاح";
  const componentDetails = (component: OfferRecord["bundle_components"][number]) => {
    const unit = products.find(product => product.id === component.component_id)?.units.find(item => item.id === component.unit_id);
    const count = unit ? Number(component.quantity) / Number(unit.conversion_factor) : Number(component.quantity);
    const tier = ({ Retail: "قطاعي", "Semi Wholesale": "نصف جملة", Wholesale: "جملة", "Super Wholesale": "سوبر جملة", VIP: "كبار العملاء" } as Record<string, string>)[component.price_level || ""];
    return `${count} ${unit?.unit_name || "قطعة"}${tier ? ` · ${tier}` : ""}`;
  };

  return <div className="min-h-screen" dir="rtl">
    <SideNav />
    <TopNav title="العروض" />
    <main className="app-main">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="app-heading">العروض</h1><p className="app-subtitle">كوّن عرضًا من أصناف ووحدات محددة، ثم حدد سعر بيعه.</p></div>
        {canManage && <button type="button" onClick={() => setAdding(true)} className="app-primary-button">إضافة عرض</button>}
      </div>
      {error && <p role="alert" className="mb-4 text-red-400">{error}</p>}
      {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="جاري تحميل العروض">
        {[0, 1, 2].map(index => <div key={index} className="glass rounded-2xl p-5" aria-hidden="true">
          <div className="mb-3 flex items-start justify-between gap-3"><span className="app-skeleton h-6 w-36" />{canManage && <span className="app-skeleton h-4 w-10" />}</div>
          <div className="space-y-1"><span className="app-skeleton h-4 w-52 max-w-full" /><span className="app-skeleton h-4 w-40 max-w-full" /></div>
          <div className="mt-4 border-t border-white/10 pt-3"><span className="app-skeleton h-4 w-28" /></div>
        </div>)}
      </div> : offers.length === 0 ?
        <div className="glass rounded-2xl p-8 text-center text-[#e2bfb0]">لا توجد عروض مسجلة بعد.</div> :
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {offers.map(offer => <article key={offer.id} className="glass rounded-2xl p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{offer.name_ar}</h2>
              {canManage && <button type="button" onClick={() => setEditing(offer.id)} className="text-sm font-semibold text-primary">تعديل</button>}
            </div>
            <ul className="space-y-1 text-sm text-[#e2bfb0]">
              {offer.bundle_components.map((component, index) => <li key={`${component.component_id}-${index}`}>• {productName(component.component_id)} · {componentDetails(component)}</li>)}
            </ul>
            <p className="mt-4 border-t border-white/10 pt-3 text-sm">سعر المستهلك: {offer.units[0]?.prices.find(price => price.price_level === "Retail")?.price || "0"} ج.م</p>
          </article>)}
        </div>}
    </main>
    {adding && <AddProductPanel initialOffer onClose={() => setAdding(false)} onSaved={load} />}
    {editing && <EditProductPanel productId={editing} onClose={() => setEditing(null)} onSuccess={load} />}
  </div>;
}
