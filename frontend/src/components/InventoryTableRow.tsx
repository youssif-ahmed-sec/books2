"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BarcodePrintDialog, { type BarcodePrintUnit } from "@/components/BarcodePrintDialog";
import { UserRole, canViewCost, canEditProduct } from "@/utils/auth";
import { useHydrated } from "@/lib/useHydrated";

interface StockItem {
  id: string;
  nameAr: string;
  nameEn: string;
  tag: string;
  sku: string;
  barcode: string;
  category: string;
  subcategory: string;
  brand: string;
  supplier: string;
  units: Array<{ id: string; unit_name: string; barcode: string; retailPrice: string }>;
  baseUnit: string;
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
  onDelete: (item: StockItem) => void;
  userRole: UserRole | null;
  hasPendingApproval?: boolean;
}

export function InventoryTableRow({ item, onEdit, onDelete, userRole, hasPendingApproval }: InventoryTableRowProps) {
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const barcodeUnits: BarcodePrintUnit[] = item.units.filter(unit => unit.barcode).map(unit => ({
    id: unit.id, name: unit.unit_name, barcode: unit.barcode, price: unit.retailPrice, copies: 1,
  }));
  const mounted = useHydrated();
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
        <Link href={`/inventory/product?id=${encodeURIComponent(String(item.id))}`} className="flex items-center justify-center gap-5 group" aria-label={`تفاصيل ${item.nameAr}`}>
          <div className="w-14 h-14 rounded-2xl bg-surface-container-high border border-white/5 flex-shrink-0 flex items-center justify-center overflow-hidden">
            {item.image ? (
              <Image src={item.image} alt={item.nameAr} width={56} height={56} className="object-cover w-full h-full" unoptimized />
            ) : (
              <span className="material-symbols-outlined text-on-surface-variant" aria-hidden="true">menu_book</span>
            )}
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#e5e2e1] group-hover:text-primary group-focus:text-primary">{item.nameAr}</span>
              {hasPendingApproval && (
                <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/25">
                  قيد المراجعة
                </span>
              )}
            </div>
            <p className="text-[10px] text-on-surface-variant">{item.nameEn}</p>
            {item.brand && <p className="text-xs text-[#e2bfb0]/70">{item.brand}</p>}
            {item.supplier && <p className="text-xs text-on-surface-variant">المورد: {item.supplier}</p>}
          </div>
        </Link>
      </td>

      {/* Barcode */}
      <td className="px-8 py-6 min-w-[150px] whitespace-nowrap text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-primary font-bold text-xs" dir="ltr">{item.units.find(unit => unit.unit_name === item.baseUnit)?.barcode || item.barcode || "—"}</span>
          <span className="text-[10px] opacity-60">باركود {item.baseUnit}</span>
          <span className="font-mono text-[10px] opacity-50" dir="ltr">كود الصنف: {item.sku}</span>
        </div>
      </td>

      {/* Category */}
      <td className="px-8 py-6 text-center min-w-[150px] whitespace-nowrap">
        <span className="px-4 py-1.5 bg-surface-container-highest text-[#e2bfb0]/80 rounded-full text-xs font-bold border border-white/5">
          {item.category}{item.subcategory ? ` / ${item.subcategory}` : ""}
        </span>
      </td>

      {/* Price - Hidden conditionally */}
      {canViewCost(userRole) && (
        <td className="px-8 py-6 min-w-[150px] whitespace-nowrap">
          <div className="text-xs leading-relaxed text-center">
            <p>
              <span className="opacity-50">تجزئة / {item.baseUnit}:</span>{" "}
              <span className="font-bold text-primary text-sm">{item.retailPrice}</span>
            </p>
            <p>
              <span className="opacity-50">جملة / {item.baseUnit}:</span>{" "}
              <span className="font-bold">{item.wholesalePrice}</span>
            </p>
          </div>
        </td>
      )}

      {/* Stock */}
      <td className="px-8 py-6 min-w-[200px] whitespace-nowrap">
        <div className="mx-auto w-full max-w-[200px]">
          <div className="flex justify-between text-xs mb-2 font-bold">
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
        <div className="flex items-center justify-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowBarcodeModal(true)}
            disabled={!barcodeUnits.length}
            className="h-9 px-3 rounded-full glass flex items-center justify-center text-xs font-bold text-[#e2bfb0] hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40"
            title={barcodeUnits.length ? "طباعة باركودات الوحدات" : "لا توجد باركودات للوحدات"}
            aria-label={`طباعة باركود ${item.nameAr}`}
          >
            باركود
          </button>

          {canEditProduct(userRole) && (
            <button
              type="button"
              disabled={hasPendingApproval}
              onClick={() => onEdit(item)}
              className="h-9 px-3 rounded-full glass flex items-center justify-center text-xs font-bold text-[#e2bfb0] hover:text-primary hover:border-primary/30 transition-all disabled:opacity-40 disabled:hover:text-[#e2bfb0] disabled:hover:border-transparent"
              title={hasPendingApproval ? "يوجد طلب تعديل أو حذف معلّق لهذا المنتج بانتظار قرار المدير" : `تعديل ${item.nameAr}`}
              aria-label={`تعديل ${item.nameAr}`}
            >
              تعديل
            </button>
          )}

          <Link href={`/inventory/product?id=${encodeURIComponent(String(item.id))}`}
            className="h-9 px-3 rounded-full glass flex items-center justify-center text-xs font-bold text-[#e2bfb0] hover:text-primary hover:border-primary/30 transition-all"
            aria-label={`تفاصيل وسجل ${item.nameAr}`}>
            التفاصيل والسجل
          </Link>
          {userRole === "ADMIN" && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="h-9 px-3 rounded-full border border-[#ffb4ab]/25 text-[#ffb4ab] hover:bg-[#ffb4ab]/10 transition-all flex items-center justify-center gap-1 text-xs font-bold"
              title={`حذف ${item.nameAr}`}
              aria-label={`حذف ${item.nameAr}`}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
              حذف
            </button>
          )}
        </div>
      </td>

      {/* Barcode Modal */}
      {showBarcodeModal && mounted && <BarcodePrintDialog productName={item.nameAr}
        units={barcodeUnits} selectByDefault={false} onClose={() => setShowBarcodeModal(false)}
        quantityHint="حدد الوحدات وعدد الملصقات؛ الرصيد الإجمالي لا يحدد عدد كل نوع وحدة." />}
    </tr>
  );
}
