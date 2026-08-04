"use client";

import React, { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";

export default function BrandsManagement() {
  const [brands, setBrands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadBrands();
  }, []);

  const loadBrands = async () => {
    setLoading(true);
    try {
      const data = await fetchApi("/products/brands");
      setBrands(data);
    } catch (err) {
      console.error("Failed to load brands:", err);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingBrand(null);
    setNameAr("");
    setNameEn("");
    setError("");
    setShowForm(true);
  };

  const openEdit = (b: any) => {
    setEditingBrand(b);
    setNameAr(b.name_ar);
    setNameEn(b.name_en);
    setError("");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim() || !nameEn.trim()) {
      setError("يرجى إدخال الاسم باللغتين العربية والإنجليزية");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (editingBrand) {
        await fetchApi(`/products/brands/${editingBrand.id}`, {
          method: "PUT",
          body: JSON.stringify({ name_ar: nameAr, name_en: nameEn }),
        });
      } else {
        await fetchApi("/products/brands", {
          method: "POST",
          body: JSON.stringify({ name_ar: nameAr, name_en: nameEn }),
        });
      }
      closeForm();
      loadBrands();
    } catch (err: any) {
      setError(err.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه العلامة التجارية؟")) return;
    try {
      await fetchApi(`/products/brands/${id}`, {
        method: "DELETE",
      });
      loadBrands();
    } catch (err) {
      console.error("Failed to delete brand:", err);
      alert("تعذر الحذف، ربما تكون مرتبطة بمنتجات موجودة.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#1c1b1b] border border-white/5 flex items-center justify-center text-primary">
            <span className="material-symbols-outlined text-xl">branding_watermark</span>
          </div>
          <h2 className="text-xl font-bold text-[#e5e2e1]">إدارة العلامات التجارية</h2>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-full hover:bg-primary/90 transition-all font-bold text-sm shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          علامة تجارية جديدة
        </button>
      </div>

      <div className="glass rounded-3xl hi-fi-shadow border border-white/5 overflow-hidden">
        <div className="w-full overflow-x-auto pb-4 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
          <table className="w-full text-right border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-[#1a1918]/50 border-b border-white/5">
                <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest w-[40%]">
                  الاسم (عربي)
                </th>
                <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest w-[40%]">
                  الاسم (إنجليزي)
                </th>
                <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest text-center w-[20%]">
                  إجراءات
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={3} className="text-center py-10 text-[#e2bfb0]/60 text-sm">
                    جاري التحميل...
                  </td>
                </tr>
              ) : brands.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-10 text-[#e2bfb0]/60 text-sm">
                    لا يوجد علامات تجارية مضافة حتى الآن
                  </td>
                </tr>
              ) : (
                brands.map((b) => (
                  <tr key={b.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-8 py-5">
                      <p className="font-bold text-white text-sm">{b.name_ar}</p>
                    </td>
                    <td className="px-8 py-5">
                      <p className="text-sm text-[#e2bfb0]/80" dir="ltr" style={{ textAlign: "right" }}>{b.name_en}</p>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(b)}
                          className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary transition-all border border-white/5"
                          title="تعديل"
                        >
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(b.id)}
                          className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-[#ffb4ab] transition-all border border-white/5"
                          title="حذف"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inline Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeForm} />
          <div className="relative w-full max-w-md bg-[#1a1918] border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">
                  {editingBrand ? "edit" : "add_circle"}
                </span>
                {editingBrand ? "تعديل العلامة التجارية" : "إضافة علامة تجارية جديدة"}
              </h3>
              <button
                onClick={closeForm}
                className="w-8 h-8 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
              {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm text-center">{error}</div>}
              
              <div>
                <label className="text-xs font-bold text-[#e2bfb0]/60 uppercase tracking-widest mb-2 block">
                  الاسم بالعربية *
                </label>
                <input
                  type="text"
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: أكسفورد"
                  className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 transition-all"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#e2bfb0]/60 uppercase tracking-widest mb-2 block">
                  الاسم بالإنجليزية *
                </label>
                <input
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  placeholder="Example: Oxford"
                  dir="ltr"
                  className="w-full glass rounded-xl px-4 py-3 text-sm text-white bg-transparent border border-white/10 focus:outline-none focus:border-primary/50 transition-all text-left"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-5 py-2.5 rounded-full text-sm font-bold text-[#e2bfb0]/60 hover:text-white transition-all"
                  disabled={submitting}
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-full bg-primary text-white text-sm font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                >
                  {submitting ? "جاري الحفظ..." : "حفظ التغييرات"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
