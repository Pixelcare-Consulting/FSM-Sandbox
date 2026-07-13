import React from 'react';
import Link from 'next/link';
import { Spinner } from 'react-bootstrap';
import { format } from 'date-fns';
import {
  User,
  Users,
  MapPin,
  Calendar,
  Clock,
  FileCheck,
  CheckCircle,
  XCircle,
  AlertCircle,
  Eye,
  RefreshCw,
  FileText,
  Briefcase,
} from 'lucide-react';
import SAPSyncButton from '@/components/SAPSyncButton';
import frame from '@/components/modals/DetailModal.module.css';

// Self-contained date helpers (identical to the Customer Leads page).
const formatDate = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return dateString;
  }
};

const formatDateTime = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  try {
    return format(new Date(dateString), 'MMM d, yyyy h:mm a');
  } catch {
    return dateString;
  }
};

const pillStyle = (bg, color = '#fff') => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: '9999px',
  fontSize: '12px',
  fontWeight: 600,
  background: bg,
  color,
});

const CardRow = ({ label, children }) => (
  <div className={frame.cardRow}>
    <span className={frame.cardLabel}>{label}</span>
    <span className={frame.cardValue}>{children}</span>
  </div>
);

const getInitials = (name) => {
  if (!name || name === '-') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
};

const contactDedupeKey = (name, phone, email) =>
  `${(name || '').trim()}|${(phone || '').trim()}|${(email || '').trim()}`.toLowerCase();

const collectContactsFromPartner = (partner) => {
  if (!partner) return [];
  const seen = new Set();
  const out = [];

  const push = (name, phone, email) => {
    const n = (name || '').trim();
    const p = (phone || '').trim();
    const e = (email || '').trim();
    if (!n && !p && !e) return;
    const key = contactDedupeKey(n, p, e);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name: n || '—',
      phone: p || '—',
      email: e || '—',
    });
  };

  for (const ce of partner.ContactEmployees || []) {
    push(ce.Name, ce.Phone1, ce.E_Mail);
  }

  for (const addr of partner.BPAddresses || []) {
    for (const sc of addr.PortalSiteContacts || []) {
      push(sc.contactPerson, sc.contactPhone, sc.contactEmail);
    }
    const lc = addr.LocationContact;
    if (lc) {
      push(lc.Name, lc.Phone1, lc.E_Mail);
    }
  }

  return out;
};

const collectLocationsFromPartner = (partner) => {
  if (!partner) return [];
  return (partner.BPAddresses || []).map((addr) => {
    const label = (addr.AddressName || addr.SiteID || '').trim() || '—';
    const addressParts = [
      addr.PortalFullAddress,
      addr.Street,
      addr.Building || addr.BuildingFloorRoom,
    ]
      .map((part) => (part || '').trim())
      .filter(Boolean);
    const addressSummary = addressParts[0] || addressParts.join(', ') || '—';
    const addressType = (addr.AddressType || '').toString();
    return {
      label,
      addressSummary,
      isBill: addressType === 'bo_BillTo',
      isShip: addressType === 'bo_ShipTo',
    };
  });
};

