"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Barcode from "react-barcode";

export interface BarcodePrintUnit {
  id: string;
  name: string;
  barcode: string;
  price: string;
  copies: number;
}

interface Props {
  productName: string;
  units: BarcodePrintUnit[];
  onClose: () => void;
  quantityHint?: string;
  selectByDefault?: boolean;
}

export default function BarcodePrintDialog({ productName, units, onClose, quantityHint, selectByDefault = true }: Props) {
  const [choices, setChoices] = useState(() => units.map(unit => ({ ...unit, selected: selectByDefault && unit.copies > 0 })));
  const [previewId, setPreviewId] = useState(units[0]?.id || "");
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const preview = choices.find(choice => choice.id === previewId) || choices[0];

  const update = (id: string, patch: Partial<(typeof choices)[number]>) => {
    setChoices(previous => previous.map(choice => choice.id === id ? { ...choice, ...patch } : choice));
  };

  const printSelected = async () => {
    const selected = choices.filter(choice => choice.selected && Number.isInteger(choice.copies) && choice.copies > 0);
    if (!selected.length) { setError("اختر وحدة واحدة على الأقل وحدد عدد الملصقات."); return; }
    setPrinting(true);
    setError("");
    try {
      for (const choice of selected) {
        let remaining = choice.copies;
        while (remaining > 0) {
          const batch = Math.min(remaining, 20);
          const response = await fetch("http://127.0.0.1:8199/api/print", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              receipt_type: "barcode",
              order: {
                name_ar: productName,
                unit_name: choice.name,
                barcode: choice.barcode,
                sell_price: choice.price,
                quantity: batch,
              },
            }),
          });
          if (!response.ok) throw new Error(`تعذر إرسال الملصقات للطابعة (${response.status}).`);
          remaining -= batch;
          update(choice.id, { copies: remaining, selected: remaining > 0 });
        }
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إرسال الملصقات للطابعة. الباقي ظاهر لتعيد المحاولة.");
    } finally {
      setPrinting(false);
    }
  };

  return createPortal(
    <div className="motion-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" dir="rtl" role="dialog" aria-modal="true" aria-label="اختيار باركودات الوحدات للطباعة">
      <div className="motion-dialog max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#1c1b1b] p-5 text-[#e5e2e1] custom-scrollbar">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div><h2 className="text-xl font-bold">طباعة باركودات الوحدات</h2><p className="mt-1 text-sm text-[#e2bfb0]">{productName} · {quantityHint || "العدد الافتراضي من كمية كل وحدة، ويمكن تغييره."}</p></div>
          <button type="button" onClick={onClose} disabled={printing} aria-label="إغلاق اختيار الطباعة" className="rounded-full p-2 hover:bg-white/10">✕</button>
        </div>
        <div className="space-y-2">
          {choices.map(choice => (
            <div key={choice.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 p-3">
              <input type="checkbox" aria-label={`طباعة باركود ${choice.name}`} checked={choice.selected}
                onChange={event => update(choice.id, { selected: event.target.checked })} />
              <button type="button" onClick={() => setPreviewId(choice.id)} className="min-w-28 text-right font-semibold hover:text-primary">{choice.name}</button>
              <span dir="ltr" className="min-w-0 flex-1 truncate text-xs text-[#e2bfb0]">{choice.barcode}</span>
              <label className="flex items-center gap-2 text-sm">العدد
                <input type="number" min="0" step="1" value={choice.copies} aria-label={`عدد ملصقات ${choice.name}`}
                  onChange={event => update(choice.id, { copies: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}
                  className="w-20 rounded-lg border border-white/15 bg-[#292625] px-2 py-1 text-center" />
              </label>
            </div>
          ))}
        </div>
        {preview && <div className="mx-auto mt-4 w-64 rounded-xl bg-white p-3 text-center text-black" aria-label="شكل ملصق الباركود">
          <p className="text-xs font-bold">مكتبة سعود الشافعي</p>
          <p className="my-1 truncate text-sm font-semibold">{productName} · {preview.name}</p>
          <div className="flex justify-center overflow-hidden" dir="ltr"><Barcode value={preview.barcode} format="CODE128" width={1.15} height={34} fontSize={10} margin={0} /></div>
          <p className="mt-1 text-xs font-semibold">السعر: {preview.price} ج.م</p>
        </div>}
        {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={printSelected} disabled={printing} className="app-primary-button flex-1">{printing ? "جارٍ إرسال الملصقات..." : "إرسال المحدد للطباعة"}</button>
          <button type="button" onClick={onClose} disabled={printing} className="app-secondary-button">تخطي الطباعة</button>
        </div>
      </div>
    </div>, document.body,
  );
}
