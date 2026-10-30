export function whatsappUrl(phone: string | null | undefined, message: string): string | null {
  let digits = (phone || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01[0125][0-9]{8}$/.test(digits)) digits = `2${digits}`;
  if (!/^[1-9][0-9]{9,14}$/.test(digits)) return null;
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`;
}

export function openWhatsApp(phone: string | null | undefined, message: string): boolean {
  const url = whatsappUrl(phone, message);
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
