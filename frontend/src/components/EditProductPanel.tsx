"use client";

import { notifyError, notifySuccess } from "@/lib/notifications";

import { useState, useEffect } from "react";
import Image from "next/image";
import { fetchApi } from "@/lib/api";
import { marginFromPrice, pricesFromMargins, type PriceMargins, type TierPrices } from "@/lib/pricing";
import { z } from "zod";
import UnitBarcodeField from "@/components/UnitBarcodeField";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { ProductSelect } from "@/components/ProductSelect";
import { productFormErrors, productSaveError } from "@/lib/productFormErrors";
import { refreshNotificationBell } from "@/lib/notificationEvents";
import { optimizeProductImage } from "@/lib/productImage";

const unitSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "اسم الوحدة مطلوب"),
  conversionFactor: z.coerce.number().min(1, "يجب أن يكون عامل التحويل أكبر من 0"),
  sku: z.string().max(64).regex(/^[\x20-\x7E]*$/, "باركود الوحدة يجب أن يحتوي على أحرف وأرقام إنجليزية").optional(),
  stock: z.coerce.number().min(0, "لا يمكن أن يكون المخزون بالسالب"),
  isBase: z.boolean(),
  retailPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  semiWholesalePrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  wholesalePrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  superWholesalePrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
  vipPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "مطلوب رقم صحيح"),
});

const productFormSchema = z.object({
  nameAr: z.string().min(2, "اسم المنتج مطلوب"),
  nameEn: z.string().optional(),
  category_id: z.string().min(1, "التصنيف مطلوب"),
  supplier_id: z.string().min(1, "المورد الأساسي مطلوب"),
  subCategory_id: z.string().min(1, "الفئة الفرعية مطلوبة"),
  brand_id: z.string().min(1, "العلامة التجارية مطلوبة"),
  active: z.boolean(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  warehouseLocation: z.string().optional(),
  costPrice: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "السعر مطلوب"),
  vatRate: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الضريبة مطلوبة"),
  minStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأدنى مطلوب"),
  maxStockLevel: z.string().refine(val => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "الحد الأقصى مطلوب"),
  is_bundle: z.boolean().optional(),
  units: z.array(unitSchema).min(1, "يجب إضافة وحدة واحدة على الأقل"),
});

interface ProductUnit {
  id: string;
  name: string;
  conversionFactor: number;
  sku: string;
  stock: number;
  isBase: boolean;
  retailPrice: string;
  semiWholesalePrice: string;
  wholesalePrice: string;
  superWholesalePrice: string;
  vipPrice: string;
}

interface GlobalUnit {
  id: string;
  name: string;
  conversion_factor: number;
}

interface CatalogOption { id: string; name_ar: string; name_en: string; category_id?: string }
interface SupplierOption { id: string; name: string }
interface SavedPrice { price_level: string; price: number }
interface SavedUnit {
  id: string;
  unit_name: string;
  conversion_factor: number;
  barcode?: string | null;
  prices?: SavedPrice[];
}

interface EditProductPanelProps {
  productId: string;
  onClose: () => void;
  onSuccess: () => void;
  onDelete?: () => void;
  approvalRequired?: boolean;
}

