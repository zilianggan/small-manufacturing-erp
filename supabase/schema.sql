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
  material_type TEXT, -- RAW_MATERIAL or FINISHED_GOOD or CUSTOMER_STOCK
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
  product_id UUID REFERENCES product(id) ON DELETE SET NULL,
  transaction_type TEXT, -- PURCHASE, SALES, PURCHASE_RETURN, SALES_RETURN, ADJUSTMENT
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC,
  remark TEXT,
  purchase_detail_id UUID REFERENCES purchase_detail(detail_id),
  production_material_usage_id UUID REFERENCES production_material_usage(id),
  transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inventory_transaction_target CHECK ((material_id IS NOT NULL) <> (product_id IS NOT NULL))
);

CREATE TABLE workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT,
  start_date date,
  end_date date,
  remark TEXT,
  sales_detail_id UUID REFERENCES sales_detail(detail_id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE contacts
ADD CONSTRAINT chk_contact_owner
CHECK
(
  (vendor_id IS NOT NULL)::int +
  (client_id IS NOT NULL)::int = 1
);