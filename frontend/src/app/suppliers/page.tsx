"use client";

import { notifyError } from "@/lib/notifications";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ProductSelect } from "@/components/ProductSelect";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
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
  amount: z.string().refine(v => /^\d+(?:\.\d{1,2})?$/.test(v) && Number(v) > 0, "أدخل مبلغاً صحيحاً حتى قرشين"),
  payment_method: z.enum(["Cash", "Instapay", "Wallet"]),
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
  due_date?: string | null;
  allocated_amount: number;
  reverses_entry_id?: string;
  created_at: string;
}

function automaticAllocations(debts: DebtEntry[], amountCents: number) {
  let remainingCents = Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0;
  const allocations: { debt_entry_id: string; amount: string }[] = [];
  for (const debt of [...debts].sort((a, b) =>
    (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const debtCents = Math.max(0, Math.round(Number(debt.amount) * 100) - Math.round(Number(debt.allocated_amount || 0) * 100));
    const appliedCents = Math.min(remainingCents, debtCents);
    if (appliedCents > 0) allocations.push({ debt_entry_id: debt.id, amount: (appliedCents / 100).toFixed(2) });
    remainingCents -= appliedCents;
    if (remainingCents === 0) break;
  }
  return { allocations, remainingCents };
}

interface Payment {
  id: string;
  amount: number;
  allocations: { debt_entry_id: string; amount: number }[];
  payment_method: string;
  cash_source?: "SHIFT" | "OUTSIDE_SHIFT" | null;
  reference_number?: string;
  notes?: string;
  payment_date: string;
}

const paymentMethodLabel: Record<string, string> = {
  Cash: "نقداً",
  Instapay: "إنستا باي",
  Wallet: "محفظة",
  "Bank Transfer": "تحويل بنكي",
  Check: "شيك",
  Other: "أخرى",
};

// ─── Add Supplier Panel ───────────────────────────────────────────────────────
function AddSupplierPanel({ onClose, onSuccess, isAdmin }: { onClose: () => void; onSuccess: () => void; isAdmin: boolean }) {
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { opening_balance: "", payment_terms_days: "COD" },
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
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-on-surface-variant hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-5 sm:p-8 flex flex-col gap-6 flex-1">
          {/* Basic Info */}
          <div>
            <p className="text-sm font-bold text-primary mb-4 text-right">البيانات الأساسية</p>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">اسم المورد *</label>
                <input {...register("name")} placeholder="اسم الشركة أو المورد" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">رقم الهاتف</label>
                  <input {...register("phone")} placeholder="01xxxxxxxxx" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">البريد الإلكتروني</label>
                  <input {...register("email")} type="email" placeholder="info@supplier.com" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.email ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">العنوان</label>
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
                  <label className="text-xs text-on-surface-variant mb-1 block">الرقم الضريبي</label>
                  <input {...register("tax_number")} placeholder="الرقم الضريبي" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">شروط الدفع</label>
                  <Controller control={control} name="payment_terms_days" render={({ field }) =>
                    <ProductSelect label="شروط الدفع" value={field.value || "COD"} onChange={field.onChange}
                      placeholder="اختر شروط الدفع" options={[{ value: "COD", label: "نقداً عند الاستلام" }, ...[7, 15, 30, 60, 90].map(days => ({ value: String(days), label: `${days} يوم` }))]} />
                  } />
                </div>
              </div>
              {isAdmin && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">المديونية السابقة عند إضافة المورد (ج.م)</label>
                  <input {...register("opening_balance")} type="number" step="0.01" placeholder="0" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.opening_balance ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">حد الائتمان (ج.م)</label>
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
  const confirmAction = useConfirmAction();
  const paymentRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const debtRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const reversalRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"info" | "statement" | "debt" | "payment">(initialTab);
  const [statementFilter, setStatementFilter] = useState<"all" | "open" | "overdue" | "soon">("all");
  const [debtDraft, setDebtDraft] = useState({ amount: "", note: "", reference_number: "", due_date: "" });
  const [debtBusy, setDebtBusy] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [cashSource, setCashSource] = useState<"" | "SHIFT" | "OUTSIDE_SHIFT">("");
  const mounted = useHydrated();

  const { register, control, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
  });

  const { register: regPay, control: payControl, handleSubmit: handlePaySubmit, reset: resetPay, formState: { errors: payErrors, isSubmitting: paySubmitting } } = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { payment_method: "Cash" },
  });
  const paymentMethod = useWatch({ control: payControl, name: "payment_method" });
  const paymentAmount = useWatch({ control: payControl, name: "amount" });

  useEffect(() => {
    fetchApi(`/suppliers/${supplierId}`).then(data => {
      setDetail(data);
      const due = new Date(`${new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Cairo" })}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + (/^\d+$/.test(data.payment_terms_days || "") ? Number(data.payment_terms_days) : 0));
      setDebtDraft(previous => ({ ...previous, due_date: previous.due_date || due.toISOString().slice(0, 10) }));
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
    const amountCents = Math.round(Number(data.amount) * 100);
    const { allocations, remainingCents } = automaticAllocations(openDebts, amountCents);
    const exceedsBalance = detail?.balance !== null && detail?.balance !== undefined && amountCents > Math.round(Number(detail.balance) * 100);
    if (remainingCents > 0 || exceedsBalance) {
      const remainderMessage = remainingCents > 0 ? `${(remainingCents / 100).toLocaleString()} ج.م من الدفعة ستُخصم من الرصيد العام دون ربطها بمديونية يدوية. ` : "";
      const overpaymentMessage = exceedsBalance ? `الدفعة أكبر من الرصيد المستحق ${Number(detail?.balance).toLocaleString()} ج.م، وسيصبح رصيد المورد دائنًا.` : "";
      if (!await confirmAction({ title: "تأكيد توزيع الدفعة", message: `${remainderMessage}${overpaymentMessage}`, confirmLabel: "تسجيل الدفعة" })) return;
    }
    try {
      const payment = { ...data, amount: data.amount, cash_source: data.payment_method === "Cash" ? cashSource : null, allocations, allow_unallocated: remainingCents > 0 };
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
    setValue("credit_limit", updated.credit_limit?.toString() || "");
    onSuccess();
  };

  const onDebtSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(debtDraft.amount);
    const note = debtDraft.note.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(debtDraft.amount) || note.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(debtDraft.due_date)) {
      notifyError("أدخل مبلغًا موجبًا حتى خانتين عشريتين ووصفًا للمديونية.");
      return;
    }
    setDebtBusy(true);
    try {
      const latest = await fetchApi(`/suppliers/${supplierId}`, { invalidateSnapshots: false }) as SupplierDetail;
      setDetail(latest);
      setValue("credit_limit", latest.credit_limit?.toString() || "");
      let approvedCreditLimit: string | null = null;
      if (latest.credit_limit !== null && latest.credit_limit !== undefined) {
        if (latest.balance === null) {
          notifyError("رصيد المورد غير معروف بسبب حركات قديمة؛ يلزم تسويته قبل إضافة مديونية على حد ائتماني.");
          return;
        }
        const currentCents = Math.round(Number(latest.balance) * 100);
        const amountCents = Math.round(amount * 100);
        const limitCents = Math.round(Number(latest.credit_limit) * 100);
        const projectedCents = currentCents + amountCents;
        if (projectedCents > limitCents) {
          const money = (cents: number) => (cents / 100).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (!await confirmAction({ title: "رفع الحد الائتماني؟", message: `إضافة المديونية سترفع رصيد المورد من ${money(currentCents)} إلى ${money(projectedCents)} ج.م، متجاوزًا الحد الحالي ${money(limitCents)} ج.م. بالموافقة سيرتفع الحد إلى ${money(projectedCents)} ج.م وتُسجّل المديونية.`, confirmLabel: "رفع الحد وتسجيل المديونية" })) return;
          approvedCreditLimit = (projectedCents / 100).toFixed(2);
        }
      }
      const payload = { amount: debtDraft.amount, note, reference_number: debtDraft.reference_number.trim() || null, due_date: debtDraft.due_date };
      const fingerprint = JSON.stringify(payload);
      if (debtRequest.current?.fingerprint !== fingerprint) debtRequest.current = { fingerprint, id: crypto.randomUUID() };
      await fetchApi(`/suppliers/${supplierId}/debts`, {
        method: "POST", body: JSON.stringify({ ...payload, request_id: debtRequest.current.id, approved_credit_limit: approvedCreditLimit }),
      });
      await refreshDetail();
      debtRequest.current = null;
      setDebtDraft(previous => ({ amount: "", note: "", reference_number: "", due_date: previous.due_date }));
      setActiveTab("statement");
    } catch (err: unknown) {
      const message = errorMessage(err, "فشل تسجيل المديونية");
      notifyError(message.includes("Credit limit approval is required")
        ? "تغير رصيد المورد قبل الحفظ؛ راجع الحد الائتماني الجديد وحاول مرة أخرى."
        : message.includes("Supplier balance is unknown")
          ? "رصيد المورد غير معروف بسبب حركات قديمة؛ يلزم تسويته قبل إضافة مديونية على حد ائتماني."
          : message);
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
  const openDebts = (detail?.debt_entries || []).filter(entry => entry.entry_type === "DEBT" &&
    !reversedDebtIds.has(entry.id) && Number(entry.amount) - Number(entry.allocated_amount || 0) > 0.001);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Cairo" });
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  const soonDate = soon.toISOString().slice(0, 10);
  const overdueDebts = openDebts.filter(entry => entry.due_date && entry.due_date < today);
  const upcomingDebts = openDebts.filter(entry => entry.due_date && entry.due_date >= today && entry.due_date <= soonDate);
  const filteredStatementItems = statementFilter === "all" ? statementItems : statementItems.filter(item => {
    if (item.kind !== "debt") return false;
    const matches = statementFilter === "open" ? openDebts : statementFilter === "overdue" ? overdueDebts : upcomingDebts;
    return matches.some(entry => entry.id === item.entry.id);
  });
  const paymentPreview = automaticAllocations(openDebts, Math.round((Number(paymentAmount) || 0) * 100));

  if (!mounted) return null;

  return createPortal(
    <div className="motion-overlay fixed inset-0 z-[100]" dir="rtl">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="motion-drawer supplier-drawer absolute inset-y-0 right-0 flex w-full max-w-[600px] min-h-0 flex-col overflow-hidden shadow-2xl" style={{ background: "#1a1918", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">{loading ? <span className="app-skeleton h-6 w-40" role="status" aria-label="جاري تحميل تفاصيل المورد" /> : detail?.name}</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full glass flex items-center justify-center text-on-surface-variant hover:text-white">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 overflow-x-auto border-b border-white/10 px-5">
          {([{ key: "info", label: "البيانات" }, ...(isAdmin ? [{ key: "statement", label: "كشف الحساب" }, { key: "debt", label: "مديونية" }, { key: "payment", label: "دفعة" }] : [])] as { key: "info" | "statement" | "debt" | "payment"; label: string }[]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 px-3 py-3 text-sm font-bold transition-all border-b-2 ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-[#e2bfb0]/70 hover:text-white"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {isAdmin && detail && (
            <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="ملخص حساب المورد">
              {([
                { label: "المديونية السابقة", value: Number(detail.opening_balance || 0), tone: "text-white" },
                { label: "استلامات قديمة محسوبة", value: Number(detail.total_purchases), tone: "text-white" },
                { label: "مديونيات مضافة", value: Number(detail.total_manual_debt || 0), tone: "text-white" },
                { label: "إجمالي الدفعات", value: Number(detail.total_payments), tone: "text-emerald-400" },
              ] as const).map(card => <div key={card.label} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                <span className="text-xs text-[#e2bfb0]/80">{card.label}</span>
                <strong className={`mt-1 block text-xl font-bold tabular-nums ${card.tone}`}>{card.value.toLocaleString()} <span className="text-xs font-normal text-[#e2bfb0]/70">ج.م</span></strong>
              </div>)}
              <div className={`rounded-2xl border px-4 py-3 sm:col-span-2 ${detail.balance !== null && detail.credit_limit !== null && detail.credit_limit !== undefined && Number(detail.balance) > Number(detail.credit_limit) ? "border-red-400/35 bg-red-400/[0.06]" : "border-primary/25 bg-primary/[0.06]"}`}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-semibold text-white">الرصيد المستحق</span>
                  <strong className={`text-2xl font-bold tabular-nums ${detail.balance !== null && detail.balance > 0 ? "text-[#ffb4ab]" : "text-emerald-400"}`}>{detail.balance === null ? "غير معروف" : `${Number(detail.balance).toLocaleString()} ج.م`}</strong>
                </div>
                {detail.credit_limit !== null && detail.credit_limit !== undefined && <p className="mt-1 text-xs text-[#e2bfb0]/80">حد الائتمان {Number(detail.credit_limit).toLocaleString()} ج.م</p>}
              </div>
              {detail.statement_incomplete && <p className="text-xs text-amber-300 sm:col-span-2">كشف الحساب غير مكتمل: {detail.unpriced_receipts} استلامات بلا تكلفة، و{detail.unattributed_receipts} استلامات قديمة بلا مورد موثق.</p>}
            </section>
          )}
          {/* Info Tab */}
          {activeTab === "info" && (
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">اسم المورد *</label>
                <input {...register("name")} className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">الهاتف</label>
                  <input {...register("phone")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">البريد الإلكتروني</label>
                  <input {...register("email")} type="email" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.email ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">العنوان</label>
                <input {...register("address")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">الرقم الضريبي</label>
                  <input {...register("tax_number")} className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">شروط الدفع</label>
                  <Controller control={control} name="payment_terms_days" render={({ field }) =>
                    <ProductSelect label="شروط الدفع" value={field.value || "COD"} onChange={field.onChange}
                      placeholder="اختر شروط الدفع" options={[{ value: "COD", label: "نقداً عند الاستلام" }, ...[7, 15, 30, 60, 90].map(days => ({ value: String(days), label: `${days} يوم` }))]} />
                  } />
                </div>
              </div>
              {isAdmin && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">المديونية السابقة عند الإضافة (ثابتة)</label>
                  <p className="glass rounded-xl px-4 py-3 text-sm text-white border border-white/10">{Number(detail?.opening_balance || 0).toLocaleString()} ج.م</p>
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">حد الائتمان (ج.م)</label>
                  <input {...register("credit_limit")} type="number" step="0.01" placeholder="بدون حد" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
                </div>
              </div>}
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">ملاحظات</label>
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
              <div className="mb-3 flex flex-wrap gap-2" aria-label="تصفية كشف الحساب">
                {([
                  { key: "all", label: "كل الحركات" },
                  { key: "open", label: "المفتوحة" },
                  { key: "overdue", label: "المتأخرة" },
                  { key: "soon", label: "خلال ٧ أيام" },
                ] as const).map(filter => <button key={filter.key} type="button" onClick={() => setStatementFilter(filter.key)}
                  aria-pressed={statementFilter === filter.key}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${statementFilter === filter.key ? "border-primary bg-primary/15 text-white" : "border-white/10 text-[#e2bfb0]/75 hover:text-white"}`}>
                  {filter.label}
                </button>)}
              </div>
              {filteredStatementItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#e2bfb0]/70">{statementFilter === "all" ? "لا توجد حركات مالية مسجلة بعد" : "لا توجد مديونيات في هذا التصنيف"}</p>
              ) : (
                <div className="divide-y divide-white/10 border-y border-white/10">
                  {filteredStatementItems.map(item => item.kind === "payment" ? (
                    <div key={`payment-${item.payment.id}`} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">دفعة · {paymentMethodLabel[item.payment.payment_method] || item.payment.payment_method}{item.payment.payment_method === "Cash" ? item.payment.cash_source === "OUTSIDE_SHIFT" ? " · خارج الوردية" : " · من الوردية" : ""}</p>
                        <p className="text-xs text-[#e2bfb0]/75">{new Date(item.payment.payment_date).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" })}{item.payment.reference_number ? ` · ${item.payment.reference_number}` : ""}{item.payment.allocations?.length ? ` · ${item.payment.allocations.length} مديونية` : " · على الرصيد العام"}</p>
                        {item.payment.notes && <p className="mt-1 text-xs text-[#e2bfb0]/75 break-words">{item.payment.notes}</p>}
                        {item.payment.allocations?.length > 0 && Number(item.payment.amount) - item.payment.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0) > 0.001 && <p className="text-xs text-[#e2bfb0]/70">غير موزع: {(Number(item.payment.amount) - item.payment.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0)).toLocaleString()} ج.م</p>}
                      </div>
                      <strong className="shrink-0 whitespace-nowrap text-sm tabular-nums text-green-400">−{Number(item.payment.amount).toLocaleString()} ج.م</strong>
                    </div>
                  ) : (
                    <div key={`debt-${item.entry.id}`} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-white">{item.entry.entry_type === "DEBT" ? item.entry.note : `تصحيح · ${item.entry.note}`}</p>
                          <p className="text-xs text-[#e2bfb0]/75">{new Date(item.entry.created_at).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" })}{item.entry.reference_number ? ` · ${item.entry.reference_number}` : ""}</p>
                          {item.entry.entry_type === "DEBT" && !reversedDebtIds.has(item.entry.id) && <p className={`text-xs ${item.entry.due_date && item.entry.due_date < today && openDebts.some(entry => entry.id === item.entry.id) ? "text-red-300" : "text-[#e2bfb0]/75"}`}>
                            {item.entry.due_date ? `استحقاق ${item.entry.due_date}` : "بلا موعد"} · {Number(item.entry.amount) - Number(item.entry.allocated_amount || 0) > 0.001 ? `متبقي ${(Number(item.entry.amount) - Number(item.entry.allocated_amount || 0)).toLocaleString()} ج.م` : "مسددة"}
                          </p>}
                          {item.entry.entry_type === "DEBT" && reversedDebtIds.has(item.entry.id) && <p className="text-xs text-[#e2bfb0]/75">تم تصحيحها</p>}
                        </div>
                        <strong className={`shrink-0 whitespace-nowrap text-sm tabular-nums ${item.entry.entry_type === "DEBT" ? "text-[#ffb4ab]" : "text-green-400"}`}>
                          {item.entry.entry_type === "DEBT" ? "+" : "−"}{Number(item.entry.amount).toLocaleString()} ج.م
                        </strong>
                      </div>
                      {item.entry.entry_type === "DEBT" && !reversedDebtIds.has(item.entry.id) && Number(item.entry.allocated_amount || 0) < 0.001 && (
                        reversingId === item.entry.id ? (
                          <div className="mt-2 flex flex-wrap gap-2">
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
              <label className="text-sm text-[#e2bfb0]/80">تاريخ الاستحقاق
                <input type="date" required value={debtDraft.due_date}
                  onChange={event => setDebtDraft(previous => ({ ...previous, due_date: event.target.value }))}
                  className="app-field mt-2 w-full" />
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
                <label className="text-xs text-on-surface-variant mb-1 block">المبلغ (ج.م) *</label>
                <input {...regPay("amount")} type="number" step="0.01" placeholder="0.00" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${payErrors.amount ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
                {payErrors.amount && <p className="text-red-400 text-xs mt-1">{payErrors.amount.message}</p>}
              </div>
              <section className="border-y border-white/10 py-3" aria-live="polite">
                <h3 className="text-sm font-bold text-white">توزيع تلقائي</h3>
                <p className="text-xs text-[#e2bfb0]/75">تُسدّد المديونيات الأقدم استحقاقًا أولًا.</p>
                {Number(paymentAmount) > 0 && <div className="mt-2 divide-y divide-white/10 text-xs">
                  {paymentPreview.allocations.map(allocation => {
                    const debt = openDebts.find(entry => entry.id === allocation.debt_entry_id);
                    if (!debt) return null;
                    const afterCents = Math.max(0, Math.round(Number(debt.amount) * 100) - Math.round(Number(debt.allocated_amount || 0) * 100) - Math.round(Number(allocation.amount) * 100));
                    return <div key={debt.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                      <span className="min-w-0 break-words text-white">{debt.note}</span>
                      <span className="tabular-nums text-[#e2bfb0]/80">سداد {Number(allocation.amount).toLocaleString()} · يتبقى {(afterCents / 100).toLocaleString()} ج.م</span>
                    </div>;
                  })}
                  {paymentPreview.remainingCents > 0 && <p className="py-2 text-[#e2bfb0]/80">{(paymentPreview.remainingCents / 100).toLocaleString()} ج.م على الرصيد العام</p>}
                </div>}
              </section>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">طريقة الدفع</label>
                <Controller control={payControl} name="payment_method" render={({ field }) =>
                  <ProductSelect label="طريقة الدفع" value={field.value} onChange={field.onChange} placeholder="اختر طريقة الدفع"
                    options={[{ value: "Cash", label: "نقداً" }, { value: "Instapay", label: "إنستا باي" }, { value: "Wallet", label: "محفظة" }]} allowClear={false} />
                } />
                {paymentMethod === "Cash" && <div className="mt-3">
                  <ProductSelect label="مصدر المبلغ النقدي" value={cashSource} onChange={value => setCashSource(value as "" | "SHIFT" | "OUTSIDE_SHIFT")}
                    placeholder="حدد مصدر الدفعة" options={[{ value: "OUTSIDE_SHIFT", label: "خارج الوردية" }, { value: "SHIFT", label: "من درج الوردية" }]} />
                  <p className="mt-2 text-xs text-on-surface-variant">الدفعة من درج الوردية تتطلب وردية مفتوحة ورصيدًا كافيًا. الدفعة خارج الوردية تُسجل في كشف المورد فقط.</p>
                </div>}
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">رقم المرجع</label>
                <input {...regPay("reference_number")} placeholder="اختياري" className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">ملاحظات</label>
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
  const confirmAction = useConfirmAction();
  const previous = readSectionSnapshot<{ suppliers: Supplier[] }>("suppliers-list");
  const [role, setRole] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => previous?.suppliers || []);
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
      if (!q) writeSectionSnapshot("suppliers-list", { suppliers: (res.data || []).map(supplierIdentity) });
    } catch (error) {
      notifyError(errorMessage(error, "تعذر تحميل الموردين"));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchApi("/auth/me").then(user => setRole(user.role)).catch(() => setRole(null));
    fetchApi("/suppliers?search=&limit=50")
      .then(res => {
        setSuppliers(res.data || []);
        writeSectionSnapshot("suppliers-list", { suppliers: (res.data || []).map(supplierIdentity) });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    if (!await confirmAction({ title: "حذف المورد؟", message: "سيُزال المورد من القائمة إذا سمحت حالته بالحذف.", confirmLabel: "حذف المورد", tone: "danger" })) return;
    try {
      await fetchApi(`/suppliers/${id}`, { method: "DELETE" });
      loadSuppliers();
    } catch (err: unknown) { notifyError(errorMessage(err, "فشل حذف المورد")); }
  };

  return (
    <div className="min-h-screen" dir="rtl">


      <main className="app-main">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="app-heading">الموردون</h1>
          <button onClick={() => setShowAddPanel(true)} className="app-primary-button">
            <span className="material-symbols-outlined text-[20px]">add</span>
            إضافة مورد
          </button>
        </div>

        {/* Table */}
        <div className="glass rounded-2xl overflow-hidden hi-fi-shadow">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-white/5">
                   <th className="px-4 py-3 text-sm font-bold text-[#e2bfb0]/80 text-right">المورد</th>
                   <th className="px-4 py-3 text-sm font-bold text-[#e2bfb0]/80 text-right">التواصل</th>
                   <th className="px-4 py-3 text-sm font-bold text-[#e2bfb0]/80 text-right">شروط الدفع</th>
                   <th className="px-4 py-3 text-sm font-bold text-[#e2bfb0]/80 text-center">العمليات</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [0, 1, 2, 3].map(index => <tr key={index} aria-hidden={index !== 0} className="border-b border-white/5"><td className="px-8 py-5"><span className="app-skeleton h-5 w-36" />{index === 0 && <span className="sr-only">جاري تحميل الموردين</span>}</td><td className="px-8 py-5"><span className="app-skeleton h-4 w-28" /></td><td className="px-8 py-5"><span className="app-skeleton h-5 w-20" /></td><td className="px-8 py-5"><span className="app-skeleton mx-auto h-8 w-20" /></td></tr>)
                ) : suppliers.length === 0 ? (
                  <tr><td colSpan={4} className="px-8 py-16 text-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-5xl block mb-3">local_shipping</span>
                    لا يوجد موردين مسجلين
                  </td></tr>
                ) : suppliers.map(s => (
                  <tr key={s.id} data-search-id={s.id} className="hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                           <strong className="text-sm text-white">{s.name}</strong>
                          {s.tax_number && <p className="text-xs text-[#e2bfb0]/70">رقم ضريبي: {s.tax_number}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        {s.phone && <p className="text-[#e2bfb0]/80 text-xs">{s.phone}</p>}
                         {s.email && <p className="text-[#e2bfb0]/75 text-xs">{s.email}</p>}
                        {!s.phone && !s.email && <p className="text-on-surface-variant text-xs">-</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-3 py-1 bg-white/5 text-[#e2bfb0]/70 rounded-full text-xs font-bold border border-white/10">
                        {s.payment_terms_days === "COD" ? "نقداً عند الاستلام" : s.payment_terms_days ? `${s.payment_terms_days} يوم` : "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => openSupplier(s.id, role === "ADMIN" ? "statement" : "info")} className="app-secondary-button text-xs">{role === "ADMIN" ? "كشف الحساب" : "التفاصيل"}</button>
                        {role === "ADMIN" && <button onClick={() => openSupplier(s.id, "debt")} className="app-secondary-button text-xs">مديونية</button>}
                        <button onClick={() => handleDelete(s.id)} className="w-9 h-9 rounded-full glass flex items-center justify-center text-on-surface-variant hover:text-[#ffb4ab] transition-all" title="حذف">
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
