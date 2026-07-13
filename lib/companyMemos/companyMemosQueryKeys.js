export const COMPANY_MEMOS_LIST_STALE_MS = 30 * 1000;
export const COMPANY_MEMOS_DETAIL_STALE_MS = 15 * 1000;

export const COMPANY_MEMOS_SUMMARY_LIST_PARAMS = {
  page: 1,
  limit: 100,
  search: '',
  folder: 'all',
  priority: 'all',
};

export const COMPANY_MEMOS_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
};

/**
 * @param {{ page?: number, limit?: number, search?: string, folder?: string, priority?: string }} params
 */
export function companyMemosListQueryKey({
  page = 1,
  limit = 25,
  search = '',
  folder = 'all',
  priority = 'all',
} = {}) {
  return ['company-memos', 'admin', 'list', page, limit, search, folder, priority];
}

/** @param {string} id */
export function companyMemoDetailQueryKey(id) {
  return ['company-memos', 'admin', id];
}

/**
 * @param {{ page: number, limit: number, search?: string, folder?: string, priority?: string }} params
 */
export async function fetchCompanyMemosListSummary(params) {
  const urlParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.search) urlParams.set('search', params.search);
  if (params.folder && params.folder !== 'all') urlParams.set('folder', params.folder);
  if (params.priority && params.priority !== 'all') urlParams.set('priority', params.priority);

  const response = await fetch(`/api/company-memos/list-summary?${urlParams.toString()}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Failed to load memos (${response.status})`);
  }
  return response.json();
}

/** @param {string} id */
export async function fetchCompanyMemoById(id) {
  const response = await fetch(`/api/company-memos/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Failed to load memo (${response.status})`);
  }
  return response.json();
}
