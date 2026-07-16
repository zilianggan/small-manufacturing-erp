# Test Cases — Purchase / Sales / Inventory

Manual test cases for the flows in [`flows.md`](./flows.md). Written to be run by hand against a
seeded DB.

**Legend**
- ✅ asserts intended, correct behaviour.
- ⚠️ asserts **current** behaviour that is arguably wrong (see "Known gaps" in `flows.md`). If one of
  these starts failing, the gap was fixed — update the case, don't "fix" the code back.

**Setup used throughout**
- Material `M1` — starting quantity **100**.
- Material `M2` (`CONSUMABLE_MATERIAL`, `AUTOMATIC`) — starting quantity **50**.
- Material `M3` (`CONSUMABLE_MATERIAL`, `MANUAL`) — starting quantity **50**.
- Product `P1` — starting quantity **0**.
- Vendor `V1`, Client `C1`.

After every case, verify stock by opening the item in Inventory → Material/Product and reading
`quantity`, and cross-check the Inventory ledger row count.

---

## Purchase

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-P-01 | Create quotation | Purchases → Quotation tab → New Quotation. Vendor `V1`, line `M1` × 10 @ RM 5. Save. | Row appears in Quotation tab, ref `PO-xxxx`, total RM 50, status `Quotation`. **`M1` still 100** — no stock movement, no ledger row. |
| TC-P-02 | Latest unit cost prefill | Create a second quotation, add `M1`. | Unit cost field prefills to 5 (last paid). Never-purchased material prefills 0. |
| TC-P-03 | Edit quotation | Edit TC-P-01: change qty to 20. Save. | Total RM 100. Detail rows are **replaced**, not appended — still exactly one line. `M1` still 100. |
| TC-P-04 | Proceed to Purchase Order | On the quotation → Proceed to Purchase Order, set order date, confirm. | Leaves Quotation tab, appears in Purchase Order tab as `Pending Stock` (`ORDERED`) with the order date. **Still no stock movement.** |
| TC-P-05 | Generate Invoice — gating | Look at the row action menu on a `QUOTATION` vs an `ORDERED` / `PARTIALLY_RECEIVED` / `RECEIVED` purchase. | Hidden on `QUOTATION`. Visible on the other three, on both the row menu and the detail page. |
| TC-P-06 | Generate Invoice — content | Open it on the TC-P-04 order. | Modal shows company header, supplier `V1` + address/phone/email, the line items, TOTAL AMOUNT DUE = header total, invoice no = `purchaseNo`. Print opens a popup. **Writes nothing** — no status change, no ledger row. |
| TC-P-07 | **Partial receipt** | On the `ORDERED` PO (`M1` × 20) → Receive Goods. Enter **12**. Confirm. | **`M1` = 100 + 12 = 112.** One `PURCHASE` ledger row, `+12`, against `M1`. Status → **`Partially Received`**. Detail line reads **Received 12 / 20**. |
| TC-P-08 | **Receive the remainder** | Receive Goods again on the same PO. "Receive All" prefills the outstanding 8. Confirm. | **`M1` = 120.** A *second* `PURCHASE` row, `+8` (two rows total, not one `+20`). Status → **`Received`**. Line reads Received 20 / 20. **Receive Goods is no longer offered.** |
| TC-P-09 | Receive cap / double-submit | Reopen the receive modal on a part-received PO and try to type more than outstanding. Also double-click Confirm. | Input clamps to the outstanding qty in the modal. Confirm is disabled until some line has qty > 0. A double-submit does **not** double-count: the second submit's line now exceeds `quantity − receivedQuantity` server-side, so `apply_purchase_receipt_batch()` throws (`Cannot receive ... only ... still outstanding`) and rolls back rather than silently clamping. |
| TC-P-10 | Cancel an order | Create a fresh PO, then Cancel Order. | Status → `Cancelled`. **No stock effect**, no ledger row. |
| TC-P-11 | Delete gating | Check the action menu across statuses. | Delete offered on `QUOTATION` and `CANCELLED` only — never on `ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`, or either returned status. |
| TC-P-12 | Link to a sales order | Create a quotation with a Sales Ref. | `Sales Ref No` column shows the sales no and links to that order. Purely a reference — no stock or lifecycle effect. |
| TC-P-13 | **Partial purchase return** | On the `RECEIVED` PO from TC-P-08 (`M1` = 120) → Return to Vendor. Enter 5. Confirm. | **`M1` = 120 − 5 = 115.** One `PURCHASE_RETURN` ledger row, **`−5`**, against `M1`. Status → `Partially Returned`. Line shows Returned 5 of 20. |
| TC-P-14 | **Full purchase return** | Return the remaining 15 on that same PO. | `M1` = 100. Status → `Returned`. **`Return to Vendor` is no longer offered.** The line renders "fully returned" and is read-only in the modal. |
| TC-P-15 | Return cap / double-submit | Reopen the return modal on a part-returned PO and try to type more than remaining. Also double-click Confirm. | Input clamps to `receivedQuantity − returnedQuantity` in the modal. Confirm disabled until at least one line has a qty > 0. A double-submit's second line now exceeds the remaining server-side, so `apply_purchase_return_batch()` throws (`Cannot return ... only ... received and not yet returned`) and rolls back rather than silently clamping. |
| TC-P-16 | **Return from `PARTIALLY_RECEIVED`** | On a PO with 12 of 20 received, Return to Vendor 4. | Allowed — you can send back what has arrived while the rest is still in transit. `M1` −4. The return caps at the **12 received**, not the 20 ordered. |
| TC-P-17 | Cancel vs Return gating | Check the action menu across statuses. | `Cancel Order` on `ORDERED` **only**. `Return to Vendor` on `PARTIALLY_RECEIVED` / `RECEIVED` / `Partially Returned`. **Never both at once.** `Receive Goods` on `ORDERED` / `PARTIALLY_RECEIVED`. |
| TC-P-18 | Returned orders stay listed | After TC-P-14, look at the Purchase Order tab. | The `Returned` order is still in the list (not filtered out). Delete is **not** offered on it. |

