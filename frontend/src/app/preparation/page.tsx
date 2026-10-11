"use client";
import { useEffect, useState } from "react";
import SideNav from "@/components/SideNav";
import TopNav from "@/components/TopNav";
import { fetchApi } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

type Item = { id: string; product_id: string; product_name?: string; quantity_requested: number };
type Order = { id: string; items: Item[]; notes: string | null; created_at: string };

export default function PreparationPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [packed, setPacked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetchApi("/orders/assigned").then(setOrders).catch(error => setMessage(errorMessage(error, "تعذر تحميل الطلبات")));
  useEffect(() => { load(); }, []);

  const complete = async (order: Order) => {
    setBusy(true); setMessage("");
    try {
      await fetchApi(`/orders/${order.id}/prepare`, { method: "POST", body: JSON.stringify({
        items: order.items.map(item => ({ order_item_id: item.id, picked_quantity: picked[item.id] || 0 })),
        package_confirmed: Boolean(packed[order.id]),
      }) });
      setMessage(`الطلب ${order.id.slice(0, 8)} جاهز للتسليم`); await load();
    } catch (error) { setMessage(errorMessage(error, "تعذر إكمال التجهيز")); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-[#131313] text-white flex" dir="rtl"><SideNav /><TopNav title="تجهيز الطلبات" />
    <main className="mx-4 mt-28 mb-8 flex-1 min-w-0 lg:mr-[364px] lg:mt-36 space-y-5"><h1 className="text-2xl font-bold">الطلبات المسندة للتجهيز</h1>
      {message && <p role="status" className="rounded-xl bg-primary/10 p-4">{message}</p>}
      {orders.length === 0 && <p className="glass rounded-xl p-5">لا توجد طلبات قيد التجهيز.</p>}
      {orders.map(order => <section key={order.id} className="glass rounded-2xl p-6 space-y-4"><h2 className="font-bold">طلب #{order.id.slice(0, 8)}</h2><p className="text-sm text-white/60">{order.notes}</p>
        {order.items.map(item => <label key={item.id} className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3"><span>{item.product_name || item.product_id.slice(0, 8)}</span><span>المطلوب: {item.quantity_requested}</span><input aria-label={`الكمية المجهزة للبند ${item.id}`} type="number" min="0" max={item.quantity_requested} step="0.01" value={picked[item.id] || ""} onChange={event => setPicked(previous => ({ ...previous, [item.id]: Number(event.target.value) || 0 }))} className="w-28 rounded-lg bg-black p-2" /></label>)}
        <label className="flex gap-2"><input type="checkbox" checked={Boolean(packed[order.id])} onChange={event => setPacked(previous => ({ ...previous, [order.id]: event.target.checked }))} /> راجعت الكميات وتم التغليف</label>
        <button disabled={busy || !packed[order.id] || order.items.some(item => picked[item.id] !== item.quantity_requested)} onClick={() => complete(order)} className="app-primary-button disabled:opacity-40">تحديد الطلب جاهزًا</button>
      </section>)}
    </main></div>;
}
