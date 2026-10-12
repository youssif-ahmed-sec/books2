"use client";

import { notifyError } from "@/lib/notifications";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { InventoryTableRow } from "@/components/InventoryTableRow";
import { ProductSelect } from "@/components/ProductSelect";
import { AddProductPanel } from "@/components/AddProductPanel";
import { EditProductPanel } from "@/components/EditProductPanel";
import InventoryMovementsModal from "@/components/InventoryMovementsModal";
import ReceiveStockPanel from "@/components/ReceiveStockPanel";
import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { getUserRole, canViewCost, canEditProduct, UserRole } from "@/utils/auth";
import { useHydrated } from "@/lib/useHydrated";

interface InventoryItem {
  id: string;
  nameAr: string;
  nameEn: string;
  tag: string;
  sku: string;
  barcode: string;
  category: string;
  subcategory: string;
  brand: string;
  supplier: string;
  units: Array<{ id: string; unit_name: string; barcode: string; retailPrice: string }>;
  baseUnit: string;
  retailPrice: string;
  wholesalePrice: string;
  stockQty: string;
  stockUnit: string;
  stockPercent: number;
  stockStatus: "normal" | "low" | "critical";
  image?: string;
}
interface StatCard {
  icon: string; iconColor: string; label: string; value: string;
  valueColor?: string; valueExtra?: string; sub: string; subColor: string;
}
interface CatalogProduct {
  id: string; sku: string; barcode: string; name_ar: string; name_en: string;
  base_unit: string; image_url?: string; max_stock_level: string; min_stock_level: string;
  category?: { name_ar: string };
  subcategory?: { name_ar: string };
  brand?: { name_ar: string };
  supplier?: { name: string };
  units: Array<{ id: string; unit_name: string; barcode: string; prices: Array<{ price_level: string; price: string }> }>;
}
interface Balance { product_id: string; current_stock: string }
interface RecentTransaction { transaction_type: string; product_name?: string; created_at: string }
interface StockMovement { product: string; type: string; date: string; typeStyle: string }
interface PurchaseNeeded { id: string; name: string; stock: string; image?: string }
interface StockAlert { product_id: string; name: string; stock: number; base_unit: string; image_url?: string }
interface SupplierOption { id: string; name: string }
interface CategoryOption { id: string; name_ar: string }
interface InventorySnapshot {
  items: InventoryItem[]; stats: StatCard[]; movements: StockMovement[];
  purchaseNeeded: PurchaseNeeded[]; total: number; page: number;
  supplier: string; category: string; status: string;
}

