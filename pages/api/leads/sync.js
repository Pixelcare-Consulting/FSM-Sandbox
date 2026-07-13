/**
 * API endpoint to sync Google Forms responses to database
 * POST /api/leads/sync - Fetch from Google Forms and save new leads to database
 * Each new lead gets a portal customer (CP code) immediately so they appear in the merged view.
 */

import { leadService, customerService } from '../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { getCustomerAddressFromLead } from '../../../lib/utils/leadLocationName';
import { ensurePortalCustomerAddressFromLead } from '../../../lib/customers/ensurePortalCustomerAddressFromLead';
import { findPortalDuplicate } from '../../../lib/customers/portalDuplicateCheck';
import jwt from 'jsonwebtoken';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  buildChanges,
} from '../../../lib/services/auditLog';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';
import { PORTAL_LIST_CACHE_PREFIX } from '../../../lib/leads/portalListCache';

/**
 * Map a transformed Google form response to DB lead row (same as sync loop).
 */
function buildGoogleLeadData(response, responseId, timestamp) {
  return {
    google_form_response_id: responseId || null,
    email: response.email || '',
    first_name: response.firstName && response.firstName !== '-' ? response.firstName : null,
    last_name: response.lastName && response.lastName !== '-' ? response.lastName : null,
    full_name: response.fullName || `${response.firstName || ''} ${response.lastName || ''}`.trim() || '',
    salutation: response.salutation && response.salutation !== '-' ? response.salutation : null,
    handphone: response.handphone && response.handphone !== '-' ? response.handphone : null,
    block: response.block && response.block !== '-' ? response.block : null,
    unit: response.unit && response.unit !== '-' ? response.unit : null,
    building: response.building && response.building !== '-' ? response.building : null,
    street: response.street && response.street !== '-' ? response.street : null,
    postcode: response.postcode && response.postcode !== '-' ? response.postcode : null,
    country: response.country && response.country !== '-' ? response.country : null,
    address: response.address || (() => {
      const parts = [response.building, response.street, response.postcode, response.country].filter(
        (p) => p && p !== '-'
      );
      return parts.length > 0 ? parts.join(', ') : null;
    })(),
    first_service_date: response.firstServiceDate && response.firstServiceDate !== '-'
      ? response.firstServiceDate
      : null,
    second_service_date: response.secondServiceDate && response.secondServiceDate !== '-'
      ? response.secondServiceDate
      : null,
    third_service_date: response.thirdServiceDate && response.thirdServiceDate !== '-'
      ? response.thirdServiceDate
      : null,
    fourth_service_date: response.fourthServiceDate && response.fourthServiceDate !== '-'
      ? response.fourthServiceDate
      : null,
    time_slot: response.timeSlot || response.time_slot || null,
    agreed_to_terms: response.agreedToTerms === 'Yes' || response.agreedToTerms === true || false,
    personal_info_consent: response.personalInfoConsent === 'Yes' || response.personalInfoConsent === true || false,
    status: 'PENDING',
    source: 'GOOGLE_FORM',
    submitted_at: timestamp
  };
}

function getLeadFieldUpdatesFromSync(leadData) {
  return {
    first_name: leadData.first_name,
    last_name: leadData.last_name,
    full_name: leadData.full_name,
    salutation: leadData.salutation,
    handphone: leadData.handphone,
    block: leadData.block,
    unit: leadData.unit,
    building: leadData.building,
    street: leadData.street,
    postcode: leadData.postcode,
    country: leadData.country,
    address: leadData.address,
    first_service_date: leadData.first_service_date,
    second_service_date: leadData.second_service_date,
    third_service_date: leadData.third_service_date,
    fourth_service_date: leadData.fourth_service_date,
    time_slot: leadData.time_slot,
    agreed_to_terms: leadData.agreed_to_terms,
    personal_info_consent: leadData.personal_info_consent
  };
}

function normalizeSyncValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim() || null;
  return String(value);
}

/** True when Google payload differs from the stored lead (incremental sync skips otherwise). */
function leadNeedsUpdateFromGoogle(existing, leadData) {
  if (!existing.google_form_response_id && leadData.google_form_response_id) return true;
  const updates = getLeadFieldUpdatesFromSync(leadData);
  return Object.entries(updates).some(
    ([key, googleValue]) => normalizeSyncValue(existing[key]) !== normalizeSyncValue(googleValue)
  );
}

function partitionLeadUpdates(leadUpdates) {
  const leadUpdatesNeeded = [];
  let unchangedCount = 0;
  for (const entry of leadUpdates) {
    if (leadNeedsUpdateFromGoogle(entry.existing, entry.leadData)) {
      leadUpdatesNeeded.push(entry);
    } else {
      unchangedCount++;
    }
  }
  return { leadUpdatesNeeded, unchangedCount };
}

const SYNC_AUDIT_DIFF_FIELDS = [
  'email',
  'full_name',
  'first_name',
  'last_name',
  'salutation',
  'handphone',
  'block',
  'unit',
  'building',
  'street',
  'postcode',
  'country',
  'address',
  'first_service_date',
  'second_service_date',
  'third_service_date',
  'fourth_service_date',
  'time_slot',
];

const MAX_SYNC_AUDIT_ITEMS = 100;

/** Field-level portal (before) vs Google (after) diffs for audit — after is not applied when skipped. */
function buildLeadSyncFieldDiffs(existing, leadData) {
  const fieldChanges = {};
  for (const key of SYNC_AUDIT_DIFF_FIELDS) {
    const portalValue = existing[key];
    const googleValue = leadData[key];
    if (normalizeSyncValue(portalValue) !== normalizeSyncValue(googleValue)) {
      fieldChanges[key] = { before: portalValue ?? null, after: googleValue ?? null };
    }
  }
  return Object.keys(fieldChanges).length ? fieldChanges : null;
}

function buildSkippedExistingAuditEntry({ existing, leadData }) {
  const fieldChanges = buildLeadSyncFieldDiffs(existing, leadData);
  if (!fieldChanges) return null;
  return {
    leadId: existing.id,
    email: existing.email || leadData.email,
    fullName: existing.full_name || leadData.full_name,
    preserved: true,
    fieldChanges,
  };
}

function buildAddedLeadAuditEntry(lead, leadData, customerCode) {
  return {
    leadId: lead?.id || null,
    customerCode: customerCode || null,
    email: leadData.email,
    fullName: leadData.full_name,
    handphone: leadData.handphone || null,
    block: leadData.block || null,
    unit: leadData.unit || null,
    submittedAt: leadData.submitted_at || null,
  };
}

