-- Supabase Schema Migration

CREATE TABLE company_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon_type TEXT,
  icon_data_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account TEXT,
  signature_url TEXT,
  chop_url TEXT,
  so_number_format TEXT NOT NULL DEFAULT 'SO-0000',
  so_next_number INT NOT NULL DEFAULT 1,
  po_number_format TEXT NOT NULL DEFAULT 'PO-0000',
  po_next_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE job_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_job_position_name UNIQUE(name)
);

CREATE TABLE material_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_material_categories_name UNIQUE(name)
);

CREATE TABLE product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_categories_name UNIQUE(name)
);

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  email TEXT,
  office_no TEXT,
  address TEXT,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  email TEXT,
  office_no TEXT,
  address TEXT,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  contact_no TEXT,
  email TEXT,
  status TEXT,
  job_position UUID REFERENCES job_positions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  contact_no TEXT,
  email TEXT,
  job_position UUID REFERENCES job_positions(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contacts_full_name UNIQUE(full_name, contact_no, email, vendor_id, client_id)
);

CREATE TABLE material (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  material_type TEXT, -- RAW_MATERIAL or CONSUMABLE_MATERIAL or CUSTOMER_STOCK
  consumption_mode TEXT CHECK (consumption_mode IN ('AUTOMATIC','MANUAL')), -- CONSUMABLE_MATERIAL only; NULL otherwise
  dimension TEXT,
  quantity NUMERIC DEFAULT 0,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  status TEXT,
  minimum_stock NUMERIC DEFAULT 0,
  reorder_quantity NUMERIC DEFAULT 0,
  material_category_id UUID REFERENCES material_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_material_name_code UNIQUE(name, code, dimension)
);

CREATE TABLE product (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  dimension TEXT,
  quantity NUMERIC DEFAULT 0,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  status TEXT,
  selling_price NUMERIC DEFAULT 0,
  product_category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_name_code UNIQUE(name, code, dimension)
);

