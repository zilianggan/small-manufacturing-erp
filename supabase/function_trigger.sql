
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
    (SELECT COALESCE(SUM(quantity), 0) FROM product),
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
        WHEN 'created_at:asc' THEN 'm.created_at ASC'
        WHEN 'created_at:desc' THEN 'm.created_at DESC'
        WHEN 'updated_at:asc' THEN 'm.updated_at ASC'
        WHEN 'updated_at:desc' THEN 'm.updated_at DESC'
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
        WHEN 'created_at:asc' THEN 'p.created_at ASC'
        WHEN 'created_at:desc' THEN 'p.created_at DESC'
        WHEN 'updated_at:asc' THEN 'p.updated_at ASC'
        WHEN 'updated_at:desc' THEN 'p.updated_at DESC'
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

-- markDelivered()/returnSalesOrder() used to read remaining quantity in JS, clamp there, then write
-- — two round trips with no lock between them, so two genuinely concurrent calls on the same line
-- could both read the same stale "remaining", both pass their own clamp, and both write — shipping
-- or returning more than the order allows into a ledger that's insert-only and can't be undone.
-- SELECT ... FOR UPDATE row-locks sales_detail for the life of the call (one transaction), so a
-- second concurrent call blocks until the first commits and then clamps against the value it just
-- wrote — delivered_quantity can never exceed quantity, returned_quantity can never exceed
-- delivered_quantity, no matter how many callers race. Returns the quantity actually applied (0 if
-- nothing was left) so the caller knows exactly how much to write to the ledger.
DROP FUNCTION IF EXISTS apply_sales_delivery(uuid, numeric);

-- Now also clamps against physical product stock (locked), not just the order line — closes a real
-- gap: today only an unlocked JS pre-check estimates this. Still clamps, doesn't throw (decision
-- #1's exception to the throw rule) — this is the one place a genuine concurrent race is expected.
-- Now inserts its own SALES ledger row too, instead of leaving that to a follow-up JS call.
CREATE OR REPLACE FUNCTION apply_sales_delivery(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_quantity numeric;
    v_delivered numeric;
    v_product_id uuid;
    v_product_qty numeric;
    v_applied numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT quantity, delivered_quantity, product_id
    INTO v_quantity, v_delivered, v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF v_product_id IS NOT NULL THEN
        SELECT quantity INTO v_product_qty FROM product WHERE id = v_product_id FOR UPDATE;
        v_product_qty := COALESCE(v_product_qty, 0);
    ELSE
        v_product_qty := 0;
    END IF;

    v_applied := GREATEST(0, LEAST(p_qty, v_quantity - v_delivered, v_product_qty));
    IF v_applied <= 0 THEN
        RETURN 0;
    END IF;

    UPDATE sales_detail SET delivered_quantity = v_delivered + v_applied WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id, remark)
    VALUES (v_product_id, 'SALES', -v_applied, p_detail_id, p_remark);

    RETURN v_applied;
END;
$$;

CREATE OR REPLACE FUNCTION apply_sales_delivery_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_any_applied boolean := false;
    v_fully_delivered boolean;
BEGIN
    PERFORM id FROM sales_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM sales_detail WHERE sales_detail.detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to sales order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_sales_delivery(v_line.detail_id, v_line.quantity, p_remark);
        IF applied_quantity > 0 THEN v_any_applied := true; END IF;
        RETURN NEXT;
    END LOOP;

    IF NOT v_any_applied THEN
        RETURN;
    END IF;

    SELECT bool_and(sd.delivered_quantity >= sd.quantity) INTO v_fully_delivered
    FROM sales_detail sd WHERE sd.header_id = p_header_id;

    UPDATE sales_header
    SET status = CASE WHEN v_fully_delivered THEN 'DELIVERED' ELSE 'PARTIALLY_DELIVERED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;

DROP FUNCTION IF EXISTS apply_sales_return(uuid, numeric);

