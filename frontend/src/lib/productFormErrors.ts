import type { ZodIssue } from "zod";

const productFieldNames: Record<string, string> = {
  nameAr: "اسم المنتج بالعربي",
  nameEn: "اسم المنتج بالإنجليزي",
  barcode: "باركود العلبة",
  category_id: "التصنيف",
  subCategory_id: "الفئة الفرعية",
  brand_id: "العلامة التجارية",
  supplier_id: "المورد الأساسي",
  costPrice: "سعر الشراء",
  vatRate: "الضريبة",
  minStockLevel: "الحد الأدنى للمخزون",
  maxStockLevel: "الحد الأقصى للمخزون",
};

const unitFieldNames: Record<string, string> = {
  name: "اسم الوحدة",
  conversionFactor: "عامل التحويل",
  sku: "الباركود (حروف وأرقام إنجليزية)",
  stock: "كمية المخزون",
  retailPrice: "سعر المستهلك",
  semiWholesalePrice: "سعر نصف الجملة",
  wholesalePrice: "سعر الجملة",
  superWholesalePrice: "سعر سوبر جملة",
  vipPrice: "سعر كبار العملاء",
};

export function productFormErrors(issues: ZodIssue[], units: Array<{ id: string; name: string }>) {
  const fields: string[] = [];
  const labels: string[] = [];
  for (const issue of issues) {
    const field = String(issue.path[0] || "");
    if (field === "units") {
      if (issue.path.length === 1) {
        fields.push("units");
        labels.push("وحدة واحدة على الأقل");
        continue;
      }
      const index = Number(issue.path[1]);
      const unit = units[index];
      const unitField = String(issue.path[2] || "");
      fields.push(`${unitField}_${unit?.id ?? index}`);
      labels.push(`${unit?.name || `الوحدة ${index + 1}`}: ${unitFieldNames[unitField] || "بيانات الوحدة"}`);
      continue;
    }
    fields.push(field);
    labels.push(productFieldNames[field] || "بيانات المنتج");
  }
  return {
    fields: [...new Set(fields)],
    message: `يرجى استكمال أو تصحيح: ${[...new Set(labels)].join("، ")}.`,
  };
}

export function productSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/duplicate|already exists|unique constraint/i.test(message)) {
    return "كود المنتج أو باركود العلبة أو إحدى الوحدات مستخدم بالفعل. راجعه ثم حاول مرة أخرى.";
  }
  if (/forbidden|not authorized|permission/i.test(message)) {
    return "ليس لديك صلاحية لحفظ المنتجات.";
  }
  if (/^\p{Script=Arabic}/u.test(message)) return message;
  return "تعذر حفظ المنتج. راجع البيانات وحاول مرة أخرى.";
}
