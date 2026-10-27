"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";
import { ProductSelect } from "@/components/ProductSelect";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { fetchApi } from "@/lib/api";
import { printPurchaseDocument, printPurchaseReceipt } from "@/lib/localPrint";
import { errorMessage } from "@/lib/errors";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { getUserRole } from "@/utils/auth";
import { TopNavSearchPortal } from "@/lib/topNavSearchPortal";
import { emptyBarcodeScanCapture, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";

type Unit = { id: string; unit_name: string; conversion_factor: number };
type Product = { id: string; name_ar: string; sku: string; is_active: boolean; units: Unit[] };
type Supplier = { id: string; name: string; phone?: string | null };
type Warehouse = { id: string; name: string };
type Line = { id: string; product_id: string; unit_id: string; product_name: string; unit_name: string; base_unit_name: string; quantity: string | null; conversion_factor: string; base_quantity: string | null; received_base_quantity: string };
type Receipt = { id: string; public_number: number; created_at: string; lines: { document_line_id: string; base_quantity: string }[] };
type Document = { id: string; public_number: number; supplier_id: string | null; supplier_name: string; status: string; note: string | null; created_at: string; lines: Line[]; receipts: Receipt[] };
type DraftLine = { key: string; product_id: string; unit_id: string; quantity: string };
type Snapshot = { documents: Document[]; suppliers: Supplier[]; warehouses: Warehouse[] };

const statusLabel: Record<string, string> = {
  REQUESTED: "بانتظار الموافقة", APPROVED: "تمت الموافقة", ORDERED: "تم الطلب",
  PARTIALLY_RECEIVED: "استلام جزئي", RECEIVED: "مكتمل", REJECTED: "مرفوض", CANCELLED: "ملغي",
};
const activeStatuses = new Set(["REQUESTED", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"]);
const moneylessNumber = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2);

function cleanWhatsAppPhone(phone?: string | null): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("01") && digits.length === 11) {
    digits = `2${digits}`;
  }
  return digits;
}

function buildPurchaseWhatsAppMessage(doc: Document, supplierName?: string): string {
  const items = doc.lines
    .map(line => `• ${line.product_name}: ${moneylessNumber(Number(line.quantity))} ${line.unit_name}`)
    .join("\n");
  const notePart = doc.note ? `\nملاحظة: ${doc.note}\n` : "";
  return `السلام عليكم ورحمة الله وبركاته
السادة ${supplierName || doc.supplier_name} المحترمين

نود إرسال طلب الشراء رقم ${doc.public_number} المعتمد من طرفنا:

الأصناف المطلوبة:
${items}
${notePart}
شاكرين ومقدرين حسن تعاونكم معنا.`;
}

