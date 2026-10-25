# Test database schema — pre-migration snapshot

This document records the `public` schema of the separate test database **before** the 2026-10-25 upgrade. It contains no connection string, passwords, or table rows. It is a historical review aid, not a restore script.

Snapshot Alembic revision: `d35a6f1b8c42`. Public tables: **38**. The database was subsequently upgraded to `c5a92d7e104b` and has 45 public tables.

## `alembic_version`

Row-level security: enabled.

```sql
-- Columns in public.alembic_version
version_num character varying NOT NULL;
```

Constraints:

- `alembic_version_pkc`: `PRIMARY KEY (version_num)`

Indexes:

```sql
CREATE UNIQUE INDEX alembic_version_pkc ON public.alembic_version USING btree (version_num);
```

## `audit_logs`

Row-level security: enabled.

```sql
-- Columns in public.audit_logs
id uuid NOT NULL;
user_id uuid NOT NULL;
action character varying NOT NULL;
entity_type character varying;
entity_id character varying;
old_value jsonb;
new_value jsonb;
ip_address character varying;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `audit_logs_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX audit_logs_pkey ON public.audit_logs USING btree (id);
```

## `brands`

Row-level security: enabled.

```sql
-- Columns in public.brands
id uuid NOT NULL;
name_en character varying NOT NULL;
name_ar character varying NOT NULL;
is_deleted boolean;
```

Constraints:

- `brands_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX brands_pkey ON public.brands USING btree (id);
```

## `cash_adjustments`

Row-level security: enabled.

```sql
-- Columns in public.cash_adjustments
id uuid NOT NULL;
shift_id uuid NOT NULL;
user_id uuid NOT NULL;
amount numeric NOT NULL;
reason character varying NOT NULL;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `cash_adjustments_pkey`: `PRIMARY KEY (id)`
- `cash_adjustments_shift_id_fkey`: `FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)`
- `cash_adjustments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

Indexes:

```sql
CREATE UNIQUE INDEX cash_adjustments_pkey ON public.cash_adjustments USING btree (id);
CREATE INDEX ix_cash_adjustments_shift_id ON public.cash_adjustments USING btree (shift_id);
```

## `cash_shifts`

Row-level security: enabled.

```sql
-- Columns in public.cash_shifts
id uuid NOT NULL;
user_id uuid NOT NULL;
opening_cash numeric NOT NULL;
closing_cash numeric;
expected_cash numeric;
status character varying NOT NULL;
opened_at timestamp with time zone DEFAULT now();
closed_at timestamp with time zone;
```

Constraints:

- `cash_shifts_pkey`: `PRIMARY KEY (id)`
- `cash_shifts_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `ck_cash_shift_nonnegative`: `CHECK (((opening_cash >= (0)::numeric) AND ((closing_cash IS NULL) OR (closing_cash >= (0)::numeric))))`

Indexes:

```sql
CREATE UNIQUE INDEX cash_shifts_pkey ON public.cash_shifts USING btree (id);
CREATE INDEX ix_cash_shifts_user_id ON public.cash_shifts USING btree (user_id);
```

## `categories`

Row-level security: enabled.

```sql
-- Columns in public.categories
id uuid NOT NULL;
name_en character varying NOT NULL;
name_ar character varying NOT NULL;
is_deleted boolean;
```

Constraints:

- `categories_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id);
```

## `customer_interactions`

Row-level security: enabled.

```sql
-- Columns in public.customer_interactions
id uuid NOT NULL;
customer_id uuid NOT NULL;
user_id uuid NOT NULL;
channel character varying NOT NULL;
note text NOT NULL;
follow_up_at timestamp with time zone;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `customer_interactions_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES customers(id)`
- `customer_interactions_pkey`: `PRIMARY KEY (id)`
- `customer_interactions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

Indexes:

```sql
CREATE UNIQUE INDEX customer_interactions_pkey ON public.customer_interactions USING btree (id);
CREATE INDEX ix_customer_interactions_customer_id ON public.customer_interactions USING btree (customer_id);
```

