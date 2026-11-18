"use client";

import { useEffect, useRef, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import InvoiceDetailsDialog from "@/components/InvoiceDetailsDialog";
import SaleCancellationRequests from "@/components/SaleCancellationRequests";
import SaleCorrectionEditor from "@/components/SaleCorrectionEditor";
import SaleCorrectionRequests from "@/components/SaleCorrectionRequests";
import { decodeJwt, getUserRole } from "@/utils/auth";
import { DatePicker } from "@/components/DatePicker";
import { ProductSelect } from "@/components/ProductSelect";
import { orderStatusLabels } from "@/lib/orderLabels";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { emptyBarcodeScanCapture, englishBarcodeFromArabicLayout, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";
import { toast } from "react-toastify";

type Invoice = { id: string; public_number: number; customer_name: string; status: string; cancellation_status?: "PENDING" | "AWAITING_SETTLEMENT" | "APPROVED" | null; total_amount: number; payment_method: string; payment_status: "paid" | "due" | "untracked"; cashier_collected?: boolean | null; cashier_expected_amount?: number | null; deferred_remaining?: number | null; created_at: string };
type InvoiceFilters = { dateFrom: string; dateTo: string; status: string; paymentMethod: string; paymentStatus: string };

const PAGE_SIZE = 50;
const emptyFilters: InvoiceFilters = { dateFrom: "", dateTo: "", status: "", paymentMethod: "", paymentStatus: "" };
const paymentStatusLabels = { paid: "مدفوعة", due: "عليها باقي", untracked: "رصيد قديم غير محدد" };
const invoicePaymentLabel = (invoice: Invoice) =>
  invoice.cashier_collected === true ? (invoice.payment_status === "due" ? "تم تحصيل المدفوع" : "تم التحصيل")
    : invoice.cashier_collected === false ? "بانتظار التحصيل"
    : paymentStatusLabels[invoice.payment_status];
const isCollected = (invoice: Invoice) => invoice.cashier_collected === true;
const paymentMethodLabels: Record<string, string> = {
  Cash: "نقداً",
  "Credit Card": "بطاقة دفع",
  Instapay: "انستاباي",
  Wallet: "محفظة",
  "Vodafone Cash": "محفظة",
  "Deferred Payment": "دفع آجل",
};
const statusOptions = [
  { value: "Delivered", label: "مكتمل" },
  { value: "Exchange", label: "استبدال" },
  { value: "Returned", label: "مسترجع" },
];
const paymentMethodOptions = [
  { value: "Cash", label: "نقداً" },
  { value: "Credit Card", label: "بطاقة دفع" },
  { value: "Instapay", label: "انستاباي" },
  { value: "Wallet", label: "محفظة" },
  { value: "Deferred Payment", label: "دفع آجل" },
];
const paymentStatusOptions = [
  { value: "paid", label: "مدفوعة" },
  { value: "due", label: "عليها باقي" },
  { value: "untracked", label: "رصيد قديم غير محدد" },
];

const money = (value: number) => `${Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const date = (value: string) => new Date(value).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" });
const invoiceUrl = (filters: InvoiceFilters, offset: number) => {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (filters.dateFrom) query.set("date_from", filters.dateFrom);
  if (filters.dateTo) query.set("date_to", filters.dateTo);
  if (filters.status) query.set("status", filters.status);
  if (filters.paymentMethod) query.set("payment_method", filters.paymentMethod);
  if (filters.paymentStatus) query.set("payment_status", filters.paymentStatus);
  return `/orders/invoices?${query}`;
};
const noFilters = (filters: InvoiceFilters) =>
  !filters.dateFrom &&
  !filters.dateTo &&
  !filters.status &&
  !filters.paymentMethod &&
  !filters.paymentStatus;

export default function OrdersPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => readSectionSnapshot<Invoice[]>("orders-list") || []);
  const [loading, setLoading] = useState(() => readSectionSnapshot("orders-list") === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [showCancellations, setShowCancellations] = useState(false);
  const [cancellationRevision, setCancellationRevision] = useState(0);
  const [showCorrections, setShowCorrections] = useState(false);
  const [correctionRevision, setCorrectionRevision] = useState(0);
  const [draftFilters, setDraftFilters] = useState<InvoiceFilters>({ ...emptyFilters });
  const [activeFilters, setActiveFilters] = useState<InvoiceFilters>({ ...emptyFilters });
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectQuery, setCollectQuery] = useState("");
  const [collectBusy, setCollectBusy] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [collectResult, setCollectResult] = useState<{ public_number: number; customer_name: string; already_collected: boolean; confirmed_amount: number } | null>(null);
  const collectInputRef = useRef<HTMLInputElement>(null);
  const collectScanKeys = useRef(emptyBarcodeScanCapture());
  const collectRequestRef = useRef<{ key: string; id: string } | null>(null);

  function openInvoice(id: string) {
    setSelectedId(id);
  }
  useSectionSearchSelection(openInvoice);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRole(getUserRole());
      if (new URLSearchParams(window.location.search).has("cancellations")) setShowCancellations(true);
      if (new URLSearchParams(window.location.search).has("corrections")) setShowCorrections(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("invoice_id");
    if (!requested) return;
    const timer = window.setTimeout(() => setSelectedId(requested), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetchApi(invoiceUrl(activeFilters, 0))
      .then((data: Invoice[]) => {
        if (!active) return;
        setInvoices(data); setHasMore(data.length === PAGE_SIZE);
        if (noFilters(activeFilters)) writeSectionSnapshot("orders-list", data);
        setError("");
      })
      .catch(cause => { if (active) setError(errorMessage(cause, "تعذر تحميل الفواتير")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeFilters]);

  function applyFilters() {
    if (draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateFrom > draftFilters.dateTo) {
      setError("تاريخ البداية بعد تاريخ النهاية");
      return;
    }
    setInvoices([]); setHasMore(false); setLoading(true); setError("");
    setActiveFilters({ ...draftFilters });
  }

  function clearFilters() {
    setDraftFilters({ ...emptyFilters });
    setInvoices([]); setHasMore(false); setLoading(true); setError("");
    setActiveFilters({ ...emptyFilters });
  }

  const collectStorageKey = () => {
    const token = localStorage.getItem("access_token");
    const userId = token ? decodeJwt(token)?.sub : null;
    return typeof userId === "string" ? `invoice-collection-pending:${userId}` : null;
  };

  const readPendingCollection = () => {
    if (collectRequestRef.current) return collectRequestRef.current;
    try {
      const storageKey = collectStorageKey();
      const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
      const pending = saved ? JSON.parse(saved) : null;
      if (typeof pending?.key === "string" && typeof pending?.id === "string") {
        collectRequestRef.current = pending;
      }
    } catch { /* Storage may be unavailable. */ }
    return collectRequestRef.current;
  };

  const savePendingCollection = (pending: { key: string; id: string } | null) => {
    collectRequestRef.current = pending;
    try {
      const storageKey = collectStorageKey();
      if (storageKey && pending) sessionStorage.setItem(storageKey, JSON.stringify(pending));
      else if (storageKey) sessionStorage.removeItem(storageKey);
    } catch { /* Keep the request in memory if storage is unavailable. */ }
  };

  async function submitCollectScan(explicitQuery?: string) {
    const raw = (explicitQuery ?? collectQuery).trim();
    if (!raw || collectBusy) return;
    const mapped = englishBarcodeFromArabicLayout(raw);
    const code = (mapped || raw).replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const key = code;
    const pending = readPendingCollection();
    const separator = pending?.key.lastIndexOf(":") ?? -1;
    const legacyQuery = pending && separator >= 0 ? pending.key.slice(0, separator) : null;
    if (pending && pending.key !== key && legacyQuery !== key) {
      setCollectError("تحقق أولاً من نتيجة التحصيل السابق بإعادة محاولة نفس الفاتورة.");
      return;
    }
    const request = pending || { key, id: crypto.randomUUID() };
    savePendingCollection(request);
    setCollectBusy(true);
    setCollectError("");
    try {
      const res = await fetchApi("/orders/collect-scan", {
        method: "POST",
        body: JSON.stringify({
          request_id: request.id,
          query: code,
        }),
        silentErrors: true,
      }) as { order_id: string; public_number: number; customer_name: string; already_collected: boolean; confirmed_amount: number };
      savePendingCollection(null);
      setCollectResult(res);
      setCollectQuery("");
      toast.success(res.already_collected ? `الفاتورة ${res.public_number} تم تحصيلها من قبل` : `تم تأكيد تحصيل الفاتورة ${res.public_number}`);
      setActiveFilters(previous => ({ ...previous }));
    } catch (cause) {
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        savePendingCollection(null);
      }
      setCollectError(errorMessage(cause, "تعذر تحصيل الفاتورة"));
    } finally {
      setCollectBusy(false);
      window.requestAnimationFrame(() => collectInputRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!collectOpen) return;
    const timer = window.setTimeout(() => collectInputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [collectOpen]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchApi(invoiceUrl(activeFilters, invoices.length)) as Invoice[];
      setInvoices(current => {
        const ids = new Set(current.map(invoice => invoice.id));
        const next = [...current, ...page.filter(invoice => !ids.has(invoice.id))];
        if (noFilters(activeFilters)) writeSectionSnapshot("orders-list", next);
        return next;
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch (cause) { toast.error(errorMessage(cause, "تعذر تحميل المزيد من الفواتير")); }
    finally { setLoadingMore(false); }
  }

  return <div className="min-h-screen">


    <main className="app-side-page mx-4 mb-8 mt-28 flex min-w-0 flex-1 flex-col gap-4 lg:ml-8 lg:mt-36">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="app-heading">الفواتير</h1>
        <div className="flex flex-wrap gap-2"><button type="button" className="app-primary-button flex items-center gap-1.5"
          onClick={() => {
            const pending = readPendingCollection();
            const separator = pending?.key.lastIndexOf(":") ?? -1;
            setCollectError(""); setCollectResult(null);
            setCollectQuery(pending ? (separator >= 0 ? pending.key.slice(0, separator) : pending.key) : "");
            setCollectOpen(true);
          }}>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">payments</span>
          <span>تحصيل أموال</span></button><button type="button" className="app-secondary-button" aria-expanded={showCorrections}
          onClick={() => setShowCorrections(value => !value)}>{showCorrections ? "إخفاء طلبات التعديل" : "طلبات تعديل الفواتير"}</button><button type="button" className="app-secondary-button" aria-expanded={showCancellations}
          onClick={() => setShowCancellations(value => !value)}>{showCancellations ? "إخفاء طلبات الإلغاء" : "طلبات إلغاء المبيعات"}</button></div>
      </header>
      {showCancellations && <SaleCancellationRequests admin={role === "ADMIN"} revision={cancellationRevision} onOpenInvoice={openInvoice}
        onChanged={() => setActiveFilters(previous => ({ ...previous }))} />}
      {showCorrections && <SaleCorrectionRequests admin={role === "ADMIN"} revision={correctionRevision} onOpenInvoice={openInvoice}
        onChanged={() => setActiveFilters(previous => ({ ...previous }))} />}
      <form className="app-panel flex flex-col gap-3 p-4" onSubmit={event => { event.preventDefault(); applyFilters(); }} aria-label="تصفية الفواتير">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-36 flex-1 text-sm">
            <span className="mb-1 block font-medium">حالة الفاتورة</span>
            <ProductSelect
              label="حالة الفاتورة"
              value={draftFilters.status}
              onChange={value => setDraftFilters(current => ({ ...current, status: value }))}
              placeholder="كل الحالات"
              compact
              options={statusOptions}
            />
          </div>
          <div className="min-w-36 flex-1 text-sm">
            <span className="mb-1 block font-medium">طريقة الدفع</span>
            <ProductSelect
              label="طريقة الدفع"
              value={draftFilters.paymentMethod}
              onChange={value => setDraftFilters(current => ({ ...current, paymentMethod: value }))}
              placeholder="كل الطرق"
              compact
              options={paymentMethodOptions}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-white/5">
          <div className="min-w-36 flex-1 text-sm">
            <span className="mb-1 block font-medium">حالة السداد</span>
            <ProductSelect
              label="حالة سداد الفاتورة"
              value={draftFilters.paymentStatus}
              onChange={value => setDraftFilters(current => ({ ...current, paymentStatus: value }))}
              placeholder="كل حالات السداد"
              compact
              options={paymentStatusOptions}
            />
          </div>
          <div className="min-w-36 flex-1 text-sm">
            <span className="mb-1 block font-medium">من تاريخ</span>
            <DatePicker
              label="من تاريخ"
              value={draftFilters.dateFrom}
              onChange={value => setDraftFilters(current => ({ ...current, dateFrom: value }))}
              max={draftFilters.dateTo || undefined}
              allowClear
            />
          </div>
          <div className="min-w-36 flex-1 text-sm">
            <span className="mb-1 block font-medium">إلى تاريخ</span>
            <DatePicker
              label="إلى تاريخ"
              value={draftFilters.dateTo}
              onChange={value => setDraftFilters(current => ({ ...current, dateTo: value }))}
              min={draftFilters.dateFrom || undefined}
              allowClear
            />
          </div>
          <div className="flex items-center gap-2 pt-2 sm:pt-0">
            <button type="submit" className="app-primary-button">تطبيق الفلاتر</button>
            {!noFilters(activeFilters) && <button type="button" className="app-secondary-button" onClick={clearFilters}>مسح</button>}
          </div>
        </div>
      </form>
      {error && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-500">{error}</div>}
      <section className="app-panel overflow-hidden" aria-label="سجل الفواتير">
        <div className="hidden max-h-[min(65vh,760px)] overflow-auto md:block">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head sticky top-0 z-10"><tr>
              {["الفاتورة", "العميل", "التاريخ", "طريقة الدفع", "الإجمالي", "السداد", "الحالة", ""].map((label, index) => <th key={index} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {invoices.map(invoice => <tr key={invoice.id} data-search-id={invoice.id} className="app-table-row">
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{invoice.public_number}</td>
                <td className="max-w-40 truncate px-4 py-3">{invoice.customer_name}</td>
                <td className="whitespace-nowrap px-4 py-3 app-muted">{date(invoice.created_at)}</td>
                <td className="whitespace-nowrap px-4 py-3">{paymentMethodLabels[invoice.payment_method] || invoice.payment_method}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(invoice.total_amount)}</td>
                <td className="whitespace-nowrap px-4 py-3"><span className={isCollected(invoice) ? "app-invoice-collected font-semibold" : undefined}>{invoicePaymentLabel(invoice)}</span>{invoice.payment_method === "Deferred Payment" && invoice.cashier_collected != null && invoice.cashier_expected_amount != null && <span className="app-muted block text-xs">المبلغ الحالي · {money(invoice.cashier_expected_amount)}</span>}{invoice.payment_status === "due" && invoice.cashier_collected != null && <span className="app-muted block text-xs">عليها باقي · {money(invoice.deferred_remaining ?? 0)}</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 font-medium">{orderStatusLabels[invoice.status] || invoice.status}{invoice.cancellation_status && <span className="ms-2 text-xs text-amber-300">{invoice.cancellation_status === "APPROVED" ? "إلغاء مكتمل" : invoice.cancellation_status === "AWAITING_SETTLEMENT" ? "بانتظار تأكيد التسوية" : "طلب إلغاء معلق"}</span>}</td>
                <td className="whitespace-nowrap px-4 py-3"><button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="max-h-[65vh] divide-y divide-current/10 overflow-auto md:hidden">
          {invoices.map(invoice => <div key={invoice.id} data-search-id={invoice.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-1"><p className="font-semibold">فاتورة {invoice.public_number}</p>
              <p className="truncate">{invoice.customer_name}</p>
              <p className="app-muted">{date(invoice.created_at)} · {paymentMethodLabels[invoice.payment_method] || invoice.payment_method} · <span className={isCollected(invoice) ? "app-invoice-collected font-semibold" : undefined}>{invoicePaymentLabel(invoice)}</span>{invoice.payment_method === "Deferred Payment" && invoice.cashier_collected != null && invoice.cashier_expected_amount != null && ` · المبلغ الحالي ${money(invoice.cashier_expected_amount)}`}{invoice.payment_status === "due" && invoice.cashier_collected != null && ` · عليها باقي ${money(invoice.deferred_remaining ?? 0)}`} · {orderStatusLabels[invoice.status] || invoice.status}</p></div>
            <div className="shrink-0 text-left"><p className="font-semibold">{money(invoice.total_amount)}</p>
              <button type="button" className="mt-2 text-primary" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></div>
          </div>)}
        </div>
        {loading && invoices.length === 0 && <p className="p-8 text-center app-muted">جارٍ تحميل الفواتير...</p>}
        {!loading && invoices.length === 0 && !error && <p className="p-8 text-center app-muted">{noFilters(activeFilters) ? "لا توجد فواتير بعد." : "لا توجد فواتير مطابقة."}</p>}
        {hasMore && <div className="border-t border-current/10 p-3 text-center"><button type="button" className="app-secondary-button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "جارٍ التحميل..." : "تحميل المزيد"}</button></div>}
      </section>
    </main>
    {selectedId && <InvoiceDetailsDialog key={selectedId} invoiceId={selectedId} onClose={() => setSelectedId(null)}
      onEdit={() => { setEditingId(selectedId); setSelectedId(null); }}
      onCancellation={() => { setShowCancellations(true); setCancellationRevision(value => value + 1); setActiveFilters(previous => ({ ...previous })); }} />}
    {editingId && <SaleCorrectionEditor key={editingId} invoiceId={editingId} onClose={() => setEditingId(null)}
      onSubmitted={() => { setShowCorrections(true); setCorrectionRevision(value => value + 1); setActiveFilters(previous => ({ ...previous })); }} />}
    {collectOpen && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="تحصيل أموال بالمسح">
        <div className="app-panel w-full max-w-md space-y-4 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">تحصيل أموال الفواتير</h2>
            <button type="button" onClick={() => setCollectOpen(false)} aria-label="إغلاق" className="app-icon-button !h-8 !w-8">✕</button>
          </div>
          <p className="app-muted text-sm">امسح باركود الفاتورة بعد استلام المبلغ لتأكيد التحصيل.</p>
          <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void submitCollectScan(); }}>
            <input
              ref={collectInputRef}
              type="search"
              autoFocus
              value={collectQuery}
              disabled={collectBusy}
              onChange={event => setCollectQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Escape") { setCollectOpen(false); return; }
                if (event.key !== "Enter") {
                  if (!event.nativeEvent.isComposing) recordBarcodeScanKey(collectScanKeys.current, event);
                  return;
                }
                event.preventDefault();
                const raw = event.currentTarget.value.trim();
                const scanned = englishBarcodeFromScan(collectScanKeys.current, raw);
                void submitCollectScan(scanned || raw);
              }}
              placeholder="امسح باركود الفاتورة أو اكتب رقمها..."
              aria-label="رقم الفاتورة أو الباركود للتحصيل"
              className="app-field flex-1 text-sm"
            />
            <button type="submit" disabled={collectBusy || !collectQuery.trim()} className="app-primary-button shrink-0 disabled:opacity-50">
              {collectBusy ? "جارٍ التسجيل..." : "تحصيل"}
            </button>
          </form>
          {collectError && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{collectError}</div>}
          {collectResult && (
            <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300 space-y-1">
              <div className="font-bold">{collectResult.already_collected ? "تم تحصيل الفاتورة من قبل" : "تم تأكيد التحصيل"} · فاتورة رقم {collectResult.public_number}</div>
              <div>العميل: {collectResult.customer_name}</div>
              <div>المبلغ المؤكد: {money(collectResult.confirmed_amount)}</div>
            </div>
          )}
        </div>
      </div>
    )}
  </div>;
}
