"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";

interface SpotlightSearchProps {
  onClose: () => void;
}

const searchResults = {
  products: [
    {
      id: 1,
      name: "Premium Arabic Notebook - الإصدار الفاخر",
      category: "القرطاسية الفاخرة",
      price: "145.00 EGP",
      status: "متوفر بالمخزون",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAsS9mBxQXYWmcvsOhJxy68YrsLoDp0DpDWmFeuWSCIDqs8DsGQKQVU8wbv_h5R1LcN4wb0YquF6QS9ifb7EIvuzI_HDJbIC9JAizTL0mkhQGh-jmY_Nj0AQNo3GEg__wtpQLYzLWvBzE3dsNTDSohugYaA0Rr0QKwzXHiX-j3o4RuOSWM4S4AlM3rZyFZwJLjD9VAFm3l6NClKQc4umJjjESzr_dEd-Tjetl0t9ShzfJUUHa-sERmb",
    },
  ],
  customers: [
    {
      id: 1,
      name: "أحمد محمد العامري",
      lastTransaction: "منذ 3 ساعات",
      balance: "0.00 EGP",
    },
  ],
  invoices: [
    {
      id: 1,
      number: "INV-2024-0892",
      date: "24 أكتوبر 2024",
      seller: "محمود إبراهيم",
      amount: "3,420.00 EGP",
      status: "مكتملة",
    },
  ],
};

export function SpotlightSearch({ onClose }: SpotlightSearchProps) {
  const [query, setQuery] = useState("نوت بوك");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex flex-col items-center pt-24 px-6"
      style={{ background: "rgba(19,19,19,0.6)", backdropFilter: "blur(12px)" }}
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full max-w-3xl animate-scale-in">
        {/* Search Input */}
        <div className="relative group">
          <div className="absolute inset-y-0 right-0 pr-6 flex items-center pointer-events-none">
            <span className="material-symbols-outlined text-primary text-2xl">search</span>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن الكتب، العملاء، أو الفواتير..."
            className="w-full h-20 pr-16 pl-40 bg-[#353534]/60 backdrop-blur-xl rounded-2xl text-lg text-[#e5e2e1] placeholder:text-[#e2bfb0]/50 border-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="absolute inset-y-0 left-0 pl-6 flex items-center gap-4">
            <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <span className="material-symbols-outlined text-[#e2bfb0] hover:text-primary transition-colors">
                barcode_scanner
              </span>
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#201f1f]/40 rounded border border-white/10 text-xs font-bold text-[#e2bfb0]">
              Ctrl + K
            </div>
          </div>
        </div>

        {/* Results */}
        <div
          className="mt-4 rounded-2xl overflow-hidden border border-white/5 shadow-2xl"
          style={{ background: "rgba(28,27,27,0.95)", backdropFilter: "blur(20px)" }}
        >
          <div className="custom-scrollbar overflow-y-auto p-4 space-y-8 max-h-[60vh]">
            {/* Products */}
            <section>
              <div className="flex items-center justify-between px-2 mb-4">
                <div className="flex items-center gap-2 text-primary">
                  <span className="material-symbols-outlined text-sm">category</span>
                  <h3 className="font-bold text-sm tracking-wide">المنتجات</h3>
                </div>
                <span className="text-xs text-[#e2bfb0]/60">5 نتائج</span>
              </div>
              {searchResults.products.map((p) => (
                <div
                  key={p.id}
                  className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-all cursor-pointer border border-transparent hover:border-white/5 hover:-translate-y-0.5"
                >
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-[#201f1f]">
                    <Image src={p.image} alt={p.name} width={64} height={64} className="w-full h-full object-cover" unoptimized />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-[#e5e2e1] group-hover:text-primary transition-colors">{p.name}</h4>
                    <p className="text-sm text-[#e2bfb0]">القسم: {p.category}</p>
                  </div>
                  <div className="text-right">
                    <div className="px-3 py-1 bg-primary/10 text-primary text-xs rounded-full font-bold mb-1">{p.status}</div>
                    <p className="text-lg font-bold">{p.price}</p>
                  </div>
                </div>
              ))}
            </section>

            {/* Customers */}
            <section>
              <div className="flex items-center justify-between px-2 mb-4">
                <div className="flex items-center gap-2 text-primary">
                  <span className="material-symbols-outlined text-sm">group</span>
                  <h3 className="font-bold text-sm tracking-wide">العملاء</h3>
                </div>
              </div>
              {searchResults.customers.map((c) => (
                <div
                  key={c.id}
                  className="group flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-all cursor-pointer hover:-translate-y-0.5"
                >
                  <div className="w-12 h-12 rounded-full bg-[#474746] flex items-center justify-center text-[#b7b5b4]">
                    <span className="material-symbols-outlined">person</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-[#e5e2e1] group-hover:text-primary transition-colors">{c.name}</h4>
                    <p className="text-sm text-[#e2bfb0]">اخر معاملة: {c.lastTransaction}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#e2bfb0]">الرصيد</p>
                    <p className="text-md font-bold text-green-400">{c.balance}</p>
                  </div>
                </div>
              ))}
            </section>

            {/* Invoices */}
            <section>
              <div className="flex items-center justify-between px-2 mb-4">
                <div className="flex items-center gap-2 text-primary">
                  <span className="material-symbols-outlined text-sm">receipt_long</span>
                  <h3 className="font-bold text-sm tracking-wide">الفواتير</h3>
                </div>
              </div>
              {searchResults.invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="group flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all cursor-pointer border border-white/5 hover:-translate-y-0.5"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-[#e5e2e1] group-hover:text-primary transition-colors">
                        فاتورة #{inv.number}
                      </span>
                      <span className="px-2 py-0.5 bg-[#5a4136]/30 text-[#a98a7d] text-[10px] rounded uppercase">
                        {inv.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#e2bfb0]">
                      بتاريخ {inv.date} • البائع: {inv.seller}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary">{inv.amount}</p>
                  </div>
                  <span className="material-symbols-outlined text-[#e2bfb0] opacity-0 group-hover:opacity-100 transition-opacity">
                    chevron_left
                  </span>
                </div>
              ))}
            </section>
          </div>

          {/* Footer */}
          <div className="p-4 bg-[#1c1b1b] border-t border-white/5 flex items-center justify-between text-xs text-[#e2bfb0] font-medium">
            <div className="flex items-center gap-6">
              {[
                { key: "⏎", label: "للاختيار" },
                { key: "↑↓", label: "للتنقل" },
                { key: "ESC", label: "للإغلاق" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 bg-[#201f1f] rounded border border-white/10">{key}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <button className="text-primary font-bold hover:underline">عرض جميع النتائج (24)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
