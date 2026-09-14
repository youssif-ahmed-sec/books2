"use client";

import { useState, useEffect } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"users">("users");
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("SALES_ASSISTANT");

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetchApi("/auth/users");
      setUsers(res);
    } catch (err: any) {
      setError(err.message || "فشل في تحميل المستخدمين (تأكد من صلاحياتك كمدير)");
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
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="min-h-screen" dir="rtl">
      <SideNav />
      <TopNav title="الإعدادات" />
      <main className="mr-[352px] pt-28 pb-8 px-8">
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">الإعدادات</h1>
            <p className="text-sm text-zinc-400 mt-1">إدارة المستخدمين وصلاحيات النظام</p>
          </div>

          <div className="flex space-x-4 border-b border-zinc-800 rtl:space-x-reverse">
            <button
              onClick={() => setActiveTab("users")}
              className={`pb-4 px-2 text-sm font-medium transition-colors border-b-2 ${
                activeTab === "users"
                  ? "border-primary text-primary"
                  : "border-transparent text-zinc-400 hover:text-white"
              }`}
            >
              إدارة المستخدمين
            </button>
          </div>

          {activeTab === "users" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-white mb-4">إضافة مستخدم جديد</h3>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">البريد الإلكتروني</label>
                      <input 
                        type="email" 
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">كلمة المرور</label>
                      <input 
                        type="password" 
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">الصلاحية (Role)</label>
                      <select 
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                      >
                        <option value="ADMIN">مدير النظام (Admin)</option>
                        <option value="CASHIER_ORDERS">كاشير وأونلاين (Cashier & Orders)</option>
                        <option value="SENIOR_SALES">مبيعات أول (Senior Sales)</option>
                        <option value="INVENTORY_CONTROLLER">أمين مخزن (Inventory Controller)</option>
                        <option value="SALES_ASSISTANT">مساعد مبيعات (Sales Assistant)</option>
                      </select>
                    </div>
                    <button type="submit" className="w-full bg-primary hover:brightness-110 text-white font-bold py-2 rounded-lg transition-all">
                      حفظ المستخدم
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  {error ? (
                    <div className="p-6 text-red-400 text-center">{error}</div>
                  ) : isLoading ? (
                    <div className="p-6 text-zinc-400 text-center">جاري التحميل...</div>
                  ) : (
                    <table className="w-full text-sm text-right text-zinc-300">
                      <thead className="text-xs text-zinc-400 bg-zinc-800/50 uppercase">
                        <tr>
                          <th className="px-6 py-4 font-medium">البريد الإلكتروني</th>
                          <th className="px-6 py-4 font-medium">الصلاحية</th>
                          <th className="px-6 py-4 font-medium">تاريخ الإنشاء</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-4 font-medium text-white" dir="ltr">{u.email}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs ${
                                u.role === "ADMIN" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"
                              }`}>
                                {u.role}
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
          )}
        </div>
      </main>
    </div>
  );
}
