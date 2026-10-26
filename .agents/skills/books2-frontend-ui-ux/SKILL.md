---
name: books2-frontend-ui-ux
description: Review or change the books2 frontend and UI/UX, including POS, catalog, navigation, themes, and customer journeys; use the current code and browser to verify audit findings.
---

# Books2 frontend and UI/UX

Use this with `../books2-engineering/SKILL.md` and `frontend/AGENTS.md`. For POS cards, customer entry, and shared surfaces, read `../books2-engineering/references/frontend-design.md`.

## Audit findings are leads

The October 2026 `FRONTEND_UI_UX_AUDIT_REPORT_EN.md` in the parent workspace records both prior working-tree changes and proposed work. Confirm each claim against the current revision before changing code. Mark it resolved, partial, still reproducible, or a proposed feature. A build proves compilation; it does not prove that a menu stopped flickering, a layout fits, contrast meets WCAG, or blur performs better. Measure contrast and inspect the rendered route in both themes and actual content widths before making those claims. Do not infer virtualization from a scrollable dropdown.

## Preserve the bookstore workflow

- Keep one shared operational shell and permission-aware navigation. A hidden link is not access control; direct routes and APIs still need their role checks.
- Keep section search scoped and bounded as described in the engineering skill. Treat the report's cross-module `Ctrl+K` palette as a separate product proposal: establish role-filtered results, data exposure, and navigation behavior before implementing it.
- For barcode scans, distinguish an exact unit match from an ambiguous product match. Verify the chosen unit, customer price tier, stock limit, cart update, error feedback, and repeat scan. Shortcuts must not fire inside dialogs or while a sale is processing; never silently submit a financial transaction.
- The cash-denomination calculator is user-approved. For a credit sale with a remaining balance, `backend/services/order_service.py` currently requires both `expected_collection_method` and `next_due_date`; keep the POS validation and labels aligned with that contract. Changing received amount, collection method, invoice-free returns, or wholesale prices requires checking the API and financial/inventory rules first.
- Keep product pricing values visible or reveal validation errors before hiding any tier behind progressive disclosure. Hiding a generated price can cause an unnoticed sale price.
- Product-image conversion must honor the upload endpoint's accepted MIME types and size limit, preserve a fallback, and show upload failures. Cloudinary `f_auto` belongs in delivery URLs, not incoming upload transformations; measure actual stored and delivered sizes before claiming savings. Image URL lookup, cropping, and barcode metadata fetching are separate integrations, not consequences of compression.
- Display Egyptian pounds consistently. Check the current formatter and all affected callers before introducing or replacing a money helper; do not mix date-localization choices with currency formatting.
- Customer statements may be prepared as a PDF and printed through the browser, as approved by the user. Escape customer and statement data before inserting it into printable HTML. Invoice, receipt, and barcode print jobs use the local print agent; a queued job is not proof of physical printing.

## Strict Design & Typography Invariants (Mandatory Across All Agents)

- **No Parentheses in UI Texts/Labels:** Never use parentheses `(` `)` in text, labels, counts, badges, or summaries. Use clean separators like `·` or clear phrasing instead (e.g., `متكافئ · 0.00 ج.م` instead of `متكافئ (0.00 ج.م)`, and `عمليات سابقة · 5` instead of `عمليات سابقة (5)`).
- **Arabic Typography Integrity:** Strictly preserve the system Arabic font (`"Noto Sans Arabic"`). Never wrap Arabic words, sentences, or phrases in `font-mono` or monospace fonts, as this breaks Arabic font rendering. Use `tabular-nums` on numbers only when numeric column alignment is needed, never on Arabic text.
- **Zero Emojis:** Strictly prohibited. Do not add emojis anywhere in the UI, toasts, badges, or headers.
- **No Verbose Clutter or English Badges:** Keep pages focused and quiet. Do not invent subtitles, explanatory captions, decorative English badges (like `POS Returns`), or extraneous status pills in page headers unless explicitly requested.
- **Page Headings:** Main section titles must use `<h1 className="app-heading">` matching `inventory`, `orders`, and `customers`, with no bottom border divider lines (`border-b`) underneath.
- **Sidebar Organization:** In the mobile drawer, show direct functional links without outer parent category wrappers. On desktop, maintain the brand background without separator lines.
- **Returns & Exchanges UX:**
  - **Wallet 1% Fee Non-Refundable:** Any 1% wallet fee collected at order time is strictly non-refundable and automatically excluded from customer refund calculations. Display a clear, quiet notice on wallet-paid returns without parentheses.
  - **No Return Confirmation Checkbox:** Do not require a checkbox confirmation before executing returns; the user submits directly after reviewing the amounts.
  - **Returns Search:** Keep the sole visible search in TopNav. Invoice lookup supports public number, customer name, phone, and barcode with live suggestions; after selecting an exchange, use the same top slot to find replacement products.

## Acceptance check

For each affected journey, inspect labels, focus, disabled reasons, empty/loading/error states, keyboard and pointer use, Arabic RTL, light/dark themes, narrow and desktop content widths, and the relevant role. Exercise the action through its request and response where safe. Run focused lint/type/build checks, then record exactly what browser and device evidence exists. Report remaining audit items explicitly instead of upgrading a partial change to “fixed.”
