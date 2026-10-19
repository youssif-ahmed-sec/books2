import React, { forwardRef } from 'react';
import Image from 'next/image';
import Barcode from 'react-barcode';

interface ReceiptPrintProps {
  order: {
    id?: string;
    publicNumber?: number;
    createdAt?: string;
    employeeName?: string;
    paymentMethod?: string;
    customerName?: string;
    subtotal?: number;
    discount?: number;
    totalAmount?: number;
    amountReceived?: number;
    remainingAmount?: number;
  } | null;
  items: Array<{
    nameAr: string;
    unitName: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export const ReceiptPrint = forwardRef<HTMLDivElement, ReceiptPrintProps>(({ order, items }, ref) => {
  return (
    <div>
      <div 
        ref={ref} 
        style={{ 
          width: '80mm', 
          padding: '10px', 
          margin: '0 auto', 
          fontFamily: "'Noto Sans Arabic', sans-serif",
          color: '#000',
          backgroundColor: '#fff',
          direction: 'rtl',
          fontSize: '12px',
          lineHeight: '1.4'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '12px' }}>
          <Image src="/icon.svg" alt="شعار الكتاب" width={58} height={58} unoptimized style={{ margin: '0 auto 5px' }} />
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 3px 0' }}>مكتبة سعود الشافعي</h2>
          <strong>فاتورة بيع</strong>
        </div>
        <div style={{ borderBlock: '1px dashed #555', paddingBlock: 8, marginBottom: 10 }}>
          <div>رقم المستند: {order?.publicNumber}</div>
          <div>التاريخ: {order?.createdAt ? new Date(order.createdAt).toLocaleString('ar-EG') : '—'}</div>
          <div>الموظف: {order?.employeeName || 'غير مسجل'}</div>
          <div>العميل: {order?.customerName || 'عميل نقدي'}</div>
          <div>طريقة الدفع: {order?.paymentMethod || '—'}</div>
        </div>

        <table style={{ width: '100%', borderBottom: '1px dashed #000', marginBottom: '10px', paddingBottom: '10px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #000' }}>
              <th style={{ textAlign: 'right', padding: '2px 0' }}>الصنف</th>
              <th style={{ textAlign: 'center', padding: '2px 0' }}>الكمية</th>
              <th style={{ textAlign: 'left', padding: '2px 0' }}>السعر</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td style={{ padding: '2px 0' }}>
                  {item.nameAr}
                  <div style={{ fontSize: '10px', color: '#555' }}>{item.unitName}</div>
                </td>
                <td style={{ textAlign: 'center', padding: '2px 0' }}>{item.quantity}</td>
                <td style={{ textAlign: 'left', padding: '2px 0' }}>{(item.unitPrice * item.quantity).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
          <span>الإجمالي:</span>
          <span>{order?.subtotal?.toFixed(2)} ج.م</span>
        </div>
        
        {order?.discount != null && order.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span>الخصم:</span>
            <span>-{order?.discount?.toFixed(2)} ج.م</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', borderTop: '1px solid #000', paddingTop: '5px', marginTop: '5px' }}>
          <span>الصافي:</span>
          <span>{order?.totalAmount?.toFixed(2)} ج.م</span>
        </div>
        {order?.amountReceived != null && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}><span>المستلم:</span><span>{order.amountReceived.toFixed(2)} ج.م</span></div>}
        {order?.remainingAmount != null && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontWeight: 'bold' }}><span>المتبقي:</span><span>{order.remainingAmount.toFixed(2)} ج.م</span></div>}

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px' }}>
          <p style={{ margin: '0' }}>شكراً لزيارتكم</p>
          {order?.publicNumber && <Barcode value={String(order.publicNumber)} format="CODE128" height={44} width={1.2} fontSize={11} margin={5} displayValue />}
        </div>
      </div>
    </div>
  );
});

ReceiptPrint.displayName = 'ReceiptPrint';