---

## Sales / Production

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-S-01 | Create quotation — two tables | Orders → New Quotation. Client `C1`. **Products** table: `P1` × 10. **Production Materials** table: Product `P1`, Material `M1`, Planned 30. Save. | Ref `SO-xxxx`, status `Quotation`. **No stock movement.** `production_material_usage` holds the planned BOM. No per-row Consumption Mode picker — that's a material-master property (see `M2`/`M3` in Setup), not set per order. |
| TC-S-02 | **Material added after the product** | Add the product line first, click "+ Add Product", **then** add a material row. Save, reopen. | The material is **still there**. (This is the bug the two-table split removes: materials used to be staged against a pending product and were silently dropped if added after the line was committed.) |
| TC-S-03 | Generate Quotation doc | Row menu → Generate Quotation. | Modal shows SALES QUOTATION, client block, product lines, estimated total. Visible on `QUOTATION` only. Writes nothing. |
| TC-S-04 | Edit quotation | Edit, change `M1` planned to 40. | Detail + usage rows replaced. Still no stock movement. |
| TC-S-05 | Proceed to Sales Order | Set delivery date, confirm. | Status → `ORDERED`. **No stock movement yet.** |
| TC-S-06 | **Outstanding demand warns, never blocks** | With an open SO for `P1` × 10 already live, open the form for a *second* SO for `P1` × 10. | Product Demand panel shows `P1`: in stock 0, outstanding **10** (the *other* order only — this one excludes itself), available **−10**, in red, with "additional production may be required". Material Demand shows the same shape for `M1`. **Save still works.** Nothing is reserved. |
| TC-S-07 | **Start Production suggests, user decides** | `P1` has 4 in stock. Open Start Production on an SO for `P1` × 10. | Table shows Ordered 10, In Stock 4, **Suggested 6**, and Produce Qty prefilled to **6** and editable. |
| TC-S-08 | **Stock gate blocks** | Set `M1` planned to 500 (> the 100 on hand). Start Production → Check Material. | Shortfall listed (need 500, have 100) in red, **Confirm stays disabled**. Status stays `ORDERED`, **no ledger row, `M1` unchanged**. Editing Produce Qty down re-arms the Check button. |
| TC-S-09 | **Material scales with Produce Qty** | SO: `P1` × 10, `M1` planned 40 (i.e. the BOM for all 10). `P1` has 5 in stock, so Produce Qty defaults to 5. Confirm. | **Only half the material is taken: `M1` = 100 − 20 = 80** (`40 × 5/10`). The `SALES` ledger row is `−20`. `production_material_usage.planned_quantity` is **rewritten to 20** — it is now the reservation snapshot, not the original BOM. `sales_detail.produce_quantity` = 5. |
| TC-S-10 | **Start Production reserves (full run)** | `P1` at 0, so Produce Qty = ordered = 10, `M1` planned 40. Confirm. | Status → `IN_PRODUCTION`. **`M1` = 100 − 40 = 60.** One `SALES` row, `−40`. One `workflow_tasks` row per line, stage `PREPARATION`. |
| TC-S-11 | Kanban stage move | Workflows → drag the task through the stages. | `stage` updates. **No stock effect at any stage.** |
| TC-S-12 | Add consumable | On the order, add consumable `M2` × 5. | A usage row is created with `actual_quantity` 5. **`M2` is still 50 at this point** — consumables deduct at completion, not on add. |
| TC-S-13 | **Complete — used exactly as planned** | Mark Production Done. Actual `M1` = 40 (= reserved), Actual Produced = Planned Produce. | Status → `DONE_IN_PRODUCTION`, tasks → `DONE`. `diff = 0` → **no reconciliation ledger row**. `M1` stays 60. |
| TC-S-14 | **Complete — used less** | Same but actual `M1` = 30 (reserved 40). | `ADJUSTMENT` `+10` → **`M1` = 60 + 10 = 70.** `production_material_usage.returned_quantity` = 10. |
| TC-S-15 | **Complete — used more** | Same but actual `M1` = 50 (reserved 40). | `SALES` `−10` → **`M1` = 60 − 10 = 50.** With only, say, 5 `M1` on hand and an actual of 50, `apply_material_consumption()` now throws (`Cannot consume ... only ... in stock`) and the whole completion rolls back rather than driving stock negative. |
| TC-S-16 | **Complete — consumables honour the row's mode** | Complete with `M2` (AUTOMATIC) actual 5 and `M3` (MANUAL) actual 5. | `M2`: `SALES` `−5` → **50 → 45**. `M3`: **stays 50** — MANUAL is history only, settled by hand (TC-I-02). Flipping `M3`'s Consumption Mode to `Automatic` **on the order** makes it deduct too, without touching the material master. |
| TC-S-17 | **Actual Produced credits finished goods** | SO `P1` × 5, Produce Qty 5. Mark Production Done, **Actual Produced = 5**. | **`P1` = 0 + 5 = 5.** Exactly one `PRODUCTION` ledger row, `+5`, against `P1`, showing the order's ref no. and client. `sales_detail.produced_quantity` = 5. |
| TC-S-18 | **Short run credits less** | Same, but Actual Produced = **3** (planned 5). | **`P1` = 3**, not 5. One `PRODUCTION` row, `+3`. The ordered quantity does **not** enter into it. |
| TC-S-19 | **Over-run credits more** | Same, but Actual Produced = **7** (planned 5). | **`P1` = 7.** One `PRODUCTION` row, `+7`. This is what the old separate "Extra Produced" box meant — there is no such box now, and **no blank-named row appears in Materials Used**. |
| TC-S-20 | **Complete — leftover** | Complete with a leftover of `M1` × 3. | Leftover → `ADJUSTMENT` `+3` on `M1`. A leftover for a material already planned on that line merges into its `returned_quantity` (one row in Materials Used, not two). |
| TC-S-21 | **Partial delivery** | On a `DONE_IN_PRODUCTION` SO (`P1` × 10, `P1` = 10 in stock) → Deliver. Enter **4**. Confirm. | **`P1` = 10 − 4 = 6.** One `SALES` row, `−4`. Status → **`Partially Delivered`**. Line reads Delivered 4 / 10. |
| TC-S-22 | **Deliver the remainder** | Deliver again; "Deliver All" prefills the outstanding 6. | **`P1` = 0.** A *second* `SALES` row, `−6`. Status → **`Delivered`**. `Deliver` is no longer offered. |
| TC-S-23 | Delivery cap / double-submit | Reopen the deliver modal and try to exceed the outstanding. Double-click Confirm. | Clamps to `min(quantity − deliveredQuantity, product stock)` — now checked against physical product stock too, not just the order line. A double-submit does **not** double-debit: `apply_sales_delivery_batch()` row-locks both `sales_detail` and `product` per line and re-clamps. (Note there is no status-claim lock here, unlike Mark Production Done: a second delivery is legitimate, so the clamp is the guard.) |
| TC-S-24 | **Return caps on DELIVERED, not ORDERED** | On the `Partially Delivered` order from TC-S-21 (4 of 10 shipped) → Return from Client. | The modal's Delivered column reads **4**, and the input caps at **4** — **not 10**. You cannot return what hasn't shipped. |
| TC-S-25 | **Partial sales return** | On a `DELIVERED` SO (`P1` × 5, so `P1` = 0 after shipping) → Return from Client. Enter 3. | **`P1` = 0 + 3 = 3.** One `SALES_RETURN` row, **`+3`**, against `P1`. Status → `Partially Returned`. Line shows Returned 3 of 5. |
| TC-S-26 | **Full sales return** | Return the remaining 2. | `P1` = 5. Status → `Returned`. `Return from Client` no longer offered; the line is read-only in the modal. |
| TC-S-27 | Cancel from `ORDERED` | Cancel before starting production. | Plain status flip. **No ledger row, no stock change.** |
| TC-S-28 | Cancel from `IN_PRODUCTION` | Start production on an order reserving `M1` −40, then Cancel Order. | Material comes back: **`ADJUSTMENT` `+40`** (not `SALES_RETURN` — un-reserving is an internal correction; `SALES_RETURN` means a client return only). `M1` back to 100, tasks → `CANCELLED`. |
| TC-S-29 | **Cancel from `DONE_IN_PRODUCTION`** | Take an SO for `P1` × 5 to `DONE_IN_PRODUCTION` (so `P1` = 5), then Cancel Order. | Status → `Cancelled`. **`P1` stays 5** — no ledger row. The goods were made; cancelling the order doesn't unmake them, and they stay in stock to sell to someone else. |
| TC-S-30 | Cancel vs Return gating | Check the action menu across statuses. | `Cancel Order` on `ORDERED` / `IN_PRODUCTION` / `DONE_IN_PRODUCTION`. `Deliver` on `DONE_IN_PRODUCTION` / `Partially Delivered`. `Return from Client` on `Partially Delivered` / `Delivered` / `Partially Returned`. **Cancel and Return never appear together.** |
| TC-S-31 | Delete gating is `QUOTATION`-only | Check the action menu on a `QUOTATION`, an `ORDERED`, a `CANCELLED` (cancelled from `ORDERED`), and a `CANCELLED` (cancelled from `IN_PRODUCTION`). | **Delete** offered only on `QUOTATION`. Every other status — including both `Cancelled` orders, regardless of ledger history — shows no Delete button; a Sales Order is a business document from `ORDERED` onward and stays on record forever. `flows.md` known gaps #1/#4 (fixed). |
| TC-S-32 | **Complete — stock gate blocks over-usage before submit** | On the TC-S-10 order (`M1` reserved 40, `M1` = 60 on hand) → Mark Production Done. Set Actual `M1` = 200. Click Check Material. | Shortfall listed (need 160, have 60) in red, **Confirm Production Done stays disabled** — button still reads "Check Material". No RPC call made: status stays `IN_PRODUCTION`, `M1` unchanged. Editing Actual `M1` back down clears the check (button reverts to "Check Material"); entering a value with enough stock and re-checking shows the green "Material is sufficient" bar and unlocks Confirm. **After that clean check**, bumping Actual Produced or adding a leftover does **not** clear it — Confirm stays unlocked with no re-check needed, since neither touches material stock. |
| TC-S-33 | **Complete — stock gate blocks a short AUTOMATIC consumable** | Add consumable `M2` (AUTOMATIC) × 100 to an order where `M2` = 50 on hand, then Mark Production Done → Check Material. | Shortfall listed for `M2` (need 100, have 50) — the consumable's fixed `actual_quantity` from Add Consumable, not something typed in this modal. `M3` (MANUAL) at any quantity never appears here — MANUAL consumables don't draw stock. |

