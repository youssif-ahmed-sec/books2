"use client";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";

const transactionSchema = z.object({
  type: z.enum(["expense", "income"]),
  category: z.string().min(2, "التصنيف مطلوب"), // or 'source' for income
  amount: z.coerce.number().min(0.01, "يجب أن يكون المبلغ أكبر من 0"),
  description: z.string().optional(),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;

export default function FinancialsPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [incomes, setIncomes] = useState<any[]>([]);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<TransactionFormValues>({
    // @ts-ignore
    resolver: zodResolver(transactionSchema),
    defaultValues: { type: "expense" }
  });

  const watchType = watch("type");

  const loadData = async () => {
    try {
      const [expData, incData] = await Promise.all([
        fetchApi("/financials/expenses"),
        fetchApi("/financials/incomes")
      ]);
      setExpenses(expData);
      setIncomes(incData);
    } catch (err) {
      console.error("Failed to load financials:", err);
    }
  };

  useEffect(() => {
    loadData();
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

  const onSubmit = async (data: any) => {
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
      alert("حدث خطأ أثناء الحفظ");
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="المالية" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">المالية (Financials)</h1>
              <p className="text-sm text-zinc-400 mt-1">إدارة المصروفات والإيرادات الأخرى</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => openAdd("expense")}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + إضافة مصروف
              </button>
              <button
                onClick={() => openAdd("income")}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                + إضافة إيراد
              </button>
            </div>
          </div>

      <div className="flex space-x-4 border-b border-zinc-800 rtl:space-x-reverse">
        <button
          onClick={() => setActiveTab("expense")}
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "expense" ? "border-red-500 text-red-400" : "border-transparent text-zinc-400 hover:text-zinc-300"
          }`}
        >
          المصروفات
        </button>
        <button
          onClick={() => setActiveTab("income")}
          className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "income" ? "border-emerald-500 text-emerald-400" : "border-transparent text-zinc-400 hover:text-zinc-300"
          }`}
        >
          الإيرادات
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-zinc-800/50 border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">{activeTab === "expense" ? "التصنيف" : "المصدر"}</th>
                <th className="px-4 py-3 font-medium">الوصف</th>
                <th className="px-4 py-3 font-medium">المبلغ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {activeTab === "expense" && expenses.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3" dir="ltr">{new Date(e.expense_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-white">{e.category}</td>
                  <td className="px-4 py-3">{e.description || "-"}</td>
                  <td className="px-4 py-3 text-red-400 font-bold">{e.amount} ر.س</td>
                </tr>
              ))}
              {activeTab === "income" && incomes.map((i) => (
                <tr key={i.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3" dir="ltr">{new Date(i.income_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-white">{i.source}</td>
                  <td className="px-4 py-3">{i.description || "-"}</td>
                  <td className="px-4 py-3 text-emerald-400 font-bold">{i.amount} ر.س</td>
                </tr>
              ))}
              
              {activeTab === "expense" && expenses.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">لا يوجد مصروفات</td>
                </tr>
              )}
              {activeTab === "income" && incomes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">لا يوجد إيرادات</td>
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
              <h2 className="text-xl font-bold text-white">
                {watchType === "expense" ? "إضافة مصروف" : "إضافة إيراد"}
              </h2>
              <button onClick={() => setIsSlideoverOpen(false)} className="text-zinc-400 hover:text-white transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-4">
              <input type="hidden" {...register("type")} />

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  {watchType === "expense" ? "تصنيف المصروف" : "مصدر الإيراد"} <span className="text-red-500">*</span>
                </label>
                <input {...register("category")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
                {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">المبلغ <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" {...register("amount")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" />
                {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">الوصف</label>
                <textarea {...register("description")} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500" rows={3}></textarea>
              </div>

              <div className="pt-4 border-t border-zinc-800 mt-6">
                <button type="submit" disabled={isSubmitting} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-lg transition-colors">
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