## `customers`

Row-level security: enabled.

```sql
-- Columns in public.customers
id uuid NOT NULL;
name character varying NOT NULL;
phone character varying;
whatsapp_number character varying;
email character varying;
address character varying;
city character varying;
customer_type customertypeenum NOT NULL;
price_level pricelevelenum NOT NULL;
balance numeric NOT NULL;
credit_limit numeric NOT NULL;
tags json;
notes text;
purchase_count integer NOT NULL;
total_purchases numeric NOT NULL;
average_purchase numeric NOT NULL;
last_purchase_date timestamp with time zone;
favorite_categories json;
is_active boolean;
is_deleted boolean;
created_at timestamp with time zone DEFAULT now();
updated_at timestamp with time zone;
```

Constraints:

- `customers_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id);
CREATE INDEX ix_customers_id ON public.customers USING btree (id);
CREATE INDEX ix_customers_name ON public.customers USING btree (name);
CREATE INDEX ix_customers_phone ON public.customers USING btree (phone);
CREATE INDEX ix_customers_whatsapp_number ON public.customers USING btree (whatsapp_number);
```

## `expenses`

Row-level security: enabled.

```sql
-- Columns in public.expenses
id uuid NOT NULL;
category character varying NOT NULL;
amount numeric NOT NULL;
description character varying;
expense_date timestamp with time zone;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `expenses_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX expenses_pkey ON public.expenses USING btree (id);
CREATE INDEX ix_expenses_category ON public.expenses USING btree (category);
CREATE INDEX ix_expenses_id ON public.expenses USING btree (id);
```

## `global_units`

Row-level security: enabled.

```sql
-- Columns in public.global_units
id uuid NOT NULL;
name character varying NOT NULL;
conversion_factor numeric NOT NULL;
is_deleted boolean;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `global_units_name_key`: `UNIQUE (name)`
- `global_units_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX global_units_name_key ON public.global_units USING btree (name);
CREATE UNIQUE INDEX global_units_pkey ON public.global_units USING btree (id);
```

## `incomes`

Row-level security: enabled.

