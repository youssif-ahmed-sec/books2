type ScanKey = {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
};

export type BarcodeScanCapture = {
  value: string;
  firstAt: number;
  lastAt: number;
  maxGap: number;
};

export function emptyBarcodeScanCapture(): BarcodeScanCapture {
  return { value: "", firstAt: 0, lastAt: 0, maxGap: 0 };
}

function physicalAsciiKey(key: ScanKey): string | null {
  if (/^Key[A-Z]$/.test(key.code)) {
    const letter = key.code.slice(3).toLowerCase();
    return key.shiftKey ? letter.toUpperCase() : letter;
  }
  if (/^Digit[0-9]$/.test(key.code)) {
    const digit = Number(key.code.slice(5));
    return key.shiftKey ? ")!@#$%^&*("[digit] : String(digit);
  }
  if (/^Numpad[0-9]$/.test(key.code)) return key.code.slice(6);
  const punctuation: Record<string, [string, string]> = {
    Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"],
    BracketRight: ["]", "}"], Backslash: ["\\", "|"], Semicolon: [";", ":"],
    Quote: ["'", '"'], Comma: [",", "<"], Period: [".", ">"],
    Slash: ["/", "?"], Backquote: ["`", "~"], NumpadDecimal: [".", "."],
    NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"],
  };
  const pair = punctuation[key.code];
  return pair ? pair[Number(key.shiftKey)] : null;
}

export function recordBarcodeScanKey(capture: BarcodeScanCapture, key: ScanKey, now = performance.now()): void {
  if (["Shift", "Control", "Alt", "Meta"].includes(key.key)) return;
  if (key.altKey || key.ctrlKey || key.metaKey || key.repeat) {
    capture.value = "";
    return;
  }
  const ascii = physicalAsciiKey(key);
  if (!ascii) {
    capture.value = "";
    return;
  }
  const gap = now - capture.lastAt;
  if (!capture.value || gap > 120) {
    capture.value = ascii;
    capture.firstAt = now;
    capture.maxGap = 0;
  } else {
    capture.value += ascii;
    capture.maxGap = Math.max(capture.maxGap, gap);
  }
  capture.lastAt = now;
}

export function englishBarcodeFromScan(capture: BarcodeScanCapture, raw: string, now = performance.now()): string | null {
  const value = capture.value;
  capture.value = "";
  if (!/[\u0600-\u06ff\u0750-\u077f]/u.test(raw)) return null;
  const generatedCode = englishBarcodeFromArabicLayout(raw)?.toUpperCase();
  if (generatedCode && /^(?:UNIT|INV)-[A-F0-9]{8}$/.test(generatedCode)) return generatedCode;
  if (value.length < 4 || now - capture.lastAt > 250 || capture.maxGap > 120) return null;
  if ((capture.lastAt - capture.firstAt) / Math.max(1, value.length - 1) > 80) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

// Arabic (101) maps these physical QWERTY keys to Arabic letters on Windows.
const arabicKeyboardKeys = "ضصثقفغعهخحجدشسيبلاتنمكطئءؤرىةوزظ";
const englishKeyboardKeys = "QWERTYUIOP[]ASDFGHJKL;'ZXCVNM,./";
const arabicKeyboardToEnglish = new Map(
  Array.from(arabicKeyboardKeys, (letter, index) => [letter, englishKeyboardKeys[index]]),
);

export function englishBarcodeFromArabicLayout(raw: string): string | null {
  if (!/[\u0600-\u06ff\u0750-\u077f]/u.test(raw)) return null;
  const converted = raw.replaceAll("لا", "B").replaceAll("ﻻ", "B").split("").map(character => {
    const arabicDigit = "٠١٢٣٤٥٦٧٨٩".indexOf(character);
    if (arabicDigit >= 0) return String(arabicDigit);
    return arabicKeyboardToEnglish.get(character) || character;
  }).join("");
  return /^[\x21-\x7e]{4,128}$/.test(converted) ? converted : null;
}
