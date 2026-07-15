import React, {
  Fragment,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import {
  Col,
  Row,
  Card,
  Button,
  OverlayTrigger,
  Tooltip,
  Badge,
  Breadcrumb,
  Placeholder,
  Spinner,
  Form,
  Collapse,
  Modal,
  ProgressBar,
  Alert,
  Accordion,
} from "react-bootstrap";
import { useRouter } from "next/router";
import {
  Eye,
  EnvelopeFill,
  TelephoneFill,
  GeoAltFill,
  CurrencyExchange,
  HouseFill,
  CheckCircleFill,
  XLg,
  ChevronLeft,
  ChevronRight,
  FilterCircle,
  Calendar,
  ListUl,
  Trash,
} from "react-bootstrap-icons";
import {
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X as FeatherX,
} from "react-feather";
import Flatpickr from "react-flatpickr";
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from "../../../sub-components/dashboard/DashboardListStickySearch";
import { GeeksSEO } from "widgets";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { clientAuditLog } from "../../../utils/clientAuditLog";
import { jobService, userService } from "../../../lib/supabase/database";
import {
  fetchJobStatuses,
  formatJobStatusDisplayLabel,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
  readCachedJobStatuses,
  writeCachedJobStatuses,
  isJobStatusesCacheFresh,
} from "../../../utils/jobStatusSettings";
import { getJobStatusFilterDbValues } from "../../../lib/jobs/jobStatusFilter";
import Link from "next/link";
import { FaUser, FaPlus, FaClipboard, FaBriefcase, FaTasks } from "react-icons/fa";
import TablePagination from "../../../components/common/TablePagination";
import Swal from "sweetalert2";
import ResponsiveTable from "./_components/ResponsiveTable";
import { jobDisplayCustomerName, parseEmbeddedCustomerName } from '../../../lib/utils/embeddedCustomerName';
import { uniqueActiveTechnicianJobs } from '../../../lib/jobs/uniqueActiveTechnicianJobs';
import { softDeleteFollowUpsForJobs } from '../../../lib/followUps/followUpListSummary';
import { useQueryClient } from 'react-query';
import {
  useJobsListQuery,
  invalidateJobsListServerCache,
  clearJobsListSessionCache,
} from '../../../hooks/queries/useJobsListQuery';
import { queryKeys } from '../../../lib/cache/queryKeys';
import {
  getDefaultJobsDateRange,
  isUnboundedJobsDateRange,
  persistJobsDateFilter,
  readPersistedJobsDateFilter,
} from '../../../lib/jobs/defaultJobsDateRange';
import { textMatchesAllSearchTokens } from '../../../lib/utils/multiTokenSearch';
import { formatSingaporeDate, formatSingaporeTimeHm } from '../../../lib/utils/singaporeDateTime';
import { htmlToPlainText } from '../../../lib/utils/htmlToPlainText';

const JOBS_REALTIME_DEBOUNCE_MS = 2500;
const JOBS_REALTIME_FULL_REFETCH_MIN_MS = 30_000;

function formatDateYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getSyncDatePresetRange(preset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'all') return { dateFrom: null, dateTo: null };
  if (preset === 'today') {
    const ymd = formatDateYmd(today);
    return { dateFrom: ymd, dateTo: ymd };
  }
  if (preset === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const ymd = formatDateYmd(y);
    return { dateFrom: ymd, dateTo: ymd };
  }
  if (preset === 'last7') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { dateFrom: formatDateYmd(start), dateTo: formatDateYmd(today) };
  }
  if (preset === 'last30') {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { dateFrom: formatDateYmd(start), dateTo: formatDateYmd(today) };
  }
  return { dateFrom: null, dateTo: null };
}

function formatSyncFilterLabel(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return 'All unsynced jobs (no date filter)';
  if (dateFrom && dateTo && dateFrom === dateTo) return `Created on ${dateFrom}`;
  if (dateFrom && dateTo) return `Created ${dateFrom} → ${dateTo}`;
  if (dateFrom) return `Created from ${dateFrom}`;
  return `Created until ${dateTo}`;
}

const SYNC_DATE_PRESETS = [
  { id: 'all', label: 'All unsynced' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom range' },
];

const getLocationDisplayValue = (location) => {
  if (!location) return "";

  let rawLocation = location?.locationName || location?.location_name || "";

  if (!rawLocation && typeof location === "object") {
    const addressParts = [
      location.building,
      location.street,
      location.address,
      location.city,
      location.state,
      location.state_province,
      location.zip_code,
      location.country_name,
      location.country,
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean);

    rawLocation = addressParts.join(", ");
  }

  if (!rawLocation && typeof location === "string") {
    rawLocation = location;
  }

  if (!rawLocation) return "";

  const normalized = String(rawLocation).trim().replace(/\s+/g, " ");
  const unitMatch = normalized.match(/^(#(?:[A-Z0-9]+-)*[A-Z0-9]+)\s+(.+)$/i);

  if (!unitMatch) {
    return normalized;
  }

  const [, unitNumber, remainder] = unitMatch;
  const segments = remainder
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!segments.length) {
    return normalized;
  }

  const [primarySegment, ...otherSegments] = segments;
  return [primarySegment, unitNumber, ...otherSegments].join(", ");
};

/** Rows per page in the jobs table (server-paginated via list-summary API). */
const JOBS_TABLE_ROWS_PER_PAGE = 25;
/** Set to true to show the Job address sync action in the jobs list header. */
const SHOW_JOB_ADDRESS_SYNC_BUTTON = false;
/** Set true to re-enable manual SAP job sync button (debug only). Hidden while cron handles sync. */
const SHOW_JOB_SYNC_SAP_BUTTON = false;

/**
 * Convert technical SAP/sync error messages into user-friendly text for the Sync to SAP result modal.
 */
function getFriendlySyncErrorMessage(technicalError) {
  if (!technicalError || typeof technicalError !== 'string') return 'Sync failed for this job.';
  const raw = technicalError;
  const lower = raw.toLowerCase();

  if (lower.includes("value too long") && lower.includes("cardcode")) {
    return "Customer code is too long for SAP. Please use a shorter customer code or contact your administrator.";
  }
  if (lower.includes("value too long") && lower.includes("activity")) {
    return "One or more fields are too long for SAP. Please shorten the job title, description, or related data.";
  }
  if (lower.includes("value too long")) {
    return "A field value is too long for SAP. Please shorten the data and try again.";
  }
  if (lower.includes("cardcode") && (lower.includes("not found") || lower.includes("invalid"))) {
    return "Customer code not recognized in SAP. Please check the customer is set up in SAP B1.";
  }
  if (lower.includes("customer not found")) {
    return "Customer not found. Please ensure the customer exists and is linked correctly.";
  }
  if (lower.includes("could not find a relationship") || lower.includes("pgrst200")) {
    return "Job data could not be loaded for sync. Please try again or contact support.";
  }
  if (lower.includes("sap session") || lower.includes("session required") || lower.includes("401")) {
    return "SAP session expired or not available. Please log in to SAP Business One and try again.";
  }
  if (lower.includes("reminddate") && lower.includes("invalid")) {
    return "SAP rejected the activity reminder date. Schedule or recontact date may be invalid.";
  }
  if (lower.includes("recontact") && lower.includes("invalid")) {
    return "SAP rejected the job schedule (recontact) date. Check job schedule dates.";
  }
  if (lower.includes("400 bad request")) {
    return "SAP rejected the data (invalid or too long). Check the job and customer details.";
  }
  if (lower.includes("500") || lower.includes("server error")) {
    return "SAP server error. Please try again later or contact support.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("econnrefused")) {
    return "Could not reach SAP. Check your connection and try again.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "SAP took too long to respond. Run Sync again — failed jobs stay unsynced and will be retried.";
  }

  return "Sync failed for this job. Please check the job and customer data or contact support.";
}

/** Categorize SAP sync errors for grouped help text in the result modal. */
function categorizeSyncError(technicalError) {
  const lower = (technicalError || '').toLowerCase();
  if (lower.includes('cardcode') || lower.includes('customer not found')) return 'customer';
  if (lower.includes('value too long')) return 'field_length';
  if (lower.includes('sap session') || lower.includes('session required') || lower.includes('401')) return 'session';
  if (lower.includes('reminddate') || lower.includes('recontact')) return 'schedule_date';
  if (lower.includes('400 bad request')) return 'validation';
  if (lower.includes('500') || lower.includes('server error')) return 'sap_server';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused')) return 'network';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('pgrst200') || lower.includes('could not find a relationship')) return 'data_load';
  return 'generic';
}

const SAP_SYNC_FIX_GUIDES = {
  customer: {
    title: 'Customer code not recognized in SAP',
    summary: 'SAP could not find the customer (CardCode) linked to these jobs.',
    steps: [
      'Click the job number to open it in a new tab and note the customer CardCode.',
      'In SAP B1 → Business Partners, confirm that CardCode exists and is active.',
      'Portal-only codes (CP#####) must be created or matched in SAP before sync will succeed.',
      'Update the job’s customer if wrong, then run Sync to SAP again (use Today / date filter for failed jobs only).',
    ],
    links: [
      { label: 'Portal customers', href: '/dashboard/customers/list' },
      { label: 'SAP customers', href: '/dashboard/customers/list-sap-api' },
    ],
  },
  field_length: {
    title: 'Field too long for SAP',
    summary: 'A job field exceeds SAP’s maximum length.',
    steps: [
      'Open the job and shorten the title, description, or address fields.',
      'Avoid very long pasted text in job notes before syncing.',
      'Save the job, then sync again.',
    ],
  },
  session: {
    title: 'SAP session expired',
    summary: 'Your SAP Business One login session is missing or expired.',
    steps: [
      'Log out and log back in to the portal (this refreshes the SAP session).',
      'Confirm you can open SAP data in the portal (e.g. SAP customers list).',
      'Run Sync to SAP again.',
    ],
  },
  schedule_date: {
    title: 'Invalid schedule / reminder date',
    summary: 'SAP rejected a date on the job schedule or activity.',
    steps: [
      'Open the job and check schedule start/end and follow-up dates.',
      'Remove invalid or placeholder dates, then save and sync again.',
    ],
  },
  validation: {
    title: 'SAP rejected job data',
    summary: 'SAP returned a validation error (400).',
    steps: [
      'Open the job and verify customer, status, and required fields.',
      'Use Details on the error row for the technical message.',
      'Fix data and sync again.',
    ],
  },
  sap_server: {
    title: 'SAP server error',
    summary: 'SAP B1 service layer returned a server error.',
    steps: [
      'Wait a few minutes and try again.',
      'If it persists, check SAP B1 service layer logs or contact your SAP admin.',
    ],
  },
  network: {
    title: 'Connection problem',
    summary: 'The portal could not reach SAP.',
    steps: [
      'Check VPN / network access to SAP Service Layer.',
      'Confirm SAP B1 is running, then retry sync.',
    ],
  },
  timeout: {
    title: 'SAP response timeout',
    summary: 'SAP Service Layer did not respond in time (often under heavy load).',
    steps: [
      'Click Sync again — only unsynced jobs are processed.',
      'Sync fewer jobs at once using a date filter (e.g. Today).',
      'If timeouts persist, ask your SAP admin to check Service Layer performance.',
    ],
  },
  data_load: {
    title: 'Could not load job for sync',
    summary: 'Portal could not read full job data before sending to SAP.',
    steps: [
      'Refresh the jobs list and try sync again.',
      'If one job keeps failing, open it and save once, then retry.',
    ],
  },
  generic: {
    title: 'Sync failed',
    summary: 'Review each failed job and the technical Details link.',
    steps: [
      'Open the job, verify customer and schedule data.',
      'Fix issues, save, then run Sync to SAP again for those jobs.',
    ],
  },
};

function summarizeSyncErrorsByCategory(errors = []) {
  const counts = {};
  for (const err of errors) {
    const cat = categorizeSyncError(err.error);
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count, guide: SAP_SYNC_FIX_GUIDES[category] || SAP_SYNC_FIX_GUIDES.generic }))
    .sort((a, b) => b.count - a.count);
}

const SYNC_RESULT_ERRORS_PAGE_SIZE = 10;

