import React, { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Row,
  Col,
  Card,
  Tabs,
  Tab,
  Spinner,
  Badge,
  Button,
  Modal,
  Form
} from 'react-bootstrap';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  RefreshCw,
  Download,
  FileText,
  Eye,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Building,
  FileCheck,
  Edit,
  Save,
  X,
  Trash2,
  AlertCircle,
  Plus
} from 'lucide-react';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import DefaultDashboardLayout from '@/layouts/dashboard/DashboardIndexTop';
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from '@/sub-components/dashboard/DashboardListStickySearch';
import SAPSyncButton from '@/components/SAPSyncButton';
import ResponseDetailsModal from './_components/ResponseDetailsModal';
import TablePagination from '@/components/common/TablePagination';
import { ExtensionFriendlyPhone } from '@/components/common/ExtensionFriendlyPhone';
import { Search as FeatherSearch, X as FeatherX } from 'react-feather';
import { useEnterToSearch } from '@/hooks/useEnterToSearch';
import { HouseFill, EnvelopeFill, ListUl } from 'react-bootstrap-icons';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper
} from '@tanstack/react-table';
import { TABLE_CONFIG } from 'constants/tableConfig';
import { usePortalCustomersListQuery } from '@/hooks/queries/usePortalCustomersListQuery';
import { useGoogleFormsListQuery } from '@/hooks/queries/useGoogleFormsListQuery';
import { transformLeadToResponse } from '@/lib/leads/buildPortalCustomersList';

function getPortalSourceBadgeProps(portalSource) {
  switch (portalSource) {
    case 'google_form':
      return { bg: 'info', label: 'GOOGLE FORM' };
    case 'internal':
      return { bg: 'secondary', label: 'PORTAL' };
    case 'manual_lead':
      return { bg: 'dark', label: 'MANUAL LEAD' };
    default:
      return { bg: 'secondary', label: 'UNKNOWN' };
  }
}

function getWorkflowStatusBadgeProps(status) {
  const normalized = status || 'PENDING';
  const bg =
    normalized === 'CONVERTED' ? 'success' :
    normalized === 'PENDING' ? 'warning' :
    normalized === 'CONTACTED' ? 'info' :
    normalized === 'REJECTED' ? 'danger' :
    normalized === 'COMPLETED' ? 'primary' :
    normalized === 'ACTIVE' ? 'light' :
    'secondary';
  return {
    bg,
    text: normalized === 'ACTIVE' ? 'dark' : undefined,
    label: normalized,
  };
}

const leadsColumnHelper = createColumnHelper();

function normalizeContactEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeContactPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function contactsDiffer(portalValue, sapValue, kind) {
  const portal = kind === 'email' ? normalizeContactEmail(portalValue) : normalizeContactPhone(portalValue);
  const sap = kind === 'email' ? normalizeContactEmail(sapValue) : normalizeContactPhone(sapValue);
  if (!portal && !sap) return false;
  if (!portal || !sap) return false;
  if (kind === 'email') return portal !== sap;
  if (portal.length < 8 || sap.length < 8) return portal !== sap;
  return portal !== sap && portal.slice(-8) !== sap.slice(-8);
}

function formatLinkMatchLabel(match) {
  switch (match) {
    case 'email_exact':
      return 'email';
    case 'email_ambiguous':
      return 'email (ambiguous)';
    case 'phone_exact':
      return 'phone';
    case 'name_verified':
      return 'name (verified)';
    case 'name_conflict':
      return 'name only';
    default:
      return match || 'unknown';
  }
}

const ACTION_BTN_STYLE = { fontSize: '11px', padding: '4px 8px' };

function getRowWorkflowStatus(row) {
  return row?.status || 'PENDING';
}


