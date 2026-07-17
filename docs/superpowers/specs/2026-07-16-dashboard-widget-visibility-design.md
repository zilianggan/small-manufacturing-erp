# Dashboard Widget Visibility — Design

## Goal
Let the user hide/show individual dashboard sections. A floating config button (bottom-right) opens a panel with a checkbox per section. Preference persists via Supabase (single shared row, no per-user auth in this app), cached in localStorage same as `company_profile`.

## Toggle granularity
Section-level. Ten toggle keys, one per existing block in `DashboardView.tsx`:

| Key | Section |
|---|---|
| `KPI_ROW` | Revenue/Purchases/Gross Profit/Inventory Units/Outstanding Orders stat row |
| `SALES_TREND` | Sales Trend area chart |
| `INVENTORY_DISTRIBUTION` | Inventory Distribution pie chart |
| `PURCHASE_VS_SALES` | Purchase vs Sales bar chart |
| `INVENTORY_HEALTH` | Inventory Health card |
| `QUICK_ACTIONS` | Quick Actions grid |
| `RECENT_SALES` | Recent Sales list |
| `RECENT_PURCHASES` | Recent Purchases list |
| `CRITICAL_STOCK_ALERTS` | Critical Stock Alerts list |
| `PRODUCTION_STATUS` | Production Status stage bars |
| `ACTIVITY_TIMELINE` | Activity Timeline |

KPI cards are not individually toggleable — the whole row is one unit.

## Data model
New table `dashboard_preferences`, single row (mirrors `company_profile`):

```sql
create table dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  visible_sections jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
```

`visible_sections` maps section key → boolean. Missing key = visible (default-on), so old rows and new keys added later don't need a migration. Appended to `supabase/schema.sql`; user runs it manually (no DB access from this environment).

`types.ts`: add
```ts
export type DashboardSectionKey =
  | 'KPI_ROW' | 'SALES_TREND' | 'INVENTORY_DISTRIBUTION' | 'PURCHASE_VS_SALES'
  | 'INVENTORY_HEALTH' | 'QUICK_ACTIONS' | 'RECENT_SALES' | 'RECENT_PURCHASES'
  | 'CRITICAL_STOCK_ALERTS' | 'PRODUCTION_STATUS' | 'ACTIVITY_TIMELINE';

export interface DashboardPreferences {
  id?: string;
  visible_sections: Partial<Record<DashboardSectionKey, boolean>>;
}
```

## Service
`src/services/DashboardPreferencesService.ts`, same cache-aside shape as `CompanyProfileService.ts`:
- `getDashboardPreferences()`: localStorage cache (no TTL needed — invalidated on save) → `supabase.from('dashboard_preferences').select('*').maybeSingle()` → cache result.
- `saveDashboardPreferences(prefs)`: update if `id` present else insert, then invalidate localStorage cache.

## UI
- `DashboardView.tsx` loads preferences alongside existing `Promise.all` fetch (one more promise, same batch). Data for all sections is still fetched unconditionally — only rendering is gated. Not worth lazy-loading data per section for a cosmetic toggle.
- Each section block wraps its existing render in `visible('KEY') && (...)`.
- New floating button: `position: fixed`, bottom-right (`bottom-6 right-6`), circular, `Settings` icon (lucide-react), above other content (`z-50`). Lives in `DashboardView.tsx` itself (single-view feature, no shared shell change needed).
- Clicking opens a `Popover` (existing `components/ui/Popover.tsx`) anchored to the button, listing all 10 sections as labeled checkboxes reading/writing local state.
- Checkbox toggle updates local state immediately (instant UI feedback) and calls `saveDashboardPreferences` (debounce not needed — infrequent, low-stakes writes, fire-and-forget per toggle).
- No "save"/"cancel" buttons — toggles apply immediately, matches how other settings-lite UI in the app behaves (no confirmation dialogs for non-destructive preference changes).

## Error handling
Preference fetch failure → default all-visible (same fallback as missing keys), console.error only, no user-facing error — this is a cosmetic feature, not business data.

## Out of scope
- Section reordering / drag-and-drop.
- Per-user preferences (no auth/session concept exists in this app).
- Individual KPI card toggles.