export function EditProductPanel({ productId, onClose, onSuccess, onDelete, approvalRequired = false }: EditProductPanelProps) {
  useEffect(() => {
    document.body.classList.add("product-panel-open");
    return () => document.body.classList.remove("product-panel-open");
  }, []);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({
    sku: "",
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
    warehouseLocation: "",
    costPrice: "0",
    vatRate: "0",
    profitMargin: "0",
    semiWholesaleMargin: "0",
    wholesaleMargin: "0",
    superWholesaleMargin: "0",
    vipMargin: "0",
    minStockLevel: "0",
    maxStockLevel: "0",
    is_bundle: false,
  });

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showAdvancedPricing, setShowAdvancedPricing] = useState(false);

  const [units, setUnits] = useState<ProductUnit[]>([
    { id: "1", name: "قطعة", conversionFactor: 1, sku: "", stock: 0, isBase: true, retailPrice: "0", semiWholesalePrice: "0", wholesalePrice: "0", superWholesalePrice: "0", vipPrice: "0" },
  ]);
  const [savedBarcodeIds, setSavedBarcodeIds] = useState<string[]>([]);

  const recalculatePrices = (cost: string, vat: string, margins: PriceMargins, tier?: keyof TierPrices) => {
    setUnits(previous => previous.map(unit => {
      const calculated = pricesFromMargins(cost, vat, unit.conversionFactor, margins);
      return tier ? { ...unit, [tier]: calculated[tier] } : { ...unit, ...calculated };
    }));
  };


  const [globalUnits, setGlobalUnits] = useState<GlobalUnit[]>([]);
  const [showNewUnitDialog, setShowNewUnitDialog] = useState(false);
  const [newGlobalUnit, setNewGlobalUnit] = useState({ name: "", conversion_factor: 1 });

  const [categoriesList, setCategoriesList] = useState<CatalogOption[]>([]);
  const [subcategoriesList, setSubcategoriesList] = useState<CatalogOption[]>([]);
  const [brandsList, setBrandsList] = useState<CatalogOption[]>([]);
  const [suppliersList, setSuppliersList] = useState<SupplierOption[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadProduct() {
      try {
        setIsLoading(true);
        const data = await fetchApi(`/products/${productId}`);
        const basePrices: SavedPrice[] = data.units?.find((unit: SavedUnit) => unit.unit_name === data.base_unit)?.prices || [];
        const baseRetail = Number(basePrices.find(price => price.price_level === "Retail")?.price || 0);
        const baseTier = (level: string) => Number(basePrices.find(price => price.price_level === level)?.price ?? baseRetail);
        setForm({
          sku: data.sku || "",
          nameAr: data.name_ar || "",
          nameEn: data.name_en || "",
          barcode: data.barcode || "",
          category_id: data.category_id || "",
          supplier_id: data.supplier_id || "",
          subCategory_id: data.subcategory_id || "",
          brand_id: data.brand_id || "",
          active: data.is_active ?? true,
          description: data.description || "",
          imageUrl: data.image_url || "",
          warehouseLocation: data.warehouse_location || "",
          costPrice: data.cost?.toString() || "0",
          vatRate: data.tax_rate?.toString() || "0",
          profitMargin: marginFromPrice(
            baseRetail,
            Number(data.cost || 0), Number(data.tax_rate || 0), 1,
          ),
          semiWholesaleMargin: marginFromPrice(
            baseTier("Semi Wholesale"),
            Number(data.cost || 0), Number(data.tax_rate || 0), 1,
          ),
          wholesaleMargin: marginFromPrice(
            baseTier("Wholesale"),
            Number(data.cost || 0), Number(data.tax_rate || 0), 1,
          ),
          superWholesaleMargin: marginFromPrice(
            baseTier("Super Wholesale"),
            Number(data.cost || 0), Number(data.tax_rate || 0), 1,
          ),
          vipMargin: marginFromPrice(
            baseTier("VIP"),
            Number(data.cost || 0), Number(data.tax_rate || 0), 1,
          ),
          minStockLevel: data.min_stock_level?.toString() || "0",
          maxStockLevel: data.max_stock_level?.toString() || "0",
          is_bundle: false,
        });

        if (data.units && data.units.length > 0) {
          setSavedBarcodeIds(data.units.filter((unit: SavedUnit) => !!unit.barcode).map((unit: SavedUnit) => unit.id));
          const loadedUnits = data.units.map((u: SavedUnit) => {
            const retail = u.prices?.find((p) => p.price_level === "Retail")?.price || 0;
            const semiWholesale = u.prices?.find((p) => p.price_level === "Semi Wholesale")?.price ?? retail;
            const wholesale = u.prices?.find((p) => p.price_level === "Wholesale")?.price ?? retail;
            const superWholesale = u.prices?.find((p) => p.price_level === "Super Wholesale")?.price ?? retail;
            const vip = u.prices?.find((p) => p.price_level === "VIP")?.price ?? retail;
            return {
              id: u.id,
              name: u.unit_name,
              conversionFactor: u.conversion_factor,
              sku: u.barcode || "",
              stock: u.unit_name === data.base_unit ? (data.current_stock || 0) : 0,
              isBase: u.unit_name === data.base_unit,
              retailPrice: retail.toString(),
              semiWholesalePrice: semiWholesale.toString(),
              wholesalePrice: wholesale.toString(),
              superWholesalePrice: superWholesale.toString(),
              vipPrice: vip.toString(),
            };
          });
          setUnits(loadedUnits);
        }

        setIsLoading(false);
      } catch (err) {
        console.error("Failed to load product", err);
        setIsLoading(false);
      }
    }
    if (productId) {
      loadProduct();
    }
  }, [productId]);
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
          fetchApi("/products/suppliers"),
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
        stock: 0,
        isBase: false,
        ...pricesFromMargins(form.costPrice, form.vatRate, 1, form),
      },
    ]);
  };

  const updateUnit = (id: string, field: keyof ProductUnit, value: ProductUnit[keyof ProductUnit]) => {
    setUnits(prev => prev.map(u => {
      if (u.id !== id) return u;
      const updated = { ...u, [field]: value };
      return field === "conversionFactor"
        ? { ...updated, ...pricesFromMargins(form.costPrice, form.vatRate, Number(value), form) }
        : updated;
    }));
  };

  const deleteUnit = (id: string) => {
    setUnits(units.filter(u => u.id !== id));
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
          stock: 0,
          isBase: false,
          ...pricesFromMargins(form.costPrice, form.vatRate, created.conversion_factor, form),
        }
      ]);
    } catch (err) {
      console.error(err);
      notifyError("تعذر إضافة الوحدة. تأكد أنها غير مسجلة من قبل.");
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

    try {
      const formData = new FormData();
      formData.append("file", await optimizeProductImage(file));
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
      notifyError("فشل رفع الصورة");
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
        const validation = productFormErrors(validationResult.error.issues, units);
        setErrors(validation.fields);
        console.error("Validation Failed:", validationResult.error.issues);
        notifyError(validation.message);
        return;
      }
      setErrors([]);

      setIsSaving(true);
      const payload = {
        sku: form.sku, // Keep existing SKU
        barcode: form.barcode.trim() || null,
        name_en: form.nameEn.trim(),
        name_ar: form.nameAr,
        base_unit: units.find(u => u.isBase)?.name || "Piece",
        cost: parseFloat(form.costPrice) || 0,
        tax_rate: parseFloat(form.vatRate) || 0,
        min_stock_level: parseFloat(form.minStockLevel) || 0,
        max_stock_level: parseFloat(form.maxStockLevel) || 0,
        description: form.description,
        image_url: form.imageUrl,
        warehouse_location: form.warehouseLocation,
        is_active: form.active,
        is_bundle: false,
        category_id: form.category_id && form.category_id !== "" ? form.category_id : null,
        subcategory_id: form.subCategory_id && form.subCategory_id !== "" ? form.subCategory_id : null,
        brand_id: form.brand_id && form.brand_id !== "" ? form.brand_id : null,
        supplier_id: form.supplier_id && form.supplier_id !== "" ? form.supplier_id : null,
        units: units.map(u => ({
          ...( /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.id) ? { id: u.id } : {} ),
          unit_name: u.name || "Unknown",
          conversion_factor: u.conversionFactor,
          barcode: u.sku.trim() || null,
          prices: [
            { price_level: "Retail", price_type: "retail", price: parseFloat(u.retailPrice) || 0 },
            { price_level: "Semi Wholesale", price_type: "semi_wholesale", price: parseFloat(u.semiWholesalePrice) || 0 },
            { price_level: "Wholesale", price_type: "wholesale", price: parseFloat(u.wholesalePrice) || 0 },
            { price_level: "Super Wholesale", price_type: "super_wholesale", price: parseFloat(u.superWholesalePrice) || 0 },
            { price_level: "VIP", price_type: "vip", price: parseFloat(u.vipPrice) || 0 },
          ]
        })),
        bundle_components: [],
      };

      if (approvalRequired) {
        await fetchApi("/product-approvals", {
          method: "POST",
          body: JSON.stringify({ product_id: productId, action: "UPDATE", proposed: payload }),
        });
        notifySuccess("اترسل طلب التعديل للمدير. بيانات المنتج لسه زي ما هي لحد الموافقة.");
      } else {
        await fetchApi(`/products/${productId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      refreshNotificationBell();

      // Close panel and trigger the parent's refresh.
      onClose();
      if (!approvalRequired) onSuccess();
    } catch (err) {
      console.error("Failed to save product:", err);
      notifyError(productSaveError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="motion-overlay fixed inset-0 bg-black/70 backdrop-blur-sm z-[60]"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <aside className="product-editor-panel fixed top-0 bottom-0 left-0 w-full max-w-[1180px] bg-surface-container-lowest z-[70] shadow-[0_0_80px_rgba(0,0,0,0.8)] flex flex-col animate-slide-in-left border-r border-white/10">
        {/* Header */}
        <header className="px-5 py-5 sm:px-8 xl:px-12 xl:py-6 flex justify-between items-center border-b border-white/5 bg-surface-container-lowest/50 backdrop-blur-md sticky top-0 z-10">
          <div>
            <h2 className="text-2xl font-bold text-[#e5e2e1] leading-tight">تعديل منتج</h2>
          </div>
          <button
            onClick={onClose}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-[#e2bfb0] transition-all group border border-white/5"
          >
            <span className="material-symbols-outlined text-2xl group-hover:rotate-90 transition-transform">close</span>
          </button>
        </header>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8 xl:px-10 space-y-9 custom-scrollbar">
          {/* Section 1: Basic Info */}
          <section className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">info</span>
              </div>
              <h3 className="text-2xl font-bold">المعلومات الأساسية</h3>
            </div>

            <div className="product-basic-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-5 gap-y-5">
              {/* Arabic Name */}
              <div className="xl:col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">اسم المنتج باللغة العربية</label>
                <input
                  type="text"
                  placeholder="اسم المنتج بالعربية"
                  value={form.nameAr}
                  onChange={(e) => {
                    setForm({ ...form, nameAr: e.target.value });
                    if (errors.includes("nameAr")) setErrors(errors.filter(err => err !== "nameAr"));
                  }}
                  className={`w-full bg-surface-container border rounded-full p-4 text-lg font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.includes("nameAr") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                  }`}
                />
              </div>

              {/* English Name */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">اسم المنتج بالإنجليزية · اختياري</label>
                <input
                  dir="ltr"
                  type="text"
                  placeholder="اسم المنتج بالإنجليزية"
                  value={form.nameEn}
                  onChange={(e) => {
                    setForm({ ...form, nameEn: e.target.value });
                    if (errors.includes("nameEn")) setErrors(errors.filter(err => err !== "nameEn"));
                  }}
                  className={`w-full bg-surface-container border rounded-full p-4 text-[#e5e2e1] font-sans focus:ring-2 focus:ring-primary/30 transition-all ${
                    errors.includes("nameEn") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                  }`}
                />
              </div>

              {/* Category */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">التصنيف</label>
                <ProductSelect label="التصنيف" value={form.category_id} placeholder="اختر الفئة"
                  options={categoriesList.map(c => ({ value: c.id, label: c.name_ar }))}
                  invalid={errors.includes("category_id")}
                  onChange={value => {
                    setForm(previous => ({ ...previous, category_id: value, subCategory_id: "" }));
                    setErrors(previous => previous.filter(error => error !== "category_id"));
                  }} />
              </div>

              {/* Supplier */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">المورد الأساسي</label>
                <ProductSelect label="المورد الأساسي" value={form.supplier_id} placeholder="اختر المورد"
                  options={suppliersList.map(s => ({ value: s.id, label: s.name }))}
                  invalid={errors.includes("supplier_id")}
                  onChange={value => {
                    setForm(previous => ({ ...previous, supplier_id: value }));
                    setErrors(previous => previous.filter(error => error !== "supplier_id"));
                  }} />
              </div>

              {/* Sub Category */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الفئة الفرعية</label>
                <ProductSelect label="الفئة الفرعية" value={form.subCategory_id} placeholder="اختر الفئة الفرعية"
                  options={subcategoriesList.filter(s => s.category_id === form.category_id).map(s => ({ value: s.id, label: s.name_ar }))}
                  invalid={errors.includes("subCategory_id")}
                  onChange={value => {
                    setForm(previous => ({ ...previous, subCategory_id: value }));
                    setErrors(previous => previous.filter(error => error !== "subCategory_id"));
                  }} />
              </div>

              {/* Brand */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">العلامة التجارية / دار النشر</label>
                <ProductSelect label="العلامة التجارية" value={form.brand_id} placeholder="اختر العلامة التجارية"
                  options={brandsList.map(b => ({ value: b.id, label: b.name_ar }))}
                  invalid={errors.includes("brand_id")}
                  onChange={value => {
                    setForm(previous => ({ ...previous, brand_id: value }));
                    setErrors(previous => previous.filter(error => error !== "brand_id"));
                  }} />
              </div>

              {/* Active Status */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">حالة المنتج</label>
                <div className="flex items-center gap-4 bg-surface-container border border-white/5 rounded-full p-4">
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
              <div className="space-y-5"><label className="text-[#e2bfb0] text-sm font-semibold">مكان الصنف في المخزن / الرف · اختياري</label><input value={form.warehouseLocation} onChange={event => setForm({ ...form, warehouseLocation: event.target.value })} className="w-full bg-surface-container border border-white/5 rounded-2xl p-4 text-white" /></div>
              <div className="xl:col-span-2 space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">وصف تفصيلي</label>
                <textarea
                  placeholder="أدخل هنا مواصفات المنتج، المؤلف، أو أي تفاصيل فنية..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-surface-container border border-white/5 rounded-2xl p-5 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 min-h-[120px] transition-all resize-none"
                />
              </div>

              {/* Image Upload */}
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">صورة المنتج التعريفية</label>
                <div
                  className="relative border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 bg-white/[0.01] hover:bg-white/[0.03] hover:border-primary/40 transition-all cursor-pointer group overflow-hidden min-h-[144px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImageUpload}
                  onClick={() => document.getElementById("edit-product-image-upload")?.click()}
                >
                  <input
                    id="edit-product-image-upload"
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
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                        <span className="material-symbols-outlined text-3xl">upload_file</span>
                      </div>
                      <div className="text-center">
                        <p className="text-[#e5e2e1] font-bold">اسحب الصورة هنا أو اضغط للاختيار</p>
                        <p className="text-[#e2bfb0] text-xs mt-1">JPG، PNG، WebP (بحد أقصى 5 ميجابايت بعد الضغط)</p>
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
                <h3 className="text-2xl font-bold">إدارة الوحدات</h3>
              </div>
              <div className="flex flex-col items-end gap-3">
                <span className="bg-primary/20 text-primary px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">inventory_2</span>
                  الرصيد الحالي: {totalBaseStock} {units.find(unit => unit.isBase)?.name || "وحدة"}
                </span>
                <span className="text-xs text-[#e2bfb0]/70">تغيير الكمية يتم من استلام المخزون</span>
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
            <div className="grid grid-cols-2 gap-8 bg-surface-container-low p-6 rounded-2xl border border-white/5 mb-6">
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الحد الأدنى للكمية</label>
                <div className="relative">
                  <ZeroHintNumberInput

                    value={form.minStockLevel}
                    onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })}
                    className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 font-bold opacity-40">قطعة</span>
                </div>
              </div>
              <div className="space-y-5">
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">الحد الأقصى للكمية</label>
                <div className="relative">
                  <ZeroHintNumberInput

                    value={form.maxStockLevel}
                    onChange={(e) => setForm({ ...form, maxStockLevel: e.target.value })}
                    className="w-full bg-surface-container border border-white/5 rounded-full p-4 text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 font-bold opacity-40">قطعة</span>
                </div>
              </div>
            </div>

            <div className="product-units-scroll bg-surface-container-low rounded-2xl border border-white/5 overflow-hidden">
              <table className="product-units-table w-full">
                <thead>
                  <tr className="bg-white/5">
                    {["نوع الوحدة", "عامل التحويل", "باركود الوحدة (اختياري)", "كمية المخزون", "إجراءات"].map((h) => (
                      <th key={h} className="px-6 py-4 text-sm font-bold text-[#e2bfb0] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {units.map((unit) => (
                    <tr key={unit.id} className="hover:bg-white/[0.02] transition-colors">
                      <td data-label="نوع الوحدة" className="px-6 py-4">
                        {unit.isBase ? (
                          <>
                            <span className="font-bold text-[#e5e2e1]">{unit.name}</span>
                            <span className="text-xs text-[#e2bfb0] mr-2 opacity-60">(الوحدة الأساسية)</span>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <ProductSelect
                              label={`وحدة ${unit.name}`}
                              value={unit.name}
                              placeholder="اختر الوحدة"
                              compact
                              options={[...globalUnits.map(gu => ({ value: gu.name, label: gu.name })), { value: "__ADD_NEW__", label: "+ إضافة وحدة جديدة بالكامل" }]}
                              onChange={(val) => {
                                if (val === "__ADD_NEW__") {
                                  setShowNewUnitDialog(true);
                                } else {
                                  const selectedGlobal = globalUnits.find(gu => gu.name === val);
                                  updateUnit(unit.id, "name", val);
                                  if (selectedGlobal) {
                                    updateUnit(unit.id, "conversionFactor", selectedGlobal.conversion_factor);
                                  }
                                }
                              }} />
                          </div>
                        )}
                      </td>
                      <td data-label="عامل التحويل" className="px-6 py-4">
                        {unit.isBase ? (
                          <span className="text-[#e2bfb0] font-mono">{Number(unit.conversionFactor || 0).toFixed(1)}</span>
                        ) : (
                          <ZeroHintNumberInput

                            value={unit.conversionFactor || ""}
                            onChange={(e) => updateUnit(unit.id, "conversionFactor", parseFloat(e.target.value) || 0)}
                            className="product-unit-number"
                          />
                        )}
                      </td>
                      <td data-label="باركود الوحدة (اختياري)" className="px-4 py-4">
                        <UnitBarcodeField unitName={unit.name || "الوحدة"} value={unit.sku}
                          readOnly={savedBarcodeIds.includes(unit.id)}
                          onChange={value => updateUnit(unit.id, "sku", value)} />
                      </td>
                      <td data-label="كمية المخزون" className="px-6 py-4 whitespace-nowrap">
                        <span className="text-xs text-[#e2bfb0]">{unit.isBase ? `${totalBaseStock} ${unit.name}` : "يُعرض الرصيد بالوحدة الأساسية"}</span>
                      </td>
                      <td data-label="إجراءات" className="px-6 py-4 text-center whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined">payments</span>
                </div>
                <div>
                  <h3 className="text-2xl font-bold">هيكل التسعير (ج.م)</h3>
                  <p className="text-xs text-[#e2bfb0]/70 mt-0.5">تسعير التجزئة والتكلفة، مع إمكانية ضبط شرائح الجملة (B2B)</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAdvancedPricing(prev => !prev)}
                className="flex items-center gap-2 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-full border border-primary/20 transition-all cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-base">
                  {showAdvancedPricing ? "expand_less" : "tune"}
                </span>
                {showAdvancedPricing
                  ? "إخفاء خيارات الجملة وكبار العملاء (B2B)"
                  : "تخصيص أسعار الجملة وكبار العملاء (B2B)"}
              </button>
            </div>

            <div className="product-pricing-grid flex flex-wrap gap-3 bg-primary/[0.03] p-4 rounded-2xl border border-primary/10">
              <div className="space-y-5" style={{ flexBasis: `${Math.max(18, form.costPrice.length + 12)}ch` }}>
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">تكلفة شراء القطعة الواحدة</label>
                <div className="relative">
                  <ZeroHintNumberInput
                    value={form.costPrice}
                    onChange={(e) => {
                      const newCost = e.target.value;
                      setForm({ ...form, costPrice: newCost });
                      if (errors.includes("costPrice")) setErrors(errors.filter(err => err !== "costPrice"));
                      recalculatePrices(newCost, form.vatRate, form);
                    }}
                    className={`w-full bg-surface-container border rounded-full p-5 text-2xl font-bold text-primary focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("costPrice") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">ج.م</span>
                </div>
              </div>
              <div className="space-y-5" style={{ flexBasis: `${Math.max(18, form.vatRate.length + 12)}ch` }}>
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">نسبة ضريبة القيمة المضافة</label>
                <div className="relative">
                  <ZeroHintNumberInput
                    value={form.vatRate}
                    onChange={(e) => {
                      const newVat = e.target.value;
                      setForm({ ...form, vatRate: newVat });
                      if (errors.includes("vatRate")) setErrors(errors.filter(err => err !== "vatRate"));
                      recalculatePrices(form.costPrice, newVat, form);
                    }}
                    className={`w-full bg-surface-container border rounded-full p-5 text-2xl font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all ${
                      errors.includes("vatRate") ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]" : "border-white/5"
                    }`}
                  />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">%</span>
                </div>
              </div>
              <div className="space-y-5" style={{ flexBasis: `${Math.max(18, form.profitMargin.length + 12)}ch` }}>
                <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">هامش الربح (المستهلك)</label>
                <div className="relative">
                  <ZeroHintNumberInput
                    value={form.profitMargin}
                    onChange={(e) => {
                      const newMargin = e.target.value;
                      setForm({ ...form, profitMargin: newMargin });
                      recalculatePrices(form.costPrice, form.vatRate, { ...form, profitMargin: newMargin }, "retailPrice");
                    }}
                    className={`w-full bg-surface-container border rounded-full p-5 text-2xl font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30 transition-all border-white/5`}
                  />
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">%</span>
                </div>
              </div>

              {showAdvancedPricing && ([
                { key: "semiWholesaleMargin", tier: "semiWholesalePrice", label: "هامش الربح (نصف الجملة)" },
                { key: "wholesaleMargin", tier: "wholesalePrice", label: "هامش الربح (الجملة)" },
                { key: "superWholesaleMargin", tier: "superWholesalePrice", label: "هامش الربح (سوبر جملة)" },
                { key: "vipMargin", tier: "vipPrice", label: "هامش الربح (كبار العملاء)" },
              ] as const).map(({ key, tier, label }) => (
                <div className="space-y-5 animate-fadeIn" key={key} style={{ flexBasis: `${Math.max(18, form[key].length + 12)}ch` }}>
                  <label className="text-[#e2bfb0] text-sm font-semibold px-1 leading-loose">{label}</label>
                  <div className="relative">
                    <ZeroHintNumberInput
                      step="0.01"
                      value={form[key]}
                      onChange={(event) => {
                        const value = event.target.value;
                        setForm(previous => ({ ...previous, [key]: value }));
                        recalculatePrices(form.costPrice, form.vatRate, { ...form, [key]: value }, tier);
                      }}
                      className="w-full bg-surface-container border border-white/5 rounded-full p-5 text-2xl font-bold text-[#e5e2e1] focus:ring-2 focus:ring-primary/30"
                    />
                    <span className="absolute left-8 top-1/2 -translate-y-1/2 font-bold opacity-40">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#e2bfb0]/70">تكلفة الشراء للقطعة. سعر الجملة في قسم الدستة أو الكرتونة هو سعر الدستة كاملة عندما يتم إدخال معامل التحويل.</p>

            <div className="space-y-8">
              {units.map((unit, index) => (
                <div key={unit.id} className="space-y-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <p className="text-[#e2bfb0] text-sm font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg text-primary">sell</span>
                      أسعار {unit.name || `وحدة مخصصة ${index + 1}`} ({unit.conversionFactor} قطعة) · تكلفة الشراء {((parseFloat(form.costPrice) || 0) * unit.conversionFactor * (1 + (parseFloat(form.vatRate) || 0) / 100)).toFixed(2)} ج.م
                    </p>
                    {!showAdvancedPricing && (
                      <span className="text-xs text-primary/80 bg-primary/5 px-2.5 py-1 rounded-md border border-primary/10">
                        + تم احتساب 4 فئات تسعير جملة تلقائياً وفق هوامش الربح
                      </span>
                    )}
                  </div>

                  <div className="border-t border-white/10 mt-2 pt-4"></div>
                  <div className="product-price-list flex flex-wrap gap-3">
                    {[
                      { label: "سعر المستهلك", key: "retailPrice" as const, highlight: false, isB2B: false },
                      { label: "سعر نصف الجملة", key: "semiWholesalePrice" as const, highlight: false, isB2B: true },
                      { label: "سعر الجملة", key: "wholesalePrice" as const, highlight: false, isB2B: true },
                      { label: "سعر سوبر جملة", key: "superWholesalePrice" as const, highlight: false, isB2B: true },
                      { label: "سعر كبار العملاء", key: "vipPrice" as const, highlight: true, isB2B: true },
                    ].filter(tier => showAdvancedPricing || !tier.isB2B).map((tier) => {
                      const salePrice = parseFloat(unit[tier.key]) || 0;
                      const baseCostPrice = parseFloat(form.costPrice) || 0;
                      const vatRate = parseFloat(form.vatRate) || 0;
                      const unitCostPrice = baseCostPrice * unit.conversionFactor * (1 + vatRate / 100);
                      let margin = 0;
                      if (unitCostPrice > 0) {
                        margin = ((salePrice - unitCostPrice) / unitCostPrice) * 100;
                      }

                      const errorKey = `${tier.key}_${unit.id}`;

                      return (
                        <div
                          key={tier.label}
                          style={{ flexBasis: `${Math.max(17, String(unit[tier.key]).length + 12)}ch` }}
                          className={`product-price-card bg-surface-container-low rounded-xl p-4 space-y-2 border transition-colors ${
                            errors.includes(errorKey)
                              ? "border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                              : tier.highlight
                                ? "border-primary/30 ring-1 ring-primary/10 bg-primary/[0.02]"
                                : "border-white/5 hover:bg-surface-container"
                          }`}
                        >
                          <span className={`text-sm font-bold ${tier.highlight ? "text-primary" : "text-[#e2bfb0]"}`}>
                            {tier.label}
                          </span>
                          <div className="relative">
                            <ZeroHintNumberInput
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
                            {margin < 0 ? "خسارة" : "هامش ربح"} {Math.abs(margin).toFixed(2)}%
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
        <footer className="px-5 py-5 sm:px-8 xl:px-12 bg-surface-container-lowest/80 backdrop-blur-xl border-t border-white/5 flex flex-wrap items-center gap-3 sticky bottom-0">
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className={`flex-[2] ${isSaving || isLoading ? 'bg-primary/50 cursor-not-allowed' : 'bg-primary hover:shadow-[0_12px_32px_rgba(255,107,0,0.3)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]'} text-white font-bold text-lg py-5 rounded-full shadow-[0_12px_24px_rgba(255,107,0,0.2)] transition-all flex items-center justify-center gap-3`}
          >
            <span className="material-symbols-outlined font-bold">
              {isSaving ? "sync" : "check_circle"}
            </span>
            {isSaving ? "جاري الحفظ..." : approvalRequired ? "إرسال التعديل للمدير" : "حفظ التعديلات"}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete()}
              className="px-5 py-5 rounded-full border border-[#ffb4ab]/20 text-[#ffb4ab] hover:bg-[#ffb4ab]/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-bold"
              title="حذف المنتج"
            >
              <span className="material-symbols-outlined" aria-hidden="true">delete</span>
              {approvalRequired ? "طلب حذف المنتج" : "حذف المنتج"}
            </button>
          )}
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
        <div className="motion-overlay fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="motion-dialog bg-surface-container-low rounded-3xl border border-white/10 p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-2xl font-bold mb-6">إضافة وحدة جديدة بالكامل</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-[#e2bfb0] mb-2">اسم الوحدة</label>
                <input
                  type="text"
                  value={newGlobalUnit.name}
                  onChange={(e) => setNewGlobalUnit({ ...newGlobalUnit, name: e.target.value })}
                  placeholder="اسم الوحدة"
                  className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 transition-all text-right"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#e2bfb0] mb-2">معامل التحويل (كم قطعة في هذه الوحدة؟)</label>
                <ZeroHintNumberInput

                  value={newGlobalUnit.conversion_factor || ""}
                  onChange={(e) => setNewGlobalUnit({ ...newGlobalUnit, conversion_factor: parseFloat(e.target.value) || 1 })}
                  placeholder="عدد القطع"
                  className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 transition-all text-right"
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
