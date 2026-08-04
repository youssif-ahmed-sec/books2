"use client";

import { useState, useEffect } from "react";
import { SpotlightSearch } from "./SpotlightSearch";

interface TopNavProps {
  title: string;
  searchPlaceholder?: string;
}

export default function TopNav({ title, searchPlaceholder = "بحث سريع عن صنف أو باركود..." }: TopNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  return (
    <>
      <header
        className="fixed top-8 right-[364px] left-8 h-20 rounded-full z-40 flex items-center justify-between px-10 transition-all"
        style={{
          background: scrolled ? "rgba(19, 19, 19, 0.85)" : "rgba(32, 31, 31, 0.4)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.05)",
          boxShadow: scrolled ? "0 10px 30px rgba(0,0,0,0.3)" : "none",
        }}
      >
        <div className="flex items-center gap-12 flex-1">
          <h2 className="text-xl font-bold text-primary whitespace-nowrap">{title}</h2>
          <div className="relative w-full max-w-lg">
            <span className="material-symbols-outlined absolute right-5 top-1/2 -translate-y-1/2 text-[#e2bfb0]/60">
              search
            </span>
            <input
              type="text"
              placeholder={searchPlaceholder}
              onFocus={() => setSearchOpen(true)}
              readOnly
              className="w-full bg-[#1c1b1b]/40 border border-white/5 rounded-full py-2.5 pr-14 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-[#201f1f] transition-all cursor-pointer"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="w-11 h-11 flex items-center justify-center rounded-full glass hover:bg-white/10 transition-all text-[#e2bfb0] relative">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-3 right-3 w-2.5 h-2.5 bg-primary rounded-full border-2 border-[#131313]" />
          </button>
          <button className="w-11 h-11 flex items-center justify-center rounded-full glass hover:bg-white/10 transition-all text-[#e2bfb0]">
            <span className="material-symbols-outlined">account_circle</span>
          </button>
        </div>
      </header>

      {searchOpen && <SpotlightSearch onClose={() => setSearchOpen(false)} />}
    </>
  );
}
