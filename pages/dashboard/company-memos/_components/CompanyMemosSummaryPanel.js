import React, { useMemo } from 'react';
import Link from 'next/link';
import { ListGroup, Badge, Spinner } from 'react-bootstrap';
import { useQuery } from 'react-query';
import {
  COMPANY_MEMOS_LIST_STALE_MS,
  COMPANY_MEMOS_QUERY_OPTIONS,
  COMPANY_MEMOS_SUMMARY_LIST_PARAMS,
  companyMemosListQueryKey,
  fetchCompanyMemosListSummary,
} from '../../../../lib/companyMemos/companyMemosQueryKeys';

function priorityVariant(p) {
  if (p === 'high') return 'danger';
  if (p === 'low') return 'success';
  return 'warning';
}

/**
 * Sidebar list of memos for admin edit context (shares React Query cache with matching list params).
 * @param {{ currentId?: string, enabled: boolean }} props
 */
export default function CompanyMemosSummaryPanel({ currentId, enabled }) {
  const summaryQueryKey = companyMemosListQueryKey(COMPANY_MEMOS_SUMMARY_LIST_PARAMS);

  const { data: payload, isLoading } = useQuery(
    summaryQueryKey,
    () => fetchCompanyMemosListSummary(COMPANY_MEMOS_SUMMARY_LIST_PARAMS),
    {
      enabled,
      staleTime: COMPANY_MEMOS_LIST_STALE_MS,
      ...COMPANY_MEMOS_QUERY_OPTIONS,
    }
  );

  const rows = payload?.memos || [];

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      ),
    [rows]
  );

  return (
    <div
      className="card shadow-sm"
      style={{ position: 'sticky', top: '1rem' }}
    >
      <div className="card-header d-flex justify-content-between align-items-center py-3">
        <span className="fw-semibold mb-0">All memos</span>
        <Badge bg="secondary" pill className="ms-2">
          {rows.length}
        </Badge>
      </div>
      <div
        className="card-body p-0"
        style={{ maxHeight: 'min(70vh, 640px)', overflowY: 'auto' }}
      >
        {isLoading ? (
          <div className="d-flex justify-content-center py-5">
            <Spinner animation="border" size="sm" variant="primary" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted small px-3 py-4 mb-0">
            No memos yet. Create one to see it here.
          </p>
        ) : (
          <ListGroup variant="flush">
            {sorted.map((memo) => {
              const isActive = memo.id === currentId;
              return (
                <ListGroup.Item
                  key={memo.id}
                  action
                  as={Link}
                  href={`/dashboard/company-memos/${memo.id}`}
                  className={isActive ? 'bg-light fw-semibold' : ''}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <span className="text-truncate">{memo.subject}</span>
                    <Badge bg={priorityVariant(memo.priority)} pill>
                      {memo.priority || 'medium'}
                    </Badge>
                  </div>
                  <small className="text-muted d-block mt-1">
                    {memo.folder || 'General'}
                  </small>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </div>
    </div>
  );
}
