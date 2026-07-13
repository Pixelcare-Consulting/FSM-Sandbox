import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';
import {
  writeAuditLogFromRequest,
  queryAuditLogs,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  AUDIT_SOURCE,
} from '../../../lib/services/auditLog';

const AUDIT_LOGS_CACHE_TTL_MS = 30 * 1000;

function auditLogsCacheKey(query) {
  return `audit-logs:${JSON.stringify(query)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = getSupabaseAdmin();

    if (req.method === 'GET') {
      const {
        page,
        limit,
        category,
        action,
        status,
        entityType,
        entityId,
        userId,
        search,
        dateFrom,
        dateTo,
      } = req.query;

      const cacheKey = auditLogsCacheKey({
        page,
        limit,
        category,
        action,
        status,
        entityType,
        entityId,
        userId,
        search,
        dateFrom,
        dateTo,
      });
      const cached = getListCache(cacheKey, AUDIT_LOGS_CACHE_TTL_MS);
      if (cached) {
        logResponseSize('audit-logs/index (cached)', cached);
        return res.status(200).json(cached);
      }

      const result = await queryAuditLogs({
        supabase,
        page,
        limit,
        category,
        action,
        status,
        entityType,
        entityId,
        userId,
        search,
        dateFrom,
        dateTo,
      });

      const payload = { success: true, ...result };
      setListCache(cacheKey, payload, AUDIT_LOGS_CACHE_TTL_MS);
      logResponseSize('audit-logs/index', payload);
      return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

      if (!body.action) {
        return res.status(400).json({ success: false, error: 'action is required' });
      }

      const result = await writeAuditLogFromRequest(req, {
        action: body.action,
        category: body.category || AUDIT_CATEGORIES.SYSTEM,
        entityType: body.entityType || body.entity_type || null,
        entityId: body.entityId || body.entity_id || null,
        entityLabel: body.entityLabel || body.entity_label || null,
        description: body.description || null,
        details: body.details || {},
        changes: body.changes || null,
        status: body.status || AUDIT_STATUS.SUCCESS,
        source: body.source || AUDIT_SOURCE.PORTAL,
        userId: body.userId || req.cookies?.uid || null,
        userEmail: body.userEmail || req.cookies?.email || null,
        userName: body.userName || req.cookies?.fullName || null,
      });

      if (!result.ok) {
        return res.status(500).json({ success: false, error: result.error });
      }

      return res.status(201).json({ success: true, id: result.id });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/audit-logs]', err);
    return res.status(500).json({ success: false, error: err?.message || 'Internal error' });
  }
}