```sql
-- Columns in public.incomes
id uuid NOT NULL;
source character varying NOT NULL;
amount numeric NOT NULL;
description character varying;
income_date timestamp with time zone;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `incomes_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX incomes_pkey ON public.incomes USING btree (id);
CREATE INDEX ix_incomes_id ON public.incomes USING btree (id);
CREATE INDEX ix_incomes_source ON public.incomes USING btree (source);
```

## `inventory_balances`

Row-level security: enabled.

```sql
-- Columns in public.inventory_balances
id uuid NOT NULL;
product_id uuid NOT NULL;
warehouse_id uuid NOT NULL;
current_stock numeric NOT NULL;
updated_at timestamp with time zone DEFAULT now();
```

Constraints:

- `ck_inventory_balance_nonnegative`: `CHECK ((current_stock >= (0)::numeric))`
- `inventory_balances_pkey`: `PRIMARY KEY (id)`
- `inventory_balances_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `inventory_balances_warehouse_id_fkey`: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`
- `uq_inventory_balance_product_warehouse`: `UNIQUE (product_id, warehouse_id)`

Indexes:

```sql
CREATE UNIQUE INDEX inventory_balances_pkey ON public.inventory_balances USING btree (id);
CREATE UNIQUE INDEX uq_inventory_balance_product_warehouse ON public.inventory_balances USING btree (product_id, warehouse_id);
```

## `inventory_counts`

Row-level security: enabled.

```sql
-- Columns in public.inventory_counts
id uuid NOT NULL;
product_id uuid NOT NULL;
warehouse_id uuid NOT NULL;
user_id uuid NOT NULL;
expected_quantity numeric NOT NULL;
observed_quantity numeric NOT NULL;
difference numeric NOT NULL;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `ck_inventory_count_nonnegative`: `CHECK ((observed_quantity >= (0)::numeric))`
- `inventory_counts_pkey`: `PRIMARY KEY (id)`
- `inventory_counts_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `inventory_counts_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `inventory_counts_warehouse_id_fkey`: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`

Indexes:

```sql
CREATE UNIQUE INDEX inventory_counts_pkey ON public.inventory_counts USING btree (id);
```

## `inventory_transactions`

Row-level security: enabled.

```sql
-- Columns in public.inventory_transactions
id uuid NOT NULL;
product_id uuid NOT NULL;
warehouse_id uuid NOT NULL;
user_id uuid NOT NULL;
transaction_type transactiontypeenum NOT NULL;
quantity_changed numeric NOT NULL;
supplier_id uuid;
unit_cost numeric;
supplier_finance_included boolean NOT NULL DEFAULT true;
reference_document character varying;
notes character varying;
request_id uuid;
request_fingerprint character varying;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `inventory_transactions_pkey`: `PRIMARY KEY (id)`
- `inventory_transactions_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `inventory_transactions_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`
- `inventory_transactions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `inventory_transactions_warehouse_id_fkey`: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`
- `uq_inventory_transactions_request_id`: `UNIQUE (request_id)`

Indexes:

```sql
CREATE UNIQUE INDEX inventory_transactions_pkey ON public.inventory_transactions USING btree (id);
CREATE INDEX ix_inventory_transactions_created_id ON public.inventory_transactions USING btree (created_at, id);
CREATE UNIQUE INDEX uq_inventory_transactions_request_id ON public.inventory_transactions USING btree (request_id);
```

## `notifications`

Row-level security: enabled.

```sql
-- Columns in public.notifications
id uuid NOT NULL;
user_id uuid NOT NULL;
kind character varying NOT NULL;
title character varying NOT NULL;
message character varying NOT NULL;
href character varying NOT NULL;
created_at timestamp with time zone NOT NULL DEFAULT now();
read_at timestamp with time zone;
```

Constraints:

- `notifications_pkey`: `PRIMARY KEY (id)`
- `notifications_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

Indexes:

```sql
CREATE INDEX ix_notifications_user_created ON public.notifications USING btree (user_id, created_at);
CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);
```

## `order_items`

Row-level security: enabled.

```sql
-- Columns in public.order_items
id uuid NOT NULL;
order_id uuid NOT NULL;
product_id uuid NOT NULL;
unit_id uuid NOT NULL;
quantity_requested numeric NOT NULL;
quantity_actual numeric NOT NULL;
conversion_factor numeric NOT NULL;
price_level character varying NOT NULL;
unit_price numeric NOT NULL;
total_price numeric NOT NULL;
cost_at_sale numeric;
tax_rate numeric;
bundle_components_snapshot json;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `order_items_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `order_items_pkey`: `PRIMARY KEY (id)`
- `order_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `order_items_unit_id_fkey`: `FOREIGN KEY (unit_id) REFERENCES product_units(id)`

Indexes:

```sql
CREATE INDEX ix_order_items_id ON public.order_items USING btree (id);
CREATE INDEX ix_order_items_order_id ON public.order_items USING btree (order_id);
CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (id);
```

## `orders`

Row-level security: enabled.

```sql
-- Columns in public.orders
id uuid NOT NULL;
customer_id uuid;
user_id uuid;
assigned_to_id uuid;
status character varying NOT NULL;
source character varying NOT NULL;
total_amount numeric NOT NULL;
tax_amount numeric NOT NULL;
discount_amount numeric NOT NULL;
shipping_cost numeric NOT NULL;
payment_method character varying;
notes text;
request_id uuid;
request_fingerprint character varying;
created_at timestamp with time zone DEFAULT now();
updated_at timestamp with time zone DEFAULT now();
preparing_started_at timestamp with time zone;
priority character varying NOT NULL;
```

Constraints:

- `orders_assigned_to_id_fkey`: `FOREIGN KEY (assigned_to_id) REFERENCES users(id)`
- `orders_pkey`: `PRIMARY KEY (id)`
- `orders_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `uq_orders_request_id`: `UNIQUE (request_id)`

