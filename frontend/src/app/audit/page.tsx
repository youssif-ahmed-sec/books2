"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { LoadingTableRows } from "@/components/LoadingState";
import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, writeSectionSnapshot } from "@/lib/sectionSnapshot";
import { errorMessage } from "@/lib/errors";
import { useSectionSearchSelection } from "@/lib/useSectionSearchSelection";

type Entry = { id: string; user_id: string; user_name: string | null; action: string; entity_type: string | null; entity_id: string | null; old_value: unknown; new_value: unknown; created_at: string };

export default function AuditPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>(() => readSectionSnapshot<{ entries: Entry[] }>("audit")?.entries || []);
  const [loading, setLoading] = useState(() => !readSectionSnapshot("audit"));
  const [offset, setOffset] = useState(() => readSectionSnapshot<{ offset: number }>("audit")?.offset || 0);
  const [focusedId, setFocusedId] = useState("");
  const [message, setMessage] = useState("");

  useSectionSearchSelection(id => { setLoading(true); setFocusedId(id); setOffset(0); });
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ offset: String(offset), limit: focusedId ? "1" : "100" });
    if (focusedId) params.set("search", focusedId);
    fetchApi(`/audit?${params.toString()}`)
      .then((response: Entry[]) => {
        if (!active) return;
        setEntries(response);
        setMessage("");
        if (!focusedId) writeSectionSnapshot("audit", { entries: response, offset });
      })
      .catch(error => { if (active) setMessage(errorMessage(error, "تعذر تحميل سجل التدقيق")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offset, focusedId]);

  return <div className="min-h-screen bg-[#131313] text-white flex" dir="rtl">
    <SideNav /><TopNav title="سجل التدقيق" />
    <main className="mx-4 mt-28 mb-8 flex-1 min-w-0 lg:mr-[364px] lg:mt-36 space-y-5">
      <h1 className="text-2xl font-bold">سجل العمليات</h1>
      {message && <p role="alert">{message}</p>}
      {focusedId && <button type="button" className="app-secondary-button" onClick={() => { setLoading(true); setFocusedId(""); router.replace("/audit"); }}>العودة لكل العمليات</button>}
      <div className="glass rounded-2xl overflow-x-auto"><table className="w-full text-sm text-right">
        <thead><tr><th className="p-4">التاريخ</th><th className="p-4">العملية</th><th className="p-4">المستخدم</th><th className="p-4">السجل</th><th className="p-4">التفاصيل</th></tr></thead>
        <tbody>{loading ? <LoadingTableRows label="جاري تحميل سجل العمليات" columns={5} /> : entries.map(entry => <tr key={entry.id} data-search-id={entry.id} className={`border-t border-white/10 ${focusedId === entry.id ? "app-search-target" : ""}`}>
          <td className="p-4">{new Date(entry.created_at).toLocaleString("ar-EG")}</td>
          <td className="p-4">{entry.action}</td><td className="p-4">{entry.user_name || entry.user_id.slice(0, 8)}</td>
          <td className="p-4">{entry.entity_type} #{entry.entity_id?.slice(0, 8)}</td>
          <td className="p-4 text-xs"><details><summary className="cursor-pointer">عرض</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ before: entry.old_value, after: entry.new_value }, null, 2)}</pre></details></td>
        </tr>)}</tbody>
      </table></div>
      {!focusedId && <div className="flex gap-3"><button className="app-secondary-button" disabled={loading || !offset} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 100)); }}>السابق</button><button className="app-secondary-button" disabled={loading || entries.length < 100} onClick={() => { setLoading(true); setOffset(offset + 100); }}>التالي</button></div>}
    </main>
  </div>;
}
