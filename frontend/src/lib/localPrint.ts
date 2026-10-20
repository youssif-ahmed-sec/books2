import { fetchApi } from "@/lib/api";
import { playUiSound } from "@/lib/uiSounds";

export type LocalPrintType = "customer" | "barcode" | "invoice" | "stock_receipt" | "sales_return" | "purchase_document";

interface OrderDocument {
  id: string;
  public_number: number;
  created_at: string;
  status: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  employee_name?: string | null;
  amount_received?: number;
  received_method?: string | null;
  source?: string | null;
  total_amount: number;
  discount_amount: number;
  discount_percent?: number | null;
  wallet_fee_amount?: number;
  shipping_cost: number;
  tax_amount: number;
  payment_method: string;
  items: Array<{ product_name: string; unit_name?: string; price_level: string; quantity_requested: number; unit_price: number }>;
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
    const printerLabel = receiptType === "barcode" ? "طابعة الباركود" : "طابعة الفواتير";
    if (response.status === 409) {
      const detail = await response.json().then(body => String(body.detail || "")).catch(() => "");
      if (detail === "Configured printer is unavailable") throw new Error(`${printerLabel} المحفوظة غير متاحة. تأكد من توصيلها وتشغيلها.`);
      throw new Error(`اختر ${printerLabel} داخل تطبيق الطباعة المحلي أولًا.`);
    }
    if (response.status === 422) throw new Error("بيانات الباركود غير صالحة للطباعة. راجع الكود وعدد الملصقات.");
    if (response.status === 403) throw new Error("تطبيق الطباعة لا يسمح بالاتصال من عنوان هذه الصفحة. راجع إعدادات الربط.");
    throw new Error("تعذر إرسال المهمة لتطبيق الطباعة. حاول مرة أخرى.");
  }
}

export async function printOrderInvoice(orderId: string): Promise<void> {
  const order = await fetchApi(`/orders/${encodeURIComponent(orderId)}/quotation`) as OrderDocument;
  if (!["Delivered", "Closed", "Returned"].includes(order.status)) {
    throw new Error("الفاتورة متاحة بعد تسليم الطلب فقط.");
  }
  await sendLocalPrint({
    id: order.id,
    order_number: order.public_number,
    created_at: order.created_at,
    customer_name: order.customer_name || "عميل نقدي",
    customer_phone: order.customer_phone,
    customer_address: order.customer_address,
    employee_name: order.employee_name,
    operation_type: "sale",
    source: order.source,
    subtotal: order.items.reduce((sum, item) => sum + Number(item.quantity_requested) * Number(item.unit_price), 0),
    discount_amount: order.discount_amount,
    discount_percent: order.discount_percent,
    wallet_fee_amount: order.wallet_fee_amount,
    shipping_cost: order.shipping_cost,
    tax_amount: order.tax_amount,
    total_amount: order.total_amount,
    payment_method: order.payment_method,
    amount_received: order.amount_received,
    received_method: order.received_method,
    remaining_amount: Math.max(0, Number(order.total_amount) - Number(order.amount_received || 0)),
    cart: order.items.map(item => ({
      name: item.product_name,
      unit: item.unit_name,
      price_level: item.price_level,
      qty: item.quantity_requested,
      price: item.unit_price,
    })),
  }, "invoice");
}

export async function printSalesReturnReceipt(returnId: string): Promise<void> {
  const receipt = await fetchApi(`/returns/${encodeURIComponent(returnId)}/receipt`) as Record<string, unknown>;
  await sendLocalPrint({ ...receipt,
    operation_type: receipt.kind === "EXCHANGE" ? "exchange" : "return",
    order_id: receipt.order_public_number ?? receipt.order_id,
    exchange_order_id: receipt.exchange_order_public_number ?? receipt.exchange_order_id,
  }, "sales_return");
}

export async function printPurchaseDocument(documentId: string): Promise<void> {
  const document = await fetchApi(`/purchase-documents/${encodeURIComponent(documentId)}/print`) as Record<string, unknown>;
  const statuses: Record<string, string> = { REQUESTED: "بانتظار الموافقة", APPROVED: "تمت الموافقة", ORDERED: "تم الطلب",
    PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "مكتمل", REJECTED: "مرفوض", CANCELLED: "ملغي" };
  await sendLocalPrint({ ...document, operation_type: "purchase", status: statuses[String(document.status)] || document.status }, "purchase_document");
}

export async function printPurchaseReceipt(documentId: string, receiptId: string): Promise<void> {
  const receipt = await fetchApi(`/purchase-documents/${encodeURIComponent(documentId)}/receipts/${encodeURIComponent(receiptId)}/print`) as Record<string, unknown>;
  await sendLocalPrint({ ...receipt, operation_type: "stock_receipt" }, "stock_receipt");
}
