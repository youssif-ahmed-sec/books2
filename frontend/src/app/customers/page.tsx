"use client";

import { notifyError } from "@/lib/notifications";

import { useState, useEffect, useRef } from "react";
import { fetchApi } from "@/lib/api";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
import { ProductSelect } from "@/components/ProductSelect";
import { LoadingTableRows } from "@/components/LoadingState";
import { getUserRole, type UserRole } from "@/utils/auth";
import { errorMessage } from "@/lib/errors";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

const customerSchema = z.object({
  name: z.string().min(2, "الاسم مطلوب (أكثر من حرفين)"),
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  whatsapp_number: z.string().optional(),
  city: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  address: z.string().optional(),
  customer_type: z.string().min(1, "نوع العميل مطلوب"),
  price_level: z.string().min(1, "مستوى السعر مطلوب"),
  credit_limit: z.coerce.number().min(0, "الحد الائتماني لا يمكن أن يكون سالبًا"),
  notes: z.string().optional(),
  tagsText: z.string().optional(),
  interestsText: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;
type CustomerFormInput = z.input<typeof customerSchema>;
type Customer = CustomerFormValues & { id: string; total_purchases: number | null; balance: number | null; purchase_count: number | null; average_purchase: number | null; last_purchase_date?: string | null; tags?: string[]; favorite_categories?: string[]; addresses?: string[] };
type CustomerPayment = { id: string; amount: number; wallet_fee_amount?: number; method: string; kind: string; created_at: string };
type Interaction = { id: string; channel: string; note: string; follow_up_at: string | null; created_at: string };
type CustomerOrder = { id: string; public_number: number; status: string; total_amount: number; created_at: string };

const customerTypeLabels: Record<string, string> = {
  "Retail Customer": "تجزئة", Student: "طالب", Teacher: "مدرس", School: "مدرسة",
  NURSERY: "حضانة", "Speech Therapy Center": "مركز تخاطب",
  "Wholesale Customer": "جملة", "Super Wholesale Customer": "سوبر جملة", "VIP Customer": "VIP",
};

export default function CustomersPage() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [customers, setCustomers] = useState<Customer[]>(() => readSectionSnapshot<Customer[]>("customers-list") || []);
  const [loading, setLoading] = useState(() => !readSectionSnapshot("customers-list"));
  const [loadError, setLoadError] = useState(false);
  const [isSlideoverOpen, setIsSlideoverOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentHistory, setPaymentHistory] = useState<CustomerPayment[]>([]);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const paymentAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const profileRequest = useRef(0);
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [profileTab, setProfileTab] = useState<"details" | "orders" | "payments" | "followup">("details");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterDebt, setFilterDebt] = useState(false);
  const [filterActivity, setFilterActivity] = useState("");
  const [activityCutoff, setActivityCutoff] = useState<number | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [orderHistory, setOrderHistory] = useState<CustomerOrder[]>([]);
  const [interactionChannel, setInteractionChannel] = useState("Phone Call");
  const [interactionNote, setInteractionNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [segmentTag, setSegmentTag] = useState("");
  const [segmentMin, setSegmentMin] = useState(0);
  const [segmentCustomers, setSegmentCustomers] = useState<Customer[]>([]);

  const { control, register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<CustomerFormInput, unknown, CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customer_type: "Retail Customer",
      price_level: "Retail",
      credit_limit: "",
    }
  });

  const loadCustomers = async (): Promise<Customer[] | null> => {
    try {
      const data = await fetchApi("/customers") as Customer[];
      setCustomers(data);
      setLoadError(false);
      writeSectionSnapshot("customers-list", data);
      return data;
    } catch (err) {
      console.error("Failed to load customers:", err);
      setLoadError(true);
      return null;
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setUserRole(getUserRole()), 0);
    fetchApi("/customers").then((data: Customer[]) => { setCustomers(data); setLoadError(false); writeSectionSnapshot("customers-list", data); }).catch((err) => {
      console.error("Failed to load customers:", err);
      setLoadError(true);
    }).finally(() => setLoading(false));
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const revealCustomer = () => { setFilterType(""); setFilterCity(""); setFilterDebt(false); setFilterActivity(""); };
    window.addEventListener("section-search-focus", revealCustomer);
    return () => window.removeEventListener("section-search-focus", revealCustomer);
  }, []);

  const openAdd = () => {
    setEditingCustomer(null);
    reset({
      name: "",
      phone: "",
      whatsapp_number: "",
      city: "",
      email: "",
      address: "",
      customer_type: "Retail Customer",
      price_level: "Retail",
      credit_limit: "",
      notes: ""
      ,tagsText: "", interestsText: ""
    });
    setIsSlideoverOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    reset({
      name: customer.name,
      phone: customer.phone,
      whatsapp_number: customer.whatsapp_number || "",
      city: customer.city || "",
      email: customer.email || "",
      address: customer.address || "",
      customer_type: customer.customer_type || "Retail Customer",
      price_level: customer.price_level || "Retail",
      credit_limit: Number(customer.credit_limit || 0) || "",
      notes: customer.notes || "",
      tagsText: (customer.tags || []).join(", "),
      interestsText: (customer.favorite_categories || []).join(", ")
    });
    setIsSlideoverOpen(true);
  };

  const onSubmit = async (data: CustomerFormValues) => {
    try {
      const { credit_limit, price_level, tagsText, interestsText, ...customerFields } = data;
      const tags = (tagsText || "").split(",").map(value => value.trim()).filter(Boolean);
      const favorite_categories = (interestsText || "").split(",").map(value => value.trim()).filter(Boolean);
      const customerData = userRole === "ADMIN" ? { ...customerFields, price_level, tags, favorite_categories } : { ...customerFields, tags, favorite_categories };
      let savedCustomer: Customer;
      if (editingCustomer) {
        savedCustomer = await fetchApi(`/customers/${editingCustomer.id}`, {
          method: "PUT",
          body: JSON.stringify(customerData),
        });
      } else {
        savedCustomer = await fetchApi("/customers", {
          method: "POST",
          body: JSON.stringify(customerData),
        });
      }
      if (userRole === "ADMIN") {
        await fetchApi(`/customers/${savedCustomer.id}/credit-limit`, {
          method: "PATCH",
          body: JSON.stringify({ credit_limit }),
        });
      }
      const updatedCustomers = await loadCustomers();
      if (profileCustomer?.id === savedCustomer.id) setProfileCustomer(updatedCustomers?.find(customer => customer.id === savedCustomer.id) || savedCustomer);
      setIsSlideoverOpen(false);
    } catch (err) {
      console.error("Failed to save customer:", err);
      notifyError("حدث خطأ أثناء الحفظ");
    }
  };

  const collectPayment = async () => {
    if (!paymentCustomer || !Number.isFinite(paymentAmount) || paymentAmount <= 0 || Math.abs(Math.round(paymentAmount * 100) - paymentAmount * 100) > 1e-6 || paymentAmount > Number(paymentCustomer.balance)) return;
    const request = profileRequest.current;
    setPaymentBusy(true); setPaymentError("");
    try {
      const fingerprint = JSON.stringify([paymentCustomer.id, paymentAmount, paymentMethod]);
      if (paymentAttempt.current?.fingerprint !== fingerprint) paymentAttempt.current = { fingerprint, id: crypto.randomUUID() };
      await fetchApi(`/customers/${paymentCustomer.id}/payments`, { method: "POST", body: JSON.stringify({ request_id: paymentAttempt.current.id, amount: paymentAmount, method: paymentMethod }) });
      const [updatedCustomers, history] = await Promise.all([fetchApi("/customers"), fetchApi(`/customers/${paymentCustomer.id}/payments`)]);
      setCustomers(updatedCustomers);
      writeSectionSnapshot("customers-list", updatedCustomers);
      const updated = updatedCustomers.find((customer: Customer) => customer.id === paymentCustomer.id) || null;
      setProfileCustomer(previous => previous?.id === updated?.id ? updated : previous);
      if (request === profileRequest.current) { setPaymentHistory(history); setPaymentCustomer(updated); setPaymentAmount(0); }
      paymentAttempt.current = null;
    } catch (error) { setPaymentError(errorMessage(error, "تعذر تسجيل التحصيل")); }
    finally { setPaymentBusy(false); }
  };

  const selectProfileTab = async (customer: Customer, tab: "details" | "orders" | "payments" | "followup") => {
    const request = ++profileRequest.current;
    setProfileTab(tab); setProfileError("");
    if (tab === "details") { setProfileBusy(false); return; }
    setProfileBusy(true);
    try {
      if (tab === "orders" && userRole === "ADMIN") {
        const orders = await fetchApi(`/customers/${customer.id}/orders`);
        if (request === profileRequest.current) setOrderHistory(orders);
      }
      if (tab === "payments") {
        setPaymentCustomer(customer); setPaymentAmount(0); setPaymentError("");
        const payments = await fetchApi(`/customers/${customer.id}/payments`);
        if (request === profileRequest.current) setPaymentHistory(payments);
      }
      if (tab === "followup") {
        const contact = await fetchApi(`/customers/${customer.id}/interactions`);
        if (request === profileRequest.current) setInteractions(contact);
      }
    } catch (error) { if (request === profileRequest.current) setProfileError(errorMessage(error, "تعذر تحميل بيانات العميل")); }
    finally { if (request === profileRequest.current) setProfileBusy(false); }
  };

  const openProfile = (customer: Customer) => {
    ++profileRequest.current;
    setProfileCustomer(customer); setProfileTab("details"); setInteractionNote("");
    setOrderHistory([]); setPaymentHistory([]); setInteractions([]); setProfileError(""); setPaymentCustomer(null); setProfileBusy(false);
  };

  const saveInteraction = async () => {
    if (!profileCustomer || interactionNote.trim().length < 2) return;
    try {
      await fetchApi(`/customers/${profileCustomer.id}/interactions`, { method: "POST", body: JSON.stringify({ channel: interactionChannel, note: interactionNote.trim(), follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null }) });
      setInteractions(await fetchApi(`/customers/${profileCustomer.id}/interactions`)); setInteractionNote(""); setFollowUpAt("");
    } catch (error) { notifyError(errorMessage(error, "تعذر حفظ التواصل")); }
  };

  const loadSegment = async () => {
    try { setSegmentCustomers(await fetchApi(`/customers/segments?tag=${encodeURIComponent(segmentTag)}&min_purchases=${segmentMin}`)); }
    catch (error) { notifyError(errorMessage(error, "تعذر تجهيز القائمة")); }
  };

  const exportSegment = () => {
    const rows = [["name", "phone", "type", "purchases"], ...segmentCustomers.map(customer => [customer.name, customer.phone, customer.customer_type, String(customer.total_purchases)])];
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "customer-list.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  const cities = [...new Set(customers.map(customer => customer.city?.trim()).filter((city): city is string => Boolean(city)))].sort((a, b) => a.localeCompare(b, "ar"));
  const filteredCustomers = customers.filter(customer => {
    if (filterType && customer.customer_type !== filterType) return false;
    if (filterCity && customer.city?.trim() !== filterCity) return false;
    if (filterDebt && Number(customer.balance || 0) <= 0) return false;
    if (userRole === "ADMIN" && filterActivity && activityCutoff !== null) {
      const recent = Boolean(customer.last_purchase_date && activityCutoff - new Date(customer.last_purchase_date).getTime() <= 30 * 86400000);
      if (filterActivity === "recent" && !recent) return false;
      if (filterActivity === "older" && recent) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="العملاء" />
      <main className="app-main">
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="app-heading">العملاء</h1>
            </div>
            <button
              onClick={openAdd}
              className="app-primary-button"
            >
              + إضافة عميل
            </button>
          </div>

          <section className="app-panel p-4 sm:p-5" aria-label="تصفية العملاء">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1 text-sm"><span className="mb-1 block">نوع العميل</span>
                <ProductSelect label="تصفية حسب نوع العميل" value={filterType} onChange={setFilterType} placeholder="كل الأنواع"
                  options={Object.entries(customerTypeLabels).map(([value, label]) => ({ value, label }))} compact />
              </div>
              <div className="min-w-40 flex-1 text-sm"><span className="mb-1 block">المدينة</span>
                <ProductSelect label="تصفية حسب المدينة" value={filterCity} onChange={setFilterCity} placeholder="كل المدن"
                  options={cities.map(city => ({ value: city, label: city }))} compact />
              </div>
              {userRole === "ADMIN" && <div className="min-w-40 flex-1 text-sm"><span className="mb-1 block">آخر تعامل</span>
                <ProductSelect label="تصفية حسب آخر تعامل" value={filterActivity} onChange={value => { setFilterActivity(value); setActivityCutoff(new Date().getTime()); }} placeholder="أي وقت"
                  options={[{ value: "recent", label: "آخر ٣٠ يومًا" }, { value: "older", label: "أقدم أو بلا مشتريات" }]} compact />
              </div>}
              {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <label className="flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" checked={filterDebt} onChange={event => setFilterDebt(event.target.checked)} />عليهم مديونية</label>}
              {(filterType || filterCity || filterDebt || filterActivity) && <button type="button" className="app-secondary-button" onClick={() => { setFilterType(""); setFilterCity(""); setFilterDebt(false); setFilterActivity(""); }}>مسح الفلاتر</button>}
            </div>
          </section>

          {userRole === "ADMIN" && <details className="app-panel p-4 sm:p-5"><summary className="cursor-pointer font-semibold">تصدير قائمة العملاء</summary><div className="mt-4 flex flex-wrap gap-3"><input className="app-field" aria-label="وسم العميل" placeholder="وسم العميل" value={segmentTag} onChange={event => setSegmentTag(event.target.value)} /><ZeroHintNumberInput aria-label="أقل إجمالي مشتريات" className="app-field" min="0" value={segmentMin} onChange={event => setSegmentMin(Number(event.target.value) || 0)} /><button className="app-secondary-button" onClick={loadSegment}>تجهيز القائمة</button><button disabled={!segmentCustomers.length} className="app-secondary-button disabled:opacity-40" onClick={exportSegment}>تنزيل CSV</button></div></details>}

      {loadError && <p role="alert" className="app-panel rounded-xl border-red-500/30 p-4 text-sm text-red-300">تعذر تحديث العملاء. حاول تحديث الصفحة.</p>}
      <div className="app-panel overflow-hidden">
        <div className="divide-y divide-current/10 md:hidden">
          {loading && <p role="status" className="app-muted p-5 text-sm">جاري تحميل العملاء...</p>}
          {!loading && filteredCustomers.map(c => <article key={c.id} data-search-id={c.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold" title={c.name}>{c.name}</h2><p className="app-muted mt-0.5 text-sm" dir="ltr">{c.phone}</p></div><span className="app-muted shrink-0 text-xs">{customerTypeLabels[c.customer_type] || c.customer_type}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span><span className="app-muted">المدينة: </span>{c.city || "—"}</span>{userRole === "ADMIN" && <span><span className="app-muted">المشتريات: </span>{Number(c.total_purchases || 0).toLocaleString("ar-EG")} ج.م</span>}{(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <span><span className="app-muted">المديونية: </span>{Number(c.balance || 0).toFixed(2)} ج.م</span>}</div>
            <button onClick={() => openProfile(c)} className="app-secondary-button !rounded-lg !px-3 !py-2">فتح الملف</button>
          </article>)}
          {!loading && !loadError && filteredCustomers.length === 0 && <p className="app-muted p-6 text-center text-sm">{customers.length ? "لا يوجد عملاء مطابقون للفلاتر" : "لا يوجد عملاء مضافين بعد"}</p>}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">اسم العميل</th>
                <th className="px-4 py-3 font-medium">الهاتف</th>
                <th className="px-4 py-3 font-medium">النوع</th>
                <th className="px-4 py-3 font-medium">المدينة</th>
                {userRole === "ADMIN" && <th className="px-4 py-3 font-medium">إجمالي المشتريات</th>}
                {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <th className="px-4 py-3 font-medium">المديونية / الحد</th>}
                <th className="px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-[#e5e2e1]">
              {loading && <LoadingTableRows label="جاري تحميل العملاء" columns={userRole === "ADMIN" ? 7 : userRole === "CASHIER_ORDERS" ? 6 : 5} />}
              {!loading && filteredCustomers.map((c) => (
                <tr key={c.id} data-search-id={c.id} className="app-table-row">
                  <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#e2bfb0]">
                      {customerTypeLabels[c.customer_type] || c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.city || "-"}</td>
                  {userRole === "ADMIN" && <td className="px-4 py-3">{Number(c.total_purchases || 0).toLocaleString("ar-EG")} ج.م</td>}
                  {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <td className="px-4 py-3">{Number(c.balance || 0).toFixed(2)} / {Number(c.credit_limit || 0).toFixed(2)} ج.م</td>}
                  <td className="px-4 py-3">
                    <button onClick={() => openProfile(c)} className="app-secondary-button !rounded-lg !px-3 !py-2">فتح الملف</button>
                  </td>
                </tr>
              ))}
              {!loading && !loadError && filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={userRole === "ADMIN" ? 7 : userRole === "CASHIER_ORDERS" ? 6 : 5} className="app-muted px-4 py-8 text-center">
                    {customers.length ? "لا يوجد عملاء مطابقون للفلاتر" : "لا يوجد عملاء مضافين بعد"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {profileCustomer && <div className="fixed inset-0 z-[80] flex justify-end bg-black/70" role="dialog" aria-modal="true" aria-label={`ملف ${profileCustomer.name}`}>
        <section className="customer-drawer flex h-full w-full max-w-[760px] flex-col shadow-2xl">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-current/10 px-5 py-5 sm:px-7">
            <div className="min-w-0"><h2 className="truncate text-xl font-bold">{profileCustomer.name}</h2><span className="app-muted text-sm" dir="ltr">{profileCustomer.phone}</span></div>
            <button type="button" aria-label="إغلاق ملف العميل" className="app-icon-button !rounded-xl" onClick={() => { ++profileRequest.current; setProfileCustomer(null); setPaymentCustomer(null); }}><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
          </header>
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-current/10 px-4 py-2 sm:px-6" aria-label="أقسام ملف العميل">
            {([ ["details", "البيانات"], ...(userRole === "ADMIN" ? [["orders", "الفواتير"]] : []), ["payments", "التحصيل"], ["followup", "المتابعة"] ] as Array<["details" | "orders" | "payments" | "followup", string]>).map(([tab, label]) =>
              <button key={tab} type="button" aria-current={profileTab === tab ? "page" : undefined} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold ${profileTab === tab ? "bg-primary text-white" : "app-muted hover:bg-white/5"}`} onClick={() => void selectProfileTab(profileCustomer, tab)}>{label}</button>
            )}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            {profileBusy && <p role="status" className="app-muted text-sm">جارٍ تحميل البيانات...</p>}
            {profileError && <p role="alert" className="mb-4 text-sm text-red-400">{profileError}</p>}
            {profileTab === "details" && <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="app-muted text-sm">{customerTypeLabels[profileCustomer.customer_type] || profileCustomer.customer_type}{profileCustomer.city ? ` · ${profileCustomer.city}` : ""}</span><button type="button" className="app-secondary-button" onClick={() => openEdit(profileCustomer)}>تعديل البيانات</button></div>
              <dl className="grid gap-x-6 gap-y-4 border-y border-current/10 py-5 text-sm sm:grid-cols-2">
                <div><dt className="app-muted">الهاتف</dt><dd className="mt-1 font-semibold" dir="ltr">{profileCustomer.phone}</dd></div>
                <div><dt className="app-muted">واتساب</dt><dd className="mt-1 font-semibold" dir="ltr">{profileCustomer.whatsapp_number || "—"}</dd></div>
                <div><dt className="app-muted">البريد الإلكتروني</dt><dd className="mt-1 break-all font-semibold">{profileCustomer.email || "—"}</dd></div>
                <div><dt className="app-muted">المدينة</dt><dd className="mt-1 font-semibold">{profileCustomer.city || "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="app-muted">العناوين</dt><dd className="mt-1 font-semibold">{(profileCustomer.addresses?.length ? profileCustomer.addresses : [profileCustomer.address]).filter(Boolean).join(" · ") || "—"}</dd></div>
                <div><dt className="app-muted">الوسوم</dt><dd className="mt-1">{(profileCustomer.tags || []).join("، ") || "—"}</dd></div>
                <div><dt className="app-muted">الاهتمامات</dt><dd className="mt-1">{(profileCustomer.favorite_categories || []).join("، ") || "—"}</dd></div>
                {profileCustomer.notes && <div className="sm:col-span-2"><dt className="app-muted">ملاحظات</dt><dd className="mt-1 whitespace-pre-wrap">{profileCustomer.notes}</dd></div>}
              </dl>
              {userRole === "ADMIN" && <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div><dt className="app-muted">عدد المشتريات</dt><dd className="mt-1 font-semibold">{profileCustomer.purchase_count ?? 0}</dd></div>
                <div><dt className="app-muted">إجمالي المشتريات</dt><dd className="mt-1 font-semibold">{Number(profileCustomer.total_purchases || 0).toFixed(2)} ج.م</dd></div>
                <div><dt className="app-muted">متوسط الطلب</dt><dd className="mt-1 font-semibold">{Number(profileCustomer.average_purchase || 0).toFixed(2)} ج.م</dd></div>
                <div><dt className="app-muted">آخر شراء</dt><dd className="mt-1 font-semibold">{profileCustomer.last_purchase_date ? new Date(profileCustomer.last_purchase_date).toLocaleDateString("ar-EG") : "لا يوجد"}</dd></div>
              </dl>}
            </div>}
            {profileTab === "orders" && userRole === "ADMIN" && <div className="space-y-2">
              {orderHistory.length === 0 && !profileBusy ? <p className="app-muted text-sm">لا توجد فواتير لهذا العميل.</p> : orderHistory.map(order => <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 py-3 text-sm"><span className="font-semibold">فاتورة {order.public_number}</span><span className="app-muted">{new Date(order.created_at).toLocaleDateString("ar-EG")}</span><span>{Number(order.total_amount).toFixed(2)} ج.م</span></div>)}
            </div>}
            {profileTab === "payments" && <div className="space-y-6">
              <div className="flex items-baseline justify-between border-b border-current/10 pb-4"><span className="app-muted text-sm">الرصيد المستحق</span><strong className="text-xl">{Number(profileCustomer.balance || 0).toFixed(2)} ج.م</strong></div>
              {paymentError && <p role="alert" className="text-sm text-red-400">{paymentError}</p>}
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">المبلغ المحصّل<input type="number" min="0.01" max={Number(profileCustomer.balance || 0)} step="0.01" value={paymentAmount || ""} onChange={event => setPaymentAmount(Number(event.target.value) || 0)} className="app-field mt-1" /></label><div className="text-sm"><span className="mb-1 block">وسيلة التحصيل</span><ProductSelect label="وسيلة التحصيل" value={paymentMethod} onChange={setPaymentMethod} placeholder="اختر وسيلة التحصيل" allowClear={false} compact options={[{ value: "Cash", label: "نقدًا" }, { value: "Instapay", label: "إنستا باي" }, { value: "Credit Card", label: "فيزا" }, { value: "Wallet", label: "محفظة" }]} /></div></div>
              {paymentMethod === "Wallet" && paymentAmount > 0 && <p className="app-muted text-sm">رسوم المحفظة ١٪: {(Math.round(paymentAmount) / 100).toFixed(2)} ج.م · المحصل: {(paymentAmount + Math.round(paymentAmount) / 100).toFixed(2)} ج.م</p>}
              <button type="button" disabled={profileBusy || paymentBusy || paymentAmount <= 0 || Math.abs(Math.round(paymentAmount * 100) - paymentAmount * 100) > 1e-6 || paymentAmount > Number(profileCustomer.balance || 0)} onClick={collectPayment} className="app-primary-button disabled:opacity-40">{paymentBusy ? "جارٍ التسجيل..." : "تسجيل التحصيل"}</button>
              <div className="border-t border-current/10 pt-4"><h3 className="mb-2 font-semibold">{userRole === "ADMIN" ? "سجل المدفوعات" : "سجل التحصيل"}</h3>{paymentHistory.length === 0 && !profileBusy ? <p className="app-muted text-sm">لا توجد دفعات مسجلة.</p> : paymentHistory.map(payment => <div key={payment.id} className="flex flex-wrap justify-between gap-2 border-b border-current/10 py-3 text-sm"><span>{userRole === "ADMIN" ? `${payment.kind === "SALE" ? "دفعة بيع" : "تحصيل"} · ` : ""}{Number(payment.amount).toFixed(2)} ج.م{Number(payment.wallet_fee_amount || 0) > 0 ? ` · رسوم ${Number(payment.wallet_fee_amount).toFixed(2)}` : ""}</span><span className="app-muted">{payment.method} · {new Date(payment.created_at).toLocaleDateString("ar-EG")}</span></div>)}</div>
            </div>}
            {profileTab === "followup" && <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2"><div className="text-sm"><span className="mb-1 block">طريقة التواصل</span><ProductSelect label="طريقة التواصل" value={interactionChannel} onChange={setInteractionChannel} placeholder="اختر طريقة التواصل" allowClear={false} compact options={[{ value: "Phone Call", label: "اتصال هاتفي" }, { value: "In Person", label: "زيارة" }, { value: "Other", label: "أخرى" }]} /></div><label className="text-sm">موعد متابعة · اختياري<input type="datetime-local" className="app-field mt-1" value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} /></label></div>
              <label className="block text-sm">ملخص التواصل<textarea className="app-field mt-1 min-h-24" value={interactionNote} onChange={event => setInteractionNote(event.target.value)} /></label>
              <button type="button" className="app-primary-button" onClick={saveInteraction} disabled={interactionNote.trim().length < 2}>حفظ التواصل</button>
              <div className="border-t border-current/10 pt-4">{interactions.length === 0 && !profileBusy ? <p className="app-muted text-sm">لا توجد متابعات مسجلة.</p> : interactions.map(entry => <div key={entry.id} className="border-b border-current/10 py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{entry.channel}</strong><span className="app-muted">{new Date(entry.created_at).toLocaleString("ar-EG")}</span></div><p className="mt-1 whitespace-pre-wrap">{entry.note}</p>{entry.follow_up_at && <span className="app-muted">متابعة: {new Date(entry.follow_up_at).toLocaleString("ar-EG")}</span>}</div>)}</div>
            </div>}
          </div>
        </section>
      </div>}

      {isSlideoverOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
          <div className="fixed inset-0 bg-black/65" onClick={() => setIsSlideoverOpen(false)}></div>
          <div className="customer-drawer relative flex h-full w-full max-w-xl flex-col shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-current/10 px-5 py-5 sm:px-7">
              <div>
                <h2 id="customer-form-title" className="text-xl font-bold">{editingCustomer ? "تعديل بيانات العميل" : "إضافة عميل"}</h2>
                <p className="app-muted mt-1 text-sm">بيانات التواصل والتصنيف المستخدمة في البيع</p>
              </div>
              <button type="button" aria-label="إغلاق" onClick={() => setIsSlideoverOpen(false)} className="app-icon-button !rounded-xl"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
            </div>
            <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-7">
                <fieldset className="space-y-4">
                  <legend className="mb-4 text-sm font-bold">البيانات الأساسية</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="customer-name" className="customer-field-label">الاسم <span className="text-primary">*</span></label><input id="customer-name" {...register("name")} autoComplete="name" className="app-field" aria-invalid={!!errors.name} />{errors.name && <p role="alert" className="mt-1 text-xs text-red-400">{errors.name.message}</p>}</div>
                    <div><label htmlFor="customer-phone" className="customer-field-label">رقم الهاتف <span className="text-primary">*</span></label><input id="customer-phone" {...register("phone")} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" className="app-field" aria-invalid={!!errors.phone} />{errors.phone && <p role="alert" className="mt-1 text-xs text-red-400">{errors.phone.message}</p>}</div>
                    <div><label htmlFor="customer-whatsapp" className="customer-field-label">رقم الواتساب <span className="app-muted font-normal">اختياري</span></label><input id="customer-whatsapp" {...register("whatsapp_number")} type="tel" inputMode="tel" dir="ltr" className="app-field" /></div>
                    <div><span className="customer-field-label">نوع العميل</span><Controller control={control} name="customer_type" render={({ field }) =>
                      <ProductSelect label="نوع العميل" value={field.value || ""} onChange={value => {
                        field.onChange(value);
                        const level = value === "Wholesale Customer" ? "Wholesale" : value === "Super Wholesale Customer" ? "Super Wholesale" : value === "VIP Customer" ? "VIP" : "Retail";
                        setValue("price_level", level);
                      }} placeholder="اختر نوع العميل" allowClear={false} invalid={!!errors.customer_type}
                        options={[{ value: "Retail Customer", label: "عميل تجزئة" }, { value: "Student", label: "طالب" }, { value: "Teacher", label: "مدرس" }, { value: "School", label: "مدرسة" }, { value: "NURSERY", label: "حضانة" }, { value: "Speech Therapy Center", label: "مركز تخاطب" }, { value: "Wholesale Customer", label: "عميل جملة" }, { value: "Super Wholesale Customer", label: "عميل سوبر جملة" }, { value: "VIP Customer", label: "عميل VIP" }]} />
                    } />{errors.customer_type && <p role="alert" className="mt-1 text-xs text-red-400">{errors.customer_type.message}</p>}</div>
                    <div><label htmlFor="customer-city" className="customer-field-label">المدينة</label><input id="customer-city" {...register("city")} autoComplete="address-level2" className="app-field" /></div>
                  </div>
                </fieldset>
                {userRole === "ADMIN" && <fieldset className="customer-form-section grid gap-4 border-t border-current/10 pt-6 sm:grid-cols-2">
                  <legend className="text-sm font-bold">إعدادات البيع</legend>
                  <div><span className="customer-field-label">مستوى السعر</span><Controller control={control} name="price_level" render={({ field }) =>
                    <ProductSelect label="مستوى السعر" value={field.value || ""} onChange={field.onChange} placeholder="اختر مستوى السعر" allowClear={false} invalid={!!errors.price_level}
                      options={[{ value: "Retail", label: "مستهلك" }, { value: "Semi Wholesale", label: "نصف جملة" }, { value: "Wholesale", label: "جملة" }, { value: "Super Wholesale", label: "سوبر جملة" }, { value: "VIP", label: "كبار العملاء" }]} />
                  } />{errors.price_level && <p role="alert" className="mt-1 text-xs text-red-400">{errors.price_level.message}</p>}</div>
                  <div><label htmlFor="customer-credit-limit" className="customer-field-label">الحد الائتماني (ج.م)</label><input id="customer-credit-limit" type="number" min="0" step="0.01" placeholder="0" {...register("credit_limit")} className="app-field" aria-invalid={!!errors.credit_limit} />{errors.credit_limit && <p role="alert" className="mt-1 text-xs text-red-400">{errors.credit_limit.message}</p>}</div>
                </fieldset>}
                <fieldset className="space-y-4 border-t border-current/10 pt-6">
                  <legend className="text-sm font-bold">تفاصيل إضافية</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label htmlFor="customer-email" className="customer-field-label">البريد الإلكتروني</label><input id="customer-email" {...register("email")} type="email" autoComplete="email" dir="ltr" className="app-field" aria-invalid={!!errors.email} />{errors.email && <p role="alert" className="mt-1 text-xs text-red-400">{errors.email.message}</p>}</div>
                    <div><label htmlFor="customer-tags" className="customer-field-label">الوسوم</label><input id="customer-tags" {...register("tagsText")} className="app-field" placeholder="افصل بينها بفاصلة" /></div>
                    <div><label htmlFor="customer-interests" className="customer-field-label">التصنيفات المفضلة</label><input id="customer-interests" {...register("interestsText")} className="app-field" /></div>
                    <div className="sm:col-span-2"><label htmlFor="customer-notes" className="customer-field-label">ملاحظات</label><textarea id="customer-notes" {...register("notes")} className="app-field min-h-24" rows={3} /></div>
                  </div>
                </fieldset>
              </div>
              <div className="customer-drawer-footer flex flex-wrap items-center justify-end gap-3 border-t border-current/10 px-5 py-4 sm:px-7">
                <button type="button" onClick={() => setIsSlideoverOpen(false)} className="app-secondary-button">إلغاء</button>
                <button type="submit" disabled={isSubmitting} className="app-primary-button min-w-32">{isSubmitting ? "جاري الحفظ..." : editingCustomer ? "حفظ التعديلات" : "إضافة العميل"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}
