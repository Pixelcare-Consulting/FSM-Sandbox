import React, { Fragment, useMemo, useState, useEffect } from 'react';
import { Col, Row, Card, Button, OverlayTrigger, Tooltip, Badge, Spinner, Form, Modal } from 'react-bootstrap';
import { useRouter } from 'next/router';
import { 
  Eye, 
  EnvelopeFill, 
  GeoAltFill, 
  HouseFill, 
  CheckCircleFill,
  XLg,
  FilterCircle,
  ListUl,
  PersonFill,
  ChatLeftTextFill
} from 'react-bootstrap-icons';
import { GeeksSEO } from 'widgets'
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_PURPLE,
} from 'sub-components/dashboard/DashboardListStickySearch';
import { 
  Search, 
  X as FeatherX,
  RefreshCw
} from 'react-feather';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper
} from '@tanstack/react-table'
import toast from 'react-hot-toast';
import { TABLE_CONFIG } from 'constants/tableConfig';
import Link from 'next/link';
import { textMatchesAllSearchTokens } from '../../../lib/utils/multiTokenSearch';
import {
  listRowFromSupabaseSapLead,
} from '../../../lib/leads/supabaseLeadSapShim';
import TablePagination from '../../../components/common/TablePagination';
import { ExtensionFriendlyPhone } from '../../../components/common/ExtensionFriendlyPhone';
import SapDeltaSyncPreviewModal from '../../../components/customers/SapDeltaSyncPreviewModal';
import { useSapDeltaSync } from '../../../hooks/useSapDeltaSync';
import { useEnterToSearch } from '../../../hooks/useEnterToSearch';
import { useLeadsListQuery } from '../../../hooks/queries/useLeadsListQuery';


const TOAST_STYLES = {
  BASE: {
    borderRadius: '12px',
    padding: '12px 16px',
    fontSize: '14px',
    maxWidth: '400px',
  },
  SUCCESS: {
    background: '#f0fdf4',
    color: '#166534',
    border: '1px solid #86efac',
  },
  ERROR: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
  },
  LOADING: {
    background: '#f0f9ff',
    color: '#075985',
    border: '1px solid #7dd3fc',
  }
};

const copyToClipboard = (text, successMessage = 'Copied!') => {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      textArea.remove();
      alert(successMessage);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy text');
      textArea.remove();
    }
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    alert(successMessage);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
    alert('Failed to copy text');
  });
};

const formatLeadAddress = (lead) => {
  const composed = String(lead.Address || '').trim();
  if (composed) return composed;

  const parts = [
    lead.Street,
    lead.Building || lead.BillToBuildingFloorRoom,
    lead.City,
    lead.Country === 'SG' ? 'Singapore' : lead.Country,
    lead.ZipCode
  ].filter(part => part && String(part).trim());
  return parts.length > 0 ? parts.join(', ') : null;
};

