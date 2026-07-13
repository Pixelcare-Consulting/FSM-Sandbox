import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Container,
  Row,
  Col,
  Button,
  Badge,
  Card,
  Form,
  Spinner,
  OverlayTrigger,
  Tooltip,
} from 'react-bootstrap';
import { Search, X as FeatherX } from 'react-feather';
import { Eye, Pencil, Trash } from 'lucide-react';
import { useQuery, useQueryClient } from 'react-query';
import Swal from 'sweetalert2';
import toast from 'react-hot-toast';
import { useEnterToSearch } from '@/hooks/useEnterToSearch';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import Cookies from 'js-cookie';
import { GeeksSEO } from 'widgets';
import { DashboardHeader } from 'sub-components';
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from 'sub-components/dashboard/DashboardListStickySearch';
import DefaultDashboardLayout from 'layouts/dashboard/DashboardIndexTop';
import TablePagination from '../../../components/common/TablePagination';
import {
  canManageUpdateLogsFolder,
  canMutateCompanyMemoWithFolder,
  memoFoldersForEmail,
} from '../../../lib/utils/companyMemoDevAccess';
import {
  COMPANY_MEMOS_LIST_STALE_MS,
  COMPANY_MEMOS_QUERY_OPTIONS,
  companyMemosListQueryKey,
  fetchCompanyMemosListSummary,
} from '../../../lib/companyMemos/companyMemosQueryKeys';
import { memoBodyToPlainText } from '../../../lib/utils/memoHtml';

function truncate(str, n) {
  if (!str) return '';
  return str.length <= n ? str : `${str.slice(0, n)}…`;
}

function normalizePriority(p) {
  if (p == null || p === '') return 'medium';
  return String(p).trim().toLowerCase();
}

function priorityVariant(p) {
  const n = normalizePriority(p);
  if (n === 'high') return 'danger';
  if (n === 'low') return 'success';
  return 'warning';
}

const MEMO_TH = {
  backgroundColor: '#f8fafc',
  fontSize: '13px',
  fontWeight: '600',
  color: '#475569',
  padding: '16px',
  borderBottom: '1px solid #e2e8f0',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
};

const MEMO_TD = {
  fontSize: '14px',
  color: '#64748b',
  padding: '16px',
  verticalAlign: 'middle',
  borderBottom: '1px solid #f1f5f9',
};

