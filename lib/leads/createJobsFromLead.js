/**
 * Create jobs from a lead for all service dates (first, second, third, fourth).
 * Uses the same logic as single create-job: ensures customer (using lead full_name when not synced),
 * ensures location, then creates one job per service date.
 * Used only by manual POST /create-jobs and legacy create-job — NOT auto on lead convert.
 */

import { leadService, customerService, jobService } from '../supabase/database';
import { getSupabaseAdmin } from '../supabase/server';
import sapService from '../services/sapService';
import { transformToSAPBusinessPartner, validateBusinessPartnerData } from '../utils/sapBusinessPartnerTransform';
import { ensurePortalCustomerPrimaryContact } from '../customers/ensurePortalCustomerPrimaryContact';
import { buildSingaporeDateTimeUtc, getSingaporeUtcDayRange, toSingaporeYmd, toSingaporeTimeHm } from '../utils/singaporeDateTime';
import { normalizeServiceDateYmd } from './normalizeServiceDateYmd';
import { buildLeadLocationName, getCustomerAddressFromLead } from '../utils/leadLocationName';
import { ensurePortalCustomerAddressFromLead } from '../customers/ensurePortalCustomerAddressFromLead';
import { getLeadJobsByServiceDate } from './getLeadJobsByServiceDate';
import { insertPortalDefaultJobContactType } from '../jobs/portalDefaultJobContactType';
import { getNextJobNumber, isDuplicateJobNumberError } from '../jobs/getNextJobNumber';
import { resolveLeadOrPortalCustomer } from './resolveLeadOrPortalCustomer';

export class LeadJobsAlreadyCreatedError extends Error {
  constructor(message, jobsByServiceDate = {}) {
    super(message);
    this.name = 'LeadJobsAlreadyCreatedError';
    this.jobsByServiceDate = jobsByServiceDate;
  }
}

function parseTimeSlot(lead) {
  let startHour = 9;
  let startMinute = 0;
  let endHour = 12;
  let endMinute = 30;
  if (lead.time_slot) {
    const timeSlotMatch = lead.time_slot.match(/(\d{1,2})\.?(\d{2})?\s*(am|pm)\s*-\s*(\d{1,2})\.?(\d{2})?\s*(am|pm)/i);
    if (timeSlotMatch) {
      startHour = parseInt(timeSlotMatch[1], 10);
      startMinute = parseInt(timeSlotMatch[2] || '0', 10);
      const startAmPm = timeSlotMatch[3].toLowerCase();
      endHour = parseInt(timeSlotMatch[4], 10);
      endMinute = parseInt(timeSlotMatch[5] || '0', 10);
      const endAmPm = timeSlotMatch[6].toLowerCase();
      if (startAmPm === 'pm' && startHour !== 12) startHour += 12;
      if (startAmPm === 'am' && startHour === 12) startHour = 0;
      if (endAmPm === 'pm' && endHour !== 12) endHour += 12;
      if (endAmPm === 'am' && endHour === 12) endHour = 0;
    }
  }
  return { startHour, startMinute, endHour, endMinute };
}

function getScheduledForDate(serviceDate, lead) {
  const { startHour, startMinute, endHour, endMinute } = parseTimeSlot(lead);
  const scheduledStart = buildSingaporeDateTimeUtc(serviceDate, startHour, startMinute);
  const scheduledEnd = buildSingaporeDateTimeUtc(serviceDate, endHour, endMinute);
  return { scheduledStart, scheduledEnd };
}

/** Format a Date as a Singapore-local HH:mm:ss TIME string for job_schedule. */
function toSingaporeScheduleTime(dateValue) {
  if (!dateValue) return null;
  const hm = toSingaporeTimeHm(dateValue);
  return hm ? `${hm}:00` : null;
}

/**
 * Insert a job_schedule row for a lead-generated job so the UI shows a duration.
 * Lead jobs default to a 1-hour duration. Non-fatal: never blocks job creation.
 */
async function insertLeadJobSchedule(supabase, jobId, serviceDate, scheduledStart, scheduledEnd, address) {
  try {
    const { error } = await supabase.from('job_schedule').insert({
      job_id: jobId,
      jsdate: serviceDate,
      jedate: serviceDate,
      jstime: toSingaporeScheduleTime(scheduledStart),
      jetime: toSingaporeScheduleTime(scheduledEnd),
      dur_type: 'hours',
      dur: '1.00',
      address: address || null,
    });
    if (error) {
      console.warn(`createJobsFromLead: job_schedule insert failed for ${jobId}: ${error.message}`);
    }
  } catch (scheduleError) {
    console.warn(`createJobsFromLead: job_schedule insert failed for ${jobId}:`, scheduleError?.message);
  }
}

/**
 * Ensure customer exists for lead. If lead has customer_id, return that customer.
 * Otherwise create customer from lead (customer_name = lead.full_name).
 * @returns { customerId, customer }
 */
