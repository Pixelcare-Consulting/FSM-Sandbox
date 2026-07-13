# Portal CP → SAP Lead (L) conversion

The portal performs **one** customer conversion: **CP → L**. It does **not** convert CP → C or promote L → C.

| Conversion | Where it happens |
|------------|------------------|
| **CP → L** | Portal Customers — **Convert to SAP** |
| **L → C** | SAP Business One — staff promote Lead → Customer |
| **CP → C** (masterlist) | SAP Customers page — **Sync from SAP** (`promotePortalCustomerFromSap`) |

See [MASTERLIST_ARCHITECTURE.md](./MASTERLIST_ARCHITECTURE.md) for the full CP / L / C lifecycle.

## Identifier layers

| Layer | Format | Stored in portal | Purpose |
|-------|--------|------------------|---------|
| Portal customer | `CP#####` | `customer.customer_code` | Stable portal ID for adhoc / Google Form customers |
| SAP Lead | `L#####` | `customer.sap_card_code` | SAP Business Partner after **Convert to SAP** |
| SAP Customer | `C#####` | `customer.customer_code` after sync promotion | Official SAP customer; imported or promoted from CP |

After CP → L convert, `customer_code` stays `CP#####` and `sap_card_code` holds `L#####`. After CP → C promotion via Customer Sync, `customer_code` becomes `C#####` on the **same row** (`customer.id` UUID unchanged).

## Convert flow (CP → L only)

1. Open **Portal Customers** (`/customer-leads`) → **View** → **Convert to SAP**.
2. Preview (`POST /api/leads/[leadId]/convert-preview`) shows portal vs SAP Lead details and duplicate warnings.
3. Confirm runs `POST /api/leads/[leadId]/create-customer` / `syncCustomerToSapCore`.
4. **CP code is preserved** — `customer_code` stays `CP00125`; `sap_card_code` stores `L00438`.
5. `synced_to_sap_at` is set; status shows **CONVERTED**.

No jobs are created on convert. Use **Create Jobs from Lead** after sync.

The portal does **not** change `customer_code` from `CP` to `C` during convert. That step requires SAP staff to promote L → C, then **Sync from SAP** on the Customers page.

## CP → C masterlist promotion (Customer Sync)

When SAP staff have promoted a Lead to Customer (`C#####` exists in SAP):

1. Open **SAP Customers** (`/customers`) → **Sync from SAP**.
2. Enter the new `C#####` code (or run a delta sync that includes it).
3. `POST /api/customers/sync-delta` calls `promotePortalCustomerFromSap` when a matching synced CP row is found.
4. The portal row is updated in place: `CP00125` → `C004512` on the same `customer.id`.
5. **Jobs stay linked** — `jobs.customer_id` points at the UUID, not `customer_code`, so existing jobs remain attached without FK updates.

**Matching:**

- **Auto:** `resolvePortalCustomerForPromotion` finds a synced CP row (`synced_to_sap_at` set, code like `CP%`) by SAP C name, then email/phone tie-break.
- **Manual:** pass `portalCustomerCode` + `customerCode` in the sync-delta body when auto-match fails.

**Key files:** `lib/customers/promotePortalCustomerFromSap.js`, `pages/api/customers/sync-delta.js`.

## Duplication prevention

- **Internal Create Customer** (`POST /api/customers/create`): blocks duplicate email/phone (409 + link to existing CP).
- **Google Form sync**: skips responses whose email/phone already exists in portal; preview lists existing `customer_code`.
- **Convert preview**: warns when sibling CP rows share the same email/phone.

Before converting, resolve sibling CP records manually — do not create a second L for the same person.

## L → C in SAP (not in portal)

After CP → L convert, **SAP Business One staff** promote the Lead to Customer when the prospect is ready:

- SAP creates a new Business Partner with CardCode `C#####`.
- The portal row is unchanged until someone runs **Sync from SAP** on the Customers page.
- Until sync, documents may be split in SAP (e.g. quotation on C, service call on L). Align master data in SAP before scheduling jobs when both codes exist.

In Create Job, service calls are loaded for both `CP#####` and linked `sap_card_code` (`L#####`) when present. After CP → C promotion, Create Job uses **C#####** as the primary CardCode.

Open **quotations do not create service calls** — a separate SAP Service Call document is required for the job dropdown.

Jobs already pushed to SAP under the old CP or L code may need a **re-sync to SAP** after CP → C promotion. Portal job history stays linked via `customer_id` UUID.

## Operational checklist

1. One CP per person in portal (use duplicate guards).
2. Convert CP → L once; verify `sap_card_code` on the portal row.
3. In SAP B1, promote L → C when the prospect becomes a customer.
4. On **SAP Customers**, run **Sync from SAP** with the new `C#####` to promote `CPXXX` → `CXXX` in the masterlist.
5. Confirm jobs still appear on the customer record (same UUID).
6. Create or link SAP Service Calls on the CardCode that holds them (often C after promotion and sync).
