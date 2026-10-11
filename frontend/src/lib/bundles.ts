export type OfferPriceLevel = "Retail" | "Semi Wholesale" | "Wholesale" | "Super Wholesale" | "VIP";

export interface OfferUnit {
  id: string;
  unit_name: string;
  conversion_factor: number;
  prices: Array<{ price_level: string; price: string | number }>;
}

export interface OfferProduct {
  id: string;
  name_ar: string;
  is_bundle: boolean;
  is_active: boolean;
  units: OfferUnit[];
}

export interface OfferComponentDraft {
  id: string;
  component_id: string;
  unit_id: string;
  price_level: OfferPriceLevel;
  quantity: number;
}

export function offerComponentPayload(components: OfferComponentDraft[], products: OfferProduct[]) {
  if (!components.length) throw new Error("أضف صنفًا واحدًا على الأقل للعرض.");
  return components.map(component => {
    const product = products.find(item => item.id === component.component_id && item.is_active && !item.is_bundle);
    const unit = product?.units.find(item => item.id === component.unit_id);
    const price = unit?.prices.find(item => item.price_level === component.price_level);
    if (!product || !unit || !price || !Number.isInteger(component.quantity) || component.quantity < 1) {
      throw new Error("راجع الصنف والوحدة وفئة السعر والكمية في كل مكون للعرض.");
    }
    return {
      component_id: product.id,
      unit_id: unit.id,
      price_level: component.price_level,
      quantity: component.quantity * Number(unit.conversion_factor),
    };
  });
}
