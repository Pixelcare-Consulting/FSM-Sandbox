/**
 * GET /api/leads/:leadId/jobs
 * Returns jobs created from this lead, keyed by service date (first, second, third, fourth).
 * Used to show "View Job" links next to each service date in the lead modal.
 */

import { getLeadJobsByServiceDate } from '../../../../lib/leads/getLeadJobsByServiceDate';
import {
  resolveLeadOrPortalCustomer,
  parsePortalSyntheticCustomerId,
} from '../../../../lib/leads/resolveLeadOrPortalCustomer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { leadId } = req.query;
    if (!leadId) {
      return res.status(400).json({ error: 'Lead ID is required' });
    }

    const leadIdStr = String(leadId).trim();
    if (leadIdStr.startsWith('cust-') && !parsePortalSyntheticCustomerId(leadIdStr)) {
      return res.status(400).json({ error: 'Invalid portal customer id' });
    }

    const resolved = await resolveLeadOrPortalCustomer(leadId);
    if (!resolved) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { lead } = resolved;
    const customerId = lead.customer_id;
    if (!customerId) {
      return res.status(200).json({ jobsByServiceDate: {} });
    }

    const hasServiceDate = [
      lead.first_service_date,
      lead.second_service_date,
      lead.third_service_date,
      lead.fourth_service_date,
    ].some((d) => d && String(d).trim() !== '' && d !== '-');

    if (!hasServiceDate) {
      return res.status(200).json({ jobsByServiceDate: {} });
    }

    const jobsByServiceDate = await getLeadJobsByServiceDate(lead);

    return res.status(200).json({ jobsByServiceDate });
  } catch (error) {
    console.error('Error fetching lead jobs:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch jobs for lead',
    });
  }
}
