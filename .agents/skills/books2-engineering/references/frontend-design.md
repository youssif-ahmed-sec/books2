# Frontend design decisions

Read this when changing POS cards, customer entry, or shared surfaces.

- Start from the rendered route and its available content width. POS product results can occupy a narrow column beside customer and cart panels; a card must retain product name, SKU, available stock, price, and add action without clipping in Arabic RTL.
- Keep the product name and price as the two scan anchors. Stock is secondary status. Use one primary action and the existing surface, field, button, and text tokens from `frontend/src/app/globals.css`. Avoid a saturated border, colored rail, badge, shadow, and lift on the same card. Check both themes because hardcoded dark surfaces previously caused mismatches.
- Keep page and section headings concise. Add helper text only for a rule, consequence, or action that the label and controls do not already explain; avoid repeating each heading with a subtitle or adding decorative marketing copy to work screens.
- Keep customer entry in its existing workflow. Group identity/contact, sale settings, and extra details with visible headings; pair each control with a programmatic label and place its validation next to it. Keep the save/cancel actions visible at the bottom of the long customer drawer.
- For a data list that cannot fit the mobile content area, use compact records with the same fields and actions as the desktop table. Keep `data-search-id` on the visible record so section search can reveal it.
- Review at narrow and desktop content widths in light and dark themes, including long names/SKUs, zero stock, missing price, errors, and disabled actions. Browser review is required by `frontend/AGENTS.md`; compilation cannot establish visual quality.

References that informed these decisions: [Carbon forms](https://www.carbondesignsystem.com/building-blocks/core/patterns/forms) describes grouping fields and asking only for useful information; [Carbon modal guidance](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines) defines header, body, and footer; [USWDS form guidance](https://designsystem.digital.gov/components/form/) requires matching label/control order and nearby validation. These are design guidance, not a mandate to copy another design system's visuals.

## Current product references (reviewed 2026-10-18)

- [Shopify POS](https://www.shopify.com/pos/features) centers adding products through search, tiles, or barcode scanning. [Square's September 2026 checkout update](https://squareup.com/us/en/feature-log) keeps the live cart visible while staff choose items. For this bookstore, preserve the existing barcode/search and cart path; consider shortcuts only if real cashier usage shows they help.
- [Shopify's app layout guidance](https://shopify.dev/docs/apps/design/layout) recommends consistent information density within a page and at most one primary action per interactive card. Its [form guidance](https://shopify.dev/docs/apps/design/user-experience/forms) recommends titled groups once a form grows beyond five inputs. Apply these as review questions against the current workflow, not as imported components.
- [Linear's 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh) reduces visual noise by making navigation and borders recede behind the task content. For books2, compare the sidebar, cards, table rows, and overlays together in both themes; a polished isolated card can still make the screen less coherent.
