
-- index section
CREATE INDEX idx_material_code
ON material(code);

CREATE INDEX idx_product_code
ON product(code);

CREATE INDEX idx_purchase_vendor
ON purchase_header(vendor_id);

CREATE INDEX idx_sales_client
ON sales_header(client_id);

CREATE INDEX idx_inventory_material
ON inventory_transaction(material_id);

CREATE INDEX idx_inventory_product
ON inventory_transaction(product_id);

CREATE INDEX idx_production_material_usage
ON production_material_usage(material_id);

CREATE INDEX idx_purchase_status
ON purchase_header(status);

CREATE INDEX idx_sales_status
ON sales_header(status);

-- Trigger section
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS
$$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_company_profile_updated_at
BEFORE UPDATE ON company_profile
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_job_positions_updated_at
BEFORE UPDATE ON job_positions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_material_categories_updated_at
BEFORE UPDATE ON material_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_product_categories_updated_at
BEFORE UPDATE ON product_categories
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_vendors_updated_at
BEFORE UPDATE ON vendors
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_contacts_updated_at
BEFORE UPDATE ON contacts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_production_material_usage_updated_at
BEFORE UPDATE ON production_material_usage
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_inventory_transaction_updated_at
BEFORE UPDATE ON inventory_transaction
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_material_updated_at
BEFORE UPDATE ON material
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_product_updated_at
BEFORE UPDATE ON product
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sales_header_updated_at
BEFORE UPDATE ON sales_header
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_sales_detail_updated_at
BEFORE UPDATE ON sales_detail
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_purchase_header_updated_at
BEFORE UPDATE ON purchase_header
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_purchase_detail_updated_at
BEFORE UPDATE ON purchase_detail
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_workflow_updated_at
BEFORE UPDATE ON workflow_tasks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_inventory_update_stock
AFTER INSERT ON inventory_transaction
FOR EACH ROW
EXECUTE FUNCTION update_material_stock();

-- function section
CREATE OR REPLACE FUNCTION update_material_stock()
RETURNS TRIGGER AS
$$
BEGIN
    IF NEW.material_id IS NOT NULL THEN
        UPDATE material
        SET quantity = quantity + NEW.quantity
        WHERE id = NEW.material_id;
    END IF;

    IF NEW.product_id IS NOT NULL THEN
        UPDATE product
        SET quantity = quantity + NEW.quantity
        WHERE id = NEW.product_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_system_admin_data()
RETURNS TABLE (
    job_positions jsonb,
    material_categories jsonb,
    product_categories jsonb
)
LANGUAGE sql
AS $$
SELECT
    (
        SELECT jsonb_agg(t ORDER BY t.name)
        FROM job_positions t
    ),
    (
        SELECT jsonb_agg(t ORDER BY t.name)
        FROM material_categories t
    ),
    (
        SELECT jsonb_agg(t ORDER BY t.name)
        FROM product_categories t
    );
$$;

CREATE OR REPLACE FUNCTION get_dashboard_data()
RETURNS TABLE (
    monthly_totals jsonb,
    raw_material_qty numeric,
    finished_goods_qty numeric,
    low_stock_items jsonb,
    low_stock_count integer
)
LANGUAGE sql
AS $$
WITH months AS (
    SELECT generate_series(
        date_trunc('month', CURRENT_DATE) - interval '5 months',
        date_trunc('month', CURRENT_DATE),
        interval '1 month'
    ) AS month_start
),
sales_by_month AS (
    SELECT m.month_start, COALESCE(SUM(sh.total_amount), 0) AS sales_total
    FROM months m
    LEFT JOIN sales_header sh
        ON date_trunc('month', sh.order_date) = m.month_start
        AND sh.status NOT IN ('CANCELLED', 'QUOTATION')
    GROUP BY m.month_start
),
purchases_by_month AS (
    SELECT m.month_start, COALESCE(SUM(ph.total_price), 0) AS purchase_total
    FROM months m
    LEFT JOIN purchase_header ph
        ON date_trunc('month', ph.order_date) = m.month_start
        AND ph.status NOT IN ('CANCELLED', 'QUOTATION')
    GROUP BY m.month_start
),
low_stock AS (
    SELECT id, name, code, quantity, minimum_stock
    FROM material
    WHERE quantity <= minimum_stock
    ORDER BY (quantity - minimum_stock) ASC
    LIMIT 5
)
SELECT
    (
        SELECT jsonb_agg(jsonb_build_object(
            'month', to_char(s.month_start, 'YYYY-MM'),
            'sales', s.sales_total,
            'purchases', p.purchase_total
        ) ORDER BY s.month_start)
        FROM sales_by_month s
        JOIN purchases_by_month p ON p.month_start = s.month_start
    ),
    (SELECT COALESCE(SUM(quantity), 0) FROM material WHERE material_type = 'RAW_MATERIAL'),
    (SELECT COALESCE(SUM(quantity), 0) FROM material WHERE material_type = 'FINISHED_GOOD'),
    (SELECT jsonb_agg(t) FROM low_stock t),
    (SELECT COUNT(*)::int FROM material WHERE quantity <= minimum_stock);
