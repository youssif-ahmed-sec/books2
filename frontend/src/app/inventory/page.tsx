"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { InventoryTableRow } from "@/components/InventoryTableRow";
import { AddProductPanel } from "@/components/AddProductPanel";
import { EditProductPanel } from "@/components/EditProductPanel";
import InventoryMovementsModal from "@/components/InventoryMovementsModal";
import ReceiveStockPanel from "@/components/ReceiveStockPanel";
import { fetchApi } from "@/lib/api";
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
  units: Array<{ unit_name: string; prices: Array<{ price_level: string; price: string }> }>;
}
interface Balance { product_id: string; current_stock: string }
interface RecentTransaction { transaction_type: string; product_name?: string; created_at: string }
interface StockMovement { product: string; type: string; date: string; typeStyle: string }
interface PurchaseNeeded { name: string; stock: string; image?: string }
interface SupplierOption { id: string; name: string }
interface CategoryOption { id: string; name_ar: string }

export default function InventoryPage() {
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [showMovementsModal, setShowMovementsModal] = useState(false);
  const [showReceivePanel, setShowReceivePanel] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [statCards, setStatCards] = useState<StatCard[]>([
    { icon: "warning", iconColor: "text-primary", label: "منخفض المخزون", value: "0", valueColor: "text-primary", sub: "يحتاج إعادة طلب", subColor: "text-[#e2bfb0]/60" },
    { icon: "error", iconColor: "text-[#ffb4ab]", label: "مخزون حرج", value: "0", valueColor: "text-[#ffb4ab]", sub: "أصناف نفدت", subColor: "text-[#e2bfb0]/60" },
    { icon: "payments", iconColor: "text-primary", label: "قيمة المخزون", value: "0", valueExtra: "ج.م", sub: "تقدير القيمة الحالية", subColor: "text-[#e2bfb0]/60" },
  ]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [purchaseNeeded, setPurchaseNeeded] = useState<PurchaseNeeded[]>([]);
  const [loading, setLoading] = useState(true);
  const hydrated = useHydrated();
  const userRole: UserRole | null = hydrated ? getUserRole() : null;

  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStockStatus, setSelectedStockStatus] = useState("");
  
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const limit = 10;

  useEffect(() => {
    fetchApi("/suppliers").then(res => setSuppliers(res.data || res)).catch(console.error);
    fetchApi("/products/categories").then(res => setCategories(res.data || res)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!userRole) return;
    const loadData = async () => {
      try {
        setLoading(true);
        
        const params = new URLSearchParams({ skip: ((page - 1) * limit).toString(), limit: limit.toString() });
        if (selectedSupplier) params.append("supplier_id", selectedSupplier);
        if (selectedCategory) params.append("category_id", selectedCategory);
        if (selectedStockStatus) params.append("stock_status", selectedStockStatus);

        // Fetch products and balances
        const [productsRes, balancesRes, statsRes, transactionsRes] = await Promise.all([
          fetchApi(`/products?${params.toString()}`),
          fetchApi("/inventory/balances"),
          fetchApi("/inventory/stats"),
          userRole === "ADMIN" ? fetchApi("/inventory/transactions/recent") : Promise.resolve([]),
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
             const baseUnit = product.units[0];
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
        setStatCards([
          ...(userRole === "ADMIN" ? [{ icon: "trending_up", iconColor: "text-primary", label: "حركات اليوم", value: String(statsRes.today_movements ?? 0), sub: "", subColor: "text-green-400" }] : []),
          { icon: "warning", iconColor: "text-primary", label: "منخفض المخزون", value: statsRes.low_stock_count.toString(), valueColor: "text-primary", sub: "يحتاج إعادة طلب", subColor: "text-[#e2bfb0]/60" },
          { icon: "error", iconColor: "text-[#ffb4ab]", label: "مخزون حرج", value: statsRes.critical_stock_count.toString(), valueColor: "text-[#ffb4ab]", sub: "أصناف نفدت", subColor: "text-[#e2bfb0]/60" },
          { icon: "payments", iconColor: "text-primary", label: "قيمة المخزون", value: parseFloat(statsRes.total_value).toLocaleString(), valueExtra: "ج.م", sub: "تقدير القيمة الحالية", subColor: "text-[#e2bfb0]/60" },
        ]);

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
        
        // Map purchase needed (critical and low stock items)
        const lowItems = mappedItems.filter((i) => i.stockStatus === 'low' || i.stockStatus === 'critical').slice(0, 5);
        setPurchaseNeeded(lowItems.map((i) => ({
          name: i.nameAr,
          stock: `${i.stockQty} ${i.stockUnit}`,
          image: i.image,
        })));

      } catch (error) {
        console.error("Failed to load inventory data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [page, limit, selectedSupplier, selectedCategory, selectedStockStatus, userRole]);

  const handleDelete = async (item: InventoryItem) => {
    if (confirm(`هل أنت متأكد من حذف المنتج "${item.nameAr}"؟`)) {
      try {
        await fetchApi(`/products/${item.id}`, { method: 'DELETE' });
        // Since the backend returns 204 No Content, we can just reload
        window.location.reload();
      } catch (err) {
        console.error("Failed to delete product:", err);
        alert("حدث خطأ أثناء الحذف.");
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
            <p className="text-[#e2bfb0]/70 mt-2 text-lg">
              إجمالي المسجل:{" "}
              {loading ? (
                <span className="text-primary font-bold">...</span>
              ) : (
                <span className="text-primary font-bold">{inventoryItems.length.toLocaleString()}</span>
              )}{" "}
              صنف متاح
            </p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {statCards.map((card, i) => (
            <div key={i} className="glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className={`material-symbols-outlined ${card.iconColor} text-3xl`}>{card.icon}</span>
                <span className="text-[10px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest">{card.label}</span>
              </div>
              <div>
                {card.valueExtra ? (
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-black ${card.valueColor || "text-[#e5e2e1]"}`}>
                      {loading ? "..." : card.value}
                    </span>
                    <span className="text-xs text-primary font-bold">{card.valueExtra}</span>
                  </div>
                ) : (
                  <span className={`text-3xl font-black ${card.valueColor || "text-[#e5e2e1]"}`}>
                    {loading ? "..." : card.value}
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
                <label className="text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest px-4">
                  الفئة المستهدفة
                </label>
                <select 
                  value={selectedCategory}
                  onChange={(e) => { setSelectedCategory(e.target.value); setPage(1); }}
                  className="bg-[#1c1b1b]/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer text-[#e5e2e1]"
                >
                  <option value="">جميع الفئات</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name_ar}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest px-4">
                  المورد الرئيسي
                </label>
                <select 
                  value={selectedSupplier}
                  onChange={(e) => { setSelectedSupplier(e.target.value); setPage(1); }}
                  className="bg-[#1c1b1b]/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer text-[#e5e2e1]"
                >
                  <option value="">كافة الموردين</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest px-4">
                  حالة المخزون
                </label>
                <select 
                  value={selectedStockStatus}
                  onChange={(e) => { setSelectedStockStatus(e.target.value); setPage(1); }}
                  className="bg-[#1c1b1b]/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer text-[#e5e2e1]"
                >
                  <option value="">الكل</option>
                  <option value="low">مخزون منخفض</option>
                  <option value="critical">مخزون حرج (صفر)</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="glass rounded-2xl hi-fi-shadow">
              <div className="w-full overflow-x-auto pb-4 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
                <table className="w-full text-right border-collapse min-w-[1100px]">
                  <thead>
                    <tr className="bg-white/5">
                      {["المنتج", "الباركود", "التصنيف"].map(
                        (h) => (
                          <th key={h} className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase ">
                            {h}
                          </th>
                        )
                      )}
                      {canViewCost(userRole) && (
                        <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase ">
                          التسعير
                        </th>
                      )}
                      <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase ">
                        الرصيد الحالي
                      </th>
                      <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase text-center">
                        العمليات
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-[#e2bfb0]/60">جاري تحميل المنتجات...</td>
                      </tr>
                    ) : inventoryItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-[#e2bfb0]/60">لا يوجد منتجات متاحة</td>
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
                      <th className="pb-3 font-bold text-left text-xs px-2">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading ? (
                      <tr>
                        <td colSpan={3} className="text-center py-4 text-[#e2bfb0]/60">جاري التحميل...</td>
                      </tr>
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
                          <td className="py-4 text-left text-[#e2bfb0]/60 text-[10px] px-2 whitespace-nowrap">
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
                  <span className="material-symbols-outlined text-[#ffb4ab]">shopping_cart_checkout</span>
                  تحتاج أمر شراء
                </h4>
              </div>
              <div className="space-y-4">
                {loading ? (
                  <div className="text-center py-4 text-[#e2bfb0]/60">جاري التحميل...</div>
                ) : purchaseNeeded.length === 0 ? (
                  <div className="text-center py-4 text-[#e2bfb0]/60">جميع المنتجات متوفرة بمخزون كافٍ</div>
                ) : (
                  purchaseNeeded.map((item, i) => (
                    <div
                      key={i}
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
                          <p className="text-[10px] text-[#ffb4ab]">مخزون: {item.stock}</p>
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
      {showAddPanel && <AddProductPanel onClose={() => { setShowAddPanel(false); window.location.reload(); }} />}
      {showEditPanel && selectedItem && (
        <EditProductPanel
          productId={selectedItem.id}
          onClose={() => setShowEditPanel(false)}
          onSuccess={() => window.location.reload()}
          onDelete={() => handleDelete(selectedItem)}
        />
      )}
      {/* Modals */}
      {userRole === "ADMIN" && showMovementsModal && <InventoryMovementsModal onClose={() => setShowMovementsModal(false)} />}
      {showReceivePanel && <ReceiveStockPanel onClose={() => setShowReceivePanel(false)} onSaved={() => window.location.reload()} />}
    </div>
  );
}
