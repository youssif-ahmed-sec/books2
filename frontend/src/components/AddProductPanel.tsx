"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { fetchApi } from "@/lib/api";
import { z } from "zod";

const unitSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "اسم الوحدة مطلوب"),
  conversionFactor: z.coerce.number().min(1, "يجب أن يكون عامل التحويل أكبر من 0"),
  sku: z.string().optional(),
  isDefault: z.boolean(),
  stock: z.coerce.number().min(0, "لا يمكن أن يكون المخزون بالسالب"),
  isBase: z.boolean(),
  retailPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  wholesalePrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  vipPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
});

const productFormSchema = z.object({
  nameAr: z.string().min(2, "اسم المنتج مطلوب"),
  nameEn: z.string().optional(),
  barcode: z.string().optional(),
  category_id: z.string().min(1, "التصنيف مطلوب"),
  supplier_id: z.string().optional().or(z.literal("")),
  subCategory_id: z.string().optional().or(z.literal("")),
  brand_id: z.string().optional().or(z.literal("")),
  active: z.boolean(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  costPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "السعر مطلوب"),
  vatRate: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الضريبة مطلوبة"),
  minStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأدنى مطلوب"),
  maxStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأقصى مطلوب"),
  units: z.array(unitSchema).min(1, "يجب إضافة وحدة واحدة على الأقل"),
});


interface ProductUnit {
  id: string;
  name: string;
  conversionFactor: number;
  sku: string;
  isDefault: boolean;
  stock: number;
  isBase: boolean;
  retailPrice: string;
  wholesalePrice: string;
  vipPrice: string;
}

interface GlobalUnit {
  id: string;
  name: string;
  conversion_factor: number;
}

interface AddProductPanelProps {
  onClose: () => void;
}



