/**
 * Shared legacy portal jobs.status → SAP U_JobStatusID resolution.
 * Used by sapJobStatusResolver (sync) and scripts/backfill-wrong-statuses.mjs.
 */

/** SAP U_JobStatusID values that mean work is finished (see isJobStatusCompleted.js). */
export const SAP_COMPLETED_STATUS_IDS = ['-1', '572', '611'];

/** Explicit portal enum → SAP label keyword (normLabel contains). */
const PORTAL_ALIAS_LABEL_KEYWORDS = {
  CREATED: 'UNCONFIRMED',
  PENDING: 'UNCONFIRMED',
  UNCONFIRMED: 'UNCONFIRMED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  CANCELED: 'CANCELLED',
};

const PORTAL_IN_PROGRESS_ALIASES = new Set(['IN PROGRESS', 'INPROGRESS']);
const PORTAL_COMPLETED_ALIASES = new Set(['COMPLETED', 'JOB COMPLETE', 'JOB_COMPLETE']);

export function normLabel(x) {
  return String(x ?? '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitTokens(normalizedLabel) {
  const parts = String(normalizedLabel || '')
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function tokensContained(tokens, targetLabelNorm) {
  if (!tokens.length) return false;
  return tokens.every((t) => targetLabelNorm.includes(t));
}

/** Exact token-set equality (order-independent). Rejects strict subsets like IN+PROGRESS ⊂ QUOTATION IN PROGRESS. */
export function tokensEqual(tokens, targetLabelNorm) {
  if (!tokens.length) return false;
  const targetTokens = splitTokens(targetLabelNorm);
  if (tokens.length !== targetTokens.length) return false;
  const targetSet = new Set(targetTokens);
  return tokens.every((t) => targetSet.has(t));
}

/**
 * @param {Array<{ U_JobStatusID?: string, U_JobStatus?: string }>} sapRows
 */
export function buildSapStatusIndex(sapRows) {
  const byId = new Map();
  const byNorm = new Map();
  const byIdNorm = new Map();

  for (const r of sapRows || []) {
    const id = String(r?.U_JobStatusID ?? '').trim();
    const label = String(r?.U_JobStatus ?? '').trim();
    if (!id || !label) continue;
    byId.set(id, label);
    const n = normLabel(label);
    byIdNorm.set(id, n);
    if (!n) continue;
    const list = byNorm.get(n) || [];
    list.push(id);
    byNorm.set(n, list);
  }

  return { byId, byNorm, byIdNorm };
}

function findIdsByLabelKeyword(sapIndex, keywordNorm) {
  const matches = [];
  for (const [id, labelNorm] of sapIndex.byIdNorm.entries()) {
    if (labelNorm.includes(keywordNorm)) matches.push(id);
  }
  return matches;
}

function matchSingleId(ids, sapIndex, reason) {
  if (ids.length !== 1) return null;
  const id = ids[0];
  return {
    kind: 'matched',
    id,
    label: sapIndex.byId.get(id) || null,
    reason,
  };
}

function tryExplicitPortalAliases(normalized, sapIndex) {
  const keyword = PORTAL_ALIAS_LABEL_KEYWORDS[normalized.replace(/\s+/g, ' ')];
  if (keyword) {
    const hit = matchSingleId(findIdsByLabelKeyword(sapIndex, keyword), sapIndex, 'portal_alias');
    if (hit) return hit;
  }

  const compact = normalized.replace(/\s+/g, '');
  if (PORTAL_COMPLETED_ALIASES.has(normalized) || PORTAL_COMPLETED_ALIASES.has(compact)) {
    const existingCompleted = SAP_COMPLETED_STATUS_IDS.filter((id) => sapIndex.byId.has(id));
    if (existingCompleted.length >= 1) {
      const id = existingCompleted[0];
      return {
        kind: 'matched',
        id,
        label: sapIndex.byId.get(id) || null,
        reason: 'portal_alias_completed_id',
      };
    }
    const completedLabelIds = findIdsByLabelKeyword(sapIndex, 'COMPLETED');
    const preferredCompleted = completedLabelIds.filter((id) => SAP_COMPLETED_STATUS_IDS.includes(id));
    const hit =
      matchSingleId(preferredCompleted, sapIndex, 'portal_alias_completed_id') ||
      matchSingleId(completedLabelIds, sapIndex, 'portal_alias_completed');
    if (hit) return hit;
  }

  return null;
}

/**
 * Resolve a non-numeric legacy jobs.status to a SAP U_JobStatusID.
 *
 * @returns {{ kind: 'matched', raw: string, normalized: string, id: string, label: string|null, reason: string }
 *   | { kind: 'ambiguous', raw: string, normalized: string, candidates: string[], reason: string }
 *   | { kind: 'unknown', raw: string, normalized: string, candidates: [] }}
 */
export function resolveLegacyStatusToSapId(rawStatus, sapIndex) {
  const raw = String(rawStatus ?? '').trim();
  const normalized = normLabel(raw);
  if (!normalized) {
    return { kind: 'unknown', raw, normalized, candidates: [] };
  }

  // Portal IN_PROGRESS / "In Progress": exact SAP label "IN PROGRESS" only.
  // Never keyword-match *PROGRESS* (e.g. "Quotation in Progress") or loose token containment.
  const compact = normalized.replace(/\s+/g, '');
  if (PORTAL_IN_PROGRESS_ALIASES.has(normalized) || PORTAL_IN_PROGRESS_ALIASES.has(compact)) {
    const exactInProgress = sapIndex.byNorm.get('IN PROGRESS') || [];
    if (exactInProgress.length === 1) {
      const id = exactInProgress[0];
      return {
        kind: 'matched',
        raw,
        normalized,
        id,
        label: sapIndex.byId.get(id) || null,
        reason: 'portal_alias_in_progress',
      };
    }
    if (exactInProgress.length > 1) {
      return {
        kind: 'ambiguous',
        raw,
        normalized,
        candidates: exactInProgress,
        reason: 'portal_alias_in_progress_multi',
      };
    }
    return { kind: 'unknown', raw, normalized, candidates: [] };
  }

  const explicit = tryExplicitPortalAliases(normalized, sapIndex);
  if (explicit) {
    return { ...explicit, raw, normalized };
  }

  const exact = sapIndex.byNorm.get(normalized) || [];
  if (exact.length === 1) {
    const id = exact[0];
    return { kind: 'matched', raw, normalized, id, label: sapIndex.byId.get(id) || null, reason: 'exact_label' };
  }
  if (exact.length > 1) {
    return { kind: 'ambiguous', raw, normalized, candidates: exact, reason: 'exact_label_multi' };
  }

  const tokens = splitTokens(normalized);
  if (tokens.length) {
    const candidateIds = [];
    for (const [id, labelNorm] of sapIndex.byIdNorm.entries()) {
      if (tokensEqual(tokens, labelNorm)) candidateIds.push(id);
    }
    if (candidateIds.length === 1) {
      const id = candidateIds[0];
      return {
        kind: 'matched',
        raw,
        normalized,
        id,
        label: sapIndex.byId.get(id) || null,
        reason: 'token_set_equal',
      };
    }
    if (candidateIds.length > 1) {
      return { kind: 'ambiguous', raw, normalized, candidates: candidateIds, reason: 'token_set_equal_multi' };
    }
  }

  return { kind: 'unknown', raw, normalized, candidates: [] };
}

/**
 * Resolve legacy status to { jobStatusId, jobStatusLabel } or null when unmatched/ambiguous.
 */
export function resolveLegacyJobStatusToSap(rawStatus, sapJobStatuses) {
  const sapIndex = buildSapStatusIndex(sapJobStatuses);
  const resolved = resolveLegacyStatusToSapId(rawStatus, sapIndex);
  if (resolved.kind !== 'matched') return null;
  return { jobStatusId: resolved.id, jobStatusLabel: resolved.label || '' };
}
