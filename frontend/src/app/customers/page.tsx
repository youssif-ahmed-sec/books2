"use client";

import { notifyError } from "@/lib/notifications";

import { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
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
type CustomerOrder = { id: string; status: string; total_amount: number; created_at: string };

export default function CustomersPage() {
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [customers, setCustomers] = useState<Customer[]>(() => readSectionSnapshot<Customer[]>("customers-list") || []);
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
      credit_limit: 0,
    }
  });

  const loadCustomers = async () => {
    try {
      const data = await fetchApi("/customers");
      setCustomers(data);
      writeSectionSnapshot("customers-list", data);
    } catch (err) {
      console.error("Failed to load customers:", err);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setUserRole(getUserRole()), 0);
    fetchApi("/customers").then((data: Customer[]) => { setCustomers(data); writeSectionSnapshot("customers-list", data); }).catch((err) => {
      console.error("Failed to load customers:", err);
    });
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
      credit_limit: 0,
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
      credit_limit: Number(customer.credit_limit || 0),
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
              <p className="app-subtitle">بيانات العملاء وتاريخ مشترياتهم</p>
            </div>
            <button
              onClick={openAdd}
              className="app-primary-button"
            >
              + إضافة عميل
            </button>
          </div>

          {userRole === "ADMIN" && <section className="app-panel p-5 space-y-3"><h2 className="font-bold">قائمة تسويق محلية</h2><p className="app-muted text-sm">تصفية وتصدير بيانات العملاء فقط؛ لا تُرسل رسائل.</p><div className="flex flex-wrap gap-3"><input className="app-field" placeholder="وسم العميل" value={segmentTag} onChange={event => setSegmentTag(event.target.value)} /><input aria-label="أقل إجمالي مشتريات" className="app-field" type="number" min="0" value={segmentMin} onChange={event => setSegmentMin(Number(event.target.value) || 0)} /><button className="app-secondary-button" onClick={loadSegment}>عرض القائمة</button><button disabled={!segmentCustomers.length} className="app-secondary-button disabled:opacity-40" onClick={exportSegment}>تنزيل CSV ({segmentCustomers.length})</button></div></section>}

      <div className="app-panel overflow-hidden">
        <div className="overflow-x-auto">
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
              {customers.map((c) => (
                <tr key={c.id} className="app-table-row">
                  <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3" dir="ltr">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#e2bfb0]">
                      {c.customer_type}
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
              {customers.length === 0 && (
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
        <div className="border-t border-white/10 pt-4 space-y-2"><h3 className="font-bold">تاريخ الطلبات</h3>{orderHistory.map(order => <p key={order.id} className="text-sm">#{order.id.slice(0, 8)} — {order.status} — {Number(order.total_amount).toFixed(2)} ج.م — {new Date(order.created_at).toLocaleDateString("ar-EG")}</p>)}</div>
      </section></div>}

      {isSlideoverOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsSlideoverOpen(false)}></div>
          <div className="relative w-full max-w-md bg-[#1c1b1b] h-full shadow-2xl border-r border-white/10 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">{editingCustomer ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</h2>
              <button type="button" aria-label="إغلاق" onClick={() => setIsSlideoverOpen(false)} className="app-muted hover:text-white transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">الاسم <span className="text-red-500">*</span></label>
                <input {...register("name")} className="app-field" />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">رقم الهاتف <span className="text-red-500">*</span></label>
                <input {...register("phone")} className="app-field" />
                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">رقم الواتساب</label>
                <input {...register("whatsapp_number")} className="app-field" />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">نوع العميل</label>
                <select {...register("customer_type", { onChange: event => {
                  const level = event.target.value === "Wholesale Customer" ? "Wholesale" : event.target.value === "Super Wholesale Customer" ? "Super Wholesale" : event.target.value === "VIP Customer" ? "VIP" : "Retail";
                  setValue("price_level", level);
                } })} className="app-field">
                  <option value="Retail Customer">عميل تجزئة</option>
                  <option value="Student">طالب</option><option value="Teacher">مدرس</option><option value="School">مدرسة</option><option value="NURSERY">حضانة</option><option value="Speech Therapy Center">مركز تخاطب</option>
                  <option value="Wholesale Customer">عميل جملة</option>
                  <option value="Super Wholesale Customer">عميل سوبر جملة</option>
                  <option value="VIP Customer">عميل VIP</option>
                </select>
                {errors.customer_type && <p className="text-red-500 text-xs mt-1">{errors.customer_type.message}</p>}
              </div>

              {userRole === "ADMIN" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#e2bfb0] mb-1">مستوى السعر التلقائي</label>
                    <select {...register("price_level")} className="app-field">
                      <option value="Retail">مستهلك</option>
                      <option value="Semi Wholesale">نصف جملة</option>
                      <option value="Wholesale">جملة</option>
                      <option value="Super Wholesale">سوبر جملة</option>
                      <option value="VIP">كبار العملاء</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#e2bfb0] mb-1">الحد الائتماني (ج.م)</label>
                    <input type="number" min="0" step="0.01" {...register("credit_limit")} className="app-field" />
                    {errors.credit_limit && <p className="text-red-500 text-xs mt-1">{errors.credit_limit.message}</p>}
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">المدينة</label>
                <input {...register("city")} className="app-field" />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">البريد الإلكتروني</label>
                <input {...register("email")} className="app-field" />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e2bfb0] mb-1">ملاحظات</label>
                <textarea {...register("notes")} className="app-field" rows={3}></textarea>
              </div>
              <div><label className="block text-sm font-medium text-[#e2bfb0] mb-1">وسوم العميل (مفصولة بفواصل)</label><input {...register("tagsText")} className="app-field" /></div>
              <div><label className="block text-sm font-medium text-[#e2bfb0] mb-1">الاهتمامات / التصنيفات المفضلة</label><input {...register("interestsText")} className="app-field" /></div>

              <div className="pt-4 border-t border-white/10 mt-6">
                <button type="submit" disabled={isSubmitting} className="app-primary-button w-full">
                  {isSubmitting ? "جاري الحفظ..." : "حفظ العميل"}
                </button>
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
