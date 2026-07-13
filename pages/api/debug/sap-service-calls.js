/**
 * Admin-gated diagnostic: compare sql10 vs OData ServiceCalls counts per CardCode.
 * POST /api/debug/sap-service-calls
 * Body: { cardCodes: string[] }
 */

import { requireSession } from '../../../lib/auth/requireSession';
import { requireAdminUser } from '../company-memos/_auth';
import {
  fetchSapServiceCallsByCardCode,
  fetchSapServiceCallsODataByCardCode,
  resolveSapSessionCookies,
} from '../../../lib/customers/fetchSapCustomerData';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Requested-With, Accept'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const admin = await requireAdminUser(req, res);
  if (!admin) return;

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const cardCodes = Array.isArray(body.cardCodes)
    ? [...new Set(body.cardCodes.map((c) => String(c || '').trim()).filter(Boolean))]
    : [];
  if (cardCodes.length === 0) {
    return res.status(400).json({ error: 'cardCodes array is required' });
  }
  if (cardCodes.length > 20) {
    return res.status(400).json({ error: 'At most 20 card codes per request' });
  }

  const sessionCookies = await resolveSapSessionCookies(req);
  if (!sessionCookies?.b1session || !sessionCookies?.routeid) {
    return res.status(401).json({
      error: 'SAP session unavailable',
      message: 'Log in to SAP or configure SAP_SERVICE_LAYER credentials.',
    });
  }

  const results = [];
  for (const cardCode of cardCodes) {
    let sql10 = [];
    let odata = [];
    let sql10Error = null;
    let odataError = null;

    try {
      sql10 = await fetchSapServiceCallsByCardCode(cardCode, sessionCookies);
    } catch (err) {
      sql10Error = err?.message || String(err);
    }

    try {
      odata = await fetchSapServiceCallsODataByCardCode(cardCode, sessionCookies);
    } catch (err) {
      odataError = err?.message || String(err);
    }

    results.push({
      cardCode,
      sql10Count: sql10.length,
      odataCount: odata.length,
      sql10Sample: sql10.slice(0, 3).map((r) => r.serviceCallID),
      odataSample: odata.slice(0, 3).map((r) => r.serviceCallID),
      sql10Error,
      odataError,
    });
  }

  return res.status(200).json({ success: true, results });
}
