"use client";

import { notifyError } from "@/lib/notifications";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { ReceiptPrint } from "@/components/pos/ReceiptPrint";
import { sendLocalPrint } from "@/lib/localPrint";
import { errorMessage } from "@/lib/errors";
import { posCheckoutError } from "@/lib/posCheckoutErrors";
import { getUserRole, type UserRole } from "@/utils/auth";
import { armUiSound, playUiSound } from "@/lib/uiSounds";
import { getCurrentUser } from "@/lib/currentUser";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { ProductSelect } from "@/components/ProductSelect";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { emptyBarcodeScanCapture, englishBarcodeFromArabicLayout, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";

interface CheckoutPayload {
  warehouse_id: string;
  status: string;
  source: string;
  discount_amount: number;
  discount_percent?: number;
  shipping_cost: number;
  expected_total: number;
  payment_method: string;
  amount_received?: number;
  received_method?: string;
  expected_collection_method?: string;
  items: { product_id: string; unit_id: string; quantity: number; price_level: string }[];
  customer_id?: string;
  customer_address?: string;
  request_id?: string;
}
interface CompletedCheckout {
  id: string; public_number: number; created_at: string; payment_method: string; source: string;
  customer_address?: string | null;
  discount_amount: number; discount_percent?: number | null; wallet_fee_amount?: number; shipping_cost: number; expected_collection_method?: string | null; total_amount: number;
  items: { product_id: string; unit_id: string; price_level: string; quantity_requested: number; unit_price: number; total_price: number }[];
}

interface PrintedOrder { id: string; publicNumber: number; createdAt: string; employeeName: string; paymentMethod: string; receivedMethod?: string; expectedCollectionMethod?: string; subtotal: number; discount: number; discountPercent?: number | null; walletFee?: number; shippingCost?: number; totalAmount: number; isDelivery?: boolean; customerName?: string; customerPhone?: string; customerAddress?: string; amountReceived?: number; remainingAmount?: number }

interface ProductUnit {
  id: string;
  unit_name: string;
  conversion_factor: number;
  barcode: string;
  prices: { price_level: string; price: number }[];
}

interface Product {
  id: string;
  is_bundle: boolean;
  category_id?: string | null;
  subcategory_id?: string | null;
  brand_id?: string | null;
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

type CatalogSnapshot = { key: string; at: number; products: Product[]; hasMore: boolean; query: string; categoryId: string; subcategoryId: string; brandId: string; productKind: "all" | "products" | "offers" };
const catalogKey = (warehouseId: string, query: string, categoryId: string, subcategoryId: string, brandId: string, productKind: string) =>
  JSON.stringify([warehouseId, query, categoryId, subcategoryId, brandId, productKind]);

interface FallbackProduct extends Product {
  is_active: boolean;
  is_bundle: boolean;
  bundle_components: { component_id: string; quantity: number }[];
}

async function searchAdminInventory(query: string, warehouseId: string, offset = 0, categoryId = "", subcategoryId = "", brandId = "", productKind: "all" | "products" | "offers" = "all"): Promise<Product[]> {
  const [catalog, balances] = await Promise.all([
    fetchApi(`/products?search=${encodeURIComponent(query)}&skip=${offset}&limit=50${categoryId ? `&category_id=${encodeURIComponent(categoryId)}` : ""}${productKind !== "all" ? `&is_bundle=${productKind === "offers"}` : ""}`, { silentErrors: true }),
    fetchApi(`/inventory/balances?warehouse_id=${encodeURIComponent(warehouseId)}`, { silentErrors: true }),
  ]);
  const stockByProduct = new Map<string, number>();
  for (const balance of balances as { product_id: string; current_stock: number }[]) {
    stockByProduct.set(balance.product_id, Number(balance.current_stock) || 0);
  }
  return (catalog.data as FallbackProduct[])
    .filter(product => product.is_active && (!subcategoryId || product.subcategory_id === subcategoryId) && (!brandId || product.brand_id === brandId))
    .map(product => {
      const stock = product.is_bundle
        ? product.bundle_components.length
          ? Math.min(...product.bundle_components.map(component =>
              Math.floor((stockByProduct.get(component.component_id) || 0) / Number(component.quantity))))
          : 0
        : stockByProduct.get(product.id) || 0;
      return { ...product, current_stock: Number.isFinite(stock) ? Math.max(0, stock) : 0 };
    })
    .filter(product => productKind !== "offers" || product.current_stock > 0);
}

interface CartItem {
  id: string;
  productId: string;
  isBundle: boolean;
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

interface PosDraft {
  savedAt: number;
  cart: CartItem[];
  warehouseId: string;
  selectedCustomer: string;
  discountPercent?: number;
  discount?: number;
  paymentMethod: string;
  cashReceived: string;
  expectedCollectionMethod?: string;
  isCreditSale?: boolean;
  isDelivery?: boolean;
  deliveryFee?: string;
  saleCustomerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerType?: string;
  checkoutRequest: { fingerprint: string; id: string } | null;
}

interface HeldCart { id: string; savedAt: number; draft: PosDraft }
interface PendingCheckout { savedAt: number; draft: PosDraft; payload: CheckoutPayload }

const draftKey = (userId: string) => `pos-draft:${userId}`;
const heldKey = (userId: string) => `pos-held:${userId}`;
const attemptKey = (userId: string) => `pos-attempt:${userId}`;
const draftLifetimeMs = 30 * 60 * 1000;
const heldLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const timestamp = () => Date.now();
const validCart = (items: unknown): items is CartItem[] => Array.isArray(items) && items.length > 0 &&
  items.every(item => item && typeof item.productId === "string" && typeof item.unitId === "string" &&
    Array.isArray(item.availableUnits) && Number.isInteger(item.quantity) && item.quantity > 0);
const readHeldCarts = (userId: string): HeldCart[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(heldKey(userId)) || "[]");
    return Array.isArray(value) ? value.filter((row): row is HeldCart =>
      Boolean(row && typeof row.id === "string" && typeof row.savedAt === "number" &&
        Date.now() - row.savedAt < heldLifetimeMs && row.draft && validCart(row.draft.cart))) : [];
  } catch { return []; }
};
const posPaymentMethods = ["Cash", "Instapay", "Wallet", "Credit Card"] as const;
const customerTypes = [
  { value: "Retail Customer", label: "عميل تجزئة" },
  { value: "Student", label: "طالب" },
  { value: "Teacher", label: "مدرس" },
  { value: "School", label: "مدرسة" },
  { value: "NURSERY", label: "حضانة" },
  { value: "Speech Therapy Center", label: "مركز تخاطب" },
  { value: "Wholesale Customer", label: "عميل جملة" },
  { value: "Super Wholesale Customer", label: "عميل سوبر جملة" },
  { value: "VIP Customer", label: "عميل VIP" },
];
const priceLevels = [
  { value: "Retail", label: "مستهلك" },
  { value: "Semi Wholesale", label: "نصف جملة" },
  { value: "Wholesale", label: "جملة" },
  { value: "Super Wholesale", label: "سوبر جملة" },
  { value: "VIP", label: "كبار العملاء" },
];
const defaultCustomerPriceLevel = (type: string) =>
  type === "Wholesale Customer" ? "Wholesale" :
  type === "Super Wholesale Customer" ? "Super Wholesale" :
  type === "VIP Customer" ? "VIP" : "Retail";
type PosCustomer = { id: string; name: string; phone?: string | null; address?: string | null; addresses?: string[]; customer_type?: string; price_level: string; balance: number; credit_limit: number };

export default function POSPage() {
  const confirmAction = useConfirmAction();
  const [catalogInitial] = useState(() => readSectionSnapshot<CatalogSnapshot>("pos-catalog"));
  const catalogCache = useRef<CatalogSnapshot | null>(catalogInitial);
  const [searchQuery, setSearchQuery] = useState(() => catalogInitial?.query || "");
  const [products, setProducts] = useState<Product[]>(() => catalogInitial?.products || []);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreProducts, setHasMoreProducts] = useState(() => catalogInitial?.hasMore || false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name_ar: string }[]>([]);
  const [subcategories, setSubcategories] = useState<{ id: string; category_id: string; name_ar: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name_ar: string }[]>([]);
  const [categoryId, setCategoryId] = useState(() => catalogInitial?.categoryId || "");
  const [productKind, setProductKind] = useState<"all" | "products" | "offers">(() => catalogInitial?.productKind || "all");
  const [subcategoryId, setSubcategoryId] = useState(() => catalogInitial?.subcategoryId || "");
  const [brandId, setBrandId] = useState(() => catalogInitial?.brandId || "");
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>([]);
  const scanInFlight = useRef<string | null>(null);
  const scanKeys = useRef(emptyBarcodeScanCapture());
  const searchSequence = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchFocusedOnReady = useRef(false);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [shiftError, setShiftError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [expectedCollectionMethod, setExpectedCollectionMethod] = useState("");
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [isDelivery, setIsDelivery] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState("");
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const [attemptNotice, setAttemptNotice] = useState("");
  const [reviewingCart, setReviewingCart] = useState(false);
  const [cartReviewError, setCartReviewError] = useState("");
  const [availablePriceLevels, setAvailablePriceLevels] = useState<{value: string, label: string}[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [addingAddress, setAddingAddress] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [customerType, setCustomerType] = useState("Retail Customer");
  const [customerSaveError, setCustomerSaveError] = useState("");
  const [customerLookup, setCustomerLookup] = useState<"idle" | "searching" | "found" | "new" | "error">("idle");
  const [lookupRetry, setLookupRetry] = useState(0);
  const customerLookupSequence = useRef(0);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [cashierName, setCashierName] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [walletAvailable, setWalletAvailable] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const draftOwner = useRef<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [referenceReady, setReferenceReady] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingUnitId, setPendingUnitId] = useState("");
  const [pendingPriceLevel, setPendingPriceLevel] = useState("");

  // For printing
  const checkoutRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const latestPrintOrder = useRef<string | null>(null);
  const [lastOrder, setLastOrder] = useState<PrintedOrder | null>(null);
  const [lastPrintJob, setLastPrintJob] = useState<Record<string, unknown> | null>(null);
  const [receiptItems, setReceiptItems] = useState<CartItem[]>([]);
  const [printStatus, setPrintStatus] = useState("");
  const [isSendingReceipt, setIsSendingReceipt] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => { cartRef.current = cart; }, [cart]);

  useEffect(() => {
    if (warehouseId && !searchFocusedOnReady.current) {
      searchFocusedOnReady.current = true;
      searchInput.current?.focus();
    }
  }, [warehouseId]);

  useEffect(() => {
    let active = true;
    getCurrentUser().then(user => {
      if (!active) return;
      draftOwner.current = user.id;
      setCashierName(user.full_name || user.username || user.email || "");
      const key = draftKey(user.id);
      setHeldCarts(readHeldCarts(user.id));
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw) as PosDraft;
          if (validCart(saved.cart) &&
              typeof saved.savedAt === "number" && Date.now() - saved.savedAt < draftLifetimeMs) {
            const restoredCart = saved.cart.map(item => ({ ...item, isBundle: Boolean(item.isBundle) }));
            setCart(restoredCart);
            cartRef.current = restoredCart;
            setWarehouseId(current => current || saved.warehouseId || "");
            setSelectedCustomer(saved.selectedCustomer || "");
            setDiscountPercent(Number(saved.discountPercent) || 0);
            if (saved.discount && saved.discountPercent == null) setCheckoutError("الخصم القديم كان بالجنيه؛ أدخله كنسبة قبل البيع.");
            setPaymentMethod(posPaymentMethods.some(method => method === saved.paymentMethod) ? saved.paymentMethod : "Cash");
            setCashReceived(saved.isCreditSale ? saved.cashReceived || "" : "");
            setExpectedCollectionMethod(saved.expectedCollectionMethod || "");
            setIsCreditSale(Boolean(saved.isCreditSale));
            setIsDelivery(Boolean(saved.isDelivery));
            setDeliveryFee(saved.isDelivery ? saved.deliveryFee || "" : "");
            setSaleCustomerName(saved.saleCustomerName || "");
            setCustomerName(saved.saleCustomerName || "");
            setCustomerPhone(saved.customerPhone || "");
            setCustomerAddress(saved.customerAddress || "");
            setCustomerType(saved.customerType || "Retail Customer");
            checkoutRequest.current = saved.checkoutRequest || null;
          } else sessionStorage.removeItem(key);
        }
      } catch {
        try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
      }
      try {
        const rawAttempt = sessionStorage.getItem(attemptKey(user.id));
        if (rawAttempt) {
          const attempt = JSON.parse(rawAttempt) as PendingCheckout;
          if (validCart(attempt.draft?.cart) && attempt.payload?.request_id &&
              attempt.payload.request_id === attempt.draft.checkoutRequest?.id) {
            if (cartRef.current.length === 0) {
              setCart(attempt.draft.cart);
              cartRef.current = attempt.draft.cart;
              setWarehouseId(attempt.draft.warehouseId);
              setSelectedCustomer(attempt.draft.selectedCustomer);
              setDiscountPercent(Number(attempt.draft.discountPercent) || 0);
              setPaymentMethod(attempt.draft.paymentMethod);
              setCashReceived(attempt.draft.cashReceived);
              setExpectedCollectionMethod(attempt.draft.expectedCollectionMethod || "");
              setIsCreditSale(Boolean(attempt.draft.isCreditSale));
              setIsDelivery(Boolean(attempt.draft.isDelivery));
              setDeliveryFee(attempt.draft.isDelivery ? attempt.draft.deliveryFee || "" : "");
              setSaleCustomerName(attempt.draft.saleCustomerName || "");
              setCustomerName(attempt.draft.saleCustomerName || "");
              setCustomerPhone(attempt.draft.customerPhone || "");
              setCustomerAddress(attempt.draft.customerAddress || "");
              setCustomerType(attempt.draft.customerType || "Retail Customer");
            }
            checkoutRequest.current = attempt.draft.checkoutRequest;
            setPendingCheckout(attempt);
            setAttemptNotice("نتيجة محاولة البيع غير مؤكدة. تحقق من الفاتورة قبل أي بيع جديد.");
          } else sessionStorage.removeItem(attemptKey(user.id));
        } else if (checkoutRequest.current && validCart(cartRef.current)) {
          const priorDraft = JSON.parse(sessionStorage.getItem(key) || "null") as PosDraft | null;
          const payload = JSON.parse(checkoutRequest.current.fingerprint) as CheckoutPayload;
          if (priorDraft && Array.isArray(payload.items)) {
            payload.request_id = checkoutRequest.current.id;
            const attempt = { savedAt: timestamp(), draft: priorDraft, payload };
            sessionStorage.setItem(attemptKey(user.id), JSON.stringify(attempt));
            setPendingCheckout(attempt);
            setAttemptNotice("تحقق من نتيجة محاولة البيع السابقة قبل تسجيل بيع جديد.");
          }
        }
      } catch { /* Keep the cart even if attempt storage is unavailable. */ }
      setDraftReady(true);
    }).catch(() => { if (active) setDraftReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draftReady || !draftOwner.current) return;
    const key = draftKey(draftOwner.current);
    if (cart.length === 0) {
      try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
      return;
    }
    const saved: PosDraft = { savedAt: Date.now(), cart, warehouseId, selectedCustomer,
      discountPercent, paymentMethod, cashReceived, expectedCollectionMethod, isCreditSale, isDelivery, deliveryFee, saleCustomerName,
      customerPhone, customerAddress, customerType, checkoutRequest: checkoutRequest.current };
    try { sessionStorage.setItem(key, JSON.stringify(saved)); } catch { /* Storage is optional; checkout still works. */ }
  }, [draftReady, cart, warehouseId, selectedCustomer, discountPercent, paymentMethod, cashReceived, expectedCollectionMethod, isCreditSale, isDelivery, deliveryFee, saleCustomerName, customerPhone, customerAddress, customerType]);

  const currentDraft = (): PosDraft => ({ savedAt: timestamp(), cart, warehouseId, selectedCustomer,
    discountPercent, paymentMethod, cashReceived, expectedCollectionMethod, isCreditSale, isDelivery, deliveryFee, saleCustomerName,
    customerPhone, customerAddress, customerType, checkoutRequest: checkoutRequest.current });

  const persistHeld = (next: HeldCart[]) => {
    if (!draftOwner.current) return false;
    try {
      localStorage.setItem(heldKey(draftOwner.current), JSON.stringify(next));
      setHeldCarts(next);
      return true;
    } catch {
      notifyError("تعذر حفظ السلة على هذا الجهاز. السلة الحالية ما زالت مفتوحة.");
      return false;
    }
  };

  const holdCart = () => {
    if (!cart.length || isProcessing || reviewingCart || pendingCheckout) return;
    if (heldCarts.length >= 10) { notifyError("وصلت للحد الأقصى للسلال المعلّقة. استرجع أو احذف سلة أولًا."); return; }
    const held: HeldCart = { id: crypto.randomUUID(), savedAt: timestamp(), draft: { ...currentDraft(), checkoutRequest: null } };
    if (!persistHeld([held, ...heldCarts])) return;
    setCart([]); cartRef.current = []; checkoutRequest.current = null;
    setSelectedCustomer(""); setSaleCustomerName(""); setCustomerName(""); setCustomerPhone("");
    setCustomerAddress(""); setCustomerType("Retail Customer"); setCustomerLookup("idle");
    setDiscountPercent(0); setCashReceived(""); setExpectedCollectionMethod("");
    setIsCreditSale(false); setIsDelivery(false); setDeliveryFee(""); setPaymentMethod("Cash"); setCheckoutError(""); setCartReviewError("");
    searchInput.current?.focus();
  };

  const reviewCartItems = async (items: CartItem[], targetWarehouseId: string) => {
    const productIds = [...new Set(items.map(item => item.productId))];
    const found = await Promise.all(productIds.map(async id => {
      const rows = await fetchApi(`/pos/search?product_id=${encodeURIComponent(id)}&warehouse_id=${encodeURIComponent(targetWarehouseId)}`, { silentErrors: true }) as Product[];
      return [id, rows[0]] as const;
    }));
    const productsById = new Map(found);
    let priceChanged = false;
    let unavailable = false;
    const reviewed = items.map(item => {
      const product = productsById.get(item.productId);
      const unit = product?.units.find(candidate => candidate.id === item.unitId);
      const price = unit?.prices.find(candidate => candidate.price_level === item.priceLevel);
      if (!product || !unit || !price || Number(price.price) <= 0) {
        unavailable = true;
        return { ...item, maxStock: 0 };
      }
      const unitPrice = Number(price.price);
      if (unitPrice !== item.unitPrice) priceChanged = true;
      return { ...item, nameAr: product.name_ar, unitName: unit.unit_name, isBundle: product.is_bundle,
        unitPrice, totalPrice: Math.round(unitPrice * item.quantity * 100) / 100,
        conversionFactor: unit.conversion_factor, maxStock: product.current_stock, availableUnits: product.units };
    });
    const insufficient = reviewed.some(item => reviewed.filter(other => other.productId === item.productId)
      .reduce((sum, other) => sum + other.quantity * other.conversionFactor, 0) > item.maxStock);
    return { reviewed, priceChanged, issue: unavailable ? "صنف أو وحدة لم يعد متاحًا. احذفه من السلة قبل البيع." :
      insufficient ? "الكمية المتاحة تغيّرت. قلّل الكمية أو احذف الصنف قبل البيع." : "" };
  };

  const restoreHeld = async (held: HeldCart) => {
    if (isProcessing || reviewingCart || pendingCheckout || !draftOwner.current) return;
    if (cart.length && !(await confirmAction({ title: "استرجاع سلة معلّقة؟", message: "السلة الحالية ستُستبدل. علّقها أولًا لو محتاج ترجع لها.", confirmLabel: "استرجاع" }))) return;
    setReviewingCart(true);
    try {
      const saved = held.draft;
      const targetWarehouse = warehouses.some(row => row.id === saved.warehouseId) ? saved.warehouseId : warehouseId;
      if (!targetWarehouse) throw new Error("مخزن البيع غير متاح.");
      const result = await reviewCartItems(saved.cart, targetWarehouse);
      setWarehouseId(targetWarehouse);
      setCart(result.reviewed); cartRef.current = result.reviewed;
      const customerMissing = Boolean(saved.selectedCustomer && !customers.some(customer => customer.id === saved.selectedCustomer));
      setSelectedCustomer(customerMissing ? "" : saved.selectedCustomer);
      setDiscountPercent(Number(saved.discountPercent) || 0); setPaymentMethod(saved.paymentMethod);
      setCashReceived(saved.cashReceived); setExpectedCollectionMethod(saved.expectedCollectionMethod || "");
      setIsCreditSale(Boolean(saved.isCreditSale)); setIsDelivery(Boolean(saved.isDelivery));
      setDeliveryFee(saved.isDelivery ? saved.deliveryFee || "" : "");
      setSaleCustomerName(saved.saleCustomerName || ""); setCustomerName(saved.saleCustomerName || "");
      setCustomerPhone(saved.customerPhone || ""); setCustomerAddress(saved.customerAddress || "");
      setCustomerType(saved.customerType || "Retail Customer"); setCustomerLookup("idle");
      checkoutRequest.current = null;
      setCartReviewError(result.issue || (customerMissing ? "العميل المسجل في السلة لم يعد متاحًا. اختر عميلًا قبل البيع." : ""));
      setCheckoutError(result.priceChanged ? "تغيّر سعر صنف في السلة؛ راجع الإجمالي قبل إتمام البيع." :
        saved.discount && saved.discountPercent == null ? "الخصم القديم كان بالجنيه؛ أدخله كنسبة قبل البيع." : "");
      persistHeld(heldCarts.filter(row => row.id !== held.id));
      setHeldOpen(false);
    } catch (error) {
      notifyError(errorMessage(error, "تعذر استرجاع السلة. حاول بعد عودة الاتصال."));
    } finally { setReviewingCart(false); }
  };

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
      const [customerResult, levelResult, warehouseResult, shiftResult, categoryResult, subcategoryResult, brandResult] = await Promise.allSettled([
        fetchApi("/customers"), fetchApi("/pos/price-levels"),
        fetchApi("/inventory/warehouses"), fetchApi("/cash-register/current"),
        fetchApi("/products/categories"), fetchApi("/products/subcategories"), fetchApi("/products/brands"),
      ]);
      if (warehouseResult.status === "fulfilled") {
        const rows = warehouseResult.value as { id: string; name: string }[];
        setWarehouses(rows);
        if (rows.length === 1) setWarehouseId(rows[0].id);
        else setWarehouseId(current => rows.some(row => row.id === current) ? current : "");
      } else setReferenceError("تعذر تحميل المخازن. حدّث الصفحة قبل تسجيل بيع جديد.");
      if (customerResult.status === "fulfilled") {
        const data = customerResult.value;
        setCustomers(Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []);
      } else setReferenceError(current => current || "تعذر تحميل العملاء. حدّث الصفحة قبل تسجيل بيع جديد.");
      if (levelResult.status === "fulfilled" && Array.isArray(levelResult.value)) setAvailablePriceLevels(levelResult.value);
      if (categoryResult.status === "fulfilled") setCategories(categoryResult.value);
      if (subcategoryResult.status === "fulfilled") setSubcategories(subcategoryResult.value);
      if (brandResult.status === "fulfilled") setBrands(brandResult.value);
      if (shiftResult.status === "fulfilled") setShiftOpen(Boolean(shiftResult.value));
      else setShiftError("تعذر التحقق من وردية الصندوق.");
      setReferenceReady(true);
    };
    void loadData();
    return () => window.clearTimeout(roleTimer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/openapi.json", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(schema => {
        if (active) setWalletAvailable(Boolean(schema?.components?.schemas?.OrderCreate?.properties?.payment_method?.enum?.includes("Wallet")));
      })
      .catch(() => { if (active) setWalletAvailable(false); });
    return () => { active = false; };
  }, []);

  const getPrice = useCallback((unit: ProductUnit, level: string) => {
    const p = unit.prices.find(pr => pr.price_level === level);
    return p ? Number(p.price) : 0;
  }, []);

  const applyCustomerPrice = (customer: PosCustomer) => {
    const level = customer.price_level || "Retail";
    const missingPrice = userRole !== "ADMIN" && cart.some(item => !item.availableUnits.find(candidate => candidate.id === item.unitId)?.prices.some(price => price.price_level === level));
    setSelectedCustomer(customer.id);
    setCustomerName(customer.name); setSaleCustomerName(customer.name);
    setCustomerAddress(previous => (customer.addresses || [customer.address || ""]).includes(previous) ? previous : customer.address || "");
    setNewAddress(""); setAddingAddress(false);
    setCustomerType(customer.customer_type || "Retail Customer");
    setCustomerSaveError(missingPrice ? "بعض أصناف السلة ليس لها سعر في مستوى هذا العميل. راجع الأسعار قبل البيع." : "");
    setCustomerLookup("found");
    if (userRole === "ADMIN" || missingPrice) return;
    setCart(previous => previous.map(item => {
      const unit = item.availableUnits.find(candidate => candidate.id === item.unitId);
      const price = unit?.prices.find(candidate => candidate.price_level === level);
      return price
        ? { ...item, priceLevel: level, unitPrice: item.isBundle ? item.unitPrice : Number(price.price), totalPrice: item.quantity * (item.isBundle ? item.unitPrice : Number(price.price)) }
        : item;
    }));
  };

  useEffect(() => {
    if (userRole === null || !/^[0-9]{11}$/.test(customerPhone)) return;
    let active = true;
    const sequence = ++customerLookupSequence.current;
    const timer = window.setTimeout(() => {
      setCustomerLookup("searching");
      void fetchApi(`/customers?phone=${encodeURIComponent(customerPhone)}`, { silentErrors: true, invalidateSnapshots: false })
        .then((rows: PosCustomer[]) => {
          if (!active || sequence !== customerLookupSequence.current) return;
          const found = rows[0];
          if (!found) { setSelectedCustomer(""); setCustomerName(""); setSaleCustomerName(""); setCustomerAddress(""); setCustomerLookup("new"); return; }
          setCustomers(previous => previous.some(customer => customer.id === found.id) ? previous.map(customer => customer.id === found.id ? found : customer) : [...previous, found]);
          applyCustomerPrice(found);
        })
        .catch(() => { if (active && sequence === customerLookupSequence.current) setCustomerLookup("error"); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  // The lookup retries without requiring the cashier to retype the number.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone, lookupRetry, userRole]);

  const ensureQuickCustomer = async (): Promise<PosCustomer> => {
    const name = customerName.trim() || "عميل نقدي";
    const phone = customerPhone.trim();
    if (!/^[0-9]{11}$/.test(phone)) {
      throw new Error("اكتب رقم تليفون من 11 رقمًا.");
    }
    if (customerLookup !== "new") {
      throw new Error("انتظر نتيجة البحث عن رقم التليفون قبل إتمام البيع.");
    }
    const existing = customers.find(customer => customer.phone?.trim() === phone);
    if (existing) {
      applyCustomerPrice(existing);
      return existing;
    }
    const requestedLevel = defaultCustomerPriceLevel(customerType);
    setSavingCustomer(true);
    setCustomerSaveError("");
    try {
      const created = await fetchApi("/customers", {
        method: "POST",
        body: JSON.stringify({ name, phone, address: customerAddress.trim() || null, customer_type: customerType,
          price_level: requestedLevel }),
        silentErrors: true,
      }) as PosCustomer;
      setCustomers(previous => [...previous, created].sort((a, b) => a.name.localeCompare(b.name, "ar")));
      applyCustomerPrice(created);
      return created;
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 409) {
        try {
          const matches = await fetchApi(`/customers?phone=${encodeURIComponent(phone)}`, { silentErrors: true, invalidateSnapshots: false }) as PosCustomer[];
          if (matches[0]) { setCustomers(previous => previous.some(customer => customer.id === matches[0].id) ? previous.map(customer => customer.id === matches[0].id ? matches[0] : customer) : [...previous, matches[0]]); applyCustomerPrice(matches[0]); return matches[0]; }
        } catch { /* Keep the server error visible if the lookup is unavailable. */ }
      }
      throw error;
    } finally {
      setSavingCustomer(false);
    }
  };

  const saveNewAddress = async () => {
    if (!selectedCustomer || savingAddress || isProcessing) return;
    const address = newAddress.trim().replace(/\s+/g, " ");
    if (address.length < 5) { setCustomerSaveError("اكتب عنوانًا واضحًا قبل الحفظ."); return; }
    setSavingAddress(true); setCustomerSaveError("");
    try {
      const updated = await fetchApi(`/customers/${selectedCustomer}/addresses`, {
        method: "POST", body: JSON.stringify({ address }), silentErrors: true,
      }) as PosCustomer;
      setCustomers(previous => previous.map(customer => customer.id === updated.id ? updated : customer));
      setCustomerAddress(address); setNewAddress(""); setAddingAddress(false);
    } catch (error) { setCustomerSaveError(errorMessage(error, "تعذر حفظ العنوان.")); }
    finally { setSavingAddress(false); }
  };

  const addToCart = useCallback((product: Product, selectedUnitId: string, selectedPriceLevel: string): boolean => {
    const unit = selectedUnitId
      ? product.units.find(u => u.id === selectedUnitId)
      : undefined;

    if (!unit) return false;

    const customerLevel = customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail";
    if (userRole !== "ADMIN" && selectedPriceLevel !== customerLevel) {
      notifyError("لا يمكن تغيير فئة سعر العميل من هذا الحساب.");
      return false;
    }
    if (!unit.prices.some(price => price.price_level === selectedPriceLevel)) {
      notifyError("لا يوجد أسعار لهذه الوحدة.");
      return false;
    }

    const unitPrice = getPrice(unit, selectedPriceLevel);
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
    const existing = previous.find(item => item.productId === product.id && item.unitId === unit.id && item.priceLevel === selectedPriceLevel);
    const next = existing
      ? previous.map(item => item.id === existing.id
          ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice }
          : item)
      : [...previous, {
          id: Math.random().toString(),
          productId: product.id,
          isBundle: product.is_bundle,
          nameAr: product.name_ar,
          unitId: unit.id,
          unitName: unit.unit_name,
          quantity: 1,
          priceLevel: selectedPriceLevel,
          unitPrice: unitPrice,
          totalPrice: unitPrice,
          conversionFactor: unit.conversion_factor,
          maxStock: product.current_stock,
          availableUnits: product.units
        }];
    cartRef.current = next;
    setCart(next);
    setCheckoutError("");
    ++searchSequence.current;
    setSearchQuery("");
    setProducts([]);
    setLoading(false);
    setCatalogRefresh(value => value + 1);
    window.requestAnimationFrame(() => searchInput.current?.focus());
    return true;
  }, [getPrice, customers, selectedCustomer, userRole]);

  const openProductSelection = useCallback((product: Product, selectedUnitId?: string): boolean => {
    const unit = product.units.find(candidate => candidate.id === selectedUnitId) ||
      product.units.find(candidate => candidate.unit_name === product.base_unit) || product.units[0];
    if (!unit || product.current_stock <= 0) return false;
    const customerLevel = customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail";
    setPendingProduct(product);
    setPendingUnitId(unit.id);
    setPendingPriceLevel(unit.prices.some(price => price.price_level === customerLevel) ? customerLevel : userRole === "ADMIN" ? unit.prices[0]?.price_level || "" : customerLevel);
    searchInput.current?.blur();
    return true;
  }, [customers, selectedCustomer, userRole]);

  const searchProducts = useCallback(async (query: string, scanned = false, alternateCode: string | null = null, offset = 0) => {
    if (!warehouseId) {
      setProducts([]);
      setHasMoreProducts(false);
      return;
    }
    const key = catalogKey(warehouseId, query, categoryId, subcategoryId, brandId, productKind);
    const cached = catalogCache.current;
    if (!scanned && offset === 0 && cached?.key === key && Date.now() - cached.at < 120_000 && catalogRefresh === 0) {
      setProducts(cached.products);
      setHasMoreProducts(cached.hasMore);
      setLoading(false);
      return;
    }
    const sequence = ++searchSequence.current;
    if (offset > 0) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
      setHasMoreProducts(false);
      setProducts([]);
    }
    setSearchError("");
    try {
      const fetchProducts = async (searchText: string): Promise<Product[]> => {
        try {
          const params = new URLSearchParams({ q: searchText, warehouse_id: warehouseId, limit: "50", offset: String(offset) });
          if (!scanned && categoryId) params.set("category_id", categoryId);
          if (!scanned && subcategoryId) params.set("subcategory_id", subcategoryId);
          if (!scanned && brandId) params.set("brand_id", brandId);
          if (!scanned && productKind !== "all") params.set("is_bundle", String(productKind === "offers"));
          if (!scanned && productKind === "offers") params.set("available_only", "true");
          const res = await fetchApi(`/pos/search?${params.toString()}`, { silentErrors: true });
          return res.data || res || [];
        } catch (error) {
          if ((userRole ?? getUserRole()) !== "ADMIN") throw error;
          if (productKind === "offers" && !scanned) throw error;
          return searchAdminInventory(searchText, warehouseId, offset, scanned ? "" : categoryId, scanned ? "" : subcategoryId, scanned ? "" : brandId, scanned ? "all" : productKind);
        }
      };
      let dataArr = await fetchProducts(query);
      if (sequence !== searchSequence.current) return;
      let matchedCode = query;
      if (scanned && alternateCode && dataArr.length === 0) {
        dataArr = await fetchProducts(alternateCode);
        if (sequence !== searchSequence.current) return;
        matchedCode = alternateCode;
        if (dataArr.length) setSearchQuery(alternateCode);
      }
      setProducts(previous => offset > 0 ? [...previous, ...dataArr] : dataArr);
      setHasMoreProducts(!scanned && dataArr.length === 50);
      if (!scanned && offset === 0) {
        const snapshot: CatalogSnapshot = { key, at: Date.now(), products: dataArr, hasMore: dataArr.length === 50,
          query, categoryId, subcategoryId, brandId, productKind };
        catalogCache.current = snapshot;
        writeSectionSnapshot("pos-catalog", snapshot);
      }
      if (!scanned) return;
      const exactUnitMatches = dataArr.flatMap(product => product.units.filter(unit => unit.barcode === matchedCode).map(unit => ({ product, unit })));
      const exactProductMatches = dataArr.filter(product => product.barcode === matchedCode || product.sku === matchedCode);
      if (exactUnitMatches.length === 1 && exactProductMatches.every(product => product.id === exactUnitMatches[0].product.id)) {
        const added = openProductSelection(exactUnitMatches[0].product, exactUnitMatches[0].unit.id);
        playUiSound(added ? "scanSuccess" : "scanFailure");
      } else if (exactUnitMatches.length === 0 && exactProductMatches.length === 1) {
        const added = openProductSelection(exactProductMatches[0]);
        playUiSound(added ? "scanSuccess" : "scanFailure");
      } else if (exactUnitMatches.length + exactProductMatches.length > 1) {
        notifyError("الباركود مطابق لأكثر من منتج أو وحدة. راجع الباركود المسجل قبل البيع.");
        if (scanned) playUiSound("scanFailure");
      } else if (scanned) {
        playUiSound("scanFailure");
        if (dataArr.length === 0) setSearchError("لم نعثر على صنف بهذا الكود.");
      }
    } catch (error) {
      console.error(error);
      if (sequence === searchSequence.current) {
        const message = errorMessage(error, "تعذر البحث عن الأصناف.");
        setSearchError(/[\u0600-\u06ff]/u.test(message) ? message : "تعذر البحث عن الأصناف. حاول مرة أخرى.");
      }
      if (scanned) playUiSound("scanFailure");
    } finally {
      if (scanned) scanInFlight.current = null;
      if (sequence === searchSequence.current) {
        if (offset > 0) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [openProductSelection, userRole, warehouseId, categoryId, subcategoryId, brandId, productKind, catalogRefresh]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (!warehouseId || scanInFlight.current) return;
      const mapped = englishBarcodeFromArabicLayout(searchQuery.trim())?.toUpperCase();
      if (mapped && /^(?:UNIT|INV)-[A-F0-9]{8}$/.test(mapped)) {
        scanInFlight.current = mapped;
        setSearchQuery(mapped);
        armUiSound();
        void searchProducts(mapped, true);
      } else {
        void searchProducts(searchQuery);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, searchProducts, warehouseId, catalogRefresh]);

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

  const subtotalCents = Math.round(cart.reduce((sum, item) => sum + item.totalPrice, 0) * 100);
  const subtotal = subtotalCents / 100;
  const discountCents = Math.round(subtotalCents * discountPercent / 100);
  const discountAmount = discountCents / 100;
  const validDeliveryFee = /^\d+(?:\.\d{1,2})?$/.test(deliveryFee) && Number.isFinite(Number(deliveryFee)) && Number(deliveryFee) <= 9999999999.99;
  const shippingCents = isDelivery && validDeliveryFee ? Math.round(Number(deliveryFee) * 100) : 0;
  const baseTotalCents = Math.max(0, subtotalCents - discountCents) + shippingCents;
  const baseTotal = baseTotalCents / 100;
  const validReceivedAmount = /^\d+(?:\.\d{1,2})?$/.test(cashReceived);
  const receivedAmount = validReceivedAmount ? Number(cashReceived) : 0;
  const receivedCents = Math.round(receivedAmount * 100);
  const walletFeeCents = paymentMethod === "Wallet" ? Math.round((isCreditSale ? receivedCents : baseTotalCents) / 100) : 0;
  const walletFee = walletFeeCents / 100;
  const totalAmount = (baseTotalCents + walletFeeCents) / 100;
  const checkoutBlock = savingCustomer ? "جارٍ حفظ العميل" : !referenceReady || !draftReady ? "جارٍ تحميل بيانات البيع" : referenceError || (!warehouseId ? "اختر مخزن البيع" :
    cart.length === 0 ? "أضف صنفًا إلى السلة" :
    !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100 || Math.abs(discountPercent * 100 - Math.round(discountPercent * 100)) > 1e-6 ? "راجع نسبة الخصم من 0 إلى 100 (رقمان بعد الفاصلة كحد أقصى)" :
    isDelivery && !validDeliveryFee ? "اكتب رسوم التوصيل، واكتب 0 لو التوصيل مجاني" :
    customerPhone.length === 11 && (customerLookup === "idle" || customerLookup === "searching") ? "جارٍ البحث عن العميل" :
    customerPhone.length === 11 && customerLookup === "error" ? "تعذر البحث عن رقم العميل. حاول مجددًا" :
    customerPhone.length > 0 && !selectedCustomer && customerLookup !== "new" ? "أكمل رقم التليفون أو امسحه قبل البيع" :
    isCreditSale && !selectedCustomer && customerLookup !== "new" ? "اكتب رقم تليفون العميل للبيع الآجل" :
    userRole !== "ADMIN" && selectedCustomer && cart.some(item => item.priceLevel !== (customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail")) ? "راجع مستوى سعر الأصناف مع العميل قبل البيع" :
    isCreditSale && !validReceivedAmount ? "اكتب المبلغ المستلم، واكتب 0 لو البيع كله آجل" :
    isCreditSale && receivedAmount > baseTotal ? "المبلغ المسدد لا يتجاوز صافي المشتريات" :
    isCreditSale && receivedCents < baseTotalCents && !expectedCollectionMethod ? "اختر وسيلة تحصيل الباقي لاحقًا" :
    !posPaymentMethods.some(method => method === paymentMethod) ? "اختر طريقة دفع متاحة" :
    ((paymentMethod === "Wallet" && (!isCreditSale || receivedAmount > 0)) || (isCreditSale && receivedCents < baseTotalCents && expectedCollectionMethod === "Wallet")) && !walletAvailable ? "المحفظة تحتاج تحديث السيرفر قبل البيع بها" :
    paymentMethod === "Cash" && (!isCreditSale || receivedAmount > 0) && shiftOpen !== true ? (shiftError || "افتح وردية الصندوق قبل البيع النقدي") : "");

  const finishSale = (res: CompletedCheckout, sold: PosDraft, printNow: boolean) => {
    playUiSound("saleComplete");
    const serverItemFor = (item: CartItem) => res.items.find(row => row.product_id === item.productId && row.unit_id === item.unitId && row.price_level === item.priceLevel);
    const serverSubtotal = res.items.reduce((sum, item) => sum + Number(item.total_price), 0);
    const walletFeeAmount = Number(res.wallet_fee_amount || 0);
    const paid = sold.isCreditSale ? Number(sold.cashReceived) + (sold.paymentMethod === "Wallet" ? walletFeeAmount : 0) : Number(res.total_amount);
    const customerName = customers.find(customer => customer.id === sold.selectedCustomer)?.name || sold.saleCustomerName || "عميل نقدي";
    setLastOrder({ id: res.id, publicNumber: Number(res.public_number), createdAt: res.created_at,
      employeeName: cashierName, paymentMethod: sold.isCreditSale ? "آجل" : res.payment_method,
      receivedMethod: sold.isCreditSale && paid > 0 ? sold.paymentMethod : undefined,
      expectedCollectionMethod: res.expected_collection_method || undefined,
      subtotal: serverSubtotal,
      discount: Number(res.discount_amount), discountPercent: res.discount_percent,
      walletFee: walletFeeAmount, shippingCost: Number(res.shipping_cost || 0), totalAmount: Number(res.total_amount),
      isDelivery: Boolean(sold.isDelivery),
      amountReceived: paid,
      remainingAmount: Math.max(0, Number(res.total_amount) - paid),
      customerName, customerPhone: sold.customerPhone,
      customerAddress: sold.isDelivery ? res.customer_address ?? sold.customerAddress : undefined });
    setReceiptItems(sold.cart.map(item => ({ ...item,
      quantity: Number(serverItemFor(item)?.quantity_requested ?? item.quantity),
      priceLevel: serverItemFor(item)?.price_level ?? item.priceLevel,
      unitPrice: Number(serverItemFor(item)?.unit_price ?? item.unitPrice) })));
    const receiptJob = {
      id: res.id, order_number: res.public_number, created_at: res.created_at,
      cashier_name: cashierName, employee_name: cashierName, operation_type: "sale",
      source: sold.isDelivery ? "Delivery" : "Walk-In Customer",
      customer_name: customerName,
      customer_phone: customers.find(customer => customer.id === sold.selectedCustomer)?.phone || sold.customerPhone || null,
      customer_address: sold.isDelivery ? res.customer_address ?? sold.customerAddress ?? null : null,
      payment_method: sold.isCreditSale ? "آجل" : res.payment_method,
      received_method: sold.isCreditSale && paid > 0 ? sold.paymentMethod : null,
      expected_collection_method: res.expected_collection_method || null,
      amount_received: paid,
      remaining_amount: Math.max(0, Number(res.total_amount) - paid),
      subtotal: serverSubtotal, discount_amount: Number(res.discount_amount),
      discount_percent: res.discount_percent, wallet_fee_amount: walletFeeAmount,
      shipping_cost: Number(res.shipping_cost || 0),
      total_amount: Number(res.total_amount),
      cart: sold.cart.map(item => ({ qty: Number(serverItemFor(item)?.quantity_requested ?? item.quantity),
        price: Number(serverItemFor(item)?.unit_price ?? item.unitPrice),
        name: item.nameAr || "صنف غير معروف", unit: item.unitName,
        price_level: serverItemFor(item)?.price_level ?? item.priceLevel })),
    };
    setLastPrintJob(receiptJob);
    setCart([]); cartRef.current = []; checkoutRequest.current = null;
    if (draftOwner.current) {
      try {
        sessionStorage.removeItem(draftKey(draftOwner.current));
        sessionStorage.removeItem(attemptKey(draftOwner.current));
      } catch { /* The committed sale is still shown on screen. */ }
    }
    setPendingCheckout(null); setAttemptNotice(""); setCheckoutError(""); setCartReviewError("");
    setDiscountPercent(0); setCashReceived(""); setExpectedCollectionMethod(""); setIsCreditSale(false); setIsDelivery(false); setDeliveryFee(""); setSaleCustomerName("");
    setSelectedCustomer(""); setCustomerName(""); setCustomerPhone(""); setCustomerAddress("");
    setNewAddress(""); setAddingAddress(false);
    catalogCache.current = null; setCatalogRefresh(value => value + 1);
    setCustomerType("Retail Customer"); setCustomerLookup("idle"); setPaymentMethod("Cash");
    window.requestAnimationFrame(() => searchInput.current?.focus());
    latestPrintOrder.current = res.id;
    if (!printNow) {
      setPrintStatus("تم التحقق من الفاتورة المسجلة. يمكنك إرسالها للطابعة عند الحاجة.");
      return;
    }
    setPrintStatus("جاري إرسال الفاتورة للطابعة...");
    setIsSendingReceipt(true);
    void sendLocalPrint(receiptJob, "customer")
      .then(() => { if (latestPrintOrder.current === res.id) setPrintStatus("أُرسلت الفاتورة لتطبيق الطباعة. راجع خروجها من الطابعة."); })
      .catch(printErr => { if (latestPrintOrder.current === res.id) setPrintStatus(errorMessage(printErr, "تعذر إرسال الفاتورة. يمكنك إعادة المحاولة دون تكرار البيع.")); })
      .finally(() => { if (latestPrintOrder.current === res.id) setIsSendingReceipt(false); });
  };

  const handleCheckout = async (retry?: PendingCheckout) => {
    if (isProcessing || reviewingCart || (!retry && (checkoutBlock || pendingCheckout))) return;
    let submitted: PendingCheckout | null = null;
    let requestSent = false;
    try {
      setIsProcessing(true);
      setCheckoutError("");
      let saleCart = cart;
      let saleCustomerId = selectedCustomer;
      let resolvedCustomer: PosCustomer | null = null;
      if (!retry) {
        if (customerLookup === "new") {
          resolvedCustomer = await ensureQuickCustomer();
          saleCustomerId = resolvedCustomer.id;
          if (userRole !== "ADMIN") {
            const level = resolvedCustomer.price_level;
            const missing = cart.some(item => !item.availableUnits.find(unit => unit.id === item.unitId)?.prices.some(price => price.price_level === level));
            if (missing) { setCheckoutError("تم تسجيل العميل، لكن صنفًا في السلة ليس له سعر في مستواه. راجع السلة."); return; }
            saleCart = cart.map(item => {
              const price = item.availableUnits.find(unit => unit.id === item.unitId)?.prices.find(candidate => candidate.price_level === level);
              const unitPrice = item.isBundle ? item.unitPrice : Number(price!.price);
              return { ...item, priceLevel: level, unitPrice, totalPrice: item.quantity * unitPrice };
            });
            if (saleCart.some((item, index) => item.unitPrice !== cart[index].unitPrice)) {
              setCart(saleCart);
              setCheckoutError("تغيّر سعر السلة حسب نوع العميل. راجع الإجمالي واضغط إتمام البيع مرة أخرى.");
              return;
            }
          }
        }
        const checked = await reviewCartItems(saleCart, warehouseId);
        setCart(checked.reviewed);
        cartRef.current = checked.reviewed;
        setCartReviewError(checked.issue);
        if (checked.issue || checked.priceChanged) {
          checkoutRequest.current = null;
          if (checked.priceChanged) setCheckoutError("تغيّر سعر صنف في السلة؛ راجع الإجمالي قبل إتمام البيع.");
          return;
        }
        saleCart = checked.reviewed;
      }
      const payload: CheckoutPayload = retry?.payload || {
        warehouse_id: warehouseId,
        status: "Delivered",
        source: isDelivery ? "Delivery" : "Walk-In Customer",
        discount_amount: discountAmount,
        shipping_cost: isDelivery ? Number(deliveryFee) : 0,
        discount_percent: discountPercent,
        expected_total: totalAmount,
        payment_method: isCreditSale ? "Deferred Payment" : paymentMethod,
        items: saleCart.map(item => ({
          product_id: item.productId, unit_id: item.unitId,
          quantity: item.quantity, price_level: item.priceLevel,
        })),
      };
      if (!retry) {
        if (isCreditSale) {
          payload.amount_received = receivedAmount;
          if (receivedAmount > 0) payload.received_method = paymentMethod;
          if (receivedCents < baseTotalCents) payload.expected_collection_method = expectedCollectionMethod;
        }
        if (saleCustomerId) { payload.customer_id = saleCustomerId; payload.customer_address = customerAddress; }
        const fingerprint = JSON.stringify(payload);
        if (checkoutRequest.current?.fingerprint !== fingerprint)
          checkoutRequest.current = { fingerprint, id: crypto.randomUUID() };
        payload.request_id = checkoutRequest.current.id;
      }
      const sold = retry?.draft || { ...currentDraft(), cart: saleCart, selectedCustomer: saleCustomerId,
        saleCustomerName: resolvedCustomer?.name || saleCustomerName, checkoutRequest: checkoutRequest.current };
      submitted = retry || { savedAt: timestamp(), draft: sold, payload };
      if (!draftOwner.current) throw new Error("تعذر تحديد المستخدم. حدّث الصفحة قبل إتمام البيع.");
      sessionStorage.setItem(draftKey(draftOwner.current), JSON.stringify(sold));
      sessionStorage.setItem(attemptKey(draftOwner.current), JSON.stringify(submitted));
      requestSent = true;
      const res = await fetchApi("/orders", {
        method: "POST", body: JSON.stringify(payload), silentErrors: true,
      }) as CompletedCheckout;
      finishSale(res, sold, true);
    } catch (error: unknown) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      if (requestSent && submitted && !(status >= 400 && status < 500 && status !== 408 && status !== 429)) {
        setPendingCheckout(submitted);
        setAttemptNotice("نتيجة محاولة البيع غير مؤكدة. تحقق من الفاتورة أو أعد نفس المحاولة.");
      } else {
        if (requestSent && submitted && draftOwner.current) {
          try { sessionStorage.removeItem(attemptKey(draftOwner.current)); } catch { /* Keep the active cart. */ }
          setPendingCheckout(null);
        }
        if (retry && !requestSent) setAttemptNotice("تعذر حفظ محاولة البيع على هذا الجهاز. حاول مجددًا بعد توفير مساحة التخزين.");
        else setCheckoutError(requestSent ? posCheckoutError(error) : errorMessage(error, "تعذر تجهيز السلة. حاول بعد عودة الاتصال."));
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const verifyCheckout = async () => {
    if (!pendingCheckout || isProcessing || !pendingCheckout.payload.request_id) return;
    setIsProcessing(true);
    setAttemptNotice("");
    try {
      const result = await fetchApi(`/orders/checkout-attempt/${pendingCheckout.payload.request_id}`,
        { silentErrors: true, invalidateSnapshots: false }) as { found: boolean; order: CompletedCheckout | null };
      if (result.found && result.order) finishSale(result.order, pendingCheckout.draft, false);
      else setAttemptNotice("لم تظهر الفاتورة بعد. يمكنك إعادة نفس المحاولة بأمان؛ لا تبدأ بيعًا جديدًا.");
    } catch {
      setAttemptNotice("تعذر الاتصال للتحقق من النتيجة. احتفظ بالسلة وحاول مجددًا.");
    } finally {
      setIsProcessing(false);
    }
  };
  const pendingUnit = pendingProduct?.units.find(unit => unit.id === pendingUnitId);
  const customerPriceLevel = customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail";
  const pendingPrices = pendingUnit?.prices.filter(price => Number(price.price) > 0 &&
    (userRole === "ADMIN" || price.price_level === customerPriceLevel)) || [];
  const pendingPrice = pendingPrices.find(price => price.price_level === pendingPriceLevel);
  const reservedPendingStock = cart.filter(item => item.productId === pendingProduct?.id)
    .reduce((sum, item) => sum + item.quantity * item.conversionFactor, 0);
  const canAddPending = Boolean(pendingProduct && pendingUnit && pendingPrice &&
    reservedPendingStock + pendingUnit.conversion_factor <= pendingProduct.current_stock);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <SideNav />
      <TopNav title="نقطة البيع" />

      <main className="app-main flex min-w-0 flex-col gap-5" inert={Boolean(pendingCheckout)}>
        {lastOrder && <div role="status" className="app-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border-primary/30 p-4">
          <div><strong className="text-primary">تم البيع · {lastOrder.totalAmount.toFixed(2)} ج.م</strong>
            <p className="app-muted text-sm">فاتورة {lastOrder.publicNumber} · {printStatus}</p></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="app-secondary-button" onClick={() => setReceiptOpen(true)}>عرض الفاتورة</button>
            <button type="button" className="app-secondary-button" onClick={reprintReceipt} disabled={!lastPrintJob || isSendingReceipt}>
              {isSendingReceipt ? "جارٍ الإرسال..." : "إعادة إرسال للطابعة"}</button>
            <button type="button" className="app-primary-button" onClick={() => searchInput.current?.focus()}>بيع جديد</button>
          </div>
        </div>}
        <div className="flex min-w-0 flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start">

        {/* Keep customer details, cart, and product search in one desktop row. */}
        <div className="order-2 grid w-full min-w-0 gap-5 lg:order-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-stretch xl:contents">

          {/* Customer / Settings Panel */}
          <div className="app-panel rounded-2xl flex flex-col min-h-0 overflow-hidden xl:col-start-2 xl:row-start-1 xl:h-[calc(100vh-180px)] xl:min-h-[420px]">
            <h3 className="shrink-0 border-b border-white/10 px-4 py-4 md:px-5 font-bold text-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person</span>
              بيانات العميل والدفع
            </h3>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 px-4 pb-4 pt-4 md:px-5 md:pb-5">
            {warehouses.length > 1 && <label className="text-sm">مخزن البيع<select className="app-field mt-2" value={warehouseId} onChange={async event => {
              const select = event.currentTarget;
              const next = select.value;
              if (next === warehouseId) return;
              if (cart.length && !(await confirmAction({ title: "تغيير مخزن البيع؟", message: "تغيير المخزن سيمسح السلة الحالية.", confirmLabel: "تغيير المخزن" }))) {
                select.value = warehouseId;
                return;
              }
              setWarehouseId(next); setCart([]); cartRef.current = []; checkoutRequest.current = null;
              setSearchQuery(""); setProducts([]); setLoading(false); ++searchSequence.current;
            }} disabled={isProcessing || savingCustomer}><option value="">اختر المخزن</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>}

            <div className="grid gap-3">
              <label className="block text-sm">رقم التليفون
                <input className="app-field mt-1" type="tel" inputMode="numeric" dir="ltr" value={customerPhone}
                  onChange={event => {
                    const phone = event.target.value.replace(/[^0-9]/g, "").slice(0, 11);
                    if (phone === customerPhone) return;
                    if (selectedCustomer && userRole !== "ADMIN") setCart(previous => previous.map(item => {
                      const price = item.availableUnits.find(unit => unit.id === item.unitId)?.prices.find(candidate => candidate.price_level === "Retail");
                      return price ? { ...item, priceLevel: "Retail", unitPrice: item.isBundle ? item.unitPrice : Number(price.price), totalPrice: item.quantity * (item.isBundle ? item.unitPrice : Number(price.price)) } : item;
                    }));
                    setCustomerPhone(phone); setSelectedCustomer(""); setCustomerLookup("idle"); setCustomerSaveError("");
                    setCustomerName(""); setSaleCustomerName(""); setCustomerAddress(""); setCustomerType("Retail Customer");
                    setNewAddress(""); setAddingAddress(false);
                  }} autoComplete="tel" maxLength={11} disabled={savingCustomer || isProcessing} />
              </label>
              {customerLookup === "searching" && <span className="app-muted text-xs">جارٍ البحث عن الرقم...</span>}
              {customerLookup === "found" && <span className="text-xs text-emerald-400">العميل مسجل وتم اختياره</span>}
              {customerLookup === "error" && <button type="button" className="text-right text-xs text-red-400 underline" onClick={() => setLookupRetry(value => value + 1)}>تعذر البحث. اضغط لإعادة المحاولة</button>}
              <label className="block text-sm">نوع العميل</label>
              <ProductSelect label="نوع العميل" value={customerType} onChange={setCustomerType} disabled={savingCustomer || isProcessing || customerLookup === "found"}
                placeholder="نوع العميل" options={customerTypes} allowClear={false} />
              {customerLookup === "found" && <>
                <p className="text-sm">الاسم: <strong>{customerName}</strong></p>
                <div className="min-w-0 text-sm"><span className="mb-1 block">{isDelivery ? "عنوان التوصيل على الفاتورة" : "عنوان العميل المسجل"}</span>
                  <ProductSelect label={isDelivery ? "عنوان التوصيل على الفاتورة" : "عنوان العميل المسجل"} value={customerAddress} onChange={setCustomerAddress} disabled={savingAddress || isProcessing}
                    placeholder="بدون عنوان" options={(customers.find(customer => customer.id === selectedCustomer)?.addresses || []).map(address => ({ value: address, label: address }))} allowClear />
                </div>
                {addingAddress ? <div className="grid min-w-0 gap-2">
                  <input className="app-field w-full min-w-0" aria-label="عنوان جديد" value={newAddress} onChange={event => setNewAddress(event.target.value)} maxLength={300} autoComplete="street-address" placeholder="اكتب العنوان الجديد" disabled={savingAddress} />
                  <div className="flex flex-wrap gap-2"><button type="button" className="app-secondary-button" onClick={() => void saveNewAddress()} disabled={savingAddress || newAddress.trim().length < 5}>{savingAddress ? "جارٍ الحفظ..." : "حفظ العنوان"}</button>
                  <button type="button" className="app-secondary-button" onClick={() => { setAddingAddress(false); setNewAddress(""); }} disabled={savingAddress}>إلغاء</button></div>
                </div> : <button type="button" className="app-secondary-button" onClick={() => setAddingAddress(true)} disabled={isProcessing}>إضافة عنوان جديد</button>}
              </>}
              {customerLookup === "new" && <>
                <label className="block text-sm">اسم العميل <span className="app-muted">(اختياري)</span>
                  <input className="app-field mt-1" value={customerName} onChange={event => { setCustomerName(event.target.value); setSaleCustomerName(event.target.value); }} placeholder="عميل نقدي" maxLength={120} autoComplete="name" disabled={savingCustomer || isProcessing} />
                </label>
                <label className="block text-sm">العنوان <span className="app-muted">(اختياري)</span>
                  <input className="app-field mt-1" value={customerAddress} onChange={event => setCustomerAddress(event.target.value)} autoComplete="street-address" disabled={savingCustomer || isProcessing} />
                </label>
              </>}
              {customerSaveError && <p role="alert" className="text-sm text-red-400">{customerSaveError}</p>}
            </div>
            {/* Checkout Totals */}
            <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="طريقة الاستلام">
                <button type="button" aria-pressed={!isDelivery} onClick={() => setIsDelivery(false)} disabled={isProcessing}
                  className={!isDelivery ? "app-primary-button justify-center" : "app-secondary-button justify-center"}>من المكتبة</button>
                <button type="button" aria-pressed={isDelivery} onClick={() => setIsDelivery(true)} disabled={isProcessing}
                  className={isDelivery ? "app-primary-button justify-center" : "app-secondary-button justify-center"}>دليفري</button>
              </div>
              {isDelivery && <label className="block text-sm">رسوم التوصيل *
                <input className="app-field mt-1" type="number" inputMode="decimal" min="0" step="0.01" value={deliveryFee}
                  onChange={event => setDeliveryFee(event.target.value)} disabled={isProcessing} placeholder="0 لو التوصيل مجاني" />
              </label>}
              <div className="flex justify-between items-center text-sm">
                <span className="text-[#e2bfb0]/60">الإجمالي:</span>
                <span className="font-bold">{subtotal.toFixed(2)} ج.م</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[#e2bfb0]/60 text-sm">الخصم (%):</span>
                <div className="relative w-24">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    aria-label="الخصم"
                    value={discountPercent || ""}
                    onChange={(e) => setDiscountPercent(Number(e.target.value))}
                    disabled={userRole !== "ADMIN"}
                    className="w-full bg-[#131313] border border-white/10 rounded-lg py-1 px-3 text-sm text-center focus:ring-1 focus:ring-primary focus:outline-none"
                    placeholder="0"
                  />
                  <span className="absolute left-2 top-1.5 text-xs text-[#e2bfb0]/40">٪</span>
                </div>
              </div>
              {discountAmount > 0 && <div className="flex justify-between text-sm"><span>قيمة الخصم</span><span>-{discountAmount.toFixed(2)} ج.م</span></div>}
              {isDelivery && validDeliveryFee && <div className="flex justify-between text-sm"><span>رسوم التوصيل</span><span>+{(shippingCents / 100).toFixed(2)} ج.م</span></div>}
              {walletFee > 0 && <div className="flex justify-between text-sm"><span>ضريبة المحفظة (١٪)</span><span>+{walletFee.toFixed(2)} ج.م</span></div>}

              <div className="flex justify-between items-center text-xl">
                <span className="font-black text-white">الصافي:</span>
                <span className="font-black text-primary">{totalAmount.toFixed(2)} ج.م</span>
              </div>

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="نوع البيع">
                <button type="button" aria-pressed={!isCreditSale} onClick={() => { setIsCreditSale(false); setCashReceived(""); }} className={!isCreditSale ? "app-primary-button justify-center" : "app-secondary-button justify-center"}>دفع كامل</button>
                <button type="button" aria-pressed={isCreditSale} onClick={() => { setIsCreditSale(true); setCashReceived(""); }} className={isCreditSale ? "app-primary-button justify-center" : "app-secondary-button justify-center"}>بيع آجل</button>
              </div>
              {isCreditSale && <label className="block text-sm">المبلغ المسدد من قيمة الفاتورة *
                <input className="app-field mt-2" type="number" inputMode="decimal" min="0" max={baseTotal} step="0.01" required
                  value={cashReceived} onChange={event => setCashReceived(event.target.value)} disabled={isProcessing} placeholder="اكتب 0 لو كله آجل" />
              </label>}
              {isCreditSale && validReceivedAmount && <p className="text-sm font-bold">المتبقي على العميل: {Math.max(0, baseTotal - receivedAmount).toFixed(2)} ج.م</p>}
              {isCreditSale && paymentMethod === "Wallet" && walletFee > 0 && <p className="text-sm">المبلغ المحصل بالمحفظة شامل الضريبة: {(receivedAmount + walletFee).toFixed(2)} ج.م</p>}
              {(!isCreditSale || receivedAmount > 0) && <><label className="block text-sm font-bold">{isCreditSale ? "طريقة دفع المبلغ المستلم الآن" : "طريقة الدفع"}</label>
              <ProductSelect label="طريقة الدفع" value={paymentMethod} disabled={isProcessing}
                onChange={setPaymentMethod}
                placeholder="طريقة الدفع" options={[{ value: "Cash", label: "كاش" }, { value: "Instapay", label: "إنستا باي" }, { value: "Credit Card", label: "فيزا" }, ...(walletAvailable ? [{ value: "Wallet", label: "محفظة" }] : [])]} allowClear={false} /></>}
              {isCreditSale && validReceivedAmount && receivedCents < baseTotalCents && <><label className="block text-sm font-bold">طريقة تحصيل الباقي لاحقًا</label>
                <ProductSelect label="طريقة تحصيل الباقي لاحقًا" value={expectedCollectionMethod} onChange={setExpectedCollectionMethod} disabled={isProcessing}
                  placeholder="اختر وسيلة التحصيل" options={[{ value: "Cash", label: "كاش" }, { value: "Instapay", label: "إنستا باي" }, { value: "Credit Card", label: "فيزا" }, ...(walletAvailable ? [{ value: "Wallet", label: "محفظة" }] : [])]} allowClear={false} />
              </>}
              {paymentMethod === "Cash" && (!isCreditSale || receivedAmount > 0) && <>
                {shiftOpen !== true && <p className="rounded-lg bg-amber-500/10 p-2 text-sm text-amber-300">
                  {shiftError || "افتح وردية الصندوق قبل البيع النقدي."} <Link href="/cash-register" className="font-bold underline">فتح الصندوق</Link>
                </p>}
              </>}

            </div>
            </div>
          </div>

          {/* Cart Panel */}
          <div className="app-panel min-w-0 max-h-[75vh] min-h-[280px] rounded-2xl flex flex-col overflow-hidden xl:col-start-3 xl:row-start-1 xl:h-[calc(100vh-180px)] xl:max-h-none xl:min-h-[420px]">
            <div className="border-b border-white/5 flex flex-wrap items-center justify-between gap-2 p-4 shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">shopping_cart</span>
                سلة المشتريات
              </h3>
              <div className="flex items-center gap-2">
                <button type="button" className="app-secondary-button !px-3 !py-2 text-xs" onClick={holdCart}
                  disabled={!cart.length || isProcessing || reviewingCart || Boolean(pendingCheckout)}>تعليق السلة</button>
                <button type="button" className="app-secondary-button !px-3 !py-2 text-xs" onClick={() => setHeldOpen(true)}
                  disabled={!heldCarts.length || isProcessing || Boolean(pendingCheckout)}>المعلّقة {heldCarts.length ? `(${heldCarts.length})` : ""}</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-[#e2bfb0]/40">
                  <span className="material-symbols-outlined text-6xl">production_quantity_limits</span>
                  <p>السلة فارغة</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {cart.map(item => (
                    <div key={item.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col gap-3 shadow-sm">
                      {/* Top Row: Name and Delete */}
                      <div className="flex justify-between items-center">
                        <div className="min-w-0 flex-1 pl-2"><h4 className="truncate text-[15px] font-bold text-white">{item.nameAr}</h4><span className="app-muted text-xs">{item.unitName}</span></div>
                        <button onClick={() => removeCartItem(item.id)} className="text-[#ffb4ab]/60 hover:text-[#ffb4ab] bg-[#ffb4ab]/5 hover:bg-[#ffb4ab]/15 rounded-lg p-1.5 transition-colors shrink-0">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
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
                        <span className="text-lg font-bold text-white tabular-nums">{item.totalPrice.toFixed(2)} ج.م</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="shrink-0 space-y-2 border-t border-white/10 p-4">
              {cartReviewError && <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300">{cartReviewError}</p>}
              {checkoutError && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-[#ffb4ab]">{checkoutError}</p>}
              <button type="button" onClick={() => void handleCheckout()}
                disabled={Boolean(checkoutBlock) || isProcessing || reviewingCart || Boolean(pendingCheckout)}
                className="app-primary-button flex w-full justify-center gap-2 py-3.5 disabled:opacity-50">
                {isProcessing || reviewingCart ? <span className="material-symbols-outlined animate-spin" aria-hidden="true">sync</span> : <span className="material-symbols-outlined" aria-hidden="true">point_of_sale</span>}
                إتمام البيع · {totalAmount.toFixed(2)} ج.م
              </button>
              {checkoutBlock && <p className="app-muted text-center text-xs">{checkoutBlock}</p>}
            </div>

          </div>
        </div>

        {/* Product search stays beside customer details and cart on desktop. */}
        <div className="app-panel order-1 flex min-w-0 flex-col overflow-hidden rounded-2xl lg:order-2 lg:min-h-[420px] lg:max-h-[calc(100vh-180px)] xl:col-start-1 xl:row-start-1">
          {/* Search Header */}
          <div className="shrink-0 border-b border-white/5 bg-black/10 p-4">
            <div className="app-field app-search-focus flex min-h-14 items-center gap-3 rounded-xl px-4">
              <span className="material-symbols-outlined shrink-0 text-primary/70" aria-hidden="true">search</span>
              <input
                type="text"
                id="pos-product-search"
                aria-label="بحث الأصناف والباركود في نقطة البيع"
                ref={searchInput}
                autoFocus
                value={searchQuery}
                disabled={!warehouseId || isProcessing || savingCustomer}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchError("");
                  if (!e.target.value) { ++searchSequence.current; setProducts([]); setLoading(false); }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") {
                    if (!event.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, event);
                    return;
                  }
                  const rawCode = event.currentTarget.value.trim();
                  const physicalCode = englishBarcodeFromScan(scanKeys.current, rawCode);
                  const code = physicalCode || rawCode;
                  const alternateCode = physicalCode ? null : englishBarcodeFromArabicLayout(rawCode);
                  if (event.key === "Enter" && code) {
                    event.preventDefault();
                    if (scanInFlight.current === code) return;
                    scanInFlight.current = code;
                    if (code !== rawCode) setSearchQuery(code);
                    armUiSound();
                    void searchProducts(code, true, alternateCode);
                  }
                }}
                placeholder={warehouseId ? "امسح باركود أو ابحث عن صنف" : "اختر المخزن أولًا"}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#e2bfb0]/55"
              />
              {searchQuery && <button type="button" aria-label="مسح البحث" title="مسح البحث" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-current/65 hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { ++searchSequence.current; scanInFlight.current = null; setSearchQuery(""); setSearchError(""); setProducts([]); setLoading(false); searchInput.current?.focus(); }}>
                <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
              </button>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="نوع الأصناف">
              {([{ value: "all", label: "الكل" }, { value: "products", label: "المنتجات" }, { value: "offers", label: "العروض المتاحة" }] as const).map(option =>
                <button key={option.value} type="button" onClick={() => setProductKind(option.value)} aria-pressed={productKind === option.value}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${productKind === option.value ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-[#e2bfb0]/75 hover:text-white"}`}>
                  {option.label}
                </button>)}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
              <label className="min-w-0 text-xs app-muted">التصنيف الرئيسي
                <ProductSelect label="التصنيف الرئيسي" value={categoryId} onChange={value => { setCategoryId(value); setSubcategoryId(""); }}
                  placeholder="كل التصنيفات" options={categories.map(category => ({ value: category.id, label: category.name_ar }))} filter />
              </label>
              <label className="min-w-0 text-xs app-muted">التصنيف الفرعي
                <ProductSelect label="التصنيف الفرعي" value={subcategoryId} onChange={setSubcategoryId}
                  placeholder="كل الفرعية" options={subcategories.filter(subcategory => !categoryId || subcategory.category_id === categoryId).map(subcategory => ({ value: subcategory.id, label: subcategory.name_ar }))} filter />
              </label>
              <label className="min-w-0 text-xs app-muted sm:col-span-1 xl:col-span-2 2xl:col-span-1">العلامة التجارية
                <ProductSelect label="العلامة التجارية" value={brandId} onChange={setBrandId}
                  placeholder="كل العلامات" options={brands.map(brand => ({ value: brand.id, label: brand.name_ar }))} filter />
              </label>
            </div>
          </div>

          {searchError && <p role="status" className="px-6 pt-3 text-sm text-[#ffb4ab]">{searchError}</p>}
          {/* Compact results keep the next item one click away. */}
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {loading ? (
              <div className="grid gap-2" role="status" aria-label="جاري البحث عن المنتجات"><span className="sr-only">جاري البحث عن المنتجات</span>{[0, 1, 2].map(index => <div key={index} aria-hidden="true" className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-white/10 p-4"><div className="space-y-2"><span className="app-skeleton h-4 w-40" /><span className="app-skeleton h-3 w-24" /></div><span className="app-skeleton h-6 w-16" /></div>)}</div>
            ) : products.length > 0 ? (
              <div className="space-y-3">
                <div className="grid gap-3 2xl:grid-cols-2">
                {products.map(product => {
                  const baseUnit = product.units.find(unit => unit.unit_name === product.base_unit) || product.units[0];
                  const level = customers.find(customer => customer.id === selectedCustomer)?.price_level || "Retail";
                  const price = baseUnit?.prices.find(candidate => candidate.price_level === level) ||
                    (userRole === "ADMIN" ? baseUnit?.prices.find(candidate => Number(candidate.price) > 0) : undefined);
                  const hasAvailablePrice = product.units.some(unit => unit.prices.some(candidate =>
                    Number(candidate.price) > 0 && (userRole === "ADMIN" || candidate.price_level === level)));
                  return (
                  <article key={product.id} className="pos-product-card min-w-0 p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-[15px] font-semibold leading-6" title={product.name_ar}>{product.name_ar}</h4>
                        {product.is_bundle && <span className="text-xs font-bold text-primary">عرض · سعر ثابت</span>}
                      </div>
                      <span className={`shrink-0 pt-1 text-xs ${product.current_stock > 0 ? "app-muted" : "text-[#ffb4ab]"}`}>
                        {product.current_stock > 0 ? `${product.current_stock} ${product.base_unit} متاح` : "نفد المخزون"}
                      </span>
                    </div>
                    <div className="pos-product-card-footer mt-4 flex flex-wrap items-end justify-between gap-3 pt-3">
                      <div className="min-w-0">
                        <span className="app-muted block text-xs">سعر الوحدة</span>
                        <strong className="mt-0.5 block text-lg font-bold leading-6 tabular-nums">{price ? `${Number(price.price).toFixed(2)} ج.م` : "بلا سعر"}</strong>
                      </div>
                      <button type="button" onClick={() => openProductSelection(product)} disabled={isProcessing || savingCustomer || product.current_stock <= 0 || !hasAvailablePrice}
                        aria-label={`إضافة ${product.name_ar} إلى السلة`}
                        className="app-primary-button !rounded-xl !px-3 !py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                        إضافة للسلة
                      </button>
                    </div>
                  </article>
                  );
                })}
                </div>
                {hasMoreProducts && <button type="button" className="app-secondary-button w-full disabled:opacity-50" disabled={loadingMore} onClick={() => void searchProducts(searchQuery, false, null, products.length)}>
                  {loadingMore ? "جاري تحميل المزيد..." : "تحميل المزيد من الأصناف"}
                </button>}
              </div>
            ) : searchError ? null : searchQuery ? (
              <div className="h-full flex flex-col items-center justify-center text-[#e2bfb0]/40">
                <p>لم يتم العثور على نتائج</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[#e2bfb0]/40">
                <p>{warehouseId ? "لا توجد أصناف مطابقة للفلاتر" : "اختر مخزن البيع لعرض الأصناف"}</p>
              </div>
            )}
          </div>
        </div>

        </div>
      </main>

      {heldOpen && <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="السلال المعلّقة" dir="rtl">
        <div className="app-panel flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl p-5 shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">السلال المعلّقة</h2>
            <button type="button" className="app-icon-button" aria-label="إغلاق" onClick={() => setHeldOpen(false)}><span className="material-symbols-outlined">close</span></button>
          </div>
          <div className="custom-scrollbar overflow-y-auto divide-y divide-white/10">
            {heldCarts.map(held => <div key={held.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><strong className="block truncate text-sm">{held.draft.cart[0]?.nameAr || "سلة بيع"}</strong>
                <span className="app-muted text-xs">{held.draft.cart.length} صنف · {new Date(held.savedAt).toLocaleString("ar-EG")}</span></div>
              <div className="flex gap-2">
                <button type="button" className="app-primary-button !px-3 !py-2 text-xs" disabled={reviewingCart} onClick={() => void restoreHeld(held)}>{reviewingCart ? "جارٍ الفحص..." : "استرجاع"}</button>
                <button type="button" className="app-secondary-button !px-3 !py-2 text-xs" disabled={reviewingCart} onClick={async () => {
                  if (await confirmAction({ title: "حذف السلة المعلّقة؟", message: "لن يمكن استرجاع هذه السلة بعد حذفها.", confirmLabel: "حذف" }))
                    persistHeld(heldCarts.filter(row => row.id !== held.id));
                }}>حذف</button>
              </div>
            </div>)}
          </div>
          <p className="app-muted mt-3 text-xs">محفوظة على هذا الجهاز لمدة ٧ أيام.</p>
        </div>
      </div>}

      {pendingCheckout && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="التحقق من محاولة البيع" dir="rtl">
        <div className="app-panel w-full max-w-md rounded-2xl p-6 shadow-2xl">
          <span className="material-symbols-outlined text-3xl text-amber-300" aria-hidden="true">pending_actions</span>
          <h2 className="mt-2 text-lg font-bold">نتيجة البيع غير مؤكدة</h2>
          <p className="app-muted mt-2 text-sm">السلة محفوظة. تحقق من الفاتورة أو أعد نفس المحاولة؛ لن يتكرر البيع.</p>
          {attemptNotice && <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{attemptNotice}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="app-primary-button" disabled={isProcessing} onClick={() => void verifyCheckout()}>{isProcessing ? "جارٍ التحقق..." : "تحقق من النتيجة"}</button>
            <button type="button" className="app-secondary-button" disabled={isProcessing} onClick={() => void handleCheckout(pendingCheckout)}>إعادة نفس المحاولة</button>
          </div>
        </div>
      </div>}

      {pendingProduct && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label={`اختيار الوحدة والسعر لـ${pendingProduct.name_ar}`} dir="rtl" onKeyDown={event => { if (event.key === "Escape") { setPendingProduct(null); searchInput.current?.focus(); } }}>
        <div className="app-panel w-full max-w-md rounded-2xl p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{pendingProduct.name_ar}</h2><p className="app-muted text-sm">اختيار الوحدة والسعر</p></div><button type="button" aria-label="إغلاق" onClick={() => { setPendingProduct(null); searchInput.current?.focus(); }} className="app-icon-button"><span className="material-symbols-outlined">close</span></button></div>
          <div className="space-y-4">
            <div><h3 className="mb-2 text-sm font-semibold">الوحدة</h3><div className="flex flex-wrap gap-2">{pendingProduct.units.map(unit => {
              const available = unit.prices.some(price => Number(price.price) > 0 && (userRole === "ADMIN" || price.price_level === customerPriceLevel));
              return <button key={unit.id} type="button" disabled={!available} aria-pressed={pendingUnitId === unit.id}
                onClick={() => { setPendingUnitId(unit.id); setPendingPriceLevel(unit.prices.some(price => price.price_level === customerPriceLevel && Number(price.price) > 0) ? customerPriceLevel : unit.prices.find(price => Number(price.price) > 0)?.price_level || ""); }}
                className={`rounded-xl border px-4 py-2 text-sm disabled:opacity-40 ${pendingUnitId === unit.id ? "border-primary bg-primary/15 text-primary" : "border-white/10 hover:border-white/30"}`}>{unit.unit_name}</button>;
            })}</div></div>
            <div><h3 className="mb-2 text-sm font-semibold">التسعير</h3>{pendingProduct.is_bundle ? <p className="text-sm">سعر العرض ثابت</p> : userRole === "ADMIN" ?
              <div className="space-y-2">{pendingPrices.map(price => <button key={price.price_level} type="button" aria-pressed={pendingPriceLevel === price.price_level} onClick={() => setPendingPriceLevel(price.price_level)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-2 text-sm ${pendingPriceLevel === price.price_level ? "border-primary bg-primary/15" : "border-white/10 hover:border-white/30"}`}>
                <span>{availablePriceLevels.find(level => level.value === price.price_level)?.label || priceLevels.find(level => level.value === price.price_level)?.label || price.price_level}</span><strong>{Number(price.price).toFixed(2)} ج.م</strong>
              </button>)}</div> : <p className="text-lg font-bold text-primary">{pendingPrice ? `${Number(pendingPrice.price).toFixed(2)} ج.م` : "لا يوجد سعر متاح لهذه الوحدة"}</p>}</div>
            <button type="button" disabled={!canAddPending} onClick={() => { if (pendingUnit && pendingPrice && addToCart(pendingProduct, pendingUnit.id, pendingPrice.price_level)) setPendingProduct(null); }} className="app-primary-button w-full justify-center disabled:opacity-50">إضافة للسلة</button>
          </div>
        </div>
      </div>}

      {receiptOpen && lastOrder && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="فاتورة البيع">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-[#1c1b1b] p-5 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">فاتورة البيع</h2>
              <button type="button" onClick={() => setReceiptOpen(false)} aria-label="إغلاق الفاتورة" className="rounded-lg p-2 hover:bg-white/10">✕</button>
            </div>
            <div className="overflow-y-auto rounded-xl bg-white p-3 text-black">
              <ReceiptPrint order={lastOrder} items={receiptItems} />
            </div>
            <p className="mt-3 text-sm text-[#e2bfb0]">{printStatus}</p>
            <button type="button" onClick={reprintReceipt} disabled={!lastPrintJob || isSendingReceipt} className="mt-3 rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">{isSendingReceipt ? "جارٍ الإرسال..." : "إعادة إرسال للطابعة"}</button>
          </div>
        </div>
      )}

    </div>
  );
}
