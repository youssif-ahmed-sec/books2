"use client";

import React, { useState, useEffect } from "react";
import { fetchApi } from "@/lib/api";

interface InventoryMovementsModalProps {
  onClose: () => void;
}

export default function InventoryMovementsModal({ onClose }: InventoryMovementsModalProps) {
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const limit = 20;

  useEffect(() => {
    loadMovements();
  }, [page]);

  const loadMovements = async () => {
    setLoading(true);
    try {
      const data = await fetchApi(`/inventory/transactions?page=${page}&limit=${limit}`);
      const mapped = data.data.map((tx: any) => {
        let typeLabel = "غير معروف";
        let style = "bg-gray-500/10 text-gray-400 border-gray-500/20";
        let qtyPrefix = "";
        
        if (tx.transaction_type === "Receiving") {
          typeLabel = "وارد";
          style = "bg-green-500/10 text-green-400 border-green-500/20";
          qtyPrefix = tx.quantity_changed > 0 ? "+" : "";
        } else if (tx.transaction_type === "Issuing") {
          typeLabel = "صادر";
          style = "bg-red-500/10 text-red-400 border-red-500/20";
          qtyPrefix = tx.quantity_changed > 0 ? "+" : "";
        } else if (tx.transaction_type === "Adjustment") {
          typeLabel = "تسوية";
          style = "bg-[#ffb4ab]/10 text-[#ffb4ab] border-[#ffb4ab]/20";
          qtyPrefix = tx.quantity_changed > 0 ? "+" : "";
        }
        
        const d = new Date(tx.created_at);
        return {
           id: tx.id,
           product: tx.product_name || "منتج غير معروف",
           type: typeLabel,
           date: `${d.toLocaleDateString('ar-EG')} ${d.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}`,
           typeStyle: style,
           qty: `${qtyPrefix}${tx.quantity_changed}`,
           qtyColor: style.includes("green") ? "text-green-400" : style.includes("red") ? "text-red-400" : style.includes("ffb4ab") ? "text-[#ffb4ab]" : "text-[#e5e2e1]"
        };
      });
      setMovements(mapped);
      setTotalItems(data.total);
    } catch (err) {
      console.error("Failed to load movements:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[85vh] bg-[#1a1918] border border-white/10 rounded-3xl shadow-2xl flex flex-col animate-slide-up">
        
        {/* Header */}
        <div className="flex items-center justify-between p-8 border-b border-white/10 flex-shrink-0 bg-[#0e0e0e]/50 backdrop-blur-md rounded-t-3xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-xl">history</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">سجل حركات المخزون</h2>
              <p className="text-[#e2bfb0]/60 text-sm mt-1">
                سجل كامل لجميع عمليات الوارد والصادر بالمخزن
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-white transition-all hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="glass rounded-2xl hi-fi-shadow border border-white/5 overflow-hidden">
            <div className="w-full overflow-x-auto pb-4 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-white/5 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 hover:[&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-right border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-[#1a1918]/50 border-b border-white/5">
                    <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest">
                      المنتج
                    </th>
                    <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest text-center">
                      النوع
                    </th>
                    <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest text-center">
                      الكمية
                    </th>
                    <th className="px-8 py-5 text-[11px] font-bold text-[#e2bfb0]/60 uppercase tracking-widest text-left">
                      التاريخ والوقت
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="text-center py-10 text-[#e2bfb0]/60 text-sm">
                        جاري تحميل السجل...
                      </td>
                    </tr>
                  ) : movements.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-10 text-[#e2bfb0]/60 text-sm">
                        لا يوجد حركات مسجلة
                      </td>
                    </tr>
                  ) : (
                    movements.map((move) => (
                      <tr key={move.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-8 py-4">
                          <p className="font-bold text-white text-sm">{move.product}</p>
                        </td>
                        <td className="px-8 py-4 text-center">
                          <span className={`px-3 py-1 text-[10px] rounded-full font-bold border ${move.typeStyle}`}>
                            {move.type}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-center">
                          <span className={`font-bold text-sm ${move.qtyColor}`} dir="ltr">
                            {move.qty}
                          </span>
                        </td>
                        <td className="px-8 py-4 text-left">
                          <p className="text-sm text-[#e2bfb0]/80 whitespace-nowrap">{move.date}</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Pagination Footer */}
        <div className="px-8 py-6 border-t border-white/10 bg-[#0e0e0e]/50 backdrop-blur-md rounded-b-3xl flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-medium text-[#e2bfb0]/60">
            عرض {Math.min((page - 1) * limit + 1, totalItems)} إلى {Math.min(page * limit, totalItems)} من أصل {totalItems} حركة
          </span>
          <div className="flex gap-2">
            <button 
              disabled={page >= Math.ceil(totalItems / limit) || loading}
              onClick={() => setPage(page + 1)}
              className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
            
            {/* Show only max 5 page buttons */}
            {[...Array(Math.ceil(totalItems / limit) || 1)].map((_, i) => {
               if (i + 1 < page - 2 || i + 1 > page + 2) {
                 if (i === 0 || i === Math.ceil(totalItems / limit) - 1) {
                   // keep first and last
                 } else {
                   return null; // hide middle ones if too many
                 }
               }
               return (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`w-10 h-10 flex items-center justify-center rounded-full font-bold text-sm transition-all ${
                    page === i + 1 
                      ? "bg-primary text-white shadow-[0_0_10px_rgba(255,107,0,0.3)]"
                      : "glass hover:bg-white/10"
                  }`}
                >
                  {i + 1}
                </button>
               );
            })}
            
            <button 
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
              className="w-10 h-10 flex items-center justify-center glass rounded-full hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
