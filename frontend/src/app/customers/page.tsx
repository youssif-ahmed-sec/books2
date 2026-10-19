"use client";

import { notifyError } from "@/lib/notifications";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { ZeroHintNumberInput } from "@/components/ZeroHintNumberInput";
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
type Customer = CustomerFormValues & { id: string; total_purchases: number; balance: number; purchase_count: number; average_purchase: number; last_purchase_date?: string; tags?: string[]; favorite_categories?: string[] };
type CustomerPayment = { id: string; amount: number; method: string; kind: string; created_at: string };
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
  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [orderHistory, setOrderHistory] = useState<CustomerOrder[]>([]);
  const [interactionChannel, setInteractionChannel] = useState("Phone Call");
  const [interactionNote, setInteractionNote] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [segmentTag, setSegmentTag] = useState("");
  const [segmentMin, setSegmentMin] = useState(0);
  const [segmentCustomers, setSegmentCustomers] = useState<Customer[]>([]);

  const { register, handleSubmit, reset, setValue, formState: { errors, isSubmitting } } = useForm<CustomerFormInput, unknown, CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customer_type: "Retail Customer",
      price_level: "Retail",
      credit_limit: "",
    }
  });

  const loadCustomers = async () => {
    try {
      const data = await fetchApi("/customers");
      setCustomers(data);
      setLoadError(false);
      writeSectionSnapshot("customers-list", data);
    } catch (err) {
      console.error("Failed to load customers:", err);
      setLoadError(true);
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
      await loadCustomers();
      setIsSlideoverOpen(false);
    } catch (err) {
      console.error("Failed to save customer:", err);
      notifyError("حدث خطأ أثناء الحفظ");
    }
  };

  const openPayment = async (customer: Customer) => {
    setPaymentCustomer(customer); setPaymentAmount(0); setPaymentError("");
    try { setPaymentHistory(await fetchApi(`/customers/${customer.id}/payments`)); }
    catch (error) { setPaymentError(errorMessage(error, "تعذر تحميل سجل المدفوعات")); }
  };

  const collectPayment = async () => {
    if (!paymentCustomer || paymentAmount <= 0 || paymentAmount > Number(paymentCustomer.balance)) return;
    setPaymentBusy(true); setPaymentError("");
    try {
      await fetchApi(`/customers/${paymentCustomer.id}/payments`, { method: "POST", body: JSON.stringify({ request_id: crypto.randomUUID(), amount: paymentAmount, method: paymentMethod }) });
      const [updatedCustomers, history] = await Promise.all([fetchApi("/customers"), fetchApi(`/customers/${paymentCustomer.id}/payments`)]);
      setCustomers(updatedCustomers); setPaymentHistory(history);
      setPaymentCustomer(updatedCustomers.find((customer: Customer) => customer.id === paymentCustomer.id) || null);
      setPaymentAmount(0);
    } catch (error) { setPaymentError(errorMessage(error, "تعذر تسجيل التحصيل")); }
    finally { setPaymentBusy(false); }
  };

  const openProfile = async (customer: Customer) => {
    setProfileCustomer(customer); setInteractionNote("");
    try {
      const [contact, orders] = await Promise.all([fetchApi(`/customers/${customer.id}/interactions`), fetchApi(`/customers/${customer.id}/orders`)]);
      setInteractions(contact); setOrderHistory(orders);
    } catch (error) { notifyError(errorMessage(error, "تعذر تحميل ملف العميل")); }
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

          {userRole === "ADMIN" && <section className="app-panel p-5 space-y-3"><h2 className="font-bold">قائمة تسويق محلية</h2><p className="app-muted text-sm">تصفية وتصدير بيانات العملاء فقط؛ لا تُرسل رسائل.</p><div className="flex flex-wrap gap-3"><input className="app-field" placeholder="وسم العميل" value={segmentTag} onChange={event => setSegmentTag(event.target.value)} /><ZeroHintNumberInput aria-label="أقل إجمالي مشتريات" className="app-field" min="0" value={segmentMin} onChange={event => setSegmentMin(Number(event.target.value) || 0)} /><button className="app-secondary-button" onClick={loadSegment}>عرض القائمة</button><button disabled={!segmentCustomers.length} className="app-secondary-button disabled:opacity-40" onClick={exportSegment}>تنزيل CSV ({segmentCustomers.length})</button></div></section>}

      {loadError && <p role="alert" className="app-panel rounded-xl border-red-500/30 p-4 text-sm text-red-300">تعذر تحديث العملاء. حاول تحديث الصفحة.</p>}
      <div className="app-panel overflow-hidden">
        <div className="divide-y divide-current/10 md:hidden">
          {loading && <p role="status" className="app-muted p-5 text-sm">جاري تحميل العملاء...</p>}
          {!loading && customers.map(c => <article key={c.id} data-search-id={c.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold" title={c.name}>{c.name}</h2><p className="app-muted mt-0.5 text-sm" dir="ltr">{c.phone}</p></div><span className="app-muted shrink-0 text-xs">{customerTypeLabels[c.customer_type] || c.customer_type}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span><span className="app-muted">المدينة: </span>{c.city || "—"}</span><span><span className="app-muted">المشتريات: </span>{Number(c.total_purchases).toLocaleString("ar-EG")} ج.م</span>{(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <span><span className="app-muted">المديونية: </span>{Number(c.balance || 0).toFixed(2)} / {Number(c.credit_limit || 0).toFixed(2)} ج.م</span>}</div>
            <div className="flex flex-wrap gap-2 border-t border-current/10 pt-3"><button onClick={() => openEdit(c)} className="app-secondary-button !rounded-lg !px-3 !py-2">تعديل</button><button onClick={() => openProfile(c)} className="app-secondary-button !rounded-lg !px-3 !py-2">ملف العميل</button>{(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <button onClick={() => openPayment(c)} className="app-secondary-button !rounded-lg !px-3 !py-2">سجل / تحصيل</button>}</div>
          </article>)}
          {!loading && !loadError && customers.length === 0 && <p className="app-muted p-6 text-center text-sm">لا يوجد عملاء مضافين بعد</p>}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-right text-sm">
            <thead className="app-table-head border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-medium">اسم العميل</th>
                <th className="px-4 py-3 font-medium">الهاتف</th>
                <th className="px-4 py-3 font-medium">النوع</th>
                <th className="px-4 py-3 font-medium">المدينة</th>
                <th className="px-4 py-3 font-medium">إجمالي المشتريات</th>
                {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <th className="px-4 py-3 font-medium">المديونية / الحد</th>}
                <th className="px-4 py-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="text-[#e5e2e1]">
              {loading && <LoadingTableRows label="جاري تحميل العملاء" columns={userRole === "ADMIN" || userRole === "CASHIER_ORDERS" ? 7 : 6} />}
              {!loading && customers.map((c) => (
                <tr key={c.id} data-search-id={c.id} className="app-table-row">
                  <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#e2bfb0]">
                      {customerTypeLabels[c.customer_type] || c.customer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.city || "-"}</td>
                  <td className="px-4 py-3">{Number(c.total_purchases).toLocaleString("ar-EG")} ج.م</td>
                  {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <td className="px-4 py-3">{Number(c.balance || 0).toFixed(2)} / {Number(c.credit_limit || 0).toFixed(2)} ج.م</td>}
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(c)}
                      className="text-primary hover:text-orange-300 text-xs font-bold"
                    >
                      تعديل
                    </button>
                    <button onClick={() => openProfile(c)} className="mr-4 text-xs font-bold text-blue-300">ملف العميل</button>
                    {(userRole === "ADMIN" || userRole === "CASHIER_ORDERS") && <button onClick={() => openPayment(c)} className="mr-4 text-xs font-bold text-emerald-400">سجل / تحصيل</button>}
                  </td>
                </tr>
              ))}
              {!loading && !loadError && customers.length === 0 && (
                <tr>
                  <td colSpan={userRole === "ADMIN" || userRole === "CASHIER_ORDERS" ? 7 : 6} className="app-muted px-4 py-8 text-center">
                    لا يوجد عملاء مضافين بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paymentCustomer && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
        <section className="w-full max-w-xl rounded-2xl bg-[#1c1b1b] p-6 text-white space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between"><h2 className="text-lg font-bold">مديونية {paymentCustomer.name}</h2><button onClick={() => setPaymentCustomer(null)}>إغلاق</button></div>
          <p>الرصيد المستحق: {Number(paymentCustomer.balance || 0).toFixed(2)} ج.م</p>
          {paymentError && <p role="alert" className="text-red-400">{paymentError}</p>}
          <div className="flex gap-3"><input aria-label="المبلغ المحصّل" type="number" min="0.01" max={paymentCustomer.balance} step="0.01" value={paymentAmount || ""} onChange={event => setPaymentAmount(Number(event.target.value) || 0)} className="app-field" />
            <select aria-label="وسيلة التحصيل" className="app-field" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)}>{["Cash", "Credit Card", "Vodafone Cash", "Instapay", "Bank Transfer"].map(method => <option key={method}>{method}</option>)}</select></div>
          <button disabled={paymentBusy || paymentAmount <= 0 || paymentAmount > Number(paymentCustomer.balance)} onClick={collectPayment} className="app-primary-button disabled:opacity-40">تسجيل التحصيل</button>
          <h3 className="font-bold">سجل المدفوعات</h3>
          <div className="space-y-2">{paymentHistory.map(payment => <p key={payment.id} className="border-b border-white/10 pb-2 text-sm">{payment.kind} — {Number(payment.amount).toFixed(2)} ج.م — {payment.method} — {new Date(payment.created_at).toLocaleString("ar-EG")}</p>)}</div>
        </section>
      </div>}

      {profileCustomer && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"><section className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#1c1b1b] p-6 space-y-5 text-white"><div className="flex justify-between"><h2 className="text-xl font-bold">ملف {profileCustomer.name}</h2><button onClick={() => setProfileCustomer(null)}>إغلاق</button></div>
        <div className="grid grid-cols-2 gap-3 text-sm"><p>عدد المشتريات: {profileCustomer.purchase_count}</p><p>القيمة: {Number(profileCustomer.total_purchases).toFixed(2)} ج.م</p><p>متوسط الطلب: {Number(profileCustomer.average_purchase).toFixed(2)} ج.م</p><p>آخر شراء: {profileCustomer.last_purchase_date ? new Date(profileCustomer.last_purchase_date).toLocaleDateString("ar-EG") : "لا يوجد"}</p><p>الوسوم: {(profileCustomer.tags || []).join("، ") || "—"}</p><p>الاهتمامات: {(profileCustomer.favorite_categories || []).join("، ") || "—"}</p></div>
        <div className="border-t border-white/10 pt-4 space-y-3"><h3 className="font-bold">تسجيل تواصل أو متابعة</h3><select className="app-field" value={interactionChannel} onChange={event => setInteractionChannel(event.target.value)}><option value="Phone Call">اتصال هاتفي</option><option value="In Person">زيارة</option><option value="Other">أخرى</option></select><textarea className="app-field" value={interactionNote} onChange={event => setInteractionNote(event.target.value)} placeholder="ملخص التواصل" /><label className="block text-sm">موعد متابعة اختياري</label><input type="datetime-local" className="app-field" value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} /><button className="app-primary-button" onClick={saveInteraction} disabled={interactionNote.trim().length < 2}>حفظ التواصل</button>{interactions.map(entry => <p key={entry.id} className="border-b border-white/10 pb-2 text-sm">{entry.channel} — {entry.note} — {new Date(entry.created_at).toLocaleString("ar-EG")}{entry.follow_up_at ? ` — متابعة ${new Date(entry.follow_up_at).toLocaleString("ar-EG")}` : ""}</p>)}</div>
        <div className="border-t border-white/10 pt-4 space-y-2"><h3 className="font-bold">تاريخ الطلبات</h3>{orderHistory.map(order => <p key={order.id} className="text-sm">طلب {order.public_number} — {order.status} — {Number(order.total_amount).toFixed(2)} ج.م — {new Date(order.created_at).toLocaleDateString("ar-EG")}</p>)}</div>
      </section></div>}

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
                    <div><label htmlFor="customer-type" className="customer-field-label">نوع العميل</label><select id="customer-type" {...register("customer_type", { onChange: event => {
                      const level = event.target.value === "Wholesale Customer" ? "Wholesale" : event.target.value === "Super Wholesale Customer" ? "Super Wholesale" : event.target.value === "VIP Customer" ? "VIP" : "Retail";
                      setValue("price_level", level);
                    } })} className="app-field">
                      <option value="Retail Customer">عميل تجزئة</option><option value="Student">طالب</option><option value="Teacher">مدرس</option><option value="School">مدرسة</option><option value="NURSERY">حضانة</option><option value="Speech Therapy Center">مركز تخاطب</option><option value="Wholesale Customer">عميل جملة</option><option value="Super Wholesale Customer">عميل سوبر جملة</option><option value="VIP Customer">عميل VIP</option>
                    </select>{errors.customer_type && <p role="alert" className="mt-1 text-xs text-red-400">{errors.customer_type.message}</p>}</div>
                    <div><label htmlFor="customer-city" className="customer-field-label">المدينة</label><input id="customer-city" {...register("city")} autoComplete="address-level2" className="app-field" /></div>
                  </div>
                </fieldset>
                {userRole === "ADMIN" && <fieldset className="customer-form-section grid gap-4 border-t border-current/10 pt-6 sm:grid-cols-2">
                  <legend className="text-sm font-bold">إعدادات البيع</legend>
                  <div><label htmlFor="customer-price-level" className="customer-field-label">مستوى السعر</label><select id="customer-price-level" {...register("price_level")} className="app-field"><option value="Retail">مستهلك</option><option value="Semi Wholesale">نصف جملة</option><option value="Wholesale">جملة</option><option value="Super Wholesale">سوبر جملة</option><option value="VIP">كبار العملاء</option></select></div>
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
