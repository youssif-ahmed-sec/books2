"use client";

import { useState, type ComponentProps } from "react";

type Props = Omit<ComponentProps<"input">, "type" | "value"> & {
  value: string | number;
};

/** Show a zero default as a hint without changing its submitted value. */
export function ZeroHintNumberInput({ value, placeholder = "0", onFocus, onBlur, onChange, ...props }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const isZero = Number(value) === 0 && String(value).trim() !== "";
  const shownValue = draft ?? (isZero ? "" : value);

  return <input {...props} type="number" value={shownValue} placeholder={placeholder}
    onFocus={event => { setDraft(isZero ? "" : String(value)); onFocus?.(event); }}
    onChange={event => { setDraft(event.currentTarget.value); onChange?.(event); }}
    onBlur={event => { setDraft(null); onBlur?.(event); }} />;
}
