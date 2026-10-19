"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/currentUser";
import { notifyError, notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";

type Approval = {
  id: string; product_id: string; product_name: string; action: "UPDATE" | "DELETE";
  status: "PENDING" | "APPROVED" | "REJECTED"; requester?: string;
  baseline: { fields: Record<string, string | null>; units: unknown[] };
  proposed?: Record<string, unknown> | null; created_at: string; rejection_reason?: string | null;
};

const labels: Record<string, string> = {
  sku: "كود المنتج", barcode: "الباركود", name_ar: "الاسم العربي", name_en: "الاسم الإنجليزي",
  category_id: "التصنيف", subcategory_id: "التصنيف الفرعي", brand_id: "العلامة التجارية",
  supplier_id: "المورد", base_unit: "الوحدة الأساسية", cost: "سعر الشراء", tax_rate: "الضريبة",
  min_stock_level: "الحد الأدنى", max_stock_level: "الحد الأقصى", description: "الوصف",
  warehouse_location: "مكان المنتج", is_active: "الحالة", image_url: "الصورة",
};

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "غير محدد";
  if (value === true || value === "True") return "نشط";
  if (value === false || value === "False") return "غير نشط";
  return String(value);
}

const numberFields = new Set(["cost", "tax_rate", "min_stock_level", "max_stock_level"]);
function sameField(key: string, left: unknown, right: unknown): boolean {
  if (numberFields.has(key)) return Number(left || 0) === Number(right || 0);
  if (key === "is_active") return String(left).toLowerCase() === String(right).toLowerCase();
  return String(left ?? "") === String(right ?? "");
}

type ReviewUnit = { id?: string; unit_name: string; conversion_factor: string | number; barcode?: string | null;
  prices?: Array<{ level?: string; price_level?: string; price: string | number }> };
function sameUnits(before: ReviewUnit[], after: ReviewUnit[]): boolean {
  if (before.length !== after.length) return false;
  const existing = new Map(before.map(unit => [unit.id, unit]));
  return after.every(unit => {
    const previous = existing.get(unit.id);
    if (!previous || previous.unit_name !== unit.unit_name ||
        Number(previous.conversion_factor) !== Number(unit.conversion_factor) ||
        (previous.barcode || "") !== (unit.barcode || "")) return false;
    const prices = new Map(previous.prices?.map(price => [price.level || price.price_level, Number(price.price)]));
    return previous.prices?.length === unit.prices?.length &&
      unit.prices?.every(price => prices.get(price.level || price.price_level) === Number(price.price));
  });
}

