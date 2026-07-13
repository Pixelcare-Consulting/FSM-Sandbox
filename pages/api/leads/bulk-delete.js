/**
 * API endpoint for bulk delete operations
 * DELETE /api/leads/bulk-delete - Delete multiple leads at once
 */

import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';
import { PORTAL_LIST_CACHE_PREFIX } from '../../../lib/leads/portalListCache';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../lib/services/auditLog';

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { leadIds } = req.body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({
        error: 'leadIds array is required and must not be empty'
      });
    }

    const supabase = getSupabaseAdmin();

    // Soft delete by setting deleted_at timestamp for all provided IDs
    const { data, error } = await supabase
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', leadIds)
      .select('id');

    if (error) {
      console.error('❌ Database error in bulk delete:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        leadIds
      });
      throw error;
    }

    invalidateListCache(PORTAL_LIST_CACHE_PREFIX);

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.LEAD_DELETE,
      category: AUDIT_CATEGORIES.LEAD,
      entityType: 'lead',
      entityLabel: `${data.length} lead(s)`,
      description: `Bulk deleted ${data.length} lead(s)`,
      details: { deletedCount: data.length, deletedIds: data.map((lead) => lead.id) },
      status: AUDIT_STATUS.SUCCESS,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${data.length} lead(s)`,
      deletedCount: data.length,
      deletedIds: data.map(lead => lead.id)
    });
  } catch (error) {
    console.error('Error in bulk delete API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

