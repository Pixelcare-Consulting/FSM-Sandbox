import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Card,
  Row,
  Col,
  Badge,
  Form,
  Button,
  Modal,
  Table,
  Collapse,
} from 'react-bootstrap';
import { format } from 'date-fns';
import {
  FaFilter,
  FaSync,
  FaEye,
  FaClipboardList,
  FaUser,
  FaGlobe,
  FaExchangeAlt,
  FaInfoCircle,
  FaChevronDown,
  FaChevronUp,
} from 'react-icons/fa';
import { GeeksSEO } from 'widgets';
import { DashboardHeader } from 'sub-components';
import TablePagination from '../../../components/common/TablePagination';
import Flatpickr from 'react-flatpickr';
import {
  formatAuditAction,
  formatAuditSource,
  formatAuditChangeValue,
  formatAuditDescription,
  formatFieldLabel,
  hasLeadSyncAuditDetails,
  normalizeAuditChanges,
  normalizeAuditDetails,
  parseUserAgent,
  shouldHideAuditDetailsList,
} from '../../../utils/auditLogDisplay';
import { fetchJobStatuses } from '../../../utils/jobStatusSettings';
import { readCachedJobStatuses, writeCachedJobStatuses } from '../../../utils/jobStatusDefaults';
import { useAuditLogsQuery } from '../../../hooks/queries/useAuditLogsQuery';

const TH = {
  backgroundColor: '#f8fafc',
  fontSize: '13px',
  fontWeight: '600',
  color: '#475569',
  padding: '14px 16px',
  borderBottom: '1px solid #e2e8f0',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
};

const TD = {
  fontSize: '14px',
  color: '#64748b',
  padding: '14px 16px',
  verticalAlign: 'middle',
  borderBottom: '1px solid #f1f5f9',
};

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'auth', label: 'Auth' },
  { value: 'job', label: 'Jobs' },
  { value: 'worker', label: 'Workers' },
  { value: 'customer', label: 'Customers' },
  { value: 'lead', label: 'Leads' },
  { value: 'migration', label: 'Migration' },
  { value: 'sap', label: 'SAP' },
  { value: 'settings', label: 'Settings' },
  { value: 'memo', label: 'Memos' },
  { value: 'email', label: 'Email' },
  { value: 'system', label: 'System' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
  { value: 'warning', label: 'Warning' },
  { value: 'pending', label: 'Pending' },
];

function statusBadge(status) {
  const map = {
    success: 'success',
    failure: 'danger',
    warning: 'warning',
    pending: 'secondary',
  };
  return (
    <Badge bg={map[status] || 'secondary'} className="text-uppercase" style={{ fontSize: 11 }}>
      {status || 'unknown'}
    </Badge>
  );
}

function categoryBadge(category) {
  const colors = {
    auth: '#6366f1',
    job: '#2563eb',
    worker: '#0891b2',
    customer: '#0d9488',
    migration: '#7c3aed',
    sap: '#ea580c',
    settings: '#64748b',
    memo: '#db2777',
    email: '#059669',
    system: '#94a3b8',
  };
  return (
    <Badge
      style={{
        backgroundColor: colors[category] || '#94a3b8',
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {category || 'system'}
    </Badge>
  );
}

function formatTs(iso) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'MMM d, yyyy h:mm:ss a');
  } catch {
    return iso;
  }
}
   
const SECTION_CARD = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
};

function DetailItem({ label, children }) {
  return (
    <div className="mb-2">
      <div className="text-muted small fw-semibold mb-1">{label}</div>
      <div style={{ fontSize: 14, color: '#1e293b' }}>{children}</div>
    </div>
  );
}

