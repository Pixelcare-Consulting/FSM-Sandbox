import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Card,
  Row,
  Col,
  Badge,
  Form,
  Button,
  Dropdown
} from 'react-bootstrap';
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from '../../../sub-components/dashboard/DashboardListStickySearch';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { format } from 'date-fns';
import { FaFilter, FaEllipsisV } from 'react-icons/fa';
import Link from 'next/link';
import { GeeksSEO } from 'widgets';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FaPlus } from 'react-icons/fa';
import Flatpickr from 'react-flatpickr';
import TablePagination from '../../../components/common/TablePagination';
import { Search, X as FeatherX } from 'react-feather';
import { useSettings } from '../../../contexts/SettingsContext';
import {
  FOLLOW_UP_PRIORITY_LABELS,
} from '../../../lib/followUps/followUpListSummary';
import { useFollowUpsListQuery, fetchFollowUpsList } from '../../../hooks/queries/useFollowUpsListQuery';
import { useEnterToSearch } from '../../../hooks/useEnterToSearch';

/** List / grouped table cell styles (aligned with company memos table polish). */
const FU_TH = {
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

const FU_TD = {
  fontSize: '14px',
  color: '#64748b',
  padding: '16px',
  verticalAlign: 'middle',
  borderBottom: '1px solid #f1f5f9',
};

const REALTIME_DEBOUNCE_MS = 2500;
const REALTIME_FULL_REFETCH_MIN_MS = 30_000;

const FollowUpsPage = () => {
  const router = useRouter();
  const realtimeDebounceRef = useRef(null);
  const [filters, setFilters] = useState({
    status: router.query.status || 'all',
    type: router.query.type || 'all',
    dateRange: {
      start: router.query.startDate || null,
      end: router.query.endDate || null
    },
    assignedWorker: router.query.workerId || 'all',
    followUpId: router.query.followUpId || '',
    /** @type {'all' | 'Low' | 'Normal' | 'High' | 'Urgent'} matches followups.priority labels */
    priority: 'all'
  });

  const {
    draft: customerSearchDraft,
    setDraft: setCustomerSearchDraft,
    applied: appliedCustomerSearch,
    clear: clearCustomerSearch,
    onKeyDown: onCustomerSearchKeyDown,
  } = useEnterToSearch();

  const {
    draft: jobNumberDraft,
    setDraft: setJobNumberDraft,
    applied: appliedJobNumber,
    clear: clearJobNumber,
    onKeyDown: onJobNumberKeyDown,
  } = useEnterToSearch();
  const [workers, setWorkers] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const { followUpTypes, followUpStatuses } = useSettings();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'
  const [expandedJobs, setExpandedJobs] = useState(new Set());

  // Add a useEffect to update filters when URL changes
  useEffect(() => {
    if (router.isReady) {
      setFilters(prev => ({
        ...prev,
        status: router.query.status || 'all',
        type: router.query.type || 'all',
        followUpId: router.query.followUpId || '',
        assignedWorker: router.query.workerId || 'all'
      }));
    }
  }, [router.isReady, router.query]);

  // Fetch active technicians for filter dropdown (assignable API)
  useEffect(() => {
    const fetchWorkers = async () => {
      try {
        const res = await fetch('/api/workers/assignable?limit=200', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Assignable workers failed (${res.status})`);
        const payload = await res.json();
        const workersData = (payload.workers || [])
          .map((worker) => ({
            workerId: worker.technicianId,
            fullName: worker.fullName || worker.username || '',
            email: worker.username || '',
            role: 'TECHNICIAN',
            status: 'ACTIVE',
            username: worker.username || '',
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        setWorkers(workersData);
      } catch (error) {
        console.error('Error fetching workers:', error);
      }
    };
    fetchWorkers();
  }, []);


  const followUpsParams = useMemo(
    () => ({
      page: currentPage,
      limit: itemsPerPage,
      followUpId: filters.followUpId,
      status: filters.status,
      type: filters.type,
      assignedWorker: filters.assignedWorker,
      customerSearch: appliedCustomerSearch,
      jobNumber: appliedJobNumber,
      priority: filters.priority,
      dateFrom: filters.dateRange.start,
      dateTo: filters.dateRange.end,
    }),
    [currentPage, itemsPerPage, filters, appliedCustomerSearch, appliedJobNumber]
  );

  const {
    data: followUpsData,
    isLoading: loading,
    refetch: refetchFollowUps,
    patchRow,
    removeRow,
  } = useFollowUpsListQuery(followUpsParams);

  const patchRowRef = useRef(patchRow);
  const removeRowRef = useRef(removeRow);
  const refetchFollowUpsRef = useRef(refetchFollowUps);
  patchRowRef.current = patchRow;
  removeRowRef.current = removeRow;
  refetchFollowUpsRef.current = refetchFollowUps;

  const lastFullRefetchAtRef = useRef(0);

  const jobs = followUpsData?.followUps || [];
  const totalCount = followUpsData?.totalCount ?? 0;

  const formatStatusForDisplay = (status) => {
    if (!status) return 'N/A';
    return status.replace(/_/g, ' ');
  };

  // Realtime: batched patch/remove with throttled full refetch (mirrors list-jobs).
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    const pendingEventsRef = { current: [] };

    const throttledRefetch = () => {
      const now = Date.now();
      if (now - lastFullRefetchAtRef.current < REALTIME_FULL_REFETCH_MIN_MS) {
        return;
      }
      lastFullRefetchAtRef.current = now;
      void refetchFollowUpsRef.current();
    };

    const patchOrRemoveRow = async (payload) => {
      if (cancelled) return;

      const eventType = payload.eventType;
      const rowId = payload.new?.id || payload.old?.id;

      if (eventType === 'DELETE' || payload.new?.deleted_at) {
        removeRowRef.current(rowId);
        return;
      }

      if (!rowId) {
        throttledRefetch();
        return;
      }

      try {
        const singlePayload = await fetchFollowUpsList({
          followUpId: rowId,
          limit: 1,
          page: 1,
        });
        const row = singlePayload.followUps?.[0];

        if (!row) {
          removeRowRef.current(rowId);
          return;
        }

        patchRowRef.current(row, eventType);
      } catch (patchErr) {
        console.warn('Follow-up realtime patch failed:', patchErr);
        throttledRefetch();
      }
    };

    const processBatchedEvents = async (events) => {
      for (const payload of events) {
        await patchOrRemoveRow(payload);
      }
    };

    const realtimeChannel = supabase
      .channel('followups-page')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'followups',
          filter: 'deleted_at=is.null',
        },
        (payload) => {
          pendingEventsRef.current.push(payload);
          if (realtimeDebounceRef.current) {
            clearTimeout(realtimeDebounceRef.current);
          }
          realtimeDebounceRef.current = setTimeout(() => {
            const batch = pendingEventsRef.current;
            pendingEventsRef.current = [];
            void processBatchedEvents(batch);
          }, REALTIME_DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
      supabase.removeChannel(realtimeChannel);
    };
  }, []);

  const getStatusBadge = (status) => {
    if (!status) {
      return (
        <Badge 
          style={{ 
            backgroundColor: '#e2e8f0',
            color: '#64748b',
            fontSize: '0.75rem',
            padding: '0.35em 0.65em',
            fontWeight: '500',
            borderRadius: '6px'
          }}
        >
          N/A
        </Badge>
      );
    }
    
    const statusUpper = status.toUpperCase();
    let backgroundColor = '#e2e8f0';
    let textColor = '#64748b';
    
    // Match list-jobs / StatusBadge follow-up status colors (new + legacy)
    switch (statusUpper) {
      case 'LOGGED':
        backgroundColor = '#fef3c7';
        textColor = '#f97316';
        break;
      case 'IN PROGRESS':
      case 'IN_PROGRESS':
        backgroundColor = '#dbeafe';
        textColor = '#3b82f6';
        break;
      case 'QUOTATION IN PROGRESS':
      case 'QUOTATION_IN_PROGRESS':
        backgroundColor = '#ede9fe';
        textColor = '#6d28d9';
        break;
      case 'QUOTATION SENT':
      case 'QUOTATION_SENT':
        backgroundColor = '#ccfbf1';
        textColor = '#0f766e';
        break;
      case 'PENDING':
        backgroundColor = '#f1f5f9';
        textColor = '#64748b';
        break;
      case 'COMPLETED':
        backgroundColor = '#f1f5f9';
        textColor = '#64748b';
        break;
      case 'CLOSED':
        backgroundColor = '#f1f5f9';
        textColor = '#64748b';
        break;
      case 'CANCELLED':
        backgroundColor = '#fee2e2';
        textColor = '#ef4444';
        break;
      case 'OPEN':
        backgroundColor = '#dbeafe';
        textColor = '#1e40af';
        break;
      default:
        backgroundColor = '#e2e8f0';
        textColor = '#64748b';
    }
    
    return (
      <span 
        style={{
          fontSize: '0.75rem',
          padding: '0.35em 0.65em',
          fontWeight: '500',
          borderRadius: '6px',
          backgroundColor: backgroundColor,
          color: textColor,
          border: 'none',
          display: 'inline-block'
        }}
      >
        {formatStatusForDisplay(status)}
      </span>
    );
  };

  // Add this helper function to get type badge - following settings color coding
  const getTypeBadge = (typeName) => {
    if (!typeName) {
      return (
        <span 
       
        >
         
        </span>
      );
    }

    const type = followUpTypes.find(t => 
      t.name.toLowerCase() === typeName.toLowerCase()
    );
    
    // Use light background with colored text and border (matching settings pattern)
    const typeColor = type?.color || '#6b7280';
    const backgroundColor = `${typeColor}20`; // 20 hex = ~12% opacity for light background
    const textColor = typeColor;
    const borderColor = typeColor;
    
    return (
      <span 
        style={{ 
          backgroundColor: backgroundColor,
          color: textColor,
          border: `1px solid ${borderColor}`,
          fontSize: '0.75rem',
          padding: '0.35em 0.65em',
          fontWeight: '500',
          borderRadius: '6px',
          display: 'inline-block'
        }}
      >
        {typeName}
      </span>
    );
  };

  // First, add this helper function for priority colors
  const getPriorityBadge = (priority) => {
    const priorityNum = Number(priority);
    
    const getPriorityDetails = (num) => {
      switch (num) {
        case 1: return { label: 'Low', color: 'success', bgColor: '#10b981', textColor: '#ffffff' };
        case 2: return { label: 'Normal', color: 'secondary', bgColor: '#6b7280', textColor: '#ffffff' };
        case 3: return { label: 'High', color: 'warning', bgColor: '#f59e0b', textColor: '#ffffff' };
        case 4: return { label: 'Urgent', color: 'danger', bgColor: '#ef4444', textColor: '#ffffff' };
        default: return { label: 'Normal', color: 'secondary', bgColor: '#6b7280', textColor: '#ffffff' };
      }
    };

    const details = getPriorityDetails(priorityNum);
    return (
      <Badge 
        style={{ 
          fontSize: '0.85rem',
          padding: '0.4em 0.7em',
          fontWeight: '500',
          backgroundColor: details.bgColor,
          color: details.textColor,
          borderRadius: '6px',
          border: 'none'
        }}
      >
        {details.label}
      </Badge>
    );
  };

  // Server-side filtering via /api/follow-ups/list-summary; group current page for grouped view.
  const filteredJobs = jobs;

  // Group filtered follow-ups by job (grouped view respects the same filters)
  const groupedByJob = filteredJobs.reduce((acc, followUp) => {
    const jobKey = followUp.jobID || followUp.jobNumber;
    if (!acc[jobKey]) {
      acc[jobKey] = {
        jobID: followUp.jobID,
        jobNumber: followUp.jobNumber,
        customerName: followUp.customerName,
        customerID: followUp.customerID,
        followUps: []
      };
    }
    acc[jobKey].followUps.push(followUp);
    return acc;
  }, {});

  const filteredGroupedJobs = Object.entries(groupedByJob)
    .map(([, jobData]) => ({
      ...jobData,
      followUps: jobData.followUps.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      )
    }))
    .sort((a, b) => {
      const latestA = a.followUps[0]?.createdAt || '';
      const latestB = b.followUps[0]?.createdAt || '';
      return new Date(latestB) - new Date(latestA);
    });

  // List view: server paginates; grouped view paginates job groups on the current page.
  const paginatedJobs = filteredJobs;

  const paginatedGroupedJobs = filteredGroupedJobs.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 when filters or view mode change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.status, filters.type, filters.assignedWorker, filters.dateRange, appliedCustomerSearch, appliedJobNumber, filters.priority, viewMode]);

  const hasActiveFilters = !!(
    appliedCustomerSearch ||
    appliedJobNumber ||
    (filters.assignedWorker && filters.assignedWorker !== 'all') ||
    (filters.status && filters.status !== 'all') ||
    (filters.type && filters.type !== 'all') ||
    (filters.priority && filters.priority !== 'all') ||
    filters.dateRange?.start ||
    filters.dateRange?.end
  );

  const clearAllFilters = () => {
    clearCustomerSearch();
    clearJobNumber();
    setFilters(prev => ({
      ...prev,
      assignedWorker: 'all',
      status: 'all',
      type: 'all',
      priority: 'all',
      dateRange: { start: null, end: null }
    }));
    setCurrentPage(1);
    if (router.isReady && (router.query.status || router.query.type || router.query.workerId || router.query.startDate || router.query.endDate)) {
      router.replace('/dashboard/follow-ups', undefined, { shallow: true });
    }
  };

  return (
    <Fragment>
      <GeeksSEO title="Follow-Ups | SAS M&E - SAP B1 | Portal" />

      {/* Search filters + table share one Col so sticky has room to stick (matches customers list) */}
      <Row>
        <Col md={12} xs={12} className="mb-5">
          <DashboardListStickySearch style={STICKY_SEARCH_GRADIENT_BLUE} className="mb-2">
              {/* Customer Search Row */}
              <Row className="align-items-center mb-2">
                <Col md={12}>
                  <div className="d-flex align-items-center gap-3">
                    <div style={{ minWidth: '140px' }}>
                      <h6 className="mb-0 text-white d-flex align-items-center">
                        <Search className="me-2" size={18} aria-hidden />
                        Search Filters
                      </h6>
                      <small className="text-white" style={{ opacity: 0.9, fontSize: '0.75rem' }}>
                        Press Enter to search
                      </small>
                    </div>
                    <div className="flex-grow-1">
                      <Form.Control
                        type="text"
                        value={customerSearchDraft}
                        onChange={(e) => setCustomerSearchDraft(e.target.value)}
                        onKeyDown={onCustomerSearchKeyDown}
                        placeholder="🔍 Search customer name..."
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
                    {hasActiveFilters && (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={clearAllFilters}
                        className="d-flex align-items-center gap-1"
                        style={{ 
                          minWidth: '110px',
                          fontWeight: '500',
                          borderRadius: '6px'
                        }}
                        title="Clear all filters"
                      >
                        <FeatherX size={14} />
                        Clear filters
                      </Button>
                    )}
                  </div>
                </Col>
              </Row>

              {/* Additional Filters Row */}
              <Row>
                <Col md={12}>
                  <div className="d-flex align-items-start gap-3 flex-wrap">
                    {/* Job Number Search */}
                    <div style={{ flex: '1', minWidth: '250px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Job Number
                      </label>
                      <div style={{ position: 'relative' }}>
                        <i className="fe fe-search" style={{ 
                          position: 'absolute', 
                          left: '12px', 
                          top: '50%', 
                          transform: 'translateY(-50%)', 
                          zIndex: 10, 
                          pointerEvents: 'none',
                          color: '#64748b',
                          fontSize: '18px'
                        }}></i>
                        <Form.Control
                          type="text"
                          placeholder="🔍 Search job number..."
                          value={jobNumberDraft}
                          onChange={(e) => setJobNumberDraft(e.target.value)}
                          onKeyDown={onJobNumberKeyDown}
                          style={{ 
                            paddingLeft: '40px', 
                            fontSize: '0.95rem',
                            padding: '0.65rem 1rem',
                            border: 'none',
                            borderRadius: '8px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            fontWeight: '400'
                          }}
                        />
                      </div>
                    </div>

                    {/* Technician Filter */}
                    <div style={{ width: '200px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Technician
                      </label>
                      <Form.Select 
                        value={filters.assignedWorker}
                        onChange={(e) => setFilters(prev => ({ ...prev, assignedWorker: e.target.value }))}
                        style={{ 
                          fontSize: '0.95rem',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400'
                        }}
                      >
                        <option value="all">All Technicians</option>
                        {workers.map(worker => (
                          <option key={worker.workerId} value={worker.workerId}>
                            {worker.fullName}
                          </option>
                        ))}
                      </Form.Select>
                    </div>

                    {/* Status Filter */}
                    <div style={{ width: '150px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Status
                      </label>
                      <Form.Select 
                        value={filters.status}
                        onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                        style={{ 
                          fontSize: '0.95rem',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400'
                        }}
                      >
                        <option value="all">All Status</option>
                        {followUpStatuses.map((statusName) => (
                          <option key={statusName} value={statusName}>
                            {statusName}
                          </option>
                        ))}
                      </Form.Select>
                    </div>

                    {/* Type Filter */}
                    <div style={{ width: '150px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Type
                      </label>
                      <Form.Select
                        value={filters.type}
                        onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
                        style={{ 
                          fontSize: '0.95rem',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400'
                        }}
                      >
                        <option value="all">All Types</option>
                        {followUpTypes.map(type => (
                          <option key={type.id} value={type.name}>
                            {type.name}
                          </option>
                        ))}
                      </Form.Select>
                    </div>

                    {/* Priority Filter */}
                    <div style={{ width: '170px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Priority
                      </label>
                      <Form.Select
                        value={filters.priority}
                        onChange={(e) => setFilters(prev => ({ ...prev, priority: e.target.value }))}
                        aria-label="Filter by priority"
                        style={{
                          fontSize: '0.95rem',
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '500'
                        }}
                      >
                        <option value="all">All priorities</option>
                        {Object.entries(FOLLOW_UP_PRIORITY_LABELS).map(([value, label]) => (
                          <option key={value} value={label}>
                            {label}
                          </option>
                        ))}
                      </Form.Select>
                    </div>

                    {/* Start Date Filter */}
                    <div style={{ width: '160px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        Start Date
                      </label>
                      <div style={{ position: 'relative' }}>
                        <i className="fe fe-calendar text-white" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', zIndex: 1, pointerEvents: 'none', opacity: 0.8 }}></i>
                        <Flatpickr
                          value={filters.dateRange.start ? new Date(filters.dateRange.start + 'T00:00:00') : null}
                          options={{
                            dateFormat: 'd/m/Y',
                            altInput: true,
                            altFormat: 'd/m/Y',
                            placeholder: '📅 Start Date'
                          }}
                          className="form-control"
                          style={{ 
                            paddingLeft: '40px', 
                            fontSize: '0.95rem',
                            padding: '0.65rem 1rem 0.65rem 2.5rem',
                            width: '100%',
                            border: 'none',
                            borderRadius: '8px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            fontWeight: '400'
                          }}
                          onChange={(selectedDates, dateStr) => {
                            if (selectedDates && selectedDates.length > 0) {
                              const date = selectedDates[0];
                              const year = date.getFullYear();
                              const month = String(date.getMonth() + 1).padStart(2, '0');
                              const day = String(date.getDate()).padStart(2, '0');
                              setFilters(prev => ({
                                ...prev,
                                dateRange: { ...prev.dateRange, start: `${year}-${month}-${day}` }
                              }));
                            } else {
                              setFilters(prev => ({
                                ...prev,
                                dateRange: { ...prev.dateRange, start: null }
                              }));
                            }
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* End Date Filter */}
                    <div style={{ width: '160px' }}>
                      <label className="text-white mb-1" style={{ fontSize: '0.75rem', fontWeight: '500', display: 'block', opacity: 0.9 }}>
                        End Date
                      </label>
                      <div style={{ position: 'relative' }}>
                        <i className="fe fe-calendar text-white" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', zIndex: 1, pointerEvents: 'none', opacity: 0.8 }}></i>
                        <Flatpickr
                          value={filters.dateRange.end ? new Date(filters.dateRange.end + 'T00:00:00') : null}
                          options={{
                            dateFormat: 'd/m/Y',
                            altInput: true,
                            altFormat: 'd/m/Y',
                            placeholder: '📅 End Date'
                          }}
                          className="form-control"
                          style={{ 
                            paddingLeft: '40px', 
                            fontSize: '0.95rem',
                            padding: '0.65rem 1rem 0.65rem 2.5rem',
                            width: '100%',
                            border: 'none',
                            borderRadius: '8px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            fontWeight: '400'
                          }}
                          onChange={(selectedDates, dateStr) => {
                            if (selectedDates && selectedDates.length > 0) {
                              const date = selectedDates[0];
                              const year = date.getFullYear();
                              const month = String(date.getMonth() + 1).padStart(2, '0');
                              const day = String(date.getDate()).padStart(2, '0');
                              setFilters(prev => ({
                                ...prev,
                                dateRange: { ...prev.dateRange, end: `${year}-${month}-${day}` }
                              }));
                            } else {
                              setFilters(prev => ({
                                ...prev,
                                dateRange: { ...prev.dateRange, end: null }
                              }));
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </Col>
              </Row>
          </DashboardListStickySearch>

      {/* {process.env.NODE_ENV === 'development' && (
        <Row className="mb-3">
          <Col>
            <Button 
              variant="outline-secondary" 
              size="sm"
              onClick={() => setShowDebug(!showDebug)}
            >
              Toggle Debug Info
            </Button>
            {showDebug && (
              <div className="mt-2 p-3 bg-light rounded">
                <pre>{JSON.stringify({ filters, jobsCount: jobs.length }, null, 2)}</pre>
              </div>
            )}
          </Col>
        </Row>
      )} */}

      <Card className="border-0 shadow-sm follow-ups-main-card">
        <Card.Header className="bg-transparent border-0 px-3 py-2 pb-0">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <h5 className="mb-0" style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b' }}>
              Follow-ups
              {viewMode === 'list' && (
                <span className="ms-2 text-muted" style={{ fontSize: '0.875rem', fontWeight: '400' }}>
                  ({totalCount} {totalCount === 1 ? 'follow-up' : 'follow-ups'})
                </span>
              )}
              {viewMode === 'grouped' && (
                <span className="ms-2 text-muted" style={{ fontSize: '0.875rem', fontWeight: '400' }}>
                  ({filteredGroupedJobs.length} {filteredGroupedJobs.length === 1 ? 'job' : 'jobs'}, {totalCount} {totalCount === 1 ? 'follow-up' : 'follow-ups'})
                </span>
              )}
            </h5>
            <div
              className="follow-ups-view-switch"
              role="group"
              aria-label="Follow-up view mode"
            >
              <button
                type="button"
                className={`follow-ups-view-switch-btn ${viewMode === 'list' ? 'is-active' : ''}`}
                onClick={() => {
                  setViewMode('list');
                  setCurrentPage(1);
                }}
                aria-pressed={viewMode === 'list'}
              >
                <i className="fe fe-list" aria-hidden />
                List view
              </button>
              <button
                type="button"
                className={`follow-ups-view-switch-btn ${viewMode === 'grouped' ? 'is-active' : ''}`}
                onClick={() => {
                  setViewMode('grouped');
                  setCurrentPage(1);
                }}
                aria-pressed={viewMode === 'grouped'}
              >
                <i className="fe fe-layers" aria-hidden />
                Group by job
              </button>
            </div>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-5">
              <p className="mb-0 text-muted">No follow-ups found matching the selected filters</p>
            </div>
          ) : viewMode === 'grouped' ? (
            <div className="p-2">
              {paginatedGroupedJobs.map((jobGroup, groupIndex) => {
                const isExpanded = expandedJobs.has(jobGroup.jobID || jobGroup.jobNumber);
                const hasMultipleFollowUps = jobGroup.followUps.length > 1;
                
                return (
                  <Card key={jobGroup.jobID || jobGroup.jobNumber} className="mb-3 border" style={{ borderRadius: '8px' }}>
                    <Card.Header 
                      className="bg-light border-0 cursor-pointer"
                      onClick={() => {
                        const newExpanded = new Set(expandedJobs);
                        const jobKey = jobGroup.jobID || jobGroup.jobNumber;
                        if (isExpanded) {
                          newExpanded.delete(jobKey);
                        } else {
                          newExpanded.add(jobKey);
                        }
                        setExpandedJobs(newExpanded);
                      }}
                      style={{ cursor: 'pointer', padding: '0.5rem 0.75rem' }}
                    >
                      <div className="d-flex justify-content-between align-items-center">
                        <div className="d-flex align-items-center gap-3">
                          <i 
                            className={`fe fe-chevron-${isExpanded ? 'down' : 'right'}`}
                            style={{ fontSize: '1rem', color: '#64748b' }}
                          ></i>
                          <div>
                            <div className="d-flex align-items-center gap-2">
                              <Link 
                                href={`/dashboard/jobs/${jobGroup.jobID}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: '600', fontSize: '1rem' }}
                              >
                                {jobGroup.jobNumber}
                              </Link>
                              {hasMultipleFollowUps && (
                                <Badge 
                                  bg="info" 
                                  style={{ 
                                    fontSize: '0.75rem',
                                    padding: '0.25em 0.6em',
                                    borderRadius: '12px'
                                  }}
                                >
                                  {jobGroup.followUps.length} follow-ups
                                </Badge>
                              )}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.875rem', marginTop: '2px' }}>
                              {jobGroup.customerName || 'Unknown Customer'}
                            </div>
                          </div>
                        </div>
                        <div className="d-flex align-items-baseline gap-2 flex-wrap justify-content-end" style={{ fontSize: '0.875rem' }}>
                          <span style={{ fontWeight: 600, color: '#2563eb' }}>Latest</span>
                          <span style={{ color: '#64748b' }}>
                            {format(new Date(jobGroup.followUps[0]?.createdAt || new Date()), 'dd/MM/yyyy HH:mm')}
                          </span>
                        </div>
                      </div>
                    </Card.Header>
                    {isExpanded && (
                      <Card.Body className="p-0">
                        <div className="follow-ups-data-table table-responsive px-2 px-md-3 pb-2">
                          <table className="table table-hover mb-0 align-middle">
                            <thead>
                              <tr>
                                <th style={{ ...FU_TH, width: 48, textAlign: 'center' }}>#</th>
                                <th style={FU_TH}>Type</th>
                                <th style={FU_TH}>Status</th>
                                <th style={FU_TH}>Priority</th>
                                <th style={FU_TH}>Technician</th>
                                <th style={FU_TH}>CSO</th>
                                <th style={FU_TH}>Created</th>
                                <th style={FU_TH}>Updated</th>
                              </tr>
                            </thead>
                            <tbody>
                              {jobGroup.followUps.map((followUp, fuIndex) => (
                                <tr key={followUp.id} className="fu-table-row">
                                  <td style={{
                                    ...FU_TD,
                                    width: 48,
                                    textAlign: 'center',
                                    color: '#94a3b8',
                                    fontWeight: 600,
                                    fontVariantNumeric: 'tabular-nums',
                                  }}>
                                    {fuIndex + 1}
                                  </td>
                                  <td style={FU_TD}>{getTypeBadge(followUp.type)}</td>
                                  <td style={FU_TD}>{getStatusBadge(followUp.status)}</td>
                                  <td style={FU_TD}>{getPriorityBadge(followUp.priority)}</td>
                                  <td style={FU_TD}>
                                    {followUp.assignedTechnicians && followUp.assignedTechnicians.length > 0 ? (
                                      <div className="d-flex align-items-center">
                                        <div className="worker-avatars d-flex align-items-center">
                                          {followUp.assignedTechnicians.slice(0, 3).map((technician, idx) => {
                                            const technicianName = technician.technicianName || technician.full_name || 'Unknown';
                                            return (
                                              <OverlayTrigger
                                                key={technician.technicianId || `${followUp.id}-${idx}`}
                                                placement="top"
                                                overlay={<Tooltip>{technicianName}</Tooltip>}
                                              >
                                                <div 
                                                  className="worker-avatar"
                                                  style={{
                                                    marginLeft: idx > 0 ? '-8px' : '0',
                                                    zIndex: followUp.assignedTechnicians.length - idx,
                                                    position: 'relative',
                                                  }}
                                                >
                                                  <div
                                                    style={{
                                                      width: '28px',
                                                      height: '28px',
                                                      borderRadius: '50%',
                                                      border: '2px solid #fff',
                                                      backgroundColor: '#e2e8f0',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      fontSize: '12px',
                                                      color: '#64748b',
                                                    }}
                                                  >
                                                    {technicianName.charAt(0)?.toUpperCase() || '?'}
                                                  </div>
                                                </div>
                                              </OverlayTrigger>
                                            );
                                          })}
                                          {followUp.assignedTechnicians.length > 3 && (
                                            <OverlayTrigger
                                              placement="top"
                                              overlay={
                                                <Tooltip>
                                                  {followUp.assignedTechnicians.slice(3).map(t => t.technicianName || t.full_name || 'Unknown').join(', ')}
                                                </Tooltip>
                                              }
                                            >
                                              <div
                                                className="remaining-count"
                                                style={{
                                                  width: '28px',
                                                  height: '28px',
                                                  borderRadius: '50%',
                                                  backgroundColor: '#cbd5e1',
                                                  border: '2px solid #fff',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  marginLeft: '-8px',
                                                  fontSize: '11px',
                                                  fontWeight: '500',
                                                  color: '#475569',
                                                  zIndex: 0,
                                                }}
                                              >
                                                +{followUp.assignedTechnicians.length - 3}
                                              </div>
                                            </OverlayTrigger>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <span style={{ color: '#64748b' }}>-</span>
                                    )}
                                  </td>
                                  <td style={FU_TD}>{followUp.csoName || '-'}</td>
                                  <td style={FU_TD}>{format(new Date(followUp.createdAt), 'dd/MM/yyyy HH:mm')}</td>
                                  <td style={FU_TD}>{format(new Date(followUp.updatedAt), 'dd/MM/yyyy HH:mm')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card.Body>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="px-3 px-md-4 pb-4">
            <div className="follow-ups-data-table table-responsive">
              <table className="table table-hover mb-0 align-middle">
                <thead>
                  <tr>
                    <th style={{ ...FU_TH, width: 56, textAlign: 'center' }}>#</th>
                    <th style={FU_TH}>Job No.</th>
                    <th style={FU_TH}>Customer</th>
                    <th style={FU_TH}>Type</th>
                    <th style={FU_TH}>Status</th>
                    <th style={FU_TH}>Priority</th>
                    <th style={FU_TH}>Technician</th>
                    <th style={FU_TH}>CSO</th>
                    <th style={FU_TH}>Created</th>
                    <th style={FU_TH}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedJobs.map((followUp, index) => {
                    const hasMultipleForJob = followUp.jobFollowUpCount > 1;
                    return (
                    <tr key={followUp.id} className="fu-table-row">
                      <td style={{
                        ...FU_TD,
                        width: 56,
                        textAlign: 'center',
                        color: '#94a3b8',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {(currentPage - 1) * itemsPerPage + index + 1}
                      </td>
                      <td style={{ ...FU_TD, color: '#0f172a' }}>
                        <div className="d-flex align-items-center gap-2">
                          <Link 
                            href={`/dashboard/jobs/${followUp.jobID}`}
                            style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: '600' }}
                          >
                            {followUp.jobNumber}
                          </Link>
                          {hasMultipleForJob && (
                            <OverlayTrigger
                              placement="top"
                              overlay={
                                <Tooltip>
                                  This job has {followUp.jobFollowUpCount} follow-ups. Click to view all.
                                </Tooltip>
                              }
                            >
                              <Badge 
                                bg="info" 
                                className="rounded-pill"
                                style={{ 
                                  fontSize: '0.7rem',
                                  padding: '0.2em 0.5em',
                                  cursor: 'pointer'
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  router.push(`/dashboard/jobs/${followUp.jobID}#follow-ups`);
                                }}
                              >
                                {followUp.jobFollowUpCount}
                              </Badge>
                            </OverlayTrigger>
                          )}
                        </div>
                      </td>
                      <td style={FU_TD}>
                        {followUp.customerID ? (
                          <Link 
                            href={`/customers/view/${followUp.customerID}`}
                            style={{ color: '#64748b', textDecoration: 'none' }}
                          >
                            {followUp.customerName || '-'}
                          </Link>
                        ) : (
                          <span>{followUp.customerName || '-'}</span>
                        )}
                      </td>
                      <td style={FU_TD}>{getTypeBadge(followUp.type)}</td>
                      <td style={FU_TD}>{getStatusBadge(followUp.status)}</td>
                      <td style={FU_TD}>{getPriorityBadge(followUp.priority)}</td>
                      <td style={FU_TD}>
                        {followUp.assignedTechnicians && followUp.assignedTechnicians.length > 0 ? (
                            <div className="d-flex align-items-center">
                              <div className="worker-avatars d-flex align-items-center">
                                {followUp.assignedTechnicians.slice(0, 3).map((technician, idx) => {
                                  const technicianName = technician.technicianName || technician.full_name || 'Unknown';
                                  return (
                                    <OverlayTrigger
                                      key={technician.technicianId || `${followUp.id}-${idx}`}
                                      placement="top"
                                      overlay={<Tooltip>{technicianName}</Tooltip>}
                                    >
                                      <div 
                                        className="worker-avatar"
                                        style={{
                                          marginLeft: idx > 0 ? '-8px' : '0',
                                          zIndex: followUp.assignedTechnicians.length - idx,
                                          position: 'relative',
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            border: '2px solid #fff',
                                            backgroundColor: '#e2e8f0',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '14px',
                                            color: '#64748b',
                                          }}
                                        >
                                          {technicianName.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                      </div>
                                    </OverlayTrigger>
                                  );
                                })}
                                {followUp.assignedTechnicians.length > 3 && (
                                  <OverlayTrigger
                                    placement="top"
                                    overlay={
                                      <Tooltip>
                                        {followUp.assignedTechnicians.slice(3).map(t => t.technicianName || t.full_name || 'Unknown').join(', ')}
                                      </Tooltip>
                                    }
                                  >
                                    <div
                                      className="remaining-count"
                                      style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '50%',
                                        backgroundColor: '#cbd5e1',
                                        border: '2px solid #fff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        marginLeft: '-8px',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                        color: '#475569',
                                        zIndex: 0,
                                      }}
                                    >
                                      +{followUp.assignedTechnicians.length - 3}
                                    </div>
                                  </OverlayTrigger>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: '#64748b' }}>-</span>
                          )}
                      </td>
                      <td style={FU_TD}>{followUp.csoName || '-'}</td>
                      <td style={FU_TD}>{format(new Date(followUp.createdAt), 'dd/MM/yyyy HH:mm')}</td>
                      <td style={FU_TD}>{format(new Date(followUp.updatedAt), 'dd/MM/yyyy HH:mm')}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
          )}
          {!loading && (viewMode === 'grouped' ? filteredGroupedJobs.length > 0 : totalCount > 0) && (
            <div className="border-top">
              <TablePagination
                currentPage={currentPage}
                totalPages={Math.ceil((viewMode === 'grouped' ? filteredGroupedJobs.length : totalCount) / itemsPerPage)}
                totalItems={viewMode === 'grouped' ? filteredGroupedJobs.length : totalCount}
                onPageChange={(newPage) => setCurrentPage(newPage)}
                disabled={loading}
              />
            </div>
          )}
        </Card.Body>
      </Card>
        </Col>
      </Row>

      <style jsx global>{`
        .follow-ups-view-switch {
          display: inline-flex;
          align-items: stretch;
          gap: 2px;
          padding: 3px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
        }

        .follow-ups-view-switch-btn {
          border: 1px solid transparent;
          background: transparent;
          color: #64748b;
          font-weight: 500;
          font-size: 0.8125rem;
          padding: 0.45rem 0.9rem;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }

        .follow-ups-view-switch-btn:hover:not(.is-active) {
          background: rgba(219, 234, 254, 0.35);
          color: #334155;
        }

        .follow-ups-view-switch-btn.is-active {
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
          box-shadow: none;
        }

        .follow-ups-view-switch-btn.is-active:hover {
          background: #dbeafe;
          color: #1e40af;
        }

        .follow-ups-view-switch-btn:focus-visible {
          outline: 2px solid #93c5fd;
          outline-offset: 1px;
        }

        .follow-ups-view-switch-btn .fe {
          font-size: 14px;
          opacity: 0.95;
        }

        .follow-ups-view-switch-btn.is-active .fe {
          color: #2563eb;
        }

        .follow-ups-data-table .fu-table-row {
          transition: all 0.2s ease;
        }
        .follow-ups-data-table .fu-table-row:hover {
          background-color: #f8fafc;
          box-shadow: inset 0 1px 0 #e2e8f0;
        }

        .table tbody tr {
          transition: all 0.2s ease;
        }
        
        .table tbody tr:hover {
          background-color: #f8fafc;
        }
        
        .table thead th {
          border-top: none;
          font-weight: 600;
        }
        
        .form-control:focus,
        .form-select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 0.2rem rgba(59, 130, 246, 0.25);
        }
        
        .form-control,
        .form-select {
          border-color: #e2e8f0;
          transition: all 0.2s ease;
        }
        
        .form-control:hover,
        .form-select:hover {
          border-color: #cbd5e1;
        }
        
        .badge {
          border-radius: 6px;
          font-weight: 500;
        }
      `}</style>
    </Fragment>
  );
};

export default FollowUpsPage; 