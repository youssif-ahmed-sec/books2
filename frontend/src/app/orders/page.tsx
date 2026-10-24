"use client";

import { useEffect, useMemo, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { printOrderInvoice } from "@/lib/localPrint";
import { orderStatusLabels } from "@/lib/orderLabels";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { toast } from "react-toastify";

type Invoice = { id: string; public_number: number; customer_id: string | null; status: string; total_amount: number; payment_method: string; created_at: string };
type InvoiceDetail = Invoice & { customer_name?: string | null; employee_name?: string | null; items: { id: string; product_name: string; unit_name: string; quantity_requested: number; total_price: number }[] };
type Customer = { id: string; name: string };

const PAGE_SIZE = 50;
const completed = new Set(["Delivered", "Closed", "Returned"]);
const paymentLabels: Record<string, string> = { Cash: "نقدي", "Credit Card": "فيزا", Instapay: "إنستاباي", Wallet: "محفظة", "Vodafone Cash": "محفظة", "Deferred Payment": "آجل" };
const money = (value: number) => `${Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج.م`;
const date = (value: string) => new Date(value).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });

export default function OrdersPage() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => readSectionSnapshot<Invoice[]>("orders-list") || []);
  const [customers, setCustomers] = useState<Customer[]>(() => readSectionSnapshot<Customer[]>("orders-customers") || []);
  const [loading, setLoading] = useState(() => readSectionSnapshot("orders-list") === null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);

  function openInvoice(id: string) {
    setDetail(null); setDetailLoading(true); setSelectedId(id);
  }
  useSectionSearchSelection(openInvoice);

  useEffect(() => {
    let active = true;
    fetchApi(`/orders?group=returnable&limit=${PAGE_SIZE}&offset=0`)
      .then((data: Invoice[]) => {
        if (!active) return;
        setInvoices(data); setHasMore(data.length === PAGE_SIZE);
        writeSectionSnapshot("orders-list", data); setError("");
      })
      .catch(cause => { if (active) setError(errorMessage(cause, "تعذر تحميل الفواتير")); })
      .finally(() => { if (active) setLoading(false); });
    fetchApi("/customers")
      .then((data: Customer[]) => { if (active) { setCustomers(data); writeSectionSnapshot("orders-customers", data); } })
      .catch(() => { /* Saved names remain available in invoice details. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    fetchApi(`/orders/${encodeURIComponent(selectedId)}/quotation`)
      .then((data: InvoiceDetail) => {
        if (!active) return;
        if (!completed.has(data.status)) { setSelectedId(null); return; }
        setDetail(data);
      })
      .catch(cause => { if (active) toast.error(errorMessage(cause, "تعذر فتح تفاصيل الفاتورة")); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId]);

  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.id, customer.name])), [customers]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchApi(`/orders?group=returnable&limit=${PAGE_SIZE}&offset=${invoices.length}`) as Invoice[];
      setInvoices(current => {
        const ids = new Set(current.map(invoice => invoice.id));
        const next = [...current, ...page.filter(invoice => !ids.has(invoice.id))];
        writeSectionSnapshot("orders-list", next);
        return next;
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch (cause) { toast.error(errorMessage(cause, "تعذر تحميل المزيد من الفواتير")); }
    finally { setLoadingMore(false); }
  }

  async function print(id: string) {
    setPrintingId(id);
    try {
      await printOrderInvoice(id);
      toast.success("أُرسلت الفاتورة لتطبيق الطباعة. راجع خروج الورقة من الطابعة.");
    } catch (cause) { toast.error(errorMessage(cause, "تعذر إرسال الفاتورة للطباعة")); }
    finally { setPrintingId(null); }
  }

  return <div className="min-h-screen">
    <SideNav />
    <TopNav title="الفواتير" />
    <main className="mx-4 mb-8 mt-28 flex min-w-0 flex-1 flex-col gap-4 lg:ml-8 lg:mr-[364px] lg:mt-36">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="app-heading">الفواتير</h1>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-500/30 p-3 text-sm text-red-500">{error}</div>}
      <section className="app-panel overflow-hidden" aria-label="سجل الفواتير">
        <div className="hidden max-h-[min(65vh,760px)] overflow-auto md:block">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head sticky top-0 z-10"><tr>
              {["الفاتورة", "العميل", "التاريخ", "الدفع", "الإجمالي", "الحالة", ""].map((label, index) => <th key={index} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {invoices.map(invoice => <tr key={invoice.id} data-search-id={invoice.id} className="app-table-row">
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{invoice.public_number}</td>
                <td className="max-w-40 truncate px-4 py-3">{invoice.customer_id ? customerNames.get(invoice.customer_id) || "عميل" : "عميل نقدي"}</td>
                <td className="whitespace-nowrap px-4 py-3 app-muted">{date(invoice.created_at)}</td>
                <td className="whitespace-nowrap px-4 py-3">{paymentLabels[invoice.payment_method] || invoice.payment_method}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(invoice.total_amount)}</td>
                <td className="whitespace-nowrap px-4 py-3">{orderStatusLabels[invoice.status] || invoice.status}</td>
                <td className="whitespace-nowrap px-4 py-3"><button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="max-h-[65vh] divide-y divide-current/10 overflow-auto md:hidden">
          {invoices.map(invoice => <div key={invoice.id} data-search-id={invoice.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 space-y-1"><p className="font-semibold">فاتورة {invoice.public_number}</p>
              <p className="truncate">{invoice.customer_id ? customerNames.get(invoice.customer_id) || "عميل" : "عميل نقدي"}</p>
              <p className="app-muted">{date(invoice.created_at)} · {orderStatusLabels[invoice.status]}</p></div>
            <div className="shrink-0 text-left"><p className="font-semibold">{money(invoice.total_amount)}</p>
              <button type="button" className="mt-2 text-primary" onClick={() => openInvoice(invoice.id)}>التفاصيل</button></div>
          </div>)}
        </div>
        {loading && invoices.length === 0 && <p className="p-8 text-center app-muted">جارٍ تحميل الفواتير...</p>}
        {!loading && invoices.length === 0 && !error && <p className="p-8 text-center app-muted">لا توجد فواتير بعد.</p>}
        {hasMore && <div className="border-t border-current/10 p-3 text-center"><button type="button" className="app-secondary-button" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "جارٍ التحميل..." : "تحميل المزيد"}</button></div>}
      </section>
    </main>
    {selectedId && <div className="fixed inset-0 z-[90] flex justify-end bg-black/60" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <aside role="dialog" aria-modal="true" aria-label="تفاصيل الفاتورة" className="flex h-full w-full max-w-lg flex-col bg-[var(--color-surface-container-low)] shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-current/10 p-5">
          <h2 className="text-xl font-bold">فاتورة {detail?.public_number || ""}</h2>
          <button type="button" aria-label="إغلاق التفاصيل" className="app-secondary-button !p-2" onClick={() => setSelectedId(null)}><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="flex-1 space-y-5 overflow-auto p-5 text-sm">
          {detailLoading && <p className="app-muted">جارٍ تحميل التفاصيل...</p>}
          {detail && <>
            <div className="grid grid-cols-2 gap-3">
              <p><span className="app-muted">العميل</span><br />{detail.customer_name || "عميل نقدي"}</p>
              <p><span className="app-muted">التاريخ</span><br />{date(detail.created_at)}</p>
              <p><span className="app-muted">الموظف</span><br />{detail.employee_name || "—"}</p>
              <p><span className="app-muted">طريقة الدفع</span><br />{paymentLabels[detail.payment_method] || detail.payment_method}</p>
            </div>
            <div className="divide-y divide-current/10 border-y border-current/10">
              {detail.items.map(item => <div key={item.id} className="flex justify-between gap-3 py-3">
                <div className="min-w-0"><p className="font-medium break-words">{item.product_name}</p><p className="app-muted">{item.quantity_requested} {item.unit_name}</p></div>
                <strong className="shrink-0">{money(item.total_price)}</strong>
              </div>)}
            </div>
            <div className="flex justify-between text-base font-bold"><span>الإجمالي</span><span>{money(detail.total_amount)}</span></div>
            <p className="app-muted">{orderStatusLabels[detail.status] || detail.status}</p>
          </>}
        </div>
        {detail && <div className="border-t border-current/10 p-5"><button type="button" className="app-primary-button w-full" disabled={printingId === detail.id} onClick={() => print(detail.id)}>{printingId === detail.id ? "جارٍ إرسال الفاتورة..." : "طباعة الفاتورة"}</button></div>}
      </aside>
    </div>}
  </div>;
}
