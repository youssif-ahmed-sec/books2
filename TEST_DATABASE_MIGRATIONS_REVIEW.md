# Test database migration review

The 14 migrations listed below were applied to the separate test database on 2026-10-25. This review began from a read-only inspection of its pre-migration state.

- Pre-migration Alembic revision: `d35a6f1b8c42`.
- Repository head: `c5a92d7e104b`.
- Before migration the test database had 38 public tables, one user, one product, one inventory balance, and no orders.
- After migration a fresh connection confirmed revision `c5a92d7e104b` and 45 public tables. Counts in all 37 original application tables were preserved during the upgrade. The `users.full_name` column and operational role values were verified.
- A compressed backup of all 41 pre-migration data rows was stored outside the repository in the local temporary directory. The [pre-migration table columns, constraints, indexes, and RLS status](TEST_DATABASE_SCHEMA_REVIEW.md) are a review snapshot, not a restore script.

## Migration source in dependency order

The upgrade to the repository head applied these 14 source revisions in dependency order.

1. [Invoice public numbers](backend/alembic/versions/e24a6f9b0c31_order_public_numbers.py) — adds a sequence and numbers any existing orders.
2. [Count approval sessions](backend/alembic/versions/a62e4d91c8b7_count_approval_sessions.py) — adds a session table, count columns, indexes, and constraints.
3. [Supplier payment methods](backend/alembic/versions/b93e4c2a8d17_supplier_payment_methods.py).
4. [Supplier due allocations](backend/alembic/versions/e52b74c9a610_supplier_due_allocations.py) — adds due dates and an allocation table.
5. [Merge invoice-number branch](backend/alembic/versions/f1a8c9d2e430_merge_public_numbers.py).
6. [Merge count-approval branch](backend/alembic/versions/d71f3a0b65c2_merge_count_approval.py).
7. [Product approval queue](backend/alembic/versions/e85f4d2a9c10_product_approvals.py).
8. [User full names](backend/alembic/versions/a74c1f6d2e90_user_full_names.py) — adds nullable `users.full_name` and a nonblank-name check.
9. [Customer addresses](backend/alembic/versions/b93a62e7c501_customer_addresses.py).
10. [Wallet fee and discount snapshot](backend/alembic/versions/2f1d00776881_pos_wallet_fee_and_discount_percent.py).
11. [Operational roles](backend/alembic/versions/f6b2de16fcc4_add_operational_role_enum_values.py).
12. [Expected collection method](backend/alembic/versions/c7e1a42b9f30_pos_expected_collection_method.py).
13. [Product supplier links and prices](backend/alembic/versions/d18a5c72b640_product_supplier_prices.py) — copies existing supplier associations and prices; adds a name guard trigger and possibly a unique index.
14. [Customer due dates and allocations](backend/alembic/versions/c5a92d7e104b_customer_due_dates_and_allocations.py).

The repository's `backend/tests/conftest.py` drops and recreates tables, so that suite must not run against this non-disposable test database. The data export is not a complete PostgreSQL schema backup.
