export type PriceMargins = {
  profitMargin: string;
  semiWholesaleMargin: string;
  wholesaleMargin: string;
  superWholesaleMargin: string;
  vipMargin: string;
};

export type TierPrices = {
  retailPrice: string;
  semiWholesalePrice: string;
  wholesalePrice: string;
  superWholesalePrice: string;
  vipPrice: string;
};

const numeric = (value: string): number => Number.parseFloat(value) || 0;

export function pricesFromMargins(
  cost: string,
  taxRate: string,
  conversionFactor: number,
  margins: PriceMargins,
): TierPrices {
  const unitCost = numeric(cost) * conversionFactor * (1 + numeric(taxRate) / 100);
  return {
    retailPrice: (unitCost * (1 + numeric(margins.profitMargin) / 100)).toFixed(2),
    semiWholesalePrice: (unitCost * (1 + numeric(margins.semiWholesaleMargin) / 100)).toFixed(2),
    wholesalePrice: (unitCost * (1 + numeric(margins.wholesaleMargin) / 100)).toFixed(2),
    superWholesalePrice: (unitCost * (1 + numeric(margins.superWholesaleMargin) / 100)).toFixed(2),
    vipPrice: (unitCost * (1 + numeric(margins.vipMargin) / 100)).toFixed(2),
  };
}

export function marginFromPrice(price: number, cost: number, taxRate: number, conversionFactor: number): string {
  const unitCost = cost * conversionFactor * (1 + taxRate / 100);
  return unitCost > 0 ? (((price - unitCost) / unitCost) * 100).toFixed(2) : "0";
}