export default function InventoryPage() {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [showReceivePanel, setShowReceivePanel] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(() => readSectionSnapshot<InventorySnapshot>("inventory")?.items || []);
  const [statCards, setStatCards] = useState<StatCard[]>(() => readSectionSnapshot<InventorySnapshot>("inventory")?.stats || [
    { icon: "warning", iconColor: "text-primary", label: "منخفض المخزون", value: "0", valueColor: "text-primary", sub: "يحتاج إعادة طلب", subColor: "text-[#e2bfb0]/60" },
    { icon: "error", iconColor: "text-[#ffb4ab]", label: "مخزون حرج", value: "0", valueColor: "text-[#ffb4ab]", sub: "أصناف نفدت", subColor: "text-[#e2bfb0]/60" },
    { icon: "payments", iconColor: "text-primary", label: "قيمة المخزون", value: "0", valueExtra: "ج.م", sub: "تقدير القيمة الحالية", subColor: "text-[#e2bfb0]/60" },
  ]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => readSectionSnapshot<InventorySnapshot>("inventory")?.movements || []);
  const [purchaseNeeded, setPurchaseNeeded] = useState<PurchaseNeeded[]>(() => readSectionSnapshot<InventorySnapshot>("inventory")?.purchaseNeeded || []);
  const [purchaseNeededLoading, setPurchaseNeededLoading] = useState(() => !readSectionSnapshot<InventorySnapshot>("inventory"));
  const [loading, setLoading] = useState(() => !readSectionSnapshot<InventorySnapshot>("inventory"));
  const hydrated = useHydrated();
  const userRole: UserRole | null = hydrated ? getUserRole() : null;

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  
  const [selectedSupplier, setSelectedSupplier] = useState(() => readSectionSnapshot<InventorySnapshot>("inventory")?.supplier || "");
  const [selectedCategory, setSelectedCategory] = useState(() => readSectionSnapshot<InventorySnapshot>("inventory")?.category || "");
  const [selectedStockStatus, setSelectedStockStatus] = useState(() => readSectionSnapshot<InventorySnapshot>("inventory")?.status || "");
  
  const [page, setPage] = useState(() => readSectionSnapshot<InventorySnapshot>("inventory")?.page || 1);
  const [totalItems, setTotalItems] = useState(() => readSectionSnapshot<InventorySnapshot>("inventory")?.total || 0);
  const limit = 10;

  useEffect(() => {
    fetchApi("/suppliers").then(res => setSuppliers(res.data || res)).catch(console.error);
    fetchApi("/products/categories").then(res => setCategories(res.data || res)).catch(console.error);
  }, []);

  const loadData = useCallback(async (showLoading = true) => {
    if (!userRole) return;
      try {
        if (showLoading && !readSectionSnapshot<InventorySnapshot>("inventory")) setLoading(true);
        
        const params = new URLSearchParams({ skip: ((page - 1) * limit).toString(), limit: limit.toString(), is_bundle: "false" });
        if (selectedSupplier) params.append("supplier_id", selectedSupplier);
        if (selectedCategory) params.append("category_id", selectedCategory);
        if (selectedStockStatus) params.append("stock_status", selectedStockStatus);

        // Fetch products and balances
        const [productsRes, balancesRes, statsRes, transactionsRes] = await Promise.all([
          fetchApi(`/products?${params.toString()}`),
          fetchApi("/inventory/balances"),
          fetchApi("/inventory/stats"),
          fetchApi("/inventory/transactions/recent"),
        ]);

        setTotalItems(productsRes.total || 0);
        const productsList: CatalogProduct[] = productsRes.data || [];
        const balances: Balance[] = balancesRes;

        // Merge balances with products
        const mappedItems: InventoryItem[] = productsList.map((product) => {
          const productBalances = balances.filter((b) => b.product_id === product.id);
          const currentStock = productBalances.reduce((sum, b) => sum + Number(parseFloat(b.current_stock) || 0), 0);
          
          let retailPrice = "0.00";
          let wholesalePrice = "0.00";
          let unitName = product.base_unit || "قطعة";
          
          if (product.units && product.units.length > 0) {
             const baseUnit = product.units.find(unit => unit.unit_name === product.base_unit) || product.units[0];
             if (baseUnit.unit_name) {
               unitName = baseUnit.unit_name;
             }
             if (baseUnit.prices && baseUnit.prices.length > 0) {
                const retail = baseUnit.prices.find((p) => p.price_level === "Retail");
                const wholesale = baseUnit.prices.find((p) => p.price_level === "Wholesale");
                if (retail) retailPrice = Number(parseFloat(retail.price) || 0).toFixed(2);
                if (wholesale) wholesalePrice = Number(parseFloat(wholesale.price) || 0).toFixed(2);
             }
          }

          let stockStatus: InventoryItem["stockStatus"] = "normal";
          let stockPercent = 100;
          
          const maxStock = Number(parseFloat(product.max_stock_level) || 0);
          const minStock = Number(parseFloat(product.min_stock_level) || 0);
          
          if (maxStock > 0) {
            stockPercent = Math.round(Math.min(100, Math.max(0, (currentStock / maxStock) * 100)));
          } else {
            stockPercent = currentStock > 0 ? 100 : 0;
          }

          if (currentStock <= 0) {
            stockStatus = "critical";
          } else if (minStock > 0 && currentStock <= minStock) {
            stockStatus = "low";
          } else if (minStock === 0 && currentStock < 5) {
            stockStatus = "low";
          }

            let stockQty = currentStock.toString();
            if (Number.isInteger(parseFloat(stockQty))) {
              stockQty = parseInt(stockQty, 10).toString();
            }

            return {
              id: product.id,
              nameAr: product.name_ar,
              nameEn: product.name_en,
              tag: product.category?.name_ar || "",
              sku: product.sku,
              barcode: product.barcode,
              category: product.category?.name_ar || "غير مصنف",
              subcategory: product.subcategory?.name_ar || "",
              brand: product.brand?.name_ar || "",
              supplier: product.supplier?.name || "",
              units: product.units.map(unit => ({
                id: unit.id,
                unit_name: unit.unit_name,
                barcode: unit.barcode || "",
                retailPrice: Number(unit.prices.find(price => price.price_level === "Retail")?.price || 0).toFixed(2),
              })),
              baseUnit: product.base_unit,
              retailPrice,
              wholesalePrice,
              stockQty,
            stockUnit: unitName,
            stockPercent,
            stockStatus,
            image: product.image_url,
          };
        });

        setInventoryItems(mappedItems);
        
        // Map stats
        const mappedStats: StatCard[] = [
          ...(userRole === "ADMIN" ? [{ icon: "trending_up", iconColor: "text-primary", label: "حركات اليوم", value: String(statsRes.today_movements ?? 0), sub: "", subColor: "text-green-400" }] : []),
          { icon: "warning", iconColor: "text-primary", label: "منخفض المخزون", value: statsRes.low_stock_count.toString(), valueColor: "text-primary", sub: "يحتاج إعادة طلب", subColor: "text-[#e2bfb0]/60" },
          { icon: "error", iconColor: "text-[#ffb4ab]", label: "مخزون حرج", value: statsRes.critical_stock_count.toString(), valueColor: "text-[#ffb4ab]", sub: "أصناف نفدت", subColor: "text-[#e2bfb0]/60" },
          { icon: "payments", iconColor: "text-primary", label: "قيمة المخزون", value: parseFloat(statsRes.total_value).toLocaleString(), valueExtra: "ج.م", sub: "تقدير القيمة الحالية", subColor: "text-[#e2bfb0]/60" },
        ];
        setStatCards(mappedStats);

        // Map transactions
        const mappedMovements = (transactionsRes as RecentTransaction[]).map((tx) => {
          let typeLabel = "غير معروف";
          let style = "bg-gray-500/10 text-gray-400 border-gray-500/20";
          
          if (tx.transaction_type === "Receiving") {
            typeLabel = "وارد";
            style = "bg-green-500/10 text-green-400 border-green-500/20";
          } else if (tx.transaction_type === "Issuing") {
            typeLabel = "صادر";
            style = "bg-red-500/10 text-red-400 border-red-500/20";
          } else if (tx.transaction_type === "Adjustment") {
            typeLabel = "تسوية";
            style = "bg-[#ffb4ab]/10 text-[#ffb4ab] border-[#ffb4ab]/20";
          }
          
          const d = new Date(tx.created_at);
          return {
             product: tx.product_name || "منتج غير معروف",
             type: typeLabel,
             date: `${d.toLocaleDateString('ar-EG')} ${d.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}`,
             typeStyle: style,
          };
        });
        setStockMovements(mappedMovements);
        writeSectionSnapshot<InventorySnapshot>("inventory", {
          items: mappedItems, stats: mappedStats, movements: mappedMovements,
          purchaseNeeded: readSectionSnapshot<InventorySnapshot>("inventory")?.purchaseNeeded || [],
          total: productsRes.total || 0, page, supplier: selectedSupplier, category: selectedCategory, status: selectedStockStatus,
        });
        
      } catch (error) {
        console.error("Failed to load inventory data:", error);
        notifyError(error instanceof Error ? error.message : "تعذر تحميل بيانات المخزون");
      } finally {
        setLoading(false);
      }
  }, [page, limit, selectedSupplier, selectedCategory, selectedStockStatus, userRole]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const loadPurchaseNeeded = useCallback(async () => {
    if (!userRole) return;
    if (!readSectionSnapshot<InventorySnapshot>("inventory")) setPurchaseNeededLoading(true);
    try {
      const alerts = await fetchApi("/reports/stock-alerts") as StockAlert[];
      const needed = alerts.map((alert) => ({
        id: alert.product_id,
        name: alert.name,
        stock: `${Number(alert.stock).toLocaleString("ar-EG", { maximumFractionDigits: 3 })} ${alert.base_unit}`,
        image: alert.image_url,
      }));
      setPurchaseNeeded(needed);
      const previous = readSectionSnapshot<InventorySnapshot>("inventory");
      if (previous) writeSectionSnapshot("inventory", { ...previous, purchaseNeeded: needed });
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "تعذر تحميل الأصناف التي تحتاج أمر شراء");
    } finally {
      setPurchaseNeededLoading(false);
    }
  }, [userRole]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPurchaseNeeded(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPurchaseNeeded]);

  const refreshData = useCallback(() => {
    void loadData(false);
    void loadPurchaseNeeded();
  }, [loadData, loadPurchaseNeeded]);

  const handleDelete = async (item: InventoryItem) => {
    if (confirm(`حذف المنتج "${item.nameAr}" من القائمة؟ سيبقى سجله محفوظًا، ويجب أن يكون رصيده صفرًا ولا يوجد له أمر شراء مفتوح.`)) {
      try {
        await fetchApi(`/products/${item.id}`, { method: 'DELETE' });
        setShowEditPanel(false);
        if (inventoryItems.length === 1 && page > 1) setPage(page - 1);
        else await loadData(false);
        await loadPurchaseNeeded();
      } catch (err) {
        console.error("Failed to delete product:", err);
        const message = err instanceof Error ? err.message : "";
        notifyError(message.includes("warehouse stock") ? "لا يمكن حذف منتج له رصيد في المخزن." :
          message.includes("open purchase order") ? "لا يمكن حذف منتج له أمر شراء مفتوح." :
          message || "حدث خطأ أثناء حذف المنتج.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] overflow-x-hidden selection:bg-primary/30">
      {/* Side Nav */}
      <SideNav />

      {/* Top Nav */}
      <TopNav title="إدارة المخزون" />

      {/* Main Content */}
      <main className="app-main space-y-10">
        {/* Header Actions */}
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="app-heading">قائمة المنتجات</h3>
            {loading ? <span className="app-skeleton mt-3 h-5 w-40" aria-label="جاري تحميل عدد المنتجات" /> : (
              <p className="text-[#e2bfb0]/70 mt-2 text-lg">
                إجمالي المسجل: <span className="text-primary font-bold">{totalItems.toLocaleString()}</span> صنف متاح
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {canEditProduct(userRole) && (
              <>
                <button
                  onClick={() => setShowReceivePanel(true)}
                  className="flex items-center gap-3 px-6 py-3.5 glass text-[#e5e2e1] rounded-full hover:bg-white/10 transition-all font-bold text-sm"
                >
                  <span className="material-symbols-outlined text-sm">move_to_inbox</span>
                  استلام مخزون
                </button>
                <button
                  onClick={() => setShowAddPanel(true)}
                  className="flex items-center gap-3 px-8 py-3.5 bg-primary text-white rounded-full shadow-lg shadow-primary/30 hover:-translate-y-0.5 transition-all font-bold text-sm"
                >
                  <span className="material-symbols-outlined text-sm">add_circle</span>
                  إضافة منتج جديد
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="motion-stagger grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5" aria-label={loading ? "جاري تحميل إحصاءات المخزون" : undefined}>
          {(loading && userRole === "ADMIN" && statCards.length === 3
            ? [{ icon: "trending_up", iconColor: "text-primary", label: "حركات اليوم", value: "", sub: "", subColor: "text-green-400" }, ...statCards]
            : statCards).map((card) => (
            <div key={card.label} className={`motion-surface glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4 text-right ${loading ? "inventory-stat-loading" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#e2bfb0]/80">{card.label}</span>
                <span className={`material-symbols-outlined ${card.iconColor} text-3xl`}>{card.icon}</span>
              </div>
              <div>
                {loading ? (
                  <div aria-label={`جاري تحميل ${card.label}`}>
                    <span className="app-skeleton h-8 w-24" />
                    <span className="app-skeleton mt-2 h-3 w-20" />
                  </div>
                ) : card.valueExtra ? (
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-black ${card.valueColor || "text-[#e5e2e1]"}`}>
                      {card.value}
                    </span>
                    <span className="text-xs text-primary font-bold">{card.valueExtra}</span>
                  </div>
                ) : (
                  <span className={`text-3xl font-black ${card.valueColor || "text-[#e5e2e1]"}`}>
                    {card.value}
                  </span>
                )}
                <span className={`text-xs ${card.subColor} block mt-1 font-bold`}>{card.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Layout Grid */}
        <div className="grid grid-cols-12 gap-8 items-start">
          {/* Main Product Table */}
          <div className="col-span-12 lg:col-span-9 space-y-8 min-w-0">
            {/* Filters */}
            <div className="glass p-8 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-6 hi-fi-shadow">
              <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-[#e2bfb0]/80 px-4">
                  الفئة المستهدفة
                </label>
                <ProductSelect
                  label="الفئة المستهدفة"
                  value={selectedCategory}
                  onChange={(value) => { setSelectedCategory(value); setPage(1); }}
                  placeholder="جميع الفئات"
                  options={categories.map((c) => ({ value: c.id, label: c.name_ar }))}
                  filter
                />
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-[#e2bfb0]/80 px-4">
                  المورد الرئيسي
                </label>
                <ProductSelect
                  label="المورد الرئيسي"
                  value={selectedSupplier}
                  onChange={(value) => { setSelectedSupplier(value); setPage(1); }}
                  placeholder="كافة الموردين"
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                  filter
                />
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-sm font-bold text-[#e2bfb0]/80 px-4">
                  حالة المخزون
                </label>
                <ProductSelect
                  label="حالة المخزون"
                  value={selectedStockStatus}
                  onChange={(value) => { setSelectedStockStatus(value); setPage(1); }}
                  placeholder="الكل"
                  options={[{ value: "low", label: "مخزون منخفض" }, { value: "critical", label: "مخزون حرج (صفر)" }]}
                  filter
                />
              </div>
            </div>

            {/* Table */}
            <div className="glass rounded-2xl overflow-hidden hi-fi-shadow">
              <div className="w-full overflow-x-auto pb-4 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="inventory-products-table w-full text-right border-collapse min-w-[1100px]">
                  <thead>
                    <tr className="bg-white/5">
                      {["المنتج", "الباركود", "التصنيف"].map(
                        (h) => (
                          <th key={h} className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-center">
                            {h}
                          </th>
                        )
                      )}
                      {canViewCost(userRole) && (
                        <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-center">
                          التسعير
                        </th>
                      )}
                      <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-center">
                        الرصيد الحالي
                      </th>
                      <th className="px-8 py-5 text-sm font-bold text-[#e2bfb0]/80 text-center">
                        العمليات
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 4 }, (_, index) => <tr key={`loading-${index}`} className="inventory-row-skeleton table-row-hover border-b border-white/5" aria-hidden={index !== 0}>
                        <td className="px-8 py-6 min-w-[250px]"><div className="flex items-center justify-center gap-5"><span className="app-skeleton h-14 w-14 shrink-0 rounded-2xl" /><span className="flex flex-col gap-2"><span className="app-skeleton h-4 w-28" /><span className="app-skeleton h-3 w-20" /></span></div>{index === 0 && <span className="sr-only">جاري تحميل المنتجات</span>}</td>
                        <td className="px-8 py-6 min-w-[150px]"><span className="app-skeleton mx-auto h-4 w-24" /><span className="app-skeleton mx-auto mt-2 h-3 w-20" /></td>
                        <td className="px-8 py-6 min-w-[150px] text-center"><span className="app-skeleton mx-auto h-6 w-24" /></td>
                        {canViewCost(userRole) && <td className="px-8 py-6 min-w-[150px]"><span className="app-skeleton mx-auto h-4 w-24" /><span className="app-skeleton mx-auto mt-2 h-4 w-20" /></td>}
                        <td className="px-8 py-6 min-w-[200px]"><div className="mx-auto max-w-[200px]"><div className="flex justify-between"><span className="app-skeleton h-3 w-12" /><span className="app-skeleton h-3 w-8" /></div><span className="app-skeleton mt-2 h-1.5 w-full" /></div></td>
                        <td className="px-8 py-6"><div className="flex justify-center gap-3"><span className="app-skeleton h-9 w-9" /><span className="app-skeleton h-9 w-9" /><span className="app-skeleton h-9 w-9" /></div></td>
                      </tr>)
                    ) : inventoryItems.length === 0 ? (
                      <tr>
                        <td colSpan={canViewCost(userRole) ? 6 : 5} className="text-center py-10 text-[#e2bfb0]/60">لا يوجد منتجات متاحة</td>
                      </tr>
                    ) : (
                      inventoryItems.map((item) => (
                        <InventoryTableRow
                          key={item.id}
                          item={item}
                          onEdit={() => {
                            setSelectedItem(item);
                            setShowEditPanel(true);
                          }}
                          onDelete={handleDelete}
                          userRole={userRole}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-8 py-5 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs font-medium text-[#e2bfb0]/60">
                  عرض {Math.min((page - 1) * limit + 1, totalItems)} إلى {Math.min(page * limit, totalItems)} من أصل {totalItems} منتج
                </span>
                <div className="flex gap-2">
                  <button 
                    disabled={page >= Math.ceil(totalItems / limit)}
                    onClick={() => setPage(page + 1)}
                    className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                  </button>
                  {[...Array(Math.ceil(totalItems / limit) || 1)].map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i + 1)}
                      className={`w-10 h-10 flex items-center justify-center rounded-full font-bold text-sm transition-all ${
                        page === i + 1 
                          ? "bg-primary text-white shadow-[0_0_10px_rgba(255,107,0,0.3)]"
                          : "glass hover:bg-white/10"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button 
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Side Panels */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-8">
            {/* Stock Movements */}
            {userRole === "ADMIN" && <div className="glass rounded-2xl hi-fi-shadow p-6">
              <div className="flex items-center justify-between mb-6 px-2">
                <h4 className="font-bold text-lg text-[#e5e2e1] flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">history</span>
                  آخر حركة المخزون
                </h4>
                <button onClick={() => setShowMovementsModal(true)} className="text-xs text-primary font-bold hover:underline">عرض الكل</button>
              </div>
              <div className="space-y-1">
                <table className="w-full text-right text-sm">
                  <thead className="text-[#e2bfb0]/60 border-b border-white/5">
                    <tr>
                      <th className="pb-3 font-bold text-xs px-2">المنتج</th>
                      <th className="pb-3 font-bold text-center text-xs">النوع</th>
                      <th className="pb-3 font-bold text-right text-xs px-2">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading ? (
                      Array.from({ length: 3 }, (_, index) => <tr key={`movement-loading-${index}`} className="inventory-row-skeleton" aria-hidden={index !== 0}>
                        <td className="py-4 px-2"><span className="app-skeleton h-4 w-24" />{index === 0 && <span className="sr-only">جاري تحميل الحركات</span>}</td>
                        <td className="py-4"><span className="app-skeleton mx-auto h-5 w-12" /></td>
                        <td className="py-4 px-2"><span className="app-skeleton h-4 w-16" /></td>
                      </tr>)
                    ) : stockMovements.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="text-center py-4 text-[#e2bfb0]/60">لا يوجد حركات قريبة</td>
                      </tr>
                    ) : (
                      stockMovements.map((move, i) => (
                        <tr key={i} className="hover:bg-white/5 transition-colors">
                          <td className="py-4 font-medium px-2">{move.product}</td>
                          <td className="py-4 text-center">
                            <span className={`px-2 py-0.5 text-[9px] rounded-full font-bold border ${move.typeStyle}`}>
                              {move.type}
                            </span>
                          </td>
                          <td className="py-4 text-right text-[#e2bfb0]/80 text-xs px-2 whitespace-nowrap">
                            {move.date}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>}

            {/* Needs Purchase Order */}
            <div className="glass rounded-2xl hi-fi-shadow p-6">
              <div className="flex items-center justify-between mb-6 px-2">
                <h4 className="font-bold text-lg text-[#e5e2e1] flex items-center gap-2">
                  <span>تحتاج أمر شراء</span>
                  <span className="material-symbols-outlined text-[#ffb4ab]" aria-hidden="true">shopping_cart_checkout</span>
                </h4>
                {!purchaseNeededLoading && purchaseNeeded.length > 0 && <span className="text-xs text-[#e2bfb0]/60">{purchaseNeeded.length} صنف</span>}
              </div>
              <div className="space-y-4 max-h-[32rem] overflow-y-auto pe-1">
                {purchaseNeededLoading ? (
                  <div className="inventory-row-skeleton space-y-4 py-2" aria-label="جاري تحميل الأصناف التي تحتاج أمر شراء">
                    {[0, 1, 2].map((index) => <div key={index} className="flex items-center gap-3"><span className="app-skeleton h-10 w-10 shrink-0 rounded-xl" /><span className="app-skeleton h-4 w-32" /><span className="app-skeleton mr-auto h-5 w-12" /></div>)}
                  </div>
                ) : purchaseNeeded.length === 0 ? (
                  <div className="text-center py-4 text-[#e2bfb0]/60">جميع المنتجات متوفرة بمخزون كافٍ</div>
                ) : (
                  purchaseNeeded.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#131313] flex items-center justify-center border border-white/5 overflow-hidden">
                          {item.image ? (
                            <Image src={item.image} alt={item.name} width={32} height={32} className="w-8 h-8 object-contain" unoptimized />
                          ) : (
                            <span className="material-symbols-outlined text-[#e2bfb0]/60">inventory</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{item.name}</p>
                          <p className="text-xs text-[#ffb4ab]">مخزون: {item.stock}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Panels */}
      {showAddPanel && <AddProductPanel onClose={() => setShowAddPanel(false)} onSaved={refreshData} />}
      {showEditPanel && selectedItem && (
        <EditProductPanel
          productId={selectedItem.id}
          onClose={() => setShowEditPanel(false)}
          onSuccess={refreshData}
          onDelete={userRole === "ADMIN" ? () => handleDelete(selectedItem) : undefined}
        />
      )}
      {/* Modals */}
      {userRole === "ADMIN" && showMovementsModal && <InventoryMovementsModal onClose={() => setShowMovementsModal(false)} />}
      {showReceivePanel && <ReceiveStockPanel onClose={() => setShowReceivePanel(false)} onSaved={refreshData} />}
    </div>
  );
}