Indexes:

```sql
CREATE INDEX ix_orders_created_id ON public.orders USING btree (created_at, id);
CREATE INDEX ix_orders_customer_status ON public.orders USING btree (customer_id, status);
CREATE INDEX ix_orders_id ON public.orders USING btree (id);
CREATE INDEX ix_orders_status ON public.orders USING btree (status);
CREATE INDEX ix_orders_status_created ON public.orders USING btree (status, created_at);
CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id);
CREATE UNIQUE INDEX uq_orders_request_id ON public.orders USING btree (request_id);
```

## `payments`

Row-level security: enabled.

```sql
-- Columns in public.payments
id uuid NOT NULL;
order_id uuid;
customer_id uuid;
user_id uuid NOT NULL;
shift_id uuid;
amount numeric NOT NULL;
method character varying NOT NULL;
kind character varying NOT NULL;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `payments_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES customers(id)`
- `payments_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `payments_pkey`: `PRIMARY KEY (id)`
- `payments_shift_id_fkey`: `FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)`
- `payments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

Indexes:

```sql
CREATE INDEX ix_payments_created_at ON public.payments USING btree (created_at);
CREATE INDEX ix_payments_customer_id ON public.payments USING btree (customer_id);
CREATE INDEX ix_payments_order_id ON public.payments USING btree (order_id);
CREATE INDEX ix_payments_shift_id ON public.payments USING btree (shift_id);
CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id);
```

## `product_bundle_components`

Row-level security: enabled.

```sql
-- Columns in public.product_bundle_components
id uuid NOT NULL;
bundle_id uuid NOT NULL;
component_id uuid NOT NULL;
quantity numeric NOT NULL;
unit_id uuid;
price_level pricelevelenum;
is_deleted boolean NOT NULL;
```

Constraints:

- `product_bundle_components_bundle_id_fkey`: `FOREIGN KEY (bundle_id) REFERENCES products(id)`
- `product_bundle_components_component_id_fkey`: `FOREIGN KEY (component_id) REFERENCES products(id)`
- `product_bundle_components_pkey`: `PRIMARY KEY (id)`
- `product_bundle_components_unit_id_fkey`: `FOREIGN KEY (unit_id) REFERENCES product_units(id)`

Indexes:

```sql
CREATE UNIQUE INDEX product_bundle_components_pkey ON public.product_bundle_components USING btree (id);
```

## `product_prices`

Row-level security: enabled.

```sql
-- Columns in public.product_prices
id uuid NOT NULL;
product_id uuid NOT NULL;
unit_id uuid;
price_level pricelevelenum NOT NULL;
price numeric NOT NULL;
is_deleted boolean;
```

Constraints:

- `product_prices_pkey`: `PRIMARY KEY (id)`
- `product_prices_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `product_prices_unit_id_fkey`: `FOREIGN KEY (unit_id) REFERENCES product_units(id)`
- `uix_product_unit_pricelevel`: `UNIQUE (product_id, unit_id, price_level)`

Indexes:

```sql
CREATE UNIQUE INDEX product_prices_pkey ON public.product_prices USING btree (id);
CREATE UNIQUE INDEX uix_product_unit_pricelevel ON public.product_prices USING btree (product_id, unit_id, price_level);
```

## `product_units`

Row-level security: enabled.

```sql
-- Columns in public.product_units
id uuid NOT NULL;
product_id uuid NOT NULL;
unit_name character varying NOT NULL;
conversion_factor numeric NOT NULL;
barcode character varying;
is_deleted boolean;
```

Constraints:

- `product_units_barcode_key`: `UNIQUE (barcode)`
- `product_units_pkey`: `PRIMARY KEY (id)`
- `product_units_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`

Indexes:

```sql
CREATE UNIQUE INDEX product_units_barcode_key ON public.product_units USING btree (barcode);
CREATE UNIQUE INDEX product_units_pkey ON public.product_units USING btree (id);
```