function capSyncAuditList(items, totalCount) {
  if (!items?.length) return { items: [], truncated: false, totalCount: totalCount || 0 };
  const total = totalCount ?? items.length;
  if (items.length <= MAX_SYNC_AUDIT_ITEMS) {
    return { items, truncated: false, totalCount: total };
  }
  return {
    items: items.slice(0, MAX_SYNC_AUDIT_ITEMS),
    truncated: true,
    totalCount: total,
  };
}

/**
 * Overwrite lead (and linked portal customer) with latest Google Form payload.
 * @param {object} options.existing - row with at least id, customer_id, google_form_response_id
 * @param {boolean} [options.restore=false] - if true, clear soft-delete (restored lead was not in getAll map)
 */
async function mergeGoogleDataIntoExistingLead({
  existing,
  leadData,
  supabase,
  restore = false,
  leadService: ls,
  customerService: cs
}) {
  const fieldUpdates = getLeadFieldUpdatesFromSync(leadData);
  if (!existing.google_form_response_id && leadData.google_form_response_id) {
    fieldUpdates.google_form_response_id = leadData.google_form_response_id;
  }
  if (restore) {
    fieldUpdates.deleted_at = null;
  }
  await ls.update(existing.id, fieldUpdates, supabase);
  if (existing.customer_id) {
    await cs.update(
      existing.customer_id,
      {
        customer_name: leadData.full_name,
        customer_address: getCustomerAddressFromLead(leadData),
        phone_number: leadData.handphone || null,
        email: leadData.email || null,
        block: leadData.block ?? null,
        unit: leadData.unit ?? null
      },
      supabase
    );
    await ensurePortalCustomerAddressFromLead({
      supabase,
      customerId: existing.customer_id,
      lead: leadData
    });
  }
}

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get form_id from request body, or use default if not provided
  const { form_id } = req.body;
  
  // If form_id is provided, use it; otherwise try to get from database (first active form)
  let FORM_ID = form_id;
  
  if (!FORM_ID) {
    // Try to get the first active Google Form from database
    try {
      const { getSupabaseAdmin } = require('../../../lib/supabase/server');
      const supabase = getSupabaseAdmin();
      
      const { data: forms, error: formsError } = await supabase
        .from('google_forms')
        .select('form_id, url, name')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!formsError && forms && forms.length > 0) {
        // Extract form_id from URL if not stored
        if (forms[0].form_id) {
          FORM_ID = forms[0].form_id;
          console.log(`Using form_id from database: ${FORM_ID} (Form: ${forms[0].name || 'Unknown'})`);
        } else if (forms[0].url) {
          // Extract form ID from URL
          const match = forms[0].url.match(/\/forms\/d\/e\/([^\/]+)/) || forms[0].url.match(/\/forms\/d\/([^\/]+)/);
          if (match) {
            FORM_ID = match[1];
            console.log(`Extracted form_id from URL: ${FORM_ID} (Form: ${forms[0].name || 'Unknown'})`);
          } else {
            console.warn(`Could not extract form_id from URL: ${forms[0].url}`);
          }
        }
      } else if (formsError) {
        console.warn('Error fetching forms from database:', formsError.message);
      } else {
        console.warn('No active forms found in database');
      }
    } catch (dbError) {
      console.warn('Could not fetch form from database, will use default:', dbError.message);
    }
  } else {
    console.log(`Using form_id from request: ${FORM_ID}`);
  }

  // Fallback to default if still no form_id
  if (!FORM_ID) {
    FORM_ID = '1hKxmEOkqvR9NWxju979x6xBVNOGU39pBe24hBLn0cWw';
    console.warn(`No form_id provided or found, using default: ${FORM_ID}`);
  }

  try {
    // Check if Google Service Account credentials are configured
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    // Enhanced diagnostic information
    const hasEmail = !!serviceAccountEmail;
    const hasKey = !!privateKey;
    const emailLength = serviceAccountEmail ? serviceAccountEmail.length : 0;
    const keyLength = privateKey ? privateKey.length : 0;
    const keyStartsWithBegin = privateKey ? privateKey.includes('BEGIN') : false;
    const keyStartsWithEnd = privateKey ? privateKey.includes('END') : false;

    console.log('[Google Forms Sync] Credential Check:');
    console.log(`  - GOOGLE_SERVICE_ACCOUNT_EMAIL: ${hasEmail ? 'SET' : 'MISSING'} (length: ${emailLength})`);
    console.log(`  - GOOGLE_PRIVATE_KEY: ${hasKey ? 'SET' : 'MISSING'} (length: ${keyLength})`);
    console.log(`  - Private key has BEGIN marker: ${keyStartsWithBegin}`);
    console.log(`  - Private key has END marker: ${keyStartsWithEnd}`);

    if (!serviceAccountEmail || !privateKey) {
      return res.status(400).json({
        error: 'Google Service Account credentials not configured',
        message: 'Configure GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY to sync from Google Forms',
        diagnostics: {
          hasEmail,
          hasKey,
          emailLength,
          keyLength,
          keyHasBeginMarker: keyStartsWithBegin,
          keyHasEndMarker: keyStartsWithEnd,
          hint: !hasEmail ? 'GOOGLE_SERVICE_ACCOUNT_EMAIL is missing' : 
                 !hasKey ? 'GOOGLE_PRIVATE_KEY is missing' :
                 !keyStartsWithBegin || !keyStartsWithEnd ? 'GOOGLE_PRIVATE_KEY format may be incorrect (should include BEGIN and END markers)' :
                 'Check Vercel environment variables are set for the correct environment (Production/Preview/Development)'
        }
      });
    }

    // Fetch responses from Google Forms
    let googleResponses = [];
    try {
      googleResponses = await fetchWithServiceAccount(FORM_ID, serviceAccountEmail, privateKey);
      
      // Log summary only
      console.log('📋 Google Forms Response Summary:');
      console.log(`   Total responses fetched: ${googleResponses.length}`);
    } catch (error) {
      console.error('Error fetching from Google Forms:', error);
      
      // Provide more detailed error information
      let errorDetails = {
        error: 'Failed to fetch from Google Forms',
        message: error.message,
        formId: FORM_ID,
        serviceAccountEmail: serviceAccountEmail ? `${serviceAccountEmail.substring(0, 10)}...` : 'Not set'
      };
      
      // Add specific guidance based on error type
      if (error.message.includes('404') || error.message.includes('not found')) {
        errorDetails.hint = `Form ID "${FORM_ID}" not found. Please verify:
1. The form ID is correct in your Google Forms settings
2. The form is shared with: ${serviceAccountEmail}
3. The form URL format is correct`;
      } else if (error.message.includes('403') || error.message.includes('Access denied')) {
        errorDetails.hint = `Access denied. Please:
1. Open the Google Form: https://docs.google.com/forms/d/e/${FORM_ID}/viewform
2. Click "Share" button
3. Add this email: ${serviceAccountEmail}
4. Grant "Editor" or "Viewer" permissions
5. Wait a few minutes for permissions to propagate`;
      } else if (error.message.includes('Invalid private key') || error.message.includes('asymmetric key')) {
        errorDetails.hint = `Private key format issue. The GOOGLE_PRIVATE_KEY should:
1. Include "-----BEGIN PRIVATE KEY-----" at the start
2. Include "-----END PRIVATE KEY-----" at the end
3. Have actual newlines (\\n) or be properly formatted
4. Not have extra quotes or escaping`;
      } else if (error.message.includes('credentials not configured')) {
        errorDetails.hint = `Environment variables not found. Check:
1. Vercel project settings > Environment Variables
2. Ensure variables are set for the correct environment (Production/Preview)
3. Redeploy after adding environment variables`;
      }
      
      return res.status(500).json(errorDetails);
    }

    if (!googleResponses || googleResponses.length === 0) {
      console.log('ℹ️ No responses found in Google Forms');
      return res.status(200).json({
        success: true,
        message: 'No new leads found in Google Forms',
        created: 0,
        skipped: 0,
        total: 0
      });
    }

    // Existing leads: map by response_id and by email+submitted_at for re-sync (merge contact fields from Google)
    const existingLeads = await leadService.getAll({});
    const existingByResponseId = new Map();
    const existingByFallbackKey = new Map();
    existingLeads.forEach((lead) => {
      if (lead.google_form_response_id) {
        existingByResponseId.set(lead.google_form_response_id, lead);
      }
      if (lead.submitted_at) {
        const key = `${lead.email}_${lead.submitted_at}`;
        if (!existingByFallbackKey.has(key)) {
          existingByFallbackKey.set(key, lead);
        }
      }
    });

    const leadsToCreate = [];
    const leadUpdates = [];
    const skipped = [];

    console.log(`\n🔄 Processing ${googleResponses.length} responses...`);

    for (const response of googleResponses) {
      const responseId = response.id || response.responseId;
      const timestamp = response.timestamp || response.submitted_at || new Date().toISOString();
      const leadData = buildGoogleLeadData(response, responseId, timestamp);

      if (!leadData.email || !leadData.full_name) {
        const skipReason = !leadData.email ? 'Missing email' : 'Missing full_name';
        console.log(`⚠️ Skipping response: ${skipReason}`, {
          email: response.email,
          fullName: response.fullName || response.full_name,
          responseId: responseId
        });
        skipped.push({
          email: response.email,
          timestamp,
          reason: `Missing required fields (${skipReason})`
        });
        continue;
      }

      if (responseId && existingByResponseId.has(responseId)) {
        leadUpdates.push({ existing: existingByResponseId.get(responseId), leadData });
        continue;
      }

      const fallbackKey = `${response.email}_${timestamp}`;
      if (existingByFallbackKey.has(fallbackKey)) {
        leadUpdates.push({ existing: existingByFallbackKey.get(fallbackKey), leadData });
        continue;
      }

      leadsToCreate.push(leadData);
    }

    const { leadUpdatesNeeded, unchangedCount } = partitionLeadUpdates(leadUpdates);
    // Portal edits must not be overwritten: only import NEW Google Form responses.
    // Existing leads (even when Google data differs) are left as-is in the portal.
    const skippedExistingCount = leadUpdates.length;
    const skippedExistingChangedCount = leadUpdatesNeeded.length;
    const skippedWithDiffAuditAll = leadUpdatesNeeded
      .map((entry) => buildSkippedExistingAuditEntry(entry))
      .filter(Boolean);

    console.log(`\n✅ Processing complete:`);
    console.log(`   - Leads to create: ${leadsToCreate.length}`);
    console.log(`   - Existing leads (skipped, portal preserved): ${skippedExistingCount}`);
    console.log(`   -   of which Google differs but not applied: ${skippedExistingChangedCount}`);
    console.log(`   -   of which already match Google: ${unchangedCount}`);
    console.log(`   - Leads skipped (missing fields): ${skipped.length}`);
    
    if (leadsToCreate.length > 0) {
      console.log(`\n📦 Sample lead data to be created (first lead):`);
      console.log(JSON.stringify(leadsToCreate[0], null, 2));
    }

    // Preview mode: return list for confirmation modal without saving
    const preview = req.body && (req.body.preview === true || req.body.preview === 'true');
    if (preview) {
      const supabase = getSupabaseAdmin();
      const rowFromLeadData = (l) => ({
        google_form_response_id: l.google_form_response_id || null,
        email: l.email,
        full_name: l.full_name,
        handphone: l.handphone || null,
        submitted_at: l.submitted_at || null,
        block: l.block || null,
        unit: l.unit || null
      });

      const skippedExisting = [];
      for (const { existing, leadData } of leadUpdates) {
        let customer_code = null;
        if (existing?.customer_id && supabase) {
          const { data: cust } = await supabase
            .from('customer')
            .select('customer_code')
            .eq('id', existing.customer_id)
            .is('deleted_at', null)
            .maybeSingle();
          customer_code = cust?.customer_code || null;
        }
        skippedExisting.push({
          email: existing.email || leadData.email,
          full_name: existing.full_name || leadData.full_name,
          customer_code,
        });
      }

      const willFromNew = [];
      const skippedEmailDuplicates = [];
      for (const leadData of leadsToCreate) {
        const duplicate = supabase
          ? await findPortalDuplicate(supabase, {
              email: leadData.email,
              phone: leadData.handphone,
            })
          : null;
        if (duplicate?.existingCode) {
          skippedEmailDuplicates.push({
            email: leadData.email,
            full_name: leadData.full_name,
            existing_customer_code: duplicate.existingCode,
            existingType: duplicate.existingType,
          });
        } else {
          willFromNew.push({ ...rowFromLeadData(leadData), action: 'new' });
        }
      }

      const willSync = [...willFromNew];
      const skippedMissing = skipped.filter((s) => s.reason && String(s.reason).includes('Missing'));
      return res.status(200).json({
        preview: true,
        formId: FORM_ID,
        willSync,
        willCreateCount: willFromNew.length,
        willUpdateCount: 0,
        skippedExistingCount,
        skippedExistingChangedCount,
        skippedExisting,
        skippedEmailDuplicates: skippedEmailDuplicates.length > 0 ? skippedEmailDuplicates : undefined,
        skippedMissing,
        totalResponses: googleResponses.length,
        newOrRestoreCount: willSync.length,
        alreadyInListCount: skippedExistingCount,
        skippedUnchanged: unchangedCount,
        skippedMissingCount: skippedMissing.length
      });
    }

    const responseIds = Array.isArray(req.body?.response_ids) ? req.body.response_ids : null;
    const leadsToImport = responseIds
      ? leadsToCreate.filter((l) => l.google_form_response_id && responseIds.includes(l.google_form_response_id))
      : leadsToCreate;

    // Create leads in database and assign CP (portal customer) to each so they show in merged view
    let created = 0;
    let restored = 0;
    let refreshed = 0;
    const errors = [];
    const addedLeadAuditAll = [];
    const restoredLeadAuditAll = [];
    const supabase = getSupabaseAdmin();

    if (skippedExistingChangedCount > 0) {
      console.log(
        `\n⏭️ Skipping ${skippedExistingChangedCount} existing lead(s) with Google diffs (portal data preserved)`
      );
    }

    // Helper: find existing lead by google_form_response_id (including soft-deleted)
    const findExistingLeadByResponseId = async (responseId) => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, deleted_at, customer_id, google_form_response_id')
        .eq('google_form_response_id', responseId)
        .maybeSingle();
      if (error) throw error;
      return data;
    };

    if (leadsToImport.length > 0) {
      console.log(`\n💾 Creating ${leadsToImport.length} leads and assigning CP codes...`);
      for (const leadData of leadsToImport) {
        try {
          // 1. Create lead
          const lead = await leadService.create(leadData);
          created++;
          // 2. Assign next CP and create portal customer so lead has customer_code immediately
          const customerCode = await customerService.getNextPortalCardCode(supabase);
          const customerName = leadData.full_name || leadData.email || 'Unknown';
          const customerAddress = getCustomerAddressFromLead(leadData);
          const customerRecord = {
            customer_code: customerCode,
            customer_name: customerName,
            customer_address: customerAddress,
            phone_number: leadData.handphone || null,
            email: leadData.email || null,
            source: 'portal',
            lead_id: lead.id
          };
          if (leadData.block != null) customerRecord.block = leadData.block;
          if (leadData.unit != null) customerRecord.unit = leadData.unit;
          const customer = await customerService.create(customerRecord, supabase);
          await leadService.update(lead.id, { customer_id: customer.id });
          await ensurePortalCustomerAddressFromLead({
            supabase,
            customerId: customer.id,
            lead: { ...leadData, ...lead }
          });
          addedLeadAuditAll.push(buildAddedLeadAuditEntry(lead, leadData, customerCode));
          console.log(`   ✓ ${leadData.email} → ${customerCode}`);
        } catch (err) {
          // Duplicate key = lead already exists (e.g. soft-deleted or re-sync): restore or skip
          if (err.code === '23505' && (err.message?.includes('google_form_response_id') || (err.details && String(err.details).includes('google_form_response_id')))) {
            try {
              const existing = await findExistingLeadByResponseId(leadData.google_form_response_id);
              if (!existing) {
                errors.push({ email: leadData.email, error: 'Duplicate key but lead not found' });
                continue;
              }
              if (existing.deleted_at) {
                const beforeRestore = await leadService.findById(existing.id, supabase);
                // Soft-deleted row is not in getAll(); merge full Google payload, then un-delete
                await mergeGoogleDataIntoExistingLead({
                  existing,
                  leadData,
                  supabase,
                  restore: true,
                  leadService,
                  customerService
                });
                let logMsg = `   ↻ Restored ${leadData.email} (merged latest data from Google)`;
                let restoredCustomerCode = null;
                if (!existing.customer_id) {
                  const customerCode = await customerService.getNextPortalCardCode(supabase);
                  restoredCustomerCode = customerCode;
                  const customerName = leadData.full_name || leadData.email || 'Unknown';
                  const customerAddress = getCustomerAddressFromLead(leadData);
                  const customerRecord = {
                    customer_code: customerCode,
                    customer_name: customerName,
                    customer_address: customerAddress,
                    phone_number: leadData.handphone || null,
                    email: leadData.email || null,
                    source: 'portal',
                    lead_id: existing.id
                  };
                  if (leadData.block != null) customerRecord.block = leadData.block;
                  if (leadData.unit != null) customerRecord.unit = leadData.unit;
                  const customer = await customerService.create(customerRecord, supabase);
                  await leadService.update(existing.id, { customer_id: customer.id });
                  await ensurePortalCustomerAddressFromLead({
                    supabase,
                    customerId: customer.id,
                    lead: leadData
                  });
                  logMsg += ` → ${customerCode}`;
                }
                const afterRestore = await leadService.findById(existing.id, supabase);
                restoredLeadAuditAll.push({
                  leadId: existing.id,
                  email: leadData.email,
                  fullName: leadData.full_name,
                  customerCode: restoredCustomerCode,
                  fieldChanges: buildChanges(beforeRestore || {}, afterRestore || leadData),
                });
                console.log(logMsg);
                restored++;
              } else {
                // Active duplicate: lead already exists in portal — do not overwrite portal edits
                console.log(`   ⏭️ Skipped ${leadData.email} (already in portal; Google data not applied)`);
              }
            } catch (restoreErr) {
              console.error(`   ✗ Failed to restore/skip ${leadData.email}:`, restoreErr.message);
              errors.push({ email: leadData.email, error: restoreErr.message || 'Duplicate entry (already exists)' });
            }
            continue;
          }
          console.error(`   ✗ Failed for ${leadData.email}:`, err.message);
          if (err.code === '23505' || err.message?.includes('duplicate') || err.message?.includes('unique')) {
            errors.push({ email: leadData.email, error: 'Duplicate entry (already exists)' });
          } else {
            errors.push({ email: leadData.email, error: err.message || 'Unknown error' });
          }
        }
      }
      console.log(`✅ Created ${created}, restored ${restored} leads with CP codes`);
    }

    const responseData = {
      success: true,
      message: `Sync completed: ${created} new, ${restored} restored, ${skippedExistingCount} existing skipped (portal preserved), ${skipped.length} skipped (missing fields)`,
      created,
      refreshed: refreshed > 0 ? refreshed : undefined,
      restored: restored || undefined,
      skipped: skipped.length,
      skippedExistingCount,
      skippedExistingChangedCount: skippedExistingChangedCount > 0 ? skippedExistingChangedCount : undefined,
      skippedUnchanged: unchangedCount,
      alreadyInListCount: skippedExistingCount,
      total: googleResponses.length,
      errors: errors.length > 0 ? errors : undefined
    };

    console.log(`\n📤 Final sync response:`, JSON.stringify(responseData, null, 2));

    const addedLeadsAudit = capSyncAuditList(addedLeadAuditAll, addedLeadAuditAll.length);
    const skippedDiffsAudit = capSyncAuditList(skippedWithDiffAuditAll, skippedWithDiffAuditAll.length);
    const restoredLeadsAudit = capSyncAuditList(restoredLeadAuditAll, restoredLeadAuditAll.length);

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.LEAD_SYNC,
      category: AUDIT_CATEGORIES.LEAD,
      entityType: 'lead',
      entityLabel: `Google Forms sync (${FORM_ID})`,
      description: responseData.message,
      details: {
        formId: FORM_ID,
        created: responseData.created,
        refreshed: responseData.refreshed,
        restored: responseData.restored,
        skipped: responseData.skipped,
        skippedExistingCount: responseData.skippedExistingCount,
        skippedExistingChangedCount: responseData.skippedExistingChangedCount,
        skippedUnchanged: responseData.skippedUnchanged,
        total: responseData.total,
        errorCount: errors.length,
        addedLeads: addedLeadsAudit.items,
        addedLeadsTruncated: addedLeadsAudit.truncated || undefined,
        addedLeadsTotal: addedLeadsAudit.totalCount || undefined,
        skippedExistingWithDiffs: skippedDiffsAudit.items,
        skippedDiffsTruncated: skippedDiffsAudit.truncated || undefined,
        skippedDiffsTotal: skippedDiffsAudit.totalCount || undefined,
        restoredLeads: restoredLeadsAudit.items,
        restoredLeadsTruncated: restoredLeadsAudit.truncated || undefined,
        restoredLeadsTotal: restoredLeadsAudit.totalCount || undefined,
        syncErrors: errors.length ? errors.slice(0, 20) : undefined,
        ...(responseIds !== null
          ? {
              selectiveSync: true,
              selectedCount: responseIds.length,
              availableNewCount: leadsToCreate.length,
            }
          : {}),
      },
      status: errors.length > 0 ? AUDIT_STATUS.WARNING : AUDIT_STATUS.SUCCESS,
    });
    
    invalidateListCache(PORTAL_LIST_CACHE_PREFIX);

    // Return the response to the client
    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Error in sync API:', error);
    // Only send safe error information to prevent large payloads
    const errorMessage = error?.message || 'An unexpected error occurred';
    const safeMessage = errorMessage.length > 500 
      ? errorMessage.substring(0, 500) + '...' 
      : errorMessage;
    
    return res.status(500).json({
      error: 'Internal server error',
      message: safeMessage
    });
  }
}

