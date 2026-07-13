// pages/api/getJobStatus.js
// Fetches job statuses from SAP U_API_JOB_STATUS (same pattern as getJobCategory).
import { getSupabaseAdmin } from '../../lib/supabase/server';
import { invalidateReferenceCaches } from '../../lib/supabase/referenceCacheKeys';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function cacheSapStatusSnapshot(jobStatuses) {
  try {
    const supabase = getSupabaseAdmin();
    const { data: existing } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'jobStatuses')
      .maybeSingle();

    const sapSnapshot = (jobStatuses || [])
      .map((item) => ({
        value: item.U_JobStatusID != null ? String(item.U_JobStatusID).trim() : '',
        name: item.U_JobStatus || item.Name || '',
      }))
      .filter((row) => row.value !== '');

    const existingValue = existing?.value && typeof existing.value === 'object' ? existing.value : {};
    const value = {
      ...existingValue,
      types: existingValue.types || {},
      sapSnapshot,
    };

    const { error } = await supabase.from('settings').upsert(
      { id: 'jobStatuses', value },
      { onConflict: 'id' }
    );

    if (error) {
      console.warn('getJobStatus sapSnapshot cache failed:', error.message);
    } else {
      invalidateReferenceCaches();
    }
  } catch (e) {
    console.warn('getJobStatus sapSnapshot cache failed:', e?.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SAP_SERVICE_LAYER_BASE_URL } = process.env;
  const b1session = req.cookies.B1SESSION;
  const routeid = req.cookies.ROUTEID;
  const sessionExpiry = req.cookies.B1SESSION_EXPIRY;

  if (!b1session || !routeid || !sessionExpiry) {
    return res.status(401).json({ error: 'Unauthorized - Missing required cookies' });
  }

  try {
    const baseUrl = (SAP_SERVICE_LAYER_BASE_URL || '').trim().replace(/\/$/, '');
    const endpoint = `${baseUrl}/U_API_JOB_STATUS`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `B1SESSION=${b1session}; ROUTEID=${routeid}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SAP Job Status API Error:', errorText);
      return res.status(response.status).json({
        error: 'Failed to fetch job statuses',
        details: errorText,
        status: response.status,
      });
    }

    const data = await response.json();
    const value = data?.value;

    if (!value || !Array.isArray(value)) {
      return res.status(500).json({
        error: 'Unexpected response structure from SAP',
        received: data,
      });
    }

    const jobStatuses = value.map((item) => ({
      Code: item.Code,
      U_JobStatusID: item.U_JobStatusID != null ? String(item.U_JobStatusID) : '',
      U_JobStatus: item.U_JobStatus || item.Name || '',
    }));

    await cacheSapStatusSnapshot(jobStatuses);

    res.status(200).json(jobStatuses);
  } catch (error) {
    console.error('Error in getJobStatus API:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}
