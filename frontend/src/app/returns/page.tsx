"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { ProductSelect } from "@/components/ProductSelect";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { TopNavSearchPortal } from "@/lib/topNavSearchPortal";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { getUserRole } from "@/utils/auth";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { printSalesReturnReceipt } from "@/lib/localPrint";
import { emptyBarcodeScanCapture, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";

// ── Types ───────────────────────────────────────────────────────────────────

type Order = {
  id: string;
  public_number: number;
  status: string;
  total_amount: number;
  customer_id: string | null;
  created_at?: string;
};

type EligibleItem = {
  order_item_id: string;
  product_name: string;
  unit_name: string;
  unit_id: string;
  price_level: string;
  remaining_quantity: number;
  unit_price: number;
  manual_review: boolean;
};

type Eligibility = {
  warehouse_id: string;
  customer_id?: string | null;
  payment_method: string;
  customer_price_level: string;
  customer_name?: string;
  customer_phone?: string | null;
  public_number?: number;
  total_amount?: number;
  discount_amount?: number;
  subtotal_amount?: number;
  deferred_remaining?: number | null;
  wallet_fee_amount?: number;
  items: EligibleItem[];
};

type ReturnableSearchResult = {
  id: string;
  public_number: number;
  customer_name: string;
  customer_phone?: string | null;
  status: string;
  payment_method: string;
  total_amount: number;
  wallet_fee_amount?: number;
  created_at?: string;
};

type ProductUnitPrice = {
  price_level: string;
  price: number;
};

type ProductUnit = {
  id: string;
  unit_name: string;
  conversion_factor: number;
  barcode?: string | null;
  prices: ProductUnitPrice[];
};

type Product = {
  id: string;
  name_ar: string;
  sku?: string | null;
  barcode?: string | null;
  current_stock: number;
  units: ProductUnit[];
};

type ReplacementItem = {
  product: Product;
  unit_id: string;
  price_level: string;
  quantity: number;
};

type Preview = {
  payment_method: string;
  returned_value: number;
  replacement_value: number;
  refund_amount: number;
  charge_amount: number;
  wallet_fee_amount: number;
  collection_amount: number;
};

type ReturnRecord = {
  id: string;
  public_number: number;
  kind: "REFUND" | "EXCHANGE";
  refund_amount: number;
  charge_amount: number;
  wallet_fee_amount: number;
  collection_amount: number;
  payment_method: string;
  created_at: string;
  order_public_number?: number;
  exchange_order_public_number?: number;
};

const statusLabel: Record<string, string> = {
  Delivered: "تم التسليم",
  Closed: "مغلق",
  Returned: "مسترجع",
};

const paymentLabel: Record<string, string> = {
  Cash: "نقدي",
  Wallet: "محفظة",
  "Credit Card": "بطاقة بنكية",
  "Vodafone Cash": "فودافون كاش",
  Instapay: "إنستاباي",
  "Bank Transfer": "تحويل بنكي",
  "Deferred Payment": "آجل",
};

const priceLevelLabel: Record<string, string> = {
  Retail: "قطاعي",
  "Semi Wholesale": "نصف جملة",
  Wholesale: "جملة",
  "Super Wholesale": "جملة الجملة",
  VIP: "خاص",
};

const RETURNABLE_PAGE_SIZE = 50;
const money = (value: number | string | undefined) => Number(value || 0).toFixed(2);

// ── Main Component ──────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [hasMoreOrders, setHasMoreOrders] = useState(true);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [isAdmin] = useState(() => getUserRole() === "ADMIN");
  const [showRecentOrders, setShowRecentOrders] = useState(false);

  // Invoice lookup state
  const [orderFilter, setOrderFilter] = useState("");
  const [orderId, setOrderId] = useState("");
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  // Return quantities & mode
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [kind, setKind] = useState<"REFUND" | "EXCHANGE">("EXCHANGE");
  const [settlementMethod, setSettlementMethod] = useState<string>("Cash");

  // Replacement search & items
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [replacements, setReplacements] = useState<ReplacementItem[]>([]);

  // Preview & Submit
  const [preview, setPreview] = useState<Preview | null>(null);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Invoice live search & quick access
  const [invoiceSearchResults, setInvoiceSearchResults] = useState<ReturnableSearchResult[]>([]);
  const [invoiceSearching, setInvoiceSearching] = useState(false);
  const updateOrderFilter = (value: string) => {
    setOrderFilter(value);
    setInvoiceSearching(Boolean(value.trim()));
    if (!value.trim()) setInvoiceSearchResults([]);
  };
  const [invoiceSearchOpen, setInvoiceSearchOpen] = useState(false);
  const [recentInvoices, setRecentInvoices] = useState<ReturnableSearchResult[]>([]);
  const invoiceSearchRef = useRef<HTMLDivElement>(null);

  // History & feedback
  const [history, setHistory] = useState<ReturnRecord[]>([]);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [printStatus, setPrintStatus] = useState("");
  const [printingId, setPrintingId] = useState<string | null>(null);

  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const reviewSequence = useRef(0);
  const scanKeys = useRef(emptyBarcodeScanCapture());
  const invoiceScanKeys = useRef(emptyBarcodeScanCapture());

  useEffect(() => {
    // Load recent returnable orders for quick selection (available to Admin and Cashier)
    fetchApi("/returns/search?limit=10", { silentErrors: true })
      .then((data: ReturnableSearchResult[]) => {
        setRecentInvoices(data);
      })
      .catch(() => {});

    fetchApi("/cash-register/current")
      .then(shift => setShiftOpen(Boolean(shift)))
      .catch(() => setShiftOpen(null));
  }, []);

  // Debounced search for invoices by number, name, phone, or barcode
  useEffect(() => {
    const q = orderFilter.trim();
    if (!q) return;
    let active = true;
    const timer = window.setTimeout(() => {
      fetchApi(`/returns/search?q=${encodeURIComponent(q)}&limit=10`, { silentErrors: true })
        .then((data: ReturnableSearchResult[]) => {
          if (!active) return;
          setInvoiceSearchResults(data);
          setInvoiceSearchOpen(true);
        })
        .catch(() => {
          if (!active) return;
          setInvoiceSearchResults([]);
        })
        .finally(() => {
          if (active) setInvoiceSearching(false);
        });
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [orderFilter]);

  // Close invoice search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!invoiceSearchRef.current?.contains(e.target as Node)) {
        setInvoiceSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadOrder = useCallback(async (id: string) => {
    const [eligible, records] = await Promise.all([
      fetchApi(`/returns/eligibility/${id}`),
      fetchApi(`/returns?order_id=${id}`),
    ]);
    return { eligible: eligible as Eligibility, records: records as ReturnRecord[] };
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    loadOrder(orderId)
      .then(({ eligible, records }) => {
        if (!active) return;
        setEligibility(eligible);
        setSettlementMethod(eligible.payment_method || "Cash");
        setHistory(records);
        setMessage("");
      })
      .catch(error => {
        if (!active) return;
        setEligibility(null);
        setHistory([]);
        setMessage(errorMessage(error, "تعذر تحميل بيانات الفاتورة"));
      })
      .finally(() => {
        if (active) setLoadingOrder(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, loadOrder]);

  useEffect(() => {
    if (kind !== "EXCHANGE" || !search.trim() || !eligibility) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError("");
      fetchApi(
        `/pos/search?q=${encodeURIComponent(search.trim())}&warehouse_id=${encodeURIComponent(
          eligibility.warehouse_id
        )}&limit=20`
      )
        .then((data: Product[]) => {
          if (!active) return;
          setProducts(data);
          if (data.length === 0) {
            setSearchError("لا توجد نتائج مطابقة في هذا المستودع");
          }
        })
        .catch(error => {
          if (!active) return;
          setProducts([]);
          setSearchError(errorMessage(error, "تعذر البحث عن الأصناف"));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 100);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search, kind, eligibility]);

  const invalidatePreview = () => {
    ++reviewSequence.current;
    setPreview(null);
    requestRef.current = null;
    setActionError("");
  };

  const selectOrder = (id: string) => {
    if (busy) return;
    invalidatePreview();
    setOrderId(id);
    setEligibility(null);
    setHistory([]);
    setQuantities({});
    setReplacements([]);
    setProducts([]);
    setSearch("");
    setSearching(false);
    setLoadingOrder(Boolean(id));
    setSuccess("");
    setMessage("");
    setInvoiceSearchOpen(false);
  };

  useSectionSearchSelection(selectOrder);

  async function lookupOrder(explicitNumber?: string) {
    const rawNumber = (explicitNumber ?? orderFilter).trim();
    if (!rawNumber || busy || lookingUp) return;
    setInvoiceSearchOpen(false);

    // If exact match exists in live results, select directly!
    const exact = invoiceSearchResults.find(
      r => String(r.public_number) === rawNumber || r.id === rawNumber
    );
    if (exact) {
      setOrderFilter(String(exact.public_number));
      selectOrder(exact.id);
      return;
    }
    if (invoiceSearchResults.length === 1 && !rawNumber.includes(" ")) {
      setOrderFilter(String(invoiceSearchResults[0].public_number));
      selectOrder(invoiceSearchResults[0].id);
      return;
    }

    selectOrder("");
    setLookingUp(true);
    setMessage("");
    try {
      const invoice = (await fetchApi(
        `/returns/lookup/${encodeURIComponent(rawNumber)}`,
        { invalidateSnapshots: false }
      )) as { id: string };
      selectOrder(invoice.id);
    } catch (error) {
      setMessage(
        (error as { status?: number })?.status === 404
          ? "لم يتم العثور على فاتورة مكتملة بهذا الرقم أو البحث"
          : errorMessage(error, "تعذر البحث عن الفاتورة")
      );
    } finally {
      setLookingUp(false);
    }
  }

  // ── Validation & Calculations ─────────────────────────────────────────────

  const selectedLines = useMemo(() => {
    if (!eligibility) return [];
    return eligibility.items.filter(item => Number(quantities[item.order_item_id]) > 0);
  }, [eligibility, quantities]);

  const quantitiesValid = useMemo(() => {
    if (selectedLines.length === 0) return false;
    return selectedLines.every(item => {
      const val = quantities[item.order_item_id];
      return (
        Number.isFinite(val) &&
        val > 0 &&
        val <= item.remaining_quantity &&
        !item.manual_review &&
        Math.abs(val * 100 - Math.round(val * 100)) < 1e-6
      );
    });
  }, [selectedLines, quantities]);

  const replacementStockUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of replacements) {
      const unit = item.product.units.find(u => u.id === item.unit_id);
      const factor = Number(unit?.conversion_factor || 1);
      map.set(item.product.id, (map.get(item.product.id) || 0) + item.quantity * factor);
    }
    return map;
  }, [replacements]);

  const replacementsValid = useMemo(() => {
    if (kind === "REFUND") return true;
    if (replacements.length === 0) return false;
    return replacements.every(item => {
      const unit = item.product.units.find(u => u.id === item.unit_id);
      const price = unit?.prices.find(p => p.price_level === item.price_level);
      const availableStock = Number(item.product.current_stock || 0);
      const requestedStock = replacementStockUsage.get(item.product.id) || 0;
      return (
        Boolean(unit && price && Number(price.price) > 0) &&
        item.quantity > 0 &&
        Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) < 1e-6 &&
        requestedStock <= availableStock
      );
    });
  }, [kind, replacements, replacementStockUsage]);

  const canPreview = Boolean(
    eligibility &&
    selectedLines.length > 0 &&
    quantitiesValid &&
    replacementsValid &&
    !busy
  );

  const historicalDiscountFactor = eligibility?.subtotal_amount
    ? Math.max(0, 1 - Number(eligibility.discount_amount || 0) / eligibility.subtotal_amount)
    : 1;
  const estimatedReturnedTotal = useMemo(() => {
    return selectedLines.reduce((sum, item) => {
      const qty = Number(quantities[item.order_item_id]) || 0;
      return sum + qty * Number(item.unit_price || 0) * historicalDiscountFactor;
    }, 0);
  }, [selectedLines, quantities, historicalDiscountFactor]);

  const estimatedReplacementTotal = useMemo(() => {
    if (kind !== "EXCHANGE") return 0;
    return replacements.reduce((sum, item) => {
      const unit = item.product.units.find(u => u.id === item.unit_id);
      const price = unit?.prices.find(p => p.price_level === item.price_level);
      return sum + Number(item.quantity || 0) * Number(price?.price || 0);
    }, 0);
  }, [kind, replacements]);

  const estimatedDifference = estimatedReplacementTotal - estimatedReturnedTotal;

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleSetReturnQty(orderItemId: string, qty: number, maxQty: number) {
    invalidatePreview();
    const safeQty = Math.max(0, Math.min(qty, maxQty));
    setQuantities(prev => {
      if (safeQty === 0) {
        const next = { ...prev };
        delete next[orderItemId];
        return next;
      }
      return { ...prev, [orderItemId]: safeQty };
    });
  }

  function handleToggleReturnItem(item: EligibleItem) {
    if (item.manual_review) return;
    const current = Number(quantities[item.order_item_id]) || 0;
    if (current > 0) {
      handleSetReturnQty(item.order_item_id, 0, item.remaining_quantity);
    } else {
      handleSetReturnQty(item.order_item_id, item.remaining_quantity, item.remaining_quantity);
    }
  }

  function addReplacement(product: Product) {
    if (busy) return;
    const customerLevel = eligibility?.customer_price_level || "Retail";

    let targetUnit = product.units.find(u =>
      u.prices.some(p => p.price_level === customerLevel && Number(p.price) > 0)
    );
    let targetPrice = targetUnit?.prices.find(
      p => p.price_level === customerLevel && Number(p.price) > 0
    );

    if (!targetUnit && isAdmin) {
      targetUnit = product.units.find(u => u.prices.some(p => Number(p.price) > 0));
      targetPrice = targetUnit?.prices.find(p => Number(p.price) > 0);
    }

    if (!targetUnit || !targetPrice) {
      setActionError(`لا يوجد سعر محدد للصنف (${product.name_ar}) بفئة ${priceLevelLabel[customerLevel] || customerLevel}`);
      return;
    }

    const availableStock = Number(product.current_stock || 0);
    if (availableStock <= 0) {
      setActionError(`الصنف (${product.name_ar}) غير متوفر في المستودع الحالي`);
      return;
    }

    invalidatePreview();
    setReplacements(prev => {
      const existingIdx = prev.findIndex(
        item => item.product.id === product.id && item.unit_id === targetUnit!.id
      );
      if (existingIdx >= 0) {
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          product,
          unit_id: targetUnit!.id,
          price_level: targetPrice!.price_level,
          quantity: 1,
        },
      ];
    });

    setSearch("");
    setProducts([]);
    setSearching(false);
    setActionError("");
  }

  function handleUpdateReplacementQty(index: number, newQty: number) {
    invalidatePreview();
    const safeQty = Math.max(0.01, Number(newQty) || 0.01);
    setReplacements(prev =>
      prev.map((item, i) => (i === index ? { ...item, quantity: safeQty } : item))
    );
  }

  function handleUpdateReplacementUnit(index: number, unitId: string) {
    invalidatePreview();
    setReplacements(prev =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const newUnit = item.product.units.find(u => u.id === unitId);
        if (!newUnit) return item;
        const customerLevel = eligibility?.customer_price_level || "Retail";
        const price =
          newUnit.prices.find(p => p.price_level === customerLevel && Number(p.price) > 0) ||
          newUnit.prices[0];
        return {
          ...item,
          unit_id: newUnit.id,
          price_level: price?.price_level || "Retail",
        };
      })
    );
  }

  function handleUpdateReplacementPriceLevel(index: number, level: string) {
    invalidatePreview();
    setReplacements(prev =>
      prev.map((item, i) => (i === index ? { ...item, price_level: level } : item))
    );
  }

  function handleRemoveReplacement(index: number) {
    invalidatePreview();
    setReplacements(prev => prev.filter((_, i) => i !== index));
  }

  const buildPayload = (id: string, confirmed: boolean) => ({
    request_id: id,
    order_id: orderId,
    warehouse_id: eligibility!.warehouse_id,
    kind,
    settlement_payment_method: settlementMethod as "Cash" | "Credit Card" | "Instapay" | "Wallet" | "Deferred Payment",
    settlement_confirmed: confirmed,
    lines: selectedLines.map(item => ({
      order_item_id: item.order_item_id,
      quantity: quantities[item.order_item_id],
    })),
    replacements:
      kind === "EXCHANGE"
        ? replacements.map(item => ({
            product_id: item.product.id,
            unit_id: item.unit_id,
            price_level: item.price_level || eligibility?.customer_price_level || "Retail",
            quantity: item.quantity,
          }))
        : [],
  });

  async function review() {
    if (!canPreview) return;
    const sequence = ++reviewSequence.current;
    setBusy(true);
    setMessage("");
    setActionError("");
    setSuccess("");

    try {
      const draft = buildPayload(crypto.randomUUID(), false);
      const fingerprint = JSON.stringify({
        ...draft,
        request_id: undefined,
        settlement_confirmed: undefined,
      });
      const id =
        requestRef.current?.fingerprint === fingerprint
          ? requestRef.current.id
          : draft.request_id;
      requestRef.current = { fingerprint, id };

      const quote = (await fetchApi("/returns/preview", {
        method: "POST",
        body: JSON.stringify({ ...draft, request_id: id }),
        invalidateSnapshots: false,
      })) as Preview;

      if (sequence !== reviewSequence.current) return;
      setPreview(quote);

      if (
        quote.payment_method === "Cash" &&
        (Number(quote.refund_amount) > 0 || Number(quote.charge_amount) > 0)
      ) {
        fetchApi("/cash-register/current")
          .then(shift => {
            if (sequence === reviewSequence.current) setShiftOpen(Boolean(shift));
          })
          .catch(() => {
            if (sequence === reviewSequence.current) setShiftOpen(null);
          });
      }
    } catch (error) {
      if (sequence === reviewSequence.current) {
        setActionError(errorMessage(error, "تعذر حساب تسوية العملية"));
      }
    } finally {
      if (sequence === reviewSequence.current) setBusy(false);
    }
  }

  async function submit() {
    if (!preview || busy) return;
    if (!requestRef.current || !canPreview) {
      setActionError("تغيرت البيانات. أعد مراجعة الحساب قبل التسجيل.");
      return;
    }

    const needsCashSettlement =
      preview.payment_method === "Cash" &&
      (Number(preview.refund_amount) > 0 || Number(preview.charge_amount) > 0);

    if (needsCashSettlement && shiftOpen !== true) {
      setActionError(
        shiftOpen === null
          ? "تعذر التأكد من حالة الوردية. أعد مراجعة المبلغ."
          : "وردية الصندوق مغلقة. افتح ورديتك أولاً لإتمام التسوية النقدية."
      );
      return;
    }

    setBusy(true);
    setMessage("");
    setActionError("");

    try {
      const record = (await fetchApi("/returns", {
        method: "POST",
        body: JSON.stringify({
          ...buildPayload(requestRef.current.id, true),
          expected_refund_amount: preview.refund_amount,
          expected_charge_amount: preview.charge_amount,
        }),
      })) as ReturnRecord;

      const isRefund = record.kind === "REFUND";
      const opLabel = isRefund ? "الاسترجاع" : "الاستبدال";
      const refundAmt = Number(record.refund_amount);
      const chargeAmt = Number(record.collection_amount);

      let summaryDiff = "بدون فرق مالي";
      if (refundAmt > 0) summaryDiff = `${record.payment_method === "Deferred Payment" ? "المخصوم من رصيد العميل" : "المرتد"} ${money(refundAmt)} ج.م`;
      if (chargeAmt > 0) summaryDiff = `${record.payment_method === "Deferred Payment" ? "المضاف إلى رصيد العميل" : "المحصل"} ${money(chargeAmt)} ج.م`;

      setSuccess(`تم تسجيل ${opLabel} بنجاح. ${summaryDiff}.`);
      setHistory(prev => [record, ...prev.filter(r => r.id !== record.id)]);

      setPrintStatus("جارٍ إرسال الإيصال للطباعة...");
      void printSalesReturnReceipt(record.id)
        .then(() => setPrintStatus("تم إرسال الإيصال للطباعة."))
        .catch(err => setPrintStatus(errorMessage(err, "تعذر إرسال الإيصال للطباعة.")));

      setQuantities({});
      setReplacements([]);
      setSearch("");
      setProducts([]);
      setPreview(null);
      requestRef.current = null;

      try {
        const { eligible, records } = await loadOrder(orderId);
        setEligibility(eligible);
        setHistory(records);
      } catch {
        setMessage("تم التسجيل. حدّث الصفحة لعرض أحدث حالة للفاتورة.");
      }
    } catch (error) {
      const detail = errorMessage(error, "تعذر تسجيل العملية.");
      if (detail.includes("settlement changed")) {
        setPreview(null);
        requestRef.current = null;
      }
      setActionError(detail);
    } finally {
      setBusy(false);
    }
  }

  async function reprint(recordId: string) {
    if (printingId) return;
    setPrintingId(recordId);
    setPrintStatus("");
    try {
      await printSalesReturnReceipt(recordId);
      setPrintStatus("تم إرسال الإيصال للطباعة.");
    } catch (error) {
      setPrintStatus(errorMessage(error, "تعذر إرسال الإيصال للطباعة."));
    } finally {
      setPrintingId(null);
    }
  }

  async function loadMoreReturnableOrders() {
    if (!hasMoreOrders || loadingMoreOrders) return;
    setLoadingMoreOrders(true);
    try {
      const page = (await fetchApi(
        `/orders?group=returnable&limit=${RETURNABLE_PAGE_SIZE}&offset=${orders.length}`
      )) as Order[];
      const combined = [...orders, ...page.filter(o => !orders.some(e => e.id === o.id))];
      setOrders(combined);
      setHasMoreOrders(page.length === RETURNABLE_PAGE_SIZE);
      writeSectionSnapshot("returnable-orders", combined);
    } catch (error) {
      setMessage(errorMessage(error, "تعذر تحميل فواتير إضافية"));
    } finally {
      setLoadingMoreOrders(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface overflow-x-hidden selection:bg-primary/30" dir="rtl">
      <main className="app-main space-y-6">
        {/* Standard System Heading matching Inventory, Customers & Orders */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <h1 className="app-heading">المرتجعات والاستبدال</h1>
        </div>

        {/* Status messages */}
        {message && (
          <div role="alert" className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage("")} className="text-sm text-red-400 underline">إغلاق</button>
          </div>
        )}

        {(success || printStatus) && (
          <div role="status" className="fixed bottom-6 left-6 right-6 z-[100] ml-auto max-w-md rounded-2xl border border-emerald-500/40 bg-[#1c1b1b] p-4 text-sm shadow-xl">
            {success && <p className="font-semibold text-emerald-400">{success}</p>}
            {printStatus && <p className="app-muted mt-1 text-sm">{printStatus}</p>}
            <button
              type="button"
              className="mt-2 text-sm text-[#a98a7d] underline hover:text-white"
              onClick={() => { setSuccess(""); setPrintStatus(""); }}
            >
              إغلاق
            </button>
          </div>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* Column 1: Original Invoice & Items to Return */}
          <div className="min-w-0 space-y-6">
            <section className="app-panel space-y-4 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">الفاتورة الأصلية</h2>
                {eligibility && (
                  <button
                    type="button"
                    onClick={() => { selectOrder(""); setOrderFilter(""); }}
                    className="text-sm font-semibold text-[#ff6b00] hover:underline"
                  >
                    تغيير الفاتورة
                  </button>
                )}
              </div>

              {!eligibility ? (
                loadingOrder ? (
                  <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-[#171717] p-8 text-sm text-white">
                    <span className="material-symbols-outlined animate-spin text-[#ff6b00]">sync</span>
                    <span>جارٍ تحميل بيانات الفاتورة...</span>
                  </div>
                ) : (
                <div className="space-y-4">
                  <TopNavSearchPortal overlay>
                  <div className="relative" ref={invoiceSearchRef}>
                    <form
                      id="return-lookup-form"
                      className="flex w-full min-w-0 gap-2"
                      onSubmit={e => {
                        e.preventDefault();
                        void lookupOrder();
                      }}
                    >
                      <div className="relative min-w-0 flex-1">
                        <input
                          type="search"
                          className="app-search app-search-focus h-10 w-full rounded-full px-4 text-sm"
                          aria-label="رقم الفاتورة أو اسم العميل أو الهاتف"
                          placeholder="ابحث برقم الفاتورة، اسم العميل، الهاتف أو مسح الباركود"
                          value={orderFilter}
                          disabled={busy || lookingUp}
                          onFocus={() => {
                            if (orderFilter.trim() || recentInvoices.length > 0) {
                              setInvoiceSearchOpen(true);
                            }
                          }}
                          onChange={e => {
                            setOrderFilter(e.target.value);
                            setInvoiceSearchOpen(true);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Escape") {
                              setInvoiceSearchOpen(false);
                              return;
                            }
                            if (e.key !== "Enter") {
                              if (!e.nativeEvent.isComposing) recordBarcodeScanKey(invoiceScanKeys.current, e);
                              return;
                            }
                            const code = englishBarcodeFromScan(invoiceScanKeys.current, e.currentTarget.value.trim());
                            if (code) {
                              e.preventDefault();
                              setOrderFilter(code);
                              void lookupOrder(code);
                            }
                          }}
                        />
                        {orderFilter && (
                          <button
                            type="button"
                            onClick={() => {
                              setOrderFilter("");
                              setInvoiceSearchResults([]);
                              setInvoiceSearchOpen(false);
                            }}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#a98a7d] hover:text-white"
                            aria-label="مسح البحث"
                          >
                            مسح
                          </button>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={busy || lookingUp || !orderFilter.trim()}
                        className="app-primary-button hidden h-10 shrink-0 px-3 text-sm font-bold sm:inline-flex"
                      >
                        {lookingUp ? "جارٍ البحث..." : "فتح الفاتورة"}
                      </button>
                    </form>

                    {/* Live search dropdown results */}
                    {invoiceSearchOpen && (orderFilter.trim().length > 0 || recentInvoices.length > 0) && (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-[#1c1b1b] p-2 shadow-2xl">
                        {invoiceSearching ? (
                          <p className="app-muted p-3 text-sm">جارٍ البحث...</p>
                        ) : orderFilter.trim() ? (
                          invoiceSearchResults.length > 0 ? (
                            <div className="space-y-1">
                              <div className="px-3 py-1.5 text-xs text-[#a98a7d] font-semibold">نتائج البحث</div>
                              {invoiceSearchResults.map(item => (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setOrderFilter(String(item.public_number));
                                    selectOrder(item.id);
                                    setInvoiceSearchOpen(false);
                                  }}
                                  className="flex w-full items-center justify-between gap-3 rounded-lg p-2.5 text-right text-sm hover:bg-white/10 transition-colors"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <strong className="text-white font-bold text-sm">فاتورة {item.public_number}</strong>
                                      <span className="text-xs text-[#a98a7d]">· {paymentLabel[item.payment_method] || item.payment_method}</span>
                                    </div>
                                    <div className="text-xs text-[#a98a7d] truncate mt-0.5">
                                      {item.customer_name}
                                      {item.customer_phone ? ` · ${item.customer_phone}` : ""}
                                    </div>
                                  </div>
                                  <div className="shrink-0 font-bold text-[#ff6b00]">
                                    <span className="tabular-nums">{money(item.total_amount)}</span> ج.م
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="app-muted p-3 text-sm">لا توجد فواتير مطابقة لهذا البحث</p>
                          )
                        ) : (
                          <div className="space-y-1">
                            <div className="px-3 py-1.5 text-xs text-[#a98a7d] font-semibold">الفواتير المكتملة الأخيرة</div>
                            {recentInvoices.map(item => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setOrderFilter(String(item.public_number));
                                  selectOrder(item.id);
                                  setInvoiceSearchOpen(false);
                                }}
                                className="flex w-full items-center justify-between gap-3 rounded-lg p-2.5 text-right text-sm hover:bg-white/10 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <strong className="text-white font-bold text-sm">فاتورة {item.public_number}</strong>
                                    <span className="text-xs text-[#a98a7d]">· {paymentLabel[item.payment_method] || item.payment_method}</span>
                                  </div>
                                  <div className="text-xs text-[#a98a7d] truncate mt-0.5">
                                    {item.customer_name}
                                    {item.customer_phone ? ` · ${item.customer_phone}` : ""}
                                  </div>
                                </div>
                                <div className="shrink-0 font-bold text-[#ff6b00]">
                                  <span className="tabular-nums">{money(item.total_amount)}</span> ج.م
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  </TopNavSearchPortal>
                  <p className="app-muted text-sm">ابحث عن الفاتورة من الشريط العلوي أو اخترها من النتائج الأخيرة.</p>
                </div>
                )
              ) : (
                <div className="rounded-xl border border-white/10 bg-[#171717] p-4 text-sm space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <span className="text-[#a98a7d] block text-sm">رقم الفاتورة</span>
                      <strong className="text-white text-base font-bold">
                        {eligibility.public_number ? `فاتورة ${eligibility.public_number}` : `#${orderFilter || orderId.slice(-8)}`}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#a98a7d] block text-sm">العميل</span>
                      <strong className="text-white text-base font-bold">
                        {eligibility.customer_name || "عميل نقدي"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[#a98a7d] block text-sm">وسيلة الدفع</span>
                      <strong className="text-white text-base font-bold">{paymentLabel[eligibility.payment_method] || eligibility.payment_method}</strong>
                    </div>
                    <div>
                      <span className="text-[#a98a7d] block text-sm">فئة السعر</span>
                      <strong className="text-white text-base font-bold">{priceLevelLabel[eligibility.customer_price_level] || eligibility.customer_price_level}</strong>
                    </div>
                  </div>

                  {(eligibility.payment_method === "Wallet" || Number(eligibility.wallet_fee_amount || 0) > 0) && (
                    <div className="border-t border-white/10 pt-3 text-xs text-[#a98a7d]">
                      رسوم المحفظة 1% غير قابلة للاسترداد وتُستثنى تلقائيًا من الإرجاع.
                      {Number(eligibility.wallet_fee_amount || 0) > 0 && (
                        <span className="text-white ms-2 font-medium">
                          المبلغ غير المسترد: <span className="tabular-nums font-bold text-[#ff6b00]">{money(eligibility.wallet_fee_amount)}</span> ج.م
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            {eligibility && (
              <section className="app-panel space-y-4 p-5 sm:p-6">
                <h2 className="text-lg font-bold text-white">الأصناف المتاحة للإرجاع</h2>

                {eligibility.items.every(item => item.remaining_quantity <= 0) ? (
                  <p className="app-muted text-sm">تم إرجاع جميع كميات هذه الفاتورة بالكامل.</p>
                ) : (
                  <div className="space-y-3">
                    {eligibility.items.map(item => {
                      const isReturnable = item.remaining_quantity > 0 && !item.manual_review;
                      const returnQty = quantities[item.order_item_id] || 0;
                      const isSelected = returnQty > 0;
                      const itemTotal = returnQty * Number(item.unit_price || 0) * historicalDiscountFactor;

                      return (
                        <div
                          key={item.order_item_id}
                          className={`rounded-xl border p-4 transition-colors ${
                            isSelected
                              ? "border-[#ff6b00]/50 bg-[#231e1a]"
                              : isReturnable
                              ? "border-white/10 bg-[#171717]"
                              : "border-white/5 bg-[#171717] opacity-50"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                              <input
                                type="checkbox"
                                id={`check-${item.order_item_id}`}
                                checked={isSelected}
                                disabled={!isReturnable || busy}
                                onChange={() => handleToggleReturnItem(item)}
                                className="h-5 w-5 rounded accent-[#ff6b00] cursor-pointer"
                              />
                              <div>
                                <label
                                  htmlFor={`check-${item.order_item_id}`}
                                  className="font-bold text-base text-white cursor-pointer hover:text-[#ff6b00]"
                                >
                                  {item.product_name}
                                </label>
                                <div className="app-muted text-sm mt-0.5">
                                  {item.unit_name} · سعر الفاتورة وقت البيع: {money(item.unit_price)} ج.م · المتاح للإرجاع: {item.remaining_quantity}
                                </div>
                                {item.manual_review && (
                                  <p className="text-sm text-amber-500 mt-1">يلزم مراجعة مكونات هذا الصنف يدوياً قبل الإرجاع.</p>
                                )}
                              </div>
                            </div>

                            {isReturnable && (
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={busy || returnQty <= 0}
                                    onClick={() => handleSetReturnQty(item.order_item_id, returnQty - 1, item.remaining_quantity)}
                                    className="h-10 w-10 rounded-lg border border-white/15 bg-white/5 text-base font-bold hover:bg-white/10 disabled:opacity-30"
                                  >
                                    -
                                  </button>
                                  <ZeroHintNumberInput
                                    className="app-field h-10 w-24 text-center font-bold text-sm tabular-nums"
                                    aria-label={`كمية إرجاع ${item.product_name}`}
                                    inputMode="decimal"
                                    min="0"
                                    max={item.remaining_quantity}
                                    step="0.01"
                                    disabled={busy}
                                    value={returnQty || ""}
                                    onChange={e => handleSetReturnQty(item.order_item_id, Number(e.target.value) || 0, item.remaining_quantity)}
                                  />
                                  <button
                                    type="button"
                                    disabled={busy || returnQty >= item.remaining_quantity}
                                    onClick={() => handleSetReturnQty(item.order_item_id, returnQty + 1, item.remaining_quantity)}
                                    className="h-10 w-10 rounded-lg border border-white/15 bg-white/5 text-base font-bold hover:bg-white/10 disabled:opacity-30"
                                  >
                                    +
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  disabled={busy || returnQty === item.remaining_quantity}
                                  onClick={() => handleSetReturnQty(item.order_item_id, item.remaining_quantity, item.remaining_quantity)}
                                  className="text-sm font-semibold text-[#a98a7d] hover:text-[#ff6b00] underline"
                                >
                                  الكل
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedLines.length > 0 && (
                  <div className="flex items-center justify-between rounded-xl bg-white/5 p-3.5 text-sm">
                    <span className="text-[#a98a7d]">الأصناف المحددة للإرجاع: {selectedLines.length}</span>
                    <span className="font-bold text-emerald-400 text-base">
                      إجمالي المرتجع: <span className="tabular-nums">{money(estimatedReturnedTotal)}</span> ج.م
                    </span>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Column 2: Mode, Replacements, Financial Settlement */}
          <div className="min-w-0 space-y-6">
            {eligibility && (
              <>
                <section className="app-panel space-y-4 p-5 sm:p-6">
                  <h2 className="text-lg font-bold text-white">نوع العملية</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        invalidatePreview();
                        setKind("EXCHANGE");
                      }}
                      className={`rounded-xl border py-3 px-4 text-center text-sm font-bold transition-colors ${
                        kind === "EXCHANGE"
                          ? "border-[#ff6b00] bg-[#ff6b00]/15 text-white"
                          : "border-white/10 bg-[#171717] text-[#a98a7d] hover:text-white"
                      }`}
                    >
                      استبدال
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        invalidatePreview();
                        setKind("REFUND");
                      }}
                      className={`rounded-xl border py-3 px-4 text-center text-sm font-bold transition-colors ${
                        kind === "REFUND"
                          ? "border-emerald-500 bg-emerald-500/15 text-white"
                          : "border-white/10 bg-[#171717] text-[#a98a7d] hover:text-white"
                      }`}
                    >
                      استرجاع
                    </button>
                  </div>
                </section>

                {kind === "EXCHANGE" && (
                  <section className="app-panel space-y-4 p-5 sm:p-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-white">الأصناف البديلة</h2>
                      <span className="text-sm text-[#a98a7d]">{replacements.length} أصناف</span>
                    </div>

                    <TopNavSearchPortal overlay>
                    <div className="relative w-full">
                      <input
                        type="search"
                        className="app-search app-search-focus h-10 w-full rounded-full px-4 text-sm"
                        aria-label="بحث عن صنف بديل"
                        placeholder="ابحث باسم الصنف أو امسح الباركود..."
                        value={search}
                        disabled={busy}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key !== "Enter") {
                            if (!e.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, e);
                            return;
                          }
                          const code = englishBarcodeFromScan(scanKeys.current, e.currentTarget.value.trim());
                          if (code) {
                            e.preventDefault();
                            setSearch(code);
                          }
                        }}
                      />

                      {products.length > 0 && (
                        <div className="absolute right-0 left-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-xl border border-white/15 bg-[#1f1e1e] p-2 shadow-xl">
                          {products.map(product => {
                            const customerLevel = eligibility?.customer_price_level || "Retail";
                            const unit =
                              product.units.find(u =>
                                u.prices.some(p => p.price_level === customerLevel && Number(p.price) > 0)
                              ) || (isAdmin ? product.units.find(u => u.prices.some(p => Number(p.price) > 0)) : undefined);
                            const price =
                              unit?.prices.find(p => p.price_level === customerLevel && Number(p.price) > 0) ||
                              (isAdmin ? unit?.prices.find(p => Number(p.price) > 0) : undefined);
                            const inStock = Number(product.current_stock || 0) > 0;

                            return (
                              <button
                                key={product.id}
                                type="button"
                                disabled={busy || !inStock || !price}
                                onClick={() => addReplacement(product)}
                                className="flex w-full items-center justify-between gap-3 rounded-lg p-2.5 text-right text-sm hover:bg-white/10 disabled:opacity-40"
                              >
                                <div>
                                  <div className="font-bold text-white text-sm">{product.name_ar}</div>
                                  <div className="text-[#a98a7d] text-sm mt-0.5">
                                    {unit?.unit_name || "—"} · المتاح: {product.current_stock}
                                  </div>
                                </div>
                                <div className="font-bold text-[#ff6b00]">
                                  {price ? <><span className="tabular-nums">{money(price.price)}</span> ج.م</> : "بلا سعر"}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {searchError && <p className="mt-2 text-sm text-amber-400">{searchError}</p>}
                    </div>
                    </TopNavSearchPortal>

                    {replacements.length === 0 ? (
                      <p className="app-muted text-center py-6 text-sm">ابحث عن الأصناف البديلة لإضافتها هنا</p>
                    ) : (
                      <div className="space-y-3">
                        {replacements.map((item, index) => {
                          const unit = item.product.units.find(u => u.id === item.unit_id);
                          const price = unit?.prices.find(p => p.price_level === item.price_level);
                          const unitPrice = Number(price?.price || 0);
                          const lineTotal = item.quantity * unitPrice;
                          const availableStock = Number(item.product.current_stock || 0);
                          const totalRequestedStock = replacementStockUsage.get(item.product.id) || 0;
                          const isStockExceeded = totalRequestedStock > availableStock;

                          return (
                            <div
                              key={`${item.product.id}-${index}`}
                              className={`rounded-xl border p-4 text-sm ${
                                isStockExceeded ? "border-red-500/50 bg-red-500/10" : "border-white/10 bg-[#171717]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <strong className="text-white text-base">{item.product.name_ar}</strong>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleRemoveReplacement(index)}
                                  className="text-sm font-semibold text-red-400 hover:text-red-300 underline"
                                >
                                  حذف
                                </button>
                              </div>

                              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                                <div className="space-y-1.5">
                                  <label className="text-[#a98a7d] block text-xs font-medium">الوحدة</label>
                                  <ProductSelect
                                    label="الوحدة"
                                    placeholder="اختر الوحدة"
                                    value={item.unit_id}
                                    disabled={busy}
                                    compact
                                    allowClear={false}
                                    options={item.product.units.map(u => ({ value: u.id, label: u.unit_name }))}
                                    onChange={val => handleUpdateReplacementUnit(index, val)}
                                  />
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-[#a98a7d] block text-xs font-medium">فئة السعر</label>
                                  <ProductSelect
                                    label="فئة السعر"
                                    placeholder="اختر فئة السعر"
                                    value={item.price_level}
                                    disabled={busy || !isAdmin}
                                    compact
                                    allowClear={false}
                                    options={(unit?.prices || []).map(p => ({
                                      value: p.price_level,
                                      label: `${priceLevelLabel[p.price_level] || p.price_level} · ${money(p.price)} ج.م`,
                                    }))}
                                    onChange={val => handleUpdateReplacementPriceLevel(index, val)}
                                  />
                                </div>

                                <div>
                                  <label className="text-[#a98a7d] mb-1.5 block text-sm font-medium">الكمية</label>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      disabled={busy || item.quantity <= 1}
                                      onClick={() => handleUpdateReplacementQty(index, item.quantity - 1)}
                                      className="h-10 w-9 rounded-lg border border-white/10 bg-white/5 font-bold hover:bg-white/10"
                                    >
                                      -
                                    </button>
                                    <ZeroHintNumberInput
                                      className="app-field h-10 text-center font-bold text-sm tabular-nums"
                                      inputMode="decimal"
                                      min="0.01"
                                      step="0.01"
                                      value={item.quantity}
                                      disabled={busy}
                                      onChange={e => handleUpdateReplacementQty(index, Number(e.target.value) || 0)}
                                    />
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => handleUpdateReplacementQty(index, item.quantity + 1)}
                                      className="h-10 w-9 rounded-lg border border-white/10 bg-white/5 font-bold hover:bg-white/10"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-sm">
                                <span className="text-[#a98a7d]">سعر الوحدة: {money(unitPrice)} ج.م</span>
                                <span className="font-bold text-[#ff6b00] text-sm">الإجمالي: <span className="tabular-nums">{money(lineTotal)}</span> ج.م</span>
                              </div>
                            </div>
                          );
                        })}

                        <div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm">
                          <span className="text-[#a98a7d]">إجمالي البدائل</span>
                          <span className="font-bold text-[#ff6b00] text-base">
                            <span className="tabular-nums">{money(estimatedReplacementTotal)}</span> ج.م
                          </span>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                <section className="app-panel space-y-4 p-5 sm:p-6">
                  <h2 className="text-lg font-bold text-white">التسوية المالية</h2>

                  <div className="rounded-xl border border-white/10 bg-[#171717] p-4 text-sm space-y-3.5">
                    <div className="space-y-1.5 pb-3 border-b border-white/10">
                      <label className="text-[#a98a7d] block text-xs font-semibold">
                        {settlementMethod === "Deferred Payment"
                          ? "تسوية رصيد العميل"
                          : kind === "REFUND"
                          ? "طريقة استرداد المبلغ"
                          : estimatedDifference > 0
                          ? "طريقة تحصيل فرق الاستبدال"
                          : "طريقة استرداد فرق الاستبدال"}
                      </label>
                      <ProductSelect
                        label="طريقة التسوية"
                        placeholder="اختر طريقة التسوية"
                        value={settlementMethod}
                        disabled={busy}
                        compact
                        allowClear={false}
                        options={[
                          ...(!(eligibility?.payment_method === "Deferred Payment" &&
                            (eligibility.deferred_remaining == null || eligibility.deferred_remaining > 0))
                            ? [
                                { value: "Cash", label: "نقداً" },
                                { value: "Credit Card", label: "بطاقة دفع" },
                                { value: "Instapay", label: "انستاباي" },
                                { value: "Wallet", label: "محفظة إلكترونية" },
                              ]
                            : []),
                          ...(eligibility?.customer_id || eligibility?.payment_method === "Deferred Payment"
                            ? [{ value: "Deferred Payment", label: "دفع آجل" }]
                            : []),
                        ]}
                        onChange={val => {
                          invalidatePreview();
                          setSettlementMethod(val);
                        }}
                      />
                      {eligibility.payment_method === "Deferred Payment" &&
                        (eligibility.deferred_remaining == null || eligibility.deferred_remaining > 0) && (
                          <p className="app-muted text-xs">تُسوّى هذه الفاتورة على رصيد العميل الآجل. أي رد بطريقة أخرى يحتاج مراجعة الرصيد أولًا.</p>
                        )}
                    </div>
                    {kind === "REFUND" ? (
                      <div className="flex items-center justify-between font-bold text-base">
                          <span className="text-white">المبلغ التقديري بسعر الفاتورة بعد الخصم:</span>
                        <strong className="font-bold text-emerald-400 text-base">
                          رد <span className="tabular-nums">{money(estimatedReturnedTotal)}</span> ج.م
                        </strong>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                            <span className="app-muted">قيمة المرتجع التقديرية بعد خصم الفاتورة:</span>
                          <strong className="font-bold text-emerald-400 text-base">
                            <span className="tabular-nums">{money(estimatedReturnedTotal)}</span> ج.م
                          </strong>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="app-muted">قيمة البديل:</span>
                          <strong className="font-bold text-[#ff6b00] text-base">
                            <span className="tabular-nums">{money(estimatedReplacementTotal)}</span> ج.م
                          </strong>
                        </div>

                        <div className="border-t border-white/10 pt-2.5 flex items-center justify-between font-bold text-sm">
                          <span className="text-white">الفارق التقديري:</span>
                          {estimatedDifference > 0 ? (
                            <span className="text-[#ff6b00] font-bold text-base">
                              تحصيل +<span className="tabular-nums">{money(estimatedDifference)}</span> ج.م
                            </span>
                          ) : estimatedDifference < 0 ? (
                            <span className="text-emerald-400 font-bold text-base">
                              رد -<span className="tabular-nums">{money(Math.abs(estimatedDifference))}</span> ج.م
                            </span>
                          ) : (
                            <span className="text-sky-400 text-base font-bold">متكافئ · 0.00 ج.م</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!preview ? (
                    <button
                      type="button"
                      disabled={!canPreview}
                      onClick={review}
                      className="app-primary-button w-full h-12 text-sm font-bold"
                    >
                      {busy ? "جارٍ الحساب..." : "مراجعة المبلغ"}
                    </button>
                  ) : (
                    <div className="space-y-4 rounded-xl border border-[#ff6b00]/30 bg-[#231e1a] p-4 text-sm">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                        <span className="font-bold text-white">المعاينة المعتمدة</span>
                        <button type="button" onClick={invalidatePreview} className="text-sm text-[#a98a7d] underline hover:text-white">
                          تعديل
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {kind === "EXCHANGE" && (
                          <>
                            <div className="flex justify-between">
                              <span className="app-muted">قيمة المرتجع المعتمدة:</span>
                              <strong className="font-bold text-white"><span className="tabular-nums">{money(preview.returned_value)}</span> ج.م</strong>
                            </div>
                            <div className="flex justify-between">
                              <span className="app-muted">قيمة البدائل المعتمدة:</span>
                              <strong className="font-bold text-white"><span className="tabular-nums">{money(preview.replacement_value)}</span> ج.م</strong>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between">
                          <span className="app-muted">وسيلة التسوية:</span>
                          <strong className="text-white">{paymentLabel[preview.payment_method] || preview.payment_method}</strong>
                        </div>
                      </div>

                      <div className="rounded-lg bg-[#171717] p-3 text-center font-bold text-lg">
                        {Number(preview.refund_amount) > 0 ? (
                          <span className="text-emerald-400 font-bold">{preview.payment_method === "Deferred Payment" ? "يُخصم من رصيد العميل" : "يُرد للعميل"} <span className="tabular-nums">{money(preview.refund_amount)}</span> ج.م</span>
                        ) : Number(preview.charge_amount) > 0 ? (
                            <span className="text-[#ff6b00] font-bold">{preview.payment_method === "Deferred Payment" ? "يُضاف إلى رصيد العميل" : "يُحصّل من العميل"} <span className="tabular-nums">{money(preview.collection_amount)}</span> ج.م</span>
                        ) : (
                          <span className="text-sky-400">لا يوجد فرق مالي</span>
                        )}
                      </div>
                      {Number(preview.wallet_fee_amount) > 0 && (
                        <p className="app-muted text-sm">يشمل المبلغ رسوم المحفظة · {money(preview.wallet_fee_amount)} ج.م</p>
                      )}

                      {preview.payment_method === "Cash" &&
                        (Number(preview.refund_amount) > 0 || Number(preview.charge_amount) > 0) &&
                        shiftOpen !== true && (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
                            يلزم فتح وردية الصندوق أولاً لإتمام التسوية النقدية.{" "}
                            <Link href="/cash-register" className="underline font-bold text-white">
                              فتح الصندوق
                            </Link>
                          </div>
                        )}

                      <button
                        type="button"
                        disabled={busy}
                        onClick={submit}
                        className="app-primary-button w-full h-12 text-sm font-bold"
                      >
                        {busy
                          ? "جارٍ التسجيل..."
                          : kind === "REFUND"
                          ? "تسجيل الاسترجاع"
                          : "تسجيل الاستبدال"}
                      </button>
                    </div>
                  )}

                  {actionError && (
                    <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                      {actionError}
                    </div>
                  )}
                </section>
              </>
            )}

            {history.length > 0 && (
              <details className="app-panel rounded-2xl p-5" open>
                <summary className="cursor-pointer font-bold text-base text-white">
                  عمليات سابقة على الفاتورة · {history.length}
                </summary>
                <div className="mt-3 space-y-2.5">
                  {history.map(record => (
                    <div
                      key={record.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#171717] p-3 text-sm"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2 font-semibold text-white">
                          <span>{record.kind === "REFUND" ? "استرجاع" : "استبدال"} رقم {record.public_number}</span>
                          {(() => {
                            const d = new Date(record.created_at);
                            const dateStr = d.toLocaleDateString("ar-EG", { year: "numeric", month: "numeric", day: "numeric" });
                            const timeStr = d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit", hour12: true });
                            return (
                              <span className="text-[#a98a7d] font-normal text-sm inline-flex items-center gap-1.5">
                                <span>·</span>
                                <span className="tabular-nums">{dateStr}</span>
                                <span>الساعة</span>
                                <span className="tabular-nums">{timeStr}</span>
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[#a98a7d] text-sm mt-1">
                          {Number(record.refund_amount) > 0 && <>{record.payment_method === "Deferred Payment" ? "خصم من الرصيد" : "رد"} <span className="tabular-nums">{money(record.refund_amount)}</span> ج.م · </>}
                          {Number(record.charge_amount) > 0 && <>{record.payment_method === "Deferred Payment" ? "إضافة إلى الرصيد" : "تحصيل"} <span className="tabular-nums">{money(record.collection_amount)}</span> ج.م · </>}
                          {Number(record.refund_amount) === 0 && Number(record.charge_amount) === 0 && "بدون فرق · "}
                          {paymentLabel[record.payment_method] || record.payment_method}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={printingId !== null}
                        onClick={() => reprint(record.id)}
                        className="app-secondary-button py-2 px-3 text-sm"
                      >
                        {printingId === record.id ? "جارٍ الإرسال..." : "إعادة طباعة الإيصال"}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
