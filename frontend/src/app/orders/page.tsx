"use client";
import React, { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Link from "next/link";
import SideNav from "@/components/SideNav";
import { fetchApi } from "@/lib/api";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// ── Types ─────────────────────────────────────────────────────────────
interface Product {
  id: string;
  name_ar: string;
  name_en: string;
  barcode: string;
  sku: string;
  category_name: string;
  units: ProductUnit[];
  current_stock?: number;
}

interface ProductUnit {
  id: string;
  unit_name: string;
  conversion_factor: number;
  prices: ProductPrice[];
}

interface ProductPrice {
  price_level: string;
  price: number;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
}

interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  unit_id: string;
  quantity_requested: number;
  quantity_actual: number;
  conversion_factor: number;
  price_level: string;
  unit_price: number;
  total_price: number;
  created_at: string;
}

interface Order {
  id: string;
  customer_id: string | null;
  user_id: string | null;
  assigned_to_id: string | null;
  status: string;
  source: string;
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  shipping_cost: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  items: OrderItem[];
}

interface CartItem {
  id: string;
  productId: string;
  nameAr: string;
  quantity: number;
  unitId: string;
  priceLevel: string;
  availableUnits: ProductUnit[];
  unitPrice: number;
  totalPrice: number;
  unitName?: string;
  conversionFactor?: number;
  maxStock?: number;
}

const ORDER_STATUSES = [
  "New Lead", "Draft Order", "Waiting Quotation", "Quotation Sent", 
  "Waiting Customer Approval", "Approved", "Preparing", "Ready", 
  "Delivered", "Closed", "Cancelled", "Lost", "Returned"
];

const ORDER_SOURCES = [
  "WhatsApp", "Messenger", "Phone Call", "Walk-In Customer", "Manual Entry"
];

const STATUS_TABS = ["All", "Draft Order", "Waiting Quotation", "Approved", "Preparing", "Ready", "Delivered", "Closed", "Cancelled"];

const STATUS_MAP: Record<string, string> = {
  "All": "الكل",
  "New Lead": "عميل جديد",
  "Draft Order": "مسودة طلب",
  "Waiting Quotation": "في انتظار التسعير",
  "Quotation Sent": "تم إرسال عرض السعر",
  "Waiting Customer Approval": "بانتظار موافقة العميل",
  "Approved": "موافق عليه",
  "Preparing": "قيد التجهيز",
  "Ready": "جاهز",
  "Delivered": "تم التوصيل",
  "Closed": "مغلق",
  "Cancelled": "ملغي",
  "Lost": "مفقود",
  "Returned": "مسترجع"
};

