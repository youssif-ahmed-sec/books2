export type CustomerExportFormat = "csv" | "xlsx" | "pdf";

export type CustomerExportRow = {
  name: string;
  phone: string;
  type: string;
  city: string;
  purchases: number;
  balance: number;
  creditLimit: number;
};

const headings = ["اسم العميل", "الهاتف", "النوع", "المدينة", "إجمالي المشتريات", "المديونية", "الحد الائتماني"];
const cells = (row: CustomerExportRow) => [row.name, row.phone, row.type, row.city, row.purchases, row.balance, row.creditLimit];
const xmlText = (value: string | number) => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csv(rows: CustomerExportRow[]) {
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = typeof value === "string" && /^[\s\u0000-\u001F]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const text = "\uFEFF" + [headings, ...rows.map(cells)].map(row => row.map(escape).join(",")).join("\r\n");
  download(new Blob([text], { type: "text/csv;charset=utf-8" }), "العملاء.csv");
}

function crc32(data: Uint8Array) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zip(entries: Array<[string, string]>) {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    const fileName = encoder.encode(name);
    const data = encoder.encode(contents);
    const checksum = crc32(data);
    const header = new Uint8Array(30 + fileName.length);
    const local = new DataView(header.buffer);
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, fileName.length, true);
    header.set(fileName, 30);
    parts.push(header, data);

    const record = new Uint8Array(46 + fileName.length);
    const central = new DataView(record.buffer);
    central.setUint32(0, 0x02014B50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, fileName.length, true);
    central.setUint32(42, offset, true);
    record.set(fileName, 46);
    directory.push(record);
    offset += header.length + data.length;
  }
  const directoryLength = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054B50, true);
  footer.setUint16(8, entries.length, true);
  footer.setUint16(10, entries.length, true);
  footer.setUint32(12, directoryLength, true);
  footer.setUint32(16, offset, true);
  const bytes = new Uint8Array(offset + directoryLength + end.length);
  let cursor = 0;
  for (const part of [...parts, ...directory, end]) { bytes.set(part, cursor); cursor += part.length; }
  return new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function xlsx(rows: CustomerExportRow[]) {
  const sheetRows = [headings, ...rows.map(cells)].map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
      return typeof value === "number"
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
  const spreadsheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>${sheetRows}</sheetData></worksheet>`;
  download(zip([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="العملاء" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", spreadsheet],
  ]), "العملاء.xlsx");
}

function pdf(rows: CustomerExportRow[]) {
  const page = window.open("", "_blank", "width=1000,height=720");
  if (!page) throw new Error("اسمح بفتح نافذة الطباعة لحفظ ملف PDF");
  const body = rows.map(row => `<tr>${cells(row).map(cell => `<td>${xmlText(cell)}</td>`).join("")}</tr>`).join("");
  page.addEventListener("load", () => { page.focus(); page.print(); }, { once: true });
  page.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>العملاء</title><style>body{font-family:Arial,sans-serif;color:#171717;margin:24px}h1{font-size:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #aaa;padding:7px;text-align:center;overflow-wrap:anywhere}th{background:#eee}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}}</style></head><body><h1>قائمة العملاء</h1><table><thead><tr>${headings.map(label => `<th>${label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  page.document.close();
}

export function exportCustomers(rows: CustomerExportRow[], format: CustomerExportFormat) {
  if (format === "csv") csv(rows);
  else if (format === "xlsx") xlsx(rows);
  else pdf(rows);
}
