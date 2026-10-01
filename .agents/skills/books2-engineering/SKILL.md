---
name: books2-engineering
description: Navigate and verify changes to the books2 bookstore ERP backend, frontend, database, and local print agent.
---

# books2 engineering map

- `backend/main.py` mounts the FastAPI v1 routers and serves the exported frontend from `backend/static` when that directory exists. `frontend/next.config.ts` sets `output: "export"`; the client calls relative `/api/v1` URLs through `frontend/src/lib/api.ts`.
- `backend/models/` contains the SQLAlchemy schema. `backend/api/v1/` contains HTTP handlers; `backend/services/` contains the current order and product write logic. Inspect both layers and their Pydantic schemas before changing a contract.
- `backend/core/dependencies.py` defines role checks. Treat product cost, customer, financial, inventory, and order data as sensitive; verify server side authorization for each affected route rather than relying on frontend role checks.
- Supplier statements, balances, credit limits, opening balances, and payments are admin-only. Inventory controllers may manage supplier identity and inventory metadata, but must not receive or modify those financial fields.
- The sales report is for admin and senior sales; the inventory movement report is for admin and inventory controllers. Keep their API dependencies and frontend tabs aligned.
- `order_items.unit_id` references `product_units.id`. Product edits must preserve existing unit IDs and archive removed units; hard deletion breaks historical orders. Verify a product edit after a sale with foreign keys enforced.
- `backend/tests/conftest.py` reads `TEST_DATABASE_URL`, then calls `Base.metadata.drop_all()` and `create_all()` at setup and `drop_all()` at teardown. Run these tests only after verifying the URL points to an isolated disposable database. Never assume the presence of `TEST_DATABASE_URL` alone proves isolation.
- `backend/alembic/` holds migration source; distinguish it from the schema actually applied to any database. Inspect migration operations before running Alembic because the current initial revision contains alterations to preexisting tables.
- `print_agent/` is a separate Windows localhost service that receives receipt jobs and controls native printers. Check the browser to localhost boundary and actual printing behavior before changing it.
- WhatsApp webhook verification needs `WHATSAPP_VERIFY_TOKEN` and signed POST delivery needs `WHATSAPP_APP_SECRET`; the handler fails closed when either is absent. Deployed browser printing needs its exact origin in `PRINT_AGENT_ALLOWED_ORIGINS` on the local agent.

Do not copy environment values into reports or instructions. Check the current Git status before editing; generated Python cache files and `backend/.env` have been tracked in this repository.
