"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { fetchApi } from "@/lib/api";

interface QuotationItem {
  id: string;
  product_name: string;
  quantity_requested: number;
  unit_price: number;
  total_price: number;
}

interface Quotation {
  id: string;
  created_at: string;
  customer_name?: string | null;
  items: QuotationItem[];
  total_amount: number;
}

function QuotationContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("id");
  const [order, setOrder] = useState<Quotation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadQuotation() {
      try {
        const data = await fetchApi(`/orders/${orderId}/quotation`);
        setOrder(data);
        setTimeout(() => {
          window.print();
        }, 500);
      } catch (err) {
        console.error(err);
        setError("فشل تحميل عرض السعر");
      }
    }
    if (orderId) {
      loadQuotation();
    }
  }, [orderId]);

  if (error) return <div className="p-10 text-center text-red-500">{error}</div>;
  if (!order) return <div className="p-10 text-center">جاري تجهيز عرض السعر...</div>;

  return (
    <div className="bg-white text-black min-h-screen p-8" dir="rtl">
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-gray-300 pb-6 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">عرض سعر</h1>
          <p className="text-gray-500 mt-2">رقم المرجع: {order.id}</p>
          <p className="text-gray-500">التاريخ: {new Date(order.created_at).toLocaleDateString("ar-EG")}</p>
        </div>
        <div className="text-left">
          <h2 className="text-xl font-bold">مكتبة سعود الشافعي</h2>
        </div>
      </div>

      {/* Customer Info */}
      <div className="mb-8 bg-gray-50 p-4 rounded-lg">
        <h3 className="font-bold text-lg mb-2">بيانات العميل:</h3>
        <p><span className="font-medium">الاسم:</span> {order.customer_name || "عميل عام"}</p>
      </div>

      {/* Items Table */}
      <table className="w-full text-right mb-8">
        <thead className="bg-gray-100 border-b border-gray-300">
          <tr>
            <th className="py-2 px-4 font-bold">المنتج</th>
            <th className="py-2 px-4 font-bold">الكمية</th>
            <th className="py-2 px-4 font-bold">السعر الإفرادي</th>
            <th className="py-2 px-4 font-bold">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {order.items?.map((item) => (
            <tr key={item.id} className="border-b border-gray-200">
              <td className="py-3 px-4">{item.product_name}</td>
              <td className="py-3 px-4">{item.quantity_requested}</td>
              <td className="py-3 px-4">{item.unit_price} ج.م</td>
              <td className="py-3 px-4 font-medium">{item.total_price} ج.م</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-64 space-y-2">
          <div className="flex justify-between border-b border-gray-200 pb-2">
            <span className="text-gray-600">المجموع الفرعي:</span>
            <span className="font-medium">{order.total_amount} ج.م</span>
          </div>
          <div className="flex justify-between pt-2">
            <span className="font-bold text-lg">الإجمالي الكلي:</span>
            <span className="font-bold text-lg text-[#e76000]">{order.total_amount} ج.م</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-16 text-center text-sm text-gray-500 border-t border-gray-200 pt-4">
        <p>شكراً لتعاملكم معنا!</p>
      </div>
    </div>
  );
}

export default function QuotationPrintPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">جاري التحميل...</div>}>
      <QuotationContent />
    </Suspense>
  );
}
