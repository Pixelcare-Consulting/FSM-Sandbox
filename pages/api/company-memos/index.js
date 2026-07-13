import { normalizeMemoFolder } from '../../../lib/constants/companyMemoFolders';
import { invalidateHeaderTickerMemoCache } from '../../../lib/redis/companyMemoCache';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SOURCE,
  AUDIT_STATUS,
  writeAuditLogFromRequest,
} from '../../../lib/services/auditLog';
import { memoAuditSnapshot } from '../../../lib/utils/companyMemoAudit';
import { assertUpdateLogsMemoAccess } from '../../../lib/utils/companyMemoDevAccess';
import { normalizeMemoBodyForSave } from '../../../lib/utils/memoHtml';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';
import { requireAdminUser } from './_auth';

const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high']);

/** @param {unknown} body */
function normalizeCreateBody(body) {
  if (!body || typeof body !== 'object') return null;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) return { error: 'Subject is required' };

  const priority =
    typeof body.priority === 'string' && ALLOWED_PRIORITY.has(body.priority)
      ? body.priority
      : 'medium';

  return {
    row: {
      subject,
      body: normalizeMemoBodyForSave(body.body),
      priority,
      expires_at: body.expires_at === null || body.expires_at === undefined
        ? null
        : body.expires_at,
      is_group_memo: !!body.is_group_memo,
      target_group:
        body.is_group_memo &&
        typeof body.target_group === 'string' &&
        body.target_group.trim()
          ? body.target_group.trim()
          : null,
      show_on_sign_in: !!body.show_on_sign_in,
      show_on_job_screen: !!body.show_on_job_screen,
      show_on_dispatch_screen: !!body.show_on_dispatch_screen,
      show_in_header: body.show_in_header !== false,
      only_creator_can_edit: !!body.only_creator_can_edit,
      folder: normalizeMemoFolder(body.folder),
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  const parsed = normalizeCreateBody(req.body);
  if (parsed?.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const folderGate = assertUpdateLogsMemoAccess({
    email: auth.email,
    requestedFolder: parsed.row.folder,
  });
  if (folderGate?.error) {
    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.MEMO_CREATE,
      category: AUDIT_CATEGORIES.MEMO,
      entityType: 'company_memo',
      entityLabel: parsed.row.subject,
      description: 'Company memo create denied (Update Logs restriction)',
      details: { folder: parsed.row.folder, reason: folderGate.error },
      status: AUDIT_STATUS.FAILURE,
      source: AUDIT_SOURCE.PORTAL,
    });
    return res.status(403).json({ message: folderGate.error });
  }

  const { data, error } = await auth.admin
    .from('company_memos')
    .insert({
      ...parsed.row,
      created_by: auth.uid,
    })
    .select()
    .single();

  if (error) {
    console.error('[company-memos] insert:', error);
    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.MEMO_CREATE,
      category: AUDIT_CATEGORIES.MEMO,
      entityType: 'company_memo',
      entityLabel: parsed.row.subject,
      description: 'Failed to create company memo',
      details: { error: error.message, code: error.code, ...memoAuditSnapshot(parsed.row) },
      status: AUDIT_STATUS.FAILURE,
      source: AUDIT_SOURCE.PORTAL,
    });
    return res.status(400).json({
      message: error.message || 'Failed to create memo',
      code: error.code,
    });
  }

  await writeAuditLogFromRequest(req, {
    action: AUDIT_ACTIONS.MEMO_CREATE,
    category: AUDIT_CATEGORIES.MEMO,
    entityType: 'company_memo',
    entityId: data.id,
    entityLabel: data.subject,
    description: `Created company memo: ${data.subject}`,
    details: memoAuditSnapshot(data),
    status: AUDIT_STATUS.SUCCESS,
    source: AUDIT_SOURCE.PORTAL,
  });

  await invalidateHeaderTickerMemoCache();
  invalidateListCache('dashboard-bootstrap:');

  return res.status(201).json(data);
}