const ResponseDetailsModal = ({
  show,
  onClose,
  response,
  leadJobsByDate = {},
  leadJobsLoading = false,
  leadJobsError = null,
  createJobsStatus,
  isCreatingCustomer,
  onRequestConvertPreview,
  onCreateCustomer,
  isCreatingJobs,
  onCreateJobs,
  isSyncedToSAP,
  sapVerifyStatus,
  onSyncComplete,
  portalDetailBundle = null,
  portalDetailLoading = false,
  portalDetailError = null,
}) => {
  if (!show || !response) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const isCustomer = response.rowType === 'customer';
  const synced = typeof isSyncedToSAP === 'function' ? isSyncedToSAP(response) : false;
  const needsResync = sapVerifyStatus?.needsResync === true;
  const sapStatusLoading = Boolean(response?.synced_to_sap_at && response?.customer_id && sapVerifyStatus === null);
  const showNeedsResync = needsResync && !sapStatusLoading;
  const hasServiceDate =
    response.firstServiceDate ||
    response.secondServiceDate ||
    response.thirdServiceDate ||
    response.fourthServiceDate;

  const serviceDates = [
    { key: 'first', label: 'First Service', value: response.firstServiceDate, job: leadJobsByDate.first },
    { key: 'second', label: 'Second Service', value: response.secondServiceDate, job: leadJobsByDate.second },
    { key: 'third', label: 'Third Service', value: response.thirdServiceDate, job: leadJobsByDate.third },
    { key: 'fourth', label: 'Fourth Service', value: response.fourthServiceDate, job: leadJobsByDate.fourth },
  ];

  const populatedServiceDates = serviceDates.filter(
    (d) => d.value && d.value !== '-'
  );
  const remainingDates = populatedServiceDates.filter((d) => !d.job);
  const syncPreconditionsMet =
    synced || needsResync || (isCustomer && response?.synced_to_sap_at);
  const showCreateJobsRecovery =
    !leadJobsLoading &&
    hasServiceDate &&
    remainingDates.length > 0 &&
    response?.customer_id &&
    syncPreconditionsMet &&
    !sapStatusLoading;

  const sapLeadCardCode = String(response?.sap_card_code || '').trim().toUpperCase();
  const portalCpCode = String(response?.customer_code || '').trim().toUpperCase();
  const showCpToCPromotionHint =
    Boolean(response?.synced_to_sap_at) &&
    /^L[A-Z0-9]+$/.test(sapLeadCardCode) &&
    /^CP\d+$/.test(portalCpCode);

  const portalContacts = isCustomer ? collectContactsFromPartner(portalDetailBundle) : [];
  const portalLocations = isCustomer ? collectLocationsFromPartner(portalDetailBundle) : [];

  const renderConsent = (value) => {
    const yes = value && value !== '-' && value !== 'No';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        {yes ? (
          <CheckCircle size={16} color="#16a34a" />
        ) : (
          <XCircle size={16} color="#9ca3af" />
        )}
        <span style={pillStyle(yes ? '#16a34a' : '#9ca3af')}>{yes ? 'Yes' : 'No'}</span>
      </span>
    );
  };

  return (
    <div className={frame.modalOverlay} onClick={handleOverlayClick}>
      <div className={`${frame.modalContent} ${frame.xl}`}>
        <div className={frame.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <span className={frame.headerAvatar}>{getInitials(response.fullName)}</span>
            <div style={{ minWidth: 0 }}>
              <h3 className={frame.modalTitle}>Response Details</h3>
              <div
                style={{
                  fontSize: '13px',
                  color: '#6b7280',
                  wordBreak: 'break-word',
                }}
              >
                {response.fullName}
                {response.email && response.email !== '-' && ` (${response.email})`}
              </div>
            </div>
          </div>
          <button
            type="button"
            className={frame.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={frame.modalBody}>
          <div className={frame.leadGrid}>
            {/* LEFT column: Basic Information */}
            <div className={frame.card}>
              <h4 className={frame.cardHeader}>
                <User size={14} />
                Basic Information
              </h4>
              {response.timestamp != null && (
                <CardRow label="Submitted">{formatDateTime(response.timestamp)}</CardRow>
              )}
              {isCustomer && !response.timestamp && (
                <CardRow label="Source">Portal customer</CardRow>
              )}
              {response.customer_code && (
                <CardRow label="Portal code">
                  <span style={pillStyle('#6b7280')}>{response.customer_code}</span>
                </CardRow>
              )}
              {response.sap_card_code && (
                <CardRow label="SAP Lead code">
                  <span style={pillStyle('#0ea5e9')}>{response.sap_card_code}</span>
                </CardRow>
              )}
              <CardRow label="Email">{response.email}</CardRow>
              <CardRow label="Name">
                {response.salutation && response.salutation !== '-' && `${response.salutation}. `}
                {response.fullName}
                {(response.firstName !== '-' || response.lastName !== '-') && (
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>
                    {response.firstName !== '-' && response.firstName}
                    {response.firstName !== '-' && response.lastName !== '-' && ' '}
                    {response.lastName !== '-' && response.lastName}
                  </div>
                )}
              </CardRow>
              <CardRow label="Handphone">{response.handphone}</CardRow>
              <CardRow label="Block">{response.block}</CardRow>
              <CardRow label="Unit">{response.unit}</CardRow>
              {response.address && response.address !== '-' && (
                <CardRow label="Address">{response.address}</CardRow>
              )}
            </div>

            {/* RIGHT column: lead vs portal CP */}
            <div className={frame.leadColStack}>
              {isCustomer ? (
                <>
                  <div className={frame.card}>
                    <h4 className={frame.cardHeader}>
                      <FileText size={14} />
                      Portal Details
                    </h4>
                    <CardRow label="Created">
                      {formatDateTime(response.created_at || response.timestamp)}
                    </CardRow>
                    <CardRow label="Remarks">
                      {response.notes && response.notes !== '-' ? response.notes : '-'}
                    </CardRow>
                    <CardRow label="SAP Customer status">
                      {response.synced_to_sap_at ? (
                        <span style={pillStyle('#16a34a')}>
                          Converted
                          {response.sap_card_code ? ` (${response.sap_card_code})` : ''}
                        </span>
                      ) : (
                        <span style={pillStyle('#9ca3af', '#1f2937')}>Not Converted</span>
                      )}
                    </CardRow>
                    {response.customer_code && (
                      <CardRow label="Customer record">
                        <Link
                          href={`/customers/view/${encodeURIComponent(response.customer_code)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${frame.actionBtn} ${frame.actionBtnOutline}`}
                          style={{ textDecoration: 'none', padding: '2px 10px' }}
                        >
                          <Eye size={14} />
                          View {response.customer_code}
                        </Link>
                      </CardRow>
                    )}
                    {response.customer_code && (
                      <CardRow label="Job history">
                        <Link
                          href={`/customers/view/${encodeURIComponent(response.customer_code)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${frame.actionBtn} ${frame.actionBtnOutline}`}
                          style={{ textDecoration: 'none', padding: '2px 10px' }}
                        >
                          <Briefcase size={14} />
                          View customer jobs
                        </Link>
                      </CardRow>
                    )}
                  </div>

                  <div className={frame.card}>
                    <h4 className={frame.cardHeader}>
                      <Users size={14} />
                      Contacts &amp; Locations
                    </h4>
                    {portalDetailLoading && (
                      <div className="text-muted small d-flex align-items-center gap-2 mb-2 px-1">
                        <Spinner animation="border" size="sm" />
                        Loading contacts and locations…
                      </div>
                    )}
                    {portalDetailError && !portalDetailLoading && (
                      <div className="alert alert-warning py-2 px-3 mb-2 small" role="alert">
                        {portalDetailError}
                      </div>
                    )}
                    <div style={{ marginBottom: '12px' }}>
                      <div
                        className={frame.cardLabel}
                        style={{ marginBottom: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <User size={12} />
                        Contacts
                      </div>
                      {!portalDetailLoading && portalContacts.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {portalContacts.map((contact, index) => (
                            <div
                              key={`${contact.name}-${contact.phone}-${index}`}
                              style={{
                                fontSize: '13px',
                                lineHeight: 1.45,
                                padding: '8px 10px',
                                background: '#f9fafb',
                                borderRadius: '8px',
                                border: '1px solid #e5e7eb',
                              }}
                            >
                              <div style={{ fontWeight: 600 }}>{contact.name}</div>
                              <div style={{ color: '#6b7280' }}>{contact.phone}</div>
                              <div style={{ color: '#6b7280' }}>{contact.email}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div
                        className={frame.cardLabel}
                        style={{ marginBottom: '8px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <MapPin size={12} />
                        Locations
                      </div>
                      {!portalDetailLoading && portalLocations.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {portalLocations.map((location, index) => (
                            <div
                              key={`${location.label}-${index}`}
                              style={{
                                fontSize: '13px',
                                lineHeight: 1.45,
                                padding: '8px 10px',
                                background: '#f9fafb',
                                borderRadius: '8px',
                                border: '1px solid #e5e7eb',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600 }}>{location.label}</span>
                                {location.isBill && (
                                  <span style={pillStyle('#0ea5e9')}>Bill To</span>
                                )}
                                {location.isShip && (
                                  <span style={pillStyle('#8b5cf6')}>Ship To</span>
                                )}
                              </div>
                              <div style={{ color: '#6b7280', marginTop: '4px' }}>{location.addressSummary}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={frame.card}>
                    <h4 className={frame.cardHeader}>
                      <Calendar size={14} />
                      Service Dates
                    </h4>
                    {leadJobsLoading && (
                      <div className="text-muted small d-flex align-items-center gap-2 mb-2 px-1">
                        <Spinner animation="border" size="sm" />
                        Checking existing jobs…
                      </div>
                    )}
                    {leadJobsError && !leadJobsLoading && (
                      <div className="alert alert-warning py-2 px-3 mb-2 small" role="alert">
                        {leadJobsError}
                      </div>
                    )}
                    {serviceDates.map(({ key, label, value, job }) => (
                      <CardRow key={key} label={label}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          {formatDate(value)}
                          {job && (
                            <Link
                              href={`/dashboard/jobs/${job.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${frame.actionBtn} ${frame.actionBtnOutline}`}
                              style={{ textDecoration: 'none', padding: '2px 10px' }}
                            >
                              <Eye size={14} />
                              View Job
                            </Link>
                          )}
                        </span>
                      </CardRow>
                    ))}
                    <CardRow label="Time Slot">
                      <span style={pillStyle(response.timeSlot?.includes('AM') ? '#0ea5e9' : '#f59e0b')}>
                        {response.timeSlot}
                      </span>
                    </CardRow>
                  </div>

                  <div className={frame.card}>
                    <h4 className={frame.cardHeader}>
                      <FileCheck size={14} />
                      Consent &amp; Terms
                    </h4>
                    <CardRow label="Agreed to Terms">{renderConsent(response.agreedToTerms)}</CardRow>
                    <CardRow label="Personal Info Consent">
                      {renderConsent(response.personalInfoConsent)}
                    </CardRow>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={frame.modalFooter}>
          <div className={frame.footerStack}>
            {showCpToCPromotionHint && (
              <div
                className="alert alert-info mb-0 d-flex align-items-start gap-2"
                role="status"
                style={{ fontSize: '13px' }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>
                  When SAP promotes this Lead to Customer, run{' '}
                  <Link href="/customers" style={{ fontWeight: 600 }}>
                    Sync from SAP
                  </Link>{' '}
                  on the SAP Customers page to update the masterlist to the official C code. CP→C promotion
                  preserves all jobs via the same customer record.
                </span>
              </div>
            )}
            {createJobsStatus && (
              <div
                className={`alert alert-${
                  createJobsStatus.type === 'success'
                    ? 'success'
                    : createJobsStatus.type === 'error'
                      ? 'danger'
                      : 'warning'
                } mb-0 d-flex align-items-center gap-2`}
                role="alert"
              >
                {createJobsStatus.type === 'success' ? (
                  <CheckCircle size={18} />
                ) : (
                  <AlertCircle size={18} />
                )}
                <span>{createJobsStatus.message}</span>
              </div>
            )}

            {(sapStatusLoading || showNeedsResync || (synced && !showNeedsResync && !sapStatusLoading)) && (
              <div className={frame.footerStatus}>
                {sapStatusLoading && (
                  <span className="text-muted small d-flex align-items-center gap-1">
                    <Spinner animation="border" size="sm" />
                    Checking SAP status...
                  </span>
                )}
                {showNeedsResync && !sapStatusLoading && (
                  <span
                    className="small d-flex align-items-center gap-1"
                    style={{ color: '#d97706', fontWeight: 600 }}
                  >
                    <AlertCircle size={16} />
                    Needs Live re-sync
                    {sapVerifyStatus?.sapCardCode ? ` (${sapVerifyStatus.sapCardCode} not in current SAP)` : ''}
                  </span>
                )}
                {synced && !showNeedsResync && !sapStatusLoading && (
                  <span className="text-muted small d-flex align-items-center gap-1">
                    <CheckCircle size={16} className="text-success" />
                    SAP Lead synced
                    {response?.sap_card_code ? ` (${response.sap_card_code})` : ''}
                  </span>
                )}
              </div>
            )}

            <div className={frame.footerActions}>
              {!isCustomer && (!synced || showNeedsResync) && (
                <button
                  type="button"
                  className={`${frame.actionBtn} ${showNeedsResync ? frame.actionBtnOutline : frame.actionBtnSuccess}`}
                  onClick={() => onRequestConvertPreview?.(response?.id)}
                  disabled={isCreatingCustomer || sapStatusLoading}
                  title={
                    showNeedsResync
                      ? 'Re-sync customer to current SAP database'
                      : 'Create customer in SAP and assign a customer code'
                  }
                >
                  {isCreatingCustomer ? (
                    <>
                      <Spinner animation="border" size="sm" />
                      {showNeedsResync ? 'Re-syncing...' : 'Creating Customer...'}
                    </>
                  ) : (
                    <>
                      {showNeedsResync ? <RefreshCw size={16} /> : <User size={16} />}
                      {showNeedsResync ? 'Re-sync to SAP' : 'Convert to SAP'}
                    </>
                  )}
                </button>
              )}
              {isCustomer && !response?.synced_to_sap_at && (
                <button
                  type="button"
                  className={`${frame.actionBtn} ${frame.actionBtnSuccess}`}
                  onClick={() => onRequestConvertPreview?.(response?.id)}
                  disabled={isCreatingCustomer || sapStatusLoading}
                  title="Create SAP Lead (L#####) from this portal customer"
                >
                  {isCreatingCustomer ? (
                    <>
                      <Spinner animation="border" size="sm" />
                      Converting...
                    </>
                  ) : (
                    <>
                      <User size={16} />
                      Convert to SAP
                    </>
                  )}
                </button>
              )}
              {isCustomer && response?.synced_to_sap_at && (
                <SAPSyncButton
                  customerId={response.customer_id}
                  customerCode={response.customer_code}
                  customerName={response.fullName}
                  variant="outline-success"
                  size="md"
                  showLabel={true}
                  onSyncComplete={onSyncComplete}
                  isAlreadySynced={!!response?.synced_to_sap_at}
                  needsResync={needsResync}
                />
              )}
              {showCreateJobsRecovery && (
                <button
                  type="button"
                  className={`${frame.actionBtn} ${frame.actionBtnOutline}`}
                  onClick={() => onCreateJobs(response?.id)}
                  disabled={isCreatingJobs || sapStatusLoading || leadJobsLoading}
                  title="Create one job per service date (uses lead Name if customer not synced)"
                >
                  {isCreatingJobs ? (
                    <>
                      <Spinner animation="border" size="sm" />
                      Creating Jobs...
                    </>
                  ) : (
                    <>
                      <Calendar size={16} />
                      Create Jobs from Lead
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                className={`${frame.actionBtn} ${frame.actionBtnPrimary}`}
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResponseDetailsModal;
