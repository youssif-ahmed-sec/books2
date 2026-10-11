"use client";

import { useEffect, useRef, useState } from "react";

interface UnitBarcodeFieldProps {
  unitName: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function UnitBarcodeField({ unitName, value, onChange, readOnly = false }: UnitBarcodeFieldProps) {
  const [mode, setMode] = useState<"scan" | "auto">(value ? "scan" : "auto");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (value) setMode("scan"); }, [value]);

  return (
    <div className="unit-barcode-field">
      {readOnly ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#201f1f] px-3 py-2 text-sm" title="الباركود المحفوظ لا يمكن تغييره">
          <span dir="ltr" className="font-mono select-all truncate">{value}</span>
          <span className="material-symbols-outlined text-primary text-base" aria-hidden="true">lock</span>
        </div>
      ) : <>
      <div className="flex items-center justify-center gap-2" role="group" aria-label={`طريقة باركود ${unitName}`}>
        <button type="button" aria-pressed={mode === "scan"}
          onClick={() => { setMode("scan"); requestAnimationFrame(() => inputRef.current?.focus()); }}
          className={`rounded-lg px-2 py-1 text-xs ${mode === "scan" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          مسح باركود
        </button>
        <button type="button" aria-pressed={mode === "auto"}
          onClick={() => { setMode("auto"); onChange(""); }}
          className={`rounded-lg px-2 py-1 text-xs ${mode === "auto" ? "bg-primary text-white" : "bg-white/5 text-[#e2bfb0]"}`}>
          إنشاء تلقائي
        </button>
      </div>
      <input ref={inputRef} type="text" dir="ltr" aria-label={`باركود ${unitName}`}
        value={mode === "auto" ? "" : value}
        onChange={event => onChange(event.target.value)}
        disabled={mode === "auto"}
        placeholder={mode === "auto" ? "يُنشأ عند الحفظ" : "ضع المؤشر وامسح الباركود"}
        className="w-full rounded-xl border border-white/10 bg-[#201f1f] px-3 py-2 text-sm disabled:opacity-60" />
      </>}
    </div>
  );
}