function ProductApprovalsContent() {
  const selectedId = useSearchParams().get("request");
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Approval | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [catalogNames, setCatalogNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [user, requests] = await Promise.all([getCurrentUser(), fetchApi("/product-approvals?limit=50")]);
      setIsAdmin(user.role === "ADMIN");
      setRows(requests);
      setHasMore(requests.length === 50);
      const catalog = await Promise.allSettled([
        fetchApi("/products/categories"), fetchApi("/products/subcategories"),
        fetchApi("/products/brands"), fetchApi("/products/suppliers"),
      ]);
      setCatalogNames(Object.fromEntries(catalog.flatMap((result, index) => result.status === "fulfilled"
        ? result.value.map((item: { id: string; name_ar?: string; name?: string }) => [item.id, index === 3 ? item.name : item.name_ar])
        : [])));
      if (selectedId && !requests.some((row: Approval) => row.id === selectedId)) {
        setSelected(await fetchApi(`/product-approvals/${selectedId}`));
      } else {
        setSelected(previous => requests.find((row: Approval) => row.id === (previous?.id || selectedId)) || null);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "تعذر تحميل طلبات المنتجات");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  async function loadMore() {
    try {
      const next: Approval[] = await fetchApi(`/product-approvals?limit=50&offset=${rows.length}`);
      setRows(previous => [...previous, ...next]);
      setHasMore(next.length === 50);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "تعذر تحميل المزيد من الطلبات");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function decide() {
    if (!selected || !decision || (decision === "reject" && reason.trim().length < 3)) return;
    setBusy(true);
    try {
      await fetchApi(`/product-approvals/${selected.id}/${decision}`, {
        method: "POST", body: JSON.stringify(decision === "reject" ? { reason: reason.trim() } : {}),
      });
      notifySuccess(decision === "approve" ? "اتطبّق قرار الموافقة على المنتج" : "اترفض الطلب واتبلغ أمين المخزن");
      refreshNotificationBell();
      setDecision(null); setReason("");
      await load();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "تعذر تنفيذ القرار");
    } finally {
      setBusy(false);
    }
  }

  const changes = selected?.action === "UPDATE" ? Object.entries(selected.proposed || {}).filter(([key, value]) =>
    key in labels && !sameField(key, value, selected.baseline.fields[key])) : [];
  const hasProposedUnits = selected?.action === "UPDATE" && selected.proposed?.units !== undefined &&
    !sameUnits(selected.baseline.units as ReviewUnit[], selected.proposed.units as ReviewUnit[]);
  const displayField = (key: string, value: unknown) =>
    key.endsWith("_id") && value ? catalogNames[String(value)] || "الاسم غير متاح" : valueText(value);

  return <div className="min-h-screen bg-[#131313] text-[#e5e2e1]" dir="rtl">
    <SideNav /><TopNav title="طلبات المنتجات" />
    <main className="app-main space-y-6">
      <h1 className="app-heading">{isAdmin ? "مراجعة طلبات المنتجات" : "طلباتي على المنتجات"}</h1>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="app-panel min-w-0 overflow-hidden" aria-label="قائمة الطلبات">
          {loading ? <p className="app-muted p-6">جارٍ تحميل الطلبات…</p> : rows.length === 0 ?
            <p className="app-muted p-6">لا توجد طلبات حتى الآن.</p> : rows.map(row =>
              <button key={row.id} type="button" onClick={() => setSelected(row)}
                className={`app-table-row flex w-full items-center justify-between gap-4 px-5 py-4 text-right ${selected?.id === row.id ? "bg-primary/10" : ""}`}>
                <span><strong className="block">{row.product_name}</strong><span className="app-muted text-xs">{row.action === "UPDATE" ? "تعديل" : "حذف"} · {row.requester || "أمين المخزن"} · {new Date(row.created_at).toLocaleString("ar-EG")}</span></span>
                <span className="shrink-0 text-xs font-bold text-primary">{row.status === "PENDING" ? "بانتظار المدير" : row.status === "APPROVED" ? "معتمد" : "مرفوض"}</span>
              </button>)}
          {hasMore && <button type="button" className="app-secondary-button m-4" onClick={() => void loadMore()}>عرض المزيد</button>}
        </section>
        <section className="app-panel min-w-0 p-6" aria-label="تفاصيل الطلب">
          {!selected ? <p className="app-muted">اختر طلبًا لعرض تفاصيله.</p> : <div className="space-y-5">
            <div><h2 className="text-xl font-bold">{selected.action === "UPDATE" ? "تعديل" : "حذف"} {selected.product_name}</h2>
              <p className="app-muted mt-1 text-sm">{selected.action === "DELETE" ? "الحذف أرشفة للمنتج بعد التحقق من خلو رصيده وعدم وجود أمر شراء مفتوح." : "التعديلات المقترحة لا تُطبّق قبل موافقة المدير."}</p></div>
            {selected.action === "UPDATE" && <>
              <div className="space-y-2">{changes.length ? changes.map(([key, value]) => <div key={key} className="app-table-row grid gap-2 py-3 text-sm sm:grid-cols-3"><strong>{labels[key]}</strong><span className="app-muted break-all">الحالي: {displayField(key, selected.baseline.fields[key])}</span><span className="break-all">المقترح: {displayField(key, value)}</span></div>) : <p className="app-muted text-sm">لا يوجد تغيير في البيانات الأساسية.</p>}</div>
              {hasProposedUnits && <div className="border-t border-white/10 pt-4"><h3 className="font-bold">الوحدات والأسعار</h3><div className="mt-3 grid gap-4 xl:grid-cols-2"><div><p className="app-muted mb-2 text-sm">الحالي</p><div className="space-y-2 text-sm">{(selected.baseline.units as Array<{ unit_name: string; conversion_factor: string; barcode?: string; prices?: Array<{ level: string; price: string }> }>).map((unit, index) => <div key={index} className="app-table-row p-3"><strong>{unit.unit_name}</strong><p className="app-muted">التحويل: {unit.conversion_factor} · الباركود: {unit.barcode || "بدون"}</p><p>{unit.prices?.map(price => `${price.level}: ${price.price} ج.م`).join(" · ")}</p></div>)}</div></div><div><p className="app-muted mb-2 text-sm">المقترح</p><div className="space-y-2 text-sm">{(selected.proposed?.units as Array<{ unit_name: string; conversion_factor: number; barcode?: string; prices?: Array<{ price_level: string; price: number }> }> || []).map((unit, index) => <div key={index} className="app-table-row p-3"><strong>{unit.unit_name}</strong><p className="app-muted">التحويل: {unit.conversion_factor} · الباركود: {unit.barcode || "بدون"}</p><p>{unit.prices?.map(price => `${price.price_level}: ${price.price} ج.م`).join(" · ")}</p></div>)}</div></div></div></div>}
            </>}
            {selected.rejection_reason && <p className="text-sm text-red-300">سبب الرفض: {selected.rejection_reason}</p>}
            {isAdmin && selected.status === "PENDING" && <div className="flex gap-3 border-t border-white/10 pt-5"><button type="button" className="app-primary-button" onClick={() => setDecision("approve")}>موافقة وتطبيق</button><button type="button" className="app-secondary-button" onClick={() => setDecision("reject")}>رفض الطلب</button></div>}
          </div>}
        </section>
      </div>
    </main>
    {decision && selected && <div className="motion-overlay fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><div className="motion-dialog app-panel w-full max-w-md space-y-4 p-6"><h2 className="text-lg font-bold">{decision === "approve" ? "تأكيد الموافقة؟" : "رفض الطلب؟"}</h2><p className="app-muted text-sm">{decision === "approve" ? "سيُفحص المنتج مرة أخرى قبل تطبيق التغيير. إذا تغيّر منذ تقديم الطلب سيتوقف الاعتماد." : "لن يتغير المنتج، وسيصل سبب الرفض لأمين المخزن."}</p>{decision === "reject" && <label className="block text-sm">سبب الرفض<textarea className="app-field mt-2 min-h-24" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>}<div className="flex gap-3"><button type="button" className="app-primary-button" disabled={busy || (decision === "reject" && reason.trim().length < 3)} onClick={() => void decide()}>{busy ? "جارٍ الحفظ…" : "تأكيد"}</button><button type="button" className="app-secondary-button" disabled={busy} onClick={() => setDecision(null)}>إلغاء</button></div></div></div>}
  </div>;
}

export default function ProductApprovalsPage() {
  return <Suspense fallback={<div className="app-panel m-8 p-8">جارٍ تحميل الطلبات…</div>}><ProductApprovalsContent /></Suspense>;
}