function ChangesTable({ changes, jobStatusesList }) {
  const rows = normalizeAuditChanges(changes);
  if (!rows.length) return null;

  const fmt = (field, value) =>
    formatAuditChangeValue(field, value, { jobStatusesList });

  return (
    <Card className="border-0 mb-3" style={SECTION_CARD}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-3">
          <FaExchangeAlt className="text-primary" size={14} />
          <span className="fw-semibold" style={{ fontSize: 14 }}>
            What changed
          </span>
        </div>
        <div className="table-responsive">
          <Table size="sm" className="mb-0 align-middle" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: '28%', color: '#64748b', fontWeight: 600 }}>Field</th>
                <th style={{ width: '36%', color: '#64748b', fontWeight: 600 }}>Previous</th>
                <th style={{ width: '36%', color: '#64748b', fontWeight: 600 }}>New</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.field}>
                  <td className="fw-medium text-dark">{row.label}</td>
                  <td>
                    <span
                      className="d-inline-block px-2 py-1 rounded"
                      style={{
                        background: '#fef2f2',
                        color: '#991b1b',
                        textDecoration: 'line-through',
                        wordBreak: 'break-word',
                      }}
                    >
                      {fmt(row.field, row.before)}
                    </span>
                  </td>
                  <td>
                    <span
                      className="d-inline-block px-2 py-1 rounded"
                      style={{
                        background: '#ecfdf5',
                        color: '#065f46',
                        wordBreak: 'break-word',
                      }}
                    >
                      {fmt(row.field, row.after)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card.Body>
    </Card>
  );
}