$$;

-- Paginated + sortable + filterable material catalog for MaterialView.tsx.
-- p_search matches the existing free-text search box (name OR code). p_ids is
-- the FilterDialog's ticked-record picker (search name/code, tick multiple,
-- apply) — when set, only those material ids are returned. p_sort_field is
-- one of: name, code, stock, restock, latest_purchase, oldest_purchase —
-- resolved via a whitelist CASE (not string-interpolated) so it's
-- injection-safe even though the ORDER BY clause is built with
-- format()/EXECUTE. total_count is a window count so callers get hasMore
-- without a second round trip.
CREATE OR REPLACE FUNCTION get_materials_page(
    p_search text DEFAULT NULL,
    p_ids uuid[] DEFAULT NULL,
    p_sort_field text DEFAULT 'name',
    p_sort_dir text DEFAULT 'asc',
    p_offset int DEFAULT 0,
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    name text,
    code text,
    material_type text,
    dimension text,
    quantity numeric,
    description text,
    attachments jsonb,
    status text,
    minimum_stock numeric,
    reorder_quantity numeric,
    material_category_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    latest_purchase_date date,
    oldest_purchase_date date,
    total_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_order text;
BEGIN
    v_order := CASE p_sort_field || ':' || p_sort_dir
        WHEN 'name:asc' THEN 'm.name ASC'
        WHEN 'name:desc' THEN 'm.name DESC'
        WHEN 'code:asc' THEN 'm.code ASC NULLS LAST'
        WHEN 'code:desc' THEN 'm.code DESC NULLS LAST'
        WHEN 'stock:asc' THEN 'm.quantity ASC'
        WHEN 'stock:desc' THEN 'm.quantity DESC'
        WHEN 'restock:asc' THEN '(m.quantity - m.minimum_stock) ASC'
        WHEN 'restock:desc' THEN '(m.quantity - m.minimum_stock) DESC'
        WHEN 'latest_purchase:asc' THEN 'pdate.latest_date ASC NULLS LAST'
        WHEN 'latest_purchase:desc' THEN 'pdate.latest_date DESC NULLS LAST'
        WHEN 'oldest_purchase:asc' THEN 'pdate.oldest_date ASC NULLS LAST'
        WHEN 'oldest_purchase:desc' THEN 'pdate.oldest_date DESC NULLS LAST'
        ELSE 'm.name ASC'
    END;

    RETURN QUERY EXECUTE format($f$
        SELECT m.id, m.name, m.code, m.material_type, m.dimension, m.quantity,
               m.description, m.attachments, m.status, m.minimum_stock, m.reorder_quantity,
               m.material_category_id, m.created_at, m.updated_at,
               pdate.latest_date, pdate.oldest_date,
               count(*) OVER() AS total_count
        FROM material m
        LEFT JOIN (
            -- order_date is timestamptz now (production due-date/time change) but
            -- latest/oldest_purchase_date is still declared `date` above — cast
            -- down or RETURN QUERY EXECUTE throws "does not match expected type date".
            SELECT pd.material_id, MAX(ph.order_date)::date AS latest_date, MIN(ph.order_date)::date AS oldest_date
            FROM purchase_detail pd
            JOIN purchase_header ph ON ph.id = pd.header_id
            GROUP BY pd.material_id
        ) pdate ON pdate.material_id = m.id
        WHERE ($1 IS NULL OR m.name ILIKE '%%' || $1 || '%%' OR m.code ILIKE '%%' || $1 || '%%')
          AND ($2 IS NULL OR m.id = ANY($2))
        ORDER BY %s, m.created_at ASC
        OFFSET $3 LIMIT $4
    $f$, v_order)
    USING p_search, p_ids, p_offset, p_limit;
END;
$$;

-- Product-module sibling of get_materials_page(): paginated + sortable +
-- filterable product catalog for ProductView.tsx. No restock-urgency sort
-- (Product has no minimum_stock/reorder_quantity columns) — latest/oldest
-- sale date is the product-module equivalent of Material's purchase-date
-- sort, aggregated from sales_detail/sales_header instead of
-- purchase_detail/purchase_header.
CREATE OR REPLACE FUNCTION get_products_page(
    p_search text DEFAULT NULL,
    p_ids uuid[] DEFAULT NULL,
    p_sort_field text DEFAULT 'name',
    p_sort_dir text DEFAULT 'asc',
    p_offset int DEFAULT 0,
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    name text,
    code text,
    dimension text,
    quantity numeric,
    description text,
    attachments jsonb,
    status text,
    selling_price numeric,
    product_category_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    latest_sale_date date,
    oldest_sale_date date,
    total_count bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_order text;
BEGIN
    v_order := CASE p_sort_field || ':' || p_sort_dir
        WHEN 'name:asc' THEN 'p.name ASC'
        WHEN 'name:desc' THEN 'p.name DESC'
        WHEN 'code:asc' THEN 'p.code ASC NULLS LAST'
        WHEN 'code:desc' THEN 'p.code DESC NULLS LAST'
        WHEN 'stock:asc' THEN 'p.quantity ASC'
        WHEN 'stock:desc' THEN 'p.quantity DESC'
        WHEN 'latest_sale:asc' THEN 'sdate.latest_date ASC NULLS LAST'
        WHEN 'latest_sale:desc' THEN 'sdate.latest_date DESC NULLS LAST'
        WHEN 'oldest_sale:asc' THEN 'sdate.oldest_date ASC NULLS LAST'
        WHEN 'oldest_sale:desc' THEN 'sdate.oldest_date DESC NULLS LAST'
        ELSE 'p.name ASC'
    END;

    RETURN QUERY EXECUTE format($f$
        SELECT p.id, p.name, p.code, p.dimension, p.quantity,
               p.description, p.attachments, p.status, p.selling_price,
               p.product_category_id, p.created_at, p.updated_at,
               sdate.latest_date, sdate.oldest_date,
               count(*) OVER() AS total_count
        FROM product p
        LEFT JOIN (
            -- order_date is timestamptz now but latest/oldest_sale_date is still
            -- declared `date` above — cast down or RETURN QUERY EXECUTE throws
            -- "does not match expected type date".
            SELECT sd.product_id, MAX(sh.order_date)::date AS latest_date, MIN(sh.order_date)::date AS oldest_date
            FROM sales_detail sd
            JOIN sales_header sh ON sh.id = sd.header_id
            GROUP BY sd.product_id
        ) sdate ON sdate.product_id = p.id
        WHERE ($1 IS NULL OR p.name ILIKE '%%' || $1 || '%%' OR p.code ILIKE '%%' || $1 || '%%')
          AND ($2 IS NULL OR p.id = ANY($2))
        ORDER BY %s, p.created_at ASC
        OFFSET $3 LIMIT $4
    $f$, v_order)
    USING p_search, p_ids, p_offset, p_limit;
END;
$$;

-- PO/SO auto numbering (System Admin > Document Numbering). Format + start
-- number live on company_profile (existing config singleton). Run for
-- existing DBs; schema.sql already has these columns for fresh installs.
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS so_number_format TEXT NOT NULL DEFAULT 'SO-0000';
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS so_next_number INT NOT NULL DEFAULT 1;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS po_number_format TEXT NOT NULL DEFAULT 'PO-0000';
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS po_next_number INT NOT NULL DEFAULT 1;

-- Atomically claims the next sales/purchase number and formats it.
-- Format must contain exactly one run of zeros marking the padded number
-- position (e.g. 'SO-0000' -> 'SO-0001'); no zero run = number appended as-is.
-- ponytail: single leftmost-zero-run parse, no date tokens/suffixes — add if needed.
CREATE OR REPLACE FUNCTION next_document_number(p_kind text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_format text;
    v_used int;
    v_pad text;
BEGIN
    IF p_kind = 'SO' THEN
        UPDATE company_profile
        SET so_next_number = so_next_number + 1
        WHERE true
        RETURNING so_number_format, so_next_number - 1 INTO v_format, v_used;
    ELSIF p_kind = 'PO' THEN
        UPDATE company_profile
        SET po_next_number = po_next_number + 1
        WHERE true
        RETURNING po_number_format, po_next_number - 1 INTO v_format, v_used;
    ELSE
        RAISE EXCEPTION 'unknown document kind %', p_kind;
    END IF;

    v_pad := substring(v_format from '0+');
    IF v_pad IS NULL THEN
        RETURN v_format || v_used::text;
    END IF;
    RETURN regexp_replace(v_format, '0+', lpad(v_used::text, length(v_pad), '0'));
END;
$$;