## `products`

Row-level security: enabled.

```sql
-- Columns in public.products
id uuid NOT NULL;
sku character varying NOT NULL;
barcode character varying;
name_en character varying NOT NULL;
name_ar character varying NOT NULL;
category_id uuid;
subcategory_id uuid;
brand_id uuid;
supplier_id uuid;
base_unit character varying NOT NULL;
cost numeric NOT NULL;
tax_rate numeric NOT NULL;
min_stock_level numeric NOT NULL;
max_stock_level numeric NOT NULL;
description character varying;
image_url character varying;
warehouse_location character varying;
is_bundle boolean;
is_active boolean;
is_deleted boolean;
created_at timestamp with time zone DEFAULT now();
updated_at timestamp with time zone;
```

Constraints:

- `products_brand_id_fkey`: `FOREIGN KEY (brand_id) REFERENCES brands(id)`
- `products_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `products_pkey`: `PRIMARY KEY (id)`
- `products_subcategory_id_fkey`: `FOREIGN KEY (subcategory_id) REFERENCES subcategories(id)`
- `products_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`

Indexes:

```sql
CREATE UNIQUE INDEX ix_products_barcode ON public.products USING btree (barcode);
CREATE UNIQUE INDEX ix_products_sku ON public.products USING btree (sku);
CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id);
```

## `purchase_document_lines`

Row-level security: enabled.

```sql
-- Columns in public.purchase_document_lines
id uuid NOT NULL;
document_id uuid NOT NULL;
product_id uuid NOT NULL;
unit_id uuid NOT NULL;
product_name character varying NOT NULL;
unit_name character varying NOT NULL;
base_unit_name character varying NOT NULL;
quantity numeric NOT NULL;
conversion_factor numeric NOT NULL;
base_quantity numeric NOT NULL;
received_base_quantity numeric NOT NULL;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `ck_purchase_document_lines_positive`: `CHECK (((quantity > (0)::numeric) AND (conversion_factor > (0)::numeric) AND (base_quantity > (0)::numeric)))`
- `ck_purchase_document_lines_received`: `CHECK (((received_base_quantity >= (0)::numeric) AND (received_base_quantity <= base_quantity)))`
- `purchase_document_lines_document_id_fkey`: `FOREIGN KEY (document_id) REFERENCES purchase_documents(id)`
- `purchase_document_lines_pkey`: `PRIMARY KEY (id)`
- `purchase_document_lines_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `purchase_document_lines_unit_id_fkey`: `FOREIGN KEY (unit_id) REFERENCES product_units(id)`
- `uq_purchase_document_product_unit`: `UNIQUE (document_id, product_id, unit_id)`

Indexes:

```sql
CREATE UNIQUE INDEX purchase_document_lines_pkey ON public.purchase_document_lines USING btree (id);
CREATE UNIQUE INDEX uq_purchase_document_product_unit ON public.purchase_document_lines USING btree (document_id, product_id, unit_id);
```

## `purchase_documents`

Row-level security: enabled.

```sql
-- Columns in public.purchase_documents
id uuid NOT NULL;
request_id uuid NOT NULL;
request_fingerprint character varying NOT NULL;
supplier_id uuid NOT NULL;
supplier_name character varying NOT NULL;
status character varying NOT NULL;
note character varying;
requested_by uuid NOT NULL;
approved_by uuid;
ordered_at timestamp with time zone;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `ck_purchase_documents_status`: `CHECK (((status)::text = ANY ((ARRAY['REQUESTED'::character varying, 'APPROVED'::character varying, 'ORDERED'::character varying, 'PARTIALLY_RECEIVED'::character varying, 'RECEIVED'::character varying, 'REJECTED'::character varying, 'CANCELLED'::character varying])::text[])))`
- `purchase_documents_approved_by_fkey`: `FOREIGN KEY (approved_by) REFERENCES users(id)`
- `purchase_documents_pkey`: `PRIMARY KEY (id)`
- `purchase_documents_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES users(id)`
- `purchase_documents_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`
- `uq_purchase_documents_request_id`: `UNIQUE (request_id)`

