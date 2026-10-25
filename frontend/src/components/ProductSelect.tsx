"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ProductSelectOption {
  value: string;
  label: string;
}

interface ProductSelectProps {
  label: string;
  value: string;
  options: ProductSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  compact?: boolean;
  filter?: boolean;
  allowClear?: boolean;
  disabled?: boolean;
}

export function ProductSelect({ label, value, options, placeholder, onChange, invalid = false, compact = false, filter = false, allowClear = true, disabled = false }: ProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const allOptions = allowClear ? [{ value: "", label: placeholder }, ...options] : options;
  const searchable = allOptions.length > 7;
  const specialOption = !search.trim() && allOptions.find(option => option.value.startsWith("__ADD_"));
  const visibleOptions = searchable
    ? [...allOptions.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && option !== specialOption), ...(specialOption ? [specialOption] : [])]
    : allOptions;
  const selected = allOptions.find(option => option.value === value);

  const showMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimatedHeight = Math.min(400, allOptions.length * 48 + (searchable ? 64 : 16));
    const roomBelow = window.innerHeight - rect.bottom;
    const top = roomBelow >= estimatedHeight + 12 || roomBelow >= rect.top
      ? rect.bottom + 8
      : Math.max(8, rect.top - estimatedHeight - 8);
    const width = Math.min(rect.width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPosition({ top, left, width });
    setSearch("");
    setActiveIndex(0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex, searchable]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  const choose = (option: ProductSelectOption) => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleOptions.length) setActiveIndex(current => (current + (event.key === "ArrowDown" ? 1 : -1) + visibleOptions.length) % visibleOptions.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : visibleOptions.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (visibleOptions[activeIndex]) choose(visibleOptions[activeIndex]);
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") {
        event.preventDefault();
        triggerRef.current?.focus();
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-invalid={invalid}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        aria-controls={open ? menuId : undefined}
        className={`product-select-trigger${compact ? " product-select-trigger--compact" : ""}${filter ? " product-select-trigger--filter" : ""}${invalid ? " product-select-trigger--invalid" : ""}`}
        onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={event => {
          if (!open && ["ArrowDown", "ArrowUp", " "].includes(event.key)) {
            event.preventDefault();
            showMenu();
          }
        }}
      >
        <span className={value ? "" : "product-select-placeholder"}>{selected?.label || placeholder}</span>
        <span className="material-symbols-outlined product-select-chevron" aria-hidden="true">expand_more</span>
      </button>
      {open && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="listbox"
          aria-label={label}
          className="product-select-menu"
          style={{ top: position.top, left: position.left, width: position.width }}
          onKeyDown={onMenuKeyDown}
        >
          {searchable && <input ref={searchRef} type="search" className="product-select-search" value={search}
            placeholder={`ابحث في ${label}`} aria-label={`ابحث في ${label}`}
            onChange={event => { setSearch(event.target.value); setActiveIndex(0); }} />}
          {visibleOptions.map((option, index) => (
            <button
              key={`${option.value}-${index}`}
              ref={element => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className={`product-select-option${option.value === value ? " product-select-option--selected" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === value && <span className="material-symbols-outlined" aria-hidden="true">check</span>}
            </button>
          ))}
          {!visibleOptions.length && <p className="app-muted px-3 py-3 text-sm">لا توجد نتيجة</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
