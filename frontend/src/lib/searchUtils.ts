/**
 * Smart Arabic and Multilingual Search Utilities
 * Normalizes Arabic letters (alef variants, taa marbouta, yaa) and diacritics,
 * and performs multi-token partial matching so typing any word finds the record.
 */

export function normalizeSearchText(text: unknown): string {
  if (text == null) return "";
  return String(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove tashkeel/diacritics
    .replace(/[أإآء]/g, "ا") // normalize alef with hamza
    .replace(/[ة]/g, "ه") // normalize taa marbouta to haa
    .replace(/[ى]/g, "ي") // normalize alef maqsoura to yaa
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[#＃]/g, "")
    .trim();
}

/**
 * Checks if all words in `query` match anywhere in the provided `targets`.
 * E.g., searching "كتاب عربي" matches "كتاب اللغة العربية للصف الاول".
 */
export function matchesSearch(query: string, ...targets: (unknown)[]): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const combinedTarget = targets
    .map(t => normalizeSearchText(t))
    .filter(Boolean)
    .join(" ");

  if (!combinedTarget) return false;

  // Every word typed must be present in the target fields
  return tokens.every(token => combinedTarget.includes(token));
}