Indexes:

```sql
CREATE UNIQUE INDEX purchase_documents_pkey ON public.purchase_documents USING btree (id);
CREATE UNIQUE INDEX uq_purchase_documents_request_id ON public.purchase_documents USING btree (request_id);
```

## `purchase_orders`

Row-level security: enabled.

```sql
-- Columns in public.purchase_orders
id uuid NOT NULL;
product_id uuid NOT NULL;
supplier_id uuid NOT NULL;
quantity numeric NOT NULL;
received_quantity numeric NOT NULL;
status character varying NOT NULL;
requested_by uuid NOT NULL;
approved_by uuid;
ordered_at timestamp with time zone;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `ck_purchase_order_quantity_positive`: `CHECK ((quantity > (0)::numeric))`
- `ck_purchase_order_received_range`: `CHECK (((received_quantity >= (0)::numeric) AND (received_quantity <= quantity)))`
- `purchase_orders_approved_by_fkey`: `FOREIGN KEY (approved_by) REFERENCES users(id)`
- `purchase_orders_pkey`: `PRIMARY KEY (id)`
- `purchase_orders_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(id)`
- `purchase_orders_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES users(id)`
- `purchase_orders_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`

Indexes:

```sql
CREATE UNIQUE INDEX purchase_orders_pkey ON public.purchase_orders USING btree (id);
```

## `purchase_receipt_lines`

Row-level security: enabled.

```sql
-- Columns in public.purchase_receipt_lines
id uuid NOT NULL;
receipt_id uuid NOT NULL;
document_line_id uuid NOT NULL;
base_quantity numeric NOT NULL;
```

Constraints:

- `ck_purchase_receipt_lines_positive`: `CHECK ((base_quantity > (0)::numeric))`
- `purchase_receipt_lines_document_line_id_fkey`: `FOREIGN KEY (document_line_id) REFERENCES purchase_document_lines(id)`
- `purchase_receipt_lines_pkey`: `PRIMARY KEY (id)`
- `purchase_receipt_lines_receipt_id_fkey`: `FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id)`
- `uq_purchase_receipt_document_line`: `UNIQUE (receipt_id, document_line_id)`

Indexes:

```sql
CREATE UNIQUE INDEX purchase_receipt_lines_pkey ON public.purchase_receipt_lines USING btree (id);
CREATE UNIQUE INDEX uq_purchase_receipt_document_line ON public.purchase_receipt_lines USING btree (receipt_id, document_line_id);
```

## `purchase_receipts`

Row-level security: enabled.

```sql
-- Columns in public.purchase_receipts
id uuid NOT NULL;
document_id uuid NOT NULL;
warehouse_id uuid NOT NULL;
request_id uuid NOT NULL;
request_fingerprint character varying NOT NULL;
received_by uuid NOT NULL;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `purchase_receipts_document_id_fkey`: `FOREIGN KEY (document_id) REFERENCES purchase_documents(id)`
- `purchase_receipts_pkey`: `PRIMARY KEY (id)`
- `purchase_receipts_received_by_fkey`: `FOREIGN KEY (received_by) REFERENCES users(id)`
- `purchase_receipts_warehouse_id_fkey`: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`
- `uq_purchase_receipts_request_id`: `UNIQUE (request_id)`

Indexes:

```sql
CREATE UNIQUE INDEX purchase_receipts_pkey ON public.purchase_receipts USING btree (id);
CREATE UNIQUE INDEX uq_purchase_receipts_request_id ON public.purchase_receipts USING btree (request_id);
```

## `revoked_access_tokens`

Row-level security: enabled.

```sql
-- Columns in public.revoked_access_tokens
token_hash character varying NOT NULL;
user_id uuid NOT NULL;
expires_at timestamp with time zone NOT NULL;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `revoked_access_tokens_pkey`: `PRIMARY KEY (token_hash)`
- `revoked_access_tokens_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

Indexes:

```sql
CREATE INDEX ix_revoked_access_tokens_expires_at ON public.revoked_access_tokens USING btree (expires_at);
CREATE UNIQUE INDEX revoked_access_tokens_pkey ON public.revoked_access_tokens USING btree (token_hash);
```

## `sales_return_lines`

Row-level security: enabled.

```sql
-- Columns in public.sales_return_lines
id uuid NOT NULL;
return_id uuid NOT NULL;
order_item_id uuid NOT NULL;
quantity numeric NOT NULL;
amount numeric NOT NULL;
```

Constraints:

- `ck_return_line_quantity_positive`: `CHECK ((quantity > (0)::numeric))`
- `sales_return_lines_order_item_id_fkey`: `FOREIGN KEY (order_item_id) REFERENCES order_items(id)`
- `sales_return_lines_pkey`: `PRIMARY KEY (id)`
- `sales_return_lines_return_id_fkey`: `FOREIGN KEY (return_id) REFERENCES sales_returns(id)`

Indexes:

```sql
CREATE UNIQUE INDEX sales_return_lines_pkey ON public.sales_return_lines USING btree (id);
```

## `sales_returns`

Row-level security: enabled.

```sql
-- Columns in public.sales_returns
id uuid NOT NULL;
order_id uuid NOT NULL;
exchange_order_id uuid;
warehouse_id uuid NOT NULL;
user_id uuid NOT NULL;
kind character varying NOT NULL;
payment_method character varying NOT NULL;
request_fingerprint character varying NOT NULL;
refund_amount numeric NOT NULL;
charge_amount numeric NOT NULL;
returned_value numeric NOT NULL;
replacement_value numeric NOT NULL;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `ck_return_amounts_nonnegative`: `CHECK (((refund_amount >= (0)::numeric) AND (charge_amount >= (0)::numeric)))`
- `sales_returns_exchange_order_id_fkey`: `FOREIGN KEY (exchange_order_id) REFERENCES orders(id)`
- `sales_returns_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `sales_returns_pkey`: `PRIMARY KEY (id)`
- `sales_returns_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`
- `sales_returns_warehouse_id_fkey`: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`