function PurchaseEditor({ initial, suppliers, onClose, onSaved }: {
  initial: Document | null; suppliers: Supplier[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState(initial?.supplier_id || "");
  const [note, setNote] = useState(initial?.note || "");
  const [lines, setLines] = useState<DraftLine[]>(() => initial?.lines.map(line => ({
    key: crypto.randomUUID(), product_id: line.product_id, unit_id: line.unit_id, quantity: line.quantity || "",
  })) || []);
  const [known, setKnown] = useState<Record<string, Product>>({});
  const [search, setSearch] = useState("");
  const scanKeys = useRef(emptyBarcodeScanCapture());
  const [matches, setMatches] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial) return;
    let alive = true;
    void Promise.allSettled([...new Set(initial.lines.map(line => line.product_id))].map(id => fetchApi(`/products/${id}`, { silentErrors: true }))).then(results => {
      if (!alive) return;
      const products = results.filter(result => result.status === "fulfilled").map(result => result.value as Product);
      setKnown(Object.fromEntries(products.map(product => [product.id, product])));
    });
    return () => { alive = false; };
  }, [initial]);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetchApi(`/products?is_bundle=false&limit=20&search=${encodeURIComponent(search.trim())}`, { silentErrors: true })
        .then((result: { data: Product[] }) => { if (alive) setMatches(result.data || []); })
        .catch(() => { if (alive) setMatches([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [search]);

  const add = (product: Product) => {
    const unit = product.units?.find(item => Number(item.conversion_factor) === 1) || product.units?.[0];
    if (!unit) { notifyError("الصنف ليس له وحدة متاحة"); return; }
    const already = lines.find(line => line.product_id === product.id && line.unit_id === unit.id);
    if (already) { notifyError("الصنف والوحدة موجودان بالفعل؛ عدل الكمية في نفس السطر"); return; }
    setKnown(previous => ({ ...previous, [product.id]: product }));
    setLines(previous => [...previous, { key: crypto.randomUUID(), product_id: product.id, unit_id: unit.id, quantity: "1" }]);
    setSearch("");
  };
  const update = (key: string, patch: Partial<DraftLine>) => setLines(previous => previous.map(line => line.key === key ? { ...line, ...patch } : line));
  const valid = !!supplierId && lines.length > 0 && lines.every(line => {
    const product = known[line.product_id];
    return product?.is_active && product.units?.some(unit => unit.id === line.unit_id)
      && Number(line.quantity) > 0 && Number.isFinite(Number(line.quantity));
  }) && new Set(lines.map(line => `${line.product_id}:${line.unit_id}`)).size === lines.length;

  const save = async () => {
    if (!valid || busy) { notifyError("حدد المورد وأضف أصنافًا بوحدات وكميات صحيحة"); return; }
    setBusy(true);
    try {
      const body = { supplier_id: supplierId, note: note.trim() || null,
        lines: lines.map(({ product_id, unit_id, quantity }) => ({ product_id, unit_id, quantity })) };
      await fetchApi(initial ? `/purchase-documents/${initial.id}` : "/purchase-documents", {
        method: initial ? "PUT" : "POST", body: JSON.stringify(initial ? body : { ...body, request_id: requestId }),
      });
      setRequestId(crypto.randomUUID());
      await onSaved();
      onClose();
      notifySuccess(initial ? "تم حفظ تعديل طلب الشراء بنجاح" : "تم إرسال طلب الشراء للمراجعة بنجاح");
    } catch (cause) { notifyError(errorMessage(cause, "تعذر حفظ طلب الشراء")); }
    finally { setBusy(false); }
  };

  return <div className="motion-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={initial ? "تعديل طلب شراء" : "طلب شراء جديد"} dir="rtl">
    <div className="motion-dialog app-panel flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 p-5"><div><h2 className="text-xl font-bold">{initial ? "تعديل الطلب" : "طلب شراء جديد"}</h2><p className="app-muted text-sm">يمكنك اختيار أي مورد معتمد للأصناف المطلوبة، وتعديل الكميات والوحدات بحرية.</p></div><button type="button" className="app-icon-button" onClick={onClose} aria-label="إغلاق"><span className="material-symbols-outlined">close</span></button></header>
      <div className="custom-scrollbar space-y-5 overflow-y-auto p-5">
        <label className="block text-sm font-bold">المورد<ProductSelect label="المورد" value={supplierId} placeholder="اختر المورد" options={suppliers.map(item => ({ value: item.id, label: item.name }))} onChange={setSupplierId} /></label>
        <div><p className="text-sm font-bold">أضف صنفًا بالاسم أو الباركود من البحث بالأعلى</p><TopNavSearchPortal overlay><input id="purchase-search" aria-label="بحث أصناف أمر الشراء" className="app-search app-search-focus h-10 w-full rounded-full px-4" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
          if (event.key !== "Enter") {
            if (!event.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, event);
            return;
          }
          const code = englishBarcodeFromScan(scanKeys.current, event.currentTarget.value.trim());
          if (code) { event.preventDefault(); setSearch(code); return; }
          if (matches[0]) { event.preventDefault(); add(matches[0]); }
        }} placeholder="ابحث أو امسح باركود صنف الشراء" /></TopNavSearchPortal>
          <div className="custom-scrollbar mt-2 max-h-36 overflow-y-auto rounded-xl border border-white/10 p-1">{searching ? <p className="app-muted p-3 text-sm">جاري البحث...</p> : matches.length ? matches.map(product => <button type="button" key={product.id} disabled={!product.is_active} onClick={() => add(product)} className="flex w-full justify-between gap-3 rounded-lg px-3 py-2 text-right text-sm hover:bg-white/5 disabled:opacity-50"><span>{product.name_ar}</span><span className="text-primary">إضافة +</span></button>) : <p className="app-muted p-3 text-sm">لا توجد أصناف مطابقة</p>}</div>
        </div>
        <div className="space-y-3">{lines.length === 0 ? <p className="app-muted rounded-xl border border-dashed border-white/15 p-6 text-center">لم تضف أي صنف بعد</p> : lines.map(line => {
          const product = known[line.product_id];
          const selectedUnit = product?.units?.find(unit => unit.id === line.unit_id);
          return <div key={line.key} className="app-panel grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_180px_130px_auto] sm:items-end"><div><strong className="block">{product?.name_ar || initial?.lines.find(item => item.product_id === line.product_id)?.product_name || "جاري تحميل الصنف"}</strong><span className="app-muted text-xs">{selectedUnit ? `يعادل ${moneylessNumber(Number(line.quantity || 0) * Number(selectedUnit.conversion_factor))} من الوحدة الأساسية` : ""}</span></div><label className="text-sm">الوحدة<ProductSelect label="وحدة الصنف" value={line.unit_id} placeholder="اختر الوحدة" options={(product?.units || []).map(unit => ({ value: unit.id, label: unit.unit_name }))} onChange={value => update(line.key, { unit_id: value })} compact /></label><label className="text-sm">الكمية<ZeroHintNumberInput className="app-field mt-1 h-11" min="0.01" step="0.01" value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value })} /></label><button type="button" className="app-secondary-button !px-3 !py-2 text-red-300" onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))}>إزالة</button></div>;
        })}</div>
        <label className="block text-sm">ملاحظة للمراجعة<textarea className="app-field mt-2 min-h-20" maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="اختياري" /></label>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 p-5"><p className="app-muted text-sm">الاستلام لا يغيّر الأسعار أو حساب المورد.</p><button type="button" disabled={busy || !valid} onClick={() => void save()} className="app-primary-button">{busy ? "جاري الحفظ..." : initial ? "حفظ التعديل" : "إرسال الطلب للمراجعة"}</button></footer>
    </div>
  </div>;
}