const SOURCE_MAP: Record<string, string> = {
  "Walk-In Customer": "عميل مباشر",
  "WhatsApp": "واتساب",
  "Messenger": "ماسنجر",
  "Phone Call": "مكالمة هاتفية",
  "Manual Entry": "إدخال يدوي"
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("All");

  // Draft Slide-over State
  const [isSlideOverOpen, setIsSlideOverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedSource, setSelectedSource] = useState("Manual Entry");
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [availablePriceLevels, setAvailablePriceLevels] = useState<{value: string, label: string}[]>([]);

  useEffect(() => {
    fetchOrders();
    fetchCustomers();
    fetchPriceLevels();
  }, []);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const data = await fetchApi("/orders");
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCustomers = async () => {
    try {
      const data = await fetchApi("/customers");
      setCustomers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPriceLevels = async () => {
    try {
      const data = await fetchApi("/pos/price-levels");
      setAvailablePriceLevels(data);
    } catch (err) {
      setAvailablePriceLevels([
        { value: "Retail", label: "قطاعي (Retail)" },
        { value: "Semi Wholesale", label: "نصف جملة (Semi Wholesale)" },
        { value: "Wholesale", label: "جملة (Wholesale)" }
      ]);
    }
  };

  // ── Search Logic ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const data = await fetchApi("/pos/search?q=" + encodeURIComponent(searchQuery));
        setSearchResults(data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // ── Cart Logic ──────────────────────────────────────────────────────────
  const addToCart = (product: Product) => {
    if (!product.units || product.units.length === 0) {
      toast.error("هذا المنتج لا يحتوي على وحدات تسعير.");
      return;
    }
    
    const unit = product.units[0];
    const initialPriceLevel = unit.prices?.[0]?.price_level || "Retail"; 
    const priceObj = unit.prices?.find(p => p.price_level === initialPriceLevel);
    const unitPrice = priceObj ? Number(priceObj.price) : 0;

    setCart(prev => {
      const existingItem = prev.find(item => item.productId === product.id && item.unitId === unit.id && item.priceLevel === initialPriceLevel);
      if (existingItem) {
        return prev.map(item => 
          item.id === existingItem.id 
            ? { ...item, quantity: item.quantity + 1, totalPrice: item.unitPrice * (item.quantity + 1) } 
            : item
        );
      }
      
      return [...prev, {
        id: Math.random().toString(),
        productId: product.id,
        nameAr: product.name_ar,
        unitId: unit.id,
        unitName: unit.unit_name,
        quantity: 1,
        priceLevel: initialPriceLevel,
        unitPrice: unitPrice,
        totalPrice: unitPrice,
        conversionFactor: unit.conversion_factor,
        maxStock: product.current_stock || 0,
        availableUnits: product.units
      }];
    });

    setSearchQuery("");
    setSearchResults([]);
  };

  const removeCartItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const updateCartItemQuantity = (id: string, qty: number) => {
    if (qty <= 0) return removeCartItem(id);
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, quantity: qty, totalPrice: qty * item.unitPrice };
      }
      return item;
    }));
  };

  const updateCartItemUnit = (id: string, newUnitId: string) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const unit = item.availableUnits.find(u => u.id === newUnitId);
        if (!unit) return item;
        
        let pl = item.priceLevel;
        let pr = unit.prices?.find(p => p.price_level === pl);
        if (!pr && unit.prices && unit.prices.length > 0) {
          pl = unit.prices[0].price_level;
          pr = unit.prices[0];
        }
        
        const uPrice = pr ? pr.price : 0;
        return {
          ...item,
          unitId: newUnitId,
          priceLevel: pl,
          unitPrice: uPrice,
          totalPrice: uPrice * item.quantity
        };
      }
      return item;
    }));
  };

  const updateCartItemPriceLevel = (id: string, newLevel: string) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const unit = item.availableUnits.find(u => u.id === item.unitId);
        const pr = unit?.prices?.find(p => p.price_level === newLevel);
        if (pr) {
          return {
            ...item,
            priceLevel: newLevel,
            unitPrice: pr.price,
            totalPrice: pr.price * item.quantity
          };
        }
      }
      return item;
    }));
  };

  const cartSubtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const cartTotal = cartSubtotal + Number(shippingCost);

  const handleCreateDraft = async () => {
    if (cart.length === 0) {
      toast.error("السلة فارغة");
      return;
    }
    try {
      const payload = {
        customer_id: selectedCustomerId || null,
        source: selectedSource,
        status: "Draft Order",
        shipping_cost: Number(shippingCost),
        notes: notes,
        items: cart.map(item => ({
          product_id: item.productId,
          unit_id: item.unitId,
          quantity: item.quantity,
          price_level: item.priceLevel
        }))
      };

      await fetchApi("/orders/draft", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      toast.success("تم الحفظ بنجاح");
      setIsSlideOverOpen(false);
      setCart([]);
      setNotes("");
      setShippingCost(0);
      fetchOrders();
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ أثناء إنشاء الطلب");
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    let warehouse_id = null;
    if (newStatus === "Delivered" || newStatus === "Closed") {
      try {
        const wData = await fetchApi("/warehouses");
        if (wData.length > 0) {
          warehouse_id = wData[0].id;
        } else {
          toast.error("لا يوجد مخازن متاحة لصرف المخزون");
          return;
        }
      } catch (err) {
        toast.error("Error fetching warehouses");
        return;
      }
    }

    try {
      await fetchApi("/orders/" + orderId + "/status", {
        method: "PATCH",
        body: JSON.stringify({
          status: newStatus,
          warehouse_id: warehouse_id
        })
      });

      toast.success("تم تحديث حالة الطلب");
      fetchOrders();
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ");
    }
  };

  const filteredOrders = activeTab === "All" ? orders : orders.filter(o => o.status === activeTab);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case "WhatsApp": return <i className="bi bi-whatsapp text-green-500"></i>;
      case "Messenger": return <i className="bi bi-messenger text-blue-500"></i>;
      case "Phone Call": return <span className="material-symbols-outlined text-sm text-purple-400">call</span>;
      case "Walk-In Customer": return <span className="material-symbols-outlined text-sm text-yellow-400">directions_walk</span>;
      default: return <span className="material-symbols-outlined text-sm text-gray-400">edit_document</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    let colorClass = "bg-gray-500/20 text-gray-400 border-gray-500/30";
    if (status === "Delivered" || status === "Closed") colorClass = "bg-green-500/20 text-green-400 border-green-500/30";
    else if (status.includes("Quotation")) colorClass = "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    else if (status === "Approved" || status === "Preparing" || status === "Ready") colorClass = "bg-blue-500/20 text-blue-400 border-blue-500/30";
    else if (status === "Cancelled" || status === "Lost" || status === "Returned") colorClass = "bg-red-500/20 text-red-400 border-red-500/30";

    return (
      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${colorClass}`}>
        {STATUS_MAP[status] || status}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] overflow-hidden selection:bg-primary/30 flex" dir="rtl">
      <Head>
        <title>إدارة الطلبات | نظام المكتبة</title>
      </Head>
      <ToastContainer position="top-right" theme="dark" rtl={true} />

      <SideNav />

      <main className="flex-1 mr-[364px] ml-8 my-8 flex flex-col gap-6 h-[calc(100vh-64px)]">
        
        {/* Header */}
        <header className="glass rounded-2xl hi-fi-shadow border border-white/5 h-[80px] shrink-0 flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-black bg-gradient-to-l from-white to-white/50 bg-clip-text text-transparent">
              إدارة الطلبات
            </h1>
            <span className="px-3 py-1 bg-white/5 rounded-full text-xs text-white/50 border border-white/5">
              {filteredOrders.length} طلب
            </span>
          </div>
          <button 
            onClick={() => setIsSlideOverOpen(true)}
            className="h-11 px-6 bg-primary hover:bg-primary/90 text-black font-bold rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(255,180,171,0.2)] hover:shadow-[0_0_25px_rgba(255,180,171,0.4)]"
          >
            <span className="material-symbols-outlined text-xl">add</span>
            إنشاء طلب جديد
          </button>
        </header>

        {/* Tabs */}
        <div className="glass rounded-2xl hi-fi-shadow border border-white/5 px-6 py-4 shrink-0">
          <div className="flex overflow-x-auto gap-2 custom-scrollbar pb-2">
            {STATUS_TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === tab ? 'bg-primary text-black' : 'hover:bg-white/10 text-[#e2bfb0]/60 bg-white/5 border border-white/5'}`}
              >
                {STATUS_MAP[tab] || tab}
              </button>
            ))}
          </div>
        </div>

        {/* Data Table */}
        <div className="glass rounded-2xl hi-fi-shadow border border-white/5 flex-1 flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center flex-1">
              <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-[#e2bfb0]/40 gap-4">
              <span className="material-symbols-outlined text-6xl">inbox</span>
              <p className="text-xl">لا توجد طلبات</p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-right text-sm">
                <thead className="bg-black/20 text-[#e2bfb0]/60 sticky top-0 backdrop-blur-md border-b border-white/5">
                  <tr>
                    <th className="px-6 py-4 font-medium">رقم الطلب</th>
                    <th className="px-6 py-4 font-medium">العميل</th>
                    <th className="px-6 py-4 font-medium">المصدر</th>
                    <th className="px-6 py-4 font-medium">المبلغ الإجمالي</th>
                    <th className="px-6 py-4 font-medium">الحالة</th>
                    <th className="px-6 py-4 font-medium">التاريخ</th>
                    <th className="px-6 py-4 font-medium text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4 font-mono text-xs text-[#e2bfb0]/80">
                        {order.id.split('-')[0].toUpperCase()}
                      </td>
                      <td className="px-6 py-4 text-white font-medium">
                        {customers.find(c => c.id === order.customer_id)?.name || 'عميل مجهول'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {getSourceIcon(order.source)}
                          <span className="text-[#e2bfb0]/80">{SOURCE_MAP[order.source] || order.source}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-bold text-primary">
                        {order.total_amount.toFixed(2)} ج.م
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(order.status)}
                      </td>
                      <td className="px-6 py-4 text-[#e2bfb0]/60 text-xs">
                        {new Date(order.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 text-center relative">
                        <select
                          className="bg-[#131313] border border-white/10 rounded-lg text-xs px-2 py-1.5 text-white focus:outline-none focus:border-primary transition-colors cursor-pointer"
                          value={order.status}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                        >
                          <option value="" disabled>تغيير الحالة</option>
                          {ORDER_STATUSES.map(s => (
                            <option key={s} value={s}>{STATUS_MAP[s] || s}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Slide-over (Create Draft Order) */}
      {isSlideOverOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSlideOverOpen(false)}></div>
          <div className="w-[500px] h-full glass border-r border-white/5 shadow-2xl relative z-10 flex flex-col transform transition-transform duration-300">
            <div className="h-[80px] border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-black/20">
              <h2 className="text-xl font-bold text-white">إنشاء مسودة طلب</h2>
              <button onClick={() => setIsSlideOverOpen(false)} className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[#e2bfb0]/80">close</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-6">
              
              {/* Form Fields */}
              <div className="flex flex-col gap-4 bg-white/5 p-4 rounded-2xl border border-white/5">
                <div>
                  <label className="block text-xs text-[#e2bfb0]/60 mb-1.5">العميل</label>
                  <select 
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                  >
                    <option value="">-- إختر عميل --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e2bfb0]/60 mb-1.5">مصدر الطلب</label>
                  <select 
                    value={selectedSource}
                    onChange={(e) => setSelectedSource(e.target.value)}
                    className="w-full bg-[#131313] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                  >
                    {ORDER_SOURCES.map(s => <option key={s} value={s}>{SOURCE_MAP[s] || s}</option>)}
                  </select>
                </div>
              </div>

              {/* Product Search */}
              <div className="relative">
                <div className="absolute inset-y-0 right-0 pl-3 flex items-center justify-center w-12 pointer-events-none">
                  {isSearching ? (
                    <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                  ) : (
                    <span className="material-symbols-outlined text-[#e2bfb0]/40 text-lg">search</span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="ابحث عن منتج (الاسم، الباركود)..."
                  className="w-full h-12 bg-[#131313] border border-white/10 rounded-xl pr-12 pl-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                
                {searchResults.length > 0 && (
                  <div className="absolute top-14 left-0 right-0 bg-[#1c1b1b] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {searchResults.map(p => (
                      <div 
                        key={p.id} 
                        onClick={() => addToCart(p)}
                        className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3"
                      >
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-white/30">inventory_2</span>
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-sm text-white">{p.name_ar}</div>
                          <div className="text-xs text-white/40">{p.sku || p.barcode || 'بدون كود'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart Items */}
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold text-white/80 border-b border-white/5 pb-2">عناصر الطلب ({cart.length})</h3>
                {cart.length === 0 ? (
                  <div className="text-center text-white/30 py-8 text-sm">لا توجد منتجات مضافة</div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col gap-3 shadow-sm">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-[14px] text-white truncate flex-1 pl-2">{item.nameAr}</h4>
                        <button onClick={() => removeCartItem(item.id)} className="text-[#ffb4ab]/60 hover:text-[#ffb4ab] bg-[#ffb4ab]/5 hover:bg-[#ffb4ab]/15 rounded-lg p-1.5 transition-colors shrink-0">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2">
                        <select 
                          value={item.unitId}
                          onChange={(e) => updateCartItemUnit(item.id, e.target.value)}
                          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/90 focus:outline-none focus:border-primary flex-1 min-w-[70px]"
                        >
                          {item.availableUnits?.map(u => (
                            <option key={u.id} value={u.id} className="bg-[#1c1b1b]">{u.unit_name}</option>
                          ))}
                        </select>
                        <select 
                          value={item.priceLevel}
                          onChange={(e) => updateCartItemPriceLevel(item.id, e.target.value)}
                          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/90 focus:outline-none focus:border-primary flex-1 min-w-[100px]"
                        >
                          {item.availableUnits?.find(u => u.id === item.unitId)?.prices?.map(p => {
                            const plLabel = availablePriceLevels.find(l => l.value === p.price_level)?.label || p.price_level;
                            return (
                              <option key={p.price_level} value={p.price_level} className="bg-[#1c1b1b]">
                                {plLabel} - {p.price} ج.م
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      
                      <div className="flex items-center justify-between mt-1 pt-3 border-t border-white/5">
                        <div className="flex items-center gap-2 bg-[#131313] p-1 rounded-lg border border-white/10">
                          <button onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)} className="w-7 h-7 flex items-center justify-center hover:bg-white/10 text-white/70 rounded-md">
                            <span className="material-symbols-outlined text-sm">remove</span>
                          </button>
                          <span className="text-[14px] font-bold w-6 text-center text-primary">{item.quantity}</span>
                          <button onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)} className="w-7 h-7 flex items-center justify-center hover:bg-white/10 text-white/70 rounded-md">
                            <span className="material-symbols-outlined text-sm">add</span>
                          </button>
                        </div>
                        <span className="font-bold text-sm text-white">{item.totalPrice.toFixed(2)} ج.م</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Summary & Notes */}
              <div className="flex flex-col gap-4 mt-auto border-t border-white/5 pt-6 pb-20">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/50">المجموع الفرعي</span>
                  <span className="font-bold">{cartSubtotal.toFixed(2)} ج.م</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/50">تكلفة الشحن</span>
                  <input 
                    type="number" 
                    value={shippingCost}
                    onChange={(e) => setShippingCost(Number(e.target.value) || 0)}
                    className="w-24 bg-black border border-white/10 rounded-lg px-2 py-1 text-center text-white focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center justify-between text-lg mt-2 pt-2 border-t border-white/10">
                  <span className="text-white">الإجمالي</span>
                  <span className="font-black text-primary">{cartTotal.toFixed(2)} ج.م</span>
                </div>

                <div className="mt-2">
                  <label className="block text-xs text-white/50 mb-1.5">ملاحظات (اختياري)</label>
                  <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors resize-none custom-scrollbar"
                  ></textarea>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/50 backdrop-blur-md border-t border-white/5">
              <button 
                onClick={handleCreateDraft}
                disabled={cart.length === 0}
                className="w-full h-12 bg-primary hover:bg-primary/90 disabled:bg-primary/30 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(255,180,171,0.15)] flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">save</span>
                حفظ مسودة الطلب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
