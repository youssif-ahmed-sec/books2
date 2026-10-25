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

## Acceptance check

For each affected journey, inspect labels, focus, disabled reasons, empty/loading/error states, keyboard and pointer use, Arabic RTL, light/dark themes, narrow and desktop content widths, and the relevant role. Exercise the action through its request and response where safe. Run focused lint/type/build checks, then record exactly what browser and device evidence exists. Report remaining audit items explicitly instead of upgrading a partial change to “fixed.”
