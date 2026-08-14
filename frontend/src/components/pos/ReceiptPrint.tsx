import React, { forwardRef } from 'react';

interface ReceiptPrintProps {
  order: any;
  items: any[];
}

export const ReceiptPrint = forwardRef<HTMLDivElement, ReceiptPrintProps>(({ order, items }, ref) => {
  return (
    <div style={{ display: 'none' }}>
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
        <div style={{ textAlign: 'center', marginBottom: '15px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 5px 0' }}>مكتبة سعود الشافعي</h2>
          <p style={{ margin: '0' }}>رقم الطلب: {order?.id?.split('-')[0]}</p>
          <p style={{ margin: '0' }}>التاريخ: {new Date().toLocaleDateString('ar-EG')} {new Date().toLocaleTimeString('ar-EG')}</p>
          {order?.customerName && (
            <p style={{ margin: '0' }}>العميل: {order.customerName}</p>
          )}
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
        
        {order?.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span>الخصم:</span>
            <span>-{order?.discount?.toFixed(2)} ج.م</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', borderTop: '1px solid #000', paddingTop: '5px', marginTop: '5px' }}>
          <span>الصافي:</span>
          <span>{order?.totalAmount?.toFixed(2)} ج.م</span>
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px' }}>
          <p style={{ margin: '0' }}>شكراً لزيارتكم</p>
        </div>
      </div>
    </div>
  );
});

ReceiptPrint.displayName = 'ReceiptPrint';
