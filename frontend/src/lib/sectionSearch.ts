import { fetchApi } from "@/lib/api";
import { readSectionSnapshot, sectionSnapshotRevision } from "@/lib/sectionSnapshot";

export type SectionSearchResult = { id: string; label: string; detail?: string; href: string };
type Row = Record<string, unknown>;

const text = (value: unknown) => value == null ? "" : String(value);
const matches = (query: string, ...values: unknown[]) => values.some(value => text(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
const target = (path: string, id: string) => `${path}?focus=${encodeURIComponent(id)}`;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const loaded = new Map<string, { revision: number; token: string | null; data: Promise<Row[]> }>();

function list(section: string, endpoint: string, select: (snapshot: unknown) => unknown = value => value): Promise<Row[]> {
  const snapshot = readSectionSnapshot<unknown>(section);
  if (snapshot !== null) return Promise.resolve(rows(select(snapshot)));
  const revision = sectionSnapshotRevision();
  const token = typeof window === "undefined" ? null : localStorage.getItem("access_token");
  const previous = loaded.get(section);
  if (previous?.revision === revision && previous.token === token) return previous.data;
  const data = fetchApi(endpoint, { silentErrors: true }).then((result: unknown) => rows(result));
  loaded.set(section, { revision, token, data });
  data.catch(() => { if (loaded.get(section)?.data === data) loaded.delete(section); });
  return data;
}

export function sectionSearchLabel(pathname: string): string | null {
  if (pathname === "/inventory" || pathname === "/inventory/product") return "صنف أو باركود في المخزون";
  if (pathname === "/suppliers") return "مورد بالاسم أو الهاتف أو البريد";
  if (pathname === "/categories") return "تصنيف أو تصنيف فرعي";
  if (pathname === "/offers") return "عرض";
  if (pathname === "/customers") return "عميل بالاسم أو الهاتف";
  if (pathname === "/orders") return "فاتورة برقمها";
  if (pathname === "/purchases") return "أمر شراء برقم الأمر أو المورد أو الصنف";
  if (pathname === "/purchases/legacy") return "أمر شراء قديم برقم الأمر";
  if (pathname === "/audit") return "عملية في سجل التدقيق";
  if (pathname === "/settings") return "مستخدم بالبريد أو الاسم";
  if (pathname === "/financials") return "حركة مالية بالوصف أو التصنيف";
  if (pathname === "/cash-register") return "وردية برقمها";
  return null;
}

export async function searchSection(pathname: string, query: string, signal?: AbortSignal): Promise<SectionSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (pathname === "/inventory" || pathname === "/inventory/product") {
    const response = await fetchApi(`/products?is_bundle=false&search=${encodeURIComponent(q)}&limit=20`, { signal, silentErrors: true });
    return rows(response.data).map(item => ({ id: text(item.id), label: text(item.name_ar), detail: text(item.sku), href: `/inventory/product?id=${encodeURIComponent(text(item.id))}` }));
  }
  if (pathname === "/suppliers") {
    const response = await fetchApi(`/suppliers?search=${encodeURIComponent(q)}&limit=20`, { signal, silentErrors: true });
    return rows(response.data).map(item => ({ id: text(item.id), label: text(item.name), detail: text(item.phone), href: target("/suppliers", text(item.id)) }));
  }
  if (pathname === "/categories") {
    const snapshot = readSectionSnapshot<{ categories: Row[]; subcategories: Row[] }>("categories");
    const [categories, subcategories] = snapshot ? [snapshot.categories, snapshot.subcategories] : await Promise.all([
      list("categories-raw", "/products/categories"), list("subcategories-raw", "/products/subcategories"),
    ]);
    return ([...rows(categories).map(item => ({ ...item, kind: "تصنيف" })), ...rows(subcategories).map(item => ({ ...item, kind: "تصنيف فرعي" }))] as Row[])
      .filter(item => matches(q, item.name_ar, item.name_en)).map(item => ({ id: text(item.id), label: text(item.name_ar), detail: text(item.kind), href: target("/categories", text(item.id)) }));
  }
  if (pathname === "/offers") {
    return (await list("offers", "/offers")).filter(item => matches(q, item.name, item.id)).map(item => ({ id: text(item.id), label: text(item.name), href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/customers") {
    return (await list("customers-list", "/customers")).filter(item => matches(q, item.name, item.phone, item.email)).map(item => ({ id: text(item.id), label: text(item.name), detail: text(item.phone), href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/orders") {
    let completedInvoice: SectionSearchResult[] = [];
    if (/^[1-9][0-9]*$/.test(q) || /^[0-9a-f]{12}$/i.test(q) || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(q)) {
      const invoice = await fetchApi(`/returns/lookup/${encodeURIComponent(q)}`, { signal, silentErrors: true })
        .catch(() => null) as { id: string } | null;
      if (invoice) completedInvoice = [{ id: invoice.id, label: `فاتورة ${invoice.id.slice(-12)}`, href: target("/orders", invoice.id) }];
    }
    const data = await list("orders-list", "/orders?group=returnable&limit=50&offset=0");
    return [...completedInvoice, ...data.filter(item => matches(q, item.public_number, item.id))
      .map(item => ({ id: text(item.id), label: `فاتورة ${text(item.public_number)}`, detail: text(item.status), href: target("/orders", text(item.id)) }))];
  }
  if (pathname === "/purchases" || pathname === "/purchases/legacy") {
    const endpoint = pathname === "/purchases" ? "/purchase-documents" : "/purchases";
    const data = pathname === "/purchases" ? await list("purchase-documents", endpoint, snapshot => (snapshot as { documents: unknown }).documents) : await list("purchases", endpoint, snapshot => (snapshot as { purchases: unknown }).purchases);
    return data.filter(item => matches(q, item.id, item.supplier_name, ...rows(item.lines).map(line => line.product_name)))
      .map(item => ({ id: text(item.id), label: text(item.supplier_name) || `أمر ${text(item.id).slice(0, 8)}`, detail: text(item.id).slice(0, 8), href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/audit") {
    return rows(await fetchApi(`/audit?search=${encodeURIComponent(q)}&limit=20`, { signal, silentErrors: true }))
      .map(item => ({ id: text(item.id), label: text(item.action), detail: `${text(item.entity_type)} ${text(item.entity_id).slice(0, 8)}`, href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/settings") {
    return (await list("settings-users", "/auth/users")).filter(item => matches(q, item.full_name, item.email, item.username, item.role))
      .map(item => ({ id: text(item.id), label: text(item.full_name || item.username || item.email), detail: text(item.role), href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/financials") {
    const snapshot = readSectionSnapshot<{ expenses: Row[]; incomes: Row[] }>("financials");
    const [expenses, incomes] = snapshot ? [snapshot.expenses, snapshot.incomes] : await Promise.all([
      list("expenses-raw", "/financials/expenses"), list("incomes-raw", "/financials/incomes"),
    ]);
    return ([...rows(expenses).map(item => ({ ...item, kind: "مصروف" })), ...rows(incomes).map(item => ({ ...item, kind: "إيراد" }))] as Row[])
      .filter(item => matches(q, item.description, item.category, item.source, item.amount))
      .map(item => ({ id: text(item.id), label: text(item.description || item.category || item.source), detail: text(item.kind), href: target(pathname, text(item.id)) }));
  }
  if (pathname === "/cash-register") {
    return (await list("cash-register", "/cash-register/history", snapshot => (snapshot as { history: unknown }).history)).filter(item => matches(q, item.id, item.status))
      .map(item => ({ id: text(item.id), label: `وردية ${text(item.id).slice(0, 8)}`, detail: text(item.status), href: target(pathname, text(item.id)) }));
  }
  return [];
}