---

## Inventory

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-I-01 | Adjustment — material INCREASE | Inventory → Stock Adjustment. Target Material `M1`, direction INCREASE, qty 5. Save. | `ADJUSTMENT` row `+5` → **`M1` +5**. Appears in the ledger. |
| TC-I-02 | Adjustment — material DECREASE | Same but DECREASE 5. | `ADJUSTMENT` row `−5` → **`M1` −5**. This is the intended way to settle MANUAL consumables from TC-S-16. |
| TC-I-03 | Adjustment — product DECREASE | Target **Product** `P1`, DECREASE, qty 2. | `ADJUSTMENT` row `−2` with `product_id` set → **`P1` −2**. |
| TC-I-04 | Import adjustments | Import an inventory-adjustment sheet with a negative quantity against a product. | Signed quantity is written straight through → product stock decreases. |
| TC-I-05 | ⚠️ Stock can go negative | `P1` at 2, adjust DECREASE by 10. | **Allowed. `P1` = −8.** No constraint, no warning. |
| TC-I-06 | ⚠️ Delete a ledger row does not reverse stock | Note `M1`'s quantity, delete a ledger row from the DB (there is no UI for this), re-read `M1`. | **`M1` is unchanged.** The trigger is `AFTER INSERT` only. |
| TC-I-07 | Ledger search by item name | Search the ledger for a material/product name. | Rows for that item come back (name is resolved to an id first, then matched on `material_id` / `product_id`). |
| TC-I-08 | Ledger item filter | Filter by 2 materials + 1 product. | Returns rows matching **any** of them (the id sets are OR'd), AND'd with the active search. |
| TC-I-09 | Stats — top consumed | Open the statistics dialog. | Stock In/Out totals split on the sign of `quantity`. "Top Consumed" lists **materials only** — deliberately, since products *do* have ledger rows for ordinary sales now but mixing finished goods into a "top consumed materials" list would compare two different things. |
| TC-I-10 | Quantity is trigger-owned | Edit a material/product (rename it, change price) and save. | **`quantity` is untouched.** The serializers in `helper.ts` omit it, so an edit cannot stomp the trigger-maintained value. |
| TC-I-11 | Finished-goods rows are legible | After TC-S-17 / TC-S-21, open Inventory → ledger and filter type = `Production`. | `PRODUCTION` rows show `P1`, `+qty`, **and the sales order's ref no. + client name** (via the `sales_detail_id` join). Clicking through opens the sales order. `Production` appears as a filter chip. |
| TC-I-12 | Imported sales orders are returnable | Import a sales sheet, then open one of the imported (`Delivered`) orders → Return from Client. | The Delivered column shows the **full ordered qty**, not 0, so the return is possible. (The importer sets `delivered_quantity` to match the `DELIVERED` status it writes.) |

---

## End-to-end

| ID | Case | Steps | Expected |
|---|---|---|---|
| TC-E-01 | Buy → build → ship, all partial | 1. PO `M1` × 50 @ RM 5; receive **30**, then **20**. 2. SO `P1` × 10, planned `M1` × 30. 3. Start Production, Produce Qty 10. 4. Mark Production Done, actual `M1` = 30, Actual Produced 10. 5. Deliver **6**, then **4**. | `M1`: 100 → **130** → **150** (two receipts) → **120** (reservation) → 120 (no reconciliation, `diff = 0`). `P1`: 0 → **10** (`PRODUCTION`) → **4** → **0** (two `SALES` rows). Ledger holds exactly **6** rows: `PURCHASE +30`, `PURCHASE +20`, `SALES −30` (`M1`), `PRODUCTION +10` (`P1`), `SALES −6`, `SALES −4` (`P1`). Header statuses walk `ORDERED → Partially Received → Received` and `ORDERED → In Production → Done in Production → Partially Delivered → Delivered`. |
| TC-E-02 | Produce only the shortfall | `P1` has 4 in stock. SO `P1` × 10, `M1` planned 40. Start Production (accept the suggested Produce Qty 6), Mark Done with Actual Produced 6, then Deliver all 10. | Material taken is **24**, not 40 (`40 × 6/10`). `P1`: 4 → **10** (`PRODUCTION +6`) → **0** (`SALES −10`). The order ships 10 even though only 6 were made — the other 4 came off the shelf. |
| TC-E-03 | PO raised against a sales order | Create a sales order, then a purchase quotation with that order as its Sales Ref. Receive it. | The purchase links to the sales order in both directions (cross-tab nav works). The receipt credits `M1` normally. **The link itself has no stock or lifecycle effect** — it does not reserve, allocate, or auto-progress anything. |
