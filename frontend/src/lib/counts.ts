import { errorMessage } from "@/lib/errors";

export type CountStatus = "PENDING" | "APPROVED" | "REJECTED";

export type CountRecord = {
  id: string;
  session_id: string | null;
  product_id: string;
  product_name: string;
  sku: string;
  warehouse_id: string;
  counter: string;
  reviewer: string | null;
  expected_quantity: number;
  observed_quantity: number;
  difference: number;
  unit_cost: number | null;
  difference_value: number | null;
  reason: string | null;
  status: CountStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export type CountHistory = { total: number; items: CountRecord[] };

export const quantityText = (value: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value);
export const moneyText = (value: number) => `${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value)} ج.م`;
export const signedQuantity = (value: number) => `${value > 0 ? "+" : ""}${quantityText(value)}`;

export const countStatusLabel: Record<CountStatus, string> = {
  PENDING: "بانتظار موافقة المدير",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
};
export function countErrorMessage(error: unknown, fallback: string): string {
  const message = errorMessage(error, fallback);
  if (message.includes("Stock changed")) return "اتغيّر رصيد المنتج أثناء الجرد أو قبل موافقة المدير. أعد عدّ الصنف وسجّل جردًا جديدًا.";
  if (message.includes("Reason is required")) return "اكتب سببًا لكل صنف فيه فرق جرد.";
  if (message.includes("inactive warehouse")) return "للمنتج رصيد في مخزن غير نشط؛ صحح المخزن قبل الجرد.";
  if (message.includes("not pending approval")) return "تم اتخاذ قرار لهذا الجرد بالفعل. حدّث القائمة.";
  return message;
}