Indexes:

```sql
CREATE INDEX ix_sales_returns_created_at ON public.sales_returns USING btree (created_at);
CREATE INDEX ix_sales_returns_exchange_order_id ON public.sales_returns USING btree (exchange_order_id);
CREATE INDEX ix_sales_returns_order_id ON public.sales_returns USING btree (order_id);
CREATE UNIQUE INDEX sales_returns_pkey ON public.sales_returns USING btree (id);
```

## `shift_email_reports`

Row-level security: enabled.

```sql
-- Columns in public.shift_email_reports
shift_id uuid NOT NULL;
recipient_email character varying NOT NULL;
subject character varying NOT NULL;
body text NOT NULL;
status character varying NOT NULL DEFAULT 'PENDING'::character varying;
attempts integer NOT NULL DEFAULT 0;
sent_at timestamp with time zone;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `ck_shift_email_status`: `CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'SENT'::character varying, 'FAILED'::character varying])::text[])))`
- `shift_email_reports_pkey`: `PRIMARY KEY (shift_id)`
- `shift_email_reports_shift_id_fkey`: `FOREIGN KEY (shift_id) REFERENCES cash_shifts(id)`

Indexes:

```sql
CREATE UNIQUE INDEX shift_email_reports_pkey ON public.shift_email_reports USING btree (shift_id);
```

## `shift_report_recipient`

Row-level security: enabled.

```sql
-- Columns in public.shift_report_recipient
id integer NOT NULL DEFAULT nextval('shift_report_recipient_id_seq'::regclass);
email character varying NOT NULL;
updated_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `shift_report_recipient_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX shift_report_recipient_pkey ON public.shift_report_recipient USING btree (id);
```

