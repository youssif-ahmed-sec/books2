"use client";

import { notifyError, notifySuccess } from "@/lib/notifications";

import { useState, useEffect } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import AdminGate from "@/components/AdminGate";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { ProductSelect } from "@/components/ProductSelect";
import { getCurrentUser } from "@/lib/currentUser";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";

interface StaffUser { id: string; email: string; username: string | null; role: string; is_active: boolean; created_at: string }
const roles = [
  { value: "ADMIN", label: "مدير النظام" },
  { value: "CASHIER_ORDERS", label: "كاشير والطلبات" },
  { value: "SENIOR_SALES", label: "مبيعات أول" },
  { value: "INVENTORY_CONTROLLER", label: "مسؤول المخزون" },
  { value: "SALES_ASSISTANT", label: "مساعد مبيعات" },
];

export default function SettingsPage() {
  return <AdminGate><SettingsContent /></AdminGate>;
}

function SettingsContent() {
  const [users, setUsers] = useState<StaffUser[]>(() => readSectionSnapshot<StaffUser[]>("settings-users") || []);
  const [isLoading, setIsLoading] = useState(() => !readSectionSnapshot<StaffUser[]>("settings-users"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("SALES_ASSISTANT");

  useEffect(() => {
    fetchApi("/auth/users")
      .then((response: StaffUser[]) => { setUsers(response); writeSectionSnapshot("settings-users", response); })
      .catch((err) => setError(errorMessage(err, "فشل في تحميل المستخدمين")))
      .finally(() => setIsLoading(false));
    getCurrentUser().then(user => setCurrentUserId(user.id)).catch(() => {});
  }, []);

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
        body: JSON.stringify({ email: email.trim().toLowerCase(), username: username.trim() || null, role, ...(!editing || password ? { password } : {}) }),
      });
      setEmail("");
      setUsername("");
      setPassword("");
      setRole("SALES_ASSISTANT");
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
    setEmail(user.email);
    setUsername(user.username || "");
    setPassword("");
    setRole(user.role);
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
    if (busy || !window.confirm(`حذف حساب ${user.email} من القائمة؟ سيبقى سجل عملياته محفوظًا.`)) return;
    setBusy(true);
    try {
      await fetchApi(`/auth/users/${user.id}`, { method: "DELETE" });
      if (editing?.id === user.id) { setEditing(null); setEmail(""); setUsername(""); setPassword(""); }
      notifySuccess("تم حذف الحساب من القائمة");
      await loadUsers();
    } catch (err) {
      notifyError(errorMessage(err, "تعذر حذف المستخدم"));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="الإعدادات" />
      <main className="app-main">
        <div className="space-y-6">
          <div>
            <h1 className="app-heading">إدارة المستخدمين</h1>
            <p className="app-subtitle">حسابات الفريق وصلاحيات الدخول</p>
          </div>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] gap-6">
              <div>
                <div className="app-panel max-w-[40rem] p-5 sm:p-6 2xl:max-w-none">
                  <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{editing ? "تعديل المستخدم" : "إضافة مستخدم جديد"}</h2>{editing && <button type="button" onClick={() => { setEditing(null); setEmail(""); setUsername(""); setPassword(""); setRole("SALES_ASSISTANT"); }} className="app-muted text-sm hover:text-primary">إلغاء</button>}</div>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label htmlFor="staff-email" className="block text-sm font-semibold mb-2">البريد الإلكتروني</label>
                      <input 
                        id="staff-email"
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="app-field"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label htmlFor="staff-username" className="block text-sm font-semibold mb-2">اسم المستخدم <span className="app-muted font-normal">(اختياري)</span></label>
                      <input id="staff-username" type="text" value={username} onChange={e => setUsername(e.target.value)} className="app-field text-left" dir="ltr" pattern="[a-zA-Z0-9._-]{3,50}" title="من 3 إلى 50 حرفًا إنجليزيًا أو رقمًا أو . _ -" />
                      <p className="app-muted mt-1.5 text-xs">يمكن الدخول بالبريد أو باسم المستخدم.</p>
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
                  <div className="flex items-center justify-between border-b border-white/10 p-5"><div><h2 className="text-lg font-bold">المستخدمون</h2><p className="app-muted mt-1 text-sm">{users.length} حساب</p></div><button type="button" className="app-secondary-button" onClick={() => void loadUsers()}><span className="material-symbols-outlined text-lg">refresh</span>تحديث</button></div>
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
                          <tr key={u.id} className="app-table-row align-middle">
                            <td className="px-5 py-4"><div className="font-semibold" dir="ltr">{u.email}</div>{u.username && <div className="app-muted mt-1 text-xs" dir="ltr">@{u.username}</div>}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs ${
                                u.role === "ADMIN" ? "bg-primary/10 text-primary" : "bg-white/5 text-[#e2bfb0]"
                              }`}>
                                {roles.find(role => role.value === u.role)?.label || u.role}
                              </span>
                            </td>
                            <td className="px-6 py-4"><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${u.is_active ? "bg-emerald-500/10 text-emerald-400" : "bg-white/10 app-muted"}`}>{u.is_active ? "نشط" : "موقوف"}</span></td>
                            <td className="px-6 py-4">{new Date(u.created_at).toLocaleDateString("ar-EG")}</td>
                            <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => startEdit(u)} className="app-secondary-button px-3 py-2 text-xs">تعديل</button><button type="button" disabled={busy || u.id === currentUserId} title={u.id === currentUserId ? "لا يمكنك إلغاء تفعيل حسابك الحالي" : undefined} onClick={() => void toggleStatus(u)} className="app-secondary-button px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">{u.is_active ? "إلغاء التفعيل" : "تفعيل"}</button><button type="button" disabled={busy || u.id === currentUserId} title={u.id === currentUserId ? "لا يمكنك حذف حسابك الحالي" : undefined} onClick={() => void deleteUser(u)} className="rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">حذف</button></div>{u.id === currentUserId && <p className="app-muted mt-2 text-xs">لا يمكن إلغاء تفعيل حسابك الحالي أو حذفه.</p>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                    <div className="divide-y divide-white/10 2xl:hidden">{users.map(user => <article key={user.id} className="space-y-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-all font-semibold" dir="ltr">{user.email}</p>{user.username && <p className="app-muted mt-1 text-xs" dir="ltr">@{user.username}</p>}</div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.is_active ? "bg-emerald-500/10 text-emerald-400" : "bg-white/10 app-muted"}`}>{user.is_active ? "نشط" : "موقوف"}</span></div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="text-primary">{roles.find(item => item.value === user.role)?.label || user.role}</span><span className="app-muted text-xs">{new Date(user.created_at).toLocaleDateString("ar-EG")}</span></div>
                      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => startEdit(user)} className="app-secondary-button px-3 py-2 text-xs">تعديل</button><button type="button" disabled={busy || user.id === currentUserId} title={user.id === currentUserId ? "لا يمكنك إلغاء تفعيل حسابك الحالي" : undefined} onClick={() => void toggleStatus(user)} className="app-secondary-button px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">{user.is_active ? "إلغاء التفعيل" : "تفعيل"}</button><button type="button" disabled={busy || user.id === currentUserId} title={user.id === currentUserId ? "لا يمكنك حذف حسابك الحالي" : undefined} onClick={() => void deleteUser(user)} className="rounded-xl border border-red-500/20 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40">حذف</button></div>
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
