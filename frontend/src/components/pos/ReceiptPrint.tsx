import React, { forwardRef } from "react";
import Barcode from "react-barcode";

interface ReceiptPrintProps {
  order: {
    publicNumber?: number; createdAt?: string; employeeName?: string;
    paymentMethod?: string; receivedMethod?: string; customerName?: string;
    customerPhone?: string; customerAddress?: string; subtotal?: number;
    discount?: number; totalAmount?: number; amountReceived?: number; remainingAmount?: number;
    isDelivery?: boolean;
  } | null;
  items: Array<{ nameAr: string; unitName: string; quantity: number; unitPrice: number }>;
}

const paymentNames: Record<string, string> = { Cash: "نقدي", Instapay: "إنستاباي", Wallet: "محفظة", "Deferred Payment": "آجل" };
const paymentLabel = (value?: string) => paymentNames[value || ""] || value || "—";
const money = (value = 0) => `${Number(value).toFixed(2)} ج.م`;

export const ReceiptPrint = forwardRef<HTMLDivElement, ReceiptPrintProps>(({ order, items }, ref) => {
  const date = order?.createdAt ? new Date(order.createdAt) : null;
  const dateText = date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString("ar-EG") : "—";
  const timeText = date && !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
  const field = (label: string, value?: string) => value ? <span><strong>{label}:</strong> {value}</span> : null;
  const pair = (right: React.ReactNode, left?: React.ReactNode) => <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>{right}{left}</div>;
  return <div ref={ref} dir="rtl" style={{ width: "80mm", margin: "0 auto", padding: "10px 8px", color: "#111", background: "white", fontFamily: "'Noto Sans Arabic', sans-serif", fontSize: 11, lineHeight: 1.45 }}>
    <header style={{ textAlign: "center", paddingBottom: 8 }}>
      <svg viewBox="0 0 48 48" width="50" height="50" role="img" aria-label="شعار الكتاب" style={{ display: "block", margin: "0 auto 3px" }}>
        <rect width="48" height="48" rx="7" fill="#111" />
        <path d="M5 11.5c7-1.2 13.3.5 19 4.7V39c-5.7-4.2-12-5.9-19-4.7V11.5Z" fill="white" />
        <path d="M43 11.5c-7-1.2-13.3.5-19 4.7V39c5.7-4.2 12-5.9 19-4.7V11.5Z" fill="white" />
        <path d="M29 21c3-1.6 6-2.2 9-2M29 27c3-1.6 6-2.2 9-2M29 33c3-1.6 6-2.2 9-2" fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: 17, fontWeight: 800 }}>مكتبة سعود الشافعي</div>
      <div style={{ fontSize: 14, fontWeight: 800 }}>فاتورة بيع</div>
    </header>
    {pair(<strong>رقم الفاتورة:</strong>, <strong dir="ltr">{order?.publicNumber || "—"}</strong>)}
    {pair(field("التاريخ", dateText), field("الوقت", timeText))}
    <div style={{ borderTop: "1px dashed #666", borderBottom: "1px dashed #666", marginTop: 8, padding: "7px 0", display: "grid", gap: 4 }}>
      {pair(field("العميل", order?.customerName || "عميل نقدي"), field("الهاتف", order?.customerPhone))}
      {pair(field("الموظف", order?.employeeName || "—"), field("نوع العملية", order?.isDelivery ? "بيع دليفري" : "بيع"))}
      {pair(field("الدفع", paymentLabel(order?.paymentMethod)), field("العنوان", order?.customerAddress))}
      {order?.receivedMethod && field("طريقة تحصيل المستلم", paymentLabel(order.receivedMethod))}
    </div>

    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 8 }}>
      <thead><tr style={{ borderBottom: "1px solid #111" }}>
        <th style={{ textAlign: "right", width: "35%" }}>المنتج</th><th style={{ textAlign: "center", width: "16%" }}>الوحدة</th>
        <th style={{ textAlign: "center", width: "10%" }}>العدد</th><th style={{ textAlign: "center", width: "19%" }}>السعر</th>
        <th style={{ textAlign: "left", width: "20%" }}>الإجمالي</th>
      </tr></thead>
      <tbody>{items.map((item, index) => <tr key={index} style={{ borderBottom: "1px dashed #999", verticalAlign: "top" }}>
        <td style={{ padding: "5px 0", overflowWrap: "anywhere" }}>{item.nameAr}</td>
        <td style={{ padding: "5px 0", textAlign: "center", overflowWrap: "anywhere" }}>{item.unitName}</td>
        <td style={{ padding: "5px 0", textAlign: "center" }}>{item.quantity}</td>
        <td style={{ padding: "5px 0", textAlign: "center" }}>{Number(item.unitPrice).toFixed(2)}</td>
        <td style={{ padding: "5px 0", textAlign: "left" }}>{(item.quantity * item.unitPrice).toFixed(2)}</td>
      </tr>)}</tbody>
    </table>

    <div style={{ display: "grid", gap: 3, padding: "9px 0", borderBottom: "1px dashed #666" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>الإجمالي الفرعي</span><strong>{money(order?.subtotal)}</strong></div>
      {Boolean(order?.discount) && <div style={{ display: "flex", justifyContent: "space-between" }}><span>الخصم</span><strong>-{money(order?.discount)}</strong></div>}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, borderTop: "1px solid #111", paddingTop: 5 }}><span>الإجمالي النهائي</span><span>{money(order?.totalAmount)}</span></div>
      {order?.amountReceived != null && <div style={{ display: "flex", justifyContent: "space-between" }}><span>المستلم</span><strong>{money(order.amountReceived)}</strong></div>}
      {order?.remainingAmount != null && <div style={{ display: "flex", justifyContent: "space-between" }}><span>المتبقي</span><strong>{money(order.remainingAmount)}</strong></div>}
    </div>
    <footer style={{ textAlign: "center", paddingTop: 10 }}>
      <strong style={{ fontSize: 14 }}>شكرًا لزيارتكم</strong>
      {order?.publicNumber && <div style={{ display: "flex", justifyContent: "center", marginTop: 5 }}><Barcode value={String(order.publicNumber)} format="CODE128" height={45} width={1.2} fontSize={10} margin={3} displayValue /></div>}
      <small>امسح الباركود للبحث عن الفاتورة</small>
    </footer>
  </div>;
});

ReceiptPrint.displayName = "ReceiptPrint";