-- Now throws on over-return instead of clamping (decision #1 — Sales Return is in the throw
-- bucket, unlike Sales Delivery above). Now inserts its own SALES_RETURN ledger row too.
CREATE OR REPLACE FUNCTION apply_sales_return(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_delivered numeric;
    v_returned numeric;
    v_product_id uuid;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT delivered_quantity, returned_quantity, product_id
    INTO v_delivered, v_returned, v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales line % not found', p_detail_id;
    END IF;

    v_remaining := v_delivered - v_returned;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot return % — only % delivered and not yet returned', p_qty, v_remaining;
    END IF;

    UPDATE sales_detail SET returned_quantity = v_returned + p_qty WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id, remark)
    VALUES (v_product_id, 'SALES_RETURN', p_qty, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

CREATE OR REPLACE FUNCTION apply_sales_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_fully_returned boolean;
BEGIN
    PERFORM id FROM sales_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM sales_detail WHERE sales_detail.detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to sales order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_sales_return(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(sd.returned_quantity >= sd.delivered_quantity) INTO v_fully_returned
    FROM sales_detail sd WHERE sd.header_id = p_header_id;

    UPDATE sales_header
    SET status = CASE WHEN v_fully_returned THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;

-- Closes Known Gap #2 ("stock can go negative") for two specific writers: a purchase return of
-- material already consumed in production, and a manual stock decrease.
--
-- Both differ from apply_sales_delivery/apply_sales_return above in one important way: those two
-- only needed to cap a column (sales_detail.delivered_quantity/returned_quantity) that nothing else
-- writes, so locking it for the length of the function was the whole guarantee — the ledger insert
-- could safely happen afterward, from JS, in a separate call. material.quantity has no such
-- exclusivity: purchases, production, consumables, and other adjustments all touch it via the same
-- AFTER INSERT trigger. If this function only locked material, decided a safe qty, and returned —
-- leaving the ledger INSERT (and the trigger's decrement) to a later JS call — the lock would already
-- be released by the time that INSERT lands, and another writer could shrink material.quantity in the
-- gap, reopening the exact race this exists to close. So the INSERT happens INSIDE this function,
-- inside the same transaction that holds the row lock, and the trigger fires before the lock is ever
-- released.
--
-- Clamps to whatever is LESS: what's still outstanding on this PO line, and what's physically still on
-- the shelf. Returns the quantity actually applied (0 if none) — same "hard cap, soft caller" split as
-- the sales functions.
DROP FUNCTION IF EXISTS apply_purchase_return(uuid, numeric, numeric, text);

-- Now throws on over-return instead of clamping (decision #1), and no longer takes p_unit_cost —
-- it's the PO line's own unit_cost, read under the same lock, not a separate client-supplied value.
CREATE OR REPLACE FUNCTION apply_purchase_return(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_received numeric;
    v_returned numeric;
    v_material_id uuid;
    v_unit_cost numeric;
    v_material_qty numeric;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT received_quantity, returned_quantity, material_id, unit_cost
    INTO v_received, v_returned, v_material_id, v_unit_cost
    FROM purchase_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase line % not found', p_detail_id;
    END IF;
    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Purchase line % has no material linked', p_detail_id;
    END IF;

    v_remaining := v_received - v_returned;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot return % — only % received and not yet returned', p_qty, v_remaining;
    END IF;

    SELECT quantity INTO v_material_qty FROM material WHERE id = v_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material % not found', v_material_id;
    END IF;
    IF p_qty > v_material_qty THEN
        RAISE EXCEPTION 'Cannot return % — only % currently in stock (rest already consumed)', p_qty, v_material_qty;
    END IF;

    UPDATE purchase_detail SET returned_quantity = v_returned + p_qty WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, unit_cost, purchase_detail_id, remark)
    VALUES (v_material_id, 'PURCHASE_RETURN', -p_qty, v_unit_cost, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

CREATE OR REPLACE FUNCTION apply_purchase_return_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_fully_returned boolean;
BEGIN
    PERFORM id FROM purchase_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order % not found', p_header_id;
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM purchase_detail WHERE purchase_detail.detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to purchase order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_purchase_return(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(pd.returned_quantity >= pd.received_quantity) INTO v_fully_returned
    FROM purchase_detail pd WHERE pd.header_id = p_header_id;

    UPDATE purchase_header
    SET status = CASE WHEN v_fully_returned THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END
    WHERE id = p_header_id;

    RETURN;
END;
$$;

-- Manual Stock Adjustment drawer, DECREASE direction only — an INCREASE can never drive stock
-- negative, so it stays on the plain insert path (saveInventoryTransaction). This is a single
-- deliberate form submission, not a multi-line bulk operation, so unlike the functions above it
-- REFUSES outright (RAISE EXCEPTION) rather than silently clamping — a partial silent apply on one
-- field would just be a confusing form, not a courtesy.
CREATE OR REPLACE FUNCTION apply_manual_stock_decrease(
    p_material_id uuid,
    p_product_id uuid,
    p_qty numeric,
    p_unit_cost numeric DEFAULT NULL,
    p_remark text DEFAULT NULL,
    p_transaction_date timestamptz DEFAULT NOW()
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_current numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    IF p_material_id IS NOT NULL THEN
        SELECT quantity INTO v_current FROM material WHERE id = p_material_id FOR UPDATE;
    ELSIF p_product_id IS NOT NULL THEN
        SELECT quantity INTO v_current FROM product WHERE id = p_product_id FOR UPDATE;
    ELSE
        RAISE EXCEPTION 'apply_manual_stock_decrease requires a material or product id';
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'item not found';
    END IF;

    IF p_qty > v_current THEN
        RAISE EXCEPTION 'Cannot decrease by % — only % currently in stock', p_qty, v_current;
    END IF;

    INSERT INTO inventory_transaction (material_id, product_id, transaction_type, quantity, unit_cost, remark, transaction_date)
    VALUES (p_material_id, p_product_id, 'ADJUSTMENT', -p_qty, p_unit_cost, p_remark, p_transaction_date);

    RETURN p_qty;
END;
$$;

-- Receiving is now one atomic transaction per submit, not per-line JS round trips. Throws on
-- over-receipt (a data-entry mistake — the line just doesn't have that much left to receive), not
-- a clamp: see docs/superpowers/specs/2026-07-14-atomic-inventory-mutations-design.md decision #1.
CREATE OR REPLACE FUNCTION apply_purchase_receipt(p_detail_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_quantity numeric;
    v_received numeric;
    v_material_id uuid;
    v_unit_cost numeric;
    v_remaining numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT quantity, received_quantity, material_id, unit_cost
    INTO v_quantity, v_received, v_material_id, v_unit_cost
    FROM purchase_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase line % not found', p_detail_id;
    END IF;

    v_remaining := v_quantity - v_received;
    IF p_qty > v_remaining THEN
        RAISE EXCEPTION 'Cannot receive % — only % still outstanding on this line', p_qty, v_remaining;
    END IF;

    UPDATE purchase_detail
    SET received_quantity = v_received + p_qty
    WHERE detail_id = p_detail_id;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, unit_cost, purchase_detail_id, remark)
    VALUES (v_material_id, 'PURCHASE', p_qty, v_unit_cost, p_detail_id, p_remark);

    RETURN p_qty;
END;
$$;

-- One RPC per "Receive Goods" submit — all lines commit together or none do. Header lock
-- serializes this against any other action on the same PO (a concurrent Return, another Receive).
CREATE OR REPLACE FUNCTION apply_purchase_receipt_batch(p_header_id uuid, p_lines jsonb, p_remark text DEFAULT NULL)
RETURNS TABLE(detail_id uuid, applied_quantity numeric)
LANGUAGE plpgsql
AS $$
DECLARE
    v_line record;
    v_any_positive boolean;
    v_fully_received boolean;
BEGIN
    PERFORM id FROM purchase_header WHERE id = p_header_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order % not found', p_header_id;
    END IF;

    SELECT bool_or((x->>'quantity')::numeric > 0) INTO v_any_positive
    FROM jsonb_array_elements(p_lines) x;
    IF NOT COALESCE(v_any_positive, false) THEN
        RAISE EXCEPTION 'Enter a quantity to receive for at least one line';
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_lines) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM purchase_detail WHERE purchase_detail.detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to purchase order %', v_line.detail_id, p_header_id;
        END IF;
        detail_id := v_line.detail_id;
        applied_quantity := apply_purchase_receipt(v_line.detail_id, v_line.quantity, p_remark);
        RETURN NEXT;
    END LOOP;

    SELECT bool_and(pd.received_quantity >= pd.quantity) INTO v_fully_received
    FROM purchase_detail pd WHERE pd.header_id = p_header_id;

    UPDATE purchase_header
    SET status = CASE WHEN v_fully_received THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
        received_date = CURRENT_DATE
    WHERE id = p_header_id;

    RETURN;
END;
$$;

-- Closes the other half of Known Gap #2 in docs/flows.md: material deducted during production
-- (over-usage reconciliation, AUTOMATIC consumable burn) had no floor check. Always SALES-typed —
-- both callers are material leaving during production, matching the existing convention.
CREATE OR REPLACE FUNCTION apply_material_consumption(p_usage_id uuid, p_qty numeric, p_remark text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_material_id uuid;
    v_material_qty numeric;
BEGIN
    IF p_qty <= 0 THEN
        RETURN 0;
    END IF;

    SELECT material_id INTO v_material_id
    FROM production_material_usage
    WHERE id = p_usage_id
    FOR UPDATE;

    IF NOT FOUND OR v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material usage row % not found or has no material linked', p_usage_id;
    END IF;

    SELECT quantity INTO v_material_qty FROM material WHERE id = v_material_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Material % not found', v_material_id;
    END IF;
    IF p_qty > v_material_qty THEN
        RAISE EXCEPTION 'Cannot consume % — only % in stock', p_qty, v_material_qty;
    END IF;

    INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id, remark)
    VALUES (v_material_id, 'SALES', -p_qty, p_usage_id, p_remark);

    RETURN p_qty;
END;
$$;

-- No upper cap — over-producing is legitimate (yield above plan is extra credit, already how
-- produced_quantity works today). Overwrite, not additive: safe because apply_production_completion
-- claims the header exactly once (IN_PRODUCTION -> DONE_IN_PRODUCTION), so this runs at most once
-- per line per order.
CREATE OR REPLACE FUNCTION apply_production_output(p_detail_id uuid, p_qty numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id uuid;
BEGIN
    SELECT product_id INTO v_product_id
    FROM sales_detail
    WHERE detail_id = p_detail_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sales line % not found', p_detail_id;
    END IF;

    UPDATE sales_detail SET produced_quantity = p_qty WHERE detail_id = p_detail_id;

    UPDATE workflow_tasks
    SET status = 'DONE', end_date = CURRENT_DATE
    WHERE sales_detail_id = p_detail_id AND status NOT IN ('DONE', 'CANCELLED');

    IF p_qty > 0 THEN
        INSERT INTO inventory_transaction (product_id, transaction_type, quantity, sales_detail_id)
        VALUES (v_product_id, 'PRODUCTION', p_qty, p_detail_id);
    END IF;

    RETURN p_qty;
END;
$$;

-- The whole "Mark Production Done" action in one transaction. Replaces confirmProductionDone()'s
-- JS-side loop of saveInventoryTransaction calls entirely.
CREATE OR REPLACE FUNCTION apply_production_completion(
    p_header_id uuid,
    p_reconciliations jsonb,
    p_leftovers jsonb,
    p_produced jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_claimed uuid;
    v_recon record;
    v_consumable record;
    v_leftover record;
    v_produced_line record;
    v_planned numeric;
    v_material_id uuid;
    v_sales_detail_id uuid;
    v_diff numeric;
    v_leftover_qty numeric;
    v_new_usage_id uuid;
BEGIN
    -- Idempotency claim, same guard as today: only the caller that actually flips
    -- IN_PRODUCTION -> DONE_IN_PRODUCTION writes anything. A retry after a partial failure finds
    -- the order already done and is a no-op.
    UPDATE sales_header
    SET status = 'DONE_IN_PRODUCTION'
    WHERE id = p_header_id AND status = 'IN_PRODUCTION'
    RETURNING id INTO v_claimed;

    IF v_claimed IS NULL THEN
        RETURN;
    END IF;

    -- Reconciliation: diff = planned - actual. planned is read off the locked row, never trusted
    -- from the client. diff<0 (used more) goes through the guarded consumption function; diff>0
    -- (used less) is a safe increase, plain insert.
    FOR v_recon IN
        SELECT * FROM jsonb_to_recordset(p_reconciliations) AS x(usage_id uuid, actual_quantity numeric)
    LOOP
        SELECT planned_quantity, material_id, sales_detail_id
        INTO v_planned, v_material_id, v_sales_detail_id
        FROM production_material_usage
        WHERE id = v_recon.usage_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Material usage row % not found', v_recon.usage_id;
        END IF;

        v_diff := v_planned - v_recon.actual_quantity;

        -- Leftovers targeting this same (sales_detail_id, material_id) merge into this row's
        -- returned_quantity instead of becoming a second row.
        SELECT COALESCE(SUM(x.quantity), 0) INTO v_leftover_qty
        FROM jsonb_to_recordset(p_leftovers) AS x(sales_detail_id uuid, material_id uuid, quantity numeric)
        WHERE x.sales_detail_id = v_sales_detail_id AND x.material_id = v_material_id;

        IF v_diff < 0 THEN
            PERFORM apply_material_consumption(v_recon.usage_id, -v_diff, NULL);
        ELSIF v_diff > 0 THEN
            INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
            VALUES (v_material_id, 'ADJUSTMENT', v_diff, v_recon.usage_id);
        END IF;

        IF v_leftover_qty > 0 THEN
            INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
            VALUES (v_material_id, 'ADJUSTMENT', v_leftover_qty, v_recon.usage_id);
        END IF;

        UPDATE production_material_usage
        SET actual_quantity = v_recon.actual_quantity,
            returned_quantity = GREATEST(0, v_diff) + v_leftover_qty
        WHERE id = v_recon.usage_id;
    END LOOP;

    -- AUTOMATIC consumables: found here, not passed in by the client. addOrderConsumable() (Kanban,
    -- unchanged) already set actual_quantity; this just burns it, guarded.
    FOR v_consumable IN
        SELECT pmu.id AS usage_id, pmu.actual_quantity AS actual_quantity
        FROM production_material_usage pmu
        JOIN sales_detail sd ON sd.detail_id = pmu.sales_detail_id
        JOIN material m ON m.id = pmu.material_id
        WHERE sd.header_id = p_header_id
          AND m.material_type = 'CONSUMABLE_MATERIAL'
          AND m.consumption_mode = 'AUTOMATIC'
          AND pmu.actual_quantity > 0
    LOOP
        PERFORM apply_material_consumption(v_consumable.usage_id, v_consumable.actual_quantity, NULL);
    END LOOP;

    -- Leftovers for a material with no existing planned row on that line — a genuine unplanned
    -- by-product — get their own new usage row. (Ones matching a reconciled row were already
    -- merged above.)
    FOR v_leftover IN
        SELECT * FROM jsonb_to_recordset(p_leftovers) AS x(sales_detail_id uuid, material_id uuid, quantity numeric)
    LOOP
        IF v_leftover.quantity <= 0 THEN CONTINUE; END IF;

        IF EXISTS (
            SELECT 1
            FROM production_material_usage pmu
            JOIN jsonb_to_recordset(p_reconciliations) AS r(usage_id uuid, actual_quantity numeric) ON r.usage_id = pmu.id
            WHERE pmu.sales_detail_id = v_leftover.sales_detail_id AND pmu.material_id = v_leftover.material_id
        ) THEN
            CONTINUE;
        END IF;

        INSERT INTO production_material_usage (sales_detail_id, material_id, planned_quantity, actual_quantity, returned_quantity, remark)
        VALUES (v_leftover.sales_detail_id, v_leftover.material_id, 0, 0, v_leftover.quantity, 'Leftover from production')
        RETURNING id INTO v_new_usage_id;

        INSERT INTO inventory_transaction (material_id, transaction_type, quantity, production_material_usage_id)
        VALUES (v_leftover.material_id, 'ADJUSTMENT', v_leftover.quantity, v_new_usage_id);
    END LOOP;

    -- Actual produced credits finished goods at the yield actually achieved, not the plan.
    FOR v_produced_line IN
        SELECT * FROM jsonb_to_recordset(p_produced) AS x(detail_id uuid, quantity numeric)
    LOOP
        PERFORM apply_production_output(v_produced_line.detail_id, v_produced_line.quantity);
    END LOOP;

    -- Belt-and-suspenders close for any line with no produced entry.
    UPDATE workflow_tasks wt
    SET status = 'DONE', end_date = CURRENT_DATE
    FROM sales_detail sd
    WHERE wt.sales_detail_id = sd.detail_id
      AND sd.header_id = p_header_id
      AND wt.status NOT IN ('DONE', 'CANCELLED');
END;
$$;

-- Start Production was the one action left as plain sequential JS (no lock, no transaction) after the
-- atomic-inventory-mutations pass — flagged and deliberately deferred at the time, never closed. Same
-- risk shape as material consumption: a partial JS failure could leave some materials deducted (and
-- their planned_quantity already rewritten) while others weren't, and a retry from the still-ORDERED
-- header would deduct the already-succeeded ones again; two concurrent runs sharing a material had no
-- lock between them and could both pass the pre-check and jointly drive stock negative. One transaction
-- closes both: the idempotency claim below makes a retry-after-rollback start from a clean slate (the
-- whole prior attempt undoes with it), and apply_material_consumption's row lock on `material`
-- serializes concurrent runs instead of letting them race.
CREATE OR REPLACE FUNCTION apply_production_start(p_header_id uuid, p_produce jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_claimed uuid;
    v_any_positive boolean;
    v_line record;
    v_produce_qty numeric;
    v_usage record;
    v_reserved numeric;
BEGIN
    -- Idempotency claim, same pattern as apply_production_completion: only a caller that actually
    -- flips ORDERED/PARTIALLY_DELIVERED -> IN_PRODUCTION writes anything. Because the whole function is
    -- one transaction, a failure anywhere below rolls this claim back too — a retry finds the header
    -- back in a startable state and gets a clean run, never a partial one.
    UPDATE sales_header
    SET status = 'IN_PRODUCTION'
    WHERE id = p_header_id AND status IN ('ORDERED', 'PARTIALLY_DELIVERED')
    RETURNING id INTO v_claimed;

    IF v_claimed IS NULL THEN
        RAISE EXCEPTION 'Sales order % is not in a startable state', p_header_id;
    END IF;

    SELECT bool_or((x->>'quantity')::numeric > 0) INTO v_any_positive
    FROM jsonb_array_elements(p_produce) x;
    IF NOT COALESCE(v_any_positive, false) THEN
        RAISE EXCEPTION 'Enter a produce quantity for at least one product — a run with nothing to make is not allowed.';
    END IF;

    FOR v_line IN
        SELECT * FROM jsonb_to_recordset(p_produce) AS x(detail_id uuid, quantity numeric)
        ORDER BY detail_id
    LOOP
        IF NOT EXISTS (SELECT 1 FROM sales_detail WHERE sales_detail.detail_id = v_line.detail_id AND header_id = p_header_id) THEN
            RAISE EXCEPTION 'Line % does not belong to sales order %', v_line.detail_id, p_header_id;
        END IF;

        v_produce_qty := GREATEST(0, COALESCE(v_line.quantity, 0));

        UPDATE sales_detail SET produce_quantity = v_produce_qty WHERE detail_id = v_line.detail_id;

        INSERT INTO workflow_tasks (sales_detail_id, status, stage, start_date)
        VALUES (v_line.detail_id, 'IN_PRODUCTION', 'PREPARATION', CURRENT_DATE);

        -- Scale each planned material to what's actually being produced, same formula as the old JS
        -- scaledPlan(): reserved = planned * produceQty / orderedQty, rounded to 2dp. Rewriting
        -- planned_quantity here (not just deducting) is the point, not a side effect — it becomes the
        -- reservation snapshot apply_production_completion reconciles actual usage against later.
        FOR v_usage IN
            SELECT pmu.id, pmu.planned_quantity, sd.quantity AS ordered_qty
            FROM production_material_usage pmu
            JOIN sales_detail sd ON sd.detail_id = pmu.sales_detail_id
            WHERE pmu.sales_detail_id = v_line.detail_id
        LOOP
            v_reserved := CASE
                WHEN v_usage.ordered_qty <= 0 OR v_produce_qty <= 0 THEN 0
                ELSE round(v_usage.planned_quantity * (v_produce_qty / v_usage.ordered_qty), 2)
            END;

            UPDATE production_material_usage SET planned_quantity = v_reserved WHERE id = v_usage.id;

            IF v_reserved > 0 THEN
                PERFORM apply_material_consumption(v_usage.id, v_reserved, NULL);
            END IF;
        END LOOP;
    END LOOP;
END;
$$;