CREATE TABLE purchase_header (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_no TEXT UNIQUE,
  quotation_date date NOT NULL,
  order_date date,
  received_date date,
  status TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  total_price NUMERIC DEFAULT 0,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchase_detail (
  detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID REFERENCES purchase_header(id) ON DELETE CASCADE,
  material_id UUID REFERENCES material(id) ON DELETE SET NULL,
  material_name TEXT, -- snapshot purpose
  material_code TEXT, -- snapshot purpose
  quantity NUMERIC DEFAULT 0,
  unit_cost NUMERIC DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  received_quantity NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sales_header (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_no TEXT UNIQUE,
  order_date date NOT NULL,
  delivery_date date,
  status TEXT,
  total_amount NUMERIC DEFAULT 0,
  remark TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sales_detail (
  detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID REFERENCES sales_header(id) ON DELETE CASCADE,
  product_id UUID REFERENCES product(id) ON DELETE SET NULL,
  product_name TEXT, -- snapshot purpose
  product_code TEXT, -- snapshot purpose
  quantity NUMERIC(18,2) NOT NULL,
  unit_price NUMERIC(18,2) NOT NULL,
  total_price NUMERIC DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE production_material_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE CASCADE,
  material_id UUID REFERENCES material(id),
  planned_quantity NUMERIC DEFAULT 0,
  actual_quantity NUMERIC DEFAULT 0,
  returned_quantity NUMERIC DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES material(id) ON DELETE SET NULL,
  transaction_type TEXT, -- PURCHASE, SALES, PURCHASE_RETURN, SALES_RETURN, ADJUSTMENT
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  remark TEXT,
  purchase_detail_id UUID REFERENCES purchase_detail(detail_id),
  production_material_usage_id UUID REFERENCES production_material_usage(id),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT,
  stage TEXT NOT NULL DEFAULT 'PREPARATION' CHECK (stage IN ('PREPARATION','ASSEMBLY','QUALITY_CONTROL','PACKAGING','COMPLETED')),
  start_date date,
  end_date date,
  remark TEXT,
  sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE purchase_header
ADD COLUMN sales_header_id UUID
REFERENCES sales_header(id)
ON DELETE SET NULL;

ALTER TABLE purchase_detail
ADD COLUMN sales_detail_id UUID
REFERENCES sales_detail(detail_id)
ON DELETE SET NULL;

ALTER TABLE contacts
ADD CONSTRAINT chk_contact_owner
CHECK
(
  (vendor_id IS NOT NULL)::int +
  (client_id IS NOT NULL)::int = 1
);

ALTER TABLE inventory_transaction ALTER COLUMN material_id DROP NOT NULL;

ALTER TABLE inventory_transaction
ADD COLUMN product_id UUID REFERENCES product(id) ON DELETE SET NULL;

DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'vendors',
        'clients',
        'employees',
        'job_positions',
        'material_categories',
        'product_categories',
        'contacts',
        'material',
        'product',
        'purchase_header',
        'purchase_detail',
        'sales_header',
        'sales_detail',
        'production_material_usage',
        'inventory_transaction',
        'workflow_tasks'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_all', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL TO public USING (true) WITH CHECK (true);',
            tbl || '_all',
            tbl
        );
    END LOOP;
END $$;

-- Production due date is distinct from delivery_date (client-facing ship
-- date): it's the internal shop-floor deadline the production board sorts
-- and flags urgency against. Priority is a manual override staff sets on
-- the sales order, independent of due date.
ALTER TABLE sales_header
ADD COLUMN production_due_date date,
ADD COLUMN priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT'));

-- Order/quotation/delivery dates carry a time-of-day component now (staff
-- pick day+time; auto-stamped dates record the real creation instant).
-- transaction_date is already timestamptz. Existing date-only rows convert
-- to midnight of the server timezone. production_due_date/received_date stay
-- plain date — they're calendar deadlines, not instants.
ALTER TABLE sales_header
  ALTER COLUMN order_date TYPE timestamptz USING order_date::timestamptz,
  ALTER COLUMN delivery_date TYPE timestamptz USING delivery_date::timestamptz;

ALTER TABLE purchase_header
  ALTER COLUMN quotation_date TYPE timestamptz USING quotation_date::timestamptz,
  ALTER COLUMN order_date TYPE timestamptz USING order_date::timestamptz;

-- Consumable materials (paint, glue, etc.): purchasable + used in production,
-- never sold. FINISHED_GOOD retired (real finished goods live in `product`);
-- convert any stray rows to RAW_MATERIAL. consumption_mode drives whether the
-- consumable auto-deducts at production completion.
ALTER TABLE material
  ADD COLUMN consumption_mode TEXT CHECK (consumption_mode IN ('AUTOMATIC','MANUAL'));
UPDATE material SET material_type = 'RAW_MATERIAL' WHERE material_type = 'FINISHED_GOOD';

-- Product-side ledger rows (PRODUCTION/SALES/SALES_RETURN against a finished good) had no way
-- to join back to the order that caused them — the old extra-produced path faked it by inserting
-- a synthetic production_material_usage row with a null material_id. This is that link, done
-- properly. ON DELETE SET NULL is deliberate: inventory_transaction's two older FKs have no
-- ON DELETE and therefore RESTRICT, which is what makes deleting a cancelled-from-IN_PRODUCTION
-- sales order throw (see "Known gaps" #5 in docs/flows.md). Not repeating that here.
ALTER TABLE inventory_transaction
ADD COLUMN sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transaction_sales_detail
ON inventory_transaction(sales_detail_id);

-- Partial returns need to know how much of each line has already gone back.
-- (production_material_usage.returned_quantity already exists and means something different —
-- leftover material from production. These are on the *detail* tables. Same name, different thing.)
ALTER TABLE purchase_detail ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail    ADD COLUMN returned_quantity NUMERIC NOT NULL DEFAULT 0;

-- Partial delivery + explicit produce quantity.
--   delivered_quantity — how much of the line has shipped (delivery is partial now, like receiving).
--   produce_quantity   — what Start Production committed to make. Defaults to ordered − stock on
--                        hand, but the user edits it, so it must be stored: it is the "Planned
--                        Produce" that Mark Done reconciles the actual yield against.
--   produced_quantity  — what actually came off the floor. This, not the ordered qty, is what
--                        credits finished goods at Mark Done (it subsumes the old "extra produced"
--                        box — an actual above planned IS extra production).
ALTER TABLE sales_detail ADD COLUMN delivered_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail ADD COLUMN produce_quantity   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE sales_detail ADD COLUMN produced_quantity  NUMERIC NOT NULL DEFAULT 0;

-- Backfill: everything already shipped went out in full under the old all-or-nothing markDelivered.
-- Without this, historical orders read as "delivered 0 of N" and their Return action caps at zero.
UPDATE sales_detail SET delivered_quantity = quantity
WHERE header_id IN (
  SELECT id FROM sales_header WHERE status IN ('DELIVERED', 'PARTIALLY_RETURNED', 'RETURNED')
);
