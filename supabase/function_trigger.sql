
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