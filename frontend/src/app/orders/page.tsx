"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import InvoiceDetailsDialog from "@/components/InvoiceDetailsDialog";
import { DatePicker } from "@/components/DatePicker";
import { ProductSelect } from "@/components/ProductSelect";
import { orderStatusLabels } from "@/lib/orderLabels";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { toast } from "react-toastify";

type Invoice = { id: string; public_number: number; customer_name: string; status: string; total_amount: number; payment_method: string; payment_status: "paid" | "due" | "untracked"; created_at: string };
type InvoiceFilters = { search: string; dateFrom: string; dateTo: string; paymentStatus: string };

const PAGE_SIZE = 50;
const emptyFilters: InvoiceFilters = { search: "", dateFrom: "", dateTo: "", paymentStatus: "" };
const paymentStatusLabels = { paid: "مدفوعة", due: "عليها باقي", untracked: "رصيد قديم غير محدد" };
const money = (value: number) => `${Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const date = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
const invoiceUrl = (filters: InvoiceFilters, offset: number) => {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.dateFrom) query.set("date_from", filters.dateFrom);
  if (filters.dateTo) query.set("date_to", filters.dateTo);
  if (filters.paymentStatus) query.set("payment_status", filters.paymentStatus);
  return `/orders/invoices?${query}`;
};
const noFilters = (filters: InvoiceFilters) => !filters.search && !filters.dateFrom && !filters.dateTo && !filters.paymentStatus;

export default function OrdersPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => readSectionSnapshot<Invoice[]>("orders-list") || []);
  const [loading, setLoading] = useState(() => readSectionSnapshot("orders-list") === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<InvoiceFilters>({ ...emptyFilters });
  const [activeFilters, setActiveFilters] = useState<InvoiceFilters>({ ...emptyFilters });

  function openInvoice(id: string) {
    setSelectedId(id);
  }
  useSectionSearchSelection(openInvoice);

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


    <main className="mx-4 mb-8 mt-28 flex min-w-0 flex-1 flex-col gap-4 lg:ml-8 lg:mr-[364px] lg:mt-36">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="app-heading">الفواتير</h1>
      </header>
      <form className="app-panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => { event.preventDefault(); applyFilters(); }} aria-label="البحث في الفواتير">
        <label className="min-w-44 flex-[2_1_14rem] text-sm">رقم الفاتورة أو العميل
          <input className="app-field mt-1" type="search" maxLength={80} value={draftFilters.search} onChange={event => setDraftFilters(current => ({ ...current, search: event.target.value }))} placeholder="ابحث بالرقم أو الاسم أو الهاتف" />
        </label>
        <div className="min-w-36 flex-1 text-sm"><span className="mb-1 block">من تاريخ</span><DatePicker label="من تاريخ" value={draftFilters.dateFrom} onChange={value => setDraftFilters(current => ({ ...current, dateFrom: value }))} max={draftFilters.dateTo || undefined} allowClear /></div>
        <div className="min-w-36 flex-1 text-sm"><span className="mb-1 block">إلى تاريخ</span><DatePicker label="إلى تاريخ" value={draftFilters.dateTo} onChange={value => setDraftFilters(current => ({ ...current, dateTo: value }))} min={draftFilters.dateFrom || undefined} allowClear /></div>
        <div className="min-w-40 flex-1 text-sm"><span className="mb-1 block">حالة السداد</span><ProductSelect label="حالة سداد الفاتورة" value={draftFilters.paymentStatus} onChange={value => setDraftFilters(current => ({ ...current, paymentStatus: value }))} placeholder="كل الحالات" compact options={[{ value: "paid", label: "مدفوعة" }, { value: "due", label: "عليها باقي" }, { value: "untracked", label: "رصيد قديم غير محدد" }]} /></div>
        <button type="submit" className="app-primary-button">بحث</button>
        {!noFilters(activeFilters) && <button type="button" className="app-secondary-button" onClick={clearFilters}>مسح</button>}
      </form>
      {error && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-500">{error}</div>}
      <section className="app-panel overflow-hidden" aria-label="سجل الفواتير">
        <div className="hidden max-h-[min(65vh,760px)] overflow-auto md:block">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head sticky top-0 z-10"><tr>
              {["الفاتورة", "العميل", "التاريخ", "الإجمالي", "السداد", "الحالة", ""].map((label, index) => <th key={index} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {invoices.map(invoice => <tr key={invoice.id} data-search-id={invoice.id} className="app-table-row">
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{invoice.public_number}</td>
                <td className="max-w-40 truncate px-4 py-3">{invoice.customer_name}</td>
                <td className="whitespace-nowrap px-4 py-3 app-muted">{date(invoice.created_at)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(invoice.total_amount)}</td>
                <td className="whitespace-nowrap px-4 py-3">{paymentStatusLabels[invoice.payment_status]}</td>
                <td className="whitespace-nowrap px-4 py-3">{orderStatusLabels[invoice.status] || invoice.status}</td>
                <td className="whitespace-nowrap px-4 py-3"><button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="max-h-[65vh] divide-y divide-current/10 overflow-auto md:hidden">
          {invoices.map(invoice => <div key={invoice.id} data-search-id={invoice.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-1"><p className="font-semibold">فاتورة {invoice.public_number}</p>
              <p className="truncate">{invoice.customer_name}</p>
              <p className="app-muted">{date(invoice.created_at)} · {paymentStatusLabels[invoice.payment_status]} · {orderStatusLabels[invoice.status]}</p></div>
            <div className="shrink-0 text-left"><p className="font-semibold">{money(invoice.total_amount)}</p>
              <button type="button" className="mt-2 text-primary" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></div>
          </div>)}
        </div>
        {loading && invoices.length === 0 && <p className="p-8 text-center app-muted">جارٍ تحميل الفواتير...</p>}
        {!loading && invoices.length === 0 && !error && <p className="p-8 text-center app-muted">{noFilters(activeFilters) ? "لا توجد فواتير بعد." : "لا توجد فواتير مطابقة."}</p>}
        {hasMore && <div className="border-t border-current/10 p-3 text-center"><button type="button" className="app-secondary-button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "جارٍ التحميل..." : "تحميل المزيد"}</button></div>}
      </section>
    </main>
    {selectedId && <InvoiceDetailsDialog key={selectedId} invoiceId={selectedId} onClose={() => setSelectedId(null)} />}
  </div>;
}