function PortalRowActions({ row, onView, onEdit, onDelete, isSyncedToSAP, mobile = false }) {
  const canModify = !isSyncedToSAP(row);
  const isPortal = row.rowType === 'customer';
  const viewClass = mobile
    ? 'flex-fill d-flex align-items-center justify-content-center gap-1'
    : 'btn btn-primary btn-icon-text btn-sm';

  return (
    <div className={`d-flex gap-1 ${mobile ? '' : 'flex-wrap align-items-center'}`}>
      <Button
        variant="primary"
        size="sm"
        onClick={() => onView(row)}
        className={viewClass}
        style={{ ...ACTION_BTN_STYLE, textDecoration: 'none' }}
      >
        <Eye size={14} className={mobile ? '' : 'icon-left'} />
        View
      </Button>
      {canModify && (
        <Button
          variant="outline-warning"
          size="sm"
          onClick={() => onEdit(row, isPortal ? { portal: true } : {})}
          className="d-flex align-items-center justify-content-center"
          style={ACTION_BTN_STYLE}
          title={
            isPortal
              ? 'Edit limited portal lead details'
              : 'Edit lead details'
          }
        >
          <Edit size={12} />
        </Button>
      )}
      {canModify && (
        <Button
          variant="outline-danger"
          size="sm"
          onClick={() => onDelete(row.id)}
          className="d-flex align-items-center justify-content-center"
          style={ACTION_BTN_STYLE}
          title={isPortal ? 'Delete portal customer' : 'Delete lead'}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}

const CustomerLeadsPage = () => {
  const [activeTab, setActiveTab] = useState('allResponses');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const {
    rows: responses,
    isLoading: listLoading,
    isError: listError,
    error: listFetchError,
    refetch: refetchPortalList,
    invalidate: invalidatePortalList,
    removeRow,
  } = usePortalCustomersListQuery();
  const loading = listLoading || syncing;
  const displayError = error || (listError ? listFetchError?.message : null);
  const [selectedResponse, setSelectedResponse] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [isPortalEditMode, setIsPortalEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const { forms: googleForms } = useGoogleFormsListQuery();
  const [selectedFormId, setSelectedFormId] = useState(null);
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [isCreatingJobs, setIsCreatingJobs] = useState(false);
  const [leadJobsByDate, setLeadJobsByDate] = useState({});
  const [leadJobsLoading, setLeadJobsLoading] = useState(false);
  const [leadJobsError, setLeadJobsError] = useState(null);
  const [portalDetailBundle, setPortalDetailBundle] = useState(null);
  const [portalDetailLoading, setPortalDetailLoading] = useState(false);
  const [portalDetailError, setPortalDetailError] = useState(null);
  const [createJobsStatus, setCreateJobsStatus] = useState(null);
  const [sapVerifyStatus, setSapVerifyStatus] = useState(null);
  const {
    draft: searchDraft,
    setDraft: setSearchDraft,
    applied: searchApplied,
    clear: clearSearch,
    onKeyDown: onSearchKeyDown,
  } = useEnterToSearch();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showSyncPreviewModal, setShowSyncPreviewModal] = useState(false);
  const [syncPreviewData, setSyncPreviewData] = useState(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [selectedSyncResponseIds, setSelectedSyncResponseIds] = useState(new Set());
  const [syncConfirming, setSyncConfirming] = useState(false);
  const [showConvertPreviewModal, setShowConvertPreviewModal] = useState(false);
  const [convertPreviewData, setConvertPreviewData] = useState(null);
  const [convertPreviewLoading, setConvertPreviewLoading] = useState(false);
  const [convertPreviewLeadId, setConvertPreviewLeadId] = useState(null);
  const [showEditCodeModal, setShowEditCodeModal] = useState(false);
  const [editCodeCustomerId, setEditCodeCustomerId] = useState(null);
  const [editCodeCurrent, setEditCodeCurrent] = useState('');
  const [editCodeValue, setEditCodeValue] = useState('');
  const [editCodeSaving, setEditCodeSaving] = useState(false);
  const router = useRouter();
  const autoOpenedCustomerCodeRef = useRef(null);
  const highlightHandledRef = useRef(null);

  useEffect(() => {
    if (googleForms.length > 0 && !selectedFormId) {
      setSelectedFormId(googleForms[0].id);
    }
  }, [googleForms, selectedFormId]);

  // Reset to first page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchApplied]);

  // Fetch jobs for this lead when viewing modal (for "View Job" links per service date)
  useEffect(() => {
    if (!showModal || !selectedResponse?.id) {
      setLeadJobsByDate({});
      setLeadJobsLoading(false);
      setLeadJobsError(null);
      return;
    }
    if (selectedResponse.rowType === 'customer') {
      setLeadJobsByDate({});
      setLeadJobsLoading(false);
      setLeadJobsError(null);
      return;
    }
    const hasServiceDate = [
      selectedResponse.firstServiceDate,
      selectedResponse.secondServiceDate,
      selectedResponse.thirdServiceDate,
      selectedResponse.fourthServiceDate,
    ].some((d) => d && d !== '-');
    if (!hasServiceDate) {
      setLeadJobsByDate({});
      setLeadJobsLoading(false);
      setLeadJobsError(null);
      return;
    }
    if (!selectedResponse.customer_id) {
      setLeadJobsByDate({});
      setLeadJobsLoading(false);
      setLeadJobsError(null);
      return;
    }
    let cancelled = false;
    setLeadJobsLoading(true);
    setLeadJobsError(null);
    setLeadJobsByDate({});
    fetch(`/api/leads/${selectedResponse.id}/jobs`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load jobs (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setLeadJobsByDate(data.jobsByServiceDate || {});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLeadJobsByDate({});
          setLeadJobsError(err.message || 'Failed to load jobs for this lead');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLeadJobsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [showModal, selectedResponse?.id, selectedResponse?.customer_id]);

  // Fetch contacts + locations when viewing a portal CP customer modal
  useEffect(() => {
    if (
      !showModal ||
      selectedResponse?.rowType !== 'customer' ||
      !selectedResponse?.customer_code
    ) {
      setPortalDetailBundle(null);
      setPortalDetailLoading(false);
      setPortalDetailError(null);
      return;
    }

    const customerCode = String(selectedResponse.customer_code).trim();
    let cancelled = false;
    setPortalDetailLoading(true);
    setPortalDetailError(null);
    setPortalDetailBundle(null);

    fetch(`/api/customers/masterlist-bundle/${encodeURIComponent(customerCode)}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load customer details (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setPortalDetailBundle(data.partner || null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPortalDetailBundle(null);
          setPortalDetailError(err.message || 'Failed to load contacts and locations');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPortalDetailLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [showModal, selectedResponse?.rowType, selectedResponse?.customer_code]);

  useEffect(() => {
    if (!showModal) {
      setCreateJobsStatus(null);
      setSapVerifyStatus(null);
      setLeadJobsError(null);
      setPortalDetailBundle(null);
      setPortalDetailLoading(false);
      setPortalDetailError(null);
    }
  }, [showModal, selectedResponse?.id]);

  // Verify customer exists in current SAP when opening detail modal
  useEffect(() => {
    if (!showModal || !selectedResponse?.customer_id || !selectedResponse?.synced_to_sap_at) {
      setSapVerifyStatus(
        selectedResponse?.synced_to_sap_at && selectedResponse?.customer_id ? null : { needsResync: false, inSap: false }
      );
      return;
    }

    let cancelled = false;
    setSapVerifyStatus(null);
    fetch(`/api/customers/sap-status/${selectedResponse.customer_id}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.success) {
          setSapVerifyStatus({
            inSap: data.inSap,
            needsResync: data.needsResync,
            sapCardCode: data.sapCardCode,
            verifiedAt: data.verifiedAt,
          });
        } else if (!cancelled) {
          setSapVerifyStatus({ needsResync: false, inSap: false, verifyFailed: true });
        }
      })
      .catch(() => {
        if (!cancelled) setSapVerifyStatus({ needsResync: false, inSap: false, verifyFailed: true });
      });

    return () => { cancelled = true; };
  }, [showModal, selectedResponse?.customer_id, selectedResponse?.synced_to_sap_at]);

  useEffect(() => {
    if (!router.isReady) return;

    const rawCustomerCode = router.query.openCustomerCode;
    const customerCode = Array.isArray(rawCustomerCode) ? rawCustomerCode[0] : rawCustomerCode;
    if (!customerCode || autoOpenedCustomerCodeRef.current === customerCode) {
      return;
    }

    if (!responses.length && !loading) {
      autoOpenedCustomerCodeRef.current = customerCode;
      toast.info(`Portal customer ${customerCode} was not found in SAP yet.`, {
        position: 'top-right',
      });
      router.replace('/customer-leads', undefined, { shallow: true });
      return;
    }

    if (!responses.length) {
      return;
    }

    const matchingResponse = responses.find((response) =>
      String(response.customer_code || '').toUpperCase() === String(customerCode).toUpperCase()
    );

    autoOpenedCustomerCodeRef.current = customerCode;

    if (matchingResponse) {
      setSelectedResponse(matchingResponse);
      setShowModal(true);
      if (router.query.portalNotSynced === '1') {
        toast.info(`Customer ${customerCode} is a portal customer and has not been synced to SAP yet.`, {
          position: 'top-right',
          autoClose: 5000,
        });
      }
    } else {
      toast.warning(`Could not find customer ${customerCode} in Customer Leads.`, {
        position: 'top-right',
      });
    }

    router.replace('/customer-leads', undefined, { shallow: true });
  }, [router, responses, loading]);

  useEffect(() => {
    if (!router.isReady) return;

    const rawHighlight = router.query.highlight;
    const highlightCode = Array.isArray(rawHighlight) ? rawHighlight[0] : rawHighlight;
    if (!highlightCode || highlightHandledRef.current === highlightCode) {
      return;
    }

    highlightHandledRef.current = highlightCode;
    toast.success(`Customer ${highlightCode} created successfully`, {
      position: 'top-right',
      autoClose: 5000,
    });

    if (responses.length > 0) {
      const matchingResponse = responses.find(
        (response) =>
          String(response.customer_code || '').toUpperCase() === String(highlightCode).toUpperCase()
      );
      if (matchingResponse) {
        setSelectedResponse(matchingResponse);
        setShowModal(true);
      }
    }

    router.replace('/customer-leads', undefined, { shallow: true });
  }, [router, router.isReady, router.query.highlight, responses]);

  // Helper function to extract form ID from URL
  const extractFormIdFromUrl = (url) => {
    try {
      const match = url.match(/\/forms\/d\/e\/([^\/]+)/) || url.match(/\/forms\/d\/([^\/]+)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  };

  // Get selected form details
  const selectedForm = googleForms.find(f => f.id === selectedFormId);
  const formDescription = selectedForm 
    ? `View and manage customer leads from ${selectedForm.name}`
    : 'View and manage customer leads from Google Forms';

  // Open sync preview modal (fetch leads list from Google, show for confirmation)
  const handleOpenSyncPreview = async () => {
    const form = googleForms.find(f => f.id === selectedFormId);
    const formIdToSync = form?.form_id || (form?.url ? extractFormIdFromUrl(form.url) : null);
    if (!formIdToSync && googleForms.length > 0) {
      toast.warning('Please select a Google Form to sync from', { position: 'top-right', autoClose: 3000 });
      return;
    }
    setSyncPreviewLoading(true);
    setSyncPreviewData(null);
    try {
      const res = await fetch('/api/leads/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: formIdToSync, preview: true })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || data.error || 'Failed to load preview');
        return;
      }
      if (data.preview) {
        setSyncPreviewData(data);
        setSelectedSyncResponseIds(new Set(
          (data.willSync || [])
            .map((r) => r.google_form_response_id)
            .filter(Boolean)
        ));
        setShowSyncPreviewModal(true);
      } else {
        setSyncPreviewData({ preview: true, willSync: [], totalResponses: data.total || 0, newOrRestoreCount: 0, alreadyInListCount: 0, skippedMissingCount: 0 });
        setSelectedSyncResponseIds(new Set());
        setShowSyncPreviewModal(true);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load sync preview');
    } finally {
      setSyncPreviewLoading(false);
    }
  };

  const closeSyncPreviewModal = () => {
    setShowSyncPreviewModal(false);
    setSyncPreviewData(null);
    setSelectedSyncResponseIds(new Set());
  };

  const handleSelectSyncResponse = (responseId) => {
    setSelectedSyncResponseIds((prev) => {
      const next = new Set(prev);
      if (next.has(responseId)) {
        next.delete(responseId);
      } else {
        next.add(responseId);
      }
      return next;
    });
  };

  const handleOpenEditCode = (customerId, currentCode) => {
    setEditCodeCustomerId(customerId);
    setEditCodeCurrent(currentCode || '');
    setEditCodeValue(currentCode || '');
    setShowEditCodeModal(true);
  };

  const handleSaveEditCode = async () => {
    const trimmed = (editCodeValue || '').trim();
    if (!trimmed || !/^CP\d{1,5}$/i.test(trimmed)) {
      toast.warning('Code must be in format CP followed by digits (e.g. CP00001)', { position: 'top-right' });
      return;
    }
    if (trimmed.toUpperCase() === (editCodeCurrent || '').toUpperCase()) {
      setShowEditCodeModal(false);
      return;
    }
    setEditCodeSaving(true);
    try {
      const res = await fetch(`/api/customers/generic/${editCodeCustomerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_code: trimmed.toUpperCase() })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to update code', { position: 'top-right' });
        return;
      }
      toast.success('Customer code updated', { position: 'top-right' });
      setShowEditCodeModal(false);
      setEditCodeCustomerId(null);
      setEditCodeValue('');
      fetchLeads();
    } catch (err) {
      toast.error(err.message || 'Failed to update code', { position: 'top-right' });
    } finally {
      setEditCodeSaving(false);
    }
  };

  // Transform database format to frontend format — use shared helper from buildPortalCustomersList.js

  const runGoogleFormSync = useCallback(async ({ formId, responseIds } = {}) => {
    let formIdToSync = formId;
    if (!formIdToSync) {
      const selectedForm = googleForms.find(f => f.id === selectedFormId);
      formIdToSync = selectedForm?.form_id ||
        (selectedForm?.url ? extractFormIdFromUrl(selectedForm.url) : null);

      if (!formIdToSync && googleForms.length > 0) {
        toast.warning('Please select a Google Form to sync from', {
          position: 'top-right',
          autoClose: 3000
        });
        return { ok: false, aborted: true };
      }
    }

    const body = { form_id: formIdToSync };
    if (Array.isArray(responseIds)) {
      body.response_ids = responseIds;
    }

    const syncResponse = await fetch('/api/leads/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (syncResponse.ok) {
      const syncData = await syncResponse.json();
      const summaryParts = [];
      if (syncData.created > 0) {
        summaryParts.push(`${syncData.created} new lead(s) created`);
      }
      if (syncData.skippedExistingChangedCount > 0) {
        summaryParts.push(`${syncData.skippedExistingChangedCount} existing lead(s) left unchanged (portal edits preserved)`);
      }
      if (summaryParts.length) {
        toast.success(summaryParts.join(' · '), { position: 'top-right', autoClose: 5000 });
      } else if (syncData.restored > 0) {
        toast.success(`${syncData.restored} lead(s) restored and now visible in the list`, {
          position: 'top-right',
          autoClose: 3000
        });
      } else if (syncData.skippedExistingCount > 0 || syncData.alreadyInListCount > 0) {
        const existing = syncData.skippedExistingCount || syncData.alreadyInListCount || 0;
        toast.info(`No new leads to import (${existing} already in portal; your edits are preserved)`, {
          position: 'top-right',
          autoClose: 3000
        });
      } else if (syncData.skipped > 0 && !syncData.errors?.length) {
        toast.info(`All leads are already in database (${syncData.skipped} skipped)`, {
          position: 'top-right',
          autoClose: 3000
        });
      } else {
        toast.info('No new leads found in Google Forms', {
          position: 'top-right',
          autoClose: 3000
        });
      }
      return { ok: true, data: syncData };
    }

    const errorData = await syncResponse.json();
    const errorMessage = errorData.error || errorData.message || 'Failed to sync from Google Forms';

    if (errorMessage.includes('credentials not configured') || errorData.diagnostics) {
      const diagnostics = errorData.diagnostics || {};
      let diagnosticMessage = 'Google Forms sync not configured.\n\n';

      if (diagnostics.hasEmail === false) {
        diagnosticMessage += '❌ GOOGLE_SERVICE_ACCOUNT_EMAIL is missing\n';
      } else if (diagnostics.hasEmail === true) {
        diagnosticMessage += '✅ GOOGLE_SERVICE_ACCOUNT_EMAIL is set\n';
      }

      if (diagnostics.hasKey === false) {
        diagnosticMessage += '❌ GOOGLE_PRIVATE_KEY is missing\n';
      } else if (diagnostics.hasKey === true) {
        diagnosticMessage += '✅ GOOGLE_PRIVATE_KEY is set\n';
        if (!diagnostics.keyHasBeginMarker || !diagnostics.keyHasEndMarker) {
          diagnosticMessage += '⚠️ Private key format may be incorrect (missing BEGIN/END markers)\n';
        }
      }

      if (diagnostics.hint) {
        diagnosticMessage += `\n💡 ${diagnostics.hint}`;
      }

      toast.error(
        <div style={{ whiteSpace: 'pre-line', maxWidth: '600px', fontSize: '13px' }}>
          {diagnosticMessage}
        </div>,
        {
          position: 'top-right',
          autoClose: 20000,
        }
      );
    } else {
      console.error('Sync error details:', errorData);
      let formattedMessage = errorMessage;
      if (errorData.hint) {
        formattedMessage += '\n\n' + errorData.hint;
      }
      formattedMessage = formattedMessage.split('\n').map((line, idx) =>
        idx === 0 ? line : `\n${line}`
      ).join('');

      toast.error(
        <div style={{ whiteSpace: 'pre-line', maxWidth: '600px', fontSize: '13px' }}>
          {formattedMessage}
        </div>,
        {
          position: 'top-right',
          autoClose: 20000,
        }
      );
    }
    throw new Error(errorMessage);
  }, [googleForms, selectedFormId]);

  const fetchLeads = useCallback(async (syncFromGoogle = false) => {
    setError(null);
    try {
      if (syncFromGoogle) {
        setSyncing(true);
        try {
          const result = await runGoogleFormSync();
          if (result?.aborted) {
            return;
          }
        } catch (syncErr) {
          console.error('Error syncing from Google Forms:', syncErr);
          if (!syncErr.message || syncErr.message === 'Failed to sync from Google Forms') {
            toast.warning('Could not sync from Google Forms. Showing existing leads.', {
              position: 'top-right',
              autoClose: 5000,
            });
          }
        }
      }

      await refetchPortalList();
    } catch (err) {
      console.error('Error fetching leads:', err);
      setError(err.message);
      toast.error('Failed to load leads', {
        position: 'top-right',
      });
    } finally {
      setSyncing(false);
    }
  }, [refetchPortalList, runGoogleFormSync]);

  const handleConfirmSync = async () => {
    const form = googleForms.find(f => f.id === selectedFormId);
    const formIdToSync = form?.form_id || (form?.url ? extractFormIdFromUrl(form.url) : null);
    const responseIds = [...selectedSyncResponseIds];

    setSyncConfirming(true);
    try {
      const result = await runGoogleFormSync({ formId: formIdToSync, responseIds });
      if (result?.ok) {
        closeSyncPreviewModal();
        await fetchLeads();
      }
    } catch (err) {
      console.error('Error confirming sync:', err);
    } finally {
      setSyncConfirming(false);
    }
  };

  const handleTabChange = (key) => {
    if (key) {
      setActiveTab(key);
      setSelectedLeads(new Set()); // Clear selection when switching tabs
      setCurrentPage(1); // Reset to first page when switching tabs
    }
  };

  // Filter data based on search query (works for both lead and customer rows)
  const filterData = useCallback((data) => {
    if (!searchApplied.trim()) {
      return data;
    }

    const query = searchApplied.toLowerCase().trim();
    return data.filter(row => {
      const name = (row.fullName || '').toLowerCase();
      const email = (row.email || '').toLowerCase();
      const code = (row.customer_code || '').toLowerCase();
      const phone = (row.handphone || '').toLowerCase();
      const address = (row.address || '').toLowerCase();
      const block = (row.block || '').toLowerCase();
      const unit = (row.unit || '').toLowerCase();
      const status = (row.status || '').toLowerCase();
      const portalSource = (row.portalSource || '').toLowerCase();
      return (
        email.includes(query) ||
        name.includes(query) ||
        code.includes(query) ||
        phone.includes(query) ||
        address.includes(query) ||
        block.includes(query) ||
        unit.includes(query) ||
        status.includes(query) ||
        portalSource.includes(query)
      );
    });
  }, [searchApplied]);

  // Get paginated data
  const getPaginatedData = (data) => {
    const filtered = filterData(data);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return {
      paginatedData: filtered.slice(startIndex, endIndex),
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / itemsPerPage)
    };
  };

  // Handle search input change — draft only; applied on Enter via hook

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

  // Filter responses by status - pending services (first service date in the future). Only leads have service dates.
  const pendingResponses = responses.filter(r => {
    if (r.rowType === 'customer') return false;
    const firstDate = r.firstServiceDate;
    if (!firstDate || firstDate === '-') return false;
    try {
      const serviceDate = new Date(firstDate);
      // Service is pending if first service date is in the future
      return serviceDate > new Date();
    } catch {
      return false;
    }
  });

  // Check if a lead/customer is synced to SAP (block edit when synced in current SAP).
  const isSyncedToSAP = useCallback((lead) => {
    if (!lead) return false;
    if (lead.sap_needs_resync) return false;
    if (selectedResponse?.id === lead.id && sapVerifyStatus?.needsResync) return false;
    if (lead.rowType === 'customer') return !!lead.synced_to_sap_at;
    if (lead.status === 'CONVERTED') return !!lead.synced_to_sap_at;
    return false;
  }, [sapVerifyStatus, selectedResponse?.id]);

  const handleEdit = useCallback((lead, options = {}) => {
    const { portal = false } = options;

    setIsPortalEditMode(!!portal);

    // Prevent editing if synced to SAP, except for portal edit mode
    if (!portal && isSyncedToSAP(lead)) {
      toast.warning('Cannot edit lead: This lead has already been synced to SAP. Please make changes in SAP directly.', {
        position: "top-right",
        autoClose: 5000
      });
      return;
    }

    setEditingLead(lead.id);
    setEditFormData({
      email: lead.email,
      firstName: lead.firstName !== '-' ? lead.firstName : '',
      lastName: lead.lastName !== '-' ? lead.lastName : '',
      fullName: lead.fullName,
      salutation: lead.salutation || '',
      handphone: lead.handphone || '',
      block: lead.block || '',
      unit: lead.unit || '',
      building: lead.building !== '-' ? lead.building : '',
      street: lead.street !== '-' ? lead.street : '',
      postcode: lead.postcode !== '-' ? lead.postcode : '',
      country: lead.country !== '-' ? lead.country : '',
      address: lead.address || '',
      firstServiceDate: lead.firstServiceDate !== '-' ? lead.firstServiceDate : '',
      secondServiceDate: lead.secondServiceDate !== '-' ? lead.secondServiceDate : '',
      thirdServiceDate: lead.thirdServiceDate !== '-' ? lead.thirdServiceDate : '',
      fourthServiceDate: lead.fourthServiceDate !== '-' ? lead.fourthServiceDate : '',
      timeSlot: lead.timeSlot || '',
      agreedToTerms: lead.agreedToTerms === 'Yes',
      personalInfoConsent: lead.personalInfoConsent === 'Yes',
      status: (lead.status === 'Portal' || lead.status === 'CONVERTED')
        ? lead.status
        : (lead.status ? String(lead.status).toUpperCase() : 'PENDING'),
      notes: lead.notes || ''
    });
  }, [isSyncedToSAP]);

  const handleCancelEdit = () => {
    setEditingLead(null);
    setIsPortalEditMode(false);
    setEditFormData({});
  };

  const handleSaveEdit = async (leadId) => {
    // Check if lead is synced to SAP before saving (unless in portal edit mode)
    const currentLead = responses.find(r => r.id === leadId);
    if (!isPortalEditMode && currentLead && isSyncedToSAP(currentLead)) {
      toast.error('Cannot save changes: This lead has already been synced to SAP. Please make changes in SAP directly.', {
        position: "top-right",
        autoClose: 5000
      });
      setSaving(false);
      return;
    }

    setSaving(true);
    try {
      // Portal customer edit: use generic customer PATCH API
      if (isPortalEditMode && String(leadId).startsWith('cust-')) {
        const customerId = String(leadId).replace(/^cust-/, '');
        const response = await fetch(`/api/customers/generic/${customerId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: (editFormData.fullName || [editFormData.firstName, editFormData.lastName].filter(Boolean).join(' ').trim()).trim() || undefined,
            email: editFormData.email ?? undefined,
            phone_number: editFormData.handphone ?? undefined,
            customer_address: editFormData.address ?? undefined,
            block: editFormData.block !== undefined ? (editFormData.block || null) : undefined,
            unit: editFormData.unit !== undefined ? (editFormData.unit || null) : undefined,
            notes: editFormData.notes !== undefined ? (editFormData.notes || null) : undefined
          })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to update customer');
        }
        const data = await response.json();
        toast.success('Portal customer updated successfully', { position: 'top-right' });
        await fetchLeads();
        setEditingLead(null);
        setIsPortalEditMode(false);
        setEditFormData({});
        if (selectedResponse && selectedResponse.id === leadId && data.customer) {
          const c = data.customer;
          setSelectedResponse({
            ...selectedResponse,
            fullName: c.customer_name,
            email: c.email,
            handphone: c.phone_number || '-',
            address: c.customer_address || '-',
            block: (c.block != null && c.block !== '') ? c.block : '-',
            unit: (c.unit != null && c.unit !== '') ? c.unit : '-',
            notes: c.notes ?? selectedResponse.notes
          });
        }
        setSaving(false);
        return;
      }

      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editFormData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update lead');
      }

      const data = await response.json();
      toast.success('Lead updated successfully', { position: 'top-right' });

      // Re-fetch full lead (with customer relation) so View modal and list have complete data
      let fullLead = data.lead;
      try {
        const getRes = await fetch(`/api/leads/${leadId}`);
        if (getRes.ok) {
          const getData = await getRes.json();
          if (getData.lead) fullLead = getData.lead;
        }
      } catch (_) { /* use PUT response if GET fails */ }
      const updatedResponse = transformLeadToResponse(fullLead);

      // Refresh the list so the table shows updated data
      await fetchLeads();
      setEditingLead(null);
      setIsPortalEditMode(false);
      setEditFormData({});
      
      // Update selected response so View modal shows full data (including customer_code, status)
      if (selectedResponse && selectedResponse.id === leadId) {
        setSelectedResponse(updatedResponse);
      }
    } catch (err) {
      console.error('Error updating lead:', err);
      toast.error(err.message || 'Failed to update lead', {
        position: "top-right"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async (rowId) => {
    const isPortalCustomer = String(rowId).startsWith('cust-');
    const confirmMessage = isPortalCustomer
      ? 'Are you sure you want to delete this portal customer?'
      : 'Are you sure you want to delete this lead?';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      let response;
      if (isPortalCustomer) {
        const customerId = String(rowId).replace(/^cust-/, '');
        response = await fetch(`/api/customers/generic/${customerId}`, { method: 'DELETE' });
      } else {
        response = await fetch(`/api/leads/${rowId}`, { method: 'DELETE' });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || (isPortalCustomer ? 'Failed to delete portal customer' : 'Failed to delete lead'));
      }

      toast.success(isPortalCustomer ? 'Portal customer deleted successfully' : 'Lead deleted successfully', {
        position: 'top-right',
      });

      removeRow(rowId);
      await invalidatePortalList();

      if (selectedResponse && selectedResponse.id === rowId) {
        setShowModal(false);
        setSelectedResponse(null);
      }
    } catch (err) {
      console.error('Error deleting row:', err);
      toast.error(err.message || 'Failed to delete', {
        position: 'top-right',
      });
    }
  }, [invalidatePortalList, removeRow, selectedResponse]);

  const handleOpenConvertPreview = useCallback(async (leadId) => {
    if (!leadId) return;
    setConvertPreviewLeadId(leadId);
    setConvertPreviewLoading(true);
    setConvertPreviewData(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/convert-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const contentType = res.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else if (!res.ok) {
        throw new Error(`API route not found (${res.status}). Restart the dev server if you recently changed API files.`);
      }
      if (!res.ok) {
        throw new Error(data?.message || data?.error || 'Failed to load convert preview');
      }
      setConvertPreviewData(data);
      setShowConvertPreviewModal(true);
    } catch (err) {
      toast.error(err.message || 'Failed to load convert preview', { position: 'top-right' });
    } finally {
      setConvertPreviewLoading(false);
    }
  }, []);

  const handleCreateCustomer = useCallback(async (leadId) => {
    if (!leadId) return;

    setIsCreatingCustomer(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/create-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok || data.sap?.success === false) {
        throw new Error(data.error || data.message || data.sap?.error || 'Failed to sync SAP Lead');
      }

      if (data.sap?.verification && (!data.sap.verification.inSap || data.sap.verification.needsResync)) {
        throw new Error(data.sap?.error || 'SAP Lead verification failed');
      }

      const sapLeadCode = data.sap?.cardCode || data.customer?.sap_card_code;
      toast.success(
        <div>
          <div><strong>SAP Lead synced successfully!</strong></div>
          <div style={{ fontSize: '0.9em', marginTop: '4px' }}>
            Portal Code: {data.customer?.customer_code || 'N/A'}
            {sapLeadCode && (
              <div style={{ marginTop: '4px' }}>
                SAP Lead Code: {sapLeadCode}
                {data.sap?.masterlistSynced && (
                  <span style={{ color: '#28a745', marginLeft: '8px' }}>✓ In SAP Leads masterlist</span>
                )}
              </div>
            )}
            <div style={{ marginTop: '8px', opacity: 0.95 }}>
              When SAP promotes this Lead to Customer, run <strong>Sync from SAP</strong> on the SAP Customers
              page to update the masterlist to the official C code (CP→C promotion preserves all jobs on the
              same customer record).
            </div>
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 6000
        }
      );

      if (data.sap?.masterlistWarning) {
        toast.warning(data.sap.masterlistWarning, { position: 'top-right', autoClose: 8000 });
      }

      // Refresh leads to update the customer_id
      await fetchLeads();
      
      // Update selected response if it's the one being converted
      if (selectedResponse && selectedResponse.id === leadId) {
        const updatedLead = await fetch(`/api/leads/${leadId}`).then(r => r.json());
        if (updatedLead.lead) {
          setSelectedResponse(transformLeadToResponse(updatedLead.lead));
        }
        const jobsRes = await fetch(`/api/leads/${leadId}/jobs`).then((r) => (r.ok ? r.json() : {}));
        if (jobsRes.jobsByServiceDate) {
          setLeadJobsByDate(jobsRes.jobsByServiceDate);
        }
      }
    } catch (err) {
      console.error('Error creating customer:', err);
      toast.error(err.message || 'Failed to create customer', {
        position: "top-right",
        autoClose: 5000
      });
    } finally {
      setIsCreatingCustomer(false);
    }
  }, [fetchLeads, selectedResponse]);

  const handleConfirmConvert = useCallback(async () => {
    const leadId = convertPreviewLeadId;
    setShowConvertPreviewModal(false);
    setConvertPreviewData(null);
    setConvertPreviewLeadId(null);
    if (leadId) {
      await handleCreateCustomer(leadId);
    }
  }, [convertPreviewLeadId, handleCreateCustomer]);

  const handleBulkDelete = async () => {
    const leadIdsToDelete = Array.from(selectedLeads).filter(id => !String(id).startsWith('cust-'));
    const customerIdsToDelete = Array.from(selectedLeads)
      .filter(id => String(id).startsWith('cust-'))
      .map(id => String(id).replace(/^cust-/, ''));
    if (leadIdsToDelete.length === 0 && customerIdsToDelete.length === 0) {
      toast.warning('Please select at least one item to delete', {
        position: "top-right"
      });
      return;
    }

    const parts = [];
    if (leadIdsToDelete.length) parts.push(`${leadIdsToDelete.length} lead(s)`);
    if (customerIdsToDelete.length) parts.push(`${customerIdsToDelete.length} portal customer(s)`);
    if (!window.confirm(`Are you sure you want to delete ${parts.join(' and ')}?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      let deletedLeads = 0;
      let deletedCustomers = 0;
      if (leadIdsToDelete.length > 0) {
        const response = await fetch('/api/leads/bulk-delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: leadIdsToDelete })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to delete leads');
        }
        const data = await response.json();
        deletedLeads = data.deletedCount || leadIdsToDelete.length;
      }
      for (const customerId of customerIdsToDelete) {
        const response = await fetch(`/api/customers/generic/${customerId}`, { method: 'DELETE' });
        if (response.ok) {
          deletedCustomers++;
        } else {
          const err = await response.json();
          toast.warning(`Could not delete customer: ${err.error || 'Unknown error'}`, { position: 'top-right' });
        }
      }

      const msg = [];
      if (deletedLeads) msg.push(`${deletedLeads} lead(s)`);
      if (deletedCustomers) msg.push(`${deletedCustomers} portal customer(s)`);
      if (msg.length) {
        toast.success(`Deleted ${msg.join(' and ')}`, { position: "top-right" });
      }
      setSelectedLeads(new Set());
      await fetchLeads();
    } catch (err) {
      console.error('Error bulk deleting:', err);
      toast.error(err.message || 'Failed to delete', { position: "top-right" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSelectLead = useCallback((leadId) => {
    const newSelected = new Set(selectedLeads);
    if (newSelected.has(leadId)) {
      newSelected.delete(leadId);
    } else {
      newSelected.add(leadId);
    }
    setSelectedLeads(newSelected);
  }, [selectedLeads]);

  // TanStack Table: same pattern as customers list (after all handlers so no use-before-init)
  const tableData = useMemo(
    () => {
      const tabData = activeTab === 'allResponses'
        ? responses
        : responses.filter(r => {
            if (r.rowType === 'customer') return false;
            const firstDate = r.firstServiceDate;
            if (!firstDate || firstDate === '-') return false;
            try {
              const serviceDate = new Date(firstDate);
              return serviceDate > new Date();
            } catch {
              return false;
            }
          });
      return filterData(tabData);
    },
    [responses, activeTab, filterData]
  );

  const leadsColumns = useMemo(() => [
    leadsColumnHelper.display({
      id: 'select',
      header: () => {
        const currentRows = tableData.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage);
        const allSelected = currentRows.length > 0 && currentRows.every(row => selectedLeads.has(row.id));
        return (
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              const allIds = currentRows.map(r => r.id);
              if (allIds.length > 0 && allIds.every(id => selectedLeads.has(id))) {
                setSelectedLeads(new Set());
              } else {
                setSelectedLeads(new Set(allIds));
              }
            }}
            className="form-check-input"
          />
        );
      },
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedLeads.has(row.original.id)}
          onChange={() => handleSelectLead(row.original.id)}
          className="form-check-input"
        />
      )
    }),
    leadsColumnHelper.display({
      id: 'index',
      header: '#',
      cell: ({ row }) => (currentPage - 1) * itemsPerPage + row.index + 1
    }),
    leadsColumnHelper.display({
      id: 'code',
      header: () => <span title="Generic customer code (CP) once lead is converted">Code</span>,
      cell: ({ row }) => {
        const r = row.original;
        return r.customer_code ? (
          <span className="fw-bold" style={{ cursor: 'default' }}>{r.customer_code}</span>
        ) : (
          <span className="text-muted">–</span>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'email',
      header: 'Email',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <a href={`mailto:${r.email}`} className="text-decoration-none text-primary d-flex align-items-center" title={r.email} style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <EnvelopeFill className="me-2 flex-shrink-0" />
            {r.email}
          </a>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'customer',
      header: 'Customer',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="d-flex align-items-center" style={{ fontSize: '13px' }}>
            {r.salutation && r.salutation !== '-' && (
              <small className="text-muted me-1" style={{ fontSize: '11px' }}>{r.salutation}. </small>
            )}
            <span style={{ fontWeight: '500' }}>{r.fullName}</span>
          </div>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'address',
      header: 'Address Information',
      cell: ({ row }) => {
        const r = row.original;
        const blockUnit = [r.block, r.unit].filter(p => p && p !== '-').join(' / ');
        const addressParts = [];
        if (blockUnit) addressParts.push(blockUnit);
        if (r.address && r.address !== '-') addressParts.push(r.address);
        const addressMerged = addressParts.length > 0 ? addressParts.join(', ') : '-';
        const addressDisplay = addressMerged.length > 40 ? `${addressMerged.substring(0, 40)}...` : addressMerged;
        return (
          <div className="d-flex align-items-start">
            <HouseFill className="me-2 flex-shrink-0 mt-1" style={{ color: '#6B7280' }} />
            <div style={{ fontSize: '12px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={addressMerged}>
              {addressDisplay}
            </div>
          </div>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'phone',
      header: 'Phone',
      cell: ({ row }) => {
        const r = row.original;
        const raw = r.handphone || '';
        if (!raw) {
          return <span className="text-muted">–</span>;
        }
        return <ExtensionFriendlyPhone raw={raw} />;
      }
    }),
    leadsColumnHelper.display({
      id: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const r = row.original;
        const { bg, label } = getPortalSourceBadgeProps(r.portalSource);
        return (
          <Badge
            bg={bg}
            className="text-uppercase"
            style={{ fontSize: '10px', padding: '4px 8px', fontWeight: '500' }}
          >
            {label}
          </Badge>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const r = row.original;
        const status = getRowWorkflowStatus(r);
        const { bg, text, label } = getWorkflowStatusBadgeProps(status);
        return (
          <Badge
            bg={bg}
            text={text}
            className="text-uppercase"
            style={{ fontSize: '10px', padding: '4px 8px', fontWeight: '500' }}
          >
            {label}
          </Badge>
        );
      }
    }),
    leadsColumnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <PortalRowActions
            row={r}
            onView={(item) => {
              setSelectedResponse(item);
              setShowModal(true);
            }}
            onEdit={handleEdit}
            onDelete={handleDelete}
            isSyncedToSAP={isSyncedToSAP}
          />
        );
      }
    })
  ], [
    tableData,
    currentPage,
    itemsPerPage,
    selectedLeads,
    handleSelectLead,
    handleEdit,
    handleDelete,
    isSyncedToSAP,
  ]);

  const leadsTable = useReactTable({
    data: tableData,
    columns: leadsColumns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    state: {
      pagination: {
        pageIndex: currentPage - 1,
        pageSize: itemsPerPage
      }
    },
    onPaginationChange: updater => {
      if (typeof updater === 'function') {
        const next = updater({ pageIndex: currentPage - 1, pageSize: itemsPerPage });
        setCurrentPage(next.pageIndex + 1);
        if (next.pageSize !== itemsPerPage) setItemsPerPage(next.pageSize);
      }
    }
  });

  const handleSelectAll = (data) => {
    const allIds = data.map(r => r.id);
    if (allIds.length > 0 && allIds.every(id => selectedLeads.has(id))) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(allIds));
    }
  };

  const handleCreateJobsFromLead = async (leadId) => {
    if (!leadId) return;
    setIsCreatingJobs(true);
    setCreateJobsStatus(null);
    try {
      const response = await fetch(`/api/leads/${leadId}/create-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ updateLeadStatus: true })
      });
      const data = await response.json();

      const refetchLeadJobs = async () => {
        setLeadJobsLoading(true);
        setLeadJobsError(null);
        try {
          const jobsRes = await fetch(`/api/leads/${leadId}/jobs`, {
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          });
          if (!jobsRes.ok) {
            const body = await jobsRes.json().catch(() => ({}));
            throw new Error(body.error || `Failed to load jobs (${jobsRes.status})`);
          }
          const data = await jobsRes.json();
          if (data.jobsByServiceDate) {
            setLeadJobsByDate(data.jobsByServiceDate);
            return data.jobsByServiceDate;
          }
          return {};
        } catch (err) {
          setLeadJobsError(err.message || 'Failed to load jobs for this lead');
          return {};
        } finally {
          setLeadJobsLoading(false);
        }
      };

      if (!response.ok) {
        if (response.status === 409) {
          if (selectedResponse?.id === leadId) {
            await refetchLeadJobs();
          } else if (data.jobsByServiceDate) {
            setLeadJobsByDate(data.jobsByServiceDate);
          }
          const msg = data.error || 'Jobs were already created for this lead.';
          setCreateJobsStatus({ type: 'warning', message: msg });
          toast.info(msg, { position: 'top-right' });
          return;
        }
        const msg = data.error || data.message || 'Failed to create jobs from lead';
        setCreateJobsStatus({ type: 'error', message: msg });
        toast.error(msg, { position: 'top-right' });
        return;
      }

      const count = data.createdCount ?? 0;

      if (selectedResponse?.id === leadId) {
        await refetchLeadJobs();
      } else if (data.jobsByServiceDate && Object.keys(data.jobsByServiceDate).length > 0) {
        setLeadJobsByDate(data.jobsByServiceDate);
      }

      if (data.partial && count > 0) {
        const jobNumbers = (data.jobs || []).map((j) => j.job_number).filter(Boolean).join(', ');
        const failedDates = (data.errors || []).map((e) => e.serviceDate).filter(Boolean).join(', ');
        const msg = `Created ${count} of ${count + (data.errors?.length || 0)} job(s)${jobNumbers ? `: ${jobNumbers}` : ''}.${failedDates ? ` Failed dates: ${failedDates}.` : ''}`;
        setCreateJobsStatus({ type: 'warning', message: msg });
        toast.warning(msg, { position: 'top-right', autoClose: 8000 });
      } else if (count > 0) {
        const jobNumbers = (data.jobs || []).map((j) => j.job_number).filter(Boolean).join(', ');
        const msg = `Created ${count} job(s)${jobNumbers ? `: ${jobNumbers}` : ''}.`;
        setCreateJobsStatus({ type: 'success', message: msg });
        toast.success(
          `${msg} ${data.customer ? `Customer: ${data.customer.customer_name}` : ''}`.trim(),
          { position: 'top-right', autoClose: 5000 }
        );
      } else {
        const msg = data.message || 'No new jobs created (all service dates already have jobs).';
        setCreateJobsStatus({ type: 'warning', message: msg });
        toast.info(msg, { position: 'top-right' });
      }

      await fetchLeads();
      if (selectedResponse?.id === leadId) {
        const updated = await fetch(`/api/leads/${leadId}`).then((r) => r.json());
        if (updated.lead) setSelectedResponse(transformLeadToResponse(updated.lead));
      }
    } catch (err) {
      console.error('Error creating jobs from lead:', err);
      const msg = err.message || 'Failed to create jobs from lead';
      setCreateJobsStatus({ type: 'error', message: msg });
      toast.error(msg, { position: 'top-right' });
    } finally {
      setIsCreatingJobs(false);
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Timestamp', 'Email', 'Block', 'Unit', 'Address', 'Salutation', 'Full Name',
      'Handphone', 'First Service Date', 'Second Service Date',
      'Third Service Date', 'Fourth Service Date', 'Time Slot',
      'Agreed to Terms', 'Personal Info Consent'
    ];

    const csvRows = [
      headers.join(','),
      ...responses.map(r => [
        formatDateTime(r.timestamp),
        r.email,
        r.block,
        r.unit,
        r.address || '-',
        r.salutation,
        r.fullName,
        r.handphone,
        r.firstServiceDate,
        r.secondServiceDate,
        r.thirdServiceDate,
        r.fourthServiceDate,
        r.timeSlot,
        r.agreedToTerms,
        r.personalInfoConsent
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `customer-leads-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.success('CSV exported successfully', {
      position: "top-right"
    });
  };

  const renderTable = (data) => {
    if (loading) {
      return (
        <div className="text-center py-5">
          <Spinner animation="border" variant="primary" className="me-2" />
          <span className="text-muted">Loading customer leads...</span>
        </div>
      );
    }

    if (displayError) {
      return (
        <div className="text-center py-5">
          <div className="text-danger mb-2">Error: {displayError}</div>
          <Button variant="primary" onClick={() => fetchLeads(true)}>
            <RefreshCw size={16} className="me-2" />
            Sync & Retry
          </Button>
        </div>
      );
    }

    // Get filtered and paginated data (for empty checks and display counts)
    const { totalItems, totalPages } = getPaginatedData(data);
    const currentPageRows = leadsTable.getRowModel().rows;

    if (data.length === 0) {
      return (
        <div className="text-center py-5">
          <div className="text-muted mb-2">No customer leads found</div>
          <Button variant="primary" onClick={() => fetchLeads(true)}>
            <RefreshCw size={16} className="me-2" />
            Google Form Sync & Refresh
          </Button>
        </div>
      );
    }

    if (totalItems === 0 && searchApplied.trim()) {
      return (
        <div className="text-center py-5">
          <div className="text-muted mb-2">No leads found matching &quot;{searchApplied}&quot;</div>
          <Button variant="outline-secondary" onClick={() => {
            clearSearch();
            setCurrentPage(1);
          }}>
            Clear Search
          </Button>
        </div>
      );
    }

    return (
      <>
        {selectedLeads.size > 0 && (
          <div className="mb-3 p-3 bg-light rounded d-flex align-items-center justify-content-between">
            <span className="text-muted">
              <strong>{selectedLeads.size}</strong> item(s) selected
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="d-flex align-items-center gap-2"
            >
              {isDeleting ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} />
                  Delete Selected
                </>
              )}
            </Button>
          </div>
        )}

        {/* Mobile Card View - same data as table page */}
        <div className="d-md-none">
          {currentPageRows.map((row) => {
            const response = row.original;
            const actualIndex = (currentPage - 1) * itemsPerPage + row.index;
            const blockUnit = [response.block, response.unit].filter(p => p && p !== '-').join(' / ');
            const addressParts = [];
            if (blockUnit) addressParts.push(blockUnit);
            if (response.address && response.address !== '-') addressParts.push(response.address);
            const addressMerged = addressParts.length > 0 ? addressParts.join(', ') : '-';
            const addressDisplay = addressMerged.length > 50 ? `${addressMerged.substring(0, 50)}...` : addressMerged;

            return (
              <Card key={response.id} className="mb-3 shadow-sm border-0" style={{ borderRadius: '12px' }}>
                <Card.Body className="p-3">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedLeads.has(response.id)}
                        onChange={() => handleSelectLead(response.id)}
                        className="form-check-input mt-0"
                        style={{ marginTop: '0' }}
                      />
                      <Badge 
                        bg={getWorkflowStatusBadgeProps(getRowWorkflowStatus(response)).bg}
                        text={getWorkflowStatusBadgeProps(getRowWorkflowStatus(response)).text}
                        className="text-uppercase"
                        style={{ fontSize: '10px', padding: '4px 8px' }}
                      >
                        {getRowWorkflowStatus(response)}
                      </Badge>
                      {response.portalSource && (
                        <Badge
                          bg={getPortalSourceBadgeProps(response.portalSource).bg}
                          className="text-uppercase"
                          style={{ fontSize: '10px', padding: '4px 8px' }}
                        >
                          {getPortalSourceBadgeProps(response.portalSource).label}
                        </Badge>
                      )}
                      {response.customer_code && (
                        <Badge bg="secondary" style={{ fontSize: '10px', padding: '4px 8px' }}>{response.customer_code}</Badge>
                      )}
                    </div>
                    <small className="text-muted">#{actualIndex + 1}</small>
                  </div>
                  
                  <div className="mb-2">
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <User size={14} className="text-primary" />
                      <strong style={{ fontSize: '15px' }}>
                        {response.salutation && response.salutation !== '-' ? `${response.salutation}. ` : ''}
                        {response.fullName}
                      </strong>
                    </div>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <Mail size={12} className="text-muted" />
                      <small className="text-muted" style={{ fontSize: '12px' }}>{response.email}</small>
                    </div>
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <Phone size={12} className="text-muted" />
                      <small className="text-muted" style={{ fontSize: '12px' }}>{response.handphone}</small>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <MapPin size={12} className="text-muted" />
                      <small className="text-muted" style={{ fontSize: '12px' }}>
                        {addressDisplay}
                      </small>
                    </div>
                  </div>

                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {response.timeSlot && response.timeSlot !== '-' && (
                      <div>
                        <small className="text-muted d-block" style={{ fontSize: '10px' }}>Time Slot</small>
                        <Badge bg={response.timeSlot?.includes('AM') ? 'info' : 'warning'} style={{ fontSize: '10px' }}>
                          {response.timeSlot}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="d-flex gap-1 mt-2">
                    <PortalRowActions
                      row={response}
                      mobile
                      onView={(item) => {
                        setSelectedResponse(item);
                        setShowModal(true);
                      }}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      isSyncedToSAP={isSyncedToSAP}
                    />
                  </div>
                </Card.Body>
              </Card>
            );
          })}
        </div>

        {/* Desktop Table View - same card/table style as Customers list */}
        <div className="d-none d-md-block">
          <Card className="border-0 shadow-sm">
            <Card.Body className="p-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center">
                  <span className="text-muted me-2">Show:</span>
                  <div className="position-relative" style={{ width: '90px' }}>
                    <Form.Select
                      size="sm"
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="me-2"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </Form.Select>
                  </div>
                  <span className="text-muted">entries per page</span>
                </div>
                <div className="text-muted d-flex align-items-center">
                  <ListUl size={14} className="me-2" />
                  Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems}
                </div>
              </div>

              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    {leadsTable.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                          <th key={header.id}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {currentPageRows.map(row => (
                      <tr key={row.id}>
                        {row.getVisibleCells().map(cell => (
                          <td
                            key={cell.id}
                            className={cell.column.id === 'phone' ? 'd-none d-lg-table-cell' : ''}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-top pt-3">
                <TablePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  onPageChange={(newPage) => setCurrentPage(newPage)}
                  disabled={loading}
                />
              </div>
            </Card.Body>
          </Card>
        </div>
      </>
    );
  };

  return (
    <Fragment>
      <style>{`
        .btn-primary.btn-icon-text {
          background-color: #3b82f6;
          color: white;
          border: none;
          box-shadow: 0 2px 4px rgba(59, 130, 246, 0.15);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          font-size: 0.875rem;
          padding: 0.5rem 0.875rem;
          border-radius: 6px;
          transition: all 0.2s ease;
        }
        .btn-primary.btn-icon-text:hover {
          background-color: #2563eb;
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);
          color: white;
          text-decoration: none;
        }
        .btn-primary.btn-icon-text .icon-left {
          transition: transform 0.2s ease;
        }
        .btn-sm.btn-icon-text {
          padding: 0.4rem 0.75rem;
          font-size: 0.812rem;
        }
      `}</style>
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div
            style={{
              background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
              padding: "2rem 2rem 1.5rem",
              borderRadius: "0 0 24px 24px",
              marginTop: "-39px",
              marginLeft: "10px",
              marginRight: "10px",
              marginBottom: "20px",
            }}
          >
            <div className="d-flex justify-content-between align-items-start gap-3">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: "28px",
                      fontWeight: "600",
                      color: "#FFFFFF",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Portal Customers
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: "16px",
                      color: "rgba(255, 255, 255, 0.7)",
                      fontWeight: "400",
                      lineHeight: "1.5",
                    }}
                  >
                    {formDescription}
                  </p>
                  {googleForms.length > 0 && (
                    <div className="mt-2">
                      <select
                        className="form-select"
                        value={selectedFormId || ''}
                        onChange={(e) => setSelectedFormId(e.target.value)}
                        style={{
                          maxWidth: '400px',
                          fontSize: '14px',
                          background: 'rgba(255, 255, 255, 0.95)',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 12px'
                        }}
                      >
                        {googleForms.map((form) => (
                          <option key={form.id} value={form.id}>
                            {form.name} {form.is_active ? '' : '(Inactive)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div
                    className="d-flex align-items-center gap-2"
                    style={{
                      fontSize: "14px",
                      color: "rgba(255, 255, 255, 0.9)",
                      background: "rgba(255, 255, 255, 0.1)",
                      padding: "8px 12px",
                      borderRadius: "6px",
                      marginTop: "8px",
                    }}
                  >
                    <FileText size={16} />
                    <span>
                      Total Leads: <strong>{responses.length}</strong>
                    </span>
                  </div>
                </div>

                <nav style={{ fontSize: "14px", fontWeight: "500" }}>
                  <div className="d-flex align-items-center">
                    <i
                      className="fe fe-home"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    ></i>
                    <Link
                      href="/"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Dashboard
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <i
                      className="fe fe-users"
                      style={{ color: "#FFFFFF" }}
                    ></i>
                    <span className="ms-2" style={{ color: "#FFFFFF" }}>
                      Customer Leads
                    </span>
                  </div>
                </nav>
              </div>

              <div className="d-flex gap-2">
                <Link href="/dashboard/customers/create" className="text-decoration-none">
                  <Button
                    variant="light"
                    className="d-flex align-items-center gap-2"
                    style={{
                      border: "none",
                      borderRadius: "12px",
                      padding: "10px 20px",
                      fontWeight: "500",
                      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                    }}
                  >
                    <Plus size={16} />
                    Create Portal Customers
                  </Button>
                </Link>
                <Button
                  variant="light"
                  onClick={handleOpenSyncPreview}
                  className="d-flex align-items-center gap-2"
                  disabled={!selectedFormId || googleForms.length === 0 || syncPreviewLoading}
                  style={{
                    border: "none",
                    borderRadius: "12px",
                    padding: "10px 20px",
                    fontWeight: "500",
                    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                    opacity: (!selectedFormId || googleForms.length === 0 || syncPreviewLoading) ? 0.6 : 1
                  }}
                  title={!selectedFormId || googleForms.length === 0 
                    ? "Please configure Google Forms in Settings first" 
                    : `Sync from ${selectedForm?.name || 'Google Forms'} and refresh`}
                >
                  {syncPreviewLoading ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      Google Form Sync & Refresh
                    </>
                  )}
                </Button>
             
               
              </div>
            </div>
          </div>
        </Col>
      </Row>
      {/* Global Search + table share one Col so sticky has room to stick (matches customers list) */}
      <Row>
        <Col md={12} xs={12} className="mb-5">
          <DashboardListStickySearch style={STICKY_SEARCH_GRADIENT_BLUE}>
              <Row className="align-items-center">
                <Col md={12}>
                  <div className="d-flex align-items-center gap-3">
                    <div style={{ minWidth: '140px' }}>
                      <h6 className="mb-0 text-white d-flex align-items-center">
                        <FeatherSearch className="me-2" size={18} />
                        🌐 Global Search
                      </h6>
                      <small className="text-white" style={{ opacity: 0.9, fontSize: '0.75rem' }}>
                        Press Enter to search
                      </small>
                    </div>
                    <div className="flex-grow-1">
                      <Form.Control
                        type="text"
                        placeholder="Search by email, name, phone, address, block, unit, status, or customer code (e.g. CP00001)..."
                        value={searchDraft}
                        onChange={(e) => setSearchDraft(e.target.value)}
                        onKeyDown={onSearchKeyDown}
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
                    {(searchDraft || searchApplied) && (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={() => {
                          clearSearch();
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
                  {searchApplied ? (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.95 }}>
                      <small style={{ fontSize: '0.85rem' }}>
                        ✓ Found <strong>{filterData(activeTab === 'allResponses' ? responses : pendingResponses).length}</strong> of <strong>{activeTab === 'allResponses' ? responses.length : pendingResponses.length}</strong> lead(s)
                      </small>
                    </div>
                  ) : (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.85 }}>
                      <small style={{ fontSize: '0.8rem' }}>
                        💡 <strong>Tip:</strong> Press Enter to search by email, name, phone, address, block, unit, status, or customer code (e.g. CP00001). Converted leads with a CP code appear in here.
                      </small>
                    </div>
                  )}
                </Col>
              </Row>
          </DashboardListStickySearch>

          <Card className="shadow-sm">
            <Card.Body>
              <Tabs
                activeKey={activeTab}
                onSelect={handleTabChange}
                className="mb-3"
              >
                <Tab eventKey="allResponses" title={`Leads & Portal Customers (${responses.length})`}>
                  <div className="mt-3">
                    {/* <p className="text-muted small mb-3">
                      <strong>One view:</strong> Leads (from Google sync or manual) and portal-only customers. <strong>Code</strong> shows CP number (e.g. CP00001); synced leads get a CP code automatically. Add new portal customers via <Link href="/dashboard/customers/generic">Portal Customers</Link>.
                    </p> */}
                    {renderTable(responses)}
                  </div>
                </Tab>
                {/* Hidden: Pending Services tab */}
                {false && (
                  <Tab eventKey="pending" title={`Pending Services (${pendingResponses.length})`}>
                    <div className="mt-3">
                      {renderTable(pendingResponses)}
                    </div>
                  </Tab>
                )}
              </Tabs>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      {/* Edit customer code modal */}
      <Modal
        show={showEditCodeModal}
        onHide={() => { setShowEditCodeModal(false); setEditCodeCustomerId(null); setEditCodeValue(''); }}
        centered
        size="sm"
      >
        <Modal.Header closeButton>
          <Modal.Title>Edit customer code</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-0">
            <Form.Label>Customer code</Form.Label>
            <Form.Control
              type="text"
              value={editCodeValue}
              onChange={(e) => setEditCodeValue(e.target.value.toUpperCase().replace(/[^CP0-9]/gi, ''))}
              placeholder="e.g. CP00001"
              maxLength={8}
            />
            <Form.Text className="text-muted">Format: CP followed by digits (e.g. CP00001). Must be unique.</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowEditCodeModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSaveEditCode} disabled={editCodeSaving}>
            {editCodeSaving ? 'Saving...' : 'Save'}
          </Button>
        </Modal.Footer>
      </Modal>
      {/* Convert to SAP Preview Modal */}
      <Modal
        show={showConvertPreviewModal}
        onHide={() => {
          setShowConvertPreviewModal(false);
          setConvertPreviewData(null);
          setConvertPreviewLeadId(null);
        }}
        size="lg"
        centered
        contentClassName="border-0 shadow"
      >
        <Modal.Header
          closeButton
          style={{
            background: 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem 0.375rem 0 0',
            padding: '1rem 1.5rem',
          }}
        >
          <Modal.Title className="d-flex align-items-center gap-2" style={{ color: 'white' }}>
            <User size={24} />
            Review before Convert to SAP
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ padding: '1.5rem' }}>
          {convertPreviewData && (() => {
            const portalEmail = convertPreviewData.lead?.email;
            const portalPhone = convertPreviewData.lead?.phone;
            const sapEmail = convertPreviewData.sap?.email;
            const sapPhone = convertPreviewData.sap?.phone;
            const emailDiffers = contactsDiffer(portalEmail, sapEmail, 'email');
            const phoneDiffers = contactsDiffer(portalPhone, sapPhone, 'phone');
            const showMismatchBanner =
              convertPreviewData.sap?.contactMismatch ||
              convertPreviewData.sap?.linkConfidence === 'low';

            return (
            <>
              <p className="text-muted mb-3">
                This will create or link a <strong>SAP Lead (L*)</strong> in SAP B1 and add it to the
                SAP Leads masterlist. <strong>No jobs</strong> are created until you click Create Jobs from Lead.
              </p>
              {showMismatchBanner && (
                <div className="alert alert-warning border-warning mb-3" role="alert">
                  <div className="d-flex align-items-start gap-2">
                    <AlertCircle size={20} className="flex-shrink-0 mt-1" />
                    <div>
                      <strong>Contact details differ</strong>
                      <p className="mb-0 mt-1">
                        Name <strong>{convertPreviewData.lead?.fullName || '—'}</strong> matches SAP
                        Lead <strong>{convertPreviewData.sap?.leadCode || '—'}</strong>, but email
                        and/or phone differ. Only confirm if this is the same person; otherwise cancel
                        and a new Lead will be created.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {convertPreviewData.warnings?.length > 0 && !showMismatchBanner && (
                <div className="alert alert-warning mb-3">
                  {convertPreviewData.warnings.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
              )}
              {convertPreviewData.siblingPortalCustomers?.length > 0 && (
                <div className="alert alert-warning mb-3">
                  <strong>Sibling portal records</strong>
                  <ul className="mb-0 mt-2 ps-3">
                    {convertPreviewData.siblingPortalCustomers.map((s) => (
                      <li key={s.customer_code}>
                        {s.customer_code} — {s.customer_name}
                        {s.email ? ` (${s.email})` : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="mb-0 mt-2 small">
                    Another CP record shares this email/phone. Review or merge before converting to SAP.
                  </p>
                </div>
              )}
              <Row className="mb-3 g-3">
                <Col md={6}>
                  <div className="border rounded p-3 h-100">
                    <h6 className="mb-2">Portal</h6>
                    <div><strong>Name:</strong> {convertPreviewData.lead?.fullName || '-'}</div>
                    <div
                      style={emailDiffers && convertPreviewData.sap?.action === 'link'
                        ? { backgroundColor: '#fff3cd', borderRadius: '4px', padding: '2px 4px' }
                        : undefined}
                    >
                      <strong>Email:</strong> {portalEmail || '-'}
                    </div>
                    <div
                      style={phoneDiffers && convertPreviewData.sap?.action === 'link'
                        ? { backgroundColor: '#fff3cd', borderRadius: '4px', padding: '2px 4px' }
                        : undefined}
                    >
                      <strong>Phone:</strong> {portalPhone || '-'}
                    </div>
                    <div><strong>Portal code:</strong> {convertPreviewData.portal?.code || '-'}</div>
                    {convertPreviewData.portal?.note && (
                      <div className="text-muted small mt-1">{convertPreviewData.portal.note}</div>
                    )}
                  </div>
                </Col>
                <Col md={6}>
                  <div className="border rounded p-3 h-100">
                    <h6 className="mb-2">SAP Lead</h6>
                    <div>
                      <strong>Action:</strong>{' '}
                      {convertPreviewData.sap?.action === 'create' && 'Create new Lead'}
                      {convertPreviewData.sap?.action === 'link' && 'Link existing Lead'}
                      {convertPreviewData.sap?.action === 'resync' && 'Re-sync to SAP'}
                      {convertPreviewData.sap?.action === 'already_synced' && 'Already synced'}
                      {convertPreviewData.sap?.action === 'existing' && 'Use existing Lead'}
                    </div>
                    <div><strong>SAP Lead code:</strong> {convertPreviewData.sap?.leadCode || '-'}</div>
                    <div><strong>Card name:</strong> {convertPreviewData.sap?.cardName || '-'}</div>
                    {convertPreviewData.sap?.action === 'link' && convertPreviewData.sap?.linkMatch && (
                      <div>
                        <strong>Matched by:</strong>{' '}
                        {formatLinkMatchLabel(convertPreviewData.sap.linkMatch)}
                      </div>
                    )}
                    <div
                      style={emailDiffers && convertPreviewData.sap?.action === 'link'
                        ? { backgroundColor: '#f8d7da', borderRadius: '4px', padding: '2px 4px' }
                        : undefined}
                    >
                      <strong>Email:</strong> {sapEmail || '-'}
                    </div>
                    <div
                      style={phoneDiffers && convertPreviewData.sap?.action === 'link'
                        ? { backgroundColor: '#f8d7da', borderRadius: '4px', padding: '2px 4px' }
                        : undefined}
                    >
                      <strong>Phone:</strong> {sapPhone || '-'}
                    </div>
                    <div><strong>SAP company DB:</strong> {convertPreviewData.sap?.environment || '-'}</div>
                    {convertPreviewData.sap?.needsResync && (
                      <div className="text-warning small mt-2">
                        Needs re-sync ({convertPreviewData.sap?.verificationReason || 'environment mismatch'})
                      </div>
                    )}
                  </div>
                </Col>
              </Row>
              {convertPreviewData.serviceDates?.length > 0 && (
                <div className="mb-3">
                  <h6 className="mb-2">Service dates (jobs not created yet)</h6>
                  <ul className="mb-0 ps-3">
                    {convertPreviewData.serviceDates.map((d) => (
                      <li key={d.label}>
                        {d.label}: {d.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-muted small mb-0">{convertPreviewData.jobsNote}</p>
              {!convertPreviewData.validation?.isValid && (
                <div className="alert alert-danger mt-3 mb-0">
                  Cannot proceed: {(convertPreviewData.validation?.errors || []).join(', ')}
                </div>
              )}
              {convertPreviewData.sap?.alreadySynced && (
                <div className="alert alert-info mt-3 mb-0">
                  This lead is already synced to SAP as {convertPreviewData.sap?.leadCode}.
                </div>
              )}
            </>
            );
          })()}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => {
              setShowConvertPreviewModal(false);
              setConvertPreviewData(null);
              setConvertPreviewLeadId(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="success"
            onClick={handleConfirmConvert}
            disabled={!convertPreviewData?.canProceed || isCreatingCustomer}
          >
            {isCreatingCustomer
              ? 'Converting...'
              : convertPreviewData?.sap?.action === 'link' &&
                  (convertPreviewData?.sap?.contactMismatch ||
                    convertPreviewData?.sap?.linkConfidence === 'low')
                ? 'Confirm link anyway'
                : 'Confirm Convert to SAP'}
          </Button>
        </Modal.Footer>
      </Modal>
      {/* Sync Preview / Confirmation Modal */}
      <Modal
        show={showSyncPreviewModal}
        onHide={closeSyncPreviewModal}
        size="lg"
        centered
        contentClassName="border-0 shadow"
      >
        <Modal.Header
          closeButton
          style={{
            background: 'linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem 0.375rem 0 0',
            padding: '1rem 1.5rem'
          }}
        >
          <Modal.Title className="d-flex align-items-center gap-2" style={{ color: 'white' }}>
            <RefreshCw size={24} />
            Review leads to sync
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ padding: '1.5rem' }}>
          {syncPreviewData && (
            <>
              <p className="text-muted mb-3">
                Only <strong>new</strong> Google Form responses are imported. Existing portal customers are never overwritten — manual corrections (e.g. email typos) stay as you saved them.
              </p>
              {syncPreviewData.totalResponses === 0 ? (
                <div className="text-center py-4 text-muted">
                  No responses found in the selected Google Form.
                </div>
              ) : (
                <>
                  <div className="mb-3 d-flex flex-wrap gap-2">
                    {(syncPreviewData.willSync?.length || 0) > 0 && (
                      <Badge bg="primary">{syncPreviewData.willSync.length} new</Badge>
                    )}
                    {(syncPreviewData.willSync?.length || 0) > 0 && (
                      <Badge bg="success">{selectedSyncResponseIds.size} selected</Badge>
                    )}
                    {(syncPreviewData.alreadyInListCount || 0) > 0 && (
                      <Badge bg="secondary">{syncPreviewData.alreadyInListCount} existing (skipped)</Badge>
                    )}
                    {(syncPreviewData.skippedExistingChangedCount || 0) > 0 && (
                      <Badge bg="info" text="dark">{syncPreviewData.skippedExistingChangedCount} differ in Google (not applied)</Badge>
                    )}
                    {(syncPreviewData.skippedMissingCount || 0) > 0 && (
                      <Badge bg="warning" text="dark">{syncPreviewData.skippedMissingCount} skipped (missing fields)</Badge>
                    )}
                    {(syncPreviewData.skippedEmailDuplicates?.length || 0) > 0 && (
                      <Badge bg="danger">{syncPreviewData.skippedEmailDuplicates.length} duplicate email (skipped)</Badge>
                    )}
                  </div>
                  {(syncPreviewData.skippedEmailDuplicates?.length || 0) > 0 && (
                    <div className="alert alert-warning mb-3">
                      <strong>Duplicate email/phone in portal</strong>
                      <ul className="mb-0 mt-2 ps-3 small">
                        {syncPreviewData.skippedEmailDuplicates.map((row) => (
                          <li key={`${row.email}-${row.existing_customer_code}`}>
                            {row.full_name || row.email} — already exists as{' '}
                            <Link href={`/customer-leads?highlight=${encodeURIComponent(row.existing_customer_code)}`}>
                              {row.existing_customer_code}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(syncPreviewData.willSync && syncPreviewData.willSync.length > 0) ? (
                    <>
                      <div className="mb-2 d-flex gap-2">
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => {
                            const ids = (syncPreviewData.willSync || [])
                              .map((r) => r.google_form_response_id)
                              .filter(Boolean);
                            setSelectedSyncResponseIds(new Set(ids));
                          }}
                        >
                          Select all
                        </Button>
                        <span className="text-muted">|</span>
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => setSelectedSyncResponseIds(new Set())}
                        >
                          Clear
                        </Button>
                      </div>
                      <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                        <table className="table table-sm table-hover mb-0">
                          <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                            <tr>
                              <th style={{ width: '40px' }}>
                                {(() => {
                                  const selectableIds = (syncPreviewData.willSync || [])
                                    .map((r) => r.google_form_response_id)
                                    .filter(Boolean);
                                  const allSelected = selectableIds.length > 0 &&
                                    selectableIds.every((id) => selectedSyncResponseIds.has(id));
                                  return (
                                    <input
                                      type="checkbox"
                                      checked={allSelected}
                                      onChange={() => {
                                        if (allSelected) {
                                          setSelectedSyncResponseIds(new Set());
                                        } else {
                                          setSelectedSyncResponseIds(new Set(selectableIds));
                                        }
                                      }}
                                      className="form-check-input"
                                    />
                                  );
                                })()}
                              </th>
                              <th>#</th>
                              <th>Action</th>
                              <th>Name</th>
                              <th>Email</th>
                              <th>Phone</th>
                              <th>Block/Unit</th>
                              <th>Submitted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {syncPreviewData.willSync.map((lead, idx) => {
                              const responseId = lead.google_form_response_id;
                              return (
                                <tr key={responseId || idx}>
                                  <td>
                                    {responseId ? (
                                      <input
                                        type="checkbox"
                                        checked={selectedSyncResponseIds.has(responseId)}
                                        onChange={() => handleSelectSyncResponse(responseId)}
                                        className="form-check-input"
                                      />
                                    ) : null}
                                  </td>
                                  <td>{idx + 1}</td>
                                  <td>
                                    <Badge bg="primary" className="text-uppercase">New</Badge>
                                  </td>
                                  <td>{lead.full_name || '–'}</td>
                                  <td>{lead.email || '–'}</td>
                                  <td>{lead.handphone || '–'}</td>
                                  <td>{[lead.block, lead.unit].filter(Boolean).join(' / ') || '–'}</td>
                                  <td>{lead.submitted_at ? format(new Date(lead.submitted_at), 'MMM d, yyyy HH:mm') : '–'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-3 text-muted">
                      No new leads to import. {(syncPreviewData.alreadyInListCount || 0) > 0
                        ? `${syncPreviewData.alreadyInListCount} existing response(s) in portal — your edits are preserved.`
                        : 'Nothing to sync.'}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer style={{ borderTop: '1px solid #e9ecef' }}>
          <Button variant="outline-secondary" onClick={closeSyncPreviewModal} disabled={syncConfirming}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirmSync}
            disabled={selectedSyncResponseIds.size === 0 || syncConfirming}
            className="d-flex align-items-center gap-2"
          >
            {syncConfirming ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <RefreshCw size={16} />
            )}
            Confirm Sync{selectedSyncResponseIds.size > 0 ? ` (${selectedSyncResponseIds.size})` : ''}
          </Button>
        </Modal.Footer>
      </Modal>
      {/* Detail View Modal */}
      <ResponseDetailsModal
        show={showModal}
        onClose={() => setShowModal(false)}
        response={selectedResponse}
        leadJobsByDate={leadJobsByDate}
        leadJobsLoading={leadJobsLoading}
        leadJobsError={leadJobsError}
        createJobsStatus={createJobsStatus}
        isCreatingCustomer={isCreatingCustomer || convertPreviewLoading}
        onRequestConvertPreview={handleOpenConvertPreview}
        onCreateCustomer={handleCreateCustomer}
        isCreatingJobs={isCreatingJobs}
        onCreateJobs={handleCreateJobsFromLead}
        isSyncedToSAP={isSyncedToSAP}
        sapVerifyStatus={sapVerifyStatus}
        onSyncComplete={() => fetchLeads()}
        portalDetailBundle={portalDetailBundle}
        portalDetailLoading={portalDetailLoading}
        portalDetailError={portalDetailError}
      />
      {/* Edit Lead Modal */}
      <Modal
        show={!!editingLead}
        onHide={handleCancelEdit}
        size="lg"
        centered
        contentClassName="border-0"
      >
        <Modal.Header 
          closeButton
          style={{
            background: 'linear-gradient(90deg, #FFA500 0%, #FF8C00 100%)',
            color: 'white',
            border: 'none',
            borderBottom: 'none',
            borderRadius: '0.375rem 0.375rem 0 0',
            padding: '1rem 1.5rem'
          }}
        >
          <Modal.Title>
            <div className="d-flex align-items-center gap-2">
              <Edit size={24} />
              <div>
                <h5 className="mb-0" style={{ color: 'white' }}>Edit Lead</h5>
                <small style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                  Update lead information
                </small>
              </div>
            </div>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ padding: '1.5rem' }}>
          {editingLead && !isPortalEditMode && isSyncedToSAP(responses.find(r => r.id === editingLead)) && (
            <div className="alert alert-warning d-flex align-items-center gap-2 mb-3" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>Editing Disabled:</strong> This lead has been synced to SAP. 
                Please make changes directly in SAP to maintain data consistency.
              </div>
            </div>
          )}
          <div>
            <Row className="mb-3">
              <Col sm={6}>
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  className="form-control"
                  value={editFormData.email || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  required
                />
              </Col>
              <Col sm={6}>
                <label className="form-label">First Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.firstName || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                />
              </Col>
            </Row>
            <Row className="mb-3">
              <Col sm={6}>
                <label className="form-label">Last Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.lastName || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                />
              </Col>
              <Col sm={6}>
                <label className="form-label">Full Name *</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.fullName || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  required
                />
                <small className="text-muted">Auto-filled from First + Last Name if empty</small>
              </Col>
            </Row>
            <Row className="mb-3">
              <Col sm={4}>
                <label className="form-label">Salutation</label>
                <select
                  className="form-select"
                  value={editFormData.salutation || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, salutation: e.target.value })}
                >
                  <option value="">Select</option>
                  <option value="Mr">Mr</option>
                  <option value="Ms">Ms</option>
                  <option value="Mrs">Mrs</option>
                </select>
              </Col>
              <Col sm={8}>
                <label className="form-label">Handphone</label>
                <input
                  type="tel"
                  className="form-control"
                  value={editFormData.handphone || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, handphone: e.target.value })}
                />
              </Col>
            </Row>
            <Row className="mb-3">
              <Col sm={4}>
                <label className="form-label">Block</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.block || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, block: e.target.value })}
                />
              </Col>
              <Col sm={4}>
                <label className="form-label">Unit</label>
                <input
                  type="text"
                  className="form-control"
                  value={editFormData.unit || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, unit: e.target.value })}
                />
              </Col>
              <Col sm={4}>
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={editFormData.status && ['PENDING', 'CONTACTED', 'CONVERTED', 'REJECTED', 'COMPLETED', 'Portal'].includes(editFormData.status) ? editFormData.status : 'PENDING'}
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                >
                  <option value="PENDING">Pending</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="Portal">Portal</option>
                </select>
              </Col>
            </Row>
            <Row className="mb-3">
              <Col sm={12}>
                <label className="form-label">Address</label>
                <textarea
                  className="form-control"
                  rows="2"
                  value={editFormData.address || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                />
              </Col>
            </Row>
            {!isPortalEditMode && (
              <>
                <Row className="mb-3">
                  <Col sm={6}>
                    <label className="form-label">First Service Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.firstServiceDate || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, firstServiceDate: e.target.value })}
                    />
                  </Col>
                  <Col sm={6}>
                    <label className="form-label">Second Service Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.secondServiceDate || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, secondServiceDate: e.target.value })}
                    />
                  </Col>
                </Row>
                <Row className="mb-3">
                  <Col sm={6}>
                    <label className="form-label">Third Service Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.thirdServiceDate || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, thirdServiceDate: e.target.value })}
                    />
                  </Col>
                  <Col sm={6}>
                    <label className="form-label">Fourth Service Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editFormData.fourthServiceDate || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, fourthServiceDate: e.target.value })}
                    />
                  </Col>
                </Row>
                <Row className="mb-3">
                  <Col sm={6}>
                    <label className="form-label">Time Slot</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editFormData.timeSlot || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, timeSlot: e.target.value })}
                      placeholder="e.g., AM - Time Slot: 9.30am - 12.30pm"
                    />
                  </Col>
                  <Col sm={6}>
                    <label className="form-label">Consent</label>
                    <div>
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={editFormData.agreedToTerms || false}
                          onChange={(e) => setEditFormData({ ...editFormData, agreedToTerms: e.target.checked })}
                        />
                        <label className="form-check-label">
                          Agreed to Terms
                        </label>
                      </div>
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={editFormData.personalInfoConsent || false}
                          onChange={(e) => setEditFormData({ ...editFormData, personalInfoConsent: e.target.checked })}
                        />
                        <label className="form-check-label">
                          Personal Info Consent
                        </label>
                      </div>
                    </div>
                  </Col>
                </Row>
              </>
            )}
            <Row className="mb-3">
              <Col sm={12}>
                <label className="form-label">Notes</label>
                <textarea
                  className="form-control"
                  rows="3"
                  value={editFormData.notes || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  placeholder="Additional notes about this lead..."
                />
              </Col>
            </Row>
          </div>
        </Modal.Body>
        <Modal.Footer style={{ borderTop: '1px solid #e9ecef' }}>
          <Button 
            variant="secondary" 
            onClick={handleCancelEdit}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={() => handleSaveEdit(editingLead)}
            disabled={
              saving || 
              !editFormData.email || 
              !editFormData.fullName ||
              (!isPortalEditMode && editingLead && isSyncedToSAP(responses.find(r => r.id === editingLead)))
            }
            title={
              !isPortalEditMode && editingLead && isSyncedToSAP(responses.find(r => r.id === editingLead))
                ? 'Cannot save: Lead has been synced to SAP'
                : undefined
            }
            style={{
              background: 'linear-gradient(90deg, #FFA500 0%, #FF8C00 100%)',
              border: 'none',
              borderRadius: '8px',
              padding: '0.5rem 1.5rem',
              opacity: (!isPortalEditMode && editingLead && isSyncedToSAP(responses.find(r => r.id === editingLead))) ? 0.6 : 1
            }}
          >
            {saving ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Saving...
              </>
            ) : (
              <>
                <Save size={16} className="me-2" />
                Save Changes
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        limit={3}
      />
    </Fragment>
  );
};

// Set layout to use dashboard layout
CustomerLeadsPage.Layout = DefaultDashboardLayout;

export default CustomerLeadsPage;

