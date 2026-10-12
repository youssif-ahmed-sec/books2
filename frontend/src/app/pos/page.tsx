"use client";

import { notifyError } from "@/lib/notifications";

import { useEffect, useState, useRef, useCallback } from "react";
import Image from "next/image";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { ReceiptPrint } from "@/components/pos/ReceiptPrint";
import { sendLocalPrint } from "@/lib/localPrint";
import { errorMessage } from "@/lib/errors";
import { getUserRole, type UserRole } from "@/utils/auth";
import { armUiSound, playUiSound } from "@/lib/uiSounds";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

interface CheckoutPayload {
  warehouse_id: string;
  status: string;
  source: string;
  discount_amount: number;
  payment_method: string;
  items: { product_id: string; unit_id: string; quantity: number; price_level: string }[];
  customer_id?: string;
  request_id?: string;
}

interface PrintedOrder { id: string; subtotal: number; discount: number; totalAmount: number; customerName?: string }

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
  base_unit: string;
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
  availableUnits: ProductUnit[];
}

type PosReferenceSnapshot = {
  customers: { id: string; name: string; price_level: string; balance: number; credit_limit: number }[];
  priceLevels: { value: string; label: string }[];
  warehouses: { id: string; name: string }[];
};

export default function POSPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>([]);
  const scanInFlight = useRef<string | null>(null);
  const [availablePriceLevels, setAvailablePriceLevels] = useState<{value: string, label: string}[]>(() => readSectionSnapshot<PosReferenceSnapshot>("pos-reference")?.priceLevels || []);
  const [customers, setCustomers] = useState<{ id: string; name: string; price_level: string; balance: number; credit_limit: number }[]>(() => readSectionSnapshot<PosReferenceSnapshot>("pos-reference")?.customers || []);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>(() => readSectionSnapshot<PosReferenceSnapshot>("pos-reference")?.warehouses || []);
  const [warehouseId, setWarehouseId] = useState(() => {
    const previous = readSectionSnapshot<PosReferenceSnapshot>("pos-reference")?.warehouses || [];
    return previous.length === 1 ? previous[0].id : "";
  });
  const [isProcessing, setIsProcessing] = useState(false);

  // For printing
  const checkoutRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const [lastOrder, setLastOrder] = useState<PrintedOrder | null>(null);
  const [lastPrintJob, setLastPrintJob] = useState<Record<string, unknown> | null>(null);
  const [receiptItems, setReceiptItems] = useState<CartItem[]>([]);
  const [printStatus, setPrintStatus] = useState("");
  const [isSendingReceipt, setIsSendingReceipt] = useState(false);

  useEffect(() => { cartRef.current = cart; }, [cart]);

  const reprintReceipt = async () => {
    if (!lastPrintJob || isSendingReceipt) return;
    setIsSendingReceipt(true);
    setPrintStatus("جاري إرسال الفاتورة لتطبيق الطباعة المحلي...");
    try {
      await sendLocalPrint(lastPrintJob, "customer");
      setPrintStatus("أُرسلت الفاتورة لتطبيق الطباعة. راجع الطباعة الفعلية.");
    } catch (cause) {
      setPrintStatus(errorMessage(cause, "تعذر إرسال الفاتورة لتطبيق الطباعة المحلي."));
    } finally {
      setIsSendingReceipt(false);
    }
  };

  useEffect(() => {
    const roleTimer = window.setTimeout(() => setUserRole(getUserRole()), 0);
    const loadData = async () => {
      try {
        const [customersData, priceLevelsData, warehouseData] = await Promise.all([
          fetchApi("/customers"),
          fetchApi("/pos/price-levels"),
          fetchApi("/inventory/warehouses")
        ]);
        setWarehouses(warehouseData);
        if (warehouseData.length === 1) setWarehouseId(warehouseData[0].id);

        const loadedCustomers = Array.isArray(customersData) ? customersData : Array.isArray(customersData.data) ? customersData.data : [];
        setCustomers(loadedCustomers);

        const loadedLevels = Array.isArray(priceLevelsData) ? priceLevelsData : [];
        if (loadedLevels.length > 0) setAvailablePriceLevels(loadedLevels);
        writeSectionSnapshot("pos-reference", { customers: loadedCustomers, priceLevels: loadedLevels, warehouses: warehouseData });
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };
    void loadData();
    return () => window.clearTimeout(roleTimer);
  }, []);

  const getPrice = useCallback((unit: ProductUnit, level: string) => {
    const p = unit.prices.find(pr => pr.price_level === level);
    return p ? Number(p.price) : 0;
  }, []);

  const applyCustomerPrice = (customerId: string) => {
    const level = customers.find(customer => customer.id === customerId)?.price_level || "Retail";
    if (cart.some(item => !item.availableUnits.find(candidate => candidate.id === item.unitId)?.prices.some(price => price.price_level === level))) {
      notifyError("بعض الأصناف في السلة لا تحتوي على سعر لشريحة هذا العميل. أضف السعر أولًا أو اطلب تدخل المدير.");
      return;
    }
    setSelectedCustomer(customerId);
    if (!customerId && paymentMethod === "Deferred Payment") setPaymentMethod("Cash");
    setCart(previous => previous.map(item => {
      const unit = item.availableUnits.find(candidate => candidate.id === item.unitId);
      const price = unit?.prices.find(candidate => candidate.price_level === level);
      return price
        ? { ...item, priceLevel: level, unitPrice: Number(price.price), totalPrice: item.quantity * Number(price.price) }
        : item;
    }));
  };

  const addToCart = useCallback((product: Product, selectedUnitId?: string): boolean => {
    const unit = selectedUnitId 
      ? product.units.find(u => u.id === selectedUnitId) || product.units.find(u => u.unit_name === product.base_unit) || product.units[0]
      : product.units.find(u => u.unit_name === product.base_unit) || product.units[0];

    if (!unit) return false;

    const customerLevel = customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail";
    let targetLevel = unit.prices.find(p => p.price_level === customerLevel)?.price_level;
    if (!targetLevel && userRole !== "ADMIN") {
      notifyError("لا يوجد سعر لهذه الوحدة في شريحة العميل المحددة.");
      return false;
    }
    if (!targetLevel && unit.prices.length > 0) {
      targetLevel = unit.prices[0].price_level;
    }

    if (!targetLevel) {
      notifyError("لا يوجد أسعار لهذه الوحدة.");
      return false;
    }

    const unitPrice = getPrice(unit, targetLevel);
    if (unitPrice === 0) {
      notifyError("السعر صفر لهذه الوحدة.");
      return false;
    }

    const previous = cartRef.current;
    const reserved = previous.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity * item.conversionFactor, 0);
    if (reserved + unit.conversion_factor > product.current_stock) {
      notifyError("لا يوجد مخزون كافٍ.");
      return false;
    }
    const existing = previous.find(item => item.productId === product.id && item.unitId === unit.id);
    const next = existing
      ? previous.map(item => item.id === existing.id
          ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice }
          : item)
      : [...previous, {
          id: Math.random().toString(),
          productId: product.id,
          nameAr: product.name_ar,
          unitId: unit.id,
          unitName: unit.unit_name,
          quantity: 1,
          priceLevel: targetLevel,
          unitPrice: unitPrice,
          totalPrice: unitPrice,
          conversionFactor: unit.conversion_factor,
          maxStock: product.current_stock,
          availableUnits: product.units
        }];
    cartRef.current = next;
    setCart(next);
    return true;
  }, [getPrice, customers, selectedCustomer, userRole]);

  const searchProducts = useCallback(async (query: string, scanned = false) => {
    if (!query) {
      setProducts([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchApi(`/pos/search?q=${encodeURIComponent(query)}&limit=20`);
      const dataArr: Product[] = res.data || res || [];
      setProducts(dataArr);
      const exactUnitMatches = dataArr.flatMap(product => product.units.filter(unit => unit.barcode === query).map(unit => ({ product, unit })));
      const exactProductMatches = dataArr.filter(product => product.barcode === query || product.sku === query);
      if (exactUnitMatches.length === 1 && exactProductMatches.length === 0) {
        const added = addToCart(exactUnitMatches[0].product, exactUnitMatches[0].unit.id);
        playUiSound(added ? "scanSuccess" : "scanFailure");
        if (added) { setSearchQuery(""); setProducts([]); }
      } else if (exactUnitMatches.length === 0 && exactProductMatches.length === 1) {
        const added = addToCart(exactProductMatches[0]);
        playUiSound(added ? "scanSuccess" : "scanFailure");
        if (added) { setSearchQuery(""); setProducts([]); }
      } else if (exactUnitMatches.length + exactProductMatches.length > 1) {
        notifyError("الباركود مطابق لأكثر من منتج أو وحدة. راجع الباركود المسجل قبل البيع.");
        if (scanned) playUiSound("scanFailure");
      } else if (scanned) {
        playUiSound("scanFailure");
      }
    } catch (error) {
      console.error(error);
      if (scanned) playUiSound("scanFailure");
    } finally {
      if (scanned) scanInFlight.current = null;
      setLoading(false);
    }
  }, [addToCart]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery && scanInFlight.current !== searchQuery) searchProducts(searchQuery);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, searchProducts]);

  const updateCartItemUnit = (id: string, newUnitId: string) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newUnit = item.availableUnits.find(u => u.id === newUnitId);
        if (!newUnit) return item;

        let targetLevel = item.priceLevel;
        if (!newUnit.prices.find(p => p.price_level === targetLevel)) {
          targetLevel = newUnit.prices.find(p => p.price_level === "Retail")?.price_level || (newUnit.prices.length > 0 ? newUnit.prices[0].price_level : "");
        }

        const unitPrice = getPrice(newUnit, targetLevel);
        if (unitPrice === 0) {
          notifyError("لا يوجد أسعار لهذه الوحدة.");
          return item;
        }

        const reservedOtherUnits = prev.filter(other => other.productId === item.productId && other.id !== id).reduce((sum, other) => sum + other.quantity * other.conversionFactor, 0);
        if (reservedOtherUnits + item.quantity * newUnit.conversion_factor > item.maxStock) {
          notifyError("لا يوجد مخزون كافٍ لهذه الوحدة بالكمية المحددة.");
          return item;
        }

        return {
          ...item,
          unitId: newUnit.id,
          unitName: newUnit.unit_name,
          priceLevel: targetLevel,
          unitPrice: unitPrice,
          totalPrice: item.quantity * unitPrice,
          conversionFactor: newUnit.conversion_factor
        };
      }
      return item;
    }));
  };

  const updateCartItemPriceLevel = (id: string, newLevel: string) => {
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const unit = item.availableUnits.find(u => u.id === item.unitId);
        if (!unit) return item;

        const unitPrice = getPrice(unit, newLevel);
        if (unitPrice === 0) return item;

        return {
          ...item,
          priceLevel: newLevel,
          unitPrice: unitPrice,
          totalPrice: item.quantity * unitPrice
        };
      }
      return item;
    }));
  };

  const updateCartItemQuantity = (id: string, newQty: number) => {
    if (!Number.isInteger(newQty)) return;
    if (newQty <= 0) {
      setCart(prev => prev.filter(item => item.id !== id));
      return;
    }
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const reservedOtherUnits = prev.filter(other => other.productId === item.productId && other.id !== id).reduce((sum, other) => sum + other.quantity * other.conversionFactor, 0);
        if (reservedOtherUnits + newQty * item.conversionFactor > item.maxStock) {
          notifyError("لا يوجد مخزون كافٍ.");
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

  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const totalAmount = Math.max(0, subtotal - discount);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!warehouseId) { notifyError("اختر المخزن قبل إتمام البيع"); return; }
    try {
      setIsProcessing(true);
      
      const payload: CheckoutPayload = {
        warehouse_id: warehouseId,
        status: "Delivered",
        source: "Walk-In Customer",
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

      const fingerprint = JSON.stringify(payload);
      if (checkoutRequest.current?.fingerprint !== fingerprint) {
        checkoutRequest.current = { fingerprint, id: crypto.randomUUID() };
      }
      payload.request_id = checkoutRequest.current.id;

      const res = await fetchApi("/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      playUiSound("saleComplete");

      setLastOrder({
        id: res.id,
        subtotal,
        discount,
        totalAmount,
        customerName: customers.find(customer => customer.id === selectedCustomer)?.name,
      });
      setReceiptItems(cart.map(item => ({ ...item })));
      setPrintStatus("جاري إرسال الفاتورة للطابعة...");

      if (paymentMethod === "Deferred Payment" && selectedCustomer) {
        fetchApi("/customers").then(setCustomers).catch(console.error);
      }
      const receiptJob = {
        id: res.id,
        order_number: res.id,
        created_at: new Date().toISOString(),
        cashier_name: "الكاشير",
        subtotal,
        discount_amount: discount,
        total_amount: totalAmount,
        cart: cart.map(c => ({
          qty: c.quantity,
          price: c.unitPrice,
          name: `${c.nameAr || "صنف غير معروف"} (${c.unitName})`,
        })),
      };
      setLastPrintJob(receiptJob);
      // Auto-print to local agent
      setIsSendingReceipt(true);
      try {
        await sendLocalPrint(receiptJob, "customer");
        setPrintStatus("أُرسلت الفاتورة للطابعة. راجع الطباعة الفعلية.");
      } catch (printErr) {
        console.warn("Print agent failed", printErr);
        setPrintStatus(errorMessage(printErr, "تعذر إرسال الفاتورة لتطبيق الطباعة المحلي."));
      } finally {
        setIsSendingReceipt(false);
      }
      setCart([]);
      cartRef.current = [];
      setDiscount(0);
      checkoutRequest.current = null;

    } catch (error: unknown) {
      notifyError("فشل إتمام الطلب: " + errorMessage(error, "تأكد من المخزون"));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#131313] text-[#e5e2e1] overflow-x-hidden selection:bg-primary/30 flex">
      <SideNav />
      <TopNav title="نقطة البيع" />

      <main className="mx-4 mb-8 mt-28 flex min-w-0 flex-1 flex-col gap-6 lg:ml-8 lg:mr-[364px] lg:mt-36 xl:h-[calc(100vh-176px)] xl:flex-row">
        
        {/* RIGHT PANE: Cart & Checkout (Takes 1/3) */}
        <div className="w-full flex flex-col gap-6 xl:w-[400px] xl:shrink-0">
          
          {/* Customer / Settings Panel */}
          <div className="glass p-6 rounded-2xl hi-fi-shadow flex flex-col gap-4 shrink-0">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person</span>
              بيانات العميل
            </h3>
            <label className="text-sm">مخزن البيع<select className="mt-2 w-full rounded-xl bg-black p-3" value={warehouseId} onChange={event => setWarehouseId(event.target.value)}><option value="">اختر المخزن</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
            
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-[#e2bfb0]/80">العميل</label>
                <select 
                  value={selectedCustomer}
                  onChange={(e) => applyCustomerPrice(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/40 focus:outline-none transition-all cursor-pointer text-white"
                >
                  <option value="" className="bg-[#1c1b1b] text-white">بدون عميل (عميل نقدي)</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id} className="bg-[#1c1b1b] text-white">{c.name}</option>
                  ))}
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
                    <div key={item.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col gap-3 shadow-sm">
                      {/* Top Row: Name and Delete */}
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-[15px] text-white truncate flex-1 pl-2">{item.nameAr}</h4>
                        <button onClick={() => removeCartItem(item.id)} className="text-[#ffb4ab]/60 hover:text-[#ffb4ab] bg-[#ffb4ab]/5 hover:bg-[#ffb4ab]/15 rounded-lg p-1.5 transition-colors shrink-0">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                      
                      {/* Middle Row: Dropdowns */}
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="flex flex-1 min-w-[90px] flex-col gap-1 text-xs text-[#e2bfb0]">الوحدة
                        <select
                          value={item.unitId}
                          onChange={(e) => updateCartItemUnit(item.id, e.target.value)}
                          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-white/90 focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer transition-colors hover:bg-black/60 flex-1 min-w-[80px]"
                        >
                          {item.availableUnits.map(u => (
                            <option key={u.id} value={u.id} className="bg-[#1c1b1b] text-white">
                              {u.unit_name}
                            </option>
                          ))}
                        </select></label>
                        <label className="flex flex-1 min-w-[120px] flex-col gap-1 text-xs text-[#e2bfb0]">فئة السعر
                        <select
                          value={item.priceLevel}
                          onChange={(e) => updateCartItemPriceLevel(item.id, e.target.value)}
                          disabled={userRole !== "ADMIN"}
                          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-white/90 focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer transition-colors hover:bg-black/60 flex-1 min-w-[120px]"
                        >
                          {item.availableUnits.find(u => u.id === item.unitId)?.prices.map(p => {
                            const plLabel = availablePriceLevels.find(l => l.value === p.price_level)?.label || p.price_level;
                            return (
                              <option key={p.price_level} value={p.price_level} className="bg-[#1c1b1b] text-white">
                                {plLabel} - {p.price} ج.م
                              </option>
                            );
                          })}
                        </select></label>
                      </div>
                      
                      {/* Bottom Row: Quantity & Total */}
                      <div className="flex items-center justify-between mt-1 pt-3 border-t border-white/5">
                        <div className="flex items-center gap-2 bg-[#131313] p-1.5 rounded-lg border border-white/10 shadow-inner">
                          <button type="button" aria-label={`تقليل كمية ${item.nameAr}`} onClick={() => updateCartItemQuantity(item.id, item.quantity - 1)} className="w-10 h-10 flex items-center justify-center hover:bg-white/10 text-white rounded-md transition-colors">
                            <span className="material-symbols-outlined text-lg">remove</span>
                          </button>
                          <input type="number" inputMode="numeric" min="1" step="1" aria-label={`كمية ${item.nameAr} بال${item.unitName}`} value={item.quantity} onFocus={event => event.currentTarget.select()} onBlur={event => { event.currentTarget.value = String(item.quantity); }} onChange={event => {
                            const quantity = Number(event.target.value);
                            if (Number.isInteger(quantity) && quantity > 0) updateCartItemQuantity(item.id, quantity);
                          }} className="w-16 h-10 rounded-md border border-white/20 bg-[#201f1f] text-center text-lg font-bold text-primary focus:ring-2 focus:ring-primary/50" />
                          <button type="button" aria-label={`زيادة كمية ${item.nameAr}`} onClick={() => updateCartItemQuantity(item.id, item.quantity + 1)} className="w-10 h-10 flex items-center justify-center hover:bg-white/10 text-white rounded-md transition-colors">
                            <span className="material-symbols-outlined text-lg">add</span>
                          </button>
                        </div>
                        <span className="font-bold text-lg text-white tracking-wide">{item.totalPrice.toFixed(2)} <span className="text-xs text-white/50 font-normal">ج.م · {item.unitPrice.toFixed(2)} / {item.unitName}</span></span>
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
                    disabled={userRole !== "ADMIN"}
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
                {([
                  ["Cash", "نقدي"], ["Credit Card", "بطاقة"],
                  ["Vodafone Cash", "فودافون كاش"], ["Instapay", "إنستاباي"],
                  ["Bank Transfer", "تحويل بنكي"], ["Deferred Payment", "بيع آجل"],
                ] as const).map(([method, label]) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    disabled={method === "Deferred Payment" && !selectedCustomer}
                    className={`py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40 ${paymentMethod === method ? "bg-white/20 text-white" : "glass text-[#e2bfb0]/60 hover:bg-white/10"}`}
                  >{label}</button>
                ))}
              </div>
              {selectedCustomer && paymentMethod === "Deferred Payment" && (() => {
                const customer = customers.find(candidate => candidate.id === selectedCustomer);
                const available = Number(customer?.credit_limit || 0) - Number(customer?.balance || 0);
                return <p className="text-xs app-muted">المتاح من حد العميل: {available.toFixed(2)} ج.م</p>;
              })()}

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
                onKeyDown={(event) => {
                  const code = event.currentTarget.value.trim();
                  if (event.key === "Enter" && code) {
                    event.preventDefault();
                    if (scanInFlight.current === code) return;
                    scanInFlight.current = code;
                    armUiSound();
                    void searchProducts(code, true);
                  }
                }}
                placeholder="ابحث بالباركود، كود المنتج أو الاسم..."
                className="app-search-focus w-full bg-[#131313] border border-white/10 rounded-full py-4 pr-12 pl-6 text-white transition-all placeholder:text-[#e2bfb0]/30"
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
                      <div className="absolute top-0 right-0 left-0 bg-[#ffb4ab]/20 text-[#ffb4ab] text-xs text-center font-bold py-0.5">
                        نفد المخزون
                      </div>
                    )}
                    
                    <div className="w-full h-24 bg-[#131313] rounded-xl flex items-center justify-center p-2 mt-2 border border-white/5">
                      {product.image_url ? (
                        <Image src={product.image_url} alt={product.name_ar} width={96} height={96} className="max-w-full max-h-full object-contain" unoptimized />
                      ) : (
                        <span className="material-symbols-outlined text-4xl text-[#e2bfb0]/20">image</span>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col">
                      <h4 className="font-bold text-sm text-white line-clamp-2 leading-snug">{product.name_ar}</h4>
                      <p className="text-xs text-[#e2bfb0]/80 mt-1">{product.category?.name_ar || "عام"}</p>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                      <span className="font-bold text-primary">
                        {(() => { const baseUnit = product.units.find(unit => unit.unit_name === product.base_unit) || product.units[0]; return baseUnit?.prices.find(price => price.price_level === "Retail")?.price || baseUnit?.prices[0]?.price || 0; })()} ج.م / {product.base_unit}
                      </span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${product.current_stock > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
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

      {lastOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="فاتورة البيع">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-[#1c1b1b] p-5 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">فاتورة البيع</h2>
              <button type="button" onClick={() => { setLastOrder(null); setLastPrintJob(null); setReceiptItems([]); }} aria-label="إغلاق الفاتورة" className="rounded-lg p-2 hover:bg-white/10">✕</button>
            </div>
            <div className="overflow-y-auto rounded-xl bg-white p-3 text-black">
              <ReceiptPrint order={lastOrder} items={receiptItems} />
            </div>
            <p className="mt-3 text-sm text-[#e2bfb0]">{printStatus}</p>
            <button type="button" onClick={reprintReceipt} disabled={!lastPrintJob || isSendingReceipt} className="mt-3 rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">{isSendingReceipt ? "جارٍ الإرسال..." : "إرسال الفاتورة لتطبيق الطباعة"}</button>
          </div>
        </div>
      )}
      
    </div>
  );
}