async function ensureCustomer(leadId, lead, supabase, sessionCookies) {
  let customerId = lead.customer_id;
  let customer = null;

  if (!customerId) {
    let customerCode;
    try {
      customerCode = await customerService.getNextPortalCardCode(supabase);
    } catch (e) {
      console.warn('Get next portal card code failed:', e?.message);
      const emailPrefix = (lead.email || 'LEAD').split('@')[0];
      customerCode = `LEAD-${emailPrefix.toUpperCase().substring(0, 10)}-${Date.now().toString().slice(-6)}`;
    }

    let existingCustomer = null;
    try {
      const { data } = await supabase
        .from('customer')
        .select('id, customer_code, customer_name, phone_number, email')
        .eq('email', lead.email)
        .is('deleted_at', null)
        .maybeSingle();
      existingCustomer = data;
    } catch (e) {
      console.warn('Could not query customer by email:', e?.message);
    }

    if (existingCustomer) {
      customerId = existingCustomer.id;
      customer = existingCustomer;
    } else {
      const customerData = {
        customer_code: customerCode,
        customer_name: lead.full_name || lead.email,
        phone_number: lead.handphone || null,
        email: lead.email,
        source: 'portal',
        lead_id: leadId
      };
      customer = await customerService.create(customerData);
      customerId = customer.id;

      try {
        if (sessionCookies) {
          const customerCodeVal = customer.customer_code;
          const isSAPCardCode = typeof customerCodeVal === 'string' && /^[A-Za-z0-9]{1,15}$/.test(customerCodeVal);
          let shouldCreateInSAP = true;
          if (isSAPCardCode) {
            const existsInSAP = await sapService.businessPartnerExists(customerCodeVal, sessionCookies);
            if (existsInSAP) shouldCreateInSAP = false;
          }
          if (shouldCreateInSAP) {
            const sapBusinessPartnerData = transformToSAPBusinessPartner(customer, lead);
            const validation = validateBusinessPartnerData(sapBusinessPartnerData);
            if (validation.isValid) {
              const createdBP = await sapService.createBusinessPartner(sapBusinessPartnerData, sessionCookies);
              if (createdBP?.CardCode) {
                await customerService.update(customer.id, { customer_code: createdBP.CardCode });
                customer.customer_code = createdBP.CardCode;
              }
            }
          }
        }
      } catch (syncError) {
        console.warn('SAP sync failed (non-blocking):', syncError?.message);
      }
    }
  } else {
    const { data } = await supabase
      .from('customer')
      .select('id, customer_code, customer_name, phone_number, email')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle();
    customer = data;
  }

  return { customerId, customer };
}

/**
 * Ensure location exists for lead/customer. Returns locationId and locationName.
 */
async function ensureLocation(lead, customerId, supabase) {
  const locationName = buildLeadLocationName(lead);

  const { data: existingLocation } = await supabase
    .from('locations')
    .select('id, location_name')
    .eq('customer_id', customerId)
    .eq('location_name', locationName)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingLocation) {
    return { locationId: existingLocation.id, locationName };
  }

  // locations table only has: customer_id, location_name, current_*, destination_* lat/long, timestamps
  const { data: newLocation, error: locationError } = await supabase
    .from('locations')
    .insert({
      customer_id: customerId,
      location_name: locationName
    })
    .select()
    .single();

  if (locationError) throw new Error(`Failed to create location: ${locationError.message}`);
  return { locationId: newLocation.id, locationName };
}

/**
 * Check if a job already exists for this customer, location, and date (to avoid duplicates).
 */
async function jobExistsForDate(supabase, customerId, locationId, serviceDate) {
  const { start, end } = getSingaporeUtcDayRange(serviceDate);
  const { data } = await supabase
    .from('jobs')
    .select('id')
    .eq('customer_id', customerId)
    .eq('location_id', locationId)
    .is('deleted_at', null)
    .gte('scheduled_start', start.toISOString())
    .lte('scheduled_start', end.toISOString())
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function createJobWithUniqueNumber(supabase, jobData, maxRetries = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const jobNumber = await getNextJobNumber(supabase);
    try {
      const job = await jobService.create({ ...jobData, job_number: jobNumber }, supabase);
      return job;
    } catch (error) {
      lastError = error;
      if (isDuplicateJobNumberError(error) && attempt < maxRetries - 1) continue;
      throw error;
    }
  }
  throw lastError || new Error('Failed to create job with a unique job number');
}

/**
 * Create jobs from a lead for all service dates.
 * @param {string} leadId
 * @param {object} options
 * @param {boolean} options.updateLeadStatus - If true, set lead status to CONVERTED and link customer_id
 * @param {object} options.req - Optional request for SAP session cookies
 * @returns {Promise<{ jobs: array, customer: object, locationName: string, createdCount: number }>}
 */