/**
 * True if a form question title/descriptor should map to the handphone field.
 * Many forms use labels like "Contact No." or "Whatsapp" without the substring "phone".
 */
function formTitleMatchesHandphone(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.toLowerCase().trim();
  if (s.length === 0) return false;
  if (
    s.includes('handphone number') ||
    s.includes('handphone') ||
    s.includes('phone') ||
    s.includes('mobile') ||
    s.includes('cellular') ||
    s.includes('cell') ||
    s.includes('whatsapp') ||
    s.includes("what's app") ||
    s.includes('what’s app') ||
    (s.includes('wechat') && (s.includes('no') || s.includes('id') || s.includes('phone')))
  ) {
    return true;
  }
  if (s.includes('telephone') || s.includes('tel no') || s.includes('contact no') || s.includes('contact no.')) {
    return true;
  }
  if (s.includes('contact') && (s.includes('number') || s.includes('no') || s.includes('tel') || /\bno\.?\b/.test(s))) {
    return true;
  }
  if (/\bhp\b/.test(s) || s.includes('h/p') || s.includes('h / p')) {
    return true;
  }
  return false;
}

/**
 * True if the form uses one question for both block and unit (e.g. "Block / Unit").
 */
function formTitleIsBlockAndUnit(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.toLowerCase().trim();
  if (s.length === 0) return false;
  if (/\bb\s*\/\s*u\b/.test(s) || /\bb\s*&\s*u\b/.test(s)) {
    return true;
  }
  const hasBlock =
    s.includes('block') ||
    s.includes('blk') ||
    s.includes('tower') ||
    s.includes('cluster') ||
    s.includes('hdb blk');
  const hasUnit =
    s.includes('unit') ||
    s.includes('flat') ||
    s.includes('apt') ||
    s.includes('apartment') ||
    s.includes('door no') ||
    s.includes('door#');
  if (hasBlock && hasUnit) {
    return true;
  }
  if ((s.includes('floor') || s.includes('level') || s.includes('storey')) && s.includes('unit')) {
    return true;
  }
  return false;
}

