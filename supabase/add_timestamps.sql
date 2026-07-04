-- Add created_at and updated_at to all ERP tables
-- Run this in Supabase SQL Editor

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE workflow_tasks
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables
DO $body$ DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','vendors','clients','sales_orders','purchase_orders','workflow_tasks','employees']
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS set_updated_at ON %I;
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    ', t, t);
  END LOOP;
END $body$;

-- -- ============================================================
-- -- INDEXES for query performance
-- -- ============================================================

-- -- Pagination ordering (used by /api/data/:table)
-- CREATE INDEX IF NOT EXISTS idx_inventory_items_created_at    ON inventory_items  (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_vendors_created_at            ON vendors          (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_clients_created_at            ON clients          (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at       ON sales_orders     (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at    ON purchase_orders  (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_workflow_tasks_created_at     ON workflow_tasks   (created_at ASC);
-- CREATE INDEX IF NOT EXISTS idx_employees_created_at          ON employees        (created_at ASC);

-- -- Status filters (dashboard stats, order lists)
-- CREATE INDEX IF NOT EXISTS idx_sales_orders_status           ON sales_orders     (status);
-- CREATE INDEX IF NOT EXISTS idx_purchase_orders_status        ON purchase_orders  (status);
-- CREATE INDEX IF NOT EXISTS idx_workflow_tasks_current_step   ON workflow_tasks   (current_step);
-- CREATE INDEX IF NOT EXISTS idx_employees_status              ON employees        (status);

-- -- FK lookups (joins by client/vendor/order)
-- CREATE INDEX IF NOT EXISTS idx_sales_orders_client_id        ON sales_orders     (client_id);
-- CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id     ON purchase_orders  (vendor_id);
-- CREATE INDEX IF NOT EXISTS idx_workflow_tasks_order_id       ON workflow_tasks   (order_id);
-- CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier_id   ON inventory_items  (supplier_id);

-- -- Type filter (inventory RAW_MATERIAL vs FINISHED_GOOD)
-- CREATE INDEX IF NOT EXISTS idx_inventory_items_type          ON inventory_items  (type);

-- -- Low-stock alert (quantity <= reorder_point scan)
-- CREATE INDEX IF NOT EXISTS idx_inventory_items_quantity      ON inventory_items  (quantity, reorder_point);
