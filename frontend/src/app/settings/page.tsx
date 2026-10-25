"use client";

import { notifyError, notifySuccess } from "@/lib/notifications";

import { useState, useEffect } from "react";
import AdminGate from "@/components/AdminGate";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { ProductSelect } from "@/components/ProductSelect";
import { useConfirmAction } from "@/components/ConfirmationProvider";
import { getCurrentUser } from "@/lib/currentUser";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

interface StaffUser { id: string; email: string | null; username: string | null; full_name: string | null; role: string; is_active: boolean; created_at: string }
interface ShiftEmailReport { shift_id: string; recipient_email: string; status: string; attempts: number; created_at: string; sent_at: string | null }
const roles = [
  { value: "ADMIN", label: "مدير النظام" },
  { value: "CASHIER_ORDERS", label: "كاشير والطلبات" },
  { value: "INVENTORY_CONTROLLER", label: "مسؤول المخزون" },
];
const roleLabel = (role: string) => roles.find(option => option.value === role)?.label || "دور قديم — يحتاج إعادة تعيين";
const accountStatus = (user: StaffUser) => !roles.some(option => option.value === user.role) ? "الدخول موقوف حتى تغيير الدور" : user.is_active ? "نشط" : "موقوف";

function StatusToggle({ user, disabled, onToggle }: { user: StaffUser; disabled: boolean; onToggle: () => void }) {
  return <div className="flex items-center gap-2">
    <button type="button" role="switch" aria-checked={user.is_active} aria-label={`تفعيل حساب ${user.full_name || user.username || user.email || "المستخدم"}`} disabled={disabled} onClick={onToggle} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 ${user.is_active ? "bg-emerald-500" : "bg-white/20"}`}>
      <span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${user.is_active ? "right-6" : "right-1"}`} />
    </button>
    <span className="app-muted text-xs">{accountStatus(user)}</span>
  </div>;
}

export default function SettingsPage() {
  return <AdminGate><SettingsContent /></AdminGate>;
}

