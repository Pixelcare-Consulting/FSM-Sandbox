import { requireSession } from '../../../lib/auth/requireSession';
import {
  promotePortalCustomerFromSap,
  resolvePortalCustomerForPromotion,
} from '../../../lib/customers/promotePortalCustomerFromSap';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { syncSapHitsToMasterlist } from '../../../lib/integrations/aifmSapMasterlistSync';
import {
  applyMasterlistSummary,
  customersWrittenCount,
  defaultDateRange,
  fetchSapBusinessPartnersInRange,
  getTargetedSapHit,
  isOfficialSapCustomerCode,
  MAX_ERROR_ITEMS,
  normalizeCustomerCode,
} from '../../../lib/integrations/sapDeltaSyncCore';
import { previewSapDeltaSync } from '../../../lib/integrations/sapDeltaSyncPreview';
import { computeAddressChangesForEntity } from '../../../lib/integrations/sapDeltaSyncAddressPreview';
import { fetchBpDetails } from '../../../lib/integrations/aifmSapMasterlistSync';
import {
  loginSessionCookiesFromEnvironment,
  unwrapSapEnvironmentLogin,
} from '../../../lib/services/sapService';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../lib/services/auditLog';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';

function invalidateSapMasterlistCache() {
  invalidateListCache('customers-sap-masterlist');
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body || {};
}

async function logDeltaSyncAudit(req, summary, status) {
  const removedCount = summary.locations?.removed ?? 0;
  const auditStatus =
    removedCount > 0 && status === AUDIT_STATUS.SUCCESS ? AUDIT_STATUS.WARNING : status;

  await writeAuditLogFromRequest(req, {
    action: AUDIT_ACTIONS.SAP_CUSTOMER_DELTA_SYNC,
    category: AUDIT_CATEGORIES.SAP,
    entityType: 'customer',
    entityId: summary.customerCode || null,
    entityLabel: summary.customerCode || summary.mode || 'delta',
    description:
      status === AUDIT_STATUS.SUCCESS
        ? removedCount > 0
          ? `SAP customer delta sync completed (${summary.mode}) — ${removedCount} portal address(es) removed`
          : `SAP customer delta sync completed (${summary.mode})`
        : `SAP customer delta sync failed (${summary.mode})`,
    details: {
      mode: summary.mode,
      customerCode: summary.customerCode,
      portalCustomerCode: summary.portalCustomerCode,
      dateRange: summary.dateRange,
      counts: summary.counts,
      locations: summary.locations || null,
      locationWarnings: summary.locationWarnings || null,
      addressChanges: summary.addressChanges || null,
      warning:
        removedCount > 0
          ? `${removedCount} portal address row(s) removed during sync`
          : undefined,
      errors: summary.errors?.slice(0, MAX_ERROR_ITEMS),
      elapsedMs: summary.elapsedMs,
    },
    status: auditStatus,
  });
}

function applyLocationSummaryToDelta(summary, masterlistSummary) {
  if (!masterlistSummary?.locations) return;
  summary.locations = { ...masterlistSummary.locations };
  if (masterlistSummary.locationWarnings?.length) {
    summary.locationWarnings = masterlistSummary.locationWarnings;
    if (!summary.addressChanges) {
      summary.addressChanges = masterlistSummary.locationWarnings.map((w) => ({
        cardCode: w.cardCode,
        action: 'remove',
        labels: w.removedLabels || [],
        count: w.removed,
      }));
    }
  }
}

