"use client";

import { notifyError } from "@/lib/notifications";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ProductSelect } from "@/components/ProductSelect";
import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import BrandsManagement from "@/components/BrandsManagement";
import { errorMessage } from "@/lib/errors";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { useHydrated } from "@/lib/useHydrated";

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

const supplierIdentity = (item: Supplier): Supplier => ({
  id: item.id, name: item.name, phone: item.phone, email: item.email,
  address: item.address, tax_number: item.tax_number,
  contact_info: item.contact_info, notes: item.notes,
});

interface SupplierDetail extends Supplier {
  total_purchases: number;
  total_manual_debt: number;
  total_payments: number;
  balance: number | null;
  statement_incomplete: boolean;
  unpriced_receipts: number;
  unattributed_receipts: number;
  payments: Payment[];
  debt_entries: DebtEntry[];
}

interface DebtEntry {
  id: string;
  entry_type: "DEBT" | "REVERSAL";
  amount: number;
  note: string;
  reference_number?: string;
  reverses_entry_id?: string;
  created_at: string;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  cash_source?: "SHIFT" | "OUTSIDE_SHIFT" | null;
  reference_number?: string;
  notes?: string;
  payment_date: string;
}

// ─── Add Supplier Panel ───────────────────────────────────────────────────────
function AddSupplierPanel({ onClose, onSuccess, isAdmin }: { onClose: () => void; onSuccess: () => void; isAdmin: boolean }) {
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { opening_balance: "0", payment_terms_days: "COD" },
  });

  const onSubmit = async (data: SupplierFormValues) => {
    try {
      const { opening_balance, credit_limit, ...supplierInfo } = data;
      await fetchApi("/suppliers", {
        method: "POST",
        body: JSON.stringify({
          ...supplierInfo,
          ...(isAdmin ? {
            opening_balance: opening_balance || "0",
            credit_limit: credit_limit || null,
          } : {}),
        }),
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      notifyError(errorMessage(err, "فشل إنشاء المورد"));
    }
  };

  return (
    <div className="motion-overlay fixed inset-0 z-[100]" dir="rtl">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="motion-drawer supplier-drawer absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto shadow-2xl" style={{ background: "#1a1918", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between p-5 sm:p-8 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">إضافة مورد جديد</h2>
            <p className="text-sm text-[#e2bfb0]/60 mt-1">يُفتح له حساب مستقل تلقائيًا عند الحفظ</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 sm:p-8 flex flex-col gap-6 flex-1">
          {/* Basic Info */}
          <div>
            <p className="text-sm font-bold text-primary mb-4 text-right">البيانات الأساسية</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">اسم المورد *</label>
                <input {...register("name")} placeholder="اسم الشركة أو المورد" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <p className="text-sm font-bold text-primary mb-4 text-right">البيانات المالية</p>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الرقم الضريبي</label>
                  <input {...register("tax_number")} placeholder="الرقم الضريبي" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">شروط الدفع</label>
                  <Controller control={control} name="payment_terms_days" render={({ field }) =>
                    <ProductSelect label="شروط الدفع" value={field.value || "COD"} onChange={field.onChange}
                      placeholder="اختر شروط الدفع" options={[{ value: "COD", label: "نقداً عند الاستلام" }, ...[7, 15, 30, 60, 90].map(days => ({ value: String(days), label: `${days} يوم` }))]} />
                  } />
                </div>
              </div>
              {isAdmin && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">المديونية السابقة عند إضافة المورد (ج.م)</label>
                  <input {...register("opening_balance")} type="number" step="0.01" defaultValue="0" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.opening_balance ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">حد الائتمان (ج.م)</label>
                  <input {...register("credit_limit")} type="number" step="0.01" placeholder="بدون حد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
              </div>}
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-sm font-bold text-primary mb-4 text-right">ملاحظات</p>
            <textarea {...register("notes")} placeholder="ملاحظات إضافية..." rows={3} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 resize-none" />
          </div>

          <div className="mt-auto">
            <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-bold py-4 rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
              {isSubmitting ? <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> : <span className="material-symbols-outlined text-[20px]">save</span>}
              <span>{isSubmitting ? "جاري الحفظ..." : "حفظ المورد وفتح حسابه"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit / Detail Panel ──────────────────────────────────────────────────────
function EditSupplierPanel({ supplierId, onClose, onSuccess, isAdmin, initialTab = "info" }: { supplierId: string; onClose: () => void; onSuccess: () => void; isAdmin: boolean; initialTab?: "info" | "statement" | "debt" | "payment" }) {
  const paymentRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const debtRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const reversalRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"info" | "statement" | "debt" | "payment">(initialTab);
  const [debtDraft, setDebtDraft] = useState({ amount: "", note: "", reference_number: "" });
  const [debtBusy, setDebtBusy] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [cashSource, setCashSource] = useState<"" | "SHIFT" | "OUTSIDE_SHIFT">("");
  const mounted = useHydrated();

  const { register, control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
  });

  const { register: regPay, control: payControl, handleSubmit: handlePaySubmit, reset: resetPay, formState: { errors: payErrors, isSubmitting: paySubmitting } } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { payment_method: "Cash" },
  });
  const paymentMethod = useWatch({ control: payControl, name: "payment_method" });

  useEffect(() => {
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
      const supplierInfo = { ...data };
      const credit_limit = supplierInfo.credit_limit;
      delete supplierInfo.opening_balance;
      delete supplierInfo.credit_limit;
      await fetchApi(`/suppliers/${supplierId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...supplierInfo,
          ...(isAdmin ? {
            credit_limit: credit_limit || null,
          } : {}),
        }),
      });
      onSuccess();
      onClose();
    } catch (err: unknown) { notifyError(errorMessage(err, "فشل تحديث المورد")); }
  };

  const onPaySubmit = async (data: PaymentFormValues) => {
    if (data.payment_method === "Cash" && !cashSource) {
      notifyError("حدد مصدر الدفعة النقدية قبل تسجيلها.");
      return;
    }
    try {
      const payment = { ...data, amount: data.amount, cash_source: data.payment_method === "Cash" ? cashSource : null };
      const fingerprint = JSON.stringify(payment);
      if (paymentRequest.current?.fingerprint !== fingerprint) paymentRequest.current = { fingerprint, id: crypto.randomUUID() };
      await fetchApi(`/suppliers/${supplierId}/payments`, {
        method: "POST",
        body: JSON.stringify({ ...payment, request_id: paymentRequest.current.id }),
      });
      const updated = await fetchApi(`/suppliers/${supplierId}`);
      setDetail(updated);
      paymentRequest.current = null;
      resetPay({ payment_method: "Cash" });
      setCashSource("");
      setActiveTab("statement");
    } catch (err: unknown) { notifyError(errorMessage(err, "فشل تسجيل الدفعة")); }
  };

  const refreshDetail = async () => {
    const updated = await fetchApi(`/suppliers/${supplierId}`);
    setDetail(updated);
    onSuccess();
  };

  const onDebtSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(debtDraft.amount);
    const note = debtDraft.note.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(debtDraft.amount) || note.length < 2) {
      notifyError("أدخل مبلغًا موجبًا حتى خانتين عشريتين ووصفًا للمديونية.");
      return;
    }
    const payload = { amount: debtDraft.amount, note, reference_number: debtDraft.reference_number.trim() || null };
    const fingerprint = JSON.stringify(payload);
    if (debtRequest.current?.fingerprint !== fingerprint) debtRequest.current = { fingerprint, id: crypto.randomUUID() };
    setDebtBusy(true);
    try {
      await fetchApi(`/suppliers/${supplierId}/debts`, {
        method: "POST", body: JSON.stringify({ ...payload, request_id: debtRequest.current.id }),
      });
      await refreshDetail();
      debtRequest.current = null;
      setDebtDraft({ amount: "", note: "", reference_number: "" });
      setActiveTab("statement");
    } catch (err: unknown) {
      notifyError(errorMessage(err, "فشل تسجيل المديونية"));
    } finally {
      setDebtBusy(false);
    }
  };

  const reverseDebt = async (entry: DebtEntry) => {
    const reason = reversalReason.trim();
    if (reason.length < 2) { notifyError("اكتب سبب التصحيح."); return; }
    const fingerprint = `${entry.id}:${reason}`;
    if (reversalRequest.current?.fingerprint !== fingerprint) reversalRequest.current = { fingerprint, id: crypto.randomUUID() };
    setDebtBusy(true);
    try {
      await fetchApi(`/suppliers/${supplierId}/debts/${entry.id}/reverse`, {
        method: "POST", body: JSON.stringify({ request_id: reversalRequest.current.id, reason }),
      });
      await refreshDetail();
      reversalRequest.current = null;
      setReversingId(null);
      setReversalReason("");
    } catch (err: unknown) {
      notifyError(errorMessage(err, "فشل تصحيح المديونية"));
    } finally {
      setDebtBusy(false);
    }
  };

  const statementItems = [
    ...(detail?.debt_entries || []).map(entry => ({ kind: "debt" as const, date: entry.created_at, entry })),
    ...(detail?.payments || []).map(payment => ({ kind: "payment" as const, date: payment.payment_date, payment })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const reversedDebtIds = new Set((detail?.debt_entries || [])
    .filter(entry => entry.entry_type === "REVERSAL").map(entry => entry.reverses_entry_id));

  if (!mounted) return null;

  return createPortal(
    <div className="motion-overlay fixed inset-0 z-[100]" dir="rtl">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="motion-drawer supplier-drawer absolute inset-y-0 right-0 flex w-full max-w-[600px] flex-col overflow-y-auto shadow-2xl" style={{ background: "#1a1918", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between p-8 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">{loading ? "..." : detail?.name}</h2>
            <p className="text-sm text-[#e2bfb0]/60 mt-1">{isAdmin ? "تفاصيل وكشف حساب المورد" : "تفاصيل المورد"}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Balance Cards */}
        {isAdmin && detail && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6 border-b border-white/10">
            <div className="glass rounded-2xl p-4 text-right">
              <p className="text-sm text-[#e2bfb0]/80 mb-1">المديونية السابقة</p>
              <p className="text-lg font-bold text-white">{Number(detail.opening_balance || 0).toLocaleString()}</p>
              <p className="text-xs text-[#e2bfb0]/60">ج.م</p>
            </div>
            <div className="glass rounded-2xl p-4 text-right">
              <p className="text-sm text-[#e2bfb0]/80 mb-1">استلامات قديمة محسوبة</p>
              <p className="text-lg font-bold text-white">{Number(detail.total_purchases).toLocaleString()}</p>
              <p className="text-xs text-[#e2bfb0]/60">{detail.statement_incomplete ? "مشتريات موثقة فقط" : "ج.م"}</p>
            </div>
            <div className="glass rounded-2xl p-4 text-right">
              <p className="text-sm text-[#e2bfb0]/80 mb-1">مديونيات أُضيفت يدويًا</p>
              <p className="text-lg font-bold text-white">{Number(detail.total_manual_debt || 0).toLocaleString()}</p>
              <p className="text-xs text-[#e2bfb0]/60">ج.م · استلام المخزن لا يزيد هذا المبلغ</p>
            </div>
            <div className="glass rounded-2xl p-4 text-right">
              <p className="text-sm text-[#e2bfb0]/80 mb-1">إجمالي المدفوعات</p>
              <p className="text-lg font-bold text-green-400">{Number(detail.total_payments).toLocaleString()}</p>
              <p className="text-xs text-[#e2bfb0]/60">ج.م</p>
            </div>
            <div className={`glass rounded-2xl p-4 text-right ${detail.balance !== null && detail.credit_limit && Number(detail.balance) > Number(detail.credit_limit) ? 'border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : ''}`}>
              <p className="text-sm text-[#e2bfb0]/80 mb-1">الرصيد المستحق</p>
              <p className={`text-lg font-bold ${detail.balance !== null && detail.balance > 0 ? "text-[#ffb4ab]" : "text-green-400"}`}>{detail.balance === null ? "غير معروف" : Number(detail.balance).toLocaleString()}</p>
              <p className="text-xs text-[#e2bfb0]/60">{detail.balance === null ? "يلزم تسوية الحركات القديمة" : "ج.م"}</p>
              {detail.credit_limit ? (
                <p className={`text-xs mt-1 border-t border-white/5 pt-1 ${detail.balance !== null && Number(detail.balance) > Number(detail.credit_limit) ? 'text-red-400 font-bold' : 'text-[#e2bfb0]/60'}`}>
                  حد الائتمان: {Number(detail.credit_limit).toLocaleString()}
                </p>
              ) : null}
            </div>
          </div>
        )}
        {isAdmin && detail?.statement_incomplete && (
          <p className="px-6 py-3 text-xs text-amber-300 border-b border-amber-500/20">
            كشف الحساب غير مكتمل: {detail.unpriced_receipts} استلامات بلا تكلفة، و{detail.unattributed_receipts} استلامات قديمة بلا مورد موثق. لا يمكن حساب الرصيد بدقة قبل التسوية.
          </p>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6">
          {([{ key: "info", label: "البيانات", icon: "person" }, ...(isAdmin ? [{ key: "statement", label: "كشف الحساب", icon: "receipt_long" }, { key: "debt", label: "إضافة مديونية", icon: "add_card" }, { key: "payment", label: "تسجيل دفعة", icon: "payments" }] : [])] as { key: "info" | "statement" | "debt" | "payment"; label: string; icon: string }[]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
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
                  <Controller control={control} name="payment_terms_days" render={({ field }) =>
                    <ProductSelect label="شروط الدفع" value={field.value || "COD"} onChange={field.onChange}
                      placeholder="اختر شروط الدفع" options={[{ value: "COD", label: "نقداً عند الاستلام" }, ...[7, 15, 30, 60, 90].map(days => ({ value: String(days), label: `${days} يوم` }))]} />
                  } />
                </div>
              </div>
              {isAdmin && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">المديونية السابقة عند الإضافة (ثابتة)</label>
                  <p className="glass rounded-xl px-4 py-3 text-sm text-white border border-white/10">{Number(detail?.opening_balance || 0).toLocaleString()} ج.م</p>
                </div>
                <div>
                  <label className="text-xs text-[#e2bfb0]/60 mb-1 block">حد الائتمان (ج.م)</label>
                  <input {...register("credit_limit")} type="number" step="0.01" placeholder="بدون حد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
              </div>}
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
              <p className="text-xs text-[#e2bfb0]/70 mb-4">المستحق = المديونية السابقة + الاستلامات القديمة المحسوبة + المديونيات اليدوية − الدفعات. استلامات المخزن الجديدة لا تدخل الحساب.</p>
              {statementItems.length === 0 ? (
                <div className="text-center py-16 text-[#e2bfb0]/40">
                  <span className="material-symbols-outlined text-6xl block mb-4">receipt_long</span>
                  <p>لا توجد حركات مالية مسجلة بعد</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {statementItems.map(item => item.kind === "payment" ? (
                    <div key={`payment-${item.payment.id}`} className="glass rounded-2xl p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-white">دفعة · {item.payment.payment_method}{item.payment.payment_method === "Cash" ? item.payment.cash_source === "OUTSIDE_SHIFT" ? " · خارج الوردية" : " · من الوردية" : ""}</p>
                        <p className="text-xs text-[#e2bfb0]/70">{new Date(item.payment.payment_date).toLocaleDateString("ar-EG")}{item.payment.reference_number ? ` · ${item.payment.reference_number}` : ""}</p>
                        {item.payment.notes && <p className="text-xs text-[#e2bfb0]/60">{item.payment.notes}</p>}
                      </div>
                      <p className="font-bold text-green-400 whitespace-nowrap">−{Number(item.payment.amount).toLocaleString()} ج.م</p>
                    </div>
                  ) : (
                    <div key={`debt-${item.entry.id}`} className="glass rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white">{item.entry.entry_type === "DEBT" ? "مديونية مضافة" : "تصحيح مديونية"}</p>
                          <p className="text-xs text-[#e2bfb0]/70">{new Date(item.entry.created_at).toLocaleDateString("ar-EG")}{item.entry.reference_number ? ` · ${item.entry.reference_number}` : ""}</p>
                          <p className="text-xs text-[#e2bfb0]/70 mt-1">{item.entry.note}</p>
                        </div>
                        <p className={`font-bold whitespace-nowrap ${item.entry.entry_type === "DEBT" ? "text-[#ffb4ab]" : "text-green-400"}`}>
                          {item.entry.entry_type === "DEBT" ? "+" : "−"}{Number(item.entry.amount).toLocaleString()} ج.م
                        </p>
                      </div>
                      {item.entry.entry_type === "DEBT" && !reversedDebtIds.has(item.entry.id) && (
                        reversingId === item.entry.id ? (
                          <div className="flex flex-wrap gap-2">
                            <input value={reversalReason} onChange={event => setReversalReason(event.target.value)} placeholder="سبب التصحيح" maxLength={500}
                              className="app-field min-w-0 flex-1" aria-label="سبب تصحيح المديونية" />
                            <button type="button" disabled={debtBusy} onClick={() => reverseDebt(item.entry)} className="app-secondary-button">تأكيد التصحيح</button>
                            <button type="button" onClick={() => { setReversingId(null); setReversalReason(""); }} className="app-secondary-button">إلغاء</button>
                          </div>
                        ) : <button type="button" onClick={() => setReversingId(item.entry.id)} className="text-xs text-[#e2bfb0]/70 hover:text-white">تصحيح هذا الإدخال</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "debt" && (
            <form onSubmit={onDebtSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-[#e2bfb0]/70">سجّل مبلغ الفاتورة أو المديونية الجديدة هنا. هذه الحركة مالية فقط ولا تغيّر كمية المخزون.</p>
              <label className="text-sm text-[#e2bfb0]/80">قيمة المديونية (ج.م)
                <input type="number" min="0.01" step="0.01" required value={debtDraft.amount}
                  onChange={event => setDebtDraft(previous => ({ ...previous, amount: event.target.value }))}
                  className="app-field mt-2 w-full" />
              </label>
              <label className="text-sm text-[#e2bfb0]/80">وصف الفاتورة أو سبب المديونية
                <input required minLength={2} maxLength={500} value={debtDraft.note}
                  onChange={event => setDebtDraft(previous => ({ ...previous, note: event.target.value }))}
                  className="app-field mt-2 w-full" placeholder="مثلاً: فاتورة توريد 15 أكتوبر" />
              </label>
              <label className="text-sm text-[#e2bfb0]/80">رقم الفاتورة أو المرجع · اختياري
                <input maxLength={100} value={debtDraft.reference_number}
                  onChange={event => setDebtDraft(previous => ({ ...previous, reference_number: event.target.value }))}
                  className="app-field mt-2 w-full" />
              </label>
              <button type="submit" disabled={debtBusy} className="app-primary-button justify-center">{debtBusy ? "جاري التسجيل..." : "تسجيل المديونية"}</button>
            </form>
          )}

          {/* Payment Tab */}
          {activeTab === "payment" && (
            <form onSubmit={event => { void handlePaySubmit(onPaySubmit)(event); }} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">المبلغ (ج.م) *</label>
                <input {...regPay("amount")} type="number" step="0.01" placeholder="0.00" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${payErrors.amount ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {payErrors.amount && <p className="text-red-400 text-xs mt-1">{payErrors.amount.message}</p>}
              </div>
              <div>
                <label className="text-xs text-[#e2bfb0]/60 mb-1 block">طريقة الدفع</label>
                <Controller control={payControl} name="payment_method" render={({ field }) =>
                  <ProductSelect label="طريقة الدفع" value={field.value} onChange={field.onChange} placeholder="اختر طريقة الدفع"
                    options={[{ value: "Cash", label: "نقداً" }, { value: "Bank Transfer", label: "تحويل بنكي" }, { value: "Check", label: "شيك" }, { value: "Other", label: "أخرى" }]} />
                } />
                {paymentMethod === "Cash" && <div className="mt-3">
                  <ProductSelect label="مصدر المبلغ النقدي" value={cashSource} onChange={value => setCashSource(value as "" | "SHIFT" | "OUTSIDE_SHIFT")}
                    placeholder="حدد مصدر الدفعة" options={[{ value: "OUTSIDE_SHIFT", label: "خارج الوردية" }, { value: "SHIFT", label: "من درج الوردية" }]} />
                  <p className="mt-2 text-xs text-[#e2bfb0]/60">الدفعة من درج الوردية تتطلب وردية مفتوحة ورصيدًا كافيًا. الدفعة خارج الوردية تُسجل في كشف المورد فقط.</p>
                </div>}
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
  const previous = readSectionSnapshot<{ suppliers: Supplier[]; total: number }>("suppliers-list");
  const [role, setRole] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => previous?.suppliers || []);
  const [total, setTotal] = useState(() => previous?.total || 0);
  const [loading, setLoading] = useState(() => !previous);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierTab, setSupplierTab] = useState<"info" | "statement" | "debt" | "payment">("info");
  const openSupplier = (id: string, tab: "info" | "statement" | "debt" | "payment" = "info") => {
    setSupplierTab(tab);
    setSelectedSupplierId(id);
  };
  useSectionSearchSelection(id => openSupplier(id, role === "ADMIN" ? "statement" : "info"));

  const loadSuppliers = async (q = "") => {
    setLoading(true);
    try {
      const res = await fetchApi(`/suppliers?search=${encodeURIComponent(q)}&limit=50`);
      setSuppliers(res.data || []);
      setTotal(res.total || 0);
      if (!q) writeSectionSnapshot("suppliers-list", { suppliers: (res.data || []).map(supplierIdentity), total: res.total || 0 });
    } catch (error) {
      notifyError(errorMessage(error, "تعذر تحميل الموردين"));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchApi("/auth/me").then(user => setRole(user.role)).catch(() => setRole(null));
    fetchApi("/suppliers?search=&limit=50")
      .then(res => {
        setSuppliers(res.data || []);
        setTotal(res.total || 0);
        writeSectionSnapshot("suppliers-list", { suppliers: (res.data || []).map(supplierIdentity), total: res.total || 0 });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا المورد؟")) return;
    try {
      await fetchApi(`/suppliers/${id}`, { method: "DELETE" });
      loadSuppliers();
    } catch (err: unknown) { notifyError(errorMessage(err, "فشل حذف المورد")); }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="إدارة الموردين" />
      <main className="app-main">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <div>
            <h1 className="app-heading">إدارة الموردين</h1>
            <p className="app-subtitle">{role === "ADMIN" ? "سجلات الموردين وكشوفات الحساب" : "بيانات الموردين"}</p>
          </div>
          <button onClick={() => setShowAddPanel(true)} className="app-primary-button">
            <span className="material-symbols-outlined text-[20px]">add</span>
            إضافة مورد وفتح حساب
          </button>
        </div>

        {/* Stat Cards */}
        <div className="app-panel mb-8 inline-flex min-w-64 items-center justify-between gap-4 p-6 text-right">
          <div>
            <p className="app-muted text-sm font-semibold">إجمالي الموردين</p>
            <p className="text-2xl font-bold text-primary">{total.toLocaleString("ar-EG")}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <span className="material-symbols-outlined text-primary">local_shipping</span>
          </div>
        </div>

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden hi-fi-shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-white/5">
                  <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-right">المورد</th>
                  <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-right">معلومات التواصل</th>
                  <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-right">شروط الدفع</th>
                  <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-center">العمليات</th>
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
                  <tr key={s.id} data-search-id={s.id} className="hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                          <span className="material-symbols-outlined text-primary text-[18px]">local_shipping</span>
                        </div>
                        <div>
                          <button type="button" onClick={() => openSupplier(s.id, role === "ADMIN" ? "statement" : "info")} className="font-bold text-white text-sm hover:text-primary text-right underline-offset-4 hover:underline" aria-label={`فتح تفاصيل المورد ${s.name}`}>{s.name}</button>
                          {s.tax_number && <p className="text-xs text-[#e2bfb0]/70">رقم ضريبي: {s.tax_number}</p>}
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
                      <span className="px-3 py-1 bg-white/5 text-[#e2bfb0]/70 rounded-full text-xs font-bold border border-white/10">
                        {s.payment_terms_days === "COD" ? "نقداً عند الاستلام" : s.payment_terms_days ? `${s.payment_terms_days} يوم` : "-"}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openSupplier(s.id, role === "ADMIN" ? "statement" : "info")} className="app-secondary-button text-xs" title="تفاصيل المورد وكشف حسابه">تفاصيل {role === "ADMIN" ? "وكشف الحساب" : ""}</button>
                        {role === "ADMIN" && <button onClick={() => openSupplier(s.id, "debt")} className="app-secondary-button text-xs">إضافة مديونية</button>}
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
      {showAddPanel && role && <AddSupplierPanel isAdmin={role === "ADMIN"} onClose={() => setShowAddPanel(false)} onSuccess={() => loadSuppliers()} />}

      {/* Edit Panel */}
      {selectedSupplierId && role && (
        <EditSupplierPanel
          isAdmin={role === "ADMIN"}
          initialTab={supplierTab}
          supplierId={selectedSupplierId}
          onClose={() => setSelectedSupplierId(null)}
          onSuccess={() => loadSuppliers()}
        />
      )}
    </div>
  );
}
