"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import BrandsManagement from "@/components/BrandsManagement";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────
const supplierSchema = z.object({
  name: z.string().min(2, "اسم المورد مطلوب"),
  phone: z.string().optional(),
  email: z.string().email("بريد إلكتروني غير صحيح").optional().or(z.literal("")),
  address: z.string().optional(),
  tax_number: z.string().optional(),
  contact_info: z.string().optional(),
  opening_balance: z.string().refine(v => !isNaN(parseFloat(v || "0")), "رقم غير صحيح").optional(),
  credit_limit: z.string().optional(),
  payment_terms_days: z.string().optional(),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  amount: z.string().refine(v => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "أدخل مبلغاً صحيحاً"),
  payment_method: z.enum(["Cash", "Bank Transfer", "Check", "Other"]),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;
type PaymentFormValues = z.infer<typeof paymentSchema>;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  tax_number?: string;
  contact_info?: string;
  opening_balance?: string;
  credit_limit?: string;
  payment_terms_days?: string;
  notes?: string;
}

interface SupplierDetail extends Supplier {
  total_purchases: number;
  total_payments: number;
  balance: number;
  payments: Payment[];
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  reference_number?: string;
  notes?: string;
  payment_date: string;
}

// ─── Add Supplier Panel ───────────────────────────────────────────────────────
function AddSupplierPanel({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { opening_balance: "0", payment_method: "COD" } as any,
  });

  const onSubmit = async (data: SupplierFormValues) => {
    try {
      await fetchApi("/suppliers", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          opening_balance: parseFloat(data.opening_balance || "0"),
          credit_limit: data.credit_limit ? parseFloat(data.credit_limit) : null,
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || "فشل إنشاء المورد");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start" dir="rtl">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[520px] h-full overflow-y-auto flex flex-col shadow-2xl" style={{ marginRight: "320px", background: "#1a1918", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between p-8 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">إضافة مورد جديد</h2>
            <p className="text-sm text-[#e2bfb0]/60 mt-1">تسجيل بيانات مورد في النظام</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-8 flex flex-col gap-6 flex-1">
          {/* Basic Info */}
          <div>
            <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">البيانات الأساسية</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">اسم المورد *</label>
                <input {...register("name")} placeholder="اسم الشركة أو المورد" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">رقم الهاتف</label>
                  <input {...register("phone")} placeholder="01xxxxxxxxx" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">البريد الإلكتروني</label>
                  <input {...register("email")} type="email" placeholder="info@supplier.com" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.email ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                </div>
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">العنوان</label>
                <input {...register("address")} placeholder="عنوان المورد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
              </div>
            </div>
          </div>

          {/* Financial */}
          <div>
            <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">البيانات المالية</p>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الرقم الضريبي</label>
                  <input {...register("tax_number")} placeholder="الرقم الضريبي" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">شروط الدفع</label>
                  <select {...register("payment_terms_days")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-[#1c1b1b] border border-white/10 focus:outline-none focus:border-primary/50">
                    <option value="COD">نقداً عند الاستلام</option>
                    <option value="7">7 أيام</option>
                    <option value="15">15 يوم</option>
                    <option value="30">30 يوم</option>
                    <option value="60">60 يوم</option>
                    <option value="90">90 يوم</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الرصيد الافتتاحي (ج.م)</label>
                  <input {...register("opening_balance")} type="number" step="0.01" defaultValue="0" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.opening_balance ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">حد الائتمان (ج.م)</label>
                  <input {...register("credit_limit")} type="number" step="0.01" placeholder="بدون حد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">ملاحظات</p>
            <textarea {...register("notes")} placeholder="ملاحظات إضافية..." rows={3} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 resize-none" />
          </div>

          <div className="mt-auto">
            <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-bold py-4 rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">save</span>}
              <span>{isSubmitting ? "جاري الحفظ..." : "حفظ المورد"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit / Detail Panel ──────────────────────────────────────────────────────
function EditSupplierPanel({ supplierId, onClose, onSuccess }: { supplierId: string; onClose: () => void; onSuccess: () => void }) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"info" | "statement" | "payment">("info");
  const [mounted, setMounted] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
  });

  const { register: regPay, handleSubmit: handlePaySubmit, reset: resetPay, formState: { errors: payErrors, isSubmitting: paySubmitting } } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { payment_method: "Cash" },
  });

  useEffect(() => {
    setMounted(true);
    fetchApi(`/suppliers/${supplierId}`).then(data => {
      setDetail(data);
      reset({
        name: data.name,
        phone: data.phone || "",
        email: data.email || "",
        address: data.address || "",
        tax_number: data.tax_number || "",
        contact_info: data.contact_info || "",
        opening_balance: data.opening_balance?.toString() || "0",
        credit_limit: data.credit_limit?.toString() || "",
        payment_terms_days: data.payment_terms_days || "COD",
        notes: data.notes || "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [supplierId, reset]);

  const onSubmit = async (data: SupplierFormValues) => {
    try {
      await fetchApi(`/suppliers/${supplierId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...data,
          opening_balance: parseFloat(data.opening_balance || "0"),
          credit_limit: data.credit_limit ? parseFloat(data.credit_limit) : null,
        }),
      });
      onSuccess();
      onClose();
    } catch (err: any) { alert(err.message); }
  };

  const onPaySubmit = async (data: PaymentFormValues) => {
    try {
      await fetchApi(`/suppliers/${supplierId}/payments`, {
        method: "POST",
        body: JSON.stringify({ ...data, amount: parseFloat(data.amount) }),
      });
      const updated = await fetchApi(`/suppliers/${supplierId}`);
      setDetail(updated);
      resetPay({ payment_method: "Cash" } as any);
      setActiveTab("statement");
    } catch (err: any) { alert(err.message); }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-start" dir="rtl">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[600px] h-full overflow-y-auto flex flex-col shadow-2xl" style={{ marginRight: "320px", background: "#1a1918", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between p-8 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">{loading ? "..." : detail?.name}</h2>
            <p className="text-sm text-[#e2bfb0]/60 mt-1">تفاصيل وكشف حساب المورد</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Balance Cards */}
        {detail && (
          <div className="grid grid-cols-4 gap-4 p-6 border-b border-white/10">
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-[10px] text-[#e2bfb0]/60 mb-1">الرصيد الافتتاحي</p>
              <p className="text-lg font-bold text-white">{Number(detail.opening_balance || 0).toLocaleString()}</p>
              <p className="text-[10px] text-[#e2bfb0]/40">ج.م</p>
            </div>
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-[10px] text-[#e2bfb0]/60 mb-1">إجمالي المشتريات</p>
              <p className="text-lg font-bold text-white">{Number(detail.total_purchases).toLocaleString()}</p>
              <p className="text-[10px] text-[#e2bfb0]/40">ج.م</p>
            </div>
            <div className="glass rounded-2xl p-4 text-center">
              <p className="text-[10px] text-[#e2bfb0]/60 mb-1">إجمالي المدفوعات</p>
              <p className="text-lg font-bold text-green-400">{Number(detail.total_payments).toLocaleString()}</p>
              <p className="text-[10px] text-[#e2bfb0]/40">ج.م</p>
            </div>
            <div className={`glass rounded-2xl p-4 text-center ${detail.credit_limit && Number(detail.balance) > Number(detail.credit_limit) ? 'border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : ''}`}>
              <p className="text-[10px] text-[#e2bfb0]/60 mb-1">الرصيد المستحق</p>
              <p className={`text-lg font-bold ${Number(detail.balance) > 0 ? "text-[#ffb4ab]" : "text-green-400"}`}>{Number(detail.balance).toLocaleString()}</p>
              <p className="text-[10px] text-[#e2bfb0]/40">ج.م</p>
              {detail.credit_limit ? (
                <p className={`text-[9px] mt-1 border-t border-white/5 pt-1 ${Number(detail.balance) > Number(detail.credit_limit) ? 'text-red-400 font-bold' : 'text-[#e2bfb0]/40'}`}>
                  حد الائتمان: {Number(detail.credit_limit).toLocaleString()}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6">
          {[{ key: "info", label: "البيانات", icon: "person" }, { key: "statement", label: "كشف الحساب", icon: "receipt_long" }, { key: "payment", label: "تسجيل دفعة", icon: "payments" }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-2 px-4 py-4 text-xs font-bold transition-all border-b-2 ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-[#e2bfb0]/60 hover:text-white"}`}>
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6 flex-1">
          {/* Info Tab */}
          {activeTab === "info" && (
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">اسم المورد *</label>
                <input {...register("name")} className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الهاتف</label>
                  <input {...register("phone")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">البريد الإلكتروني</label>
                  <input {...register("email")} type="email" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.email ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">العنوان</label>
                <input {...register("address")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الرقم الضريبي</label>
                  <input {...register("tax_number")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">شروط الدفع</label>
                  <select {...register("payment_terms_days")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-[#1c1b1b] border border-white/10 focus:outline-none focus:border-primary/50">
                    <option value="COD">نقداً عند الاستلام</option>
                    <option value="7">7 أيام</option>
                    <option value="15">15 يوم</option>
                    <option value="30">30 يوم</option>
                    <option value="60">60 يوم</option>
                    <option value="90">90 يوم</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الرصيد الافتتاحي (ج.م)</label>
                  <input {...register("opening_balance")} type="number" step="0.01" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">حد الائتمان (ج.م)</label>
                  <input {...register("credit_limit")} type="number" step="0.01" placeholder="بدون حد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">ملاحظات</label>
                <textarea {...register("notes")} rows={3} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 resize-none" />
              </div>
              <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-bold py-4 rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">save</span>}
                <span>{isSubmitting ? "جاري الحفظ..." : "حفظ التعديلات"}</span>
              </button>
            </form>
          )}

          {/* Statement Tab */}
          {activeTab === "statement" && (
            <div>
              {detail?.payments.length === 0 ? (
                <div className="text-center py-16 text-[#e2bfb0]/40">
                  <span className="material-symbols-outlined text-6xl block mb-4">receipt_long</span>
                  <p>لا توجد مدفوعات مسجلة بعد</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {detail?.payments.map(p => (
                    <div key={p.id} className="glass rounded-2xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                          <span className="material-symbols-outlined text-green-400 text-[18px]">payments</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{p.payment_method}</p>
                          <p className="text-[10px] text-[#e2bfb0]/60">{new Date(p.payment_date).toLocaleDateString("ar-EG")}{p.reference_number ? ` · ${p.reference_number}` : ""}</p>
                          {p.notes && <p className="text-[10px] text-[#e2bfb0]/40">{p.notes}</p>}
                        </div>
                      </div>
                      <p className="font-bold text-green-400">+{Number(p.amount).toLocaleString()} ج.م</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Payment Tab */}
          {activeTab === "payment" && (
            <form onSubmit={handlePaySubmit(onPaySubmit)} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">المبلغ (ج.م) *</label>
                <input {...regPay("amount")} type="number" step="0.01" placeholder="0.00" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${payErrors.amount ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {payErrors.amount && <p className="text-red-400 text-xs mt-1">{payErrors.amount.message}</p>}
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">طريقة الدفع</label>
                <select {...regPay("payment_method")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-[#1c1b1b] border border-white/10 focus:outline-none focus:border-primary/50">
                  <option value="Cash">نقداً</option>
                  <option value="Bank Transfer">تحويل بنكي</option>
                  <option value="Check">شيك</option>
                  <option value="Other">أخرى</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">رقم المرجع / الشيك</label>
                <input {...regPay("reference_number")} placeholder="اختياري" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">ملاحظات</label>
                <textarea {...regPay("notes")} rows={3} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 resize-none" />
              </div>
              <button type="submit" disabled={paySubmitting} className="w-full bg-green-600 text-white font-bold py-4 rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {paySubmitting ? <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">payments</span>}
                <span>{paySubmitting ? "جاري التسجيل..." : "تسجيل الدفعة"}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const loadSuppliers = async (q = "") => {
    setLoading(true);
    try {
      const res = await fetchApi(`/suppliers?search=${encodeURIComponent(q)}&limit=50`);
      setSuppliers(res.data || []);
      setTotal(res.total || 0);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { loadSuppliers(); }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    loadSuppliers(e.target.value);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا المورد؟")) return;
    try {
      await fetchApi(`/suppliers/${id}`, { method: "DELETE" });
      loadSuppliers(search);
    } catch (err: any) { alert(err.message); }
  };

  const statCards = [
    { icon: "local_shipping", label: "إجمالي الموردين", value: total.toString(), color: "text-primary" },
    { icon: "payments", label: "الموردين النشطين", value: suppliers.filter(s => !s.notes?.includes("inactive")).length.toString(), color: "text-green-400" },
  ];

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="إدارة الموردين" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">إدارة الموردين</h1>
            <p className="text-[#e2bfb0]/60 mt-1 text-sm">إدارة سجلات الموردين وكشوفات الحساب</p>
          </div>
          <button onClick={() => setShowAddPanel(true)} className="flex items-center gap-2 bg-primary text-white font-bold px-6 py-3 rounded-full hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined text-[20px]">add</span>
            إضافة مورد
          </button>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {statCards.map((c, i) => (
            <div key={i} className="glass rounded-2xl p-6 hi-fi-shadow">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                  <span className={`material-symbols-outlined ${c.color}`}>{c.icon}</span>
                </div>
                <div>
                  <p className="text-[#e2bfb0]/60 text-xs">{c.label}</p>
                  <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="glass rounded-2xl p-4 mb-6 flex items-center gap-3">
          <span className="material-symbols-outlined text-[#e2bfb0]/40">search</span>
          <input value={search} onChange={handleSearch} placeholder="بحث بالاسم أو الهاتف أو البريد..." className="flex-1 bg-transparent text-sm text-white placeholder:text-[#e2bfb0]/30 focus:outline-none" />
        </div>

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden hi-fi-shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-white/5">
                  <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase">المورد</th>
                  <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase">معلومات التواصل</th>
                  <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase">شروط الدفع</th>
                  <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase text-center">العمليات</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-8 py-16 text-center text-[#e2bfb0]/40">
                    <span className="material-symbols-outlined text-4xl animate-spin block mb-2">progress_activity</span>
                    جاري التحميل...
                  </td></tr>
                ) : suppliers.length === 0 ? (
                  <tr><td colSpan={4} className="px-8 py-16 text-center text-[#e2bfb0]/40">
                    <span className="material-symbols-outlined text-5xl block mb-3">local_shipping</span>
                    لا يوجد موردين مسجلين
                  </td></tr>
                ) : suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-primary text-[18px]">local_shipping</span>
                        </div>
                        <div>
                          <p className="font-bold text-white text-sm">{s.name}</p>
                          {s.tax_number && <p className="text-[10px] text-[#e2bfb0]/50">رقم ضريبي: {s.tax_number}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm">
                        {s.phone && <p className="text-[#e2bfb0]/80 text-xs">{s.phone}</p>}
                        {s.email && <p className="text-[#e2bfb0]/50 text-[10px]">{s.email}</p>}
                        {!s.phone && !s.email && <p className="text-[#e2bfb0]/30 text-xs">-</p>}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="px-3 py-1 bg-white/5 text-[#e2bfb0]/70 rounded-full text-[10px] font-bold border border-white/10">
                        {s.payment_terms_days === "COD" ? "نقداً عند الاستلام" : s.payment_terms_days ? `${s.payment_terms_days} يوم` : "-"}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setSelectedSupplierId(s.id)} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary transition-all" title="عرض / تعديل">
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button onClick={() => handleDelete(s.id)} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-[#ffb4ab] transition-all" title="حذف">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Brands Management Section */}
        <div className="mt-12 pt-12 border-t border-white/5">
          <BrandsManagement />
        </div>
      </main>

      {/* Add Panel */}
      {showAddPanel && <AddSupplierPanel onClose={() => setShowAddPanel(false)} onSuccess={() => loadSuppliers(search)} />}

      {/* Edit Panel */}
      {selectedSupplierId && (
        <EditSupplierPanel
          supplierId={selectedSupplierId}
          onClose={() => setSelectedSupplierId(null)}
          onSuccess={() => loadSuppliers(search)}
        />
      )}
    </div>
  );
}
