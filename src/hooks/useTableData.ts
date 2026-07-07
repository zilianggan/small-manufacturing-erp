import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTableDataOptions {
  search?: string;
  filters?: Record<string, string>;
  pageSize?: number;
}

interface UseTableDataResult<T> {
  data: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refetch: () => void;
}

const ROW_MAPPERS: Record<string, (row: any) => any> = {
  inventory_items: (i) => ({
    id: i.id, name: i.name, sku: i.sku, type: i.type,
    materialCategoryId: i.material_category_id,
    productCategoryId: i.product_category_id,
    quantity: Number(i.quantity), unit: i.unit, unitCost: Number(i.unit_cost),
    reorderPoint: Number(i.reorder_point), supplierId: i.supplier_id,
    description: i.description, attachments: i.attachments || []
  }),
  vendors: (v) => ({
    id: v.id, companyName: v.company_name, email: v.email, officeNo: v.office_no,
    address: v.address, description: v.description || '',
    attachments: v.attachments || [],
    createdAt: v.created_at, updatedAt: v.updated_at
  }),
  clients: (c) => ({
    id: c.id, companyName: c.company_name, email: c.email, officeNo: c.office_no,
    address: c.address, description: c.description || '',
    attachments: c.attachments || [],
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
  contacts: (p) => ({
    id: p.id, fullName: p.full_name, contactNo: p.contact_no, email: p.email,
    jobPositionId: p.job_position, vendorId: p.vendor_id, clientId: p.client_id,
    attachments: p.attachments || [],
    createdAt: p.created_at, updatedAt: p.updated_at
  }),
  sales_orders: (o) => ({
    id: o.id, clientId: o.client_id, clientName: o.client_name, itemId: o.item_id,
    itemName: o.item_name, quantity: Number(o.quantity), unitPrice: Number(o.unit_price),
    totalPrice: Number(o.total_price), orderDate: o.order_date, deliveryDate: o.delivery_date,
    status: o.status, workflowTaskId: o.workflow_task_id,
    attachments: o.attachments || [], items: o.items || []
  }),
  purchase_orders: (o) => ({
    id: o.id, vendorId: o.vendor_id, vendorName: o.vendor_name, itemId: o.item_id,
    itemName: o.item_name, quantity: Number(o.quantity), unitCost: Number(o.unit_cost),
    totalCost: Number(o.total_cost), orderDate: o.order_date, status: o.status,
    receivedDate: o.received_date, attachments: o.attachments || [], items: o.items || []
  }),
  employees: (e) => e,
  job_positions: (p) => ({
    id: p.id, name: p.name, isActive: p.is_active ?? true,
    createdAt: p.created_at, updatedAt: p.updated_at
  }),
  material_categories: (c) => ({
    id: c.id, name: c.name, isActive: c.is_active ?? true,
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
  product_categories: (c) => ({
    id: c.id, name: c.name, isActive: c.is_active ?? true,
    createdAt: c.created_at, updatedAt: c.updated_at
  }),
  company_profile: (c) => ({
    name: c.name,
    iconType: c.icon_type,
    iconDataUrl: c.icon_data_url,
    address: c.address,
    phone: c.phone,
    email: c.email,
    bankName: c.bank_name,
    bankAccount: c.bank_account,
    signatureUrl: c.signature_url,
    chopUrl: c.chop_url
  }),
};

// Fetches the full table via the backend endpoint, optionally narrowed by a
// search string and equality filters.
// NOTE: limit/offset pagination was rolled back (it was causing issues) -
// this now always fetches the whole (filtered) table in one request.
const fetchAllData = async (
  table: string,
  search?: string,
  filters?: Record<string, string>
) => {
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  }
  const qs = params.toString();
  const res = await fetch(`/api/data/${table}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`);
  return res.json();
};

// Table data hook. Fetches the whole (optionally search/filter-narrowed)
// table in one request - no pagination. `loadMore`/`hasMore`/`loadingMore`
// are kept in the returned shape for compatibility with existing callers
// (e.g. InfiniteScrollSentinel) but are effectively no-ops now, since
// everything is loaded up front.
export function useTableData<T>(table: string, options: UseTableDataOptions = {}): UseTableDataResult<T> {
  const { search = '', filters } = options;
  const filtersKey = filters ? JSON.stringify(filters) : '';

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const mapper = ROW_MAPPERS[table] || ((r: any) => r);

    // Only show the full loading state on the very first fetch. Later
    // refetches (search-as-you-type, filter changes) happen quietly in the
    // background so views don't unmount/remount their tree (and lose input
    // focus, e.g. on the search box) on every keystroke.
    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    setError(null);

    fetchAllData(table, search, filters)
      .then((json) => {
        if (cancelled) return;
        const rows = (json.data || []).map(mapper);
        setData(rows);
        setLoading(false);
        hasLoadedRef.current = true;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
        hasLoadedRef.current = true;
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, search, filtersKey, tick]);

  const loadMore = useCallback(() => {}, []);
  const refetch = () => setTick(t => t + 1);

  return { data, loading, loadingMore: false, hasMore: false, error, loadMore, refetch };
}