export async function createJobsFromLead(leadId, options = {}) {
  const { updateLeadStatus = true, req } = options;
  const sessionCookies = req ? sapService.getSessionCookies(req) : null;
  const supabase = getSupabaseAdmin();

  const resolved = await resolveLeadOrPortalCustomer(leadId, supabase);
  if (!resolved) throw new Error('Lead not found');

  const { lead, hasLinkedLead } = resolved;
  const realLeadId = hasLinkedLead ? lead.id : null;

  const serviceDates = [
    normalizeServiceDateYmd(lead.first_service_date),
    normalizeServiceDateYmd(lead.second_service_date),
    normalizeServiceDateYmd(lead.third_service_date),
    normalizeServiceDateYmd(lead.fourth_service_date)
  ].filter(Boolean);

  if (serviceDates.length === 0) {
    throw new Error('Lead has no service dates. Please add at least one service date.');
  }

  const { customerId, customer } = await ensureCustomer(realLeadId || leadId, lead, supabase, sessionCookies);
  try {
    await ensurePortalCustomerPrimaryContact({
      supabase,
      customerId,
      customerName: customer?.customer_name || lead.full_name || lead.email || '',
      phoneNumber: customer?.phone_number || lead.handphone || '',
      email: customer?.email || lead.email || ''
    });
  } catch (contactError) {
    console.warn('Failed to ensure portal customer primary contact:', contactError?.message);
  }
  const { locationId, locationName } = await ensureLocation(lead, customerId, supabase);
  try {
    await ensurePortalCustomerAddressFromLead({
      supabase,
      customerId,
      lead,
      locationId
    });
  } catch (addrErr) {
    console.warn('createJobsFromLead: address sync failed:', addrErr?.message);
  }
  const leadWithCustomer = { ...lead, customer_id: customerId };
  const existingJobsByServiceDate = await getLeadJobsByServiceDate(leadWithCustomer, {
    supabase,
    customerId,
    locationId,
    locationName,
  });

  if (Object.keys(existingJobsByServiceDate).length > 0) {
    throw new LeadJobsAlreadyCreatedError(
      'Jobs have already been created for this lead. Use the existing job links instead of creating again.',
      existingJobsByServiceDate
    );
  }

  const jobTitleBase = `Service for ${lead.full_name || lead.email}`;
  const jobDesc = lead.notes || `Service request from lead. ${lead.address ? `Address: ${lead.address}` : ''}`;
  const jobScheduleAddress = getCustomerAddressFromLead(lead) || locationName;
  const createdJobs = [];
  const creationErrors = [];

  for (const serviceDate of serviceDates) {
    const alreadyExists = await jobExistsForDate(supabase, customerId, locationId, serviceDate);
    if (alreadyExists) continue;

    const { scheduledStart, scheduledEnd } = getScheduledForDate(serviceDate, lead);
    const jobData = {
      customer_id: customerId,
      location_id: locationId,
      title: jobTitleBase,
      description: jobDesc,
      priority: 'MEDIUM',
      status: '554',
      scheduled_start: scheduledStart.toISOString(),
      scheduled_end: scheduledEnd.toISOString()
    };

    try {
      const job = await createJobWithUniqueNumber(supabase, jobData);
      await insertPortalDefaultJobContactType(supabase, job.id);
      await insertLeadJobSchedule(supabase, job.id, serviceDate, scheduledStart, scheduledEnd, jobScheduleAddress);
      createdJobs.push(job);
    } catch (error) {
      creationErrors.push({
        serviceDate,
        message: error?.message || 'Failed to create job',
      });
    }
  }

  if (createdJobs.length === 0 && creationErrors.length > 0) {
    const duplicateMsg = creationErrors.find((e) =>
      isDuplicateJobNumberError({ message: e.message })
    );
    if (duplicateMsg) {
      throw new Error(
        `Could not assign a unique job number (${duplicateMsg.message}). Please try again.`
      );
    }
    throw new Error(creationErrors[0].message || 'Failed to create jobs from lead');
  }

  if (updateLeadStatus && realLeadId) {
    await leadService.convertToCustomer(realLeadId, customerId);
  } else if (realLeadId) {
    // When status was already set (e.g. by PUT), still link lead to customer
    await supabase
      .from('leads')
      .update({
        customer_id: customerId,
        converted_at: new Date().toISOString()
      })
      .eq('id', realLeadId);
  }

  const jobsNote = createdJobs.length
    ? `Jobs created: ${createdJobs.map(j => j.job_number).join(', ')} on ${new Date().toISOString()}`
    : null;
  if (jobsNote && realLeadId) {
    const newNotes = lead.notes ? `${lead.notes}\n\n${jobsNote}` : jobsNote;
    await supabase.from('leads').update({ notes: newNotes }).eq('id', realLeadId);
  }

  const skippedDates = serviceDates.length - createdJobs.length - creationErrors.length;
  let jobsByServiceDate = {};

  if (createdJobs.length > 0 || (createdJobs.length === 0 && skippedDates > 0) || creationErrors.length > 0) {
    jobsByServiceDate = await getLeadJobsByServiceDate(leadWithCustomer, {
      supabase,
      customerId,
      locationId,
      locationName,
    });
  }

  return {
    jobs: createdJobs,
    customer,
    locationName,
    createdCount: createdJobs.length,
    skippedDates,
    jobsByServiceDate,
    partial: creationErrors.length > 0,
    errors: creationErrors,
  };
}
