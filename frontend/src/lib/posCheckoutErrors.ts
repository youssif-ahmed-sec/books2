import { errorMessage } from "@/lib/errors";

const checkoutErrors: Array<[RegExp, string]> = [
  [/Prices changed|Price missing|Sale price must be greater than zero/i, "تغيّر سعر صنف أو أصبح غير متاح. راجع السلة وأعد إضافة الصنف ثم حاول مجددًا."],
  [/Insufficient stock/i, "الكمية المتاحة لم تعد تكفي. راجع الأصناف والكميات في السلة."],
  [/Customer credit limit would be exceeded/i, "المتبقي على العميل سيتجاوز حده الائتماني. راجع المبلغ المستلم أو حد العميل مع المدير."],
  [/Active customer not found|Customer not found/i, "العميل المختار لم يعد متاحًا. اختر عميلًا آخر قبل إتمام البيع."],
  [/Deferred payment requires a registered customer/i, "البيع الآجل يحتاج عميلًا مسجلًا."],
  [/Received amount must be between zero and the sale total/i, "المبلغ المستلم يجب أن يكون من صفر إلى صافي الفاتورة."],
  [/Choose how the received amount was paid/i, "اختر طريقة دفع المبلغ المستلم."],
  [/Open a cash register shift/i, "افتح وردية الصندوق قبل تسجيل مبلغ نقدي."],
  [/Choose an active warehouse/i, "مخزن البيع غير متاح حاليًا. حدّث الصفحة قبل المحاولة."],
  [/Unit not found|Product is not available|Bundle has no components|Bundle component is unavailable/i, "أحد الأصناف أو الوحدات لم يعد متاحًا للبيع. راجع السلة."],
  [/Discount cannot exceed/i, "الخصم لا يمكن أن يتجاوز قيمة الأصناف."],
  [/Admin approval is required/i, "هذا التعديل يحتاج صلاحية المدير."],
  [/Request ID was already used/i, "استُخدمت محاولة البيع هذه ببيانات مختلفة. راجع آخر فاتورة قبل بدء بيع جديد."],
];

export function posCheckoutError(error: unknown): string {
  const raw = errorMessage(error, "");
  const known = checkoutErrors.find(([pattern]) => pattern.test(raw));
  if (known) return known[1];
  if (raw.includes("[object Object]")) return "بيانات البيع غير مقبولة. راجع الكميات والمبلغ المستلم ثم حاول مجددًا.";
  if (/[\u0600-\u06ff]/u.test(raw) && !raw.includes("تعذر الاتصال بالخادم") && !raw.includes("تعذر قراءة رد الخادم")) return raw;
  return "تعذر تأكيد نتيجة البيع. راجع آخر فاتورة، ثم أعد المحاولة من نفس السلة إذا لم تظهر. النظام يمنع تكرار البيع عند إعادة الطلب.";
}
