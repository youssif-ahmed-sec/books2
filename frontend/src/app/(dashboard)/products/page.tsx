"use client";

import React, { useEffect, useState } from 'react';
import { useProductStore } from '@/store/useProductStore';
import { useInventoryStore } from '@/store/useInventoryStore';
import ProductFormModal from '@/components/ProductFormModal';
import { Plus, Search, Edit2, PackageSearch } from 'lucide-react';

export default function ProductsPage() {
  const { products, isLoading, error, fetchProducts, openProductModal, searchQuery, setSearchQuery } = useProductStore();
  const { balances, stats, recentTransactions, fetchBalances, fetchStats, fetchRecentTransactions } = useInventoryStore();
  
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    fetchProducts();
    fetchBalances();
    fetchStats();
    fetchRecentTransactions();
  }, [fetchProducts, fetchBalances, fetchStats, fetchRecentTransactions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchQuery) {
        setSearchQuery(localSearch);
        fetchProducts();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [localSearch, searchQuery, setSearchQuery, fetchProducts]);

  return (
    <>
      <div className="space-y-10 fade-in-up rtl">
        {/* Header Actions */}
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h3 className="text-4xl font-bold text-on-surface tracking-tight">قائمة المنتجات</h3>
              <p className="text-on-surface-variant/70 mt-2 text-lg">إجمالي المسجل: <span className="text-primary font-bold">{products.length}</span> صنف متاح</p>
            </div>
            <div className="flex items-center gap-4">
              <button className="flex items-center gap-3 px-6 py-3.5 glass text-on-surface rounded-full hover:bg-white/10 transition-all font-bold text-sm">
                <span className="material-symbols-outlined text-sm">download</span>
                تصدير البيانات
              </button>
              <button 
                onClick={() => openProductModal()}
                className="flex items-center gap-3 px-8 py-3.5 bg-primary text-on-primary rounded-full shadow-lg shadow-primary/30 hover:translate-y-[-2px] transition-all font-bold text-sm"
              >
                <span className="material-symbols-outlined text-sm">add_circle</span>
                إضافة منتج جديد
              </button>
            </div>
          </div>
          <div className="w-full max-w-2xl relative">
            <span className="material-symbols-outlined absolute right-5 top-1/2 -translate-y-1/2 text-on-surface-variant/60">search</span>
            <input 
              type="text" 
              placeholder="ابحث بالاسم أو الباركود..." 
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="w-full h-14 bg-surface-container-low/40 border border-white/5 rounded-full pr-14 pl-8 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-surface-container transition-all"
            />
          </div>
        </div>

        {error && (
          <div className="glass bg-error-container/20 border-error/50 text-error p-5 rounded-2xl">
            {error}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-primary text-3xl">trending_up</span>
              <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">حركات اليوم</span>
            </div>
            <div>
              <span className="text-3xl font-black text-on-surface">{stats?.today_movements || 0} حركة</span>
              <span className="text-xs text-green-400 block mt-1 font-bold">نشاط ممتاز</span>
            </div>
          </div>
          <div className="glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-primary text-3xl">warning</span>
              <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">منخفض المخزون</span>
            </div>
            <div>
              <span className="text-3xl font-black text-primary">{stats?.low_stock_count || 0}</span>
              <span className="text-xs text-on-surface-variant/60 block mt-1">يحتاج إعادة طلب</span>
            </div>
          </div>
          <div className="glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-error text-3xl">error</span>
              <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">مخزون حرج</span>
            </div>
            <div>
              <span className="text-3xl font-black text-error">{stats?.critical_stock_count || 0}</span>
              <span className="text-xs text-on-surface-variant/60 block mt-1">أصناف نفدت</span>
            </div>
          </div>
          <div className="glass p-8 rounded-2xl hi-fi-shadow flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-primary text-3xl">payments</span>
              <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">قيمة المخزون</span>
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black text-on-surface">{stats?.total_value?.toLocaleString() || 0}</span>
                <span className="text-xs text-primary font-bold">ر.س</span>
              </div>
              <span className="text-xs text-on-surface-variant/60 block mt-1">تقدير القيمة الحالية</span>
            </div>
          </div>
        </div>

        {/* Layout Grid */}
        <div className="grid grid-cols-12 gap-8 items-start">
          {/* Main Product Table */}
          <div className="col-span-12 lg:col-span-8 space-y-8">
            {/* Filters */}
            <div className="glass p-8 rounded-2xl grid grid-cols-1 md:grid-cols-3 gap-6 hi-fi-shadow">
              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest px-4">الفئة المستهدفة</label>
                <select className="bg-surface-container-low/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer">
                  <option>جميع الفئات</option>
                  <option>أدوات مكتبية</option>
                  <option>كتب مدرسية</option>
                  <option>أدوات هندسية</option>
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest px-4">المورد الرئيسي</label>
                <select className="bg-surface-container-low/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer">
                  <option>كافة الموردين</option>
                  <option>شركة القرطاسية العالمية</option>
                  <option>مكتبة النيل</option>
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-widest px-4">حالة المخزون</label>
                <select className="bg-surface-container-low/50 border border-white/5 rounded-full px-6 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all appearance-none cursor-pointer">
                  <option>الكل</option>
                  <option>متوفر بكثرة</option>
                  <option>مخزون منخفض</option>
                  <option>نفذت الكمية</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="glass rounded-2xl overflow-hidden hi-fi-shadow">
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-white/5">
                      <th className="px-8 py-5 text-[11px] font-bold text-on-surface-variant/60 uppercase">المنتج</th>
                      <th className="px-8 py-5 text-[11px] font-bold text-on-surface-variant/60 uppercase">الباركود</th>
                      <th className="px-8 py-5 text-[11px] font-bold text-on-surface-variant/60 uppercase text-center">التصنيف</th>
                      <th className="px-8 py-5 text-[11px] font-bold text-on-surface-variant/60 uppercase">التسعير</th>
                      <th className="px-8 py-5 text-[11px] font-bold text-on-surface-variant/60 uppercase text-center">العمليات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {isLoading && products.length === 0 ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <tr key={i} className="animate-pulse">
                          <td className="px-8 py-6"><div className="h-4 bg-surface-bright rounded-full w-24 mb-2"></div><div className="h-3 bg-surface-bright rounded-full w-32"></div></td>
                          <td className="px-8 py-6"><div className="h-4 bg-surface-bright rounded-full w-24"></div></td>
                          <td className="px-8 py-6"><div className="h-4 bg-surface-bright rounded-full w-16 mx-auto"></div></td>
                          <td className="px-8 py-6"><div className="h-4 bg-surface-bright rounded-full w-12"></div></td>
                          <td className="px-8 py-6"><div className="h-8 bg-surface-bright rounded-full w-24 mx-auto"></div></td>
                        </tr>
                      ))
                    ) : products.length > 0 ? (
                      products.map((product) => (
                        <tr key={product.id} className="hover:bg-white/5 transition-all">
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-5">
                              <div className="w-14 h-14 rounded-2xl bg-surface-container-high border border-white/5 flex-shrink-0 flex items-center justify-center overflow-hidden">
                                <span className="material-symbols-outlined text-on-surface-variant/40 text-2xl">inventory_2</span>
                              </div>
                              <div>
                                <p className="font-bold text-on-surface">{product.name_ar || product.name_en}</p>
                                <p className="text-[10px] text-on-surface-variant/60">{product.name_en}</p>
                                <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full mt-1 inline-block border border-primary/20">وحدة: {product.base_unit}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-primary font-bold text-xs">{product.sku}</span>
                              <span className="font-mono text-[9px] opacity-40">{product.barcode || 'N/A'}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-center">
                            <span className="px-4 py-1.5 bg-surface-container-highest text-on-surface-variant/80 rounded-full text-[10px] font-black tracking-wider uppercase border border-white/5">قرطاسية</span>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-[10px] leading-relaxed">
                              <p><span className="opacity-50">تجزئة:</span> <span className="font-bold text-primary text-sm">{product.cost || '0.00'}</span></p>
                              <p><span className="opacity-50">تكلفة:</span> <span className="font-bold">{product.cost || '0.00'}</span></p>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center justify-center gap-3">
                              <button className="w-9 h-9 rounded-full glass flex items-center justify-center text-on-surface-variant/60 hover:text-primary hover:border-primary/30 transition-all"><span className="material-symbols-outlined text-[18px]">visibility</span></button>
                              <button 
                                onClick={() => openProductModal(product)}
                                className="w-9 h-9 rounded-full glass flex items-center justify-center text-on-surface-variant/60 hover:text-primary hover:border-primary/30 transition-all"
                              ><span className="material-symbols-outlined text-[18px]">edit</span></button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-8 py-12 text-center">
                          <PackageSearch size={48} className="mx-auto text-on-surface-variant/30 mb-4" />
                          <p className="text-on-surface-variant">لا توجد منتجات مطابقة للبحث</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="px-8 py-5 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs font-medium text-on-surface-variant/60">عرض 1-10 من أصل <span className="text-on-surface">{products.length}</span> منتج</span>
                <div className="flex gap-2">
                  <button className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all">
                    <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                  </button>
                  <button className="w-10 h-10 flex items-center justify-center bg-primary text-on-primary rounded-full font-black text-sm">1</button>
                  <button className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all font-bold text-sm">2</button>
                  <button className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all">
                    <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Side Panels */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-8">
            {/* Latest Stock Movements */}
            <div className="glass rounded-2xl hi-fi-shadow p-6">
              <div className="flex items-center justify-between mb-6 px-2">
                <h4 className="font-bold text-lg text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">history</span>
                  آخر حركة المخزون
                </h4>
                <button className="text-xs text-primary font-bold hover:underline">عرض الكل</button>
              </div>
              <div className="space-y-1">
                <table className="w-full text-right text-sm">
                  <thead className="text-on-surface-variant/60 border-b border-white/5">
                    <tr>
                      <th className="pb-3 font-bold text-xs px-2">المنتج</th>
                      <th className="pb-3 font-bold text-center text-xs">النوع</th>
                      <th className="pb-3 font-bold text-left text-xs px-2">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {recentTransactions?.map(tx => (
                      <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                        <td className="py-4 font-medium px-2">{tx.product_name || tx.product_id}</td>
                        <td className="py-4 text-center">
                          <span className={`px-2 py-0.5 text-[9px] rounded-full font-bold border ${tx.transaction_type === 'Receiving' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                            {tx.transaction_type === 'Receiving' ? 'وارد' : tx.transaction_type === 'Issuing' ? 'صادر' : tx.transaction_type}
                          </span>
                        </td>
                        <td className="py-4 text-left text-on-surface-variant/60 text-[10px] px-2 whitespace-nowrap">
                          {new Date(tx.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Needs Purchase Order */}
            <div className="glass rounded-2xl hi-fi-shadow p-6">
              <div className="flex items-center justify-between mb-6 px-2">
                <h4 className="font-bold text-lg text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-error">shopping_cart_checkout</span>
                  تحتاج أمر شراء
                </h4>
              </div>
              <div className="space-y-4">
                {balances.filter(b => b.current_stock < 20).slice(0, 3).map(balance => (
                  <div key={balance.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 group hover:bg-white/10 transition-all cursor-pointer">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-surface flex items-center justify-center border border-white/5">
                        <span className="material-symbols-outlined text-on-surface-variant/60">inventory</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold">{balance.product_name || balance.product_id}</p>
                        <p className="text-[10px] text-error">مخزون: {balance.current_stock.toLocaleString()} قطعة</p>
                      </div>
                    </div>
                    <button className="w-9 h-9 rounded-full glass group-hover:bg-primary group-hover:text-on-primary transition-all flex items-center justify-center">
                      <span className="material-symbols-outlined text-sm">add_shopping_cart</span>
                    </button>
                  </div>
                ))}
                {balances.filter(b => b.current_stock < 20).length === 0 && (
                  <p className="text-sm text-on-surface-variant/60">لا يوجد منتجات تحتاج إلى طلب شراء.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <ProductFormModal />
    </>
  );
}
