"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";

const customerSchema = z.object({
  name: z.string().min(2, "الاسم مطلوب (أكثر من حرفين)"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  whatsapp_number: z.string().optional(),
  city: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  address: z.string().optional(),
  customer_type: z.string().min(1, "نوع العميل مطلوب"),
  notes: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;
type Customer = CustomerFormValues & { id: string; total_purchases: number };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customer_type: "Retail Customer"
    }
  });

  const loadCustomers = async () => {
    try {
      const data = await fetchApi("/customers");
      setCustomers(data);
    } catch (err) {
      console.error("Failed to load customers:", err);
    }
  };

  useEffect(() => {
    fetchApi("/customers").then(setCustomers).catch((err) => {
      console.error("Failed to load customers:", err);
    });
  }, []);

  const openAdd = () => {
    setEditingCustomer(null);
    reset({
      name: "",
      phone: "",
      whatsapp_number: "",
      city: "",
      email: "",
      address: "",
      customer_type: "Retail Customer",
      notes: ""
    });
    setIsSlideoverOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    reset({
      name: customer.name,
      phone: customer.phone,
      whatsapp_number: customer.whatsapp_number || "",
      city: customer.city || "",
      email: customer.email || "",
      address: customer.address || "",
      customer_type: customer.customer_type || "Retail Customer",
      notes: customer.notes || ""
    });
    setIsSlideoverOpen(true);
  };

  const onSubmit = async (data: CustomerFormValues) => {
    try {
      if (editingCustomer) {
        await fetchApi(`/customers/${editingCustomer.id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
      } else {
        await fetchApi("/customers", {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
      await loadCustomers();
      setIsSlideoverOpen(false);
    } catch (err) {
      console.error("Failed to save customer:", err);
      alert("حدث خطأ أثناء الحفظ");
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="العملاء" />
      <main className="app-main">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="app-heading">العملاء</h1>
              <p className="app-subtitle">بيانات العملاء وتاريخ مشترياتهم</p>
            </div>
            <button
              onClick={openAdd}
              className="app-primary-button"
            >
              + إضافة عميل
            </button>
          </div>

      <div className="app-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">اسم العميل</th>
                <th className="px-4 py-3 font-medium">الهاتف</th>
                <th className="px-4 py-3 font-medium">النوع</th>
                <th className="px-4 py-3 font-medium">المدينة</th>
                <th className="px-4 py-3 font-medium">إجمالي المشتريات</th>
                <th className="px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-[#e5e2e1]">
              {customers.map((c) => (
                <tr key={c.id} className="app-table-row">
                  <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#e2bfb0]">
                      {c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.city || "-"}</td>
                  <td className="px-4 py-3">{Number(c.total_purchases).toLocaleString("ar-EG")} ج.م</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-primary hover:text-orange-300 text-xs font-bold"
                    >
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="app-muted px-4 py-8 text-center">
                    لا يوجد عملاء مضافين بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isSlideoverOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSlideoverOpen(false)}></div>
          <div className="relative w-full max-w-md bg-[#1c1b1b] h-full shadow-2xl border-r border-white/10 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">{editingCustomer ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</h2>
              <button type="button" aria-label="إغلاق" onClick={() => setIsSlideoverOpen(false)} className="app-muted hover:text-white transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">الاسم <span className="text-red-500">*</span></label>
                <input {...register("name")} className="app-field" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">رقم الهاتف <span className="text-red-500">*</span></label>
                <input {...register("phone")} className="app-field" />
                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">رقم الواتساب</label>
                <input {...register("whatsapp_number")} className="app-field" />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">نوع العميل</label>
                <select {...register("customer_type")} className="app-field">
                  <option value="Retail Customer">عميل تجزئة</option>
                  <option value="Wholesale Customer">عميل جملة</option>
                  <option value="VIP Customer">عميل VIP</option>
                </select>
                {errors.customer_type && <p className="text-red-500 text-xs mt-1">{errors.customer_type.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">المدينة</label>
                <input {...register("city")} className="app-field" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">البريد الإلكتروني</label>
                <input {...register("email")} className="app-field" />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">ملاحظات</label>
                <textarea {...register("notes")} className="app-field" rows={3}></textarea>
              </div>

              <div className="pt-4 border-t border-white/10 mt-6">
                <button type="submit" disabled={isSubmitting} className="app-primary-button w-full">
                  {isSubmitting ? "جاري الحفظ..." : "حفظ العميل"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