/**
 * True if title maps to block only (not a combined B/U question).
 */
function formTitleMatchesBlock(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.toLowerCase().trim();
  if (s.length === 0) return false;
  if (formTitleIsBlockAndUnit(s)) {
    return false;
  }
  return (
    s.includes('block') ||
    s.includes('blk') ||
    s.includes('tower') ||
    s.includes('cluster') ||
    (s.includes('hdb') && s.includes('blk'))
  );
}

/**
 * True if title maps to unit / flat / apt (not a combined B/U question).
 */
function formTitleMatchesUnit(t) {
  if (!t || typeof t !== 'string') return false;
  const s = t.toLowerCase().trim();
  if (s.length === 0) return false;
  if (formTitleIsBlockAndUnit(s)) {
    return false;
  }
  if (s === '#' || s.startsWith('unit #') || s.startsWith('flat #') || s.startsWith('# ')) {
    return true;
  }
  if (/^#\S{1,20}$/.test(s)) {
    return true;
  }
  return (
    s === 'unit' ||
    s.includes('unit no') ||
    s.includes('unit #') ||
    s.includes('unit/') ||
    s.includes(' unit') ||
    s.startsWith('unit ') ||
    s.includes('flat no') ||
    s === 'flat' ||
    s.startsWith('flat ') ||
    s.includes(' apartment') ||
    s.startsWith('apt') ||
    s.includes('apartment no') ||
    s.includes('door no') ||
    s.includes('suite') ||
    s.includes('unit') /* short question titles, e.g. "Unit" */
  );
}

