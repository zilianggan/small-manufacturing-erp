-- Supabase Schema Migration

CREATE TABLE company_profile (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT NOT NULL,
  icon_type TEXT,
  icon_data_url TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  bank_name TEXT,
  bank_account TEXT,
  signature_url TEXT,
  chop_url TEXT
);

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  type TEXT,
  quantity NUMERIC DEFAULT 0,
  unit TEXT,
  unit_cost NUMERIC DEFAULT 0,
  reorder_point NUMERIC DEFAULT 0,
  supplier_id TEXT,
  description TEXT,
  attachments JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  materials_supplied JSONB DEFAULT '[]'::jsonb,
  address TEXT,
  rating NUMERIC DEFAULT 0,
  attachments JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  address TEXT,
  total_orders_value NUMERIC DEFAULT 0,
  attachments JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  client_name TEXT,
  item_id TEXT,
  item_name TEXT,
  quantity NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  order_date TEXT,
  delivery_date TEXT,
  status TEXT,
  workflow_task_id TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  items JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  vendor_id TEXT,
  vendor_name TEXT,
  item_id TEXT,
  item_name TEXT,
  quantity NUMERIC DEFAULT 0,
  unit_cost NUMERIC DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  order_date TEXT,
  status TEXT,
  received_date TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  items JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE workflow_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  product_name TEXT,
  quantity NUMERIC DEFAULT 0,
  current_step TEXT,
  assigned_to TEXT,
  start_date TEXT,
  end_date TEXT,
  notes TEXT
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  department TEXT,
  status TEXT,
  email TEXT,
  phone TEXT
);
