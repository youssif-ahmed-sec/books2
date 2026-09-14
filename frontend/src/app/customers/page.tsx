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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);

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
    loadCustomers();
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

  const openEdit = (customer: any) => {
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
      <TopNav title="العملاء (CRM)" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">العملاء (CRM)</h1>
              <p className="text-sm text-zinc-400 mt-1">إدارة بيانات العملاء وتاريخ المشتريات</p>
            </div>
            <button
              onClick={openAdd}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + إضافة عميل
            </button>
          </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-zinc-800/50 border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">اسم العميل</th>
                <th className="px-4 py-3 font-medium">الهاتف</th>
                <th className="px-4 py-3 font-medium">النوع</th>
                <th className="px-4 py-3 font-medium">المدينة</th>
                <th className="px-4 py-3 font-medium">إجمالي المشتريات</th>
                <th className="px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="bg-zinc-800 text-zinc-300 px-2 py-1 rounded text-xs">
                      {c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.city || "-"}</td>
                  <td className="px-4 py-3">{c.total_purchases} ر.س</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-emerald-500 hover:text-emerald-400 text-xs font-medium"
                    >
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
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
          <div className="relative w-full max-w-md bg-zinc-900 h-full shadow-2xl border-r border-zinc-800 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">{editingCustomer ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</h2>
              <button onClick={() => setIsSlideoverOpen(false)} className="text-zinc-400 hover:text-white transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">الاسم <span className="text-red-500">*</span></label>
                <input {...register("name")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">رقم الهاتف <span className="text-red-500">*</span></label>
                <input {...register("phone")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">رقم الواتساب</label>
                <input {...register("whatsapp_number")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">نوع العميل</label>
                <select {...register("customer_type")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500">
                  <option value="Retail Customer">عميل تجزئة</option>
                  <option value="Wholesale Customer">عميل جملة</option>
                  <option value="VIP Customer">عميل VIP</option>
                </select>
                {errors.customer_type && <p className="text-red-500 text-xs mt-1">{errors.customer_type.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">المدينة</label>
                <input {...register("city")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">البريد الإلكتروني</label>
                <input {...register("email")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">ملاحظات</label>
                <textarea {...register("notes")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" rows={3}></textarea>
              </div>

              <div className="pt-4 border-t border-zinc-800 mt-6">
                <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors">
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
