import React, { forwardRef } from "react";
import Barcode from "react-barcode";

interface ReceiptPrintProps {
  order: {
    publicNumber?: number; createdAt?: string; employeeName?: string;
    paymentMethod?: string; receivedMethod?: string; expectedCollectionMethod?: string; customerName?: string;
    customerPhone?: string; customerAddress?: string; subtotal?: number;
    discount?: number; discountPercent?: number | null; walletFee?: number; shippingCost?: number; totalAmount?: number; amountReceived?: number; remainingAmount?: number;
    isDelivery?: boolean;
  } | null;
  items: Array<{ nameAr: string; unitName: string; priceLevel?: string; quantity: number; unitPrice: number }>;
}

const paymentNames: Record<string, string> = { Cash: "نقدي", Instapay: "إنستاباي", Wallet: "محفظة", "Credit Card": "فيزا", "Deferred Payment": "آجل" };
const priceLevelNames: Record<string, string> = { Retail: "مستهلك", "Semi Wholesale": "نصف جملة", Wholesale: "جملة", "Super Wholesale": "سوبر جملة", VIP: "كبار العملاء" };
const paymentLabel = (value?: string) => paymentNames[value || ""] || value || "—";
const money = (value = 0) => `${Number(value).toFixed(2)} ج.م`;