function buildSyncResponseWarnings(summary) {
  const warnings = [];
  const removed = summary.locations?.removed || 0;
  if (removed > 0) {
    warnings.push(
      `Sync removed ${removed} portal service location row(s). Review addressChanges or audit log before assuming sync was harmless.`
    );
  }
  if (Array.isArray(summary.locationWarnings) && summary.locationWarnings.length) {
    for (const item of summary.locationWarnings.slice(0, MAX_ERROR_ITEMS)) {
      warnings.push(`${item.cardCode}: removed ${item.removed} location row(s) from portal`);
    }
  }
  return warnings;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const cronSecret = String(process.env.SYNC_DELTA_CRON_SECRET || '').trim();
  const requestSecret = String(req.headers['x-sync-delta-secret'] || '').trim();
  const isCronAuthorized = Boolean(cronSecret && requestSecret && cronSecret === requestSecret);
  if (!isCronAuthorized) {
    const session = await requireSession(req, res);
    if (!session) return;
  }

  const body = parseBody(req);
  const isPreview = body.preview === true || req.query.preview === 'true';
  const customerCode = normalizeCustomerCode(body.customerCode || req.query.customerCode);
  const portalCustomerCode = normalizeCustomerCode(body.portalCustomerCode);
  const range = {
    start_date: String(body.start_date || '').trim(),
    end_date: String(body.end_date || '').trim(),
  };
  if (!range.start_date || !range.end_date) {
    const d = defaultDateRange();
    range.start_date = range.start_date || d.start_date;
    range.end_date = range.end_date || d.end_date;
  }

  const supabase = getSupabaseAdmin();
  const startedAt = Date.now();

  try {
    const sapLogin = await loginSessionCookiesFromEnvironment();
    const sapCookies = unwrapSapEnvironmentLogin(sapLogin);

    if (isPreview) {
      const preview = await previewSapDeltaSync({
        supabase,
        sessionCookies: sapCookies,
        customerCode,
        portalCustomerCode,
        start_date: range.start_date,
        end_date: range.end_date,
      });

      if (preview.errors.length > 0 && preview.counts.sapHits === 0) {
        return res.status(422).json({
          success: false,
          preview: true,
          error: preview.errors[0],
          preview,
        });
      }

      return res.status(200).json({
        success: true,
        preview: true,
        preview,
      });
    }

    const summary = {
      mode: customerCode && portalCustomerCode ? 'promotion' : customerCode ? 'targeted' : 'sap_delta',
      customerCode: customerCode || null,
      portalCustomerCode: portalCustomerCode || null,
      dateRange: range,
      counts: {
        sapHits: 0,
        sapPagesFetched: 0,
        masterlistCustomersInserted: 0,
        masterlistCustomersUpdated: 0,
        masterlistLeadsInserted: 0,
        masterlistLeadsUpdated: 0,
      },
      errors: [],
      locations: { inserted: 0, updated: 0, removed: 0 },
      locationWarnings: [],
      addressChanges: null,
      elapsedMs: 0,
    };

    if (!sapCookies) {
      summary.errors.push(
        'SAP Service Layer login failed — nothing is saved without a confirmed SAP CardCode. Check SAP_B1_* env vars.'
      );
      summary.elapsedMs = Date.now() - startedAt;
      await logDeltaSyncAudit(req, summary, AUDIT_STATUS.FAILURE);
      return res.status(422).json({
        success: false,
        error: summary.errors[0],
        message: 'SAP sync did not update masterlist',
        summary,
      });
    }

    if (customerCode && isOfficialSapCustomerCode(customerCode)) {
      let resolvedPortalCode = portalCustomerCode || null;
      let promotionResolved = portalCustomerCode ? 'explicit' : null;

      if (!resolvedPortalCode) {
        resolvedPortalCode = await resolvePortalCustomerForPromotion(
          supabase,
          customerCode,
          sapCookies
        );
        if (resolvedPortalCode) promotionResolved = 'auto';
      }

      if (resolvedPortalCode) {
        try {
          const promotion = await promotePortalCustomerFromSap({
            supabase,
            sessionCookies: sapCookies,
            portalCustomerCode: resolvedPortalCode,
            sapCardCode: customerCode,
          });
          summary.mode = 'promotion';
          summary.promotionResolved = promotionResolved;
          summary.promotion = promotion;
          summary.counts.sapHits = 1;
          summary.counts.masterlistCustomersUpdated = 1;
          summary.elapsedMs = Date.now() - startedAt;
          await logDeltaSyncAudit(req, summary, AUDIT_STATUS.SUCCESS);
          invalidateSapMasterlistCache();
          return res.status(200).json({
            success: true,
            message: `Promoted ${promotion.from} → ${promotion.to}`,
            summary,
          });
        } catch (promotionError) {
          summary.errors.push(promotionError?.message || 'Promotion failed');
          summary.elapsedMs = Date.now() - startedAt;
          await logDeltaSyncAudit(req, summary, AUDIT_STATUS.FAILURE);
          return res.status(422).json({
            success: false,
            error: summary.errors[0],
            message: 'CP promotion did not update masterlist',
            summary,
          });
        }
      }
    }

    if (customerCode) {
      const targetedHit = await getTargetedSapHit(customerCode, sapCookies);
      if (!targetedHit) {
        summary.errors.push(
          `SAP Business Partner ${customerCode} not found on Service Layer (check company DB / CardCode).`
        );
      } else {
        summary.counts.sapHits = 1;
        const masterlistSummary = await syncSapHitsToMasterlist([targetedHit], {
          supabase,
          sessionCookies: sapCookies,
        });
        applyMasterlistSummary(summary, masterlistSummary);
        applyLocationSummaryToDelta(summary, masterlistSummary);

        const { data: portalCustomer } = await supabase
          .from('customer')
          .select('id')
          .eq('customer_code', customerCode)
          .is('deleted_at', null)
          .maybeSingle();
        if (portalCustomer?.id) {
          const { data: portalRows } = await supabase
            .from('customer_location')
            .select(
              'id, site_id, street, building, block, city, country_name, zip_code, address, address_type'
            )
            .eq('customer_id', portalCustomer.id);
          const sapDetails = await fetchBpDetails(customerCode, sapCookies);
          summary.addressChanges = computeAddressChangesForEntity(
            portalRows || [],
            sapDetails?.bpAddresses || []
          );
        }
      }

      summary.errors = summary.errors.filter(Boolean).slice(0, MAX_ERROR_ITEMS);
      summary.elapsedMs = Date.now() - startedAt;

      const written = customersWrittenCount(summary);
      if (summary.counts.sapHits === 0 || written === 0) {
        const primaryError =
          summary.errors[0] ||
          (summary.counts.sapHits === 0
            ? `SAP Business Partner ${customerCode} was not found — nothing written to Supabase.`
            : `SAP hit found but masterlist upsert wrote 0 rows for ${customerCode}.`);
        await logDeltaSyncAudit(req, summary, AUDIT_STATUS.FAILURE);
        return res.status(422).json({
          success: false,
          error: primaryError,
          message: 'Targeted sync did not update masterlist',
          summary,
        });
      }

      await logDeltaSyncAudit(req, summary, AUDIT_STATUS.SUCCESS);
      invalidateSapMasterlistCache();
      const warnings = buildSyncResponseWarnings(summary);
      return res.status(200).json({
        success: true,
        message: 'Targeted SAP sync completed',
        summary,
        warnings: warnings.length ? warnings : undefined,
      });
    }

    const sapScan = await fetchSapBusinessPartnersInRange(sapCookies, range.start_date, range.end_date);
    if (sapScan.error) {
      summary.errors.push(`SAP delta query: ${sapScan.error}`);
    }
    summary.counts.sapPagesFetched = sapScan.pagesFetched || 0;
    summary.counts.sapHits = sapScan.hits.length;

    const masterlistSummary = await syncSapHitsToMasterlist(sapScan.hits, {
      supabase,
      sessionCookies: sapCookies,
    });
    applyMasterlistSummary(summary, masterlistSummary);
    applyLocationSummaryToDelta(summary, masterlistSummary);

    summary.errors = summary.errors.filter(Boolean).slice(0, MAX_ERROR_ITEMS);
    summary.elapsedMs = Date.now() - startedAt;

    await logDeltaSyncAudit(req, summary, AUDIT_STATUS.SUCCESS);
    invalidateSapMasterlistCache();
    const warnings = buildSyncResponseWarnings(summary);
    return res.status(200).json({
      success: true,
      message: 'SAP delta sync completed',
      summary,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error) {
    const summary = {
      mode: customerCode && portalCustomerCode ? 'promotion' : customerCode ? 'targeted' : 'sap_delta',
      customerCode: customerCode || null,
      dateRange: range,
      counts: {
        sapHits: 0,
        sapPagesFetched: 0,
        masterlistCustomersInserted: 0,
        masterlistCustomersUpdated: 0,
        masterlistLeadsInserted: 0,
        masterlistLeadsUpdated: 0,
      },
      errors: [error?.message || 'Sync failed'],
      elapsedMs: Date.now() - startedAt,
    };

    if (!isPreview) {
      await logDeltaSyncAudit(req, summary, AUDIT_STATUS.FAILURE);
    }

    return res.status(500).json({
      success: false,
      error: error?.message || 'Sync failed',
      summary: {
        mode: summary.mode,
        customerCode: summary.customerCode,
        dateRange: summary.dateRange,
        counts: summary.counts,
        errors: summary.errors.slice(0, MAX_ERROR_ITEMS),
        elapsedMs: summary.elapsedMs,
      },
    });
  }
}
