<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Frontend handoff check

The browser is the acceptance check for user-facing work. A successful lint, TypeScript check, or build proves only that code compiles. Before reporting a change complete:

1. Identify the affected routes, user roles, data states, and actions. For each important action, check its visible label, placement, enabled/disabled state, confirmation, request, success/error feedback, and refreshed data. Do not silently hide an expected action when it is unavailable for the current account; show its disabled state and the reason when that is safe. Keep server-side authorization authoritative. In user management, check the current admin, another admin, and a non-admin account; never offer a working self-delete or self-deactivation control.
2. Inspect the rendered route at desktop and narrow widths in light and dark themes. Use the actual content width after the sidebar, adjacent forms, and modals, not the viewport alone. Check Arabic RTL alignment, label spacing and size, dropdowns, table columns and horizontal scrolling, action visibility, focus, and overlays. A table that requires sideways scrolling at a common width needs a usable card or compact layout with the same actions.
3. Check loading, empty, populated, and failed-request states, plus direct URL access by an unauthorized role. Exercise the affected journey in a browser, including returning from another sidebar section without losing useful loaded data or a draft. Do not mutate real production records merely to check a state; use safe existing data or an isolated environment.
4. Run lint and a production build. After a frontend build, run `backend/scripts/package_frontend.py` from the repository root before deployment. After deployment, confirm the live route serves the newly packaged version and inspect it in the browser; a successful upload or health response alone is insufficient.

Fix discrepancies before handoff. Report which routes, widths, themes, roles, and states were actually checked, and name any that could not be checked. Do not claim the entire frontend is error-free from one route or from a build alone.

## Strict Design & Typography Invariants (Mandatory Across All Agents)

- **No Parentheses in UI Texts/Labels:** Never use parentheses `(` `)` in text, labels, counts, badges, or summaries. Use clean separators like `·` or clear phrasing instead (e.g., `متكافئ · 0.00 ج.م` instead of `متكافئ (0.00 ج.م)`, and `عمليات سابقة · 5` instead of `عمليات سابقة (5)`).
- **Arabic Typography Integrity:** Strictly preserve the system Arabic font (`"Noto Sans Arabic"`). Never wrap Arabic words, sentences, or phrases in `font-mono` or monospace fonts, as this breaks Arabic font rendering. Use `tabular-nums` on numbers only when numeric column alignment is needed, never on Arabic text.
- **Zero Emojis:** Strictly prohibited. Do not add emojis anywhere in the UI, toasts, badges, or headers.
- **No Verbose Clutter or English Badges:** Keep pages focused and quiet. Do not invent subtitles, explanatory captions, decorative English badges (like `POS Returns`), or extraneous status pills in page headers unless explicitly requested.
- **Page Headings:** Main section titles must use `<h1 className="app-heading">` matching `inventory`, `orders`, and `customers`, with no bottom border divider lines (`border-b`) underneath.
- **Sidebar Organization:** In the mobile drawer, show direct functional links without outer parent category wrappers. On desktop, maintain the brand background without separator lines.