function SyncFieldDiffTable({
  fieldChanges,
  jobStatusesList,
  beforeLabel = 'Previous',
  afterLabel = 'New',
}) {
  const rows = Object.entries(fieldChanges || {}).map(([field, value]) => ({
    field,
    label: formatFieldLabel(field),
    before: value?.before,
    after: value?.after,
  }));
  if (!rows.length) return null;

  const fmt = (field, value) => formatAuditChangeValue(field, value, { jobStatusesList });

  return (
    <div className="table-responsive">
      <Table size="sm" className="mb-0 align-middle" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ width: '24%', color: '#64748b', fontWeight: 600 }}>Field</th>
            <th style={{ width: '38%', color: '#64748b', fontWeight: 600 }}>{beforeLabel}</th>
            <th style={{ width: '38%', color: '#64748b', fontWeight: 600 }}>{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field}>
              <td className="fw-medium text-dark">{row.label}</td>
              <td>
                <span
                  className="d-inline-block px-2 py-1 rounded"
                  style={{
                    background: '#fef2f2',
                    color: '#991b1b',
                    textDecoration: 'line-through',
                    wordBreak: 'break-word',
                  }}
                >
                  {fmt(row.field, row.before)}
                </span>
              </td>
              <td>
                <span
                  className="d-inline-block px-2 py-1 rounded"
                  style={{
                    background: '#ecfdf5',
                    color: '#065f46',
                    wordBreak: 'break-word',
                  }}
                >
                  {fmt(row.field, row.after)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function LeadSyncAuditPanel({ details, jobStatusesList }) {
  if (!hasLeadSyncAuditDetails(details)) return null;

  const added = details.addedLeads || [];
  const skipped = details.skippedExistingWithDiffs || [];
  const restored = details.restoredLeads || [];

  return (
    <Card className="border-0 mb-3" style={SECTION_CARD}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-3">
          <FaExchangeAlt className="text-primary" size={14} />
          <span className="fw-semibold" style={{ fontSize: 14 }}>
            Google Form sync breakdown
          </span>
        </div>

        {added.length > 0 && (
          <div className="mb-4">
            <div className="fw-semibold mb-2" style={{ fontSize: 13, color: '#1e293b' }}>
              Added ({details.addedLeadsTotal ?? added.length})
              {details.addedLeadsTruncated ? (
                <span className="text-muted fw-normal"> — showing first {added.length}</span>
              ) : null}
            </div>
            <div className="table-responsive">
              <Table size="sm" className="mb-0" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Block / Unit</th>
                    <th>CP code</th>
                  </tr>
                </thead>
                <tbody>
                  {added.map((row) => (
                    <tr key={row.leadId || `${row.email}-${row.submittedAt}`}>
                      <td>{row.fullName || '—'}</td>
                      <td>{row.email || '—'}</td>
                      <td>{row.handphone || '—'}</td>
                      <td>
                        {[row.block, row.unit].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td>{row.customerCode || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mb-4">
            <div className="fw-semibold mb-2" style={{ fontSize: 13, color: '#1e293b' }}>
              Existing — Google differs, portal kept ({details.skippedDiffsTotal ?? skipped.length})
              {details.skippedDiffsTruncated ? (
                <span className="text-muted fw-normal"> — showing first {skipped.length}</span>
              ) : null}
            </div>
            {skipped.map((row) => (
              <div
                key={row.leadId || row.email}
                className="mb-3 p-3 rounded"
                style={{ background: '#fff', border: '1px solid #e2e8f0' }}
              >
                <div className="fw-medium mb-2" style={{ fontSize: 13 }}>
                  {row.fullName || '—'}
                  {row.email ? (
                    <span className="text-muted fw-normal"> · {row.email}</span>
                  ) : null}
                </div>
                <SyncFieldDiffTable
                  fieldChanges={row.fieldChanges}
                  jobStatusesList={jobStatusesList}
                  beforeLabel="Portal (kept)"
                  afterLabel="Google (not applied)"
                />
              </div>
            ))}
          </div>
        )}

        {restored.length > 0 && (
          <div>
            <div className="fw-semibold mb-2" style={{ fontSize: 13, color: '#1e293b' }}>
              Restored ({details.restoredLeadsTotal ?? restored.length})
              {details.restoredLeadsTruncated ? (
                <span className="text-muted fw-normal"> — showing first {restored.length}</span>
              ) : null}
            </div>
            {restored.map((row) => (
              <div
                key={row.leadId || row.email}
                className="mb-3 p-3 rounded"
                style={{ background: '#fff', border: '1px solid #e2e8f0' }}
              >
                <div className="fw-medium mb-2" style={{ fontSize: 13 }}>
                  {row.fullName || '—'}
                  {row.email ? (
                    <span className="text-muted fw-normal"> · {row.email}</span>
                  ) : null}
                  {row.customerCode ? (
                    <Badge bg="secondary" className="ms-2">
                      {row.customerCode}
                    </Badge>
                  ) : null}
                </div>
                <SyncFieldDiffTable
                  fieldChanges={row.fieldChanges}
                  jobStatusesList={jobStatusesList}
                  beforeLabel="Before restore"
                  afterLabel="After restore"
                />
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function DetailsList({ details, log, jobStatusesList, changes }) {
  if (shouldHideAuditDetailsList(details, changes)) return null;

  const items = normalizeAuditDetails(details, {
    description: log?.description,
    entityId: log?.entity_id,
    jobStatusesList,
    changes,
  });
  if (!items.length) return null;

  return (
    <Card className="border-0 mb-3" style={SECTION_CARD}>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center gap-2 mb-3">
          <FaInfoCircle className="text-primary" size={14} />
          <span className="fw-semibold" style={{ fontSize: 14 }}>
            Additional details
          </span>
        </div>
        <Row className="g-2">
          {items.map((item) => (
            <Col sm={6} key={item.key}>
              <DetailItem label={item.label}>
                {typeof item.raw === 'string' && item.raw.length > 80 ? (
                  <span title={item.raw}>{item.value}</span>
                ) : (
                  item.value
                )}
              </DetailItem>
            </Col>
          ))}
        </Row>
      </Card.Body>
    </Card>
  );
}

function TechnicalDetails({ log, show, onToggle }) {
  const hasRaw =
    (log.changes && Object.keys(log.changes).length > 0) ||
    (log.details && Object.keys(log.details).length > 0);

  if (!hasRaw && !log.ip_address && !log.user_agent) return null;

  return (
    <div className="mt-2">
      <Button
        variant="link"
        className="p-0 text-muted d-flex align-items-center gap-1"
        style={{ fontSize: 13, textDecoration: 'none' }}
        onClick={onToggle}
        aria-expanded={show}
      >
        {show ? <FaChevronUp size={11} /> : <FaChevronDown size={11} />}
        {show ? 'Hide technical details' : 'Show technical details'}
      </Button>
      <Collapse in={show}>
        <div className="mt-2">
          {(log.ip_address || log.user_agent) && (
            <div
              className="p-3 rounded mb-2"
              style={{ background: '#f1f5f9', fontSize: 12, color: '#475569' }}
            >
              {log.ip_address && <div>IP: {log.ip_address}</div>}
              {log.user_agent && (
                <div className="mt-1 text-break" title={log.user_agent}>
                  User agent: {log.user_agent}
                </div>
              )}
            </div>
          )}
          {hasRaw && (
            <pre
              className="mb-0 p-3 rounded"
              style={{
                background: '#f8fafc',
                fontSize: 11,
                maxHeight: 240,
                overflow: 'auto',
                border: '1px solid #e2e8f0',
              }}
            >
              {JSON.stringify({ changes: log.changes, details: log.details }, null, 2)}
            </pre>
          )}
        </div>
      </Collapse>
    </div>
  );
}

const AuditLogsPage = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [jobStatusesList, setJobStatusesList] = useState(() => readCachedJobStatuses() || []);
  const itemsPerPage = 25;

  const [filters, setFilters] = useState({
    category: 'all',
    status: 'all',
    search: '',
    dateFrom: null,
    dateTo: null,
  });

  const auditLogsParams = useMemo(
    () => ({
      page: currentPage,
      limit: itemsPerPage,
      ...filters,
    }),
    [currentPage, filters]
  );

  const {
    data: auditLogsData,
    isLoading: loading,
    refetch: refetchAuditLogs,
  } = useAuditLogsQuery(auditLogsParams);

  const logs = auditLogsData?.logs || [];
  const total = auditLogsData?.total || 0;
  const totalPages = auditLogsData?.totalPages || 1;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchJobStatuses();
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setJobStatusesList(list);
          writeCachedJobStatuses(list);
        }
      } catch (err) {
        console.warn('[audit-logs] job status labels unavailable:', err?.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFilterChange = (key, value) => {
    setCurrentPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const openDetail = async (log) => {
    setSelectedLog(log);
    setDetailError(null);
    setShowTechnical(false);
    setShowDetail(true);
    setDetailLoading(true);

    try {
      const res = await fetch(`/api/audit-logs/${log.id}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to load audit log details');
      }
      setSelectedLog(json.log || log);
    } catch (err) {
      console.error(err);
      setDetailError(err?.message || 'Failed to load audit log details');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <GeeksSEO title="Audit Logs | SAS M&E - SAP B1 | Portal" />
      <DashboardHeader
        title="Audit Logs"
        subtitle="Full activity trail — job updates, migrations, auth, SAP sync, and more"
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Audit Logs' },
        ]}
        rightAction={
          <Button
            variant="light"
            size="sm"
            onClick={() => refetchAuditLogs()}
            disabled={loading}
            className="d-flex align-items-center gap-2"
          >
            <FaSync className={loading ? 'fa-spin' : ''} /> Refresh
          </Button>
        }
      />

      <Container fluid className="mb-6">
        <Card className="border-0 shadow-sm mb-4">
          <Card.Body className="p-4">
            <Row className="g-3 align-items-end">
              <Col md={3}>
                <Form.Label className="small text-muted fw-semibold">Search</Form.Label>
                <Form.Control
                  type="search"
                  placeholder="User, action, entity, description…"
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                />
              </Col>
              <Col md={2}>
                <Form.Label className="small text-muted fw-semibold">Category</Form.Label>
                <Form.Select
                  value={filters.category}
                  onChange={(e) => handleFilterChange('category', e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small text-muted fw-semibold">Status</Form.Label>
                <Form.Select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={2}>
                <Form.Label className="small text-muted fw-semibold">From</Form.Label>
                <Flatpickr
                  className="form-control"
                  placeholder="Start date"
                  value={filters.dateFrom ? new Date(filters.dateFrom) : null}
                  options={{ dateFormat: 'Y-m-d' }}
                  onChange={([d]) =>
                    handleFilterChange('dateFrom', d ? d.toISOString() : null)
                  }
                />
              </Col>
              <Col md={2}>
                <Form.Label className="small text-muted fw-semibold">To</Form.Label>
                <Flatpickr
                  className="form-control"
                  placeholder="End date"
                  value={filters.dateTo ? new Date(filters.dateTo) : null}
                  options={{ dateFormat: 'Y-m-d' }}
                  onChange={([d]) => {
                    if (!d) {
                      handleFilterChange('dateTo', null);
                      return;
                    }
                    const end = new Date(d);
                    end.setHours(23, 59, 59, 999);
                    handleFilterChange('dateTo', end.toISOString());
                  }}
                />
              </Col>
              <Col md={1}>
                <Button
                  variant="outline-secondary"
                  className="w-100 d-flex align-items-center justify-content-center gap-1"
                  onClick={() => {
                    setFilters({
                      category: 'all',
                      status: 'all',
                      search: '',
                      dateFrom: null,
                      dateTo: null,
                    });
                    setCurrentPage(1);
                  }}
                >
                  <FaFilter size={12} /> Reset
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        <Card className="border-0 shadow-sm">
          <Card.Header className="bg-white border-bottom py-3 d-flex justify-content-between align-items-center">
            <div className="d-flex align-items-center gap-2">
              <FaClipboardList className="text-primary" />
              <span className="fw-semibold">Activity Log</span>
              <Badge bg="light" text="dark" className="ms-1">
                {total.toLocaleString()} entries
              </Badge>
            </div>
          </Card.Header>
          <div className="table-responsive">
            <Table hover className="mb-0 align-middle">
              <thead>
                <tr>
                  <th style={TH}>Timestamp</th>
                  <th style={TH}>User</th>
                  <th style={TH}>Category</th>
                  <th style={TH}>Action</th>
                  <th style={TH}>Entity</th>
                  <th style={TH}>Description</th>
                  <th style={TH}>Status</th>
                  <th style={{ ...TH, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={TD} className="text-center py-5 text-muted">
                      Loading audit logs…
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={TD} className="text-center py-5 text-muted">
                      No audit logs found. Actions will appear here as users interact with the portal.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td style={TD}>
                        <span className="text-nowrap">{formatTs(log.created_at)}</span>
                      </td>
                      <td style={TD}>
                        <div className="fw-medium text-dark" style={{ fontSize: 13 }}>
                          {log.user_name || 'System'}
                        </div>
                        {log.user_email && (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {log.user_email}
                          </div>
                        )}
                      </td>
                      <td style={TD}>{categoryBadge(log.category)}</td>
                      <td style={TD}>
                        <span style={{ fontSize: 13, color: '#334155' }}>
                          {formatAuditAction(log.action)}
                        </span>
                      </td>
                      <td style={TD}>
                        {log.entity_label || log.entity_id ? (
                          <>
                            {log.entity_type && (
                              <span className="text-muted small d-block">{log.entity_type}</span>
                            )}
                            <span style={{ fontSize: 13 }}>
                              {log.entity_label || log.entity_id}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ ...TD, maxWidth: 280 }}>
                        <span
                          className="d-inline-block text-truncate"
                          style={{ maxWidth: 260 }}
                          title={formatAuditDescription(log.description || '', jobStatusesList)}
                        >
                          {formatAuditDescription(log.description || '—', jobStatusesList)}
                        </span>
                      </td>
                      <td style={TD}>{statusBadge(log.status)}</td>
                      <td style={TD}>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 text-muted"
                          onClick={() => openDetail(log)}
                          aria-label="View details"
                        >
                          <FaEye />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
          <Card.Footer className="bg-white border-top">
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={total}
              onPageChange={setCurrentPage}
              disabled={loading}
            />
          </Card.Footer>
        </Card>
      </Container>

      <Modal
        show={showDetail}
        onHide={() => setShowDetail(false)}
        size="lg"
        centered
        scrollable
      >
        <Modal.Header closeButton className="border-bottom-0 pb-0">
          {selectedLog && (
            <>
              <div>
                <Modal.Title style={{ fontSize: '1.15rem', fontWeight: 600 }}>
                  {formatAuditAction(selectedLog.action)}
                </Modal.Title>
                <div className="text-muted mt-1" style={{ fontSize: 13 }}>
                  {formatTs(selectedLog.created_at)}
                  {selectedLog.entity_label || selectedLog.entity_id ? (
                    <>
                      {' · '}
                      {selectedLog.entity_type ? `${selectedLog.entity_type} ` : ''}
                      {selectedLog.entity_label || selectedLog.entity_id}
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </Modal.Header>
        <Modal.Body className="pt-3">
          {detailLoading && (
            <div className="text-center py-5 text-muted">Loading details…</div>
          )}
          {!detailLoading && detailError && (
            <div className="text-center py-4 text-danger">{detailError}</div>
          )}
          {!detailLoading && !detailError && selectedLog && (
            <>
              {selectedLog.description && (
                <Card className="border-0 mb-3" style={{ ...SECTION_CARD, background: '#eff6ff' }}>
                  <Card.Body className="p-3">
                    <div className="text-muted small fw-semibold mb-1">Summary</div>
                    <div style={{ fontSize: 15, color: '#1e293b', lineHeight: 1.5 }}>
                      {formatAuditDescription(selectedLog.description, jobStatusesList)}
                    </div>
                  </Card.Body>
                </Card>
              )}

              <Card className="border-0 mb-3" style={SECTION_CARD}>
                <Card.Body className="p-3">
                  <Row className="g-3">
                    <Col sm={6}>
                      <DetailItem label="User">
                        <div className="d-flex align-items-start gap-2">
                          <FaUser className="text-muted mt-1" size={13} />
                          <div>
                            <div className="fw-medium">{selectedLog.user_name || 'System'}</div>
                            {selectedLog.user_email && (
                              <div className="text-muted small">{selectedLog.user_email}</div>
                            )}
                          </div>
                        </div>
                      </DetailItem>
                    </Col>
                    <Col sm={6}>
                      <DetailItem label="Status">{statusBadge(selectedLog.status)}</DetailItem>
                    </Col>
                    <Col sm={6}>
                      <DetailItem label="Category">{categoryBadge(selectedLog.category)}</DetailItem>
                    </Col>
                    <Col sm={6}>
                      <DetailItem label="Source">
                        {formatAuditSource(selectedLog.source)}
                      </DetailItem>
                    </Col>
                    {(selectedLog.entity_label || selectedLog.entity_id) && (
                      <Col sm={6}>
                        <DetailItem label="Entity">
                          {selectedLog.entity_type && (
                            <span className="text-muted text-capitalize">
                              {selectedLog.entity_type}{' '}
                            </span>
                          )}
                          <span className="fw-medium">
                            {selectedLog.entity_label || selectedLog.entity_id}
                          </span>
                        </DetailItem>
                      </Col>
                    )}
                    {(selectedLog.ip_address || selectedLog.user_agent) && (
                      <Col sm={6}>
                        <DetailItem label="Connection">
                          <div className="d-flex align-items-start gap-2">
                            <FaGlobe className="text-muted mt-1" size={13} />
                            <div>
                              {selectedLog.ip_address && (
                                <div>{selectedLog.ip_address}</div>
                              )}
                              {selectedLog.user_agent && (
                                <div className="text-muted small">
                                  {parseUserAgent(selectedLog.user_agent)?.summary ||
                                    'Unknown device'}
                                </div>
                              )}
                            </div>
                          </div>
                        </DetailItem>
                      </Col>
                    )}
                  </Row>
                </Card.Body>
              </Card>

              <ChangesTable changes={selectedLog.changes} jobStatusesList={jobStatusesList} />
              <LeadSyncAuditPanel
                details={selectedLog.details}
                jobStatusesList={jobStatusesList}
              />
              <DetailsList
                details={selectedLog.details}
                log={selectedLog}
                jobStatusesList={jobStatusesList}
                changes={selectedLog.changes}
              />
              <TechnicalDetails
                log={selectedLog}
                show={showTechnical}
                onToggle={() => setShowTechnical((v) => !v)}
              />
            </>
          )}
        </Modal.Body>
        <Modal.Footer className="border-top-0 pt-0">
          <Button variant="secondary" onClick={() => setShowDetail(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AuditLogsPage;
