export function whatsappNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[٠-٩۰-۹]/g, value => {
    const index = "٠١٢٣٤٥٦٧٨٩".indexOf(value);
    return String(index >= 0 ? index : "۰۱۲۳۴۵۶۷۸۹".indexOf(value));
  });
  const compact = digits.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) return null;
  if (/^01\d{9}$/.test(compact)) return `20${compact.slice(1)}`;
  const international = compact.startsWith("00") ? compact.slice(2) : compact.replace(/^\+/, "");
  if (international.startsWith("20") && !/^20\d{10}$/.test(international)) return null;
  if (!/^[1-9]\d{7,14}$/.test(international)) return null;
  if (!compact.startsWith("+") && !compact.startsWith("00") && !international.startsWith("20")) return null;
  return international;
}

export function purchaseChatUrl(phone: string, message: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}