const CompanyMemosList = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const viewerUid = user?.id || user?.uid;
  const viewerEmail = user?.email || Cookies.get('email') || '';
  const canManageUpdateLogs = canManageUpdateLogsFolder(viewerEmail);
  const folderFilterOptions = useMemo(
    () => memoFoldersForEmail(viewerEmail),
    [viewerEmail]
  );
  const [allowed, setAllowed] = useState(null);
  const {
    draft: globalSearchDraft,
    setDraft: setGlobalSearchDraft,
    applied: globalSearchApplied,
    clear: clearGlobalSearch,
    onKeyDown: onGlobalSearchKeyDown,
  } = useEnterToSearch();
  /** 'all' | 'high' | 'medium' | 'low' */
  const [priorityFilter, setPriorityFilter] = useState('all');
  /** 'all' or a folder name */
  const [folderFilter, setFolderFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);

  useEffect(() => {
    if (user?.role !== 'ADMIN') {
      router.replace('/dashboard');
      setAllowed(false);
      return;
    }
    setAllowed(true);
  }, [router, user?.role]);

  useEffect(() => {
    if (!router.isReady) return;
    const raw = router.query.folder;
    const folder = Array.isArray(raw) ? raw[0] : raw;
    if (folder && folderFilterOptions.includes(folder)) {
      setFolderFilter(folder);
      setCurrentPage(1);
    }
  }, [router.isReady, router.query.folder, folderFilterOptions]);

  const listParams = {
    page: currentPage,
    limit: itemsPerPage,
    search: globalSearchApplied,
    folder: folderFilter,
    priority: priorityFilter,
  };

  const listQueryKey = companyMemosListQueryKey(listParams);

  const fetchMemos = useCallback(
    () =>
      fetchCompanyMemosListSummary({
        page: currentPage,
        limit: itemsPerPage,
        search: globalSearchApplied,
        folder: folderFilter,
        priority: priorityFilter,
      }),
    [currentPage, itemsPerPage, globalSearchApplied, folderFilter, priorityFilter]
  );

  const { data, isLoading } = useQuery(listQueryKey, fetchMemos, {
    enabled: allowed === true,
    staleTime: COMPANY_MEMOS_LIST_STALE_MS,
    keepPreviousData: true,
    ...COMPANY_MEMOS_QUERY_OPTIONS,
  });

  const rows = data?.memos || [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

  const hasActiveFilters =
    globalSearchApplied.length > 0 ||
    priorityFilter !== 'all' ||
    folderFilter !== 'all';

  const clearAllFilters = () => {
    clearGlobalSearch();
    setPriorityFilter('all');
    setFolderFilter('all');
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [globalSearchApplied, folderFilter, priorityFilter]);

  const onDelete = async (row) => {
    if (!canMutateCompanyMemoWithFolder(row, viewerUid, viewerEmail)) {
      Swal.fire(
        'Cannot delete',
        row.folder === 'Update Logs' && !canManageUpdateLogs
          ? 'Update Logs can only be deleted by @pixelcareconsulting.com developers.'
          : 'Only the memo creator can delete this memo when "Only I can modify" is enabled.',
        'info'
      );
      return;
    }
    const r = await Swal.fire({
      title: 'Delete memo?',
      text: row.subject,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc3545',
    });
    if (!r.isConfirmed) return;
    try {
      const res = await fetch(
        `/api/company-memos/${encodeURIComponent(row.id)}`,
        { method: 'DELETE', credentials: 'same-origin' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || res.statusText || 'Failed to delete');
      }
      await queryClient.invalidateQueries(['company-memos']);
      toast.success('Memo removed');
    } catch (e) {
      Swal.fire('Error', e.message || 'Failed to delete', 'error');
    }
  };

  if (allowed !== true) {
    return (
      <Container className="py-5">
        <p className="text-muted">Checking access…</p>
      </Container>
    );
  }

  return (
    <Container className="mt-1 mb-6">
      <GeeksSEO title="Company memos | SAS&ME Portal" />
      <DashboardHeader
        title="Company memos"
        subtitle="Announcements for the portal header ticker and sign-in."
        breadcrumbs={[
          { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
          { label: 'Company memos' },
        ]}
        rightAction={
          <Button as={Link} href="/dashboard/company-memos/new" variant="outline-light">
            Add memo
          </Button>
        }
      />
      <Row>
        <Col xs={12}>
          <DashboardListStickySearch style={STICKY_SEARCH_GRADIENT_BLUE}>
              <Row className="align-items-center">
                <Col md={12}>
                  <div className="d-flex align-items-center gap-3 flex-wrap">
                    <div style={{ minWidth: '140px' }}>
                      <h6 className="mb-0 text-white d-flex align-items-center">
                        <Search className="me-2" size={18} />
                        🌐 Global Search
                      </h6>
                      <small
                        className="text-white"
                        style={{ opacity: 0.9, fontSize: '0.75rem' }}
                      >
                        Press Enter to search
                      </small>
                    </div>
                    <div className="flex-grow-1" style={{ minWidth: 200 }}>
                      <Form.Control
                        type="text"
                        value={globalSearchDraft}
                        onChange={(e) => setGlobalSearchDraft(e.target.value)}
                        onKeyDown={onGlobalSearchKeyDown}
                        placeholder="🔍 Search anything… Subject, Content, Priority, Expires, From, Header, Sign-in, etc."
                        style={{
                          fontSize: '0.95rem',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400',
                        }}
                        autoComplete="off"
                      />
                    </div>
                    <div
                      className="d-flex align-items-center gap-2 flex-shrink-0"
                      style={{ minWidth: 0 }}
                    >
                      <label
                        htmlFor="company-memos-folder-filter"
                        className="text-white small mb-0 text-nowrap d-none d-sm-inline"
                        style={{ opacity: 0.95 }}
                      >
                        Folder
                      </label>
                      <Form.Select
                        id="company-memos-folder-filter"
                        size="sm"
                        value={folderFilter}
                        onChange={(e) => {
                          setFolderFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        aria-label="Filter by folder"
                        style={{
                          minWidth: 150,
                          maxWidth: 200,
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: 500,
                        }}
                      >
                        <option value="all">All folders</option>
                        {folderFilterOptions.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </Form.Select>
                      <label
                        htmlFor="company-memos-priority-filter"
                        className="text-white small mb-0 text-nowrap d-none d-sm-inline"
                        style={{ opacity: 0.95 }}
                      >
                        Priority
                      </label>
                      <Form.Select
                        id="company-memos-priority-filter"
                        size="sm"
                        value={priorityFilter}
                        onChange={(e) => {
                          setPriorityFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        aria-label="Filter by priority"
                        style={{
                          minWidth: 150,
                          maxWidth: 200,
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: 500,
                        }}
                      >
                        <option value="all">All priorities</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </Form.Select>
                    </div>
                    {hasActiveFilters ? (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={clearAllFilters}
                        className="d-flex align-items-center gap-1"
                        style={{
                          minWidth: '90px',
                          fontWeight: '500',
                          borderRadius: '6px',
                        }}
                      >
                        <FeatherX size={14} />
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                  {hasActiveFilters ? (
                    <div
                      className="mt-2 text-white d-flex align-items-center gap-2 flex-wrap"
                      style={{ opacity: 0.95 }}
                    >
                      <small style={{ fontSize: '0.85rem' }}>
                        ✓ Showing <strong>{rows.length}</strong> of{' '}
                        <strong>{totalCount}</strong> memos
                        {folderFilter !== 'all' ? (
                          <>
                            {' '}
                            · Folder: <strong>{folderFilter}</strong>
                          </>
                        ) : null}
                        {priorityFilter !== 'all' ? (
                          <>
                            {' '}
                            · Priority:{' '}
                            <strong className="text-capitalize">{priorityFilter}</strong>
                          </>
                        ) : null}
                        {globalSearchApplied ? (
                          <>
                            {' '}
                            · Search: <strong>{globalSearchApplied}</strong>
                          </>
                        ) : null}
                      </small>
                    </div>
                  ) : (
                    <div
                      className="mt-2 text-white d-flex align-items-center gap-2"
                      style={{ opacity: 0.85 }}
                    >
                      <small style={{ fontSize: '0.8rem' }}>
                        💡 <strong>Tip:</strong> Press Enter to search across Subject,
                        Content, Priority, expiry dates, author, header ticker, sign-in banner, and
                        more!
                      </small>
                    </div>
                  )}
                </Col>
              </Row>
          </DashboardListStickySearch>

          <Card className="border-0 shadow-sm company-memos-list-table">
            <Card.Body className="p-4">
              {isLoading ? (
                <div className="text-center py-5 text-muted">
                  <Spinner animation="border" variant="primary" className="me-2" />
                  Loading memos…
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover mb-0 align-middle">
                    <thead>
                      <tr>
                        <th
                          style={{
                            ...MEMO_TH,
                            width: 56,
                            textAlign: 'center',
                          }}
                        >
                          #
                        </th>
                        <th style={MEMO_TH}>Subject</th>
                        <th style={MEMO_TH}>Folder</th>
                        <th style={{ ...MEMO_TH, minWidth: 220 }}>Content</th>
                        <th style={MEMO_TH}>Priority</th>
                        <th style={MEMO_TH}>Expires</th>
                        <th style={MEMO_TH}>From</th>
                        <th style={{ ...MEMO_TH, width: 168 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totalCount === 0 && !hasActiveFilters ? (
                        <tr>
                          <td colSpan={9} style={{ ...MEMO_TD }} className="text-center py-5 text-muted">
                            No memos yet.{' '}
                            <Link href="/dashboard/company-memos/new">Create one</Link>.
                          </td>
                        </tr>
                      ) : rows.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ ...MEMO_TD }} className="text-center py-5 text-muted">
                            No memos match your filters.{' '}
                            <Button
                              variant="link"
                              className="p-0 align-baseline"
                              onClick={clearAllFilters}
                            >
                              Clear filters
                            </Button>
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, rowIndex) => {
                          const rowCanMutate = canMutateCompanyMemoWithFolder(
                            row,
                            viewerUid,
                            viewerEmail
                          );
                          return (
                          <tr
                            key={row.id}
                            className="memo-table-row"
                            style={{ transition: 'all 0.2s ease' }}
                          >
                            <td
                              style={{
                                ...MEMO_TD,
                                width: 56,
                                textAlign: 'center',
                                color: '#94a3b8',
                                fontWeight: 600,
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {rowIndex + 1 + (currentPage - 1) * itemsPerPage}
                            </td>
                            <td style={{ ...MEMO_TD, color: '#0f172a', fontWeight: 600 }}>
                              {row.subject}
                            </td>
                            <td style={MEMO_TD}>
                              <Badge bg="light" text="dark" className="fw-normal">
                                {row.folder || 'General'}
                              </Badge>
                            </td>
                            <td style={MEMO_TD}>
                              <span className="d-inline-block" style={{ maxWidth: 420 }}>
                                {truncate(memoBodyToPlainText(row.body), 100)}
                              </span>
                            </td>
                            <td style={MEMO_TD}>
                              <Badge
                                bg={priorityVariant(row.priority)}
                                className="text-capitalize px-2 py-1 rounded-pill fw-medium"
                                style={{ fontSize: '12px' }}
                              >
                                {normalizePriority(row.priority)}
                              </Badge>
                            </td>
                            <td style={MEMO_TD}>
                              {row.expires_at
                                ? new Date(row.expires_at).toLocaleDateString()
                                : '—'}
                            </td>
                            <td style={MEMO_TD}>
                              <span className="text-break" style={{ maxWidth: 260 }}>
                                {row.creator?.username || row.created_by || '—'}
                              </span>
                            </td>
                       
                            <td style={MEMO_TD}>
                              <div className="d-flex flex-wrap gap-2 align-items-center">
                                
                                  <span className="d-inline-block">
                                    <OverlayTrigger
                                      placement="top"
                                      overlay={
                                        <Tooltip id={`memo-edit-${row.id}`}>
                                          {rowCanMutate ? (
                                            <span>Edit memo</span>
                                          ) : (
                                            <span>View memo (creator-only edits)</span>
                                          )}
                                        </Tooltip>
                                      }
                                    >
                                      <span className="d-inline-block">
                                        <Button
                                          as={Link}
                                          href={`/dashboard/company-memos/${row.id}`}
                                          size="sm"
                                          variant={rowCanMutate ? undefined : 'outline-secondary'}
                                          className={`memo-action-btn d-inline-flex align-items-center ${rowCanMutate ? 'memo-action-btn-primary' : ''}`}
                                        >
                                          {rowCanMutate ? (
                                            <Pencil size={14} className="me-1" aria-hidden />
                                          ) : (
                                            <Eye size={14} className="me-1" aria-hidden />
                                          )}
                                          {rowCanMutate ? 'Edit' : 'View'}
                                        </Button>
                                      </span>
                                    </OverlayTrigger>
                                  </span>

                                <OverlayTrigger
                                  placement="left"
                                  overlay={
                                    <Tooltip id={`memo-del-${row.id}`}>
                                      {rowCanMutate ? (
                                        <strong>Delete memo</strong>
                                      ) : (
                                        <>Only the creator can delete this memo</>
                                      )}
                                    </Tooltip>
                                  }
                                >
                                  <span className="d-inline-block">
                                    <Button
                                      size="sm"
                                      onClick={() => onDelete(row)}
                                      disabled={!rowCanMutate}
                                      className="memo-action-btn memo-action-btn-danger d-inline-flex align-items-center justify-content-center"
                                      aria-label={`Delete ${row.subject || 'memo'}`}
                                    >
                                      <Trash size={14} aria-hidden />
                                    </Button>
                                  </span>
                                </OverlayTrigger>
                              </div>
                            </td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Card.Body>
            {totalCount > 0 ? (
              <div className="border-top">
                <TablePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalCount}
                  onPageChange={setCurrentPage}
                  disabled={isLoading}
                />
              </div>
            ) : null}
          </Card>
          <style jsx global>{`
            .company-memos-list-table .memo-table-row:hover {
              background-color: #f8fafc;
              box-shadow: inset 0 1px 0 #e2e8f0;
            }
            .company-memos-list-table .memo-action-btn {
              font-weight: 500;
              font-size: 0.875rem;
              padding: 0.5rem 0.875rem;
              border-radius: 6px;
              border: none;
              transition: all 0.2s ease;
            }
            .company-memos-list-table .memo-action-btn-primary {
              background-color: #3b82f6;
              color: #fff;
              box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
            }
            .company-memos-list-table .memo-action-btn-primary:hover {
              background-color: #2563eb;
              color: #fff;
              transform: translateY(-1px);
              box-shadow: 0 4px 6px rgba(59, 130, 246, 0.25);
            }
            .company-memos-list-table .memo-action-btn-danger {
              background-color: #fee2e2;
              color: #dc2626;
              min-width: 2.5rem;
              padding: 0.5rem;
              box-shadow: 0 2px 4px rgba(220, 38, 38, 0.12);
            }
            .company-memos-list-table .memo-action-btn-danger:hover {
              background-color: #dc2626;
              color: #fff;
              transform: translateY(-1px);
              box-shadow: 0 4px 6px rgba(220, 38, 38, 0.2);
            }
          `}</style>
        </Col>
      </Row>
    </Container>
  );
};

CompanyMemosList.Layout = DefaultDashboardLayout;
export default CompanyMemosList;
