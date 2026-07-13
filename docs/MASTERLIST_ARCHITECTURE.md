# Masterlist architecture: CP, L, and C

This document describes how portal customer identifiers relate to SAP Business Partner codes, which portal menus own each layer, and how promotion preserves job links.

## Three identifier layers

| Layer | Code format | Primary storage | Description |
|-------|-------------|-----------------|-------------|
| **CP** (Portal customer) | `CP#####` | `public.customer` (`customer_code`) | Adhoc or Google Form customers created in the portal before or during SAP sync |
| **L** (SAP Lead) | `L#####` | `customer.sap_card_code`; mirror in `public.sap_lead` | SAP Business Partner (CardType Lead) created when portal runs **Convert to SAP** |
| **C** (SAP Customer) | `C#####` | `customer.customer_code` after sync | Official SAP customer (CardType Customer); imported via sync or promoted from CP |

**Important:** After CP → L convert, `customer_code` remains `CP#####` and `sap_card_code` stores `L#####`. After CP → C promotion, `customer_code` becomes `C#####` on the **same** `customer.id` row.

## Three portal menus

| Menu | Route | What it shows |
|------|-------|---------------|
| **Portal Customers** | `/customer-leads` | CP-coded portal customers and Google Form leads; **Convert to SAP** (CP → L) |
| **SAP Leads** | `/leads` | SAP Lead masterlist (`sap_lead` table / live SAP API backup) — L-coded prospects |
| **SAP Customers** | `/customers` | Portal masterlist of synced SAP customers; **Sync from SAP** (CP → C promotion) |

Navigation: **Customers** → Portal Customers / SAP Customers / SAP Leads (`routes/dashboard/NavbarTopRoutes.js`).

## Full lifecycle

```mermaid
sequenceDiagram
  participant Portal as PortalCustomers
  participant SAP as SAP_B1
  participant Sync as SAPCustomers_Sync
  participant DB as customer_table

  Portal->>DB: Create CP##### (Google Form or Create Customer)
  Portal->>SAP: Convert to SAP (CP → L)
  Portal->>DB: customer_code stays CP; sap_card_code = L#####
  Note over DB: synced_to_sap_at set; jobs use customer_id UUID
  SAP->>SAP: Staff promotes L → C (new C##### BP)
  Sync->>SAP: Sync from SAP — enter C#####
  Sync->>DB: promotePortalCustomerFromSap — CP → C same UUID
  Note over DB: jobs.customer_id unchanged
```

### Step-by-step

| Step | Where | What happens |
|------|-------|--------------|
| 1 | Portal Customers | Create `CP#####` (Google Form sync or **Create Customer**) |
| 2 | Portal Customers | **Convert to SAP** — portal’s only conversion; `customer_code` stays `CP`, `sap_card_code` becomes `L#####` |
| 3 | SAP B1 | Staff promote Lead → Customer; SAP issues `C#####` |
| 4 | SAP Customers | **Sync from SAP** with the new `C#####` code |
| 5 | After sync | Matching CP row promoted: `CPXXX` → `CXXX` on the same `customer.id`; SAP fields refreshed |

**Example:** `CP00125 Jason Mee` (3 jobs) → convert → `sap_card_code` `L00438` → SAP promotes to `C004512` → Sync → row becomes `C004512 Jason Mee`; all 3 jobs remain linked.

## Key implementation files

| File | Role |
|------|------|
| `lib/customers/promotePortalCustomerFromSap.js` | Rewrites `customer_code` from `CP#####` to `C#####` in place; refreshes SAP fields and locations |
| `pages/api/customers/sync-delta.js` | Triggers promotion when syncing a C code (auto-match or explicit `portalCustomerCode`) |
| `pages/dashboard/customers/list.js` | UI entry point — **Sync from SAP** |
| `lib/integrations/aifmSapMasterlistSync.js` | Imports C codes into `customer`; L codes into `sap_lead` |
| `lib/integrations/sapDeltaSyncPreview.js` | Preview promotion resolution before apply |

### Promotion matching

1. **Auto:** `resolvePortalCustomerForPromotion` — synced CP row (`synced_to_sap_at` set, `customer_code` like `CP%`), matched by SAP C name then email/phone tie-break.
2. **Manual:** `portalCustomerCode` + `customerCode` in sync-delta request body.

### What changes on CP → C promotion

- `customer_code`: `CPXXX` → `CXXX`
- Name, address, phone, email, locations refreshed from SAP
- Duplicate empty C row soft-deleted if no jobs attached
- **Jobs, locations, equipments, contacts:** no FK updates — they reference `customer_id`, not `customer_code`

## Job linkage

Jobs reference customers by **UUID**, not by code:

```
jobs.customer_id → customer.id
```

When CP promotes to C:

- `customer.id` does **not** change
- `jobs.customer_id` stays valid — historical jobs remain on the customer record
- `customer_code` displayed in the UI updates from `CP#####` to `C#####`

**Caveat:** Jobs already pushed to SAP under the old CP or L CardCode may need a **re-sync to SAP** after promotion. Portal history and FK links are preserved regardless.

In Create Job / Edit Job, service calls can be resolved from both `CP#####` and `sap_card_code` (`L#####`) while the row is still CP-coded. After promotion, the primary CardCode is `C#####`; `relatedCardCodes` may still include the historical L code from `sap_card_code`.

## What the portal does NOT do

| Action | Where it actually happens |
|--------|---------------------------|
| **CP → C** convert button | Does not exist — only CP → L in Portal Customers |
| **L → C** promotion | SAP Business One — staff action, not portal |
| Automatic CP → C without sync | Does not happen — requires **Sync from SAP** after C exists in SAP |
| Create jobs on CP → L convert | Jobs are created separately via **Create Jobs from Lead** |

## Related documentation

- [PORTAL_CP_TO_SAP_L.md](./PORTAL_CP_TO_SAP_L.md) — CP → L convert flow, duplication guards, operational checklist
- [SAP_SYNC_IMPLEMENTATION.md](./SAP_SYNC_IMPLEMENTATION.md) — Portal → SAP BusinessPartner sync APIs