## `subcategories`

Row-level security: enabled.

```sql
-- Columns in public.subcategories
id uuid NOT NULL;
category_id uuid NOT NULL;
name_en character varying NOT NULL;
name_ar character varying NOT NULL;
is_deleted boolean;
```

Constraints:

- `subcategories_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(id)`
- `subcategories_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX subcategories_pkey ON public.subcategories USING btree (id);
```

## `supplier_debt_entries`

Row-level security: enabled.

```sql
-- Columns in public.supplier_debt_entries
id uuid NOT NULL;
supplier_id uuid NOT NULL;
entry_type character varying NOT NULL;
amount numeric NOT NULL;
note character varying NOT NULL;
reference_number character varying;
reverses_entry_id uuid;
created_by uuid NOT NULL;
created_at timestamp with time zone NOT NULL DEFAULT now();
```

Constraints:

- `ck_supplier_debt_entries_positive_amount`: `CHECK ((amount > (0)::numeric))`
- `ck_supplier_debt_entries_type`: `CHECK (((entry_type)::text = ANY ((ARRAY['DEBT'::character varying, 'REVERSAL'::character varying])::text[])))`
- `supplier_debt_entries_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES users(id)`
- `supplier_debt_entries_pkey`: `PRIMARY KEY (id)`
- `supplier_debt_entries_reverses_entry_id_fkey`: `FOREIGN KEY (reverses_entry_id) REFERENCES supplier_debt_entries(id)`
- `supplier_debt_entries_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`
- `uq_supplier_debt_entries_reversal`: `UNIQUE (reverses_entry_id)`

Indexes:

```sql
CREATE INDEX ix_supplier_debt_entries_supplier_created ON public.supplier_debt_entries USING btree (supplier_id, created_at);
CREATE UNIQUE INDEX supplier_debt_entries_pkey ON public.supplier_debt_entries USING btree (id);
CREATE UNIQUE INDEX uq_supplier_debt_entries_reversal ON public.supplier_debt_entries USING btree (reverses_entry_id);
```

## `supplier_payments`

Row-level security: enabled.

```sql
-- Columns in public.supplier_payments
id uuid NOT NULL;
supplier_id uuid NOT NULL;
amount numeric NOT NULL;
payment_method paymentmethodenum NOT NULL;
cash_source character varying;
reference_number character varying;
notes character varying;
payment_date timestamp with time zone DEFAULT now();
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `supplier_payments_pkey`: `PRIMARY KEY (id)`
- `supplier_payments_supplier_id_fkey`: `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`

Indexes:

```sql
CREATE UNIQUE INDEX supplier_payments_pkey ON public.supplier_payments USING btree (id);
```

## `suppliers`

Row-level security: enabled.

```sql
-- Columns in public.suppliers
id uuid NOT NULL;
name character varying NOT NULL;
contact_info character varying;
phone character varying;
email character varying;
address character varying;
tax_number character varying;
opening_balance numeric NOT NULL;
credit_limit numeric;
payment_terms_days character varying;
notes character varying;
is_deleted boolean;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `suppliers_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX suppliers_pkey ON public.suppliers USING btree (id);
```

## `users`

Row-level security: enabled.

```sql
-- Columns in public.users
id uuid NOT NULL;
email character varying;
username character varying;
hashed_password character varying;
role roleenum NOT NULL;
is_active boolean;
is_deleted boolean;
created_at timestamp with time zone DEFAULT now();
updated_at timestamp with time zone;
```

Constraints:

- `users_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);
CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);
```

## `warehouses`

Row-level security: enabled.

```sql
-- Columns in public.warehouses
id uuid NOT NULL;
name character varying NOT NULL;
location character varying;
is_active boolean;
created_at timestamp with time zone DEFAULT now();
```

Constraints:

- `warehouses_pkey`: `PRIMARY KEY (id)`

Indexes:

```sql
CREATE UNIQUE INDEX warehouses_pkey ON public.warehouses USING btree (id);
```
