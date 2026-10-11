"use client";

import type { OfferComponentDraft, OfferPriceLevel, OfferProduct } from "@/lib/bundles";
import { ProductSelect } from "@/components/ProductSelect";

const levels: Array<{ value: OfferPriceLevel; label: string }> = [
  { value: "Retail", label: "قطاعي" },
  { value: "Semi Wholesale", label: "نصف جملة" },
  { value: "Wholesale", label: "جملة" },
  { value: "Super Wholesale", label: "سوبر جملة" },
  { value: "VIP", label: "كبار العملاء" },
];

interface Props {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  components: OfferComponentDraft[];
  onComponentsChange: (components: OfferComponentDraft[]) => void;
  products: OfferProduct[];
  productId?: string;
  locked?: boolean;
}

export default function BundleEditor({ enabled, onEnabledChange, components, onComponentsChange, products, productId, locked = false }: Props) {
  const available = products.filter(product => product.is_active && !product.is_bundle && product.id !== productId);
  const update = (id: string, patch: Partial<OfferComponentDraft>) =>
    onComponentsChange(components.map(component => component.id === id ? { ...component, ...patch } : component));
  const suggested = components.reduce((sum, component) => {
    const unit = available.find(product => product.id === component.component_id)?.units.find(item => item.id === component.unit_id);
    const price = unit?.prices.find(item => item.price_level === component.price_level);
    return sum + Number(price?.price || 0) * (Number(component.quantity) || 0);
  }, 0);

  return <section className="space-y-4 border-t border-white/10 pt-6" aria-label="قسم العروض">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-bold">العروض</h3><p className="mt-1 text-xs text-[#e2bfb0]/75">اجمع أصنافًا مختلفة، وحدد وحدة وفئة سعر لكل صنف. الدستة العادية تُضاف كوحدة للمنتج نفسه.</p></div>
      {!locked && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={enabled} onChange={event => onEnabledChange(event.target.checked)} />إنشاء عرض من أصناف</label>}
    </div>
    {enabled && <>
      <div className="space-y-3">
        {components.map(component => {
          const product = available.find(item => item.id === component.component_id);
          const units = product?.units || [];
          return <div key={component.id} className="grid grid-cols-1 gap-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-2">
            <label className="text-xs">الصنف
              <ProductSelect label="الصنف" value={component.component_id} placeholder="اختر الصنف"
                onChange={value => update(component.id, { component_id: value, unit_id: "", price_level: "Retail" })}
                options={available.map(item => ({ value: item.id, label: item.name_ar }))} compact />
            </label>
            <label className="text-xs">الوحدة
              <ProductSelect label="الوحدة" value={component.unit_id} placeholder="اختر الوحدة"
                onChange={value => update(component.id, { unit_id: value, price_level: "Retail" })}
                options={units.map(unit => ({ value: unit.id, label: `${unit.unit_name} (${unit.conversion_factor} قطعة)` }))} compact />
            </label>
            <label className="text-xs">فئة السعر
              <ProductSelect label="فئة السعر" value={component.price_level} placeholder="اختر فئة السعر"
                onChange={value => update(component.id, { price_level: value as OfferPriceLevel })}
                options={levels} compact />
            </label>
            <label className="text-xs">عدد الوحدات المختارة
              <input type="number" min="1" step="1" value={component.quantity} onChange={event => update(component.id, { quantity: Number(event.target.value) })} className="app-field mt-1" />
            </label>
            <button type="button" onClick={() => onComponentsChange(components.filter(item => item.id !== component.id))} className="justify-self-start text-xs text-red-400">حذف المكون</button>
          </div>;
        })}
      </div>
      <button type="button" onClick={() => onComponentsChange([...components, { id: crypto.randomUUID(), component_id: "", unit_id: "", price_level: "Retail", quantity: 1 }])} className="app-secondary-button">إضافة صنف للعرض</button>
      <p className="text-sm text-[#e2bfb0]">مجموع أسعار المكونات المختارة: {suggested.toFixed(2)} ج.م. سعر بيع العرض النهائي تضبطه في هيكل التسعير.</p>
    </>}
  </section>;
}