/**
 * Parse a single response value that holds both block and unit.
 */
function parseBlockAndUnitFromCombined(raw) {
  if (raw == null) {
    return { block: null, unit: null };
  }
  const s0 = String(raw).trim();
  if (s0 === '' || s0 === '-') {
    return { block: null, unit: null };
  }
  const s = s0;
  const blkUnitLabel = s.match(
    /^(?:blk|block)\.?\s*([^\s,/-]+)\s*[,/|-]*\s*(?:unit|flat|#)?\.?\s*(.+)$/i
  );
  if (blkUnitLabel) {
    return { block: blkUnitLabel[1].trim(), unit: blkUnitLabel[2].trim() };
  }
  const mFloor = s.match(
    /^(?:(?:floor|level|storey|lvl)\.?\s*(\S+)|(\d+))\s*[,/|&-]+\s*(?:unit|#)?\s*(.+)$/i
  );
  if (mFloor) {
    const a = mFloor[1] || mFloor[2];
    if (a && mFloor[3]) {
      return { block: a.trim(), unit: mFloor[3].trim() };
    }
  }
  const byHyphen = s.match(/^(\S+?)\s*[-–—]\s*(\S.+)$/) || s.match(/^([^\s-]+)-([^\s-]+)$/);
  if (byHyphen) {
    return { block: byHyphen[1].trim(), unit: byHyphen[2].trim() };
  }
  const twoPart = s.match(/^([^\s/|,&]+)\s*[/|,&]\s*(.+)$/) || s.match(/^([^\s/|,&]+)\s{2,}(.+)$/);
  if (twoPart) {
    return { block: twoPart[1].trim(), unit: twoPart[2].trim() };
  }
  if (s.includes('/')) {
    const [a, ...rest] = s.split('/').map((p) => p.trim());
    if (a && rest.length) {
      return { block: a, unit: rest.join(' / ').trim() };
    }
  }
  return { block: s, unit: null };
}

/**
 * Map one Google form question (by title/description) to lead field question IDs.
 * Mutates questionIdMap. Handled for both top-level questionItem and question group rows.
 */
function mapFormQuestionTitleToLeadFields(questionIdMap, titleRaw, descriptionRaw, questionId) {
  if (!questionId) return;
  const titleLower = (titleRaw || '').toLowerCase().trim();
  const descriptionLower = (descriptionRaw || '').toLowerCase().trim() || '';
  const combinedText = `${titleLower} ${descriptionLower}`.trim();

  if ((titleLower.includes('email address') || titleLower === 'email address' || titleLower === 'email' || titleLower.startsWith('email:')) && !questionIdMap['email']) {
    questionIdMap['email'] = questionId;
  } else if (titleLower.includes('salutation') && !questionIdMap['salutation']) {
    questionIdMap['salutation'] = questionId;
  } else if ((titleLower.includes('first name') || titleLower === 'first name') && !questionIdMap['firstName']) {
    questionIdMap['firstName'] = questionId;
  } else if ((titleLower.includes('last name') || titleLower === 'last name' || titleLower.includes('surname')) && !questionIdMap['lastName']) {
    questionIdMap['lastName'] = questionId;
  } else if (formTitleMatchesHandphone(titleLower) && !questionIdMap['handphone']) {
    questionIdMap['handphone'] = questionId;
  } else if (!questionIdMap['handphone'] && !titleLower && formTitleMatchesHandphone(combinedText)) {
    // Unlabeled question: phone may only appear in the description
    questionIdMap['handphone'] = questionId;
  } else if (!questionIdMap['fullName'] && (titleLower === 'name' || titleLower.includes('full name') || titleLower.includes('your name') || (titleLower.includes('name') && !titleLower.includes('first') && !titleLower.includes('last') && !titleLower.includes('company') && !titleLower.includes('surname') && !titleLower.includes('nickname')))) {
    questionIdMap['fullName'] = questionId;
  } else if (formTitleIsBlockAndUnit(titleLower) && !questionIdMap['blockUnit']) {
    questionIdMap['blockUnit'] = questionId;
  } else if (formTitleMatchesBlock(titleLower) && !questionIdMap['block']) {
    questionIdMap['block'] = questionId;
  } else if (formTitleMatchesUnit(titleLower) && !questionIdMap['unit']) {
    questionIdMap['unit'] = questionId;
  } else if (titleLower.includes('building') && !questionIdMap['building']) {
    questionIdMap['building'] = questionId;
  } else if (titleLower.includes('street') && !questionIdMap['street']) {
    questionIdMap['street'] = questionId;
  } else if (titleLower.includes('postcode') && !questionIdMap['postcode']) {
    questionIdMap['postcode'] = questionId;
  } else if (titleLower.includes('country') && !questionIdMap['country']) {
    questionIdMap['country'] = questionId;
  } else if ((titleLower.includes('address') || titleLower === 'address') && !questionIdMap['address']) {
    questionIdMap['address'] = questionId;
  } else if ((titleLower.includes('preferred date for first service') || titleLower.includes('first service')) && !questionIdMap['firstServiceDate']) {
    questionIdMap['firstServiceDate'] = questionId;
  } else if ((titleLower.includes('preferred date for second service') || titleLower.includes('second service')) && !questionIdMap['secondServiceDate']) {
    questionIdMap['secondServiceDate'] = questionId;
  } else if ((titleLower.includes('preferred date for third service') || titleLower.includes('third service')) && !questionIdMap['thirdServiceDate']) {
    questionIdMap['thirdServiceDate'] = questionId;
  } else if ((titleLower.includes('preferred date for fourth service') || titleLower.includes('fourth service')) && !questionIdMap['fourthServiceDate']) {
    questionIdMap['fourthServiceDate'] = questionId;
  } else if ((titleLower.includes('preferred time slot') || titleLower.includes('time slot')) && !questionIdMap['timeSlot']) {
    questionIdMap['timeSlot'] = questionId;
  } else if ((titleLower.includes('agree to complimentary service terms') || titleLower.includes('complimentary service terms') || combinedText.includes('service is rendered')) && !questionIdMap['agreedToTerms']) {
    questionIdMap['agreedToTerms'] = questionId;
  } else if ((titleLower.includes('personal information collection consent') || titleLower.includes('personal information') || combinedText.includes('collect, use, disclose')) && !questionIdMap['personalInfoConsent']) {
    questionIdMap['personalInfoConsent'] = questionId;
  }
}

/**
 * Fetch with Service Account using JWT authentication
 */
async function fetchWithServiceAccount(formId, serviceAccountEmail, privateKey) {
  // Validate formId
  if (!formId || typeof formId !== 'string' || formId.trim().length === 0) {
    throw new Error('Invalid form ID. Please check the Google Forms URL in settings.');
  }

  console.log(`[Google Forms Sync] Attempting to access form ID: ${formId}`);
  console.log(`[Google Forms Sync] Using service account: ${serviceAccountEmail}`);

  // Generate JWT token for service account
  const accessToken = await getAccessToken(serviceAccountEmail, privateKey);
  
  // First, fetch the form structure to map question IDs to field names
  const formUrl = `https://forms.googleapis.com/v1/forms/${formId}`;
  console.log(`[Google Forms Sync] Fetching form from: ${formUrl}`);
  
  const formResponse = await fetch(formUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  // Check if form exists and is accessible
  if (!formResponse.ok) {
    const errorData = await formResponse.json().catch(() => ({}));
    const errorDetails = errorData.error || {};
    
    console.error(`[Google Forms Sync] Form access failed: ${formResponse.status} ${formResponse.statusText}`);
    console.error(`[Google Forms Sync] Error details:`, JSON.stringify(errorDetails, null, 2));
    
    if (formResponse.status === 404) {
      const errorMessage = `Google Form not found (404). 
      
The form ID "${formId}" may be incorrect, or the service account doesn't have access to this form.

To fix this:
1. Verify the form ID is correct in Settings > Google Forms
2. Open the Google Form and click the "Share" button
3. Add the service account email as a collaborator: ${serviceAccountEmail}
4. Grant "Editor" or "Viewer" permissions
5. Wait a few minutes for permissions to propagate, then try again

Form URL should be: https://docs.google.com/forms/d/e/${formId}/viewform`;
      throw new Error(errorMessage);
    } else if (formResponse.status === 403) {
      const errorMessage = `Access denied (403). The service account doesn't have permission to access this form.

To fix this:
1. Open the Google Form: https://docs.google.com/forms/d/e/${formId}/viewform
2. Click the "Share" button (top right)
3. Add this email address: ${serviceAccountEmail}
4. Grant "Editor" or "Viewer" permissions
5. Wait a few minutes, then try again`;
      throw new Error(errorMessage);
    } else {
      const errorText = errorDetails.message || errorDetails.status || await formResponse.text().catch(() => 'Unknown error');
      throw new Error(`Failed to fetch form structure: ${formResponse.status} ${formResponse.statusText} - ${errorText}`);
    }
  }

  let questionIdMap = {};
  const formData = await formResponse.json();
  
  // Map question IDs to field names based on question titles
  if (formData.items) {
    formData.items.forEach((item) => {
      const q = item.questionItem?.question;
      if (q?.questionId) {
        mapFormQuestionTitleToLeadFields(questionIdMap, item.title, item.description, q.questionId);
      }
      if (item.questionGroupItem?.questions?.length) {
        const groupTitle = item.title || '';
        const groupDesc = item.description || '';
        item.questionGroupItem.questions.forEach((sub) => {
          if (!sub?.questionId) return;
          const rowTitle = sub.rowQuestion?.title || '';
          const combinedTitle = [groupTitle, rowTitle].filter(Boolean).join(' — ');
          mapFormQuestionTitleToLeadFields(questionIdMap, combinedTitle, groupDesc, sub.questionId);
        });
      }
    });
  }
  if (!questionIdMap['handphone']) {
    console.warn(
      '[Google Forms Sync] No handphone/phone field matched from form question titles. ' +
        'Add a title containing e.g. Phone, Mobile, Contact no., Whatsapp, or Handphone, or it may live only in a group row (now scanned).'
    );
  }
  
  // Fetch responses
  const apiUrl = `https://forms.googleapis.com/v1/forms/${formId}/responses`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error(`Form responses not found (404). The form ID "${formId}" may be incorrect, or the service account doesn't have access to this form's responses.`);
    } else if (response.status === 403) {
      throw new Error(`Access denied (403). The service account doesn't have permission to access form responses. Please share the Google Form with the service account email: ${serviceAccountEmail}`);
    } else {
      const errorText = errorData.error?.message || await response.text().catch(() => 'Unknown error');
      throw new Error(`Google Forms API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  const data = await response.json();
  
  // Store raw data for logging (before transformation)
  if (data.responses && data.responses.length > 0) {
    console.log('\n📥 RAW Google Forms API Response (before transformation):');
    console.log(JSON.stringify(data, null, 2));
  }
  
  return transformGoogleFormResponses(data, questionIdMap);
}

/**
 * Get OAuth 2.0 access token using Service Account JWT
 */
async function getAccessToken(serviceAccountEmail, privateKey) {
  if (!privateKey) {
    throw new Error('Private key is required for Service Account authentication');
  }

  // Clean and format the private key
  let cleanPrivateKey = privateKey.trim();
  cleanPrivateKey = cleanPrivateKey.replace(/\\n/g, '\n');
  
  if (!cleanPrivateKey.includes('BEGIN PRIVATE KEY') && !cleanPrivateKey.includes('BEGIN RSA PRIVATE KEY')) {
    if (!cleanPrivateKey.startsWith('-----BEGIN')) {
      cleanPrivateKey = `-----BEGIN PRIVATE KEY-----\n${cleanPrivateKey}\n-----END PRIVATE KEY-----`;
    }
  }

  if (!cleanPrivateKey.includes('BEGIN') || !cleanPrivateKey.includes('END')) {
    throw new Error('Invalid private key format. The key must include BEGIN and END markers.');
  }

  // Create JWT claim set
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/forms.body.readonly https://www.googleapis.com/auth/forms.responses.readonly'
  };

  try {
    // Sign JWT
    const jwtToken = jwt.sign(claimSet, cleanPrivateKey, {
      algorithm: 'RS256'
    });

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwtToken
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Failed to get access token: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (error) {
    if (error.message.includes('asymmetric key')) {
      throw new Error(`Invalid private key format: The key must be a valid RSA private key. Please check your GOOGLE_PRIVATE_KEY environment variable. Original error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Transform Google Forms API response to our format
 */
function transformGoogleFormResponses(apiData, questionIdMap = {}) {
  if (!apiData.responses || !Array.isArray(apiData.responses)) {
    return [];
  }

  // If question mapping is incomplete, try to find dates and other fields by pattern matching
  const findUnmappedDates = (answers, questionIdMap) => {
    const dateFields = {
      firstServiceDate: null,
      secondServiceDate: null,
      thirdServiceDate: null,
      fourthServiceDate: null
    };
    
    // Get all question IDs that aren't already mapped
    const unmappedIds = Object.keys(answers).filter(id => 
      !Object.values(questionIdMap).includes(id)
    );
    
    // Find date-like answers (YYYY-MM-DD format)
    const dateAnswers = [];
    unmappedIds.forEach(id => {
      const answer = answers[id];
      if (answer.textAnswers && answer.textAnswers.answers && answer.textAnswers.answers.length > 0) {
        const value = answer.textAnswers.answers[0].value;
        // Check if it's a date in YYYY-MM-DD format
        if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          dateAnswers.push({ id, value });
        }
      }
    });
    
    // Sort dates chronologically and assign to service dates if not already mapped
    dateAnswers.sort((a, b) => a.value.localeCompare(b.value));
    
    if (!questionIdMap['firstServiceDate'] && dateAnswers[0]) {
      dateFields.firstServiceDate = dateAnswers[0].value;
    }
    if (!questionIdMap['secondServiceDate'] && dateAnswers[1]) {
      dateFields.secondServiceDate = dateAnswers[1].value;
    }
    if (!questionIdMap['thirdServiceDate'] && dateAnswers[2]) {
      dateFields.thirdServiceDate = dateAnswers[2].value;
    }
    if (!questionIdMap['fourthServiceDate'] && dateAnswers[3]) {
      dateFields.fourthServiceDate = dateAnswers[3].value;
    }
    
    return dateFields;
  };

  return apiData.responses.map((response, index) => {
    const answers = response.answers || {};
    const timestamp = response.createTime || new Date().toISOString();
    
    // Use respondentEmail if available (from form settings)
    const email = response.respondentEmail || extractAnswerByQuestionId(answers, questionIdMap['email']) || '-';
    
    const salutation = extractAnswerByQuestionId(answers, questionIdMap['salutation']) || '-';
    const firstName = extractAnswerByQuestionId(answers, questionIdMap['firstName']) || '';
    const lastName = extractAnswerByQuestionId(answers, questionIdMap['lastName']) || '';
    const fullNameFromField = extractAnswerByQuestionId(answers, questionIdMap['fullName']) || '';
    // Prefer combined first+last, fallback to single "Name" / "Full name" field
    const fullName = `${firstName} ${lastName}`.trim() || (fullNameFromField && fullNameFromField !== '-' ? fullNameFromField.trim() : '') || '-';
    
    const handphone = extractAnswerByQuestionId(answers, questionIdMap['handphone']) || '-';
    let block = extractAnswerByQuestionId(answers, questionIdMap['block']) || '-';
    let unit = extractAnswerByQuestionId(answers, questionIdMap['unit']) || '-';
    const blockUnitRaw = extractAnswerByQuestionId(answers, questionIdMap['blockUnit']);
    if (blockUnitRaw && blockUnitRaw !== '-') {
      const parsed = parseBlockAndUnitFromCombined(blockUnitRaw);
      if (block === '-' && parsed.block) {
        block = parsed.block;
      }
      if (unit === '-' && parsed.unit) {
        unit = parsed.unit;
      }
    }
    const building = extractAnswerByQuestionId(answers, questionIdMap['building']) || '-';
    const street = extractAnswerByQuestionId(answers, questionIdMap['street']) || '-';
    const postcode = extractAnswerByQuestionId(answers, questionIdMap['postcode']) || '-';
    const country = extractAnswerByQuestionId(answers, questionIdMap['country']) || '-';
    const addressSingle = extractAnswerByQuestionId(answers, questionIdMap['address']);
    // Prefer building+street+postcode+country, fallback to single "Address" field
    const addressParts = [building, street, postcode, country].filter(part => part && part !== '-');
    const address = addressParts.length > 0 ? addressParts.join(', ') : (addressSingle && addressSingle !== '-' ? addressSingle.trim() : '-');
    
    // Try to get service dates from mapped question IDs first and normalize them
    let firstServiceDate = normalizeDate(extractAnswerByQuestionId(answers, questionIdMap['firstServiceDate'])) || '-';
    let secondServiceDate = normalizeDate(extractAnswerByQuestionId(answers, questionIdMap['secondServiceDate'])) || '-';
    let thirdServiceDate = normalizeDate(extractAnswerByQuestionId(answers, questionIdMap['thirdServiceDate'])) || '-';
    let fourthServiceDate = normalizeDate(extractAnswerByQuestionId(answers, questionIdMap['fourthServiceDate'])) || '-';
    
    // If some dates are missing, try to find them from unmapped questions
    if (firstServiceDate === '-' || secondServiceDate === '-' || thirdServiceDate === '-' || fourthServiceDate === '-') {
      const unmappedDates = findUnmappedDates(answers, questionIdMap);
      if (firstServiceDate === '-' && unmappedDates.firstServiceDate) {
        firstServiceDate = unmappedDates.firstServiceDate;
      }
      if (secondServiceDate === '-' && unmappedDates.secondServiceDate) {
        secondServiceDate = unmappedDates.secondServiceDate;
      }
      if (thirdServiceDate === '-' && unmappedDates.thirdServiceDate) {
        thirdServiceDate = unmappedDates.thirdServiceDate;
      }
      if (fourthServiceDate === '-' && unmappedDates.fourthServiceDate) {
        fourthServiceDate = unmappedDates.fourthServiceDate;
      }
    }
    
    const timeSlot = extractAnswerByQuestionId(answers, questionIdMap['timeSlot']) || '-';
    
    // For consent fields, check if the answer exists (even if it's a long text)
    // If the question ID exists in answers, consider it as "Yes"
    const agreedToTermsAnswer = extractAnswerByQuestionId(answers, questionIdMap['agreedToTerms']);
    const agreedToTerms = agreedToTermsAnswer && agreedToTermsAnswer !== '-' && agreedToTermsAnswer.trim().length > 0 ? 'Yes' : 'No';
    
    const personalInfoConsentAnswer = extractAnswerByQuestionId(answers, questionIdMap['personalInfoConsent']);
    const personalInfoConsent = personalInfoConsentAnswer && personalInfoConsentAnswer !== '-' && personalInfoConsentAnswer.trim().length > 0 ? 'Yes' : 'No';

    return {
      id: response.responseId || `response-${index}`,
      responseId: response.responseId, // Keep original response ID for duplicate detection
      timestamp,
      email,
      salutation,
      firstName,
      lastName,
      fullName, // Combined from firstName + lastName
      handphone,
      block,
      unit,
      building,
      street,
      postcode,
      country,
      address, // Combined from building, street, postcode, country
      firstServiceDate,
      secondServiceDate,
      thirdServiceDate,
      fourthServiceDate,
      timeSlot,
      agreedToTerms,
      personalInfoConsent
    };
  });
}

/**
 * Convert date from M/D/YYYY or other formats to YYYY-MM-DD
 */
function normalizeDate(dateString) {
  if (!dateString || dateString === '-') return null;
  
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // Try to parse M/D/YYYY format (from Google Sheets)
  const mdyMatch = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Try to parse as Date object
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  return dateString; // Return as-is if can't parse
}

/**
 * Extract answer value from Google Forms response by question ID
 */
function extractAnswerByQuestionId(answers, questionId) {
  if (!questionId || !answers[questionId]) {
    return null;
  }
  
  const answer = answers[questionId];
  
  // Handle text answers (can be single or multiple)
  if (answer.textAnswers && answer.textAnswers.answers && answer.textAnswers.answers.length > 0) {
    // For consent/terms fields, check if there's any text (means they agreed)
    // For other fields, return the first value
    const firstValue = answer.textAnswers.answers[0].value || '';
    
    // Normalize date strings to YYYY-MM-DD format if they look like dates
    if (firstValue && (/\d{1,2}\/\d{1,2}\/\d{4}/.test(firstValue) || /^\d{4}-\d{2}-\d{2}$/.test(firstValue))) {
      return normalizeDate(firstValue) || firstValue;
    }
    
    return firstValue;
  }
  
  // Handle choice answers (dropdown, multiple choice, etc.)
  if (answer.choiceAnswers && answer.choiceAnswers.answers && answer.choiceAnswers.answers.length > 0) {
    return answer.choiceAnswers.answers[0].value || '';
  }
  
  // Handle date answers
  if (answer.dateAnswers && answer.dateAnswers.answers && answer.dateAnswers.answers.length > 0) {
    const date = answer.dateAnswers.answers[0].value;
    if (date.year && date.month && date.day) {
      // Format as YYYY-MM-DD
      return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    }
    return '';
  }
  
  return null;
}

