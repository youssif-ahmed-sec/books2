"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

type DatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
};

const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const parseDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return isoDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) === value ? parsed : null;
};
const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function DatePicker({ label, value, onChange, min, max, disabled = false, placeholder = "اختر التاريخ", allowClear = false }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const initial = parseDate(value || min || "") || new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const selected = parseDate(value);
  const today = new Date();
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const show = () => {
    if (disabled || !trigger.current) return;
    const start = parseDate(value || min || "") || new Date();
    setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    const box = trigger.current.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    setPosition({ width, left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)),
      top: box.bottom + 344 <= window.innerHeight ? box.bottom + 6 : Math.max(8, box.top - 344) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    const hideOnScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hideOnScroll);
    window.addEventListener("scroll", hideOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hideOnScroll);
      window.removeEventListener("scroll", hideOnScroll, true);
    };
  }, [open]);

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstDay + days) / 7) * 7 }, (_, index) => index - firstDay + 1);
  const previousLast = new Date(month.getFullYear(), month.getMonth(), 0);
  const nextFirst = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const previousMonthEnd = isoDate(previousLast.getFullYear(), previousLast.getMonth(), previousLast.getDate());
  const nextMonthStart = isoDate(nextFirst.getFullYear(), nextFirst.getMonth(), nextFirst.getDate());
  const canPrevious = !min || previousMonthEnd >= min;
  const canNext = !max || nextMonthStart <= max;
  const canChooseToday = (!min || todayIso >= min) && (!max || todayIso <= max);

  return <>
    <button ref={trigger} type="button" disabled={disabled} onClick={() => open ? close() : show()}
      aria-label={label} aria-expanded={open} aria-controls={open ? dialogId : undefined}
      className="app-field flex min-h-11 items-center justify-between gap-3 text-right disabled:opacity-50">
      <span className={selected ? "" : "app-muted"}>{selected ? selected.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }) : placeholder}</span>
      <span className="material-symbols-outlined shrink-0 text-primary" aria-hidden="true">calendar_month</span>
    </button>
    {open && createPortal(<div ref={panel} id={dialogId} role="dialog" aria-label={label} dir="rtl"
      className="fixed z-[190] rounded-2xl border border-current/15 bg-[var(--color-surface-container-high)] p-3 text-[var(--color-on-surface)] shadow-2xl"
      style={{ top: position.top, left: position.left, width: position.width }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" disabled={!canPrevious} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="الشهر السابق" className="app-icon-button !h-9 !w-9 disabled:opacity-35"><span className="material-symbols-outlined" aria-hidden="true">chevron_right</span></button>
        <strong className="text-sm">{month.toLocaleDateString("ar-EG", { month: "long", year: "numeric" })}</strong>
        <button type="button" disabled={!canNext} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="الشهر التالي" className="app-icon-button !h-9 !w-9 disabled:opacity-35"><span className="material-symbols-outlined" aria-hidden="true">chevron_left</span></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">{weekdays.map(day => <span key={day} className="app-muted py-1">{day.slice(0, 2)}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">{cells.map((day, index) => {
        if (day < 1 || day > days) return <span key={index} aria-hidden="true" className="h-9" />;
        const date = isoDate(month.getFullYear(), month.getMonth(), day);
        const unavailable = Boolean(min && date < min || max && date > max);
        return <button key={date} type="button" disabled={unavailable} aria-label={new Date(month.getFullYear(), month.getMonth(), day).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}
          aria-pressed={date === value} onClick={() => { onChange(date); close(); }}
          className={`h-9 rounded-lg text-sm font-semibold transition-colors disabled:opacity-25 ${date === value ? "bg-primary text-white" : date === todayIso ? "border border-primary text-primary" : "hover:bg-white/10"}`}>{day}</button>;
      })}</div>
      <div className="mt-3 flex items-center justify-between border-t border-current/10 pt-2 text-sm">
        <button type="button" disabled={!canChooseToday} className="text-primary disabled:opacity-35" onClick={() => { onChange(todayIso); close(); }}>اليوم</button>
        {allowClear && <button type="button" className="app-muted" onClick={() => { onChange(""); close(); }}>مسح</button>}
      </div>
    </div>, document.body)}
  </>;
}
