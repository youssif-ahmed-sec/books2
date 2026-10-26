"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

export function ProductSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
  invalid = false,
  compact = false,
  filter = false,
  allowClear = true,
  disabled = false,
}: ProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 340 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const showSearch = filter || options.length >= 7;

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(opt => opt.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const visibleOptions = useMemo(() => {
    if (allowClear && !searchQuery.trim()) {
      return [{ value: "", label: placeholder }, ...filteredOptions];
    }
    return filteredOptions;
  }, [allowClear, searchQuery, placeholder, filteredOptions]);

  const selected = options.find(option => option.value === value);

  const showMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const margin = 12;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);

    // Open below if there is enough room (>= 220px) or if below has more room than above
    const openBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    const availableSpace = openBelow ? spaceBelow : spaceAbove;
    const maxHeight = Math.max(140, Math.min(360, availableSpace));

    const top = openBelow
      ? rect.bottom + 6
      : Math.max(margin, rect.top - maxHeight - 6);

    const width = Math.min(rect.width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));

    setPosition({ top, left, width, maxHeight });
    setSearchQuery("");
    setActiveIndex(0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    if (showSearch) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    } else {
      optionRefs.current[activeIndex]?.focus();
    }
  }, [open, showSearch]);

  useEffect(() => {
    if (!open) return;
    if (optionRefs.current[activeIndex]) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const closeOnScroll = (event: Event) => {
      const target = event.target as Node;
      if (menuRef.current && (target === menuRef.current || menuRef.current.contains(target))) {
        return;
      }
      setOpen(false);
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
      if (visibleOptions.length) {
        const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + visibleOptions.length) % visibleOptions.length;
        setActiveIndex(next);
        optionRefs.current[next]?.focus();
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : visibleOptions.length - 1;
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      if (event.target === searchInputRef.current && event.key === " ") {
        return;
      }
      event.preventDefault();
      if (visibleOptions[activeIndex]) {
        choose(visibleOptions[activeIndex]);
      }
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
        onClick={() => (open ? setOpen(false) : showMenu())}
        onKeyDown={event => {
          if (!open && ["ArrowDown", "ArrowUp", " "].includes(event.key)) {
            event.preventDefault();
            showMenu();
          }
        }}
      >
        <span className={value ? "" : "product-select-placeholder"}>
          {selected?.label || (value === "" ? placeholder : placeholder)}
        </span>
        <span className="material-symbols-outlined product-select-chevron" aria-hidden="true">
          expand_more
        </span>
      </button>

      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menuRef}
            role="listbox"
            aria-label={label}
            className="product-select-menu"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
            onKeyDown={onMenuKeyDown}
          >
            {showSearch && (
              <div className="product-select-search-wrap" onClick={e => e.stopPropagation()}>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={e => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (visibleOptions.length > 0) {
                        setActiveIndex(0);
                        optionRefs.current[0]?.focus();
                      }
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      if (visibleOptions[activeIndex]) {
                        choose(visibleOptions[activeIndex]);
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setOpen(false);
                      triggerRef.current?.focus();
                    }
                  }}
                  placeholder="بحث في الخيارات..."
                  className="product-select-search"
                />
              </div>
            )}

            <div className="product-select-options-list">
              {visibleOptions.map((option, index) => (
                <button
                  key={`${option.value}-${index}`}
                  ref={element => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  className={`product-select-option${option.value === value ? " product-select-option--selected" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && (
                    <span className="material-symbols-outlined flex-none" aria-hidden="true">
                      check
                    </span>
                  )}
                </button>
              ))}
              {!visibleOptions.length && (
                <p className="app-muted px-3 py-3 text-center text-sm">لا توجد خيارات مطابقة</p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
