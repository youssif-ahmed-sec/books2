"use client";

import { useState, useEffect } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import AdminGate from "@/components/AdminGate";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface StaffUser { id: string; email: string; role: string; created_at: string }

export default function SettingsPage() {
  return <AdminGate><SettingsContent /></AdminGate>;
}

function SettingsContent() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("SALES_ASSISTANT");

  useEffect(() => {
    fetchApi("/auth/users")
      .then(setUsers)
      .catch((err) => setError(errorMessage(err, "فشل في تحميل المستخدمين")))
      .finally(() => setIsLoading(false));
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetchApi("/auth/users");
      setUsers(res);
    } catch (err) {
      setError(errorMessage(err, "فشل في تحميل المستخدمين (تأكد من صلاحياتك كمدير)"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      setEmail("");
      setPassword("");
      setRole("SALES_ASSISTANT");
      loadUsers();
    } catch (err) {
      alert(errorMessage(err, "فشل إنشاء المستخدم"));
    }
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1">
                <div className="app-panel p-6">
                  <h3 className="text-lg font-bold text-white mb-4">إضافة مستخدم جديد</h3>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label className="app-muted block text-xs font-medium mb-1">البريد الإلكتروني</label>
                      <input 
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="app-field"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="app-muted block text-xs font-medium mb-1">كلمة المرور</label>
                      <input 
                        type="password" 
                        required
                        minLength={12}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="app-field"
                        dir="ltr"
                      />
                      <p className="app-muted mt-1 text-xs">12 حرفًا على الأقل، وبحد أقصى 72 بايت.</p>
                    </div>
                    <div>
                      <label className="app-muted block text-xs font-medium mb-1">الصلاحية</label>
                      <select 
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="app-field"
                      >
                        <option value="ADMIN">مدير النظام</option>
                        <option value="CASHIER_ORDERS">كاشير والطلبات</option>
                        <option value="SENIOR_SALES">مبيعات أول</option>
                        <option value="INVENTORY_CONTROLLER">مسؤول المخزون</option>
                        <option value="SALES_ASSISTANT">مساعد مبيعات</option>
                      </select>
                    </div>
                    <button type="submit" className="app-primary-button w-full">
                      حفظ المستخدم
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="app-panel overflow-x-auto">
                  {error ? (
                    <div className="p-6 text-red-400 text-center">{error}</div>
                  ) : isLoading ? (
                    <div className="app-muted p-6 text-center">جاري التحميل...</div>
                  ) : (
                    <table className="w-full text-sm text-right text-[#e5e2e1]">
                      <thead className="app-table-head text-xs">
                        <tr>
                          <th className="px-6 py-4 font-medium">البريد الإلكتروني</th>
                          <th className="px-6 py-4 font-medium">الصلاحية</th>
                          <th className="px-6 py-4 font-medium">تاريخ الإنشاء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} className="app-table-row">
                            <td className="px-6 py-4 font-medium text-white" dir="ltr">{u.email}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs ${
                                u.role === "ADMIN" ? "bg-primary/10 text-primary" : "bg-white/5 text-[#e2bfb0]"
                              }`}>
                                {{ ADMIN: "مدير النظام", CASHIER_ORDERS: "كاشير والطلبات", SENIOR_SALES: "مبيعات أول", INVENTORY_CONTROLLER: "مسؤول المخزون", SALES_ASSISTANT: "مساعد مبيعات" }[u.role] || u.role}
                              </span>
                            </td>
                            <td className="px-6 py-4">{new Date(u.created_at).toLocaleDateString("ar-EG")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
        </div>
      </main>
    </div>
  );
}
