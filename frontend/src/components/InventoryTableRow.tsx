"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Barcode from "react-barcode";
import { UserRole, canViewCost, canEditProduct } from "@/utils/auth";

interface StockItem {
  id: string | number;
  nameAr: string;
  nameEn: string;
  tag: string;
  sku: string;
  barcode: string;
  category: string;
  retailPrice: string;
  wholesalePrice: string;
  stockQty: string;
  stockUnit: string;
  stockPercent: number;
  stockStatus: "normal" | "low" | "critical";
  image?: string;
}

interface InventoryTableRowProps {
  item: StockItem;
  onEdit: (item: StockItem) => void;
  userRole: UserRole | null;
}

export function InventoryTableRow({ item, onEdit, userRole }: InventoryTableRowProps) {
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const stockColor =
    item.stockStatus === "critical"
      ? "bg-[#ffb4ab]"
      : item.stockStatus === "low"
      ? "bg-[#ffb4ab]"
      : "bg-primary";

  const textColor =
    item.stockStatus === "critical" || item.stockStatus === "low"
      ? "text-[#ffb4ab]"
      : "text-primary";

  return (
    <tr className="table-row-hover hover:bg-white/5 transition-all border-b border-white/5 last:border-0">
      {/* Product */}
      <td className="px-8 py-6 min-w-[250px]">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-2xl bg-[#2a2a2a] border border-white/5 flex-shrink-0 flex items-center justify-center overflow-hidden">
            <Image
              src={item.image || '/placeholder.png'}
              alt={item.nameAr}
              width={56}
              height={56}
              className="object-cover w-full h-full"
              unoptimized
            />
          </div>
          <div>
            <p className="font-bold text-[#e5e2e1]">{item.nameAr}</p>
            <p className="text-[10px] text-[#e2bfb0]/60">{item.nameEn}</p>
            {item.tag && (
              <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full mt-1 inline-block border border-primary/20">
                {item.tag}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Barcode */}
      <td className="px-8 py-6 min-w-[150px] whitespace-nowrap">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-primary font-bold text-xs">#{item.sku}</span>
          <span className="font-mono text-[9px] opacity-40">{item.barcode}</span>
        </div>
      </td>

      {/* Category */}
      <td className="px-8 py-6 text-center min-w-[150px] whitespace-nowrap">
        <span className="px-4 py-1.5 bg-[#353534] text-[#e2bfb0]/80 rounded-full text-[10px] font-black tracking-wider uppercase border border-white/5">
          {item.category}
        </span>
      </td>

      {/* Price - Hidden conditionally */}
      {canViewCost(userRole) && (
        <td className="px-8 py-6 min-w-[150px] whitespace-nowrap">
          <div className="text-[10px] leading-relaxed">
            <p>
              <span className="opacity-50">تجزئة:</span>{" "}
              <span className="font-bold text-primary text-sm">{item.retailPrice}</span>
            </p>
            <p>
              <span className="opacity-50">جملة:</span>{" "}
              <span className="font-bold">{item.wholesalePrice}</span>
            </p>
          </div>
        </td>
      )}

      {/* Stock */}
      <td className="px-8 py-6 min-w-[200px] whitespace-nowrap">
        <div className="w-full max-w-[200px]">
          <div className="flex justify-between text-[10px] mb-2 font-bold">
            <span className={item.stockStatus !== "normal" ? "text-[#ffb4ab]" : ""}>
              {item.stockQty} {item.stockUnit}
            </span>
            <span className={textColor}>{item.stockPercent}%</span>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${stockColor} rounded-full transition-all`}
              style={{
                width: `${item.stockPercent}%`,
                boxShadow:
                  item.stockStatus === "normal"
                    ? "0 0 10px rgba(255,107,0,0.3)"
                    : "0 0 10px rgba(255,180,171,0.3)",
              }}
            />
          </div>
        </div>
      </td>

      {/* Actions */}
      <td className="px-8 py-6">
        <div className="flex items-center justify-center gap-3 shrink-0">
          <button
            onClick={() => setShowBarcodeModal(true)}
            className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary hover:border-primary/30 transition-all"
            title="طباعة الباركود"
          >
            <span className="material-symbols-outlined text-[18px]">barcode</span>
          </button>
          
          {canEditProduct(userRole) && (
            <button
              onClick={() => onEdit(item)}
              className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary hover:border-primary/30 transition-all"
              title="تعديل"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
            </button>
          )}

          {item.stockStatus !== "normal" ? (
            <button
              className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#ffb4ab] border border-[#ffb4ab]/20 hover:bg-[#ffb4ab]/10 transition-all"
              title="طلب شراء"
            >
              <span className="material-symbols-outlined text-[18px]">shopping_cart_checkout</span>
            </button>
          ) : (
            <button
              className="w-9 h-9 rounded-full glass flex items-center justify-center text-[#e2bfb0]/60 hover:text-primary hover:border-primary/30 transition-all"
              title="السجل"
            >
              <span className="material-symbols-outlined text-[18px]">history</span>
            </button>
          )}
        </div>
      </td>

      {/* Barcode Modal */}
      {showBarcodeModal && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#1c1b1b] border border-white/10 rounded-3xl p-8 max-w-sm w-full relative flex flex-col items-center">
            <button
              onClick={() => setShowBarcodeModal(false)}
              className="absolute top-4 right-4 text-[#e2bfb0]/40 hover:text-white"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            
            <h3 className="text-xl font-bold mb-6 text-white text-center">طباعة الباركود</h3>
            
            {/* The printable area */}
            <div id={`print-barcode-${item.sku}`} className="bg-white p-6 rounded-xl flex flex-col items-center justify-center w-full mb-6">
              <Barcode value={item.barcode || item.sku} width={2} height={80} fontSize={16} />
              <p className="text-black font-bold mt-2 text-sm text-center">{item.nameAr}</p>
              {canViewCost(userRole) && (
                 <p className="text-black/60 text-xs text-center mt-1">السعر: {item.retailPrice} ج.م</p>
              )}
            </div>

            <button
              onClick={() => {
                const printContent = document.getElementById(`print-barcode-${item.sku}`)?.innerHTML;
                if (printContent) {
                  const printWindow = window.open('', '_blank');
                  printWindow?.document.write(`
                    <html dir="rtl">
                      <head>
                        <title>طباعة باركود - ${item.nameAr}</title>
                        <style>
                          body { display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
                          .container { text-align: center; }
                        </style>
                      </head>
                      <body>
                        <div class="container">${printContent}</div>
                        <script>window.print(); window.close();</script>
                      </body>
                    </html>
                  `);
                }
              }}
              className="w-full bg-primary text-white font-bold py-4 rounded-xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined">print</span>
              <span>طباعة</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </tr>
  );
}
