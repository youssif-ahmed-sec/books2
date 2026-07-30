import React, { useState, useEffect } from 'react';
import { useProductStore, Product, ProductUnit, ProductPrice, PriceLevelEnum } from '@/store/useProductStore';
import { Loader2 } from 'lucide-react';

export default function ProductFormModal() {
  const { isProductModalOpen, closeProductModal, selectedProduct, saveProduct, categories, fetchCategories, isLoading } = useProductStore();

  const [formData, setFormData] = useState<Partial<Product>>({
    sku: '',
    barcode: '',
    name_en: '',
    name_ar: '',
    category_id: '',
    base_unit: 'Piece',
    cost: 0,
    tax_rate: 0,
    min_stock_level: 0,
    units: [],
  });

  useEffect(() => {
    if (isProductModalOpen) {
      if (categories.length === 0) fetchCategories();
      if (selectedProduct) {
        setFormData({
          ...selectedProduct,
          category_id: selectedProduct.category_id || '',
        });
      } else {
        setFormData({
          sku: '',
          barcode: '',
          name_en: '',
          name_ar: '',
          category_id: '',
          base_unit: 'Piece',
          cost: 0,
          tax_rate: 0,
          min_stock_level: 0,
          units: [],
        });
      }
    }
  }, [isProductModalOpen, selectedProduct, categories.length, fetchCategories]);

  if (!isProductModalOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
  };

  const handleSave = async () => {
    await saveProduct(formData as Product);
  };

  return (
    <>
      {/* Background Dimmer Overlay */}
      <div 
        className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm transition-opacity duration-500"
        onClick={closeProductModal}
      />

      {/* Advanced Add Product Slide-over */}
      <aside className="fixed top-0 bottom-0 left-0 w-full max-w-[850px] bg-surface-container-lowest z-[60] shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col animate-slide-in border-r border-white/10" dir="rtl">
        {/* Header */}
        <header className="px-xl py-lg flex justify-between items-center border-b border-white/5 bg-surface-container-lowest/50 backdrop-blur-md sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2 text-primary-container mb-2">
              <span className="material-symbols-outlined text-xl">add_box</span>
              <span className="text-label-sm font-bold tracking-widest uppercase">نظام إدارة المخزون المركزي</span>
            </div>
            <h2 className="font-display-lg text-4xl text-on-surface leading-tight">
              {selectedProduct ? 'تعديل المنتج التفصيلي' : 'إضافة منتج متقدم'}
            </h2>
            <p className="text-on-surface-variant text-sm mt-1">
              {selectedProduct ? 'تحديث تفاصيل المنتج لضمان دقة التقارير' : 'أدخل تفاصيل المنتج بدقة لضمان دقة التقارير والتسعير التلقائي'}
            </p>
          </div>
          <button onClick={closeProductModal} className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-on-surface-variant transition-all group border border-white/5">
            <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">close</span>
          </button>
        </header>

        {/* Scrollable Form Area */}
        <div className="flex-1 overflow-y-auto px-xl py-xl space-y-16 custom-scrollbar">
          {/* SECTION 1: الأساسيات */}
          <section className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary-container/10 flex items-center justify-center text-primary-container">
                <span className="material-symbols-outlined">info</span>
              </div>
              <h3 className="font-headline-md text-2xl font-bold">المعلومات الأساسية</h3>
            </div>
            
            <div className="grid grid-cols-2 gap-x-8 gap-y-8">
              {/* Product Code */}
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">كود المنتج (تلقائي)</label>
                <div className="relative">
                  <input className="w-full bg-surface-container-lowest border border-white/5 rounded-full p-4 text-on-surface-variant cursor-not-allowed inner-glow font-mono opacity-50" disabled type="text" value={formData.sku || 'INV-2026-X88'} />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined text-white/20 text-xl flex items-center">lock</span>
                </div>
              </div>
              {/* Barcode */}
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">الباركود الدولي</label>
                <div className="relative">
                  <input name="barcode" value={formData.barcode || ''} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange inner-glow transition-all" placeholder="6220000000000" type="text" />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined text-primary-container/40 flex">barcode_scanner</span>
                </div>
              </div>
              {/* Arabic Name */}
              <div className="col-span-2 space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">اسم المنتج باللغة العربية</label>
                <input name="name_ar" value={formData.name_ar || ''} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-lg font-bold text-on-surface focus-orange inner-glow transition-all" placeholder="مثال: كتاب الفيزياء الحديثة - الطبعة السادسة" type="text" />
              </div>
              {/* English Name */}
              <div className="col-span-2 space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">اسم المنتج باللغة الإنجليزية</label>
                <input name="name_en" value={formData.name_en || ''} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange inner-glow font-sans transition-all" dir="ltr" placeholder="Modern Physics - 6th Edition" type="text" />
              </div>
              {/* Category */}
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">التصنيف</label>
                <div className="relative">
                  <select name="category_id" value={formData.category_id || ''} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-on-surface focus-orange appearance-none inner-glow transition-all">
                    <option value="">اختر التصنيف</option>
                    {categories.map(c => <option key={c.id} value={c.id} className="bg-[#1e1e1e]">{c.name_ar}</option>)}
                  </select>
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none opacity-40 flex items-center">expand_more</span>
                </div>
              </div>
              {/* Status */}
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">حالة المنتج</label>
                <div className="flex items-center gap-4 bg-surface-container border border-white/5 rounded-full p-4 inner-glow transition-all">
                  <div className="relative inline-flex items-center cursor-pointer group">
                    <input type="checkbox" className="sr-only peer" defaultChecked={true} />
                    <div className="w-12 h-6 bg-white/10 rounded-full peer peer-checked:bg-primary-container transition-all duration-300 after:content-[''] after:absolute after:top-[4px] after:right-[4px] after:bg-white/40 peer-checked:after:bg-on-primary after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:-translate-x-6"></div>
                  </div>
                  <span className="text-on-surface font-bold text-sm">نشط</span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">وصف تفصيلي</label>
              <textarea className="w-full bg-surface-container border border-white/5 rounded-xl p-5 text-on-surface focus-orange inner-glow min-h-[120px] transition-all" placeholder="أدخل هنا مواصفات المنتج، المؤلف، أو أي تفاصيل فنية..."></textarea>
            </div>

            {/* Image Upload */}
            <div className="space-y-2">
              <label className="text-on-surface-variant text-sm font-semibold px-1">صورة المنتج التعريفية</label>
              <div className="border-2 border-dashed border-white/10 rounded-xl p-10 flex flex-col items-center justify-center gap-4 bg-white/[0.01] hover:bg-white/[0.03] transition-all cursor-pointer group hover:border-primary-container/40">
                <div className="w-16 h-16 rounded-full bg-primary-container/10 flex items-center justify-center text-primary-container group-hover:scale-110 transition-transform">
                  <span className="material-symbols-outlined text-3xl">upload_file</span>
                </div>
                <div className="text-center">
                  <p className="text-on-surface font-bold">اسحب الصورة هنا أو اضغط للاختيار</p>
                  <p className="text-on-surface-variant text-xs mt-1">JPG, PNG (بحد أقصى 5 ميجابايت)</p>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: الوحدات والتخزين */}
          <section className="space-y-8 pt-8 border-t border-white/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary-container/10 flex items-center justify-center text-primary-container">
                  <span className="material-symbols-outlined">layers</span>
                </div>
                <h3 className="font-headline-md text-2xl font-bold">إدارة الوحدات والمخزون</h3>
              </div>
              <button className="flex items-center gap-2 text-primary-container font-bold text-sm bg-primary-container/10 px-6 py-3 rounded-full hover:bg-primary-container/20 transition-all border border-primary-container/20">
                <span className="material-symbols-outlined text-lg font-bold">add</span>
                إضافة وحدة جديدة
              </button>
            </div>

            <div className="bg-surface-container-low rounded-xl border border-white/5 overflow-hidden">
              <table className="w-full text-right">
                <thead>
                  <tr className="bg-white/5">
                    <th className="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-wider">نوع الوحدة</th>
                    <th className="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-wider">عامل التحويل</th>
                    <th className="px-6 py-4 text-xs font-bold text-on-surface-variant uppercase tracking-wider text-center">الافتراضي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-bold text-on-surface">{formData.base_unit || 'قطعة'}</span>
                      <span className="text-xs text-on-surface-variant mr-2 opacity-60">(الوحدة الأساسية)</span>
                    </td>
                    <td className="px-6 py-4 text-on-surface-variant font-mono">1.0</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center">
                        <div className="w-10 h-6 bg-primary-container rounded-full relative flex items-center justify-end px-1 cursor-pointer">
                          <div className="w-4 h-4 bg-on-primary rounded-full"></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* SECTION 3: مستويات */}
          <section className="space-y-8 pt-8 border-t border-white/5 pb-12">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary-container/10 flex items-center justify-center text-primary-container">
                <span className="material-symbols-outlined">payments</span>
              </div>
              <h3 className="font-headline-md text-2xl font-bold">هيكل التسعير (ج.م)</h3>
            </div>

            <div className="grid grid-cols-2 gap-8 bg-primary-container/[0.03] p-8 rounded-xl border border-primary-container/10">
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">سعر الشراء (للوحدة الأساسية)</label>
                <div className="relative">
                  <input name="cost" value={formData.cost || 0} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-5 text-2xl font-bold text-primary-container focus-orange inner-glow transition-all" type="number" />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">ج.م</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-on-surface-variant text-sm font-semibold px-1">نسبة ضريبة القيمة المضافة</label>
                <div className="relative">
                  <input name="tax_rate" value={formData.tax_rate || 0} onChange={handleChange} className="w-full bg-surface-container border border-white/5 rounded-full p-5 text-2xl font-bold text-on-surface focus-orange inner-glow transition-all" type="number" />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">%</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Footer Actions */}
        <footer className="p-xl bg-surface-container-lowest/80 backdrop-blur-xl border-t border-white/5 flex items-center gap-6 sticky bottom-0 z-10">
          <button onClick={handleSave} disabled={isLoading} className="flex-[2] bg-primary-container text-on-primary-container font-display-lg text-lg py-5 rounded-full shadow-[0_12px_24px_rgba(255,107,0,0.2)] hover:shadow-[0_12px_32px_rgba(255,107,0,0.3)] hover:-translate-y-1 active:translate-y-0 active:scale-[0.99] transition-all flex items-center justify-center gap-3 disabled:opacity-50">
            {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <span className="material-symbols-outlined font-bold">check_circle</span>}
            {selectedProduct ? 'تحديث بيانات المنتج' : 'حفظ وإدراج في المخزون'}
          </button>
          <button onClick={closeProductModal} className="flex-1 py-5 rounded-full border border-white/10 font-bold text-on-surface-variant hover:bg-white/5 active:scale-[0.98] transition-all">
            إلغاء الأمر
          </button>
        </footer>
      </aside>
    </>
  );
}
