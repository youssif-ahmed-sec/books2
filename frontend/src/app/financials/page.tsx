"use client";

import { notifyError } from "@/lib/notifications";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LoadingTableRows } from "@/components/LoadingState";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import AdminGate from "@/components/AdminGate";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  category: z.string().min(2, "التصنيف مطلوب"), // or 'source' for income
  amount: z.coerce.number().min(0.01, "يجب أن يكون المبلغ أكبر من 0"),
  description: z.string().optional(),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;
type TransactionFormInput = z.input<typeof transactionSchema>;
interface Expense { id: string; expense_date: string; category: string; description?: string; amount: number }
interface Income { id: string; income_date: string; source: string; description?: string; amount: number }

export default function FinancialsPage() {
  return <AdminGate><FinancialsContent /></AdminGate>;
}

function FinancialsContent() {
  const [expenses, setExpenses] = useState<Expense[]>(() => readSectionSnapshot<{ expenses: Expense[] }>("financials")?.expenses || []);
  const [incomes, setIncomes] = useState<Income[]>(() => readSectionSnapshot<{ incomes: Income[] }>("financials")?.incomes || []);
  const [loading, setLoading] = useState(() => !readSectionSnapshot("financials"));
  const [loadError, setLoadError] = useState(false);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");
  useSectionSearchSelection(id => setActiveTab(incomes.some(item => item.id === id) ? "income" : "expense"));
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("focus");
    if (!id || !incomes.some(item => item.id === id)) return;
    const timer = window.setTimeout(() => setActiveTab("income"), 0);
    return () => window.clearTimeout(timer);
  }, [incomes]);

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<TransactionFormInput, unknown, TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: { type: "expense" }
  });

  const watchType = useWatch({ control, name: "type" });

  const loadData = async () => {
    try {
      const [expData, incData] = await Promise.all([
        fetchApi("/financials/expenses"),
        fetchApi("/financials/incomes")
      ]);
      setExpenses(expData);
      setIncomes(incData);
      setLoadError(false);
      writeSectionSnapshot("financials", { expenses: expData, incomes: incData });
    } catch (err) {
      console.error("Failed to load financials:", err);
      setLoadError(true);
    }
  };

  useEffect(() => {
    Promise.all([fetchApi("/financials/expenses"), fetchApi("/financials/incomes")])
      .then(([expData, incData]) => {
        setExpenses(expData);
        setIncomes(incData);
        setLoadError(false);
        writeSectionSnapshot("financials", { expenses: expData, incomes: incData });
      })
      .catch(err => { console.error("Failed to load financials:", err); setLoadError(true); })
      .finally(() => setLoading(false));
  }, []);

  const openAdd = (type: "expense" | "income") => {
    reset({
      type,
      category: "",
      amount: 0,
      description: ""
    });
    setIsSlideoverOpen(true);
  };

  const onSubmit = async (data: TransactionFormValues) => {
    try {
      if (data.type === "expense") {
        await fetchApi("/financials/expenses", {
          method: "POST",
          body: JSON.stringify({
            category: data.category,
            amount: data.amount,
            description: data.description
          }),
        });
      } else {
        await fetchApi("/financials/incomes", {
          method: "POST",
          body: JSON.stringify({
            source: data.category, // schema uses category for both in UI
            amount: data.amount,
            description: data.description
          }),
        });
      }
      await loadData();
      setIsSlideoverOpen(false);
    } catch (err) {
      console.error("Failed to save transaction:", err);
      notifyError("حدث خطأ أثناء الحفظ");
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">


      <main className="app-main">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="app-heading">المالية</h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openAdd("expense")}
                className="app-secondary-button"
              >
                + إضافة مصروف
              </button>
              <button
                onClick={() => openAdd("income")}
                className="app-primary-button"
              >
                + إضافة إيراد
              </button>
            </div>
          </div>

      <div className="flex gap-4 border-b border-white/10">
        <button
          onClick={() => setActiveTab("expense")}
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "expense" ? "border-primary text-primary" : "border-transparent app-muted hover:text-white"
          }`}
        >
          المصروفات
        </button>
        <button
          onClick={() => setActiveTab("income")}
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "income" ? "border-primary text-primary" : "border-transparent app-muted hover:text-white"
          }`}
        >
          الإيرادات
        </button>
      </div>

      {loadError && <p role="alert" className="app-panel rounded-xl border-red-500/30 p-4 text-sm text-red-300">تعذر تحديث الحركات المالية. حاول تحديث الصفحة.</p>}
      <div className="app-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">{activeTab === "expense" ? "التصنيف" : "المصدر"}</th>
                <th className="px-4 py-3 font-medium">الوصف</th>
                <th className="px-4 py-3 font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody className="text-[#e5e2e1]">
              {loading && <LoadingTableRows label="جاري تحميل الحركات المالية" columns={4} />}
              {!loading && activeTab === "expense" && expenses.map((e) => (
                <tr key={e.id} data-search-id={e.id} className="app-table-row">
                  <td className="px-4 py-3" dir="ltr">{new Date(e.expense_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-white">{e.category}</td>
                  <td className="px-4 py-3">{e.description || "-"}</td>
                  <td className="px-4 py-3 text-[#ffb4ab] font-bold">{Number(e.amount).toFixed(2)} ج.م</td>
                </tr>
              ))}
              {!loading && activeTab === "income" && incomes.map((i) => (
                <tr key={i.id} data-search-id={i.id} className="app-table-row">
                  <td className="px-4 py-3" dir="ltr">{new Date(i.income_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-white">{i.source}</td>
                  <td className="px-4 py-3">{i.description || "-"}</td>
                  <td className="px-4 py-3 text-primary font-bold">{Number(i.amount).toFixed(2)} ج.م</td>
                </tr>
              ))}

              {!loading && !loadError && activeTab === "expense" && expenses.length === 0 && (
                <tr>
                  <td colSpan={4} className="app-muted px-4 py-8 text-center">لا توجد مصروفات</td>
                </tr>
              )}
              {!loading && !loadError && activeTab === "income" && incomes.length === 0 && (
                <tr>
                  <td colSpan={4} className="app-muted px-4 py-8 text-center">لا توجد إيرادات</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isSlideoverOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSlideoverOpen(false)}></div>
          <div className="relative w-full max-w-md bg-surface-container-low h-full shadow-2xl border-r border-white/10 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">
                {watchType === "expense" ? "إضافة مصروف" : "إضافة إيراد"}
              </h2>
              <button type="button" aria-label="إغلاق" onClick={() => setIsSlideoverOpen(false)} className="app-muted hover:text-white transition-colors">✕</button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-4">
              <input type="hidden" {...register("type")} />

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">
                  {watchType === "expense" ? "تصنيف المصروف" : "مصدر الإيراد"} <span className="text-red-500">*</span>
                </label>
                <input {...register("category")} className="app-field" />
                {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">المبلغ <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" {...register("amount")} className="app-field" />
                {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">الوصف</label>
                <textarea {...register("description")} className="app-field" rows={3}></textarea>
              </div>

              <div className="pt-4 border-t border-white/10 mt-6">
                <button type="submit" disabled={isSubmitting} className="app-primary-button w-full">
                  {isSubmitting ? "جاري الحفظ..." : "حفظ"}
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
