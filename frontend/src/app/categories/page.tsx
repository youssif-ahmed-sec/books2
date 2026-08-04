"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";

// ─── Schemas ──────────────────────────────────────────────────────────────────
const categorySchema = z.object({
  name_ar: z.string().min(2, "الاسم العربي مطلوب"),
  name_en: z.string().min(2, "الاسم الإنجليزي مطلوب"),
});

const subcategorySchema = z.object({
  name_ar: z.string().min(2, "الاسم العربي مطلوب"),
  name_en: z.string().min(2, "الاسم الإنجليزي مطلوب"),
  category_id: z.string().min(1, "التصنيف الرئيسي مطلوب"),
});

type CategoryFormValues = z.infer<typeof categorySchema>;
type SubcategoryFormValues = z.infer<typeof subcategorySchema>;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Category {
  id: string;
  name_ar: string;
  name_en: string;
}

interface Subcategory {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string;
}

// ─── Category Modal ───────────────────────────────────────────────────────────
function CategoryModal({
  mode, existing, onClose, onSuccess
}: {
  mode: "add" | "edit";
  existing?: Category;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name_ar: existing?.name_ar || "", name_en: existing?.name_en || "" },
  });

  useEffect(() => { setMounted(true); }, []);

  const onSubmit = async (data: CategoryFormValues) => {
    try {
      if (mode === "add") {
        await fetchApi("/products/categories", { method: "POST", body: JSON.stringify(data) });
      } else {
        await fetchApi(`/products/categories/${existing!.id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      onSuccess();
      onClose();
    } catch (err: any) { alert(err.message); }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-[#1c1b1b] border border-white/10 rounded-3xl p-8 max-w-md w-full relative">
        <button onClick={onClose} className="absolute top-4 left-4 text-[#e2bfb0]/40 hover:text-white">
          <span className="material-symbols-outlined">close</span>
        </button>
        <h3 className="text-xl font-bold text-white mb-6">{mode === "add" ? "إضافة تصنيف رئيسي" : "تعديل التصنيف"}</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الاسم العربي *</label>
            <input {...register("name_ar")} placeholder="مثال: كتب دراسية" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name_ar ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
            {errors.name_ar && <p className="text-red-400 text-xs mt-1">{errors.name_ar.message}</p>}
          </div>
          <div>
            <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الاسم الإنجليزي *</label>
            <input {...register("name_en")} placeholder="e.g. Academic Books" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name_en ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
            {errors.name_en && <p className="text-red-400 text-xs mt-1">{errors.name_en.message}</p>}
          </div>
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={onClose} className="flex-1 glass border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/5 transition-all">إلغاء</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 bg-primary text-white font-bold py-3 rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50">
              {isSubmitting ? "جاري الحفظ..." : "حفظ"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── Subcategory Modal ────────────────────────────────────────────────────────
function SubcategoryModal({
  mode, existing, categories, defaultCategoryId, onClose, onSuccess
}: {
  mode: "add" | "edit";
  existing?: Subcategory;
  categories: Category[];
  defaultCategoryId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<SubcategoryFormValues>({
    resolver: zodResolver(subcategorySchema),
    defaultValues: {
      name_ar: existing?.name_ar || "",
      name_en: existing?.name_en || "",
      category_id: existing?.category_id || defaultCategoryId || "",
    },
  });

  useEffect(() => { setMounted(true); }, []);

  const onSubmit = async (data: SubcategoryFormValues) => {
    try {
      if (mode === "add") {
        await fetchApi("/products/subcategories", { method: "POST", body: JSON.stringify(data) });
      } else {
        await fetchApi(`/products/subcategories/${existing!.id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      onSuccess();
      onClose();
    } catch (err: any) { alert(err.message); }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-[#1c1b1b] border border-white/10 rounded-3xl p-8 max-w-md w-full relative">
        <button onClick={onClose} className="absolute top-4 left-4 text-[#e2bfb0]/40 hover:text-white">
          <span className="material-symbols-outlined">close</span>
        </button>
        <h3 className="text-xl font-bold text-white mb-6">{mode === "add" ? "إضافة تصنيف فرعي" : "تعديل التصنيف الفرعي"}</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-[#e2bfb0]/60 mb-1 block">التصنيف الرئيسي *</label>
            <select {...register("category_id")} className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-[#1c1b1b] border ${errors.category_id ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`}>
              <option value="">اختر تصنيف رئيسي</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name_ar}</option>)}
            </select>
            {errors.category_id && <p className="text-red-400 text-xs mt-1">{errors.category_id.message}</p>}
          </div>
          <div>
            <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الاسم العربي *</label>
            <input {...register("name_ar")} placeholder="مثال: رياضيات" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name_ar ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
            {errors.name_ar && <p className="text-red-400 text-xs mt-1">{errors.name_ar.message}</p>}
          </div>
          <div>
            <label className="text-xs text-[#e2bfb0]/60 mb-1 block">الاسم الإنجليزي *</label>
            <input {...register("name_en")} placeholder="e.g. Mathematics" className={`w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border ${errors.name_en ? "border-red-500/50" : "border-white/10"} focus:outline-none focus:border-primary/50`} />
            {errors.name_en && <p className="text-red-400 text-xs mt-1">{errors.name_en.message}</p>}
          </div>
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={onClose} className="flex-1 glass border border-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/5 transition-all">إلغاء</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 bg-primary text-white font-bold py-3 rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50">
              {isSubmitting ? "جاري الحفظ..." : "حفظ"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Modal state
  const [catModal, setCatModal] = useState<{ mode: "add" | "edit"; existing?: Category } | null>(null);
  const [subModal, setSubModal] = useState<{ mode: "add" | "edit"; existing?: Subcategory; defaultCatId?: string } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cats, subs] = await Promise.all([
        fetchApi("/products/categories"),
        fetchApi("/products/subcategories"),
      ]);
      setCategories(cats);
      setSubcategories(subs);
      // Auto-expand all categories
      setExpandedCats(new Set(cats.map((c: Category) => c.id)));
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const toggleExpand = (id: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("حذف هذا التصنيف سيؤثر على المنتجات المرتبطة به. هل تريد المتابعة؟")) return;
    try {
      await fetchApi(`/products/categories/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err: any) { alert(err.message); }
  };

  const deleteSubcategory = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذا التصنيف الفرعي؟")) return;
    try {
      await fetchApi(`/products/subcategories/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err: any) { alert(err.message); }
  };

  const getSubsForCategory = (catId: string) => subcategories.filter(s => s.category_id === catId);

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="إدارة التصنيفات" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">إدارة التصنيفات</h1>
            <p className="text-[#e2bfb0]/60 mt-1 text-sm">شجرة تصنيفات المنتجات والفئات الفرعية</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setCatModal({ mode: "add" })} className="flex items-center gap-2 glass border border-white/10 text-white font-bold px-5 py-3 rounded-full hover:bg-white/5 transition-all">
              <span className="material-symbols-outlined text-[18px]">add</span>
              تصنيف رئيسي
            </button>
            <button onClick={() => setSubModal({ mode: "add" })} className="flex items-center gap-2 bg-primary text-white font-bold px-5 py-3 rounded-full hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined text-[18px]">add</span>
              تصنيف فرعي
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary">category</span>
              </div>
              <div>
                <p className="text-[#e2bfb0]/60 text-xs">التصنيفات الرئيسية</p>
                <p className="text-2xl font-bold text-primary">{categories.length}</p>
              </div>
            </div>
          </div>
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-[#e2bfb0]/60">subdirectory_arrow_right</span>
              </div>
              <div>
                <p className="text-[#e2bfb0]/60 text-xs">التصنيفات الفرعية</p>
                <p className="text-2xl font-bold text-white">{subcategories.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tree */}
        {loading ? (
          <div className="glass rounded-2xl p-16 text-center text-[#e2bfb0]/40">
            <span className="material-symbols-outlined text-4xl animate-spin block mb-2">progress_activity</span>
            جاري التحميل...
          </div>
        ) : categories.length === 0 ? (
          <div className="glass rounded-2xl p-16 text-center text-[#e2bfb0]/40">
            <span className="material-symbols-outlined text-6xl block mb-4">category</span>
            <p className="font-bold mb-2">لا توجد تصنيفات بعد</p>
            <p className="text-sm">ابدأ بإضافة تصنيف رئيسي لتنظيم منتجاتك</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {categories.map(cat => {
              const subs = getSubsForCategory(cat.id);
              const isExpanded = expandedCats.has(cat.id);
              return (
                <div key={cat.id} className="glass rounded-2xl overflow-hidden hi-fi-shadow">
                  {/* Category Row */}
                  <div className="flex items-center justify-between p-6 border-b border-white/5">
                    <div className="flex items-center gap-4">
                      <button onClick={() => toggleExpand(cat.id)} className="w-8 h-8 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white transition-all">
                        <span className="material-symbols-outlined text-[18px]" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}>
                          chevron_right
                        </span>
                      </button>
                      <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-primary text-[18px]">folder</span>
                      </div>
                      <div>
                        <p className="font-bold text-white">{cat.name_ar}</p>
                        <p className="text-xs text-[#e2bfb0]/50">{cat.name_en} · {subs.length} تصنيف فرعي</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSubModal({ mode: "add", defaultCatId: cat.id })} className="flex items-center gap-1 px-3 py-1.5 glass rounded-full text-[10px] font-bold text-[#e2bfb0]/60 hover:text-primary transition-all border border-white/5 hover:border-primary/30">
                        <span className="material-symbols-outlined text-[14px]">add</span>
                        فرعي
                      </button>
                      <button onClick={() => setCatModal({ mode: "edit", existing: cat })} className="w-8 h-8 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary transition-all">
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button onClick={() => deleteCategory(cat.id)} className="w-8 h-8 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-[#ffb4ab] transition-all">
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Subcategories */}
                  {isExpanded && (
                    <div className="bg-white/2">
                      {subs.length === 0 ? (
                        <div className="px-8 py-5 text-xs text-[#e2bfb0]/30 flex items-center gap-2">
                          <span className="material-symbols-outlined text-[14px]">subdirectory_arrow_right</span>
                          لا توجد تصنيفات فرعية — اضغط "فرعي" لإضافة واحدة
                        </div>
                      ) : subs.map((sub, idx) => (
                        <div key={sub.id} className={`flex items-center justify-between px-8 py-4 ${idx < subs.length - 1 ? "border-b border-white/5" : ""}`}>
                          <div className="flex items-center gap-4">
                            <div className="w-5 flex justify-center">
                              <div className="w-px h-4 bg-white/10" />
                            </div>
                            <span className="material-symbols-outlined text-[#e2bfb0]/30 text-[14px]">subdirectory_arrow_right</span>
                            <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center">
                              <span className="material-symbols-outlined text-[#e2bfb0]/40 text-[14px]">folder_open</span>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-[#e2bfb0]/90">{sub.name_ar}</p>
                              <p className="text-[10px] text-[#e2bfb0]/40">{sub.name_en}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setSubModal({ mode: "edit", existing: sub })} className="w-7 h-7 rounded-full glass flex items-center justify-center text-[#e2bfb0]/50 hover:text-primary transition-all">
                              <span className="material-symbols-outlined text-[14px]">edit</span>
                            </button>
                            <button onClick={() => deleteSubcategory(sub.id)} className="w-7 h-7 rounded-full glass flex items-center justify-center text-[#e2bfb0]/50 hover:text-[#ffb4ab] transition-all">
                              <span className="material-symbols-outlined text-[14px]">delete</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Category Modal */}
      {catModal && (
        <CategoryModal
          mode={catModal.mode}
          existing={catModal.existing}
          onClose={() => setCatModal(null)}
          onSuccess={loadAll}
        />
      )}

      {/* Subcategory Modal */}
      {subModal && (
        <SubcategoryModal
          mode={subModal.mode}
          existing={subModal.existing}
          categories={categories}
          defaultCategoryId={subModal.defaultCatId}
          onClose={() => setSubModal(null)}
          onSuccess={loadAll}
        />
      )}
    </div>
  );
}
