"use client";
import { useEffect, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Entry = { id: string; user_id: string; action: string; entity_type: string | null; entity_id: string | null; old_value: unknown; new_value: unknown; created_at: string };

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => { fetchApi(`/audit?offset=${offset}&limit=100`).then(setEntries).catch(error => setMessage(errorMessage(error, "تعذر تحميل سجل التدقيق"))); }, [offset]);
  return <div className="min-h-screen bg-[#131313] text-white flex" dir="rtl"><SideNav /><TopNav title="سجل التدقيق" /><main className="mx-4 mt-28 mb-8 flex-1 min-w-0 lg:mr-[364px] lg:mt-36 space-y-5"><h1 className="text-2xl font-bold">سجل العمليات</h1>{message && <p role="alert">{message}</p>}<div className="glass rounded-2xl overflow-x-auto"><table className="w-full text-sm text-right"><thead><tr><th className="p-4">التاريخ</th><th className="p-4">العملية</th><th className="p-4">المستخدم</th><th className="p-4">السجل</th><th className="p-4">التفاصيل</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className="border-t border-white/10"><td className="p-4">{new Date(entry.created_at).toLocaleString("ar-EG")}</td><td className="p-4">{entry.action}</td><td className="p-4 font-mono text-xs">{entry.user_id.slice(0, 8)}</td><td className="p-4">{entry.entity_type} #{entry.entity_id?.slice(0, 8)}</td><td className="p-4 text-xs"><details><summary className="cursor-pointer">عرض</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ before: entry.old_value, after: entry.new_value }, null, 2)}</pre></details></td></tr>)}</tbody></table></div><div className="flex gap-3"><button className="app-secondary-button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 100))}>السابق</button><button className="app-secondary-button" disabled={entries.length < 100} onClick={() => setOffset(offset + 100)}>التالي</button></div></main></div>;
}