export const ReceiptPrint = forwardRef<HTMLDivElement, ReceiptPrintProps>(({ order, items }, ref) => {
  const date = order?.createdAt ? new Date(order.createdAt) : null;
  const dateText = date && !Number.isNaN(date.valueOf()) ? date.toLocaleDateString("ar-EG") : "—";
  const timeText = date && !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
  const field = (label: string, value?: string) => value ? <span style={{ overflowWrap: "anywhere" }}><strong>{label}:</strong> {value}</span> : null;
  const pair = (right: React.ReactNode, left?: React.ReactNode) => <div style={{ display: "grid", gridTemplateColumns: left ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", gap: 8 }}>{right}{left}</div>;
  return <div ref={ref} dir="rtl" style={{ width: "80mm", margin: "0 auto", padding: "10px 8px", color: "#000", background: "white", fontFamily: "'Noto Sans Arabic', sans-serif", fontSize: 12, fontWeight: 600, lineHeight: 1.5 }}>
    <header style={{ textAlign: "center", paddingBottom: 8 }}>
      <svg viewBox="0 0 48 48" width="38" height="38" role="img" aria-label="شعار الكتاب" style={{ display: "block", margin: "0 auto 3px" }}>
        <rect width="48" height="48" rx="7" fill="#111" />
        <path d="M5 11.5c7-1.2 13.3.5 19 4.7V39c-5.7-4.2-12-5.9-19-4.7V11.5Z" fill="white" />
        <path d="M43 11.5c-7-1.2-13.3.5-19 4.7V39c5.7-4.2 12-5.9 19-4.7V11.5Z" fill="white" />
        <path d="M29 21c3-1.6 6-2.2 9-2M29 27c3-1.6 6-2.2 9-2M29 33c3-1.6 6-2.2 9-2" fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: 20, fontWeight: 800 }}>مكتبة سعود الشافعي</div>
      <div style={{ fontSize: 14, fontWeight: 800 }}>فاتورة بيع</div>
    </header>
    <div><strong>رقم الفاتورة: {order?.publicNumber || "—"}</strong></div>
    {pair(field("التاريخ", dateText), field("الوقت", timeText))}
    <div style={{ borderTop: "2px dashed #000", borderBottom: "2px dashed #000", marginTop: 8, padding: "7px 0", display: "grid", gap: 4 }}>
      {pair(field("العميل", order?.customerName || "عميل نقدي"), field("الهاتف", order?.customerPhone))}
      {pair(field("الموظف", order?.employeeName || "—"), field("نوع العملية", order?.isDelivery ? "بيع دليفري" : "بيع من المكتبة"))}
      {pair(field("الدفع", paymentLabel(order?.paymentMethod)), order?.isDelivery ? field("العنوان", order.customerAddress) : null)}
      {order?.receivedMethod && field("طريقة تحصيل المستلم", paymentLabel(order.receivedMethod))}
      {order?.expectedCollectionMethod && field("تحصيل الباقي لاحقًا", paymentLabel(order.expectedCollectionMethod))}
    </div>

    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 8, fontSize: 10 }}>
      <thead><tr style={{ borderBottom: "2px solid #000" }}>
        <th style={{ textAlign: "right", width: "30%" }}>المنتج</th><th style={{ textAlign: "center", width: "14%" }}>التسعير</th>
        <th style={{ textAlign: "center", width: "13%" }}>الوحدة</th><th style={{ textAlign: "center", width: "8%" }}>العدد</th>
        <th style={{ textAlign: "center", width: "17%" }}>السعر</th><th style={{ textAlign: "left", width: "18%" }}>الإجمالي</th>
      </tr></thead>
      <tbody>{items.map((item, index) => <tr key={index} style={{ borderBottom: "2px dashed #000", verticalAlign: "top" }}>
        <td style={{ padding: "5px 0", overflowWrap: "anywhere" }}>{item.nameAr}</td>
        <td style={{ padding: "5px 0", textAlign: "center", overflowWrap: "anywhere" }}>{item.priceLevel ? priceLevelNames[item.priceLevel] || item.priceLevel : "—"}</td>
        <td style={{ padding: "5px 0", textAlign: "center", overflowWrap: "anywhere" }}>{item.unitName}</td>
        <td style={{ padding: "5px 0", textAlign: "center" }}>{item.quantity}</td>
        <td style={{ padding: "5px 0", textAlign: "center" }}>{Number(item.unitPrice).toFixed(2)}</td>
        <td style={{ padding: "5px 0", textAlign: "left" }}>{(item.quantity * item.unitPrice).toFixed(2)}</td>
      </tr>)}</tbody>
    </table>

    <div style={{ display: "grid", gap: 3, padding: "9px 0", borderBottom: "2px dashed #000" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>الإجمالي الفرعي</span><strong>{money(order?.subtotal)}</strong></div>
      {Boolean(order?.discount) && <div style={{ display: "flex", justifyContent: "space-between" }}><span>الخصم{order?.discountPercent != null ? ` (${order.discountPercent}٪)` : ""}</span><strong>-{money(order?.discount)}</strong></div>}
      {order?.isDelivery && <div style={{ display: "flex", justifyContent: "space-between" }}><span>رسوم التوصيل</span><strong>+{money(order?.shippingCost)}</strong></div>}
      {Boolean(order?.walletFee) && <div style={{ display: "flex", justifyContent: "space-between" }}><span>ضريبة المحفظة (١٪)</span><strong>+{money(order?.walletFee)}</strong></div>}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, borderTop: "2px solid #000", paddingTop: 5 }}><span>الإجمالي النهائي</span><span>{money(order?.totalAmount)}</span></div>
      {order?.amountReceived != null && <div style={{ display: "flex", justifyContent: "space-between" }}><span>المستلم</span><strong>{money(order.amountReceived)}</strong></div>}
      {order?.remainingAmount != null && <div style={{ display: "flex", justifyContent: "space-between" }}><span>المتبقي</span><strong>{money(order.remainingAmount)}</strong></div>}
    </div>
    <footer style={{ textAlign: "center", paddingTop: 10 }}>
      <strong style={{ fontSize: 14 }}>شكرًا لزيارتكم</strong>
      {order?.publicNumber && <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}><Barcode value={String(order.publicNumber)} format="CODE128" height={45} width={1.2} margin={0} displayValue={false} /></div>}
      <small style={{ display: "block", marginTop: 5, fontWeight: 700 }}>امسح الباركود للبحث عن الفاتورة</small>
      <div style={{ borderTop: "2px dashed #000", marginTop: 8, paddingTop: 7, fontWeight: 800 }}>مكتبة سعود الشافعي</div>
      <div style={{ fontSize: 11, fontWeight: 700 }}>ش المكاتب بجوار مسجد الشافعي - الزقازيق - الشرقية</div>
      <div dir="ltr" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 5, fontWeight: 800 }}>
        <svg viewBox="0 0 32 32" width="17" height="17" role="img" aria-label="واتساب">
          <circle cx="16" cy="15" r="12" fill="#000" />
          <path d="M6 21 3 29l8-3" fill="#000" />
          <path d="M10 10c1 6 6 11 12 12m-12-12 2-2m-2 2 2 3m10 9 2-3m-2 3-3-2" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>01016012012</span>
      </div>
    </footer>
  </div>;
});

ReceiptPrint.displayName = "ReceiptPrint";
