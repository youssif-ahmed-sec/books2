import { fetchApi } from "@/lib/api";
import { playUiSound } from "@/lib/uiSounds";

export type LocalPrintType = "customer" | "barcode" | "invoice" | "stock_receipt";

interface OrderDocument {
  id: string;
  created_at: string;
  status: string;
  customer_name?: string | null;
  total_amount: number;
  discount_amount: number;
  shipping_cost: number;
  tax_amount: number;
  payment_method: string;
  items: Array<{ product_name: string; quantity_requested: number; unit_price: number }>;
}

export async function sendLocalPrint(order: Record<string, unknown>, receiptType: LocalPrintType): Promise<void> {
  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:8199/api/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, receipt_type: receiptType }),
    });
  } catch {
    playUiSound("printSubmissionFailure");
    throw new Error("تعذر الاتصال بتطبيق الطباعة المحلي. تأكد أنه يعمل على هذا الجهاز.");
  }
  if (!response.ok) {
    playUiSound("printSubmissionFailure");
    if (response.status === 409) throw new Error("اختر طابعة داخل تطبيق الطباعة المحلي أولًا.");
    throw new Error(`رفض تطبيق الطباعة المهمة (${response.status}).`);
  }
}

export async function printOrderInvoice(orderId: string): Promise<void> {
  const order = await fetchApi(`/orders/${encodeURIComponent(orderId)}/quotation`) as OrderDocument;
  if (!["Delivered", "Closed", "Returned"].includes(order.status)) {
    throw new Error("الفاتورة متاحة بعد تسليم الطلب فقط.");
  }
  await sendLocalPrint({
    id: order.id,
    order_number: order.id,
    created_at: order.created_at,
    customer_name: order.customer_name,
    subtotal: order.items.reduce((sum, item) => sum + Number(item.quantity_requested) * Number(item.unit_price), 0),
    discount_amount: order.discount_amount,
    shipping_cost: order.shipping_cost,
    tax_amount: order.tax_amount,
    total_amount: order.total_amount,
    payment_method: order.payment_method,
    cart: order.items.map(item => ({
      name: item.product_name,
      qty: item.quantity_requested,
      price: item.unit_price,
    })),
  }, "invoice");
}
