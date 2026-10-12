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
