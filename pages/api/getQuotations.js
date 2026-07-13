// pages/api/getQuotations.js
// Customer quotations: SAP Quotations OData (sql12 SQL query was removed from Service Layer).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { resolveSapSessionCookies } from '../../lib/customers/fetchSapCustomerData';

function escapeODataString(value) {
  return String(value ?? '').replace(/'/g, "''");
}

/** SAP ISO date → YYYYMMDD (QuotationsTab expects this format). */
function toYyyyMmDd(docDate) {
  if (!docDate) return '';
  const s = String(docDate);
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${mo}${day}`;
}

/** Map SAP DocumentStatus to legacy DocStatus flag used by QuotationsTab. */
function mapDocStatus(documentStatus) {
  const status = String(documentStatus || '').toLowerCase();
  if (status.includes('close')) return 'C';
  return 'O';
}

function mapQuotationRow(item) {
  return {
    CardCode: item.CardCode,
    DocDate: toYyyyMmDd(item.DocDate),
    Comments: item.Comments || '',
    DocNum: item.DocNum,
    DocTotal: item.DocTotal,
    DocStatus: mapDocStatus(item.DocumentStatus),
    subject:
      item.Comments ||
      item.U_SupportRef ||
      item.NumAtCard ||
      '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SAP_SERVICE_LAYER_BASE_URL } = process.env;
  const { cardCode, page: rawPage, limit: rawLimit } = req.body;

  if (!cardCode) {
    return res.status(400).json({ error: 'CardCode is required' });
  }

  const page = Math.max(1, Number(rawPage) || 1);
  const limit = Math.min(Math.max(1, Number(rawLimit) || 10), 100);
  const skip = (page - 1) * limit;

  const sessionCookies = await resolveSapSessionCookies(req);
  if (!sessionCookies?.b1session || !sessionCookies?.routeid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { b1session, routeid } = sessionCookies;

  try {
    const baseUrl = (SAP_SERVICE_LAYER_BASE_URL || '').trim().replace(/\/$/, '');
    const safeCardCode = escapeODataString(cardCode.trim());
    const filter = encodeURIComponent(`CardCode eq '${safeCardCode}'`);
    const select = [
      'DocNum',
      'DocDate',
      'DocTotal',
      'DocumentStatus',
      'Comments',
      'CardCode',
      'NumAtCard',
      'U_SupportRef',
    ].join(',');
    const endpoint =
      `${baseUrl}/Quotations?$filter=${filter}&$select=${select}` +
      `&$orderby=DocNum desc&$top=${limit}&$skip=${skip}&$count=true`;

    const queryResponse = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `B1SESSION=${b1session}; ROUTEID=${routeid}`,
      },
    });

    const responseText = await queryResponse.text();
    if (!queryResponse.ok) {
      console.error('SAP Quotations API Error:', queryResponse.status, responseText);
      return res.status(queryResponse.status).json({ error: responseText });
    }

    const queryData = JSON.parse(responseText);
    const rows = Array.isArray(queryData.value) ? queryData.value : [];
    const totalCount =
      queryData['@odata.count'] ??
      queryData['odata.count'] ??
      rows.length;

    const quotations = rows.map(mapQuotationRow);

    res.status(200).json({
      quotations,
      totalCount: Number(totalCount) || quotations.length,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching quotations:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
