"use client";

import { useRef, useState } from "react";
import { emptyBarcodeScanCapture, englishBarcodeFromScan, recordBarcodeScanKey } from "@/lib/barcodeScanner";

interface UnitBarcodeFieldProps {
  unitName: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  boxBarcode?: string;
  onBoxBarcodeChange?: (value: string) => void;
  boxBarcodeReadOnly?: boolean;
}

export default function UnitBarcodeField({ unitName, value, onChange, readOnly = false,
  boxBarcode, onBoxBarcodeChange, boxBarcodeReadOnly = false }: UnitBarcodeFieldProps) {
  const [mode, setMode] = useState<"scan" | "auto">(value ? "scan" : "auto");
  const [boxMode, setBoxMode] = useState<"scan" | "auto">(boxBarcode ? "scan" : "auto");
  const inputRef = useRef<HTMLInputElement>(null);
  const scanKeys = useRef(emptyBarcodeScanCapture());
  const selectedMode = value ? "scan" : mode;

  if (onBoxBarcodeChange) {
    return <div className="unit-barcode-field">
      <div className="flex items-center justify-center gap-2" role="group" aria-label={`طريقة باركود ${unitName}`}>
        <button type="button" aria-pressed={boxMode === "scan"}
          onClick={() => { setBoxMode("scan"); requestAnimationFrame(() => inputRef.current?.focus()); }}
          className={`rounded-lg px-2 py-1 text-xs ${boxMode === "scan" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          مسح باركود
        </button>
        <button type="button" aria-pressed={boxMode === "auto"} onClick={() => setBoxMode("auto")}
          className={`rounded-lg px-2 py-1 text-xs ${boxMode === "auto" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          إنشاء تلقائي
        </button>
      </div>
      {boxMode === "auto" ? (
        <input type="text" dir="ltr" aria-label={`باركود الوحدة التلقائي ${unitName}`} value={value}
          readOnly placeholder="يُنشأ عند الحفظ"
          className="w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm opacity-60" />
      ) : (
        <input ref={inputRef} type="text" dir="ltr" aria-label="باركود العلبة الأصلي"
          value={boxBarcode || ""} readOnly={boxBarcodeReadOnly} placeholder="امسح باركود العلبة أو اكتبه"
          onChange={event => onBoxBarcodeChange(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter") {
              if (!event.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, event);
              return;
            }
            const code = englishBarcodeFromScan(scanKeys.current, event.currentTarget.value);
            if (code && !boxBarcodeReadOnly) { event.preventDefault(); onBoxBarcodeChange(code); }
          }}
          className="w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm" />
      )}
      <p className="text-[10px] text-[#e2bfb0]/70">{boxMode === "scan" ? "باركود العلبة الأصلي" : "باركود الوحدة المحفوظ"}</p>
    </div>;
  }

  return (
    <div className="unit-barcode-field">
      {readOnly ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm" title="الباركود المحفوظ لا يمكن تغييره">
          <span dir="ltr" className="font-mono select-all truncate">{value}</span>
          <span className="material-symbols-outlined text-primary text-base" aria-hidden="true">lock</span>
        </div>
      ) : <>
      <div className="flex items-center justify-center gap-2" role="group" aria-label={`طريقة باركود ${unitName}`}>
        <button type="button" aria-pressed={selectedMode === "scan"}
          onClick={() => { setMode("scan"); requestAnimationFrame(() => inputRef.current?.focus()); }}
          className={`rounded-lg px-2 py-1 text-xs ${selectedMode === "scan" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          مسح باركود
        </button>
        <button type="button" aria-pressed={selectedMode === "auto"}
          onClick={() => { setMode("auto"); onChange(""); }}
          className={`rounded-lg px-2 py-1 text-xs ${selectedMode === "auto" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          إنشاء تلقائي
        </button>
      </div>
      <input ref={inputRef} type="text" dir="ltr" aria-label={`باركود ${unitName}`}
        value={selectedMode === "auto" ? "" : value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key !== "Enter") {
            if (!event.nativeEvent.isComposing) recordBarcodeScanKey(scanKeys.current, event);
            return;
          }
          const code = englishBarcodeFromScan(scanKeys.current, event.currentTarget.value);
          if (code) { event.preventDefault(); onChange(code); }
        }}
        disabled={selectedMode === "auto"}
        placeholder={selectedMode === "auto" ? "يُنشأ عند الحفظ" : "ضع المؤشر وامسح الباركود"}
        className="w-full rounded-xl border border-white/10 bg-surface-container px-3 py-2 text-sm disabled:opacity-60" />
      </>}
    </div>
  );
}