function SettingsContent() {
  const confirmAction = useConfirmAction();
  const [users, setUsers] = useState<StaffUser[]>(() => readSectionSnapshot<StaffUser[]>("settings-users") || []);
  const [isLoading, setIsLoading] = useState(() => !readSectionSnapshot<StaffUser[]>("settings-users"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [gmailConfigured, setGmailConfigured] = useState<boolean | null>(null);
  const [gmailError, setGmailError] = useState(false);
  const [testingGmail, setTestingGmail] = useState(false);
  const [reportRecipient, setReportRecipient] = useState("");
  const [savedRecipient, setSavedRecipient] = useState("");
  const [recipientBusy, setRecipientBusy] = useState(false);
  const [emailReports, setEmailReports] = useState<ShiftEmailReport[]>([]);
  const [reportError, setReportError] = useState(false);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CASHIER_ORDERS");

  useEffect(() => {
    fetchApi("/auth/users")
      .then((response: StaffUser[]) => { setUsers(response); writeSectionSnapshot("settings-users", response); })
      .catch((err) => setError(errorMessage(err, "فشل في تحميل المستخدمين")))
      .finally(() => setIsLoading(false));
    getCurrentUser().then(user => setCurrentUserId(user.id)).catch(() => {});
    fetchApi("/notifications/email/status", { silentErrors: true })
      .then((status: { configured: boolean }) => setGmailConfigured(status.configured))
      .catch(() => setGmailError(true));
    fetchApi("/cash-register/email-recipient", { silentErrors: true })
      .then((setting: { email: string | null }) => { setReportRecipient(setting.email || ""); setSavedRecipient(setting.email || ""); })
      .catch(() => setReportError(true));
    fetchApi("/cash-register/email-reports", { silentErrors: true })
      .then((reports: ShiftEmailReport[]) => setEmailReports(reports))
      .catch(() => setReportError(true));
  }, []);

  const saveReportRecipient = async () => {
    if (recipientBusy) return;
    setRecipientBusy(true);
    try {
      const email = reportRecipient.trim().toLowerCase() || null;
      await fetchApi("/cash-register/email-recipient", { method: "PUT", body: JSON.stringify({ email }), silentErrors: true });
      setSavedRecipient(email || "");
      setReportRecipient(email || "");
      setReportError(false);
      notifySuccess(email ? "تم حفظ بريد ملخص الوردية" : "تم إيقاف إرسال ملخص الوردية");
    } catch (cause) { notifyError(errorMessage(cause, "تعذر حفظ بريد الملخص")); }
    finally { setRecipientBusy(false); }
  };

  const refreshEmailReports = async () => {
    try {
      setEmailReports(await fetchApi("/cash-register/email-reports", { silentErrors: true }));
      setReportError(false);
    } catch { setReportError(true); }
  };

  const retryEmailReport = async (shiftId: string) => {
    if (!await confirmAction({ title: "إعادة إرسال ملخص الوردية؟", message: "تأكد من عدم وصول الملخص إلى البريد أولًا؛ فقد ينتج عن انقطاع الاتصال نسخة مكررة.", confirmLabel: "إعادة الإرسال" })) return;
    try {
      const result = await fetchApi(`/cash-register/email-reports/${shiftId}/retry`, { method: "POST", invalidateSnapshots: false, silentErrors: true }) as { status: string };
      await refreshEmailReports();
      if (result.status === "SENT") notifySuccess("قبل Gmail ملخص الوردية للإرسال.");
      else notifyError("تعذر إرسال الملخص. راجع إعداد Gmail وحاول مجددًا.");
    } catch (cause) { notifyError(errorMessage(cause, "تعذر إعادة إرسال الملخص")); }
  };

  const testGmail = async () => {
    if (testingGmail) return;
    setTestingGmail(true);
    try {
      await fetchApi("/notifications/email/test", { method: "POST", invalidateSnapshots: false, silentErrors: true });
      notifySuccess("قبل Gmail رسالة الاختبار المرسلة إلى بريد حسابك الإداري.");
    } catch (cause) { notifyError(errorMessage(cause, "تعذر إرسال رسالة الاختبار")); }
    finally { setTestingGmail(false); }
  };

  const loadUsers = async () => {
    if (users.length === 0) setIsLoading(true);
    setError("");
    try {
      const res = await fetchApi("/auth/users");
      setUsers(res);
      writeSectionSnapshot("settings-users", res);
    } catch (err) {
      setError(errorMessage(err, "فشل في تحميل المستخدمين (تأكد من صلاحياتك كمدير)"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!role) { notifyError("اختر صلاحية المستخدم"); return; }
    setBusy(true);
    try {
      await fetchApi(editing ? `/auth/users/${editing.id}` : "/auth/register", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() || null, username: username.trim(), full_name: fullName.trim(), role, ...(!editing || password ? { password } : {}) }),
      });
      setEmail("");
      setUsername("");
      setFullName("");
      setPassword("");
      setRole("CASHIER_ORDERS");
      setEditing(null);
      notifySuccess(editing ? "تم تحديث المستخدم" : "تم إضافة المستخدم");
      await loadUsers();
    } catch (err) {
      notifyError(errorMessage(err, "تعذر حفظ المستخدم"));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (user: StaffUser) => {
    setEditing(user);
    setEmail(user.email || "");
    setUsername(user.username || "");
    setFullName(user.full_name || "");
    setPassword("");
      setRole(roles.some(option => option.value === user.role) ? user.role : "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleStatus = async (user: StaffUser) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetchApi(`/auth/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !user.is_active }) });
      notifySuccess(user.is_active ? "تم إيقاف الحساب" : "تم تفعيل الحساب");
      await loadUsers();
    } catch (err) {
      notifyError(errorMessage(err, "تعذر تغيير حالة المستخدم"));
    } finally { setBusy(false); }
  };

  const deleteUser = async (user: StaffUser) => {
    if (busy || !(await confirmAction({ title: "حذف الحساب؟", message: `سيُحذف حساب ${user.full_name || user.username || user.email} من القائمة، مع بقاء سجل عملياته محفوظًا.`, confirmLabel: "حذف الحساب", tone: "danger" }))) return;
    setBusy(true);
    try {
      await fetchApi(`/auth/users/${user.id}`, { method: "DELETE" });
      if (editing?.id === user.id) { setEditing(null); setEmail(""); setUsername(""); setFullName(""); setPassword(""); }
      notifySuccess("تم حذف الحساب من القائمة");
      await loadUsers();
    } catch (err) {
      notifyError(errorMessage(err, "تعذر حذف المستخدم"));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen" dir="rtl">


      <main className="app-main">
        <div className="space-y-6">
          <div>
            <h1 className="app-heading">إدارة المستخدمين</h1>
          </div>

          <section className="app-panel space-y-3 rounded-2xl p-5" aria-label="إعداد Gmail للإرسال">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">بريد Gmail للإرسال</h2><p className="app-muted text-sm">اضبط GMAIL_ADDRESS وGMAIL_APP_PASSWORD في بيئة الخادم، ثم أعد تشغيله.</p></div><span className={`rounded-full px-3 py-1 text-xs ${gmailConfigured ? "bg-emerald-500/10 text-emerald-300" : "bg-white/10 app-muted"}`}>{gmailError ? "تعذر فحص الإعداد" : gmailConfigured === null ? "جارٍ الفحص" : gmailConfigured ? "بيانات الاتصال موجودة" : "غير مُعد"}</span></div>
            <p className="app-muted text-xs">استخدم كلمة مرور تطبيق من Google بعد تفعيل التحقق بخطوتين. لا تضع كلمة مرور حساب Gmail المعتادة أو كلمة المرور داخل هذه الصفحة.</p>
            <button type="button" className="app-secondary-button disabled:opacity-40" disabled={!gmailConfigured || testingGmail} onClick={() => void testGmail()}>{testingGmail ? "جارٍ إرسال رسالة الاختبار..." : "إرسال رسالة اختبار إلى بريدي"}</button>
          </section>

          <section className="app-panel space-y-4 rounded-2xl p-5" aria-label="ملخص الوردية بالبريد">
            <div><h2 className="font-bold">ملخص الوردية بالبريد</h2><p className="app-muted text-sm">يُرسل عند إغلاق كل وردية إلى البريد الذي تحدده هنا. يتضمن النقدية المتوقعة والمعدودة والفرق والمبيعات والتحصيلات والمرتجعات والحركات اليدوية للوردية.</p></div>
            <div className="flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 text-sm">البريد المستلم<input type="email" className="app-field mt-1" dir="ltr" value={reportRecipient} onChange={event => setReportRecipient(event.target.value)} placeholder="manager@example.com" /></label><button type="button" className="app-primary-button disabled:opacity-40" disabled={recipientBusy || reportRecipient.trim() === savedRecipient} onClick={() => void saveReportRecipient()}>{recipientBusy ? "جارٍ الحفظ..." : "حفظ البريد"}</button></div>
            <p className="app-muted text-xs">ترك الحقل فارغًا ثم الحفظ يوقف إرسال الملخصات الجديدة. تبقى تقارير الورديات السابقة محفوظة.</p>
            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4"><h3 className="text-sm font-bold">حالة آخر الملخصات</h3><button type="button" className="text-sm text-primary underline" onClick={() => void refreshEmailReports()}>تحديث</button></div>
            {reportError && <p role="alert" className="text-sm text-red-300">تعذر تحميل إعداد الملخص أو حالاته. حاول تحديث الصفحة.</p>}
            {emailReports.length === 0 ? <p className="app-muted text-sm">لا توجد ملخصات مرسلة بعد.</p> : <div className="max-h-64 space-y-2 overflow-y-auto">{emailReports.map(report => <div key={report.shift_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm"><div><strong>{new Date(report.created_at).toLocaleString("ar-EG")}</strong><p className="app-muted text-xs" dir="ltr">{report.recipient_email}</p></div><div className="flex items-center gap-2"><span className={report.status === "SENT" ? "text-emerald-300" : report.status === "FAILED" ? "text-red-300" : "app-muted"}>{report.status === "SENT" ? "قبله Gmail" : report.status === "FAILED" ? "فشل الإرسال" : "بانتظار الإرسال"}</span>{report.status !== "SENT" && <button type="button" className="text-primary underline" onClick={() => void retryEmailReport(report.shift_id)}>إعادة الإرسال</button>}</div></div>)}</div>}
          </section>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] gap-6">
              <div>
                <div className="app-panel max-w-[40rem] p-5 sm:p-6 2xl:max-w-none">
                  <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{editing ? "تعديل المستخدم" : "إضافة مستخدم جديد"}</h2>{editing && <button type="button" onClick={() => { setEditing(null); setEmail(""); setUsername(""); setFullName(""); setPassword(""); setRole("CASHIER_ORDERS"); }} className="app-muted text-sm hover:text-primary">إلغاء</button>}</div>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label htmlFor="staff-full-name" className="block text-sm font-semibold mb-2">الاسم بالعربي</label>
                      <input id="staff-full-name" type="text" required minLength={2} maxLength={100} value={fullName} onChange={event => setFullName(event.target.value)} className="app-field" dir="rtl" placeholder="اسم الموظف كما يظهر في الفواتير" />
                    </div>
                    <div>
                      <label htmlFor="staff-username" className="block text-sm font-semibold mb-2">اسم المستخدم</label>
                      <input
                        id="staff-username"
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="app-field"
                        dir="ltr"
                        pattern="[a-zA-Z0-9._-]{3,50}"
                        title="من 3 إلى 50 حرفًا إنجليزيًا أو رقمًا أو . _ -"
                      />
                    </div>
                    <div>
                      <label htmlFor="staff-email" className="block text-sm font-semibold mb-2">البريد الإلكتروني <span className="app-muted font-normal">(اختياري)</span></label>
                      <input id="staff-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="app-field text-left" dir="ltr" />
                      <p className="app-muted mt-1.5 text-xs">يمكن تسجيل الدخول بالبريد الإلكتروني أو اسم المستخدم.</p>
                    </div>
                    <div>
                      <label htmlFor="staff-password" className="block text-sm font-semibold mb-2">كلمة المرور {editing && <span className="app-muted font-normal">(اتركها فارغة للاحتفاظ بها)</span>}</label>
                      <input
                        id="staff-password"
                        type="password"
                        required={!editing}
                        minLength={12}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="app-field"
                        dir="ltr"
                      />
                      <p className="app-muted mt-1 text-xs">12 حرفًا على الأقل، وبحد أقصى 72 بايت.</p>
                    </div>
                    <div>
                      <span className="block text-sm font-semibold mb-2">الصلاحية</span>
                      <ProductSelect label="صلاحية المستخدم" value={role} onChange={setRole} options={roles} placeholder="اختر الصلاحية" compact />
                    </div>
                    <button type="submit" disabled={busy} className="app-primary-button w-full disabled:opacity-50">
                      {busy ? "جاري الحفظ..." : editing ? "حفظ التعديلات" : "إضافة المستخدم"}
                    </button>
                  </form>
                </div>
              </div>

              <div className="min-w-0">
                <div className="app-panel overflow-hidden">
                  <div className="flex items-center justify-between border-b border-white/10 p-5"><div><h2 className="text-lg font-bold">المستخدمون</h2></div><button type="button" className="app-secondary-button" onClick={() => void loadUsers()}><span className="material-symbols-outlined text-lg">refresh</span>تحديث</button></div>
                  {error ? (
                    <div role="alert" className="p-6 text-red-400 text-center">{error}</div>
                  ) : isLoading ? (
                    <div className="space-y-3 p-5" aria-label="جاري تحميل المستخدمين">{[1, 2, 3].map(row => <div key={row} className="app-skeleton h-16 w-full rounded-xl" />)}</div>
                  ) : users.length === 0 ? (
                    <p className="app-muted p-8 text-center">لا يوجد مستخدمون بعد.</p>
                  ) : (
                    <><div className="hidden overflow-x-auto custom-scrollbar 2xl:block"><table className="w-full min-w-[760px] text-sm text-right text-[#e5e2e1]">
                      <thead className="app-table-head text-sm">
                        <tr>
                          <th className="px-5 py-4 font-semibold">المستخدم</th>
                          <th className="px-6 py-4 font-medium">الصلاحية</th>
                          <th className="px-6 py-4 font-medium">الحالة</th>
                          <th className="px-6 py-4 font-medium">تاريخ الإنشاء</th>
                          <th className="px-5 py-4 font-semibold">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} data-search-id={u.id} className="app-table-row align-middle">
                            <td className="px-5 py-4"><div className="font-semibold">{u.full_name || <span className="text-amber-400">الاسم العربي مطلوب</span>}</div><div className="app-muted mt-1 text-xs" dir="ltr">{u.username || u.email}</div>{u.username && u.email && <div className="app-muted mt-1 text-xs" dir="ltr">{u.email}</div>}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs ${
                                u.role === "ADMIN" ? "bg-primary/10 text-primary" : "bg-white/5 text-[#e2bfb0]"
                              }`}>
                                {roleLabel(u.role)}
                              </span>
                            </td>
                            <td className="px-6 py-4"><StatusToggle user={u} disabled={busy || u.id === currentUserId || (!u.is_active && (!u.full_name || !roles.some(option => option.value === u.role)))} onToggle={() => void toggleStatus(u)} /></td>
                            <td className="px-6 py-4">{new Date(u.created_at).toLocaleDateString("ar-EG")}</td>
                            <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => startEdit(u)} className="app-secondary-button px-3 py-2 text-xs">تعديل</button><button type="button" disabled={busy || u.id === currentUserId} title={u.id === currentUserId ? "لا يمكنك حذف حسابك الحالي" : undefined} onClick={() => void deleteUser(u)} className="rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">حذف</button></div>{u.id === currentUserId && <p className="app-muted mt-2 text-xs">لا يمكن إلغاء تفعيل حسابك الحالي أو حذفه.</p>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                    <div className="divide-y divide-white/10 2xl:hidden">{users.map(user => <article key={user.id} data-search-id={user.id} className="space-y-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold">{user.full_name || <span className="text-amber-400">الاسم العربي مطلوب</span>}</p><p className="app-muted mt-1 break-all text-xs" dir="ltr">{user.username || user.email}</p>{user.username && user.email && <p className="app-muted mt-1 text-xs" dir="ltr">{user.email}</p>}</div><StatusToggle user={user} disabled={busy || user.id === currentUserId || (!user.is_active && (!user.full_name || !roles.some(option => option.value === user.role)))} onToggle={() => void toggleStatus(user)} /></div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="text-primary">{roleLabel(user.role)}</span><span className="app-muted text-xs">{new Date(user.created_at).toLocaleDateString("ar-EG")}</span></div>
                      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => startEdit(user)} className="app-secondary-button px-3 py-2 text-xs">تعديل</button><button type="button" disabled={busy || user.id === currentUserId} title={user.id === currentUserId ? "لا يمكنك حذف حسابك الحالي" : undefined} onClick={() => void deleteUser(user)} className="rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">حذف</button></div>
                      {user.id === currentUserId && <p className="app-muted text-xs">لا يمكن إلغاء تفعيل حسابك الحالي أو حذفه.</p>}
                    </article>)}</div></>
                  )}
                </div>
              </div>
            </div>
        </div>
      </main>
    </div>
  );
}