const ViewJobs = () => {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [usersData, setUsersData] = useState([]);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  const [editLoading, setEditLoading] = useState(false); // New state for edit loading
  const [syncToSapLoading, setSyncToSapLoading] = useState(false);
  const [syncToSapElapsed, setSyncToSapElapsed] = useState(0);
  const [syncToSapProgress, setSyncToSapProgress] = useState(null);
  const [syncLiveFeed, setSyncLiveFeed] = useState([]);
  const syncFeedRef = useRef(null);
  const [syncSapConfirm, setSyncSapConfirm] = useState({
    show: false,
    loading: false,
    totalJobs: 0,
    syncedJobs: 0,
    unsyncedJobs: 0,
    totalUnsyncedAll: 0,
    hasDateFilter: false,
    concurrency: 4,
    error: null,
  });
  const [syncDateFilter, setSyncDateFilter] = useState({
    preset: 'all',
    dateFrom: null,
    dateTo: null,
  });
  const [syncResultModal, setSyncResultModal] = useState({
    show: false,
    synced: 0,
    failed: 0,
    errors: [],
    errorMessage: null,
    totalUnsynced: null,
    processed: null,
    remainingUnsynced: null,
  });
  const [syncResultErrorsPage, setSyncResultErrorsPage] = useState(1);

  useEffect(() => {
    if (syncResultModal.show) {
      setSyncResultErrorsPage(1);
    }
  }, [syncResultModal.show]);
  const [syncCustomerLoading, setSyncCustomerLoading] = useState(false);
  const [syncCustomerElapsed, setSyncCustomerElapsed] = useState(0);
  const [syncCustomerModal, setSyncCustomerModal] = useState({
    show: false,
    updated: 0,
    matched: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    message: '',
    errorMessage: null,
  });
  const [syncAddressLoading, setSyncAddressLoading] = useState(false);
  const [syncAddressElapsed, setSyncAddressElapsed] = useState(0);
  const [syncAddressModal, setSyncAddressModal] = useState({
    show: false,
    updated: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    totalWithAddressTag: 0,
    totalLocationCandidates: 0,
    updatedFromTag: 0,
    updatedFromLocation: 0,
    message: '',
    errorMessage: null,
  });
  const [filters, setFilters] = useState(() => {
    const persistedDate = readPersistedJobsDateFilter();
    return {
      status: "all",
      priority: "all",
      dateRange: persistedDate ?? getDefaultJobsDateRange(),
    };
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [jobStatuses, setJobStatuses] = useState(
    () => readCachedJobStatuses() || getDefaultJobStatuses()
  );
  const jobStatusesRef = useRef(jobStatuses);
  const jobStatusesReadyRef = useRef(Boolean(readCachedJobStatuses()?.length));

  useEffect(() => {
    jobStatusesRef.current = jobStatuses;
  }, [jobStatuses]);

  const loadJobStatuses = useCallback(async ({ wait = false } = {}) => {
    const applyStatuses = async () => {
      const statuses = await fetchJobStatuses();
      if (Array.isArray(statuses) && statuses.length > 0) {
        setJobStatuses(statuses);
        writeCachedJobStatuses(statuses);
        jobStatusesReadyRef.current = true;
        jobStatusesRef.current = statuses;
        return statuses;
      }
      return jobStatusesRef.current;
    };

    if (wait || !jobStatusesReadyRef.current) {
      return applyStatuses();
    }

    if (!isJobStatusesCacheFresh()) {
      void applyStatuses();
    }
    return jobStatusesRef.current;
  }, []);

  useEffect(() => {
    void loadJobStatuses({ wait: !jobStatusesReadyRef.current });
  }, [loadJobStatuses]);

  const canClearJobFilters = useMemo(
    () =>
      Boolean(
        (appliedSearch && appliedSearch.trim() !== "") ||
        filters.status !== "all" ||
        filters.priority !== "all" ||
        !isUnboundedJobsDateRange(filters.dateRange)
      ),
    [appliedSearch, filters]
  );

  const clearAllJobFilters = useCallback(() => {
    const clearedRange = { start: null, end: null };
    persistJobsDateFilter(clearedRange);
    setSearchDraft("");
    setAppliedSearch("");
    setFilters({
      status: "all",
      priority: "all",
      dateRange: clearedRange,
    });
  }, []);

  const applySearchDraft = useCallback(() => {
    setAppliedSearch(searchDraft.trim());
  }, [searchDraft]);

  const queryClient = useQueryClient();

  // Reset to page 0 when filters change
  useEffect(() => {
    setCurrentPage(0);
  }, [appliedSearch, filters.status, filters.priority, filters.dateRange.start, filters.dateRange.end]);

  const [currentPage, setCurrentPage] = useState(0);
  const [perPage, setPerPage] = useState(JOBS_TABLE_ROWS_PER_PAGE);
  const [selectedRows, setSelectedRows] = useState([]);

  const statusValues = useMemo(() => {
    if (filters.status === 'all') return '';
    const statusList =
      Array.isArray(jobStatuses) && jobStatuses.length > 0 ? jobStatuses : jobStatusesRef.current;
    const dbValues = getJobStatusFilterDbValues(filters.status, statusList);
    return dbValues.length > 0 ? dbValues.join(',') : '';
  }, [filters.status, jobStatuses]);

  const [statusFilterReady, setStatusFilterReady] = useState(
    () => jobStatusesReadyRef.current
  );

  useEffect(() => {
    if (filters.status === 'all') {
      setStatusFilterReady(true);
      return;
    }
    setStatusFilterReady(false);
    void loadJobStatuses({ wait: true }).then(() => setStatusFilterReady(true));
  }, [filters.status, loadJobStatuses]);

  const jobsQueryParams = useMemo(
    () => ({
      page: currentPage + 1,
      limit: perPage,
      search: appliedSearch || '',
      status: filters.status !== 'all' ? filters.status : '',
      statusValues,
      priority: filters.priority !== 'all' ? filters.priority : '',
      dateFrom: filters.dateRange.start || '',
      dateTo: filters.dateRange.end || '',
    }),
    [
      currentPage,
      perPage,
      appliedSearch,
      filters.status,
      filters.priority,
      filters.dateRange.start,
      filters.dateRange.end,
      statusValues,
    ]
  );

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isFetching: jobsFetching,
    error: jobsQueryError,
    refetch: refetchJobs,
    patchRow,
    removeRow,
  } = useJobsListQuery(jobsQueryParams, { enabled: statusFilterReady });

  const patchRowRef = useRef(patchRow);
  const removeRowRef = useRef(removeRow);
  const refetchJobsRef = useRef(refetchJobs);
  patchRowRef.current = patchRow;
  removeRowRef.current = removeRow;
  refetchJobsRef.current = refetchJobs;

  const lastFullRefetchAtRef = useRef(0);

  const handleRefreshJobsList = useCallback(async () => {
    invalidateJobsListServerCache();
    clearJobsListSessionCache(queryKeys.jobsList(jobsQueryParams));
    lastFullRefetchAtRef.current = Date.now();
    await refetchJobs();
  }, [jobsQueryParams, refetchJobs]);

  const prevRoutePathRef = useRef(null);

  useEffect(() => {
    const onRouteChangeStart = () => {
      prevRoutePathRef.current = router.asPath.split('?')[0];
    };
    const onRouteChangeComplete = (url) => {
      const pathname = url.split('?')[0];
      const prevPath = prevRoutePathRef.current ?? '';
      if (
        pathname === '/dashboard/jobs/list-jobs' &&
        prevPath === '/dashboard/jobs/create-jobs'
      ) {
        void refetchJobs();
      }
    };

    router.events.on('routeChangeStart', onRouteChangeStart);
    router.events.on('routeChangeComplete', onRouteChangeComplete);
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart);
      router.events.off('routeChangeComplete', onRouteChangeComplete);
    };
  }, [router, refetchJobs]);

  const jobs = jobsData?.jobs || [];
  const jobsTotalCount = jobsData?.totalCount ?? 0;

  useEffect(() => {
    if (jobsTotalCount <= 0) {
      if (currentPage !== 0) setCurrentPage(0);
      return;
    }
    const maxPage = Math.max(0, Math.ceil(jobsTotalCount / perPage) - 1);
    if (currentPage > maxPage) setCurrentPage(maxPage);
  }, [jobsTotalCount, perPage, currentPage]);

  const isInitialLoad = jobsLoading && !jobsData;
  const isRefreshing = jobsLoading && Boolean(jobsData);
  const showTable =
    (jobsData?.jobs?.length ?? 0) > 0 || (!jobsLoading && jobsTotalCount > 0);
  const error = jobsQueryError?.message ?? null;

  const refreshJobs = useCallback(() => {
    queryClient.invalidateQueries(queryKeys.jobsList(jobsQueryParams));
  }, [queryClient, jobsQueryParams]);

  // Server-side filters applied via /api/jobs/list-summary
  const filteredJobs = jobs;

  useEffect(() => {
    setSelectedRows([]);
  }, [jobsQueryParams]);

  const [orderBy, setOrderBy] = useState(null);
  const [order, setOrder] = useState('asc');

  /** Display-only label: show "Normal" for stored value Medium (filter/data unchanged). */
  const getPriorityDisplayLabel = (priority) => {
    if (priority == null || priority === "") return priority;
    const u = String(priority).trim().toUpperCase();
    if (u === "MEDIUM") return "Normal";
    return String(priority);
  };

  const getPriorityBadge = (priority) => {
    if (!priority) return <Badge bg="secondary">N/A</Badge>;
    
    const priorityUpper = priority.toUpperCase();
    let bgColor = "secondary";
    let textColor = "#fff";
    
    switch (priorityUpper) {
      case "HIGH":
        bgColor = "danger";
        break;
      case "MEDIUM":
        bgColor = "warning";
        textColor = "#000";
        break;
      case "LOW":
        bgColor = "info";
        break;
      case "URGENT":
        bgColor = "danger";
        break;
      default:
        bgColor = "secondary";
    }
    
    return (
      <Badge 
        bg={bgColor}
        style={{
          fontSize: "0.75rem",
          padding: "0.35em 0.65em",
          fontWeight: "500",
          borderRadius: "6px",
          color: textColor
        }}
      >
        {getPriorityDisplayLabel(priority)}
      </Badge>
    );
  };

  const getStatusFromSettings = (statusValue) => {
    if (!statusValue) return null;
    const key = String(statusValue).toUpperCase().replace(/\s+/g, "_");
    const byValue = jobStatuses.find((s) => (s.value || "").toUpperCase() === key);
    if (byValue) return byValue;
    const nameMatch = String(statusValue).trim();
    return jobStatuses.find((s) => (s.name || "").toLowerCase() === nameMatch.toLowerCase()) || null;
  };

  const getStatusBadge = (status) => {
    if (!status) return <span className="badge bg-secondary">N/A</span>;
    const displayText = getJobStatusLabelFromList(status, jobStatuses);
    const bgColor = getJobStatusColorFromList(status, jobStatuses) ?? "var(--bs-secondary)";
    return (
      <span
        className="badge"
        style={{
          fontSize: "0.75rem",
          padding: "0.35em 0.65em",
          fontWeight: "500",
          borderRadius: "6px",
          backgroundColor: bgColor,
          color: "#fff",
          border: "none",
          display: "inline-block",
          maxWidth: "100%",
          whiteSpace: "normal",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          lineHeight: 1.25,
          textAlign: "center",
          overflow: "visible",
        }}
      >
        {displayText}
      </span>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return formatSingaporeDate(dateString) || "N/A";
  };

  const formatTime = (time) => {
    if (!time) return "";
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const formattedHour = (hour % 12 || 12).toString().padStart(2, '0');
    return `${formattedHour}:${minutes} ${ampm}`;
  };


  const AssignedWorkerCell = ({ value }) => {
    return (
      <div className="d-flex align-items-center">
        <FaUser className="me-2" />
        <span>{value?.name || "Unassigned"}</span>
      </div>
    );
  };

  // Handle sort change
  const handleSortChange = (columnId, newOrder) => {
    setOrderBy(columnId);
    setOrder(newOrder);
  };

  // Handle selection change
  const handleSelectionChange = (selectedIds) => {
    setSelectedRows(selectedIds);
  };

  // Convert rowSelection object to array for bulk operations
  const getSelectedJobIds = () => {
    return selectedRows.map(id => {
      const job = filteredJobs.find(j => (j.id || filteredJobs.indexOf(j)) === id);
      return job?.id;
    }).filter(Boolean);
  };

  // Handle single job delete
  const handleDeleteJob = async (job) => {
    const deleteResult = await Swal.fire({
      title: "Are you sure?",
      text: `Do you want to delete job #${job.jobNo}? This action cannot be undone.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
    });

    if (deleteResult.isConfirmed) {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error("Supabase client not available");
        }

        // Soft delete by setting deleted_at timestamp
        const deletedAt = new Date().toISOString();
        const { error } = await supabase
          .from('jobs')
          .update({ deleted_at: deletedAt })
          .eq('id', job.id);

        if (error) {
          throw error;
        }

        await softDeleteFollowUpsForJobs(supabase, [job.id], deletedAt);

        void clientAuditLog({
          action: 'JOB_DELETE',
          category: 'job',
          entityType: 'job',
          entityId: job.id,
          entityLabel: job.jobNo || job.job_number,
          description: `Job ${job.jobNo || job.job_number} deleted`,
          details: { job_id: job.id, job_number: job.jobNo || job.job_number },
        });

        Swal.fire("Deleted!", "The job has been removed.", "success");
        
        removeRow(job.id);
        invalidateJobsListServerCache();

        // Clear selection if this job was selected
        setSelectedRows(prev => prev.filter(id => id !== job.id));
      } catch (error) {
        console.error("Delete error:", error);
        Swal.fire(
          "Error!",
          "There was a problem removing the job.",
          "error"
        );
      }
    }
  };

  // Handle bulk delete
  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) {
      Swal.fire({
        icon: "info",
        title: "No Selection",
        text: "Please select at least one job to delete.",
      });
      return;
    }

    // Get selected jobs from all filtered jobs (not just current page)
    const selectedJobs = filteredJobs.filter(job => selectedRows.includes(job.id));
    
    const deleteResult = await Swal.fire({
      title: "Are you sure?",
      text: `Do you want to delete ${selectedJobs.length} job${selectedJobs.length > 1 ? 's' : ''}? This action cannot be undone.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: `Yes, delete ${selectedJobs.length} job${selectedJobs.length > 1 ? 's' : ''}!`,
    });

    if (deleteResult.isConfirmed) {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error("Supabase client not available");
        }

        // Soft delete all selected jobs
        const jobIds = selectedJobs.map((job) => job.id);
        const deletedAt = new Date().toISOString();
        const { error } = await supabase
          .from('jobs')
          .update({ deleted_at: deletedAt })
          .in('id', jobIds);

        if (error) {
          throw error;
        }

        await softDeleteFollowUpsForJobs(supabase, jobIds, deletedAt);

        for (const deletedJob of selectedJobs) {
          void clientAuditLog({
            action: 'JOB_DELETE',
            category: 'job',
            entityType: 'job',
            entityId: deletedJob.id,
            entityLabel: deletedJob.jobNo || deletedJob.job_number,
            description: `Job ${deletedJob.jobNo || deletedJob.job_number} bulk deleted`,
            details: { job_id: deletedJob.id, job_number: deletedJob.jobNo || deletedJob.job_number, bulk: true },
          });
        }

        Swal.fire(
          "Deleted!",
          `${selectedJobs.length} job${selectedJobs.length > 1 ? 's have' : ' has'} been removed.`,
          "success"
        );

        for (const deletedJob of selectedJobs) {
          removeRow(deletedJob.id);
        }

        invalidateJobsListServerCache();

        // Clear selection
        setSelectedRows([]);
      } catch (error) {
        console.error("Bulk delete error:", error);
        Swal.fire(
          "Error!",
          "There was a problem removing the jobs.",
          "error"
        );
      }
    }
  };

  // Sort and paginate data
  const sortedAndPaginatedJobs = useMemo(() => {
    let sorted = [...filteredJobs];
    
    // Apply sorting
    if (orderBy) {
      sorted.sort((a, b) => {
        let aValue, bValue;
        
        // Get values based on column accessor
        switch (orderBy) {
          case 'jobNo':
            aValue = a.jobNo || '';
            bValue = b.jobNo || '';
            break;
          case 'description':
            aValue = htmlToPlainText(a.description || '');
            bValue = htmlToPlainText(b.description || '');
            break;
          case 'customerName':
            aValue = a.customerName || a.customer?.customer_name || '';
            bValue = b.customerName || b.customer?.customer_name || '';
            break;
          case 'location':
            aValue = getLocationDisplayValue(a.location);
            bValue = getLocationDisplayValue(b.location);
            break;
          case 'jobStatus':
            aValue = a.jobStatus || '';
            bValue = b.jobStatus || '';
            break;
          case 'priority':
            aValue = a.priority || '';
            bValue = b.priority || '';
            break;
          case 'scheduled_start':
            aValue = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
            bValue = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
            break;
          default:
            aValue = a[orderBy] || '';
            bValue = b[orderBy] || '';
        }
        
        // Compare values
        if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        
        if (aValue < bValue) return order === 'asc' ? -1 : 1;
        if (aValue > bValue) return order === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    // Server already paginated — sort current page only
    return sorted;
  }, [filteredJobs, orderBy, order]);

  // MUI Table columns definition — wrapped in useMemo so render functions always close
  // over the latest jobStatuses and don't stale-capture the initial gray default values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const muiColumns = useMemo(() => [
    {
      id: "jobNo",
      label: "Job No.",
      accessor: "jobNo",
      important: true,
      sortable: true,
      width: "6%",
      render: (row, value) => <span>{value || ""}</span>,
    },
    {
      id: "description",
      label: "Description",
      accessor: "description",
      important: true,
      sortable: true,
      width: "16%",
      render: (row, value) => {
        const rawDescription = value || "No description available";
        const cleanDescription = htmlToPlainText(rawDescription);
        
        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                <div style={{ maxWidth: "320px", whiteSpace: "normal" }}>
                  {cleanDescription}
                </div>
              </Tooltip>
            }
          >
            <div 
              style={{ 
                maxWidth: "100%",
                fontSize: "0.875rem",
                color: "#64748b",
                whiteSpace: "normal",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                lineHeight: 1.35,
              }}
            >
              {cleanDescription || "No description available"}
            </div>
          </OverlayTrigger>
        );
      },
    },
    {
      id: "customerName",
      label: "Customer",
      accessor: "customerName",
      important: true,
      sortable: true,
      width: "7%",
      render: (row, value) => {
        const customerName = value || row.customer?.customer_name || '';
        const customerCode = row.customerCode || row.customer?.customer_code;
        const isUnmatched = row.customerUnmatched;

        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                {isUnmatched
                  ? 'No SAP customer match — name from AIFM import. All Customer names from AIFM import are marked as AIFM.'
                  : 'View Customer Details'}
              </Tooltip>
            }
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (customerCode) {
                  try {
                    router.push(`/customers/view/${customerCode}`);
                  } catch (error) {
                    console.error('Navigation Error:', error);
                  }
                }
              }}
              style={{
                cursor: customerCode ? 'pointer' : 'default',
                color: customerCode ? '#3b82f6' : isUnmatched ? '#f59e0b' : 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                transition: 'all 0.2s ease',
                flexWrap: 'wrap',
                minWidth: 0,
                wordBreak: 'break-word',
              }}
              className="customer-link"
            >
              <FaUser size={14} style={{ color: isUnmatched ? '#f59e0b' : undefined }} className={isUnmatched ? '' : 'text-muted'} />
              <span style={{ fontStyle: isUnmatched ? 'italic' : 'normal' }}>
                {customerName || 'N/A'}
              </span>
              {isUnmatched && (
                <span
                  style={{
                    fontSize: '0.65rem',
                    background: '#fef3c7',
                    color: '#92400e',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  AIFM
                </span>
              )}
            </div>
          </OverlayTrigger>
        );
      },
    },
    {
      id: "location",
      label: "Location",
      accessor: "location",
      important: false,
      sortable: true,
      width: "6%",
      render: (row, value) => {
        const locationName = getLocationDisplayValue(value);
        return (
          <span style={{ wordBreak: 'break-word', lineHeight: 1.35 }}>{locationName || 'No location'}</span>
        );
      },
    },
    {
      id: "jobStatus",
      label: "Job Status",
      accessor: "jobStatus",
      important: true,
      sortable: true,
      width: "6%",
      render: (row, value) => getStatusBadge(value),
    },
    {
      id: "followUps",
      label: "Follow-up Status",
      accessor: "followUps",
      important: false,
      sortable: false,
      width: "4.5%",
      render: (row, value) => {
        const followUps = row.followUps || value || {};

        if (!followUps || Object.keys(followUps).length === 0) {
          return (
            <Badge
              bg="light"
              style={{
                fontSize: "0.75rem",
                padding: "0.35em 0.65em",
                fontWeight: "500",
                borderRadius: "6px",
                color: "#64748b",
                display: "inline-block",
                maxWidth: "100%",
                whiteSpace: "normal",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
                lineHeight: 1.25,
                textAlign: "center",
                hyphens: "auto",
              }}
            >
              No Follow-up
            </Badge>
          );
        }

        const sortedFollowUps = Object.entries(followUps)
          .map(([id, followUp]) => ({
            id,
            ...followUp,
            createdAt: followUp.createdAt ? new Date(followUp.createdAt) : new Date(0)
          }))
          .sort((a, b) => b.createdAt - a.createdAt);

        const lastFollowUp = sortedFollowUps[0];
        const status = lastFollowUp.status || "N/A";
        const statusUpper = String(status).replace(/_+/g, " ").toUpperCase();
        
        let backgroundColor = "#e2e8f0";
        let textColor = "#64748b";
        
        switch (statusUpper) {
          case "LOGGED":
            backgroundColor = "#fef3c7";
            textColor = "#f97316";
            break;
          case "IN PROGRESS":
          case "IN_PROGRESS":
            backgroundColor = "#dbeafe";
            textColor = "#3b82f6";
            break;
          case "PENDING":
            backgroundColor = "#f1f5f9";
            textColor = "#64748b";
            break;
          case "COMPLETED":
            backgroundColor = "#f1f5f9";
            textColor = "#64748b";
            break;
          case "CLOSED":
            backgroundColor = "#dcfce7";
            textColor = "#166534";
            break;
          case "OPEN":
            backgroundColor = "#dbeafe";
            textColor = "#1e40af";
            break;
          case "CANCELLED":
            backgroundColor = "#fee2e2";
            textColor = "#ef4444";
            break;
          default:
            backgroundColor = "#e2e8f0";
            textColor = "#64748b";
        }
        
        return (
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.35em 0.65em",
              fontWeight: "500",
              borderRadius: "6px",
              backgroundColor: backgroundColor,
              color: textColor,
              border: "none",
              display: "inline-block",
              maxWidth: "100%",
              whiteSpace: "normal",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
              lineHeight: 1.25,
              textAlign: "center",
            }}
          >
            {formatJobStatusDisplayLabel(status)}
          </span>
        );
      },
    },
    {
      id: "priority",
      label: "Priority",
      accessor: "priority",
      important: true,
      sortable: true,
      width: "5%",
      render: (row, value) => getPriorityBadge(value),
    },
    {
      id: "assignedWorkers",
      label: "Assigned Technician",
      accessor: "assignedWorkers",
      important: false,
      sortable: false,
      width: "6%",
      render: (row, value) => {
        const technicians = value || [];
        const displayLimit = 3;
        const remainingCount = technicians.length > displayLimit ? technicians.length - displayLimit : 0;
        
        return (
          <div className="d-flex align-items-center">
            <div className="worker-avatars d-flex align-items-center">
              {technicians.slice(0, displayLimit).map((technician, index) => {
                const technicianName = technician.technicianName || technician.technician?.full_name || 'Unknown';
                return (
                  <OverlayTrigger
                    key={technician.technicianId || index}
                    placement="top"
                    overlay={<Tooltip>{technicianName}</Tooltip>}
                  >
                    <div 
                      className="worker-avatar"
                      style={{
                        marginLeft: index > 0 ? '-8px' : '0',
                        zIndex: technicians.length - index,
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
              {remainingCount > 0 && (
                <OverlayTrigger
                  placement="top"
                  overlay={
                    <Tooltip>
                      {technicians.slice(displayLimit).map(t => t.technicianName || 'Unknown').join(', ')}
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
                    +{remainingCount}
                  </div>
                </OverlayTrigger>
              )}
            </div>
            {technicians.length === 0 && (
              <span 
                className="text-muted"
                style={{
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <FaUser size={14} />
                Unassigned
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "scheduled_start",
      label: "Date & Time",
      accessor: "scheduled_start",
      important: true,
      sortable: true,
      width: "5%",
      render: (row, value) => {
        const scheduledStart = row.scheduled_start || row.startDate;
        const scheduledEnd = row.scheduled_end || row.endDate;
        
        if (!scheduledStart) {
          return <span>N/A</span>;
        }
        
        const startTimeStr = formatSingaporeTimeHm(scheduledStart);
        
        let endTimeStr = null;
        if (scheduledEnd) {
          endTimeStr = formatSingaporeTimeHm(scheduledEnd);
        }
        
        return (
          <div className="d-flex flex-column">
            <span>{formatDate(scheduledStart)}</span>
            <small className="text-muted">
              {formatTime(startTimeStr)}
              {endTimeStr && ` - ${formatTime(endTimeStr)}`}
            </small>
          </div>
        );
      },
    },
    // {
    //   id: "equipments",
    //   label: "Equipment",
    //   accessor: "equipments",
    //   important: false,
    //   sortable: false,
    //   render: (row, value) => {
    //     const equipments = value || [];
        
    //     return (
    //       <OverlayTrigger
    //         placement="top"
    //         overlay={
    //           <Tooltip>
    //             {equipments.length > 0 
    //               ? equipments
    //                   .map((eq) => {
    //                     const name = eq.itemName || eq.equipmentType || 'N/A';
    //                     const model = eq.modelSeries && eq.modelSeries !== 'N/A' ? ` - ${eq.modelSeries}` : '';
    //                     return `${name}${model}`;
    //                   })
    //                   .join(", ")
    //               : "No equipment details available"
    //             }
    //           </Tooltip>
    //         }
    //       >
    //         <div className="text-truncate" style={{ maxWidth: "180px" }}>
    //           {equipments.length > 0
    //             ? `${equipments.length} item(s)`
    //             : "No equipment"}
    //         </div>
    //       </OverlayTrigger>
    //     );
    //   },
    // },
    {
      id: "updated_at",
      label: "Last Updated",
      accessor: "updated_at",
      important: false,
      sortable: false,
      width: "4.5%",
      render: (row, value) => {
        const timestamp =
          row.updated_at || row.updatedAt || row.created_at || row.createdAt;
        if (!timestamp) return "N/A";
        
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return "N/A";
        
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        let relativeTime;
        if (diffInSeconds < 60) {
          relativeTime = 'Just now';
        } else if (diffInSeconds < 3600) {
          const minutes = Math.floor(diffInSeconds / 60);
          relativeTime = `${minutes}m ago`;
        } else if (diffInSeconds < 86400) {
          const hours = Math.floor(diffInSeconds / 3600);
          relativeTime = `${hours}h ago`;
        } else if (diffInSeconds < 604800) {
          const days = Math.floor(diffInSeconds / 86400);
          relativeTime = `${days}d ago`;
        } else {
          relativeTime = date.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
        }

        const formattedDate = date.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const formattedTime = date.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit'
        });

        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                Last updated on: {formattedDate} at {formattedTime}
              </Tooltip>
            }
          >
            <div 
              className="d-flex align-items-center"
              style={{
                backgroundColor: "#f1f5f9",
                padding: "4px 8px",
                borderRadius: "6px",
                fontSize: "0.875rem",
                color: "#64748b",
                width: "fit-content"
              }}
            >
              <i className="fe fe-clock me-1" style={{ fontSize: "12px" }}></i>
              {relativeTime}
            </div>
          </OverlayTrigger>
        );
      },
    },
    {
      id: "actions",
      label: "Actions",
      important: true,
      sortable: false,
      align: "right",
      width: "10%",
      minWidth: 132,
      paddingRight: "10px",
      render: (row, value) => (
        <div
          className="d-inline-flex gap-2 align-items-center flex-nowrap jobs-actions-wrap"
          style={{ whiteSpace: "nowrap" }}
        >
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>View complete details for job #{row.jobNo}</Tooltip>
            }
          >
            <Link
              href={`/dashboard/jobs/${row.id}`}
              className="jobs-action-view"
            >
              <Eye size={14} />
              View
            </Link>
          </OverlayTrigger>
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>Delete job #{row.jobNo}</Tooltip>
            }
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteJob(row);
              }}
              className="jobs-action-delete"
              title="Delete job"
            >
              <Trash size={16} />
            </button>
          </OverlayTrigger>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [jobStatuses]);

  const jobsRealtimeDebounceRef = useRef(null);
  const pendingRealtimeEventsRef = useRef([]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;
    let realtimeChannel = null;

    const throttledRefetch = (immediate = false) => {
      const now = Date.now();
      if (!immediate && now - lastFullRefetchAtRef.current < JOBS_REALTIME_FULL_REFETCH_MIN_MS) {
        return;
      }
      lastFullRefetchAtRef.current = now;
      void refetchJobsRef.current();
    };

    const patchSingleRow = async (rowId, eventType) => {
      const singleParams = new URLSearchParams({
        jobId: rowId,
        limit: '1',
        page: '1',
      });
      const singleRes = await fetch(
        `/api/jobs/list-summary?${singleParams.toString()}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'X-Client-Source': 'web' },
        }
      );

      if (!singleRes.ok) {
        throttledRefetch();
        return false;
      }

      const singlePayload = await singleRes.json();
      const row = singlePayload.jobs?.[0];

      if (!row) {
        removeRowRef.current(rowId);
        return true;
      }

      patchRowRef.current(row, eventType);
      return true;
    };

    const processBatchedEvents = async (events) => {
      if (cancelled || !events.length) return;

      const deleteIds = new Set();
      const updateIds = new Map();

      for (const payload of events) {
        const eventType = payload.eventType;
        const rowId = payload.new?.id || payload.old?.id;

        if (eventType === 'DELETE' || payload.new?.deleted_at) {
          if (rowId) deleteIds.add(rowId);
          continue;
        }

        if (!rowId) {
          throttledRefetch();
          return;
        }

        updateIds.set(rowId, eventType);
      }

      deleteIds.forEach((rowId) => {
        removeRowRef.current(rowId);
      });
      deleteIds.forEach((id) => updateIds.delete(id));

      if (updateIds.size === 0) return;

      let patchFailures = 0;
      for (const [rowId, eventType] of updateIds) {
        try {
          const ok = await patchSingleRow(rowId, eventType);
          if (!ok) patchFailures += 1;
        } catch (patchErr) {
          console.warn('Job realtime patch failed:', patchErr);
          patchFailures += 1;
        }
      }

      if (patchFailures > 0) {
        throttledRefetch();
      }
    };

    realtimeChannel = supabase
      .channel('jobs-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs',
          filter: 'deleted_at=is.null',
        },
        (payload) => {
          pendingRealtimeEventsRef.current.push(payload);
          if (jobsRealtimeDebounceRef.current) {
            clearTimeout(jobsRealtimeDebounceRef.current);
          }
          jobsRealtimeDebounceRef.current = setTimeout(() => {
            const batch = pendingRealtimeEventsRef.current;
            pendingRealtimeEventsRef.current = [];
            void processBatchedEvents(batch);
          }, JOBS_REALTIME_DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (jobsRealtimeDebounceRef.current) {
        clearTimeout(jobsRealtimeDebounceRef.current);
      }
      pendingRealtimeEventsRef.current = [];
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }
    };
  }, []);

  const handleRowClick = (row) => {
    Swal.fire({
      title: `<strong class="text-primary">Job Summary</strong>`,
      html: `
        <div>
          <div class="text-center mb-4">
            <h5 class="mb-1">#${row.jobNo}</h5>
            <p class="text-muted">${row.jobName}</p>
          </div>
          
          <div class="row g-3 mb-4">
            <!-- Left Column -->
            <div class="col-6 text-start">
              <div class="mb-3">
                <div class="d-flex align-items-center mb-1">
                  <i class="fas fa-user text-primary me-2"></i>
                  <strong>Customer:</strong>
                </div>
                <div class="ms-4">
                  ${row.customerName}
                </div>
              </div>
  
              <div class="mb-3">
                <div class="d-flex align-items-center mb-1">
                  <i class="fas fa-map-marker-alt text-danger me-2"></i>
                  <strong>Location:</strong>
                </div>
                <div class="ms-4">
                  ${row.location?.locationName || "No location"}
                </div>
              </div>
  
              <div class="mb-3">
                <div class="d-flex align-items-center mb-1">
                  <i class="fas fa-users text-info me-2"></i>
                  <strong>Assigned Workers:</strong>
                </div>
                <div class="ms-4">
                  ${
                    row.assignedWorkers?.map((w) => w.workerId).join(", ") ||
                    "None"
                  }
                </div>
              </div>
            </div>
  
            <!-- Right Column -->
            <div class="col-6 text-start">
              <div class="mb-3">
                <div class="d-flex align-items-center mb-1">
                  <i class="fas fa-tasks text-success me-2"></i>
                  <strong>Status:</strong>
                </div>
                <div class="ms-4">
                  <span class="badge bg-secondary">${getJobStatusLabelFromList(row.jobStatus, jobStatuses)}</span>
                </div>
              </div>
  
              <div class="mb-3">
                <div class="d-flex align-items-center mb-1">
                  <i class="far fa-calendar text-warning me-2"></i>
                  <strong>Date & Time:</strong>
                </div>
                <div class="ms-4">
                  <div class="d-flex justify-content-between">
                    <div>
                      <strong>Start:</strong><br>
                      ${formatDate(row.startDate)}<br>
                      ${formatTime(row.startTime)}
                    </div>
                    <div>
                      <strong>End:</strong><br>
                      ${formatDate(row.endDate)}<br>
                      ${formatTime(row.endTime)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
  
          <div class="d-grid gap-2">
            <button class="btn btn-primary" id="viewBtn">
              <i class="fas fa-eye me-2"></i>View Job
            </button>
            <button class="btn btn-warning" id="editBtn">
              <i class="fas fa-edit me-2"></i>Edit Job
            </button>
            <button class="btn btn-outline-danger" id="removeBtn">
              <i class="fas fa-trash-alt me-2"></i>Remove Job
            </button>
          </div>
        </div>
      `,
      showConfirmButton: false,
      showCloseButton: true,
      width: "600px", // Made wider to accommodate two columns
      customClass: {
        container: "job-action-modal",
        closeButton: "position-absolute top-0 end-0 mt-2 me-2",
      },
      didOpen: () => {
        document.getElementById("viewBtn").addEventListener("click", () => {
          setEditLoading(true); // Set loading state
          Swal.close();
          router.push(`/dashboard/jobs/${row.id}`).finally(() => {
            setEditLoading(false); // Reset loading state after navigation
          });
        });

        document.getElementById("editBtn").addEventListener("click", () => {
          setEditLoading(true);
          Swal.close();
          router.push(`/dashboard/jobs/edit-jobs/${row.id}`).finally(() => {
            setEditLoading(false);
          });
        });

        document
          .getElementById("removeBtn")
          .addEventListener("click", async () => {
            Swal.close();
            const deleteResult = await Swal.fire({
              title: "Are you sure?",
              text: "This action cannot be undone.",
              icon: "warning",
              showCancelButton: true,
              confirmButtonColor: "#d33",
              cancelButtonColor: "#3085d6",
              confirmButtonText: "Yes, remove it!",
            });

            if (deleteResult.isConfirmed) {
              try {
                const supabase = getSupabaseClient();
                if (!supabase) {
                  throw new Error("Supabase client not available");
                }

                // Soft delete by setting deleted_at timestamp
                const deletedAt = new Date().toISOString();
                const { error } = await supabase
                  .from('jobs')
                  .update({ deleted_at: deletedAt })
                  .eq('id', row.id);

                if (error) {
                  throw error;
                }

                await softDeleteFollowUpsForJobs(supabase, [row.id], deletedAt);

                Swal.fire("Deleted!", "The job has been removed.", "success");
                removeRow(row.id);
                invalidateJobsListServerCache();
              } catch (error) {
                console.error("Delete error:", error);
                Swal.fire(
                  "Error!",
                  "There was a problem removing the job.",
                  "error"
                );
              }
            }
          });
      },
    });
  };

  const getStatusColor = (status) =>
    getJobStatusColorFromList(status, jobStatuses) ?? "var(--bs-secondary)";


  const fetchSyncPreview = useCallback(async (dateFrom, dateTo) => {
    setSyncSapConfirm((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const payload = { preview: true };
      if (dateFrom) payload.dateFrom = dateFrom;
      if (dateTo) payload.dateTo = dateTo;

      const res = await fetch('/api/jobs/sync-hourly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Could not load sync preview');
      }
      setSyncSapConfirm((prev) => ({
        ...prev,
        loading: false,
        totalJobs: data.totalJobs ?? 0,
        syncedJobs: data.syncedJobs ?? 0,
        unsyncedJobs: data.unsyncedJobs ?? 0,
        totalUnsyncedAll: data.totalUnsyncedAll ?? data.unsyncedJobs ?? 0,
        hasDateFilter: data.hasDateFilter ?? Boolean(dateFrom || dateTo),
        concurrency: data.concurrency ?? 4,
        error: null,
      }));
    } catch (e) {
      setSyncSapConfirm((prev) => ({
        ...prev,
        loading: false,
        error: e?.message || 'Preview failed',
      }));
    }
  }, []);

  const openSyncSapConfirm = () => {
    setSyncDateFilter({ preset: 'all', dateFrom: null, dateTo: null });
    setSyncSapConfirm({
      show: true,
      loading: true,
      totalJobs: 0,
      syncedJobs: 0,
      unsyncedJobs: 0,
      totalUnsyncedAll: 0,
      hasDateFilter: false,
      concurrency: 4,
      error: null,
    });
    fetchSyncPreview(null, null);
  };

  const applySyncDatePreset = (presetId) => {
    if (presetId === 'custom') {
      setSyncDateFilter((prev) => ({ ...prev, preset: 'custom' }));
      return;
    }
    const range = getSyncDatePresetRange(presetId);
    setSyncDateFilter({ preset: presetId, ...range });
    fetchSyncPreview(range.dateFrom, range.dateTo);
  };

  const applyCustomSyncDateFilter = () => {
    fetchSyncPreview(syncDateFilter.dateFrom, syncDateFilter.dateTo);
  };

  const runSyncToSap = async () => {
    setSyncSapConfirm((prev) => ({ ...prev, show: false }));
    setSyncToSapLoading(true);
    setSyncToSapElapsed(0);
    setSyncToSapProgress(null);
    setSyncLiveFeed([]);
    try {
      const syncPayload = { stream: true, syncAll: true };
      if (syncDateFilter.dateFrom) syncPayload.dateFrom = syncDateFilter.dateFrom;
      if (syncDateFilter.dateTo) syncPayload.dateTo = syncDateFilter.dateTo;

      const res = await fetch('/api/jobs/sync-hourly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncPayload),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncResultModal({
          show: true,
          synced: 0,
          failed: 0,
          errors: [],
          errorMessage:
            data.error || data.message || 'SAP session may be required. Please log in to SAP and try again.',
          totalUnsynced: null,
          processed: null,
          remainingUnsynced: null,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastDone = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'error') {
            setSyncResultModal({
              show: true,
              synced: 0,
              failed: 0,
              errors: [],
              errorMessage: event.error || 'Sync failed',
              totalUnsynced: null,
              processed: null,
              remainingUnsynced: null,
            });
            return;
          }

          if (event.type === 'start') {
            setSyncToSapProgress({
              current: 0,
              total: event.processing ?? 0,
              totalUnsynced: event.totalUnsynced ?? 0,
              totalJobs: event.totalJobs ?? 0,
              syncedJobs: event.syncedJobs ?? 0,
              concurrency: event.concurrency ?? 4,
              jobNumber: null,
              synced: 0,
              failed: 0,
              message: event.message || 'Starting…',
            });
          }

          if (event.type === 'log') {
            setSyncLiveFeed((prev) =>
              [...prev, { id: `${Date.now()}-${Math.random()}`, ...event }].slice(-200)
            );
          }

          if (event.type === 'progress') {
            setSyncToSapProgress((prev) => ({
              current: event.current ?? 0,
              total: event.total ?? 0,
              totalUnsynced: prev?.totalUnsynced ?? 0,
              totalJobs: prev?.totalJobs ?? 0,
              syncedJobs: prev?.syncedJobs ?? 0,
              concurrency: prev?.concurrency ?? 4,
              jobNumber: event.job_number ?? null,
              synced: event.synced ?? 0,
              failed: event.failed ?? 0,
              message: event.job_number
                ? `Syncing ${event.job_number} (${event.current}/${event.total})…`
                : `Processing ${event.current}/${event.total}…`,
            }));
          }

          if (event.type === 'done') {
            lastDone = event;
          }
        }
      }

      if (lastDone) {
        setSyncResultModal({
          show: true,
          synced: lastDone.synced ?? 0,
          failed: lastDone.failed ?? 0,
          errors: Array.isArray(lastDone.errors) ? lastDone.errors : [],
          errorMessage: null,
          totalUnsynced: lastDone.totalUnsynced ?? null,
          processed: lastDone.processed ?? null,
          remainingUnsynced: lastDone.remainingUnsynced ?? null,
        });
        if ((lastDone.synced ?? 0) > 0) refreshJobs();
      } else {
        setSyncResultModal({
          show: true,
          synced: 0,
          failed: 0,
          errors: [],
          errorMessage: 'No response from server. Try again.',
          totalUnsynced: null,
          processed: null,
          remainingUnsynced: null,
        });
      }
    } catch (e) {
      setSyncResultModal({
        show: true,
        synced: 0,
        failed: 0,
        errors: [],
        errorMessage: e?.message || 'Request failed.',
        totalUnsynced: null,
        processed: null,
        remainingUnsynced: null,
      });
    } finally {
      setSyncToSapLoading(false);
      setSyncToSapProgress(null);
    }
  };

  const handleSyncToSap = () => {
    openSyncSapConfirm();
  };

  /**
   * Link AIFM jobs (no customer_id + [CUSTOMER:…] in description) to customers.
   * Tries local DB, then SAP when logged in; if still no match, creates a portal CP##### placeholder with the tag name.
   */
  const handleSyncCustomers = async () => {
    setSyncCustomerLoading(true);
    setSyncCustomerElapsed(0);
    try {
      const res = await fetch('/api/integrations/aifm/assign-customers', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncCustomerModal({
          show: true,
          updated: 0,
          matched: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          message: '',
          errorMessage: data.error || data.message || `Request failed (${res.status})`,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastDone = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'error') {
            setSyncCustomerModal({
              show: true,
              updated: 0,
              matched: 0,
              failed: 0,
              skipped: 0,
              total: 0,
              message: '',
              errorMessage: event.error || 'Assignment failed',
            });
            return;
          }
          if (event.type === 'done') {
            lastDone = event;
          }
        }
      }

      if (lastDone) {
        const updated = lastDone.updated ?? 0;
        const linkedUp = lastDone.linkedLocationEnrichment?.updated ?? 0;
        setSyncCustomerModal({
          show: true,
          updated,
          matched: lastDone.matched ?? 0,
          failed: lastDone.failed ?? 0,
          skipped: lastDone.skipped ?? 0,
          total: lastDone.total ?? 0,
          message: lastDone.message || '',
          errorMessage: null,
        });
        if (updated > 0 || linkedUp > 0) refreshJobs();
      } else {
        setSyncCustomerModal({
          show: true,
          updated: 0,
          matched: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          message: '',
          errorMessage: 'No response from server. Try again.',
        });
      }
    } catch (e) {
      setSyncCustomerModal({
        show: true,
        updated: 0,
        matched: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        message: '',
        errorMessage: e?.message || 'Network error',
      });
    } finally {
      setSyncCustomerLoading(false);
    }
  };

  /**
   * Fill empty job_schedule.address from [ADDRESS:…] on AIFM jobs (same as first phase of
   * assign-customers). Re-import from AIFM if older jobs lack the tag.
   */
  const handleSyncJobAddresses = async () => {
    setSyncAddressLoading(true);
    setSyncAddressElapsed(0);
    try {
      const res = await fetch('/api/integrations/aifm/sync-address', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncAddressModal({
          show: true,
          updated: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          totalWithAddressTag: 0,
          totalLocationCandidates: 0,
          updatedFromTag: 0,
          updatedFromLocation: 0,
          message: '',
          errorMessage: data.error || data.message || `Request failed (${res.status})`,
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastDone = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'error') {
            setSyncAddressModal({
              show: true,
              updated: 0,
              failed: 0,
              skipped: 0,
              total: 0,
              totalWithAddressTag: 0,
              totalLocationCandidates: 0,
              updatedFromTag: 0,
              updatedFromLocation: 0,
              message: '',
              errorMessage: event.error || 'Address sync failed',
            });
            return;
          }
          if (event.type === 'done') {
            lastDone = event;
          }
        }
      }

      if (lastDone) {
        const updated = lastDone.updated ?? 0;
        setSyncAddressModal({
          show: true,
          updated,
          failed: lastDone.failed ?? 0,
          skipped: lastDone.skipped ?? 0,
          total: lastDone.total ?? 0,
          totalWithAddressTag: lastDone.totalWithAddressTag ?? lastDone.total ?? 0,
          totalLocationCandidates: lastDone.totalLocationCandidates ?? 0,
          updatedFromTag: lastDone.updatedFromTag ?? 0,
          updatedFromLocation: lastDone.updatedFromLocation ?? 0,
          message: lastDone.message || '',
          errorMessage: null,
        });
        if (updated > 0) refreshJobs();
      } else {
        setSyncAddressModal({
          show: true,
          updated: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          totalWithAddressTag: 0,
          totalLocationCandidates: 0,
          updatedFromTag: 0,
          updatedFromLocation: 0,
          message: '',
          errorMessage: 'No response from server. Try again.',
        });
      }
    } catch (e) {
      setSyncAddressModal({
        show: true,
        updated: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        totalWithAddressTag: 0,
        totalLocationCandidates: 0,
        updatedFromTag: 0,
        updatedFromLocation: 0,
        message: '',
        errorMessage: e?.message || 'Network error',
      });
    } finally {
      setSyncAddressLoading(false);
    }
  };

  // Elapsed time during Sync to SAP (for loading modal)
  useEffect(() => {
    if (!syncToSapLoading) return;
    const interval = setInterval(() => {
      setSyncToSapElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncToSapLoading]);

  useEffect(() => {
    if (!syncToSapLoading) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [syncToSapLoading]);

  useEffect(() => {
    const el = syncFeedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [syncLiveFeed]);

  useEffect(() => {
    if (!syncCustomerLoading) return;
    const interval = setInterval(() => {
      setSyncCustomerElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncCustomerLoading]);

  useEffect(() => {
    if (!syncAddressLoading) return;
    const interval = setInterval(() => {
      setSyncAddressElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [syncAddressLoading]);

  // Helper function to convert priority numbers to labels
  const getPriorityLabel = (priority) => {
    switch (priority) {
      case 1: return 'Low';
      case 2: return 'Normal';
      case 3: return 'High';
      case 4: return 'Urgent';
      default: return 'Normal';
    }
  };

  const syncResultErrorsPagination = useMemo(() => {
    const errors = syncResultModal.errors || [];
    const totalPages = Math.max(1, Math.ceil(errors.length / SYNC_RESULT_ERRORS_PAGE_SIZE));
    const page = Math.min(Math.max(1, syncResultErrorsPage), totalPages);
    const start = (page - 1) * SYNC_RESULT_ERRORS_PAGE_SIZE;
    return {
      page,
      totalPages,
      slice: errors.slice(start, start + SYNC_RESULT_ERRORS_PAGE_SIZE),
      startIndex: start,
    };
  }, [syncResultModal.errors, syncResultErrorsPage]);

  return (
    <Fragment>
      {editLoading && (
        <div className="loading-overlay">
          <Spinner animation="border" variant="primary" />
          <span className="text-muted ms-2">Redirecting to edit page...</span>
        </div>  
      )}
      {syncToSapLoading && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.55)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: '1.5rem 1.75rem',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)',
              border: '1px solid #e2e8f0',
              maxWidth: 560,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="d-flex align-items-center justify-content-between mb-2">
              <div className="d-flex align-items-center gap-2">
                <Spinner animation="border" variant="primary" style={{ width: 24, height: 24 }} />
                <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e40af' }}>
                  Syncing to SAP
                </span>
              </div>
              <Badge bg="primary" pill className="text-uppercase" style={{ fontSize: 10 }}>
                Live
              </Badge>
            </div>

            <Alert variant="warning" className="py-2 px-3 mb-3 small">
              <strong>Do not refresh or close this tab</strong> until sync completes. Interrupting may cause
              duplicate SAP activities or incomplete updates.
            </Alert>

            <p className="mb-2 mt-2" style={{ fontSize: '0.9rem', color: '#475569' }}>
              {syncToSapProgress?.message || 'Preparing sync…'}
            </p>

            {syncToSapProgress && syncToSapProgress.total > 0 && (
              <>
                <ProgressBar
                  now={Math.round((syncToSapProgress.current / syncToSapProgress.total) * 100)}
                  label={`${syncToSapProgress.current}/${syncToSapProgress.total}`}
                  className="mb-2"
                  style={{ height: 24, fontSize: '0.75rem' }}
                  animated
                  striped
                />
                <div
                  className="d-flex flex-wrap gap-3 mb-2"
                  style={{ fontSize: '0.8rem', color: '#64748b' }}
                >
                  <span>
                    <strong className="text-success">{syncToSapProgress.synced}</strong> synced
                  </span>
                  <span>
                    <strong className="text-danger">{syncToSapProgress.failed}</strong> failed
                  </span>
                  <span>
                    {syncToSapProgress.concurrency ?? 4} parallel
                  </span>
                  <span>
                    Elapsed: {syncToSapElapsed > 0 ? `${syncToSapElapsed}s` : '…'}
                  </span>
                  {syncToSapProgress.current > 0 && syncToSapElapsed > 0 && (
                    <span>
                      ETA: ~
                      {Math.max(
                        0,
                        Math.round(
                          (syncToSapElapsed / syncToSapProgress.current) *
                            (syncToSapProgress.total - syncToSapProgress.current)
                        )
                      )}
                      s
                    </span>
                  )}
                </div>
              </>
            )}

            <div
              ref={syncFeedRef}
              className="border rounded mt-2"
              style={{
                flex: '1 1 auto',
                minHeight: 180,
                maxHeight: 260,
                overflowY: 'auto',
                background: '#0f172a',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.72rem',
                padding: '0.75rem',
              }}
            >
              {syncLiveFeed.length === 0 ? (
                <div style={{ color: '#94a3b8' }}>Waiting for sync events…</div>
              ) : (
                syncLiveFeed.map((entry) => {
                  const color =
                    entry.status === 'success'
                      ? '#4ade80'
                      : entry.status === 'error'
                        ? '#f87171'
                        : entry.status === 'running'
                          ? '#60a5fa'
                          : '#cbd5e1';
                  return (
                    <div key={entry.id} style={{ color, marginBottom: 4, lineHeight: 1.4 }}>
                      {entry.ts ? `[${entry.ts.slice(11, 19)}] ` : ''}
                      {entry.message}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      <Modal
        show={syncSapConfirm.show}
        onHide={() => !syncToSapLoading && setSyncSapConfirm((p) => ({ ...p, show: false }))}
        centered
        size="lg"
      >
        <Modal.Header closeButton={!syncSapConfirm.loading && !syncToSapLoading} className="border-0 pb-0">
          <div>
            <Modal.Title className="d-flex align-items-center gap-2">
              <RefreshCw size={20} className="text-primary" />
              Sync jobs to SAP
            </Modal.Title>
            <p className="text-muted small mb-0 mt-1">
              Choose which unsynced jobs to send — filter by created date before proceeding.
            </p>
          </div>
        </Modal.Header>
        <Modal.Body className="pt-3">
          {syncSapConfirm.loading ? (
            <div className="text-center py-4">
              <Spinner animation="border" variant="primary" className="mb-3" />
              <p className="mb-0 text-muted">Counting jobs for selected range…</p>
            </div>
          ) : syncSapConfirm.error ? (
            <Alert variant="danger" className="mb-0">
              {syncSapConfirm.error}
            </Alert>
          ) : (
            <>
              <div className="mb-3 p-3 rounded border bg-light">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                  <span className="fw-semibold small text-uppercase text-muted" style={{ letterSpacing: '0.04em' }}>
                    Date filter (created)
                  </span>
                  <Badge bg="secondary" pill className="fw-normal">
                    {formatSyncFilterLabel(syncDateFilter.dateFrom, syncDateFilter.dateTo)}
                  </Badge>
                </div>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {SYNC_DATE_PRESETS.map((p) => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant={syncDateFilter.preset === p.id ? 'primary' : 'outline-secondary'}
                      onClick={() => applySyncDatePreset(p.id)}
                      disabled={syncSapConfirm.loading}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                {syncDateFilter.preset === 'custom' && (
                  <Row className="g-2 align-items-end">
                    <Col sm={5}>
                      <Form.Label className="small text-muted mb-1">From</Form.Label>
                      <Flatpickr
                        className="form-control form-control-sm"
                        placeholder="Start date"
                        value={syncDateFilter.dateFrom ? new Date(`${syncDateFilter.dateFrom}T00:00:00`) : null}
                        options={{ dateFormat: 'Y-m-d' }}
                        onChange={([d]) =>
                          setSyncDateFilter((prev) => ({
                            ...prev,
                            dateFrom: d ? formatDateYmd(d) : null,
                          }))
                        }
                      />
                    </Col>
                    <Col sm={5}>
                      <Form.Label className="small text-muted mb-1">To</Form.Label>
                      <Flatpickr
                        className="form-control form-control-sm"
                        placeholder="End date"
                        value={syncDateFilter.dateTo ? new Date(`${syncDateFilter.dateTo}T00:00:00`) : null}
                        options={{ dateFormat: 'Y-m-d' }}
                        onChange={([d]) =>
                          setSyncDateFilter((prev) => ({
                            ...prev,
                            dateTo: d ? formatDateYmd(d) : null,
                          }))
                        }
                      />
                    </Col>
                    <Col sm={2}>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="w-100"
                        onClick={applyCustomSyncDateFilter}
                        disabled={!syncDateFilter.dateFrom && !syncDateFilter.dateTo}
                      >
                        Apply
                      </Button>
                    </Col>
                  </Row>
                )}
              </div>

              <Row className="g-2 mb-3">
                <Col xs={4}>
                  <div className="border rounded p-3 text-center h-100">
                    <div className="text-muted small">In range</div>
                    <div className="fw-bold fs-4">{syncSapConfirm.totalJobs.toLocaleString()}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>total jobs</div>
                  </div>
                </Col>
                <Col xs={4}>
                  <div className="border rounded p-3 text-center h-100 bg-light">
                    <div className="text-muted small">Already in SAP</div>
                    <div className="fw-bold fs-4 text-success">
                      {syncSapConfirm.syncedJobs.toLocaleString()}
                    </div>
                    <div className="text-muted" style={{ fontSize: 11 }}>in range</div>
                  </div>
                </Col>
                <Col xs={4}>
                  <div
                    className="border rounded p-3 text-center h-100"
                    style={{ backgroundColor: '#eff6ff', borderColor: '#93c5fd' }}
                  >
                    <div className="small" style={{ color: '#1e40af' }}>
                      To sync
                    </div>
                    <div className="fw-bold fs-4" style={{ color: '#2563eb' }}>
                      {syncSapConfirm.unsyncedJobs.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>unsynced in range</div>
                  </div>
                </Col>
              </Row>

              {syncSapConfirm.hasDateFilter &&
                syncSapConfirm.totalUnsyncedAll > syncSapConfirm.unsyncedJobs && (
                  <p className="text-muted small mb-3">
                    {syncSapConfirm.totalUnsyncedAll.toLocaleString()} unsynced total in portal —{' '}
                    <strong>{syncSapConfirm.unsyncedJobs.toLocaleString()}</strong> match your filter.
                  </p>
                )}

              {syncSapConfirm.unsyncedJobs === 0 ? (
                <Alert variant="success" className="mb-0 small">
                  No unsynced jobs match this filter. Try a wider date range or &quot;All unsynced&quot;.
                </Alert>
              ) : (
                <Alert variant="warning" className="mb-0 small">
                  <strong>Important:</strong> Keep this tab open during sync. Do not refresh — it can cause data
                  loss or duplicate SAP records. Uses {syncSapConfirm.concurrency} parallel workers.
                </Alert>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button
            variant="light"
            onClick={() => setSyncSapConfirm((p) => ({ ...p, show: false }))}
            disabled={syncSapConfirm.loading || syncToSapLoading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={runSyncToSap}
            disabled={
              syncSapConfirm.loading ||
              syncToSapLoading ||
              Boolean(syncSapConfirm.error) ||
              syncSapConfirm.unsyncedJobs === 0
            }
          >
            Proceed to sync
            {syncSapConfirm.unsyncedJobs > 0 ? ` (${syncSapConfirm.unsyncedJobs.toLocaleString()})` : ''}
          </Button>
        </Modal.Footer>
      </Modal>
      {syncCustomerLoading && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              borderRadius: 16,
              padding: '2rem 2.5rem',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 4px 20px rgba(245, 158, 11, 0.2)',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              maxWidth: 440,
              width: '90%',
              textAlign: 'center',
            }}
          >
            <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
              <Spinner animation="border" variant="warning" style={{ width: 28, height: 28 }} />
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: '#b45309' }}>
                Syncing customers
              </span>
            </div>
            <p className="mb-2" style={{ fontSize: '0.95rem', color: '#475569' }}>
              Matching AIFM jobs to customers: local DB first, then SAP CardCode lookup when you are
              logged into SAP. If SAP returns a CardCode not yet in the portal, one local row is
              created for that code (same as AIFM import).
            </p>
            <p className="mb-0" style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
              {syncCustomerElapsed > 0 ? `Elapsed: ${syncCustomerElapsed}s` : 'Starting…'}
            </p>
          </div>
        </div>
      )}
      {syncAddressLoading && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
              borderRadius: 16,
              padding: '2rem 2.5rem',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 4px 20px rgba(14, 116, 144, 0.2)',
              border: '1px solid rgba(14, 116, 144, 0.35)',
              maxWidth: 440,
              width: '90%',
              textAlign: 'center',
            }}
          >
            <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
              <Spinner animation="border" variant="info" style={{ width: 28, height: 28 }} />
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0e7490' }}>
                Job address sync
              </span>
            </div>
            <p className="mb-2" style={{ fontSize: '0.95rem', color: '#475569' }}>
              Applying <code className="small">[ADDRESS:…]</code> tags, then copying from linked
              locations when the schedule address is still empty.
            </p>
            <p className="mb-0" style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
              {syncAddressElapsed > 0 ? `Elapsed: ${syncAddressElapsed}s` : 'Starting…'}
            </p>
          </div>
        </div>
      )}
      {/* Sync to SAP result modal (React-Bootstrap, no SweetAlert) */}
      <Modal
        show={syncResultModal.show}
        onHide={() => {
          setSyncResultModal((prev) => ({ ...prev, show: false }));
          setSyncResultErrorsPage(1);
        }}
        size={syncResultModal.errors?.length > 0 ? 'xl' : 'md'}
        centered
        onClick={(e) => e.stopPropagation()}
      >
        <Modal.Header
          closeButton={false}
          onClick={(e) => e.stopPropagation()}
          className="border-0 pb-0 flex-column align-items-stretch"
        >
          <div className="d-flex align-items-start justify-content-between w-100 gap-2">
            <Modal.Title className="d-flex align-items-center gap-2 mb-0 pe-2">
              {syncResultModal.errorMessage ? (
                <XLg className="text-danger" />
              ) : syncResultModal.failed > 0 ? (
                <CheckCircleFill className="text-warning" />
              ) : (
                <CheckCircleFill className="text-success" />
              )}
              Sync to SAP — Results
            </Modal.Title>
            <button
              type="button"
              className="btn-close flex-shrink-0"
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                setSyncResultModal((prev) => ({ ...prev, show: false }));
                setSyncResultErrorsPage(1);
              }}
            />
          </div>
          {syncResultModal.failed > 0 && !syncResultModal.errorMessage && (
            <Alert variant="light" className="border small mb-0 mt-2 w-100">
              <strong>What is portal sync?</strong>
              <p className="mb-0 mt-1 text-muted" style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>
                Sends portal jobs to SAP B1 as <em>Activities</em> when they have no SAP Activity ID yet.
                Jobs already linked to SAP are skipped automatically.
              </p>
            </Alert>
          )}
        </Modal.Header>
        <Modal.Body
          onClick={(e) => e.stopPropagation()}
          className="pt-2"
          style={
            syncResultModal.errors?.length > 0
              ? { maxHeight: '72vh', overflowY: 'auto', paddingBottom: '0.75rem' }
              : undefined
          }
        >
          {syncResultModal.errorMessage ? (
            <>
              <Alert variant="danger" className="mb-3">
                {syncResultModal.errorMessage}
              </Alert>
              <Alert variant="info" className="mb-0 small">
                <strong>What to do:</strong> Log in to SAP B1 via the portal, confirm your session is active, then
                open Sync to SAP again. If the error persists, contact support with the message above.
              </Alert>
            </>
          ) : syncResultModal.errors?.length > 0 ? (
            <Row className="g-3 sync-result-split align-items-start">
              {/* Left: summary + guides */}
              <Col md={4} style={{ maxHeight: '58vh', overflowY: 'auto' }}>
                <div className="d-flex flex-column gap-2 w-100">
                  <h6
                    className="mb-0 small fw-semibold text-uppercase text-muted"
                    style={{ letterSpacing: '0.04em' }}
                  >
                    Summary
                  </h6>

                  <div className="border rounded overflow-hidden flex-shrink-0">
                    {[
                      { label: 'Synced', value: syncResultModal.synced, className: 'text-success' },
                      { label: 'Failed', value: syncResultModal.failed, className: 'text-danger' },
                      { label: 'Processed', value: syncResultModal.processed ?? '—', className: 'text-dark' },
                    ].map((row, i, arr) => (
                      <div
                        key={row.label}
                        className={`d-flex justify-content-between align-items-center px-3 py-2${i < arr.length - 1 ? ' border-bottom' : ''}`}
                        style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}
                      >
                        <span className="text-muted small">{row.label}</span>
                        <span className={`fw-bold fs-5 ${row.className}`}>{row.value}</span>
                      </div>
                    ))}
                  </div>

                  {syncResultModal.remainingUnsynced != null && syncResultModal.remainingUnsynced > 0 && (
                    <Alert variant="warning" className="py-2 small mb-0 flex-shrink-0">
                      <strong>{syncResultModal.remainingUnsynced.toLocaleString()}</strong> still unsynced — fix
                      failed jobs, then <strong>Sync again</strong>.
                    </Alert>
                  )}

                  <div className="flex-shrink-0 w-100">
                    <h6
                      className="mb-2 small fw-semibold text-uppercase text-muted"
                      style={{ letterSpacing: '0.04em' }}
                    >
                      How to fix
                    </h6>
                    <Accordion flush className="border rounded" defaultActiveKey="0">
                      {summarizeSyncErrorsByCategory(syncResultModal.errors).map(({ category, count, guide }, idx) => (
                        <Accordion.Item eventKey={String(idx)} key={category}>
                          <Accordion.Header className="py-2">
                            <span className="small fw-semibold">{guide.title}</span>
                            <Badge bg="danger" className="ms-2">{count}</Badge>
                          </Accordion.Header>
                          <Accordion.Body className="small pt-0 text-start">
                            <p className="text-muted mb-2">{guide.summary}</p>
                            <ol className="mb-2 ps-3 small">
                              {guide.steps.map((step, i) => (
                                <li key={i} className="mb-1">{step}</li>
                              ))}
                            </ol>
                            {guide.links?.length > 0 && (
                              <div className="d-flex flex-column gap-1">
                                {guide.links.map((l) => (
                                  <Link
                                    key={l.href}
                                    href={l.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="small"
                                  >
                                    {l.label} ↗
                                  </Link>
                                ))}
                              </div>
                            )}
                          </Accordion.Body>
                        </Accordion.Item>
                      ))}
                    </Accordion>
                  </div>
                </div>
              </Col>

              {/* Right: failed jobs table (10 per page) */}
              <Col md={8}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="mb-0">Failed jobs ({syncResultModal.errors.length})</h6>
                  <span className="text-muted small">Click job # · hover Details</span>
                </div>
                <div className="border rounded" style={{ background: '#fff' }}>
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: '48px' }}>#</th>
                        <th style={{ width: '130px' }}>Job</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncResultErrorsPagination.slice.map((err, idx) => {
                        const globalIndex = syncResultErrorsPagination.startIndex + idx + 1;
                        const job = jobs.find((j) => j.id === err.jobId);
                        const jobId = err.jobId || job?.id;
                        const jobLabel = err.job_number ?? (job ? (job.job_number || job.jobNo) : null) ?? err.jobId;
                        const jobHref = jobId ? `/dashboard/jobs/${jobId}` : null;
                        const friendlyReason = getFriendlySyncErrorMessage(err.error);
                        const technicalError = err.error || 'Unknown error';
                        return (
                          <tr key={err.jobId || `${globalIndex}-${idx}`}>
                            <td className="text-muted small align-top">{globalIndex}</td>
                            <td className="text-nowrap align-top">
                              {jobHref ? (
                                <Link
                                  href={jobHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="fw-semibold small"
                                >
                                  {jobLabel}
                                </Link>
                              ) : (
                                jobLabel
                              )}
                            </td>
                            <td className="text-danger small align-top">
                              {friendlyReason}
                              {technicalError && technicalError !== friendlyReason && (
                                <OverlayTrigger
                                  placement="left"
                                  overlay={
                                    <Tooltip id={`sync-err-${globalIndex}`}>
                                      <small style={{ maxWidth: 360, display: 'block' }}>
                                        {technicalError.length > 400
                                          ? `${technicalError.slice(0, 400)}…`
                                          : technicalError}
                                      </small>
                                    </Tooltip>
                                  }
                                >
                                  <span
                                    className="ms-1 text-muted"
                                    style={{ cursor: 'help', textDecoration: 'underline dotted' }}
                                  >
                                    Details
                                  </span>
                                </OverlayTrigger>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={syncResultErrorsPagination.page}
                  totalPages={syncResultErrorsPagination.totalPages}
                  totalItems={syncResultModal.errors.length}
                  onPageChange={setSyncResultErrorsPage}
                />
              </Col>
            </Row>
          ) : (
            <>
              <div className="border rounded overflow-hidden mb-3">
                {[
                  { label: 'Synced', value: syncResultModal.synced, className: 'text-success' },
                  { label: 'Failed', value: syncResultModal.failed, className: 'text-danger' },
                  { label: 'Processed', value: syncResultModal.processed ?? '—', className: 'text-dark' },
                ].map((row, i, arr) => (
                  <div
                    key={row.label}
                    className={`d-flex justify-content-between align-items-center px-3 py-2${i < arr.length - 1 ? ' border-bottom' : ''}`}
                  >
                    <span className="text-muted">{row.label}</span>
                    <span className={`fw-bold fs-5 ${row.className}`}>{row.value}</span>
                  </div>
                ))}
              </div>
              {syncResultModal.remainingUnsynced != null &&
                syncResultModal.remainingUnsynced === 0 &&
                (syncResultModal.processed ?? 0) > 0 && (
                  <Alert variant="success" className="mb-0 small">
                    All unsynced jobs in this run are now in SAP.
                  </Alert>
                )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer onClick={(e) => e.stopPropagation()} className="border-0">
          {syncResultModal.failed > 0 && !syncResultModal.errorMessage && (
            <Button
              variant="outline-primary"
              onClick={() => {
                setSyncResultModal((prev) => ({ ...prev, show: false }));
                openSyncSapConfirm();
              }}
            >
              Sync again
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => setSyncResultModal((prev) => ({ ...prev, show: false }))}
          >
            OK
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={syncCustomerModal.show}
        onHide={() => setSyncCustomerModal((prev) => ({ ...prev, show: false }))}
        centered
        size="md"
      >
  
        <Modal.Body>
          {syncCustomerModal.errorMessage ? (
            <p className="mb-0 text-danger">{syncCustomerModal.errorMessage}</p>
          ) : (
            <>
              <p className="mb-2">{syncCustomerModal.message || 'Assignment finished.'}</p>
              <ul className="mb-0 small text-muted">
                <li>
                  Updated: <strong>{syncCustomerModal.updated}</strong>
                </li>
                <li>
                  Skipped (no match): <strong>{syncCustomerModal.skipped}</strong>
                </li>
                {syncCustomerModal.failed > 0 && (
                  <li className="text-danger">
                    Errors: <strong>{syncCustomerModal.failed}</strong>
                  </li>
                )}
                <li>
                  Total unassigned AIFM jobs scanned: <strong>{syncCustomerModal.total}</strong>
                </li>
              </ul>
              <p className="mt-3 mb-0 small text-muted">
                Tip: log in to SAP Business One in this browser so CardName → CardCode lookup runs. If
                the customer already exists in the portal under the same CardCode, no extra row is
                created.
              </p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setSyncCustomerModal((prev) => ({ ...prev, show: false }))}>
            OK
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={syncAddressModal.show}
        onHide={() => setSyncAddressModal((prev) => ({ ...prev, show: false }))}
        centered
        size="md"
      >
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2">
            {syncAddressModal.errorMessage ? (
              <XLg className="text-danger" />
            ) : syncAddressModal.failed > 0 || syncAddressModal.skipped > 0 ? (
              <CheckCircleFill className="text-warning" />
            ) : (
              <CheckCircleFill className="text-success" />
            )}
            Job address sync
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {syncAddressModal.errorMessage ? (
            <p className="mb-0 text-danger">{syncAddressModal.errorMessage}</p>
          ) : (
            <>
              <p className="mb-2">{syncAddressModal.message || 'Address sync finished.'}</p>
              <ul className="mb-0 small text-muted">
                <li>
                  Updated (total): <strong>{syncAddressModal.updated}</strong>
                  {' — '}
                  from tags: <strong>{syncAddressModal.updatedFromTag ?? 0}</strong>, from location:{' '}
                  <strong>{syncAddressModal.updatedFromLocation ?? 0}</strong>
                </li>
                <li>
                  Skipped (tag pass): <strong>{syncAddressModal.skipped}</strong>
                </li>
                {syncAddressModal.failed > 0 && (
                  <li className="text-danger">
                    Errors: <strong>{syncAddressModal.failed}</strong>
                  </li>
                )}
                <li>
                  Jobs with <code className="small">[ADDRESS:…]</code> considered:{' '}
                  <strong>{syncAddressModal.totalWithAddressTag ?? syncAddressModal.total}</strong>
                </li>
                <li>
                  AIFM jobs with a linked location checked:{' '}
                  <strong>{syncAddressModal.totalLocationCandidates ?? 0}</strong>
                </li>
              </ul>
              <p className="mt-3 mb-0 small text-muted">
                If counts are zero, you may have no AIFM jobs yet, or schedule rows already have
                addresses. Re-import from AIFM to add <code className="small">[ADDRESS:…]</code> to
                descriptions when service locations exist.
              </p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setSyncAddressModal((prev) => ({ ...prev, show: false }))}>
            OK
          </Button>
        </Modal.Footer>
      </Modal>

      <GeeksSEO title="Job Lists | SAS&ME - SAP B1 | Portal" />

      <div className="dashboard-wrapper" style={{ width: "100%", maxWidth: "100%" }}>
        <div style={{ width: "100%", maxWidth: "100%", paddingLeft: "1.5rem", paddingRight: "1.5rem" }}>
          <Row>
            <Col md={12} xs={12} className="mb-5">
              <DashboardListStickySearch
                style={STICKY_SEARCH_GRADIENT_BLUE}
                bodyClassName="p-4"
              >
                  <Row className="align-items-center mb-3">
                    <Col md={12}>
                      <div className="d-flex align-items-center gap-3">
                        <div style={{ minWidth: "140px" }}>
                          <h6 className="mb-0 text-white d-flex align-items-center">🔍 Search Filters</h6>
                          <small className="text-white" style={{ opacity: 0.9, fontSize: "0.75rem" }}>
                            Press Enter to search
                          </small>
                        </div>
                        <div className="flex-grow-1">
                          <Form.Control
                            type="text"
                            value={searchDraft}
                            onChange={(e) => setSearchDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                applySearchDraft();
                              }
                            }}
                            placeholder="🔍 Search anything... Job Number, Customer, Status, Priority, Location, Technician, etc."
                            style={{
                              fontSize: "0.95rem",
                              padding: "0.65rem 1rem",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              fontWeight: "400",
                            }}
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          variant="light"
                          size="sm"
                          onClick={clearAllJobFilters}
                          disabled={!canClearJobFilters}
                          className="d-flex align-items-center gap-1"
                          style={{
                            minWidth: "90px",
                            fontWeight: "500",
                            borderRadius: "6px",
                          }}
                        >
                          <FeatherX size={14} />
                          Clear
                        </Button>
                      </div>
                    </Col>
                  </Row>

                  <Row>
                    <Col md={12}>
                      <div className="d-flex align-items-start gap-3 flex-wrap justify-content-end">
                        <div style={{ width: "150px" }}>
                          <label
                            className="text-white mb-2"
                            style={{ fontSize: "0.75rem", fontWeight: "500", display: "block", opacity: 0.9 }}
                          >
                            Status
                          </label>
                          <Form.Select
                            value={filters.status}
                            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                            style={{
                              fontSize: "0.95rem",
                              padding: "0.65rem 1rem",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              fontWeight: "400",
                            }}
                          >
                            <option value="all">All Status</option>
                            {jobStatuses.map((s) => (
                              <option key={`${s.value ?? ""}-${s.id ?? s.name}`} value={String(s.value ?? "")}>
                                {formatJobStatusDisplayLabel(s.name)}
                              </option>
                            ))}
                          </Form.Select>
                        </div>

                        <div style={{ width: "150px" }}>
                          <label
                            className="text-white mb-2"
                            style={{ fontSize: "0.75rem", fontWeight: "500", display: "block", opacity: 0.9 }}
                          >
                            Priority
                          </label>
                          <Form.Select
                            value={filters.priority}
                            onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
                            style={{
                              fontSize: "0.95rem",
                              padding: "0.65rem 1rem",
                              border: "none",
                              borderRadius: "8px",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              fontWeight: "400",
                            }}
                          >
                            <option value="all">All Priority</option>
                            <option value="Low">Low</option>
                            <option value="Medium">Normal</option>
                            <option value="High">High</option>
                          </Form.Select>
                        </div>

                        <div style={{ width: "160px" }}>
                          <label
                            className="text-white mb-2"
                            style={{ fontSize: "0.75rem", fontWeight: "500", display: "block", opacity: 0.9 }}
                          >
                            Start Date
                          </label>
                          <div style={{ position: "relative" }}>
                            <i
                              className="fe fe-calendar text-white"
                              style={{
                                position: "absolute",
                                left: "12px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                zIndex: 1,
                                pointerEvents: "none",
                                opacity: 0.8,
                              }}
                            />
                            <Flatpickr
                              key={`start-${filters.dateRange.start}`}
                              value={filters.dateRange.start ? new Date(`${filters.dateRange.start}T00:00:00`) : null}
                              options={{
                                dateFormat: "d/m/Y",
                                altInput: true,
                                altFormat: "d/m/Y",
                                placeholder: "Start Date",
                              }}
                              className="form-control"
                              style={{
                                fontSize: "0.95rem",
                                padding: "0.65rem 1rem 0.65rem 2.5rem",
                                width: "100%",
                                border: "none",
                                borderRadius: "8px",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                                fontWeight: "400",
                              }}
                              onChange={(selectedDates) => {
                                if (selectedDates && selectedDates.length > 0) {
                                  const d = selectedDates[0];
                                  const y = d.getFullYear();
                                  const m = String(d.getMonth() + 1).padStart(2, "0");
                                  const day = String(d.getDate()).padStart(2, "0");
                                  const nextRange = {
                                    ...filters.dateRange,
                                    start: `${y}-${m}-${day}`,
                                  };
                                  persistJobsDateFilter(nextRange);
                                  setFilters((prev) => ({
                                    ...prev,
                                    dateRange: { ...prev.dateRange, start: `${y}-${m}-${day}` },
                                  }));
                                } else {
                                  const nextRange = { ...filters.dateRange, start: null };
                                  persistJobsDateFilter(nextRange);
                                  setFilters((prev) => ({
                                    ...prev,
                                    dateRange: { ...prev.dateRange, start: null },
                                  }));
                                }
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ width: "160px" }}>
                          <label
                            className="text-white mb-2"
                            style={{ fontSize: "0.75rem", fontWeight: "500", display: "block", opacity: 0.9 }}
                          >
                            End Date
                          </label>
                          <div style={{ position: "relative" }}>
                            <i
                              className="fe fe-calendar text-white"
                              style={{
                                position: "absolute",
                                left: "12px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                zIndex: 1,
                                pointerEvents: "none",
                                opacity: 0.8,
                              }}
                            />
                            <Flatpickr
                              key={`end-${filters.dateRange.end}`}
                              value={filters.dateRange.end ? new Date(`${filters.dateRange.end}T00:00:00`) : null}
                              options={{
                                dateFormat: "d/m/Y",
                                altInput: true,
                                altFormat: "d/m/Y",
                                placeholder: "End Date",
                              }}
                              className="form-control"
                              style={{
                                fontSize: "0.95rem",
                                padding: "0.65rem 1rem 0.65rem 2.5rem",
                                width: "100%",
                                border: "none",
                                borderRadius: "8px",
                                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                                fontWeight: "400",
                              }}
                              onChange={(selectedDates) => {
                                if (selectedDates && selectedDates.length > 0) {
                                  const d = selectedDates[0];
                                  const y = d.getFullYear();
                                  const m = String(d.getMonth() + 1).padStart(2, "0");
                                  const day = String(d.getDate()).padStart(2, "0");
                                  const nextRange = {
                                    ...filters.dateRange,
                                    end: `${y}-${m}-${day}`,
                                  };
                                  persistJobsDateFilter(nextRange);
                                  setFilters((prev) => ({
                                    ...prev,
                                    dateRange: { ...prev.dateRange, end: `${y}-${m}-${day}` },
                                  }));
                                } else {
                                  const nextRange = { ...filters.dateRange, end: null };
                                  persistJobsDateFilter(nextRange);
                                  setFilters((prev) => ({
                                    ...prev,
                                    dateRange: { ...prev.dateRange, end: null },
                                  }));
                                }
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      {filters.dateRange.start && !filters.dateRange.end && (
                        <small
                          className="text-white d-block text-end mt-2"
                          style={{ opacity: 0.75, fontSize: "0.7rem" }}
                        >
                          Showing jobs from {formatSingaporeDate(filters.dateRange.start)} onward
                        </small>
                      )}
                      {isUnboundedJobsDateRange(filters.dateRange) && (
                        <small
                          className="text-white d-block text-end mt-2"
                          style={{ opacity: 0.75, fontSize: "0.7rem" }}
                        >
                          Showing all scheduled jobs
                        </small>
                      )}
                    </Col>
                  </Row>
              </DashboardListStickySearch>

              <Card className="border-0 shadow-sm">
                <Card.Header className="bg-transparent border-0 px-3 pt-3 pb-0">
                  <div className="d-flex align-items-baseline gap-2 flex-wrap">
                    <h5 className="mb-0" style={{ fontSize: '1.25rem', fontWeight: '600', color: '#1e293b' }}>
                      Jobs
                    </h5>
                    {!isInitialLoad && (
                      <span className="text-muted small">
                        {jobsTotalCount.toLocaleString()}{' '}
                        {jobsTotalCount === 1 ? 'job' : 'jobs'}
                      </span>
                    )}
                    {isRefreshing && (
                      <Badge bg="light" text="dark" className="d-inline-flex align-items-center gap-1">
                        <Spinner animation="border" size="sm" style={{ width: '0.65rem', height: '0.65rem' }} />
                        Updating…
                      </Badge>
                    )}
                  </div>
                </Card.Header>
                <Card.Body className="p-0">
                  <div className="px-3 py-3 border-bottom bg-white">
                    <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
                      <div className="d-flex align-items-center">
                        <span className="text-muted me-2">Show:</span>
                        <div className="position-relative" style={{ width: '90px' }}>
                          <Form.Select
                            size="sm"
                            value={perPage}
                            onChange={(e) => {
                              setPerPage(Number(e.target.value));
                              setCurrentPage(0);
                            }}
                            className="me-2"
                            disabled={isInitialLoad}
                            aria-label="Rows per page"
                          >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </Form.Select>
                        </div>
                        <span className="text-muted">entries per page</span>
                      </div>
                      <div className="d-flex align-items-center gap-3 flex-wrap ms-md-auto">
                        <div className="text-muted d-flex align-items-center">
                          <ListUl size={14} className="me-2 flex-shrink-0" />
                          {isInitialLoad ? (
                            <span>Loading...</span>
                          ) : jobsTotalCount === 0 ? (
                            <span>Showing 0 of 0</span>
                          ) : (
                            <span>
                              {`Showing ${currentPage * perPage + 1}-${Math.min(
                                (currentPage + 1) * perPage,
                                jobsTotalCount
                              )} of ${jobsTotalCount.toLocaleString()}`}
                            </span>
                          )}
                        </div>
                        <div className="d-flex flex-wrap align-items-center justify-content-end gap-2">
                      <Button
                        onClick={() => router.push("/dashboard/jobs/create-jobs")}
                        className="create-job-button"
                        variant="primary"
                        size="sm"
                        style={{
                          borderRadius: '8px',
                          padding: '8px 14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600,
                        }}
                      >
                        <FaPlus size={16} />
                        <span>Add New Job</span>
                      </Button>
                     {/* Uncomment or set SHOW_JOB_SYNC_SAP_BUTTON for manual debug sync. */}
                      <OverlayTrigger
                        placement="bottom"
                        overlay={
                          <Tooltip id="jobs-sync-sap-tooltip" style={{ maxWidth: 320 }}>
                            Sync unsynced jobs to SAP. Preview with date filter (today, range, or all). Keep the
                            tab open during sync — do not refresh.
                          </Tooltip>
                        }
                      >
                        <span>
                          <Button
                            onClick={handleSyncToSap}
                            disabled={syncToSapLoading || syncCustomerLoading || syncAddressLoading}
                            variant="outline-primary"
                            size="sm"
                            style={{
                              borderRadius: '8px',
                              padding: '8px 14px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontWeight: 600,
                            }}
                            aria-label="Sync Jobs to SAP"
                          >
                            {syncToSapLoading ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <RefreshCw size={16} />
                            )}
                            <span>Sync Jobs</span>
                          </Button>
                        </span>
                      </OverlayTrigger>
                      <Button
                        onClick={() => void handleRefreshJobsList()}
                        disabled={jobsFetching}
                        variant="outline-primary"
                        size="sm"
                        style={{
                          borderRadius: '8px',
                          padding: '8px 14px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontWeight: 600,
                        }}
                        aria-label="Refresh Table List"
                      >
                        {jobsFetching ? (
                          <Spinner animation="border" size="sm" />
                        ) : (
                          <RefreshCw size={16} />
                        )}
                        <span>Refresh Table List</span>
                      </Button>
                      {SHOW_JOB_ADDRESS_SYNC_BUTTON && (
                        <OverlayTrigger
                          placement="bottom"
                          overlay={
                            <Tooltip id="jobs-sync-addr-tooltip" style={{ maxWidth: 300 }}>
                              Job address sync: fill empty schedule addresses from [ADDRESS:…] and linked AIFM
                              locations.
                            </Tooltip>
                          }
                        >
                          <span>
                            <Button
                              onClick={handleSyncJobAddresses}
                              disabled={syncToSapLoading || syncCustomerLoading || syncAddressLoading}
                              variant="outline-primary"
                              className="d-inline-flex align-items-center justify-content-center"
                              size="sm"
                              style={{ width: 38, height: 38, borderRadius: 8, padding: 0 }}
                              aria-label="Job address sync"
                            >
                              {syncAddressLoading ? <Spinner animation="border" size="sm" /> : <GeoAltFill size={18} />}
                            </Button>
                          </span>
                        </OverlayTrigger>
                      )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {error && (
                    <div className="alert alert-danger m-4 mb-0">{error}</div>
                  )}
                  
                  {/* Bulk Actions Bar */}
                  {selectedRows.length > 0 && (
                    <div className="d-flex justify-content-between align-items-center p-3 border-bottom" style={{ backgroundColor: '#f8fafc' }}>
                      <div className="d-flex align-items-center gap-2">
                        <Badge bg="primary" style={{ fontSize: '14px', padding: '6px 12px' }}>
                          {selectedRows.length} job{selectedRows.length > 1 ? 's' : ''} selected
                        </Badge>
                      </div>
                      <div className="d-flex gap-2">
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => setSelectedRows([])}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '6px',
                            fontWeight: '500'
                          }}
                        >
                          Clear Selection
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={handleBulkDelete}
                          style={{
                            backgroundColor: '#dc2626',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '6px',
                            fontWeight: '500'
                          }}
                        >
                          <Trash size={14} className="me-1" />
                          Delete Selected
                        </Button>
                      </div>
                    </div>
                  )}
                  
                  {isInitialLoad ? (
                    <div className="text-center py-5">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : !showTable && jobsTotalCount === 0 ? (
                    <div className="text-center py-5">
                      <p className="mb-0 text-muted">No jobs found matching the selected filters</p>
                    </div>
                  ) : (
                    <>
                      <div className="w-100" style={{ maxWidth: '100%' }}>
                        <ResponsiveTable
                          data={sortedAndPaginatedJobs}
                          columns={muiColumns}
                          loading={isRefreshing}
                          selectable={true}
                          selectedRows={selectedRows}
                          onSelectionChange={handleSelectionChange}
                          orderBy={orderBy}
                          order={order}
                          onSortChange={handleSortChange}
                          hiddenColumns={['equipments', 'updated_at', 'followUps', 'assignedWorkers']}
                          showIndexColumn={true}
                          rowOffset={currentPage * perPage}
                          fitWidth
                          renderEmptyState={() => (
                            <div className="text-center py-5">
                              <i className="fe fe-inbox mb-3" style={{ fontSize: "48px", color: "#cbd5e1" }}></i>
                              <div className="text-muted mb-2 fw-semibold">No jobs found</div>
                              <small className="text-muted">Try adjusting your search terms or filters</small>
                            </div>
                          )}
                        />
                      </div>
                      <div className="border-top">
                        <TablePagination
                          currentPage={currentPage + 1}
                          totalPages={Math.max(1, Math.ceil(jobsTotalCount / perPage))}
                          totalItems={jobsTotalCount}
                          onPageChange={(newPage) => {
                            setCurrentPage(newPage - 1);
                          }}
                          disabled={isRefreshing}
                        />
                      </div>
                    </>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </div>
      </div>

      <style jsx global>{`
        .jobs-actions-wrap {
          vertical-align: middle;
        }

        .jobs-actions-wrap > * {
          display: inline-flex !important;
          align-items: center;
        }

        .jobs-action-view {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 8px;
          text-decoration: none;
          color: #fff;
          background-color: #3b82f6;
          border: none;
          transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
        }
        .jobs-action-view:hover {
          background-color: #2563eb;
          color: #fff;
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
        }
        .jobs-action-delete {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          width: 36px;
          height: 36px;
          min-width: 36px;
          max-width: 36px;
          min-height: 36px;
          max-height: 36px;
          padding: 0;
          flex: 0 0 auto;
          align-self: center;
          border-radius: 8px;
          border: none;
          color: #fff;
          background-color: #ef4444;
          cursor: pointer;
          transition: background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
        }
        .jobs-action-delete:hover {
          background-color: #dc2626;
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.35);
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

export default ViewJobs;
