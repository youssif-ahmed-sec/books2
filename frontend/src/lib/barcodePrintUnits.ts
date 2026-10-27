import type { BarcodePrintUnit } from "@/components/BarcodePrintDialog";

type Price = { price_level: string; price: string | number };
type Unit = { id: string; unit_name: string; barcode?: string | null; prices?: Price[] };

export function barcodePrintUnits(units: Unit[]): BarcodePrintUnit[] {
  return units.filter(unit => unit.barcode).map(unit => {
    const prices = (unit.prices || []).map(price => ({
      level: price.price_level, price: String(price.price),
    }));
    const retail = prices.find(price => price.level === "Retail" && Number(price.price) > 0);
    const chosen = retail || prices.find(price => Number(price.price) > 0) || prices[0];
    return { id: unit.id, name: unit.unit_name, barcode: unit.barcode!,
      price: chosen?.price || "0", priceLevel: chosen?.level || "", prices, copies: 1 };
  });
}
