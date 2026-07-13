import { normalizeMemoFolder } from '../../../lib/constants/companyMemoFolders';
import { invalidateHeaderTickerMemoCache } from '../../../lib/redis/companyMemoCache';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_SOURCE,
  AUDIT_STATUS,
  buildChanges,
  writeAuditLogFromRequest,
} from '../../../lib/services/auditLog';
import { canMutateCompanyMemo } from '../../../lib/utils/companyMemoAccess';
import { memoAuditSnapshot } from '../../../lib/utils/companyMemoAudit';
import { assertUpdateLogsMemoAccess } from '../../../lib/utils/companyMemoDevAccess';
import { normalizeMemoBodyForSave } from '../../../lib/utils/memoHtml';
import { requireAdminUser } from './_auth';

const MEMO_AUDIT_SELECT =
  'id, subject, body, priority, expires_at, folder, is_group_memo, target_group, show_on_sign_in, show_on_job_screen, show_on_dispatch_screen, show_in_header, only_creator_can_edit, created_by';

const MEMO_DETAIL_SELECT =
  '*, creator:users!company_memos_created_by_fkey ( id, username )';

async function selectMemoRow(adminClient, id, select = MEMO_AUDIT_SELECT) {
  const { data, error } = await adminClient
    .from('company_memos')
    .select(select)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return { memo: data, error };
}

const ALLOWED_PRIORITY = new Set(['low', 'medium', 'high']);

/** @param {unknown} body */
function normalizeUpdateBody(body) {
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
  const id = req.query.id;
  if (typeof id !== 'string' || !id) {
    return res.status(400).json({ message: 'Invalid memo id' });
  }

  const auth = await requireAdminUser(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { memo, error } = await selectMemoRow(auth.admin, id, MEMO_DETAIL_SELECT);
    if (error) {
      console.error('[company-memos] GET:', error);
      return res.status(500).json({ message: 'Failed to load memo' });
    }
    if (!memo) {
      return res.status(404).json({ message: 'Memo not found' });
    }
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json(memo);
  }

  if (req.method === 'PATCH') {
    const parsed = normalizeUpdateBody(req.body);
    if (parsed?.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const { memo: existing, error: gateErr } = await selectMemoRow(
      auth.admin,
      id
    );
    if (gateErr) {
      console.error('[company-memos] PATCH gate:', gateErr);
      return res.status(500).json({ message: 'Failed to load memo' });
    }
    if (!existing) {
      return res.status(404).json({ message: 'Memo not found' });
    }
    if (!canMutateCompanyMemo(existing, auth.uid)) {
      return res.status(403).json({
        message:
          'Only the memo creator can edit this memo ("Only I can modify" is enabled).',
      });
    }

    const folderGate = assertUpdateLogsMemoAccess({
      email: auth.email,
      requestedFolder: parsed.row.folder,
      existingFolder: existing.folder,
    });
    if (folderGate?.error) {
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.MEMO_UPDATE,
        category: AUDIT_CATEGORIES.MEMO,
        entityType: 'company_memo',
        entityId: id,
        entityLabel: existing.subject,
        description: 'Company memo update denied (Update Logs restriction)',
        details: { reason: folderGate.error },
        status: AUDIT_STATUS.FAILURE,
        source: AUDIT_SOURCE.PORTAL,
      });
      return res.status(403).json({ message: folderGate.error });
    }

    const beforeSnapshot = memoAuditSnapshot(existing);

    const { data, error } = await auth.admin
      .from('company_memos')
      .update(parsed.row)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      console.error('[company-memos] update:', error);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.MEMO_UPDATE,
        category: AUDIT_CATEGORIES.MEMO,
        entityType: 'company_memo',
        entityId: id,
        entityLabel: existing.subject,
        description: 'Failed to update company memo',
        details: { error: error.message, code: error.code },
        status: AUDIT_STATUS.FAILURE,
        source: AUDIT_SOURCE.PORTAL,
      });
      return res.status(400).json({
        message: error.message || 'Failed to update memo',
        code: error.code,
      });
    }
    if (!data) {
      return res.status(404).json({ message: 'Memo not found' });
    }

    const afterSnapshot = memoAuditSnapshot(data);
    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.MEMO_UPDATE,
      category: AUDIT_CATEGORIES.MEMO,
      entityType: 'company_memo',
      entityId: data.id,
      entityLabel: data.subject,
      description: `Updated company memo: ${data.subject}`,
      details: afterSnapshot,
      changes: buildChanges(beforeSnapshot, afterSnapshot),
      status: AUDIT_STATUS.SUCCESS,
      source: AUDIT_SOURCE.PORTAL,
    });

    await invalidateHeaderTickerMemoCache();
    invalidateListCache('dashboard-bootstrap:');

    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { memo: existing, error: gateErr } = await selectMemoRow(
      auth.admin,
      id
    );
    if (gateErr) {
      console.error('[company-memos] DELETE gate:', gateErr);
      return res.status(500).json({ message: 'Failed to load memo' });
    }
    if (!existing) {
      return res.status(404).json({ message: 'Memo not found' });
    }
    if (!canMutateCompanyMemo(existing, auth.uid)) {
      return res.status(403).json({
        message:
          'Only the memo creator can delete this memo ("Only I can modify" is enabled).',
      });
    }

    const folderGate = assertUpdateLogsMemoAccess({
      email: auth.email,
      existingFolder: existing.folder,
    });
    if (folderGate?.error) {
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.MEMO_DELETE,
        category: AUDIT_CATEGORIES.MEMO,
        entityType: 'company_memo',
        entityId: id,
        entityLabel: existing.subject,
        description: 'Company memo delete denied (Update Logs restriction)',
        details: { reason: folderGate.error },
        status: AUDIT_STATUS.FAILURE,
        source: AUDIT_SOURCE.PORTAL,
      });
      return res.status(403).json({ message: folderGate.error });
    }

    const { data, error } = await auth.admin
      .from('company_memos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      console.error('[company-memos] soft delete:', error);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.MEMO_DELETE,
        category: AUDIT_CATEGORIES.MEMO,
        entityType: 'company_memo',
        entityId: id,
        entityLabel: existing.subject,
        description: 'Failed to delete company memo',
        details: { error: error.message, code: error.code },
        status: AUDIT_STATUS.FAILURE,
        source: AUDIT_SOURCE.PORTAL,
      });
      return res.status(400).json({
        message: error.message || 'Failed to delete memo',
        code: error.code,
      });
    }
    if (!data) {
      return res.status(404).json({ message: 'Memo not found' });
    }

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.MEMO_DELETE,
      category: AUDIT_CATEGORIES.MEMO,
      entityType: 'company_memo',
      entityId: id,
      entityLabel: existing.subject,
      description: `Deleted company memo: ${existing.subject}`,
      details: memoAuditSnapshot(existing),
      status: AUDIT_STATUS.SUCCESS,
      source: AUDIT_SOURCE.PORTAL,
    });

    await invalidateHeaderTickerMemoCache();
    invalidateListCache('dashboard-bootstrap:');

    return res.status(200).json(data);
  }

  return res.status(405).json({ message: 'Method not allowed' });
}
