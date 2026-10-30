import { formatCurrency } from "@/lib/formatters";

export interface PrintableCustomer {
  name: string;
  phone: string;
  customer_type?: string;
  city?: string;
}

export interface PrintableStatementEntry {
  id: string;
  kind: string;
  order_id: string | null;
  public_number: number | null;
  at: string;
  amount: number;
  direction: "debit" | "credit";
  balance: number;
  method?: string;
}

export interface PrintableStatement {
  opening_balance: number;
  closing_balance: number;
  entries: PrintableStatementEntry[];
}

const kindLabels: Record<string, string> = {
  invoice: "فاتورة بيع",
  return: "استرجاع / استبدال",
  correction: "تعديل فاتورة",
  refund: "رد مبلغ",
  payment: "دفعة تحصيل",
};

function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printCustomerStatement(customer: PrintableCustomer, statement: PrintableStatement) {
  const page = window.open("", "_blank", "width=950,height=750");
  if (!page) {
    alert("يرجى السماح بفتح النوافذ المنبثقة لطباعة كشف الحساب");
    return;
  }

  const printDate = new Date().toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalDebits = statement.entries
    .filter(e => e.direction === "debit")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalCredits = statement.entries
    .filter(e => e.direction === "credit")
    .reduce((sum, e) => sum + e.amount, 0);

  const rowsHtml = statement.entries.map((entry, index) => {
    const entryDate = new Date(entry.at).toLocaleString("ar-EG", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const kindText = kindLabels[entry.kind] || (entry.kind === "payment" ? "دفعة" : entry.kind);
    const refText = entry.public_number ? `#${entry.public_number}` : "—";
    const debitText = entry.direction === "debit" ? `${formatCurrency(entry.amount)}` : "—";
    const creditText = entry.direction === "credit" ? `${formatCurrency(entry.amount)}` : "—";
    const methodText = entry.method ? ` (${entry.method})` : "";

    return `
      <tr>
        <td style="text-align: center;">${index + 1}</td>
        <td style="text-align: center; font-size: 11px;">${escapeHtml(entryDate)}</td>
        <td><strong>${escapeHtml(kindText)}</strong>${escapeHtml(methodText)}</td>
        <td style="text-align: center; font-family: monospace;">${escapeHtml(refText)}</td>
        <td style="text-align: end; color: #b91c1c; font-weight: bold;">${debitText}</td>
        <td style="text-align: end; color: #15803d; font-weight: bold;">${creditText}</td>
        <td style="text-align: end; font-weight: bold;">${formatCurrency(entry.balance)}</td>
      </tr>
    `;
  }).join("");

  page.document.write(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>كشف حساب عميل - ${escapeHtml(customer.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Cairo", Tahoma, sans-serif;
      color: #171717;
      background: #ffffff;
      margin: 20px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 2px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header h1 {
      font-size: 22px;
      margin: 0 0 4px 0;
      color: #1e3a8a;
    }
    .header p {
      margin: 0;
      font-size: 12px;
      color: #4b5563;
    }
    .badge {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      padding: 4px 10px;
      border-radius: 6px;
      font-weight: bold;
      font-size: 12px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      font-size: 12px;
    }
    .info-item {
      display: flex;
      gap: 8px;
    }
    .info-label {
      color: #64748b;
      font-weight: bold;
      min-width: 80px;
    }
    .info-value {
      color: #0f172a;
      font-weight: 600;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 12px;
      text-align: center;
    }
    .card-title {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 4px;
    }
    .card-value {
      font-size: 15px;
      font-weight: bold;
      color: #0f172a;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 10px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: bold;
      text-align: start;
    }
    tfoot td {
      background: #f8fafc;
      font-weight: bold;
    }
    .footer-note {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px dashed #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #64748b;
    }
    @page {
      size: A4 portrait;
      margin: 12mm;
    }
    @media print {
      body { margin: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>كشف حساب عميل</h1>
      <p>تاريخ ووقت الطباعة: ${escapeHtml(printDate)}</p>
    </div>
    <div style="text-align: end;">
      <span class="badge">نظام إدارة المكتبة</span>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-item">
      <span class="info-label">اسم العميل:</span>
      <span class="info-value">${escapeHtml(customer.name)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">رقم الهاتف:</span>
      <span class="info-value" dir="ltr">${escapeHtml(customer.phone)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">المدينة:</span>
      <span class="info-value">${escapeHtml(customer.city || "—")}</span>
    </div>
    <div class="info-item">
      <span class="info-label">نوع العميل:</span>
      <span class="info-value">${escapeHtml(customer.customer_type || "تجزئة")}</span>
    </div>
  </div>

  <div class="summary-cards">
    <div class="card">
      <div class="card-title">الرصيد السابق</div>
      <div class="card-value">${formatCurrency(statement.opening_balance)}</div>
    </div>
    <div class="card">
      <div class="card-title">إجمالي المبيعات (مدين)</div>
      <div class="card-value" style="color: #b91c1c;">${formatCurrency(totalDebits)}</div>
    </div>
    <div class="card">
      <div class="card-title">إجمالي التحصيلات (دائن)</div>
      <div class="card-value" style="color: #15803d;">${formatCurrency(totalCredits)}</div>
    </div>
    <div class="card" style="border-color: #2563eb; background: #eff6ff;">
      <div class="card-title" style="color: #1e3a8a; font-weight: bold;">الرصيد الحالي المستحق</div>
      <div class="card-value" style="color: #1d4ed8;">${formatCurrency(statement.closing_balance)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 35px; text-align: center;">#</th>
        <th style="width: 130px; text-align: center;">التاريخ والوقت</th>
        <th>نوع الحركة</th>
        <th style="width: 80px; text-align: center;">رقم المرجع</th>
        <th style="width: 100px; text-align: end;">مدين (+)</th>
        <th style="width: 100px; text-align: end;">دائن (−)</th>
        <th style="width: 110px; text-align: end;">الرصيد بعد الحركة</th>
      </tr>
    </thead>
    <tbody>
      ${statement.entries.length === 0 
        ? `<tr><td colspan="7" style="text-align: center; padding: 20px; color: #64748b;">لا توجد حركات مسجلة خلال الفترة</td></tr>`
        : rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align: end; font-weight: bold;">الإجماليات:</td>
        <td style="text-align: end; color: #b91c1c; font-weight: bold;">${formatCurrency(totalDebits)}</td>
        <td style="text-align: end; color: #15803d; font-weight: bold;">${formatCurrency(totalCredits)}</td>
        <td style="text-align: end; font-weight: bold; color: #1d4ed8;">${formatCurrency(statement.closing_balance)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer-note">
    <span>كشف حساب صادر آلياً عن النظام المحاسبي</span>
  </div>
</body>
</html>`);

  page.document.close();
  page.focus();
  setTimeout(() => {
    page.print();
  }, 250);
}