function ReceiptEditor({ document, warehouses, onClose, onSaved }: { document: Document; warehouses: Warehouse[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [printReceipt, setPrintReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const receiptLines = document.lines.filter(line => Number(amounts[line.id]) > 0).map(line => ({ line_id: line.id, base_quantity: amounts[line.id] }));
  const validAmounts = receiptLines.length > 0 && receiptLines.every(item => {
    const line = document.lines.find(row => row.id === item.line_id);
    return line && Number(item.base_quantity) <= Number(line.base_quantity) - Number(line.received_base_quantity);
  });

  const submit = async () => {
    if (!warehouseId || !validAmounts || busy) return;
    setBusy(true);
    try {
      const res = (await fetchApi(`/purchase-documents/${document.id}/receipts`, {
        method: "POST",
        body: JSON.stringify({
          request_id: requestId, warehouse_id: warehouseId, lines: receiptLines,
        }),
      })) as Document;
      setRequestId(crypto.randomUUID());
      await onSaved();
      notifySuccess("تم تسجيل استلام البضاعة بنجاح");
      if (printReceipt && res?.receipts?.length) {
        const lastReceipt = res.receipts[res.receipts.length - 1];
        if (lastReceipt) {
          try {
            await printPurchaseReceipt(document.id, lastReceipt.id);
          } catch {
            notifyError("تعذر إرسال فاتورة الاستلام للطابعة");
          }
        }
      }
      onClose();
    } catch (cause) { notifyError(errorMessage(cause, "تعذر تسجيل الاستلام")); }
    finally { setBusy(false); }
  };

  return <div className="motion-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="تسجيل استلام" dir="rtl"><div className="motion-dialog app-panel custom-scrollbar max-h-[94vh] w-full max-w-2xl space-y-5 overflow-y-auto p-5 sm:p-7"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">استلام من أمر شراء</h2><button type="button" className="app-icon-button" aria-label="إغلاق" onClick={onClose}><span className="material-symbols-outlined">close</span></button></div><p className="app-muted text-sm">أدخل الكمية التي وصلت فعلًا من كل صنف. اترك غير المستلم فارغًا.</p>{warehouses.length === 1 ? <p className="text-sm">المخزن: <strong>{warehouses[0].name}</strong></p> : <ProductSelect label="المخزن المستلم" value={warehouseId} placeholder="اختر المخزن" options={warehouses.map(item => ({ value: item.id, label: item.name }))} onChange={setWarehouseId} />}
    <div className="space-y-3">{document.lines.filter(line => Number(line.base_quantity) > Number(line.received_base_quantity)).map(line => {
      const remaining = Number(line.base_quantity) - Number(line.received_base_quantity);
      return <label key={line.id} className="app-panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><span><strong className="block">{line.product_name}</strong><span className="app-muted">المطلوب {moneylessNumber(Number(line.quantity))} {line.unit_name} · المتبقي للاستلام {moneylessNumber(remaining)} {line.base_unit_name}</span></span><input className="app-field !w-36" type="number" min="0" max={remaining} step="0.01" value={amounts[line.id] || ""} onChange={event => setAmounts(previous => ({ ...previous, [line.id]: event.target.value }))} placeholder={`الكمية ${line.base_unit_name}`} /></label>;
    })}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[#e2bfb0]"><input type="checkbox" checked={printReceipt} onChange={e => setPrintReceipt(e.target.checked)} className="h-4 w-4 rounded accent-primary cursor-pointer" /><span>طباعة فاتورة الاستلام بعد الحفظ</span></label><button type="button" className="app-primary-button" disabled={busy || !warehouseId || !validAmounts} onClick={() => void submit()}>{busy ? "جاري التسجيل..." : "تسجيل الاستلام"}</button></div></div></div>;
}

const statusConfig: Record<string, { label: string; badgeClass: string }> = {
  REQUESTED: { label: "بانتظار الموافقة", badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  APPROVED: { label: "تمت الموافقة", badgeClass: "bg-blue-500/15 text-blue-300 border border-blue-500/30" },
  ORDERED: { label: "تم الطلب", badgeClass: "bg-purple-500/15 text-purple-300 border border-purple-500/30" },
  PARTIALLY_RECEIVED: { label: "استلام جزئي", badgeClass: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" },
  RECEIVED: { label: "مكتمل الاستلام", badgeClass: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" },
  REJECTED: { label: "مرفوض", badgeClass: "bg-red-500/15 text-red-300 border border-red-500/30" },
  CANCELLED: { label: "ملغي", badgeClass: "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30" },
};

export default function PurchasesPage() {
  const snapshot = readSectionSnapshot<Snapshot>("purchase-documents");
  const [documents, setDocuments] = useState<Document[]>(() => snapshot?.documents || []);
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => snapshot?.suppliers || []);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(() => snapshot?.warehouses || []);
  const [loading, setLoading] = useState(!snapshot);
  const [role, setRole] = useState("");
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [focusedId, setFocusedId] = useState("");

  useSectionSearchSelection(id => {
    setFilter("all");
    setFocusedId(id);
  });

  const [editing, setEditing] = useState<Document | "new" | null>(null);
  const [receiving, setReceiving] = useState<Document | null>(null);
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [orders, vendors, stores] = await Promise.all([
        fetchApi("/purchase-documents"), fetchApi("/suppliers?limit=1000"), fetchApi("/inventory/warehouses"),
      ]);
      const data = { documents: orders as Document[], suppliers: (vendors.data || []) as Supplier[], warehouses: stores as Warehouse[] };
      setDocuments(data.documents); setSuppliers(data.suppliers); setWarehouses(data.warehouses);
      writeSectionSnapshot("purchase-documents", data);
    } catch (cause) { notifyError(errorMessage(cause, "تعذر تحميل أوامر الشراء")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { setRole(getUserRole() || ""); void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (document: Document, action: "approve" | "reject" | "place" | "cancel") => {
    setBusyId(document.id);
    const targetSupplier = suppliers.find(item => item.id === document.supplier_id);
    const cleanPhone = cleanWhatsAppPhone(targetSupplier?.phone);
    let whatsappWindow: Window | null = null;
    if (action === "approve") {
      whatsappWindow = window.open("", "_blank");
    }
    try {
      await fetchApi(`/purchase-documents/${document.id}/status/${action}`, { method: "POST" });
      refreshNotificationBell();
      await load();
      if (action === "approve") {
        if (whatsappWindow) {
          if (cleanPhone) {
            const message = buildPurchaseWhatsAppMessage(document, targetSupplier?.name);
            whatsappWindow.location.href = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
            notifySuccess("تمت الموافقة وفتح واتساب ويب بمراسلة أمر الشراء للمورد");
          } else {
            whatsappWindow.close();
            notifySuccess("تمت الموافقة على أمر الشراء بنجاح. تنبيه: لا يوجد رقم هاتف مسجل للمورد لإرسال رسالة واتساب.");
          }
        } else {
          notifySuccess("تمت الموافقة على أمر الشراء بنجاح");
        }
      }
      else if (action === "reject") notifySuccess("تم رفض أمر الشراء");
      else if (action === "place") notifySuccess("تم إصدار أمر الشراء بنجاح");
      else if (action === "cancel") notifySuccess("تم إلغاء أمر الشراء");
    }
    catch (cause) {
      whatsappWindow?.close();
      notifyError(errorMessage(cause, "تعذر تحديث أمر الشراء"));
    }
    finally { setBusyId(null); }
  };

  const updateDocumentSupplier = async (documentId: string, newSupplierId: string) => {
    setBusyId(documentId);
    try {
      await fetchApi(`/purchase-documents/${documentId}/supplier`, {
        method: "PUT",
        body: JSON.stringify({ supplier_id: newSupplierId }),
      });
      const selected = suppliers.find(s => s.id === newSupplierId);
      notifySuccess(`تم تغيير مورد أمر الشراء إلى ${selected?.name || "المورد الجديد"} بنجاح`);
      await load();
    } catch (cause) {
      notifyError(errorMessage(cause, "تعذر تغيير مورد أمر الشراء"));
    } finally {
      setBusyId(null);
    }
  };

  const openWhatsAppForDocument = (doc: Document) => {
    const targetSupplier = suppliers.find(item => item.id === doc.supplier_id);
    const cleanPhone = cleanWhatsAppPhone(targetSupplier?.phone);
    if (!cleanPhone) {
      notifyError("لا يوجد رقم هاتف مسجل لهذا المورد لإرسال رسالة واتساب");
      return;
    }
    const message = buildPurchaseWhatsAppMessage(doc, targetSupplier?.name);
    window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`, "_blank");
  };

  const supplierName = (id: string | null, savedName: string) => suppliers.find(item => item.id === id)?.name || savedName || "لم يحدد المورد بعد";

  const visible = documents
    .filter(doc => (filter === "all" ? true : filter === "open" ? activeStatuses.has(doc.status) : !activeStatuses.has(doc.status)))
    .sort((left, right) => Number(activeStatuses.has(right.status)) - Number(activeStatuses.has(left.status)) || right.created_at.localeCompare(left.created_at));

  return (
    <div className="min-h-screen" dir="rtl">
      <main className="app-main space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="app-heading">المشتريات</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/purchases/legacy" className="app-secondary-button">الأوامر القديمة</Link>
            {role === "ADMIN" && <button type="button" className="app-primary-button" onClick={() => setEditing("new")}>
              طلب شراء جديد
            </button>}
          </div>
        </header>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="فلترة أوامر الشراء">
          {(["open", "all", "done"] as const).map(key => (
            <button
              type="button"
              key={key}
              onClick={() => setFilter(key)}
              className={filter === key ? "app-primary-button !px-4 !py-2" : "app-secondary-button !px-4 !py-2"}
            >
              {key === "open" ? "المطلوب متابعته" : key === "done" ? "المكتمل والمغلق" : "كل الأوامر"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2].map(index => (
              <div key={index} className="app-panel space-y-4 p-5">
                <span className="app-skeleton h-5 w-32" />
                <span className="app-skeleton h-4 w-64 max-w-full" />
                <span className="app-skeleton h-4 w-40" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="app-panel p-10 text-center app-muted">
            لا توجد أوامر في هذه الحالة.
          </div>
        ) : (
          <div className="grid max-h-[44rem] min-w-0 items-start gap-4 overflow-y-auto overscroll-contain pe-1 custom-scrollbar xl:grid-cols-2">
            {visible.map(document => {
              const statusInfo = statusConfig[document.status] || { label: document.status, badgeClass: "bg-white/10 text-gray-300" };
              const isFocused = focusedId === document.id;
              const needsManagerDetails = !document.supplier_id || document.lines.some(line => line.quantity === null || line.base_quantity === null);

              return (
                <article
                  key={document.id}
                  data-search-id={document.id}
                  className={`app-panel flex flex-col justify-between p-5 space-y-4 rounded-2xl border transition-all ${
                    isFocused ? "border-primary ring-2 ring-primary/40 shadow-xl" : "border-white/10 hover:border-white/20"
                  }`}
                >
                  {/* Top Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-base font-bold text-white">
                          أمر شراء {document.public_number}
                        </h2>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.badgeClass}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        <span className="app-muted text-xs">المورد:</span>
                        {role === "ADMIN" && ["REQUESTED", "APPROVED", "ORDERED"].includes(document.status) ? (
                          <div className="min-w-[140px] max-w-[210px]">
                            <ProductSelect
                              label="تغيير المورد"
                              value={document.supplier_id || ""}
                              placeholder="اختر المورد"
                              disabled={!!busyId}
                              compact
                              options={suppliers.map(item => ({ value: item.id, label: item.name }))}
                              onChange={async newId => {
                                if (!newId || newId === document.supplier_id) return;
                                await updateDocumentSupplier(document.id, newId);
                              }}
                            />
                          </div>
                        ) : (
                          <strong className="text-[#e2bfb0] font-medium text-xs">{supplierName(document.supplier_id, document.supplier_name)}</strong>
                        )}
                        <span className="mx-2 text-white/20">·</span>
                        <span className="app-muted text-xs">{new Date(document.created_at).toLocaleDateString("ar-EG")}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {["APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(document.status) && (
                        <button
                          type="button"
                          className="app-secondary-button !h-8 !px-2.5 text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                          onClick={() => openWhatsAppForDocument(document)}
                          title="مراسلة المورد عبر واتساب ويب"
                        >
                          <span className="material-symbols-outlined text-sm">chat</span>
                          <span>واتساب</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={printingId === document.id || needsManagerDetails}
                        title={needsManagerDetails ? "أكمل المورد والكميات قبل الطباعة" : "طباعة أمر الشراء"}
                        className="app-secondary-button !h-8 !px-3 text-xs"
                        onClick={async () => {
                          setPrintingId(document.id);
                          try { await printPurchaseDocument(document.id); }
                          catch (cause) { notifyError(errorMessage(cause, "تعذر إرسال أمر الشراء للطابعة")); }
                          finally { setPrintingId(null); }
                        }}
                      >
                        {printingId === document.id ? "جارٍ الإرسال..." : "طباعة الأمر"}
                      </button>
                    </div>
                  </div>

                  {/* Simple Items List */}
                  <div className="space-y-2 py-2.5 border-y border-white/5">
                    {document.lines.map(line => {
                      const qty = Number(line.quantity);
                      const received = Number(line.received_base_quantity) / Number(line.conversion_factor);
                      const isComplete = received >= qty && qty > 0;

                      return (
                        <div key={line.id} className="flex items-center justify-between text-xs gap-3">
                          <span className="text-white font-medium truncate">{line.product_name}</span>
                          <div className="shrink-0 flex items-center gap-2">
                            <span className="text-[#e2bfb0] font-semibold">{line.quantity === null ? "الكمية يحددها المدير" : `${moneylessNumber(qty)} ${line.unit_name}`}</span>
                            {received > 0 && (
                              <span className={`text-[11px] ${isComplete ? "text-emerald-400" : "text-amber-300"}`}>
                                وصل {moneylessNumber(received)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {role === "ADMIN" && document.status === "REQUESTED" && needsManagerDetails && (
                    <p className="app-muted text-xs">أكمل المورد والكميات من تعديل الطلب قبل الموافقة.</p>
                  )}

                  {/* Note */}
                  {document.note && (
                    <p className="text-xs text-gray-400">
                      ملاحظة: {document.note}
                    </p>
                  )}

                  {/* Receipts */}
                  {document.receipts.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {document.receipts.map(receipt => (
                        <div key={receipt.id} className="flex items-center justify-between text-xs text-gray-300 py-1 border-t border-white/5">
                          <span>استلام {receipt.public_number} · {new Date(receipt.created_at).toLocaleDateString("ar-EG")}</span>
                          <button
                            type="button"
                            disabled={printingId === receipt.id}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                            onClick={async () => {
                              setPrintingId(receipt.id);
                              try { await printPurchaseReceipt(document.id, receipt.id); }
                              catch (cause) { notifyError(errorMessage(cause, "تعذر إرسال فاتورة الاستلام للطابعة")); }
                              finally { setPrintingId(null); }
                            }}
                          >
                            {printingId === receipt.id ? "جارٍ..." : "طباعة إيصال الاستلام"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bottom Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <span className="text-xs text-gray-400">{document.lines.length} أصناف</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {role === "ADMIN" && ["REQUESTED", "APPROVED"].includes(document.status) && (
                        <button
                          type="button"
                          disabled={!!busyId}
                          className="app-secondary-button !h-8 !px-3 text-xs"
                          onClick={() => setEditing(document)}
                        >
                          تعديل
                        </button>
                      )}

                      {role === "ADMIN" && document.status === "REQUESTED" && (
                        <>
                          <button
                            type="button"
                            disabled={!!busyId || needsManagerDetails}
                            title={needsManagerDetails ? "أكمل المورد والكميات قبل الموافقة" : "الموافقة على الطلب"}
                            className="app-primary-button !h-8 !px-3 text-xs"
                            onClick={() => void act(document, "approve")}
                          >
                            موافقة
                          </button>
                          <button
                            type="button"
                            disabled={!!busyId}
                            className="app-secondary-button !h-8 !px-3 text-xs"
                            onClick={() => void act(document, "reject")}
                          >
                            رفض
                          </button>
                        </>
                      )}

                      {role === "ADMIN" && document.status === "APPROVED" && (
                        <button
                          type="button"
                          disabled={!!busyId}
                          className="app-secondary-button !h-8 !px-3 text-xs"
                          onClick={() => void act(document, "place")}
                        >
                          إصدار الأمر
                        </button>
                      )}

                      {["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(document.status) && (
                        <button
                          type="button"
                          className="app-primary-button !h-8 !px-3 text-xs"
                          onClick={() => setReceiving(document)}
                        >
                          استلام مخزن
                        </button>
                      )}

                      {role === "ADMIN" && ["REQUESTED", "APPROVED", "ORDERED"].includes(document.status) && (
                        <button
                          type="button"
                          disabled={!!busyId}
                          className="app-secondary-button !h-8 !px-3 text-xs text-red-300"
                          onClick={() => void act(document, "cancel")}
                        >
                          إلغاء الأمر
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {editing && (
        <PurchaseEditor
          initial={editing === "new" ? null : editing}
          suppliers={suppliers}
          onClose={() => setEditing(null)}
          onSaved={async () => { refreshNotificationBell(); await load(); }}
        />
      )}

      {receiving && (
        <ReceiptEditor
          document={receiving}
          warehouses={warehouses}
          onClose={() => setReceiving(null)}
          onSaved={async () => { refreshNotificationBell(); await load(); }}
        />
      )}
    </div>
  );
}