export function AddProductPanel({ onClose }: AddProductPanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({
    nameAr: "",
    nameEn: "",
    barcode: "",
    category_id: "",
    supplier_id: "",
    subCategory_id: "",
    brand_id: "",
    active: true,
    description: "",
    imageUrl: "",
    costPrice: "0",
    vatRate: "0",
    minStockLevel: "0",
    maxStockLevel: "0",
  });
  
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [units, setUnits] = useState<ProductUnit[]>([
    { id: "1", name: "قطعة", conversionFactor: 1, sku: "", isDefault: true, stock: 0, isBase: true, retailPrice: "0", wholesalePrice: "0", vipPrice: "0" },
  ]);

  const [globalUnits, setGlobalUnits] = useState<GlobalUnit[]>([]);
  const [showNewUnitDialog, setShowNewUnitDialog] = useState(false);
  const [newGlobalUnit, setNewGlobalUnit] = useState({ name: "", conversion_factor: 1 });

  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [subcategoriesList, setSubcategoriesList] = useState<any[]>([]);
  const [brandsList, setBrandsList] = useState<any[]>([]);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);

  useEffect(() => {
    async function loadGlobalUnits() {
      try {
        const data = await fetchApi("/global-units");
        setGlobalUnits(data);
      } catch (err) {
        console.error("Failed to load global units:", err);
      }
    }
    async function loadDropdowns() {
      try {
        const [cats, subcats, brnds, supps] = await Promise.all([
          fetchApi("/products/categories"),
          fetchApi("/products/subcategories"),
          fetchApi("/products/brands"),
          fetchApi("/products/suppliers")
        ]);
        setCategoriesList(cats);
        setSubcategoriesList(subcats);
        setBrandsList(brnds);
        setSuppliersList(supps);
      } catch (err) {
        console.error("Failed to load dropdowns:", err);
      }
    }
    loadGlobalUnits();
    loadDropdowns();
  }, []);

  const addUnit = () => {
    setUnits([
      ...units,
      {
        id: Date.now().toString(),
        name: "",
        conversionFactor: 1,
        sku: "",
        isDefault: false,
        stock: 0,
        isBase: false,
        retailPrice: "0",
        wholesalePrice: "0",
        vipPrice: "0",
      },
    ]);
  };

  const updateUnit = (id: string, field: keyof ProductUnit, value: any) => {
    setUnits(prev => prev.map(u => u.id === id ? { ...u, [field]: value } : u));
  };

  const deleteUnit = (id: string) => {
    setUnits(units.filter(u => u.id !== id));
  };

  const setDefaultUnit = (id: string) => {
    setUnits(units.map(u => ({ ...u, isDefault: u.id === id })));
  };

  const handleCreateGlobalUnit = async () => {
    if (!newGlobalUnit.name.trim()) return;
    try {
      const created = await fetchApi("/global-units", {
        method: "POST",
        body: JSON.stringify(newGlobalUnit)
      });
      setGlobalUnits([...globalUnits, created]);
      setShowNewUnitDialog(false);
      setNewGlobalUnit({ name: "", conversion_factor: 1 });
      
      // Auto add this to the product units
      setUnits([
        ...units,
        {
          id: Date.now().toString(),
          name: created.name,
          conversionFactor: created.conversion_factor,
          sku: "",
          isDefault: false,
          stock: 0,
          isBase: false,
          retailPrice: "0",
          wholesalePrice: "0",
          vipPrice: "0",
        }
      ]);
    } catch (err) {
      console.error(err);
      alert("Failed to create global unit. It might already exist.");
    }
  };

  const totalBaseStock = units.reduce((acc, u) => acc + (u.stock * u.conversionFactor), 0);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
    let file: File | null = null;
    if ('dataTransfer' in e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        file = e.dataTransfer.files[0];
      }
    } else if ('target' in e && e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }
    
    if (!file) return;

    setIsUploadingImage(true);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = localStorage.getItem("access_token");
      
      const res = await fetch("/api/v1/upload/image", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData,
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Upload failed");
      }
      
      const data = await res.json();
      if (data.secure_url) {
        setForm({ ...form, imageUrl: data.secure_url });
      } else {
        throw new Error("Upload failed");
      }
    } catch (err) {
      console.error("Image upload failed:", err);
      alert("فشل رفع الصورة");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSave = async () => {
    try {
      const validationResult = productFormSchema.safeParse({
        ...form,
        units
      });

      if (!validationResult.success) {
        const fieldErrors = validationResult.error.issues.map((err: any) => {
           if (err.path[0] === 'units') {
             return `${err.path[err.path.length - 1]}_${units[err.path[1] as number]?.id}`;
           }
           return err.path[0].toString();
        });
        setErrors(fieldErrors);
        console.error("Validation Failed:", validationResult.error.issues);
        alert(`يرجى مراجعة الحقول التالية: ${fieldErrors.join(", ")}`);
        return;
      }
      setErrors([]);
      
      setIsSaving(true);
      
      const validData = validationResult.data;
      // Map form data to API schema
      const productData = {
        sku: "INV-" + new Date().getFullYear() + "-" + Math.floor(Math.random() * 10000).toString(),
        barcode: form.barcode,
        name_en: form.nameEn || form.nameAr,
        name_ar: form.nameAr,
        base_unit: units.find(u => u.isBase)?.name || "Piece",
        cost: parseFloat(form.costPrice) || 0,
        tax_rate: parseFloat(form.vatRate) || 0,
        min_stock_level: parseFloat(form.minStockLevel) || 0,
        max_stock_level: parseFloat(form.maxStockLevel) || 0,
        description: form.description,
        image_url: form.imageUrl,
        is_active: form.active,
        category_id: form.category_id && form.category_id !== "" ? form.category_id : null,
        subcategory_id: form.subCategory_id && form.subCategory_id !== "" ? form.subCategory_id : null,
        brand_id: form.brand_id && form.brand_id !== "" ? form.brand_id : null,
        supplier_id: form.supplier_id && form.supplier_id !== "" ? form.supplier_id : null,
        units: units.map(u => ({
          unit_name: u.name || "Unknown",
          conversion_factor: u.conversionFactor,
          barcode: u.sku,
          prices: [
            { price_level: "Retail", price: parseFloat(u.retailPrice) || 0 },
            { price_level: "Wholesale", price: parseFloat(u.wholesalePrice) || 0 },
            { price_level: "VIP", price: parseFloat(u.vipPrice) || 0 },
          ]
        })),
        initial_stock: units.reduce((acc, unit) => acc + (unit.stock * unit.conversionFactor), 0)
      };

      await fetchApi("/products", {
        method: "POST",
        body: JSON.stringify(productData),
      });

      // Close panel and trigger a refresh on the parent
      onClose();
      window.location.reload();
    } catch (err) {
      console.error("Failed to save product:", err);
      alert("Failed to save product");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <aside className="fixed top-0 bottom-0 left-0 w-full max-w-[850px] bg-[#0e0e0e] z-[70] shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col animate-slide-in-left border-r border-white/10">
        {/* Header */}
        <header className="px-16 py-12 flex justify-between items-center border-b border-white/5 bg-[#0e0e0e]/50 backdrop-blur-md sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2 text-primary mb-2">
              <span className="material-symbols-outlined text-xl">add_box</span>
              <span className="text-[11px] font-bold tracking-widest uppercase">نظام إدارة المخزون المركزي</span>
            </div>
            <h2 className="text-4xl font-bold text-[#e5e2e1] leading-tight">إضافة منتج متقدم</h2>
            <p className="text-[#e2bfb0] text-sm mt-1">
              أدخل تفاصيل المنتج بدقة لضمان دقة التقارير والتسعير التلقائي
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-[#e2bfb0] transition-all group border border-white/5"
          >
            <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">close</span>
          </button>
        </header>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto px-16 py-16 space-y-16 custom-scrollbar">
          {/* Section 1: Basic Info */}
          <section className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">info</span>
              </div>
              <h3 className="text-2xl font-bold">المعلومات الأساسية</h3>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-12">
              {/* Auto Code */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">كود المنتج (تلقائي)</label>
                <div className="relative">
                  <input
                    disabled
                    value="INV-2026-X88"
                    className="w-full bg-[#0e0e0e] border border-white/5 rounded-full p-4 text-[#e2bfb0] cursor-not-allowed font-mono opacity-50"
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined text-white/20 text-xl">lock</span>
                </div>
              </div>

              {/* Barcode */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الباركود الدولي</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="6220000000000"
                    value={form.barcode}
                    onChange={(e) => {
                      setForm({ ...form, barcode: e.target.value });
                      if (errors.includes("barcode")) setErrors(errors.filter(err => err !== "barcode"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("barcode") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined text-primary/40">barcode_scanner</span>
                </div>
              </div>

              {/* Arabic Name */}
              <div className="col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">اسم المنتج باللغة العربية</label>
                <input
                  type="text"
                  placeholder="مثال: كتاب الفيزياء الحديثة - الطبعة السادسة"
                  value={form.nameAr}
                  onChange={(e) => {
                    setForm({ ...form, nameAr: e.target.value });
                    if (errors.includes("nameAr")) setErrors(errors.filter(err => err !== "nameAr"));
                  }}
                  className={`w-full bg-[#201f1f] border rounded-full p-4 text-lg font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.includes("nameAr") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                  }`}
                />
              </div>

              {/* English Name */}
              <div className="col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">اسم المنتج باللغة الإنجليزية</label>
                <input
                  dir="ltr"
                  type="text"
                  placeholder="Modern Physics - 6th Edition"
                  value={form.nameEn}
                  onChange={(e) => {
                    setForm({ ...form, nameEn: e.target.value });
                    if (errors.includes("nameEn")) setErrors(errors.filter(err => err !== "nameEn"));
                  }}
                  className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] font-sans focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.includes("nameEn") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                  }`}
                />
              </div>

              {/* Category */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">التصنيف</label>
                <div className="relative">
                  <select
                    value={form.category_id}
                    onChange={(e) => {
                      setForm({ ...form, category_id: e.target.value });
                      if (errors.includes("category_id")) setErrors(errors.filter(err => err !== "category_id"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] appearance-none focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("category_id") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  >
                    <option value="">اختر الفئة</option>
                    {categoriesList.map(c => (
                      <option key={c.id} value={c.id}>{c.name_ar}</option>
                    ))}
                  </select>
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none opacity-40">expand_more</span>
                </div>
              </div>

              {/* Supplier */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">المورد الأساسي</label>
                <div className="relative">
                  <select
                    value={form.supplier_id}
                    onChange={(e) => {
                      setForm({ ...form, supplier_id: e.target.value });
                      if (errors.includes("supplier_id")) setErrors(errors.filter(err => err !== "supplier_id"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] appearance-none focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("supplier_id") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  >
                    <option value="">اختر المورد</option>
                    {suppliersList.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none opacity-40">expand_more</span>
                </div>
              </div>

              {/* Sub Category */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الفئة الفرعية</label>
                <div className="relative">
                  <select
                    value={form.subCategory_id}
                    onChange={(e) => {
                      setForm({ ...form, subCategory_id: e.target.value });
                      if (errors.includes("subCategory_id")) setErrors(errors.filter(err => err !== "subCategory_id"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] appearance-none focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("subCategory_id") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  >
                    <option value="">اختر الفئة الفرعية</option>
                    {subcategoriesList.filter(s => !form.category_id || s.category_id === form.category_id).map(s => (
                      <option key={s.id} value={s.id}>{s.name_ar}</option>
                    ))}
                  </select>
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none opacity-40">expand_more</span>
                </div>
              </div>

              {/* Brand */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">العلامة التجارية</label>
                <div className="relative">
                  <select
                    value={form.brand_id}
                    onChange={(e) => {
                      setForm({ ...form, brand_id: e.target.value });
                      if (errors.includes("brand_id")) setErrors(errors.filter(err => err !== "brand_id"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-4 text-[#e5e2e1] appearance-none focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("brand_id") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  >
                    <option value="">اختر العلامة التجارية</option>
                    {brandsList.map(b => (
                      <option key={b.id} value={b.id}>{b.name_ar}</option>
                    ))}
                  </select>
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 material-symbols-outlined pointer-events-none opacity-40">expand_more</span>
                </div>
              </div>

              {/* Active Status */}
              <div className="col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">حالة المنتج</label>
                <div className="flex items-center gap-4 bg-[#201f1f] border border-white/5 rounded-full p-4">
                  <div
                    className="relative inline-flex items-center cursor-pointer"
                    onClick={() => setForm({ ...form, active: !form.active })}
                  >
                    <div
                      className={`w-12 h-6 rounded-full transition-all duration-300 ${
                        form.active ? "bg-primary" : "bg-white/10"
                      }`}
                    />
                    <div
                      className={`absolute top-1 w-4 h-4 rounded-full transition-all duration-300 ${
                        form.active ? "right-1 bg-white" : "right-7 bg-white/40"
                      }`}
                    />
                  </div>
                  <span className="text-[#e5e2e1] font-bold text-sm">{form.active ? "نشط" : "غير نشط"}</span>
                </div>
              </div>

              {/* Description */}
              <div className="col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">وصف تفصيلي</label>
                <textarea
                  placeholder="أدخل هنا مواصفات المنتج، المؤلف، أو أي تفاصيل فنية..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-[#201f1f] border border-white/5 rounded-2xl p-5 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 min-h-[120px] transition-all resize-none"
                />
              </div>

              {/* Image Upload */}
              <div className="col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">صورة المنتج التعريفية</label>
                <div 
                  className="relative border-2 border-dashed border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 bg-white/[0.01] hover:bg-white/[0.03] hover:border-primary/40 transition-all cursor-pointer group overflow-hidden min-h-[200px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImageUpload}
                  onClick={() => document.getElementById("product-image-upload")?.click()}
                >
                  <input 
                    id="product-image-upload" 
                    type="file" 
                    className="hidden" 
                    accept="image/png, image/jpeg, image/webp" 
                    onChange={handleImageUpload} 
                  />
                  
                  {isUploadingImage ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                      <p className="text-primary font-bold">جاري الرفع...</p>
                    </div>
                  ) : form.imageUrl ? (
                    <div className="absolute inset-0 w-full h-full">
                      <Image src={form.imageUrl} alt="Product preview" fill className="object-contain p-2" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                        <span className="bg-white/20 text-white px-4 py-2 rounded-full font-bold backdrop-blur-sm">تغيير الصورة</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <span className="material-symbols-outlined text-3xl">upload_file</span>
                      </div>
                      <div className="text-center">
                        <p className="text-[#e5e2e1] font-bold">اسحب الصورة هنا أو اضغط للاختيار</p>
                        <p className="text-[#e2bfb0] text-xs mt-1">JPG, PNG (بحد أقصى 5 ميجابايت)</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Units */}
          <section className="space-y-8 pt-8 border-t border-white/5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined">layers</span>
                </div>
                <h3 className="text-2xl font-bold">إدارة الوحدات والمخزون</h3>
              </div>
              <div className="flex flex-col items-end gap-3">
                <span className="bg-primary/20 text-primary px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">inventory_2</span>
                  إجمالي الرصيد: {totalBaseStock} قطعة
                </span>
                <button
                  onClick={addUnit}
                  className="flex items-center gap-2 text-primary font-bold text-sm bg-primary/10 px-6 py-3 rounded-full hover:bg-primary/20 transition-all border border-primary/20 whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-lg font-bold">add</span>
                  إضافة وحدة جديدة
                </button>
              </div>
            </div>

            {/* Stock Limits */}
            <div className="grid grid-cols-2 gap-8 bg-[#1c1b1b] p-6 rounded-2xl border border-white/5 mb-6">
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الحد الأدنى للكمية</label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.minStockLevel}
                    onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })}
                    className="w-full bg-[#201f1f] border border-white/5 rounded-full p-4 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 font-bold opacity-40">قطعة</span>
                </div>
              </div>
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الحد الأقصى للكمية</label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.maxStockLevel}
                    onChange={(e) => setForm({ ...form, maxStockLevel: e.target.value })}
                    className="w-full bg-[#201f1f] border border-white/5 rounded-full p-4 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 font-bold opacity-40">قطعة</span>
                </div>
              </div>
            </div>

            <div className="bg-[#1c1b1b] rounded-2xl border border-white/5 overflow-x-auto custom-scrollbar">
              <table className="w-full text-right min-w-[800px]">
                <thead>
                  <tr className="bg-white/5">
                    {["نوع الوحدة", "عامل التحويل", "كمية المخزون", "الافتراضي", "إجراءات"].map((h) => (
                      <th key={h} className="px-6 py-4 text-xs font-bold text-[#e2bfb0] uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {units.map((unit) => (
                    <tr key={unit.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        {unit.isBase ? (
                          <>
                            <span className="font-bold text-[#e5e2e1]">{unit.name}</span>
                            <span className="text-xs text-[#e2bfb0] mr-2 opacity-60">(الوحدة الأساسية)</span>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <select
                              value={unit.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "__ADD_NEW__") {
                                  setShowNewUnitDialog(true);
                                } else {
                                  const selectedGlobal = globalUnits.find(gu => gu.name === val);
                                  updateUnit(unit.id, "name", val);
                                  if (selectedGlobal) {
                                    updateUnit(unit.id, "conversionFactor", selectedGlobal.conversion_factor);
                                  }
                                }
                              }}
                              className="w-full bg-[#201f1f] border border-white/5 rounded-full px-4 py-2 text-sm text-right focus:ring-2 focus:ring-primary/30 transition-all appearance-none"
                            >
                              <option value="">اختر الوحدة</option>
                              {globalUnits.map(gu => (
                                <option key={gu.id} value={gu.name}>{gu.name}</option>
                              ))}
                              <option value="__ADD_NEW__">+ إضافة وحدة جديدة بالكامل</option>
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {unit.isBase ? (
                          <span className="text-[#e2bfb0] font-mono">{Number(unit.conversionFactor || 0).toFixed(1)}</span>
                        ) : (
                          <input
                            type="number"
                            value={unit.conversionFactor || ""}
                            onChange={(e) => updateUnit(unit.id, "conversionFactor", parseFloat(e.target.value) || 0)}
                            className="w-24 bg-[#201f1f] border border-white/5 rounded-full px-4 py-2 text-sm text-center focus:ring-2 focus:ring-primary/30 transition-all"
                          />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            value={unit.stock === 0 ? "" : unit.stock}
                            onChange={(e) => updateUnit(unit.id, "stock", parseFloat(e.target.value) || 0)}
                            placeholder="0"
                            className="w-24 bg-[#201f1f] border border-white/5 rounded-full px-4 py-2 text-sm text-center focus:ring-2 focus:ring-primary/30 transition-all"
                          />
                          {!unit.isBase && unit.stock > 0 && (
                            <span className="text-xs text-[#e2bfb0] opacity-70 whitespace-nowrap">
                              = {unit.stock * unit.conversionFactor} قطعة
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex justify-center">
                          <div 
                            onClick={() => setDefaultUnit(unit.id)}
                            className={`w-10 h-6 rounded-full relative flex items-center px-1 cursor-pointer transition-colors ${
                              unit.isDefault ? "bg-primary justify-end" : "bg-white/10 justify-start"
                            }`}
                          >
                            <div className={`w-4 h-4 rounded-full ${unit.isDefault ? "bg-white" : "bg-white/40"}`} />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        {unit.isBase ? (
                          <span className="material-symbols-outlined text-white/10">lock</span>
                        ) : (
                          <button 
                            onClick={() => deleteUnit(unit.id)}
                            className="w-10 h-10 rounded-full flex items-center justify-center text-[#ffb4ab] hover:bg-[#ffb4ab]/10 transition-colors"
                          >
                            <span className="material-symbols-outlined text-xl">delete</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Pricing */}
          <section className="space-y-8 pt-8 border-t border-white/5 pb-12">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">payments</span>
              </div>
              <h3 className="text-2xl font-bold">هيكل التسعير (ج.م)</h3>
            </div>

            <div className="grid grid-cols-2 gap-8 bg-primary/[0.03] p-8 rounded-2xl border border-primary/10">
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">سعر الشراء (للوحدة الأساسية)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.costPrice}
                    onChange={(e) => {
                      setForm({ ...form, costPrice: e.target.value });
                      if (errors.includes("costPrice")) setErrors(errors.filter(err => err !== "costPrice"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-5 text-2xl font-bold text-primary focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("costPrice") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">ج.م</span>
                </div>
              </div>
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">نسبة ضريبة القيمة المضافة</label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.vatRate}
                    onChange={(e) => {
                      setForm({ ...form, vatRate: e.target.value });
                      if (errors.includes("vatRate")) setErrors(errors.filter(err => err !== "vatRate"));
                    }}
                    className={`w-full bg-[#201f1f] border rounded-full p-5 text-2xl font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("vatRate") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">%</span>
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {units.map((unit, index) => (
                <div key={unit.id} className="space-y-6">
                  <p className="text-[#e2bfb0] text-sm font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">sell</span>
                    توزيع أسعار البيع - شريحة الـ {unit.name || `وحدة مخصصة ${index + 1}`}
                  </p>
                  <div className="grid grid-cols-3 gap-6">
                    {[
                      { label: "سعر المستهلك (Retail)", key: "retailPrice" as const, highlight: false },
                      { label: "سعر الجملة (Wholesale)", key: "wholesalePrice" as const, highlight: false },
                      { label: "سعر كبار العملاء (VIP)", key: "vipPrice" as const, highlight: true },
                    ].map((tier) => {
                      const salePrice = parseFloat(unit[tier.key]) || 0;
                      const baseCostPrice = parseFloat(form.costPrice) || 0;
                      const vatRate = parseFloat(form.vatRate) || 0;
                      // التكلفة الفعلية = سعر الشراء × (1 + نسبة القيمة المضافة / 100)
                      const unitCostPrice = baseCostPrice * unit.conversionFactor * (1 + vatRate / 100);
                      let margin = 0;
                      if (unitCostPrice > 0) {
                        margin = ((salePrice - unitCostPrice) / unitCostPrice) * 100;
                      }

                      const errorKey = `${tier.key}_${unit.id}`;

                      return (
                        <div
                          key={tier.label}
                          className={`bg-[#1c1b1b] rounded-2xl p-6 space-y-3 border transition-colors ${
                            errors.includes(errorKey)
                              ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                              : tier.highlight
                                ? "border-primary/30 ring-1 ring-primary/10 bg-primary/[0.02]"
                                : "border-white/5 hover:bg-[#201f1f]"
                          }`}
                        >
                          <span className={`text-xs font-bold uppercase tracking-wider ${tier.highlight ? "text-primary" : "text-[#e2bfb0]"}`}>
                            {tier.label}
                          </span>
                          <div className="relative">
                            <input
                              type="number"
                              value={unit[tier.key]}
                              onChange={(e) => {
                                updateUnit(unit.id, tier.key, e.target.value);
                                if (errors.includes(errorKey)) setErrors(errors.filter(err => err !== errorKey));
                              }}
                              step="0.01"
                              className={`w-full bg-transparent border-none p-0 focus:ring-0 text-3xl font-bold transition-all ${
                                tier.highlight ? "text-primary" : "text-[#e5e2e1]"
                              }`}
                            />
                          </div>
                          <div className={`text-xs flex items-center gap-1 font-semibold ${margin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            <span className="material-symbols-outlined text-xs">
                              {margin >= 0 ? "trending_up" : "trending_down"}
                            </span>
                            هامش ربح {Number(margin || 0).toFixed(0)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <footer className="px-16 py-8 bg-[#0e0e0e]/80 backdrop-blur-xl border-t border-white/5 flex items-center gap-6 sticky bottom-0">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`flex-[2] ${isSaving ? 'bg-primary/50 cursor-not-allowed' : 'bg-primary hover:shadow-[0_12px_32px_rgba(255,107,0,0.3)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]'} text-white font-bold text-lg py-5 rounded-full shadow-[0_12px_24px_rgba(255,107,0,0.2)] transition-all flex items-center justify-center gap-3`}
          >
            <span className="material-symbols-outlined font-bold">
              {isSaving ? "sync" : "check_circle"}
            </span>
            {isSaving ? "جاري الحفظ..." : "حفظ وإدراج في المخزون"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-5 rounded-full border border-white/10 font-bold text-[#e2bfb0] hover:bg-white/5 active:scale-[0.98] transition-all"
          >
            إلغاء الأمر
          </button>
        </footer>
      </aside>

      {/* New Unit Dialog */}
      {showNewUnitDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-[#1c1b1b] rounded-3xl border border-white/10 p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-2xl font-bold mb-6">إضافة وحدة جديدة بالكامل</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-[#e2bfb0] mb-2">اسم الوحدة</label>
                <input
                  type="text"
                  value={newGlobalUnit.name}
                  onChange={(e) => setNewGlobalUnit({ ...newGlobalUnit, name: e.target.value })}
                  placeholder="مثال: كرتونة"
                  className="w-full bg-[#201f1f] border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 transition-all text-right"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#e2bfb0] mb-2">معامل التحويل (كم قطعة في هذه الوحدة؟)</label>
                <input
                  type="number"
                  value={newGlobalUnit.conversion_factor || ""}
                  onChange={(e) => setNewGlobalUnit({ ...newGlobalUnit, conversion_factor: parseFloat(e.target.value) || 1 })}
                  placeholder="مثال: 24"
                  className="w-full bg-[#201f1f] border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 transition-all text-right"
                />
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button
                onClick={handleCreateGlobalUnit}
                className="flex-[2] bg-primary text-white font-bold py-3 rounded-xl hover:bg-primary/90 transition-all"
              >
                إضافة وحفظ
              </button>
              <button
                onClick={() => setShowNewUnitDialog(false)}
                className="flex-1 bg-white/5 text-[#e2bfb0] font-bold py-3 rounded-xl hover:bg-white/10 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
