"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchApi } from "@/lib/api";
import { countErrorMessage } from "@/lib/counts";
import { notifySuccess } from "@/lib/notifications";
import { refreshNotificationBell } from "@/lib/notificationEvents";

type Warehouse = { id: string; name: string };
type Balance = { product_id: string; warehouse_id: string; current_stock: number | string };

export default function StockQuantityDialog({ productId, unit, approvalRequired, onClose, onSuccess }: {
  productId: string; unit: string; approvalRequired: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [warehouse, setWarehouse] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchApi("/inventory/warehouses") as Promise<Warehouse[]>, fetchApi("/inventory/balances") as Promise<Balance[]>])
      .then(([stores, stock]) => { if (active) { setWarehouses(stores); setBalances(stock.filter(item => item.product_id === productId)); if (stores.length === 1) setWarehouse(stores[0].id); } })
      .catch(cause => { if (active) setError(countErrorMessage(cause, "تعذر تحميل رصيد المنتج")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  const current = Number(balances.find(item => item.warehouse_id === warehouse)?.current_stock || 0);
  const inactiveStock = balances.some(item => Number(item.current_stock) > 0 && !warehouses.some(store => store.id === item.warehouse_id));
  const valid = /^\d+(?:\.\d{1,2})?$/.test(quantity) && Number.isFinite(Number(quantity)) && Number(quantity) !== current;

  async function submit() {
    if (!warehouse || !valid || reason.trim().length < 3 || busy || inactiveStock) return;
    const line = { product_id: productId, expected_quantity: current, observed_quantity: quantity, reason: reason.trim() };
    const key = JSON.stringify({ warehouse_id: warehouse, line });
    if (!request.current || request.current.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try {
      await fetchApi("/inventory/count-sessions", { method: "POST", body: JSON.stringify({ request_id: request.current.id, warehouse_id: warehouse, lines: [line] }) });
      notifySuccess(approvalRequired ? "تم إرسال تعديل الكمية للمدير" : "تم تعديل كمية المنتج");
      refreshNotificationBell(); onSuccess(); onClose();
    } catch (cause) { setError(countErrorMessage(cause, "تعذر تعديل الكمية")); }
    finally { setBusy(false); }
  }

  return createPortal(<div className="motion-overlay fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" dir="rtl" role="dialog" aria-modal="true" aria-label="تعديل كمية المنتج">
    <div className="motion-dialog app-panel w-full max-w-md space-y-4 p-6">
      <h2 className="text-lg font-bold">تعديل كمية المنتج</h2>
      {loading ? <p className="app-muted">جارٍ تحميل الرصيد...</p> : <>
        {warehouses.length !== 1 && <label className="block text-sm">المخزن<select className="app-field mt-2 w-full" value={warehouse} onChange={event => setWarehouse(event.target.value)}><option value="">اختر المخزن</option>{warehouses.map(store => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>}
        {warehouse && <p className="text-sm">الرصيد الحالي: <strong>{current} {unit}</strong></p>}
        {inactiveStock && <p role="alert" className="text-sm text-red-400">للمنتج رصيد في مخزن غير نشط؛ يلزم تصحيح المخزن أولًا.</p>}
        <label className="block text-sm">الكمية الجديدة · {unit}<input className="app-field mt-2 w-full" type="number" min="0" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label className="block text-sm">سبب التعديل<textarea className="app-field mt-2 w-full" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <p className="app-muted text-xs">{approvalRequired ? "يصل الطلب للمدير ولا يتغير الرصيد إلا بعد موافقته." : "يُعتمد التعديل ويُحدّث الرصيد عند الحفظ."}</p>
      </>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className="app-primary-button" disabled={loading || busy || !warehouse || !valid || reason.trim().length < 3 || inactiveStock} onClick={() => void submit()}>{busy ? "جارٍ الحفظ..." : approvalRequired ? "إرسال للمدير" : "حفظ الكمية"}</button><button type="button" className="app-secondary-button" disabled={busy} onClick={onClose}>إلغاء</button></div>
    </div>
  </div>, document.body);
}