const ViewLeads = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();
  const [perPage, setPerPage] = useState(TABLE_CONFIG.PAGE_SIZES.DEFAULT);
  const [initialLoad, setInitialLoad] = useState(true);
  
  const {
    draft: globalSearchDraft,
    setDraft: setGlobalSearchDraft,
    applied: globalSearchApplied,
    clear: clearGlobalSearch,
    applyValue: applyGlobalSearchValue,
    onKeyDown: onGlobalSearchKeyDown,
  } = useEnterToSearch();

  const leadsQueryParams = useMemo(
    () => ({
      page: currentPage,
      limit: perPage,
      search: globalSearchApplied || '',
    }),
    [currentPage, perPage, globalSearchApplied]
  );

  const {
    data: leadsData,
    isLoading: leadsLoading,
    isFetching: leadsFetching,
    error: leadsQueryError,
    refetch: refetchLeads,
  } = useLeadsListQuery(leadsQueryParams);

  const rawData = leadsData?.leads || [];
  const data = rawData;
  const totalRows = leadsData?.totalCount ?? rawData.length;

  useEffect(() => {
    setLoading(leadsLoading || leadsFetching);
    if (leadsQueryError) {
      setError(leadsQueryError.message || 'Failed to load leads. Please try again.');
    } else if (leadsData) {
      setError(null);
    }
  }, [leadsLoading, leadsFetching, leadsQueryError, leadsData]);

  useEffect(() => {
    if (leadsData && !leadsFetching) {
      setInitialLoad(false);
    }
  }, [leadsData, leadsFetching]);

  useEffect(() => {
    if (globalSearchApplied && data.length > 0) {
      const filteredPages = Math.ceil(data.length / perPage);
      if (currentPage > filteredPages && filteredPages > 0) {
        setCurrentPage(1);
      }
    } else if (!globalSearchApplied) {
      const totalPages = Math.ceil(totalRows / perPage);
      if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(1);
      }
    }
  }, [globalSearchApplied, data.length, perPage, currentPage, totalRows]);

  const columnHelper = createColumnHelper();

  const columns = [
    columnHelper.accessor((row, index) => (currentPage - 1) * perPage + index + 1, {
      id: 'index',
      header: '#',
      size: 50,
    }),
    columnHelper.accessor('CardCode', {
      header: 'Code',
      size: 100,
      enableSorting: true,
      sortingFn: (rowA, rowB) => {
        const codeA = (rowA.original.CardCode || '').toUpperCase();
        const codeB = (rowB.original.CardCode || '').toUpperCase();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      },
      cell: info => {
        const code = info.getValue();
        return (
          <OverlayTrigger
            placement="top"
            overlay={<Tooltip>Click to copy lead code</Tooltip>}
          >
            <div
              style={{ fontWeight: 'bold', cursor: 'pointer' }}
              onClick={() => copyToClipboard(code, 'Lead code copied!')}
            >
              {code}
            </div>
          </OverlayTrigger>
        );
      }
    }),
    columnHelper.accessor('CardName', {
      header: 'Lead Name',
      size: 200,
      cell: info => (
        <div className="d-flex align-items-center">
          {info.getValue()}
        </div>
      )
    }),
    columnHelper.accessor('primaryAddress', {
      header: 'Address Information',
      size: 350,
      cell: info => {
        const row = info.row.original;
        const address = formatLeadAddress(row);
        
        if (!address) {
          return <div className="text-muted">-</div>;
        }

        return (
          <div className="d-flex align-items-start">
            <HouseFill className="me-2 flex-shrink-0 mt-1" style={{ color: '#6B7280' }} />
            <OverlayTrigger
              placement="top"
              overlay={<Tooltip>Click to copy address</Tooltip>}
            >
              <div
                onClick={() => copyToClipboard(address, 'Address copied!')}
                style={{ cursor: 'pointer' }}
                className="text-break"
              >
                <div style={{ fontWeight: '500', color: '#3B82F6' }}>
                  {address}
                </div>
              </div>
            </OverlayTrigger>
          </div>
        );
      }
    }),
    columnHelper.accessor('Phone1', {
      header: 'Phone',
      size: 120,
      cell: info => {
        const phoneValue = info.getValue();
        const cleanedPhone = phoneValue ? phoneValue.replace(/^65-000-\s*/, '') : '';
        if (!cleanedPhone) return <span className="text-muted">-</span>;
        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                Yeastar Linkus: hover the number, then click the extension popup to dial
              </Tooltip>
            }
          >
            <span>
              <ExtensionFriendlyPhone raw={phoneValue} />
            </span>
          </OverlayTrigger>
        );
      }
    }),
    columnHelper.accessor('EmailAddress', {
      header: 'Email',
      size: 200,
      cell: info => {
        const email = info.getValue();
        if (!email) return <span className="text-muted">-</span>;
        return (
          <OverlayTrigger
            placement="top"
            overlay={<Tooltip>Click to send email</Tooltip>}
          >
            <a href={`mailto:${email}`} className="text-decoration-none">
              <EnvelopeFill className="me-2" />
              {email}
            </a>
          </OverlayTrigger>
        );
      }
    }),
    columnHelper.accessor('ContactPerson', {
      header: 'Contact Person',
      size: 150,
      cell: info => {
        const contact = info.getValue();
        if (!contact) return <span className="text-muted">-</span>;
        return (
          <div className="d-flex align-items-center">
            <PersonFill className="me-2" style={{ color: '#6B7280' }} />
            {contact}
          </div>
        );
      }
    }),
    columnHelper.accessor(() => null, {
      id: 'actions',
      header: 'Actions',
      size: 130,
      cell: info => (
        <div className="d-flex gap-2">
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>
                View complete details for lead #{info.row.original.CardCode}
              </Tooltip>
            }
          >
            <Link
              href={`/leads/view/${encodeURIComponent(info.row.original.CardCode)}`}
              className="btn btn-primary btn-icon-text btn-sm"
              style={{ textDecoration: "none" }}
            >
              <Eye size={14} className="icon-left" />
              View
            </Link>
          </OverlayTrigger>
        </div>
      )
    }),
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      sorting: [{ id: 'CardCode', desc: false }],
    },
    state: {
      pagination: {
        pageIndex: currentPage - 1,
        pageSize: perPage,
      },
    },
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil((totalRows || 0) / perPage)),
    onPaginationChange: updater => {
      if (typeof updater === 'function') {
        const newPagination = updater({ pageIndex: currentPage - 1, pageSize: perPage });
        setCurrentPage(newPagination.pageIndex + 1);
        if (newPagination.pageSize !== perPage) {
          setPerPage(newPagination.pageSize);
        }
      }
    },
  });

  const {
    syncCode: syncLeadCode,
    setSyncCode: setSyncLeadCode,
    isSyncingDelta,
    syncDeltaError,
    syncDeltaSummary,
    previewModal,
    openSyncPreview,
    closePreviewModal,
    confirmSyncFromPreview,
  } = useSapDeltaSync({
    toastStyles: TOAST_STYLES,
    onSyncSuccess: async ({ summary, normalizedCode, loadingToastId }) => {
      const summaryErrors = Array.isArray(summary.errors) ? summary.errors : [];
      const leadsWritten =
        (summary.counts?.masterlistLeadsInserted || 0) +
        (summary.counts?.masterlistLeadsUpdated || 0);

      if (normalizedCode && leadsWritten === 0) {
        const detail =
          summaryErrors[0] ||
          `No lead row was written for ${normalizedCode}. Verify the CardCode (e.g. L004466).`;
        throw new Error(detail);
      }

      const successDetail = normalizedCode
        ? `SAP sync: ${normalizedCode} (${leadsWritten} masterlist row${leadsWritten === 1 ? '' : 's'})`
        : 'SAP delta sync completed';
      toast.success(successDetail, {
        id: loadingToastId,
        style: {
          ...TOAST_STYLES.BASE,
          ...TOAST_STYLES.SUCCESS,
        },
      });
      if (summaryErrors.length > 0) {
        toast.error(summaryErrors.slice(0, 2).join(' · '), { duration: 8000 });
      }

      setCurrentPage(1);
      await refetchLeads();
      if (normalizedCode) {
        applyGlobalSearchValue(normalizedCode);
      }
    },
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [globalSearchApplied, perPage]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handlePerRowsChange = (newPerPage) => {
    setPerPage(newPerPage);
    setCurrentPage(1);
    toast.success(
      <div>
        <div className="fw-bold">View Updated</div>
        <small>Now showing {newPerPage} entries per page</small>
      </div>,
      {
        duration: 3000,
        style: { ...TOAST_STYLES.BASE, ...TOAST_STYLES.SUCCESS }
      }
    );
  };

  return (
    <Fragment>
      <SapDeltaSyncPreviewModal
        show={previewModal.show}
        onHide={closePreviewModal}
        preview={previewModal.preview}
        loading={previewModal.loading}
        error={previewModal.error}
        onConfirm={confirmSyncFromPreview}
        confirming={isSyncingDelta}
        entityFilter="lead"
      />
      <GeeksSEO title="SAP Leads Masterlist | SAS&ME Portal" />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div 
            style={{
              background: 'linear-gradient(90deg, #7C3AED 0%, #A78BFA 100%)',
              padding: '1.5rem 2rem',
              borderRadius: '0 0 24px 24px',
              marginTop: '-39px',
              marginLeft: '10px',
              marginRight: '10px',
              marginBottom: '20px'
            }}
          >
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1 
                    className="mb-2" 
                    style={{ 
                      fontSize: '28px',
                      fontWeight: '600',
                      color: '#FFFFFF',
                      letterSpacing: '-0.02em'
                    }}
                  >
                    SAP Leads Masterlist
                  </h1>
                  <p 
                    className="mb-2" 
                    style={{ 
                      fontSize: '16px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontWeight: '400',
                      lineHeight: '1.5'
                    }}
                  >
                    Leads tagged <strong>SAP Lead</strong> in the Excel masterlist, loaded from Supabase (no SAP session required for this list).
                  </p>
                 
                </div>

                <div className="d-flex align-items-center gap-2 mb-4">
                  <span 
                    className="badge" 
                    style={{ 
                      background: '#FFFFFF',
                      color: '#7C3AED',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontWeight: '500',
                      fontSize: '14px'
                    }}
                  >
                    Lead Management
                  </span>
                  <span 
                    className="badge" 
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.2)',
                      color: '#FFFFFF',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontWeight: '500',
                      fontSize: '14px'
                    }}
                  >
                    <i className="fe fe-eye me-1"></i>
                    View Only
                  </span>
                </div>

                <nav style={{ fontSize: '14px', fontWeight: '500' }}>
                  <div className="d-flex align-items-center">
                    <i className="fe fe-home" style={{ color: 'rgba(255, 255, 255, 0.7)' }}></i>
                    <Link 
                      href="/dashboard" 
                      className="text-decoration-none ms-2" 
                      style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                    >
                      Dashboard
                    </Link>
                    <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>/</span>
                    <i className="fe fe-target" style={{ color: '#FFFFFF' }}></i>
                    <span className="ms-2" style={{ color: '#FFFFFF' }}>
                      Leads
                    </span>
                  </div>
                </nav>
              </div>

              <div
                style={{
                  width: '100%',
                  maxWidth: '380px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  borderRadius: '10px',
                  padding: '12px',
                }}
              >
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span style={{ color: '#FFFFFF', fontWeight: 600, fontSize: '14px' }}>
                    Sync from SAP
                  </span>
                  {isSyncingDelta && (
                    <span className="d-flex align-items-center" style={{ color: '#FFFFFF', fontSize: '12px' }}>
                      <Spinner animation="border" size="sm" className="me-1" />
                      Running
                    </span>
                  )}
                </div>
                <div className="d-flex gap-2">
                  <Form.Control
                    value={syncLeadCode}
                    onChange={(e) => setSyncLeadCode(String(e.target.value || '').toUpperCase())}
                    placeholder="SAP CardCode e.g. L004466"
                    size="sm"
                    disabled={isSyncingDelta}
                  />
                  <Button
                    variant="light"
                    size="sm"
                    onClick={openSyncPreview}
                    disabled={isSyncingDelta}
                    className="d-flex align-items-center gap-1"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {isSyncingDelta ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Sync
                  </Button>
                </div>
                <small className="d-block mt-2" style={{ color: 'rgba(255, 255, 255, 0.88)', display: 'none' }}>
                  Enter an SAP L code to sync one lead. Leave blank to sync customers/leads changed in the last 14 days.
                </small>
                {syncDeltaError && (
                  <small className="d-block mt-1" style={{ color: '#FCA5A5' }}>
                    {syncDeltaError}
                  </small>
                )}
                {syncDeltaSummary && (
                  <small className="d-block mt-1" style={{ color: 'rgba(255, 255, 255, 0.92)' }}>
                    SAP hits: {syncDeltaSummary?.counts?.sapHits || 0}, DB written:{' '}
                    {(syncDeltaSummary?.counts?.masterlistLeadsInserted || 0) +
                      (syncDeltaSummary?.counts?.masterlistLeadsUpdated || 0)}
                    {Array.isArray(syncDeltaSummary.errors) && syncDeltaSummary.errors.length > 0 && (
                      <span className="d-block mt-1" style={{ color: '#FCA5A5' }}>
                        {syncDeltaSummary.errors[0]}
                      </span>
                    )}
                  </small>
                )}
              </div>
            </div>
          </div>
        </Col>
      </Row>

      <Row>
        <Col md={12} xs={12} className="mb-5">
          {/* Global Search */}
          <DashboardListStickySearch style={STICKY_SEARCH_GRADIENT_PURPLE}>
              <Row className="align-items-center">
                <Col md={12}>
                  <div className="d-flex align-items-center gap-3">
                    <div style={{ minWidth: '140px' }}>
                      <h6 className="mb-0 text-white d-flex align-items-center">
                        <Search className="me-2" size={18} />
                        Global Search
                      </h6>
                      <small className="text-white" style={{ opacity: 0.9, fontSize: '0.75rem' }}>
                        Press Enter to search
                      </small>
                    </div>
                    <div className="flex-grow-1">
                      <Form.Control
                        type="text"
                        value={globalSearchDraft}
                        onChange={(e) => setGlobalSearchDraft(e.target.value)}
                        onKeyDown={onGlobalSearchKeyDown}
                        placeholder="Search anything... Lead Code, Name, Email, Phone, Address, Contact Person, etc."
                        style={{ 
                          fontSize: '0.95rem', 
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400'
                        }}
                        autoComplete="off"
                      />
                    </div>
                    {(globalSearchDraft || globalSearchApplied) && (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={() => {
                          clearGlobalSearch();
                          setCurrentPage(1);
                        }}
                        className="d-flex align-items-center gap-1"
                        style={{ minWidth: '90px', fontWeight: '500', borderRadius: '6px' }}
                      >
                        <FeatherX size={14} />
                        Clear
                      </Button>
                    )}
                  </div>
                  {globalSearchApplied ? (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.95 }}>
                      <FilterCircle size={14} />
                      <small style={{ fontSize: '0.85rem' }}>
                        Found <strong>{data.length}</strong> of <strong>{rawData.length}</strong> loaded leads
                      </small>
                    </div>
                  ) : (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.85 }}>
                      <small style={{ fontSize: '0.8rem' }}>
                        <strong>Tip:</strong> Press Enter to search across Lead Code, Name, Email, Phone, Address, Contact Person, Notes, and more!
                      </small>
                    </div>
                  )}
                </Col>
              </Row>
          </DashboardListStickySearch>

          <Card className="border-0 shadow-sm">
            <Card.Body className="p-4">
              {error && <div className="alert alert-danger mb-4">{error}</div>}
              
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center">
                  <span className="text-muted me-2">Show:</span>
                  <div className="position-relative" style={{ width: '90px' }}>
                    <Form.Select
                      size="sm"
                      value={perPage}
                      onChange={(e) => handlePerRowsChange(Number(e.target.value))}
                      className="me-2"
                      disabled={loading}
                    >
                      {TABLE_CONFIG.PAGE_SIZES.OPTIONS.map(size => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </Form.Select>
                  </div>
                  <span className="text-muted">entries per page</span>
                </div>
                <div className="text-muted">
                  <ListUl size={14} className="me-2" />
                  {loading ? (
                    <small>Loading...</small>
                  ) : globalSearchApplied ? (
                    `Showing ${data.length} of ${totalRows} leads (filtered)`
                  ) : (
                    `Showing ${Math.min(((currentPage - 1) * perPage) + 1, totalRows)}-${Math.min(currentPage * perPage, totalRows)} of ${totalRows}`
                  )}
                </div>
              </div>

              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                          <th 
                            key={header.id}
                            style={{
                              width: header.getSize(),
                              cursor: header.column.getCanSort() ? 'pointer' : 'default',
                            }}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {(loading || initialLoad) ? (
                      Array.from({ length: 5 }).map((_, rowIndex) => (
                        <tr key={`skeleton-${rowIndex}`} className="table-skeleton-row">
                          {columns.map((_, colIndex) => (
                            <td key={`skeleton-${rowIndex}-${colIndex}`}>
                              <div
                                className="table-skeleton-line"
                                style={{
                                  width: ['30px', '80px', '160px', '280px', '80px', '140px', '120px', '90px'][colIndex] || '80%'
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : table.getRowModel().rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="text-center py-5">
                          <div className="text-muted mb-2">No leads found</div>
                          <small>Try adjusting your search terms</small>
                        </td>
                      </tr>
                    ) : (
                      table.getRowModel().rows.map(row => (
                        <tr key={row.id}>
                          {row.getVisibleCells().map(cell => (
                            <td key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="border-top">
                <TablePagination
                  currentPage={currentPage}
                  totalPages={globalSearchApplied
                    ? Math.ceil(data.length / perPage) 
                    : Math.ceil(totalRows / perPage)}
                  totalItems={globalSearchApplied ? data.length : totalRows}
                  onPageChange={(newPage) => {
                    handlePageChange(newPage);
                    table.setPageIndex(newPage - 1);
                  }}
                  disabled={loading}
                />
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <style jsx global>{`
      .table-skeleton-row td {
        padding: 0.75rem 0.5rem;
      }

      .table-skeleton-line {
        height: 12px;
        border-radius: 4px;
        background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
        background-size: 200% 100%;
        animation: table-skeleton-shimmer 1.5s ease-in-out infinite;
      }

      @keyframes table-skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .btn-icon-text {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 500;
        font-size: 0.875rem;
        padding: 0.5rem 0.875rem;
        border-radius: 6px;
        transition: all 0.2s ease;
      }

      .btn-icon-text .icon-left {
        transition: transform 0.2s ease;
      }

      .btn-icon-text:hover {
        background-color: #2563eb !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2) !important;
        color: white !important;
        text-decoration: none;
      }

      .btn-icon-text:hover .icon-left {
        transform: translateX(-2px);
      }

      .card {
        transition: all 0.2s ease;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .tooltip-inner {
        max-width: 300px;
        padding: 8px 12px;
        background-color: #1e293b;
        border-radius: 6px;
        font-size: 12px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .tooltip.show {
        opacity: 1;
      }
    `}</style>
    </Fragment>
  );
};

export default ViewLeads;
