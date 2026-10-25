/**
 * Centralized formatting utilities for currency and numbers across Saud Al-Shafei Bookstore ERP.
 */

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "0.00 ج.م";
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (isNaN(numeric)) return "0.00 ج.م";
  return `${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  const numeric = typeof value === "number" ? value : Number(value);
  if (isNaN(numeric)) return "0";
  return numeric.toLocaleString("en-US");
}
