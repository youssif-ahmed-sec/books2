"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { ReceiptPrint } from "@/components/pos/ReceiptPrint";
import { useReactToPrint } from "react-to-print";

interface ProductUnit {
  id: string;
  unit_name: string;
  conversion_factor: number;
  barcode: string;
  prices: { price_level: string; price: number }[];
}

interface Product {
  id: string;
  sku: string;
  barcode: string;
  name_ar: string;
  name_en: string;
  image_url: string;
  current_stock: number;
  units: ProductUnit[];
  category: { id: string; name_ar: string };
}

interface CartItem {
  id: string;
  productId: string;
  nameAr: string;
  unitId: string;
  unitName: string;
  quantity: number;
  priceLevel: string;
  unitPrice: number;
  totalPrice: number;
  conversionFactor: number;
  maxStock: number;
}

export default function POSPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [priceLevel, setPriceLevel] = useState("Retail");
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [isProcessing, setIsProcessing] = useState(false);

  // For printing
  const printRef = useRef<HTMLDivElement>(null);
  const [lastOrder, setLastOrder] = useState<any>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    onAfterPrint: () => {
      setCart([]);
      setDiscount(0);
      setLastOrder(null);
    }
  });

  const searchProducts = useCallback(async (query: string) => {
    if (!query) {
      setProducts([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchApi(`/pos/search?q=${encodeURIComponent(query)}&limit=20`);
      setProducts(res.data || res || []);
      
      // Auto-add if exact match for barcode
      const dataArr = res.data || res;
      if (dataArr?.length === 1 && (dataArr[0].barcode === query || dataArr[0].sku === query)) {
        addToCart(dataArr[0]);
        setSearchQuery("");
        setProducts([]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [priceLevel, cart]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery) searchProducts(searchQuery);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, searchProducts]);

  useEffect(() => {
    const loadCustomers = async () => {
      try {
        const data = await fetchApi("/customers");
        if (Array.isArray(data)) {
          setCustomers(data);
        } else if (data.data && Array.isArray(data.data)) {
          setCustomers(data.data);
        }
      } catch (err) {
        console.error("Failed to load customers", err);
      }
    };
    loadCustomers();
  }, []);

  const getPrice = (unit: ProductUnit, level: string) => {
    const p = unit.prices.find(pr => pr.price_level === level);
    return p ? Number(p.price) : 0;
  };

  const addToCart = (product: Product, selectedUnitId?: string) => {
    const unit = selectedUnitId 
      ? product.units.find(u => u.id === selectedUnitId) || product.units[0] 
      : product.units[0];

    if (!unit) return;

    const unitPrice = getPrice(unit, priceLevel);
    if (unitPrice === 0) {
      alert("لا يوجد تسعير لهذا الصنف بهذا المستوى.");
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id && item.unitId === unit.id);
      if (existing) {
        if ((existing.quantity + 1) * existing.conversionFactor > product.current_stock) {
          alert("لا يوجد مخزون كافٍ.");
          return prev;
        }
        return prev.map(item => 
          item.id === existing.id 
            ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice } 
            : item
        );
      } else {
        if (unit.conversion_factor > product.current_stock) {
          alert("لا يوجد مخزون كافٍ.");
          return prev;
        }
        return [...prev, {
          id: Math.random().toString(),
          productId: product.id,
          nameAr: product.name_ar,
          unitId: unit.id,
          unitName: unit.unit_name,
          quantity: 1,
          priceLevel: priceLevel,
          unitPrice: unitPrice,
          totalPrice: unitPrice,
          conversionFactor: unit.conversion_factor,
          maxStock: product.current_stock
        }];
      }
    });
  };

  const updateCartItemQuantity = (id: string, newQty: number) => {
    if (newQty <= 0) {
      setCart(prev => prev.filter(item => item.id !== id));
      return;
    }
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        if (newQty * item.conversionFactor > item.maxStock) {
          alert("لا يوجد مخزون كافٍ.");
          return item;
        }
        return { ...item, quantity: newQty, totalPrice: newQty * item.unitPrice };
      }
      return item;
    }));
  };

  const removeCartItem = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  // Recalculate prices when price level changes
  useEffect(() => {
    if (cart.length === 0) return;
    const fetchNewPrices = async () => {
      if (confirm("تغيير العميل أو مستوى السعر سيؤدي إلى تفريغ السلة، هل أنت متأكد؟")) {
        setCart([]);
      } else {
        setCart([]);
      }
    };
    setCart([]);
  }, [priceLevel, selectedCustomer]);

  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const totalAmount = Math.max(0, subtotal - discount);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    try {
      setIsProcessing(true);
      
      const payload: any = {
        warehouse_id: "00000000-0000-0000-0000-000000000000", // Will be overridden or ignored if single warehouse
        status: "Delivered",
        discount_amount: discount,
        payment_method: paymentMethod,
        items: cart.map(item => ({
          product_id: item.productId,
          unit_id: item.unitId,
          quantity: item.quantity,
          price_level: item.priceLevel
        }))
      };

      if (selectedCustomer) {
        payload.customer_id = selectedCustomer;
      }

      const balances = await fetchApi("/inventory/balances");
      if (balances.length > 0) {
        payload.warehouse_id = balances[0].warehouse_id;
      }

      const res = await fetchApi("/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setLastOrder({
        id: res.id,
        subtotal,
        discount,
        totalAmount
      });

      setTimeout(() => {
        handlePrint();
      }, 100);

    } catch (error: any) {
      alert("فشل إتمام الطلب: " + (error.message || "تأكد من المخزون"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] overflow-hidden selection:bg-primary/30 flex">
      <SideNav />

      <main className="flex-1 mr-[364px] ml-8 my-8 flex gap-6 h-[calc(100vh-64px)]">
        
        {/* RIGHT PANE: Cart & Checkout (Takes 1/3) */}
        <div className="w-[400px] flex flex-col gap-6">
          
          {/* Customer / Settings Panel */}
          <div className="glass p-6 rounded-2xl hi-fi-shadow flex flex-col gap-4 shrink-0">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person</span>
              بيانات العميل
            </h3>
            
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-[#e2bfb0]/60 uppercase">العميل</label>
                <select 
                  value={selectedCustomer}
                  onChange={(e) => {
                    const cid = e.target.value;
                    setSelectedCustomer(cid);
                    const cust = customers.find(c => c.id === cid);
                    if (cust && cust.price_level) {
                      setPriceLevel(cust.price_level);
                    }
                  }}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all cursor-pointer text-white"
                >
                  <option value="" className="bg-[#1c1b1b] text-white">بدون عميل (عميل نقدي)</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id} className="bg-[#1c1b1b] text-white">{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-[#e2bfb0]/60 uppercase">مستوى التسعير</label>
                <select 
                  value={priceLevel}
                  onChange={(e) => setPriceLevel(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all cursor-pointer text-white"
                >
                  <option value="Retail" className="bg-[#1c1b1b] text-white">قطاعي (Retail)</option>
                  <option value="Semi Wholesale" className="bg-[#1c1b1b] text-white">نصف جملة (Semi Wholesale)</option>
                  <option value="Wholesale" className="bg-[#1c1b1b] text-white">جملة (Wholesale)</option>
                  <option value="Super Wholesale" className="bg-[#1c1b1b] text-white">سوبر جملة (Super Wholesale)</option>
                  <option value="VIP" className="bg-[#1c1b1b] text-white">خاص (VIP)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Cart Panel */}
          <div className="glass rounded-2xl hi-fi-shadow flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">shopping_cart</span>
                سلة المشتريات
              </h3>
              <span className="bg-primary/20 text-primary px-3 py-1 rounded-full text-xs font-bold">
                {cart.length} أصناف
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-[#e2bfb0]/40 gap-4">
                  <span className="material-symbols-outlined text-6xl">production_quantity_limits</span>
                  <p>السلة فارغة</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {cart.map(item => (
                    <div key={item.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h4 className="font-bold text-sm truncate">{item.nameAr}</h4>
                          <p className="text-[10px] text-primary">{item.unitName} - {item.unitPrice} ج.م</p>
                        </div>
                        <button onClick={() => removeCartItem(item.id)} className="text-[#ffb4ab]/70 hover:text-[#ffb4ab] transition-colors">
                          <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 bg-[#131313] p-1 rounded-lg border border-white/10">
                          <button onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)} className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors">
                            <span className="material-symbols-outlined text-sm">remove</span>
                          </button>
                          <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                          <button onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)} className="w-6 h-6 flex items-center justify-center hover:bg-white/10 rounded-md transition-colors">
                            <span className="material-symbols-outlined text-sm">add</span>
                          </button>
                        </div>
                        <span className="font-bold">{item.totalPrice.toFixed(2)} ج.م</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checkout Totals */}
            <div className="p-6 border-t border-white/5 bg-black/20 shrink-0 flex flex-col gap-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#e2bfb0]/60">الإجمالي:</span>
                <span className="font-bold">{subtotal.toFixed(2)} ج.م</span>
              </div>
              
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#e2bfb0]/60 text-sm">الخصم:</span>
                <div className="relative w-24">
                  <input 
                    type="number" 
                    value={discount || ""}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="w-full bg-[#131313] border border-white/10 rounded-lg py-1 px-3 text-sm text-center focus:ring-1 focus:ring-primary focus:outline-none"
                    placeholder="0"
                  />
                  <span className="absolute left-2 top-1.5 text-xs text-[#e2bfb0]/40">ج.م</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-xl">
                <span className="font-black text-white">الصافي:</span>
                <span className="font-black text-primary">{totalAmount.toFixed(2)} ج.م</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <button 
                  onClick={() => setPaymentMethod("Cash")}
                  className={`py-2 rounded-lg text-sm font-bold transition-all ${paymentMethod === 'Cash' ? 'bg-white/20 text-white' : 'glass text-[#e2bfb0]/60 hover:bg-white/10'}`}
                >
                  نقدي
                </button>
                <button 
                  onClick={() => setPaymentMethod("Credit Card")}
                  className={`py-2 rounded-lg text-sm font-bold transition-all ${paymentMethod === 'Credit Card' ? 'bg-white/20 text-white' : 'glass text-[#e2bfb0]/60 hover:bg-white/10'}`}
                >
                  بطاقة
                </button>
              </div>

              <button 
                onClick={handleCheckout}
                disabled={cart.length === 0 || isProcessing}
                className="w-full mt-2 py-4 bg-primary text-white rounded-xl font-bold shadow-[0_0_15px_rgba(255,107,0,0.4)] hover:bg-primary/90 transition-all disabled:opacity-50 disabled:shadow-none flex justify-center items-center gap-2"
              >
                {isProcessing ? (
                  <span className="material-symbols-outlined animate-spin">sync</span>
                ) : (
                  <>
                    <span className="material-symbols-outlined">point_of_sale</span>
                    إتمام الطلب وطباعة
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* LEFT PANE: Search & Products Grid (Takes 2/3) */}
        <div className="flex-1 glass rounded-2xl hi-fi-shadow flex flex-col overflow-hidden">
          {/* Search Header */}
          <div className="p-6 border-b border-white/5 bg-black/10 shrink-0">
            <div className="relative">
              <span className="material-symbols-outlined absolute right-4 top-3.5 text-[#e2bfb0]/40">search</span>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالباركود، كود المنتج أو الاسم..."
                className="w-full bg-[#131313] border border-white/10 rounded-full py-4 pr-12 pl-6 text-white focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all placeholder:text-[#e2bfb0]/30"
              />
              <span className="material-symbols-outlined absolute left-4 top-3.5 text-primary opacity-50">barcode_scanner</span>
            </div>
          </div>

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <span className="material-symbols-outlined animate-spin text-4xl text-primary">sync</span>
              </div>
            ) : products.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {products.map(product => (
                  <div 
                    key={product.id} 
                    onClick={() => addToCart(product)}
                    className="bg-white/5 border border-white/5 rounded-2xl p-4 hover:bg-white/10 hover:border-primary/30 transition-all cursor-pointer group flex flex-col gap-3 relative overflow-hidden"
                  >
                    {product.current_stock <= 0 && (
                      <div className="absolute top-0 right-0 left-0 bg-[#ffb4ab]/20 text-[#ffb4ab] text-[10px] text-center font-bold py-0.5">
                        نفد المخزون
                      </div>
                    )}
                    
                    <div className="w-full h-24 bg-[#131313] rounded-xl flex items-center justify-center p-2 mt-2 border border-white/5">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name_ar} className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="material-symbols-outlined text-4xl text-[#e2bfb0]/20">image</span>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col">
                      <h4 className="font-bold text-sm text-white line-clamp-2 leading-snug">{product.name_ar}</h4>
                      <p className="text-[10px] text-[#e2bfb0]/60 mt-1">{product.category?.name_ar || "عام"}</p>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                      <span className="font-bold text-primary">{getPrice(product.units[0], priceLevel)} ج</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${product.current_stock > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {product.current_stock}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : searchQuery ? (
              <div className="h-full flex flex-col items-center justify-center text-[#e2bfb0]/40">
                <p>لم يتم العثور على نتائج</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[#e2bfb0]/20">
                <span className="material-symbols-outlined text-6xl mb-4">barcode_scanner</span>
                <p>مرر الباركود أو ابحث لإضافة المنتجات</p>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* Hidden Print Component */}
      <ReceiptPrint ref={printRef} order={lastOrder} items={cart} />
      
    </div>
  );
}
