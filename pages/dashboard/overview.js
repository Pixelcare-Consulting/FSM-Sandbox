// imports.js
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Row,
  Col,
  Button,
  Card,
  Badge,
  Dropdown,
} from "react-bootstrap";
import { ApexCharts } from "widgets";
import Swal from "sweetalert2";
import Cookies from "js-cookie";
import { jobService } from "../../lib/supabase/database";
import { useCurrentUserProfile } from '@/hooks/useCurrentUser';
import { useRouter } from "next/router";
import Link from "next/link";
import { FaBell, FaPlus } from "react-icons/fa";
import { toast } from "react-hot-toast";
import { memo } from "react";
import { useQuery } from "react-query";
import {
  findJobStatusEntry,
  getJobStatusLabelFromList,
  getPerformanceOverviewBarColors,
} from "../../utils/jobStatusDefaults";
import {
  fetchJobStatuses,
} from "../../utils/jobStatusSettings";
import { jobDisplayCustomerName } from "../../lib/utils/embeddedCustomerName";
// Constants
const TIME_FILTERS = ["Today", "This Week", "This Month", "This Year"];
/** Field Service Distribution / job-type fallback colors (Performance bars use Settings via getPerformanceOverviewBarColors). */
const CHART_COLORS = {
  completed: "#16a34a",
  pending: "#ca8a04",
  created: "#ca8a04",
  inprogress: "#0284c7",
  scheduled: "#2563eb",
  rescheduled: "#7c3aed",
  cancelled: "#dc2626",
  emergency: "#e74a3b",
  maintenance: "#1cc88a",
  installation: "#FFB800",
  repair: "#36B9CC",
  other: "#858796",
  default: "#858796",
};

/** Fallback when a status has no color in Settings / merged list (distinct pie slices only; not SAP-specific). */
const DISTRIBUTION_FALLBACK_PALETTE = [
  "#2563eb", "#16a34a", "#ca8a04", "#dc2626", "#7c3aed", "#0284c7", "#db2777", "#0d9488",
  "#ea580c", "#4f46e5", "#0891b2", "#65a30d", "#e11d48", "#8b5cf6", "#f97316",
];

function distributionSliceColor(rawStatus, jobStatusesList, paletteIndex) {
  const entry = findJobStatusEntry(rawStatus, jobStatusesList);
  if (entry?.color) return entry.color;
  return DISTRIBUTION_FALLBACK_PALETTE[paletteIndex % DISTRIBUTION_FALLBACK_PALETTE.length];
}

function distributionSliceLabel(rawStatus, jobStatusesList) {
  const key = rawStatus != null ? String(rawStatus).trim() : "";
  if (!key) return "Unknown";
  if (jobStatusesList?.length) {
    const human = getJobStatusLabelFromList(key, jobStatusesList);
    if (human && String(human).trim() !== key) return human;
  }
  return getJobStatusLabelFromList(key, jobStatusesList) || `Status ${key}`;
}

/** Inline “What’s New” feed + SweetAlert modal share this list */
const WHATS_NEW_ITEMS = [
  {
    icon: "🚀",
    title: "Enhanced Dashboard 2.0",
    description: "Experience our most powerful insights yet.",
    tag: "New",
    tagType: "new",
    highlight: true,
  },
  {
    icon: "🏢",
    title: "Customer Sub-Locations",
    description: "Search multiple locations per customer with enhanced hierarchy.",
    tag: "New",
    tagType: "new",
    highlight: true,
  },
  {
    icon: "🔍",
    title: "Smart Global Search",
    description: "Enhanced search with filters and real-time suggestions.",
    tag: "Improved",
    tagType: "improved",
    highlight: false,
  },
  {
    icon: "🔐",
    title: "Advanced Authentication",
    description: "Enhanced session management with security controls and auto-renewal.",
    tag: "Improved",
    tagType: "improved",
    highlight: false,
  },
  {
    icon: "✨",
    title: "UI Refresh",
    description: "Modern interface with improved accessibility and navigation.",
    tag: "Improved",
    tagType: "improved",
    highlight: false,
  },
  {
    icon: "⚡",
    title: "Performance Boost",
    description: "Faster page loads and smoother transitions.",
    tag: "Improved",
    tagType: "improved",
    highlight: false,
  },
];

const FilterButtons = memo(({ currentFilter, onFilterChange }) => {
  return (
    <div className="d-flex gap-2">
      {TIME_FILTERS.map((filter) => (
        <Button
          key={filter}
          onClick={() => onFilterChange(filter)}
          variant={currentFilter === filter ? "light" : "outline-light"}
          className="filter-button"
          style={{
            borderRadius: "8px",
            padding: "8px 16px",
            fontSize: "14px",
            fontWeight: "500",
            transition: "all 0.2s ease",
          }}
        >
          {filter}
        </Button>
      ))}
    </div>
  );
});

// Optionally add a display name for debugging purposes
FilterButtons.displayName = 'FilterButtons';

// LoadingOverlay Component
const LoadingOverlay = ({ isLoading }) => {
  if (!isLoading) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(255, 255, 255, 0.7)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
    </div>
  );
};

// Helper Functions
const getDateRange = (period) => {
  // Create dates in local timezone
  const now = new Date();
  const start = new Date();
  const end = new Date();

  // Reset hours for consistent comparison
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case "Today":
      // No additional modification needed - already set for today
      break;
    case "This Week":
      // Get Monday of current week
      const dayOfWeek = start.getDay();
      const diff = start.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      start.setDate(diff);
      end.setDate(start.getDate() + 6);
      break;
    case "This Month":
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 0);
      break;
    case "This Year":
      start.setMonth(0, 1);
      end.setMonth(11, 31);
      break;
    default:
      // Default to today
      break;
  }

  return { start, end };
};

const sanitizeNameValue = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const invalidTokens = ['na', 'n/a', 'null', 'undefined', '-'];
  return invalidTokens.includes(trimmed.toLowerCase()) ? null : trimmed;
};

// Main Component
const Overview = () => {
  // Router
  const router = useRouter();

  // State Management
  const [timeFilter, setTimeFilter] = useState("Today");
  const { profile: userDetails } = useCurrentUserProfile();
  const [isLoading, setIsLoading] = useState(false);
  const [overviewPeriods, setOverviewPeriods] = useState({});
  const [allFollowUps, setAllFollowUps] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [lastLoginTime, setLastLoginTime] = useState(null);

  useEffect(() => {
    if (userDetails?.updated_at) {
      setLastLoginTime(new Date(userDetails.updated_at));
    }
  }, [userDetails?.updated_at]);

  // Dashboard Metrics
  const [newJobsCount, setNewJobsCount] = useState(0);
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [taskGrowth, setTaskGrowth] = useState(0);
  const [activeWorkers, setActiveWorkers] = useState(0);
  
  // Follow Up Metrics
  const [totalFollowUps, setTotalFollowUps] = useState(0);
  const [loggedFollowUps, setLoggedFollowUps] = useState(0);
  const [inProgressFollowUps, setInProgressFollowUps] = useState(0);
  const [closedFollowUps, setClosedFollowUps] = useState(0);
  const [cancelledFollowUps, setCancelledFollowUps] = useState(0);
  
  // Customer Metrics
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [activeCustomers, setActiveCustomers] = useState(0);
  const [inactiveCustomers, setInactiveCustomers] = useState(0);

  const {
    data: overviewPayload,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
  } = useQuery(
    ['dashboard-overview-stats'],
    async () => {
      const response = await fetch('/api/dashboard/overview-stats');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load dashboard stats (${response.status})`);
      }
      return response.json();
    },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }
  );

    // Add new state for filtered metrics
    const [filteredMetrics, setFilteredMetrics] = useState({
      totalTasks: 0,
      activeWorkers: 0,
      pendingTasks: 0,
      completedTasks: 0,
      taskGrowth: 0
    });

  // Chart Data - ApexCharts format (performance bar colors = Dashboard → Settings → Job Statuses)
  const [jobStatusesList, setJobStatusesList] = useState([]);

  const performanceBarColors = useMemo(() => {
    const raw = getPerformanceOverviewBarColors(jobStatusesList);
    return raw.map(
      (c, i) =>
        c ?? DISTRIBUTION_FALLBACK_PALETTE[i % DISTRIBUTION_FALLBACK_PALETTE.length]
    );
  }, [jobStatusesList]);

  const [performanceChartOptions, setPerformanceChartOptions] = useState(() => ({
    chart: {
      type: "bar",
      height: 350,
      toolbar: { show: false },
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "55%",
        borderRadius: 4,
      },
    },
    dataLabels: {
      enabled: false,
    },
    stroke: {
      show: true,
      width: 2,
      colors: ["transparent"],
    },
    xaxis: {
      categories: [],
    },
    yaxis: {
      title: {
        text: "Number of Jobs",
      },
    },
    fill: {
      opacity: 1,
    },
    colors: [0, 1, 2].map(
      (i) => DISTRIBUTION_FALLBACK_PALETTE[i % DISTRIBUTION_FALLBACK_PALETTE.length]
    ),
    legend: {
      position: "top",
      horizontalAlign: "left",
    },
    tooltip: {
      y: {
        formatter: function (val) {
          return val + " jobs";
        },
      },
    },
  }));

  const [performanceChartSeries, setPerformanceChartSeries] = useState([
    {
      name: "Completed",
      data: [],
    },
    {
      name: "Created",
      data: [],
    },
    {
      name: "In Progress",
      data: [],
    },
  ]);

  const [taskDistributionChartOptions, setTaskDistributionChartOptions] = useState({
    // `type` is set on <ApexCharts type="donut" /> — duplicating on chart.type can break Apex v4.
    chart: {
      height: 300,
      toolbar: { show: false },
    },
    labels: ['Loading'],
    colors: [CHART_COLORS.default],
    legend: {
      position: 'bottom',
      fontSize: '12px',
      fontWeight: 500,
      itemMargin: { horizontal: 10, vertical: 4 },
      markers: { width: 10, height: 10, radius: 3 },
    },
    plotOptions: {
      pie: {
        donut: {
          size: '62%',
        },
      },
    },
    dataLabels: {
      enabled: true,
      formatter: function (val, opts) {
        try {
          const idx = opts?.seriesIndex ?? 0;
          const sliceVals = opts?.w?.globals?.series;
          const count = Array.isArray(sliceVals) ? sliceVals[idx] : null;
          const pct = typeof val === 'number' ? val.toFixed(1) : String(val);
          return count != null ? `${count} (${pct}%)` : `${pct}%`;
        } catch (e) {
          return typeof val === 'number' ? `${val.toFixed(1)}%` : '';
        }
      },
    },
    tooltip: {
      y: {
        formatter: function (val, opts) {
          try {
            const totals = opts?.w?.globals?.seriesTotals;
            const total = Array.isArray(totals) && totals.length
              ? totals.reduce((a, b) => a + b, 0)
              : 0;
            const n = typeof val === 'number' ? val : Number(val);
            const percentage = total > 0 ? ((n / total) * 100).toFixed(1) : '0';
            return `${n} jobs (${percentage}%)`;
          } catch (e) {
            return `${val}`;
          }
        },
      },
    },
  });

  /** Single numeric series for donut — never start empty (Apex v4 renders blank for []). */
  const [taskDistributionChartSeries, setTaskDistributionChartSeries] = useState([1]);

  /** Dispatch-friendly stats for the same time window as the donut (created date in range). */
  const [fieldServiceInsights, setFieldServiceInsights] = useState({
    periodTotal: 0,
    topStatusLabel: null,
    topStatusCount: 0,
    topStatusPct: null,
    completedCount: 0,
    completionRatePct: "0",
    unassignedCount: 0,
    inProgressInPeriod: 0,
    highPriorityCount: 0,
    overdueScheduledCount: 0,
    uniqueCustomers: 0,
  });

  useEffect(() => {
    let cancelled = false;
    fetchJobStatuses()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setJobStatusesList(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPerformanceChartOptions((prev) => ({
      ...prev,
      colors: performanceBarColors,
    }));
  }, [performanceBarColors]);

  // Chart options are now in state, no need for memoized values

// Apply pre-aggregated period payload from /api/dashboard/overview-stats
const applyPeriodPayload = useCallback((periodData) => {
  if (!periodData) return;

  const metrics = periodData.stats || periodData.metrics || {};
  setTotalTasks(metrics.totalTasks ?? 0);
  setActiveWorkers(metrics.activeWorkers ?? 0);
  setPendingTasks(metrics.pendingTasks ?? 0);
  setCompletedToday(metrics.completedTasks ?? 0);
  setTaskGrowth(metrics.taskGrowth ?? 0);
  setNewJobsCount(metrics.newJobsCount ?? 0);
  setActiveJobsCount(metrics.activeJobsCount ?? 0);
  setFilteredMetrics({
    totalTasks: metrics.totalTasks ?? 0,
    activeWorkers: metrics.activeWorkers ?? 0,
    pendingTasks: metrics.pendingTasks ?? 0,
    completedTasks: metrics.completedTasks ?? 0,
    taskGrowth: metrics.taskGrowth ?? 0,
  });

  const chart = periodData.performanceChart || periodData;
  const labels = chart.labels || [];
  setPerformanceChartSeries([
    { name: "Completed", data: chart.completed || [] },
    { name: "Created", data: chart.pending || [] },
    { name: "In Progress", data: chart.inProgress || [] },
  ]);
  setPerformanceChartOptions((prev) => ({
    ...prev,
    xaxis: { ...prev.xaxis, categories: labels.length > 0 ? labels : ["No Data"] },
  }));

  const distObj = periodData.distribution?.statusBuckets
    ? null
    : periodData.distribution || {};
  const buckets = periodData.distribution?.statusBuckets
    ? periodData.distribution.statusBuckets
    : Object.entries(distObj || {})
        .map(([raw, count]) => ({ raw, count }))
        .sort((a, b) => b.count - a.count);

  const distributionLabels = buckets.map(({ raw }) => distributionSliceLabel(raw, jobStatusesList));
  const distributionData = buckets.map(({ count }) => count);
  const typeColors = buckets.map(({ raw }, idx) =>
    distributionSliceColor(raw, jobStatusesList, idx)
  );

  const periodTotal = metrics.totalTasks ?? buckets.reduce((s, b) => s + (b.count || 0), 0);
  const topRaw0 = buckets[0]?.raw ?? null;
  const topCount0 = buckets[0]?.count ?? 0;
  const topLabel0 =
    topRaw0 != null
      ? distributionSliceLabel(topRaw0, jobStatusesList)
      : periodTotal > 0
        ? "Unspecified status"
        : null;
  const topPct0 = periodTotal > 0 && topCount0 ? ((topCount0 / periodTotal) * 100).toFixed(1) : null;

  const insights = periodData.insights || {};
  const topLabelFromInsights =
    insights.topStatusRaw != null
      ? distributionSliceLabel(insights.topStatusRaw, jobStatusesList)
      : null;

  setFieldServiceInsights({
    periodTotal: insights.periodTotal ?? periodTotal,
    topStatusLabel: topLabelFromInsights ?? topLabel0,
    topStatusCount: insights.topStatusCount ?? topCount0,
    topStatusPct: insights.topStatusPct ?? topPct0,
    completedCount: insights.completedCount ?? metrics.completedTasks ?? 0,
    completionRatePct:
      insights.completionRatePct ??
      (periodTotal > 0 ? (((metrics.completedTasks ?? 0) / periodTotal) * 100).toFixed(1) : "0"),
    unassignedCount: insights.unassignedCount ?? 0,
    inProgressInPeriod: insights.inProgressInPeriod ?? metrics.activeJobsCount ?? 0,
    highPriorityCount: insights.highPriorityCount ?? 0,
    overdueScheduledCount: insights.overdueScheduledCount ?? 0,
    uniqueCustomers: insights.uniqueCustomers ?? 0,
  });

  if (distributionLabels.length === 0) {
    setTaskDistributionChartSeries([1]);
    setTaskDistributionChartOptions((prev) => ({
      ...prev,
      labels: ["No jobs in this period"],
      colors: [CHART_COLORS.other],
      plotOptions: {
        ...prev.plotOptions,
        pie: {
          ...prev.plotOptions?.pie,
          dataLabels: { ...(prev.plotOptions?.pie?.dataLabels || {}), minAngle: 0 },
          donut: { size: "62%" },
        },
      },
    }));
  } else {
    setTaskDistributionChartSeries(distributionData);
    setTaskDistributionChartOptions((prev) => ({
      ...prev,
      labels: distributionLabels,
      colors: typeColors,
      dataLabels: {
        ...prev.dataLabels,
        enabled: distributionData.length <= 8,
      },
      plotOptions: {
        ...prev.plotOptions,
        pie: {
          ...prev.plotOptions?.pie,
          dataLabels: {
            ...(prev.plotOptions?.pie?.dataLabels || {}),
            minAngle: 14,
          },
          donut: { size: "62%", ...prev.plotOptions?.pie?.donut },
        },
      },
      stroke: { show: true, width: 2, colors: ["#fff"] },
    }));
  }
}, [jobStatusesList]);

useEffect(() => {
  if (!overviewPayload) return;

  const periods = overviewPayload.periods || {};
  const followUpCounts = overviewPayload.followUpCounts || {};

  setOverviewPeriods(periods);
  setAllFollowUps([]);

  setTotalFollowUps(followUpCounts.total ?? 0);
  setLoggedFollowUps(followUpCounts.logged ?? 0);
  setInProgressFollowUps(followUpCounts.inProgress ?? 0);
  setClosedFollowUps(followUpCounts.closed ?? 0);
  setCancelledFollowUps(followUpCounts.cancelled ?? 0);

  applyPeriodPayload(periods.Today);
}, [overviewPayload, applyPeriodPayload]);

useEffect(() => {
  if (isOverviewError) {
    toast.error("Error loading dashboard data");
  }
}, [isOverviewError]);

// Re-apply chart labels/colors when job statuses load (SAP labels/colors) or period changes
useEffect(() => {
  if (isOverviewLoading || !overviewPayload) return;
  applyPeriodPayload(overviewPeriods[timeFilter]);
}, [
  jobStatusesList,
  overviewPeriods,
  timeFilter,
  isOverviewLoading,
  overviewPayload,
  applyPeriodPayload,
]);

// Modified handleTimeFilterChange
const handleTimeFilterChange = useCallback((period) => {
  setTimeFilter(period);
  setIsLoading(true);

  try {
    applyPeriodPayload(overviewPeriods[period]);
  } catch (error) {
    console.error("Error updating dashboard:", error);
    toast.error("Error updating filter");
  } finally {
    setIsLoading(false);
  }
}, [overviewPeriods, applyPeriodPayload]);

// Navigation handlers
const handleNewTask = () => router.push("/jobs/create");

const addWelcomeAlertStyles = (popup) => {
  const style = document.createElement("style");
  style.textContent = `
    .welcome-container {
      display: flex;
      gap: 24px;
      height: 600px;
      width: 100%;
      background: white;
      position: relative;
    }

    .welcome-left {
      width: 300px;
      flex-shrink: 0;
      padding: 24px;
      border-right: 1px solid #e5e7eb;
      display: flex;
      flex-direction: column;
      background: white;
    }

    .welcome-right {
      flex: 1;
      display: flex;
      flex-direction: column;
      max-width: 800px;
      position: relative;
      overflow: hidden;
    }

    .welcome-header-fixed {
      position: sticky;
      top: 0;
      background: white;
      padding: 16px 20px;
      z-index: 10;
      border-bottom: 1px solid #e5e7eb;
    }

    .welcome-title {
      text-align: left;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title-row h2 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .subtitle {
      color: #64748b;
      font-size: 14px;
      margin: 4px 0 0 32px;
    }

    .features-container {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      padding-bottom: 20px;
    }

    .feature-item {
      background: #f8fafc;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      border: 1px solid #e5e7eb;
      height: 100%;
      min-height: 180px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }

    .feature-item.highlight {
      background: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
      color: white;
    }

    .feature-icon {
      font-size: 24px;
      margin-bottom: 8px;
    }

    .feature-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .feature-content h4 {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
      color: inherit;
    }

    .feature-content p {
      font-size: 13px;
      margin: 0;
      line-height: 1.4;
      color: inherit;
      opacity: 0.9;
    }

    .feature-tags {
      margin-top: 8px;
    }

    .tag {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    .tag.new {
      background: #dcfce7;
      color: #166534;
    }

    .feature-item.highlight .tag.new {
      background: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .tag.improved {
      background: #e0f2fe;
      color: #075985;
    }

    .feature-item.highlight .tag.improved {
      background: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .close-button {
      position: absolute;
      top: 16px;
      right: 16px;
      background: transparent;
      border: none;
      color: #64748b;
      padding: 4px;
      cursor: pointer;
      z-index: 10;
      transition: all 0.2s ease;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-button:hover {
      background: #f1f5f9;
      color: #1e293b;
      transform: rotate(90deg);
    }

    .user-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .avatar-img {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      margin-bottom: 16px;
    }

    .user-info h2 {
      font-size: 18px;
      margin: 0;
      color: #1e293b;
    }

    .user-role {
      color: #64748b;
      font-size: 14px;
      margin: 4px 0;
    }

    .last-login {
      font-size: 13px;
      color: #64748b;
    }

    .stats-row {
      display: flex;
      gap: 16px;
      margin-top: 24px;
    }

    .stat-item {
      flex: 1;
      text-align: center;
      padding: 16px;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
    }

    .stat-item h3 {
      font-size: 24px;
      margin: 0;
      color: #1e293b;
    }

    .stat-item p {
      font-size: 13px;
      color: #64748b;
      margin: 4px 0 0;
    }

    .features-container::-webkit-scrollbar {
      width: 8px;
    }

    .features-container::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 4px;
    }

    .features-container::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }

    .features-container::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
    
    
.feature-item {
  background: #f8fafc;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  border: 1px solid #e5e7eb;
  height: 100%;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.feature-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.1);
}

.feature-item.highlight {
  background: linear-gradient(135deg, #3B82F6 0%, #06B6D4 100%);
  color: white;
}

.feature-item.highlight::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(
    45deg,
    transparent 0%,
    rgba(255, 255, 255, 0.1) 50%,
    transparent 100%
  );
  transform: rotate(45deg);
  animation: shine 3s infinite;
}

@keyframes shine {
  0% { transform: translateX(-30%) translateY(-30%) rotate(45deg); }
  100% { transform: translateX(30%) translateY(30%) rotate(45deg); }
}

.tag {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  position: relative;
  overflow: hidden;
}

.tag.new {
  background: #dcfce7;
  color: #166534;
  animation: sparkle 1.5s infinite;
}

.tag.improved {
  background: #e0f2fe;
  color: #075985;
  animation: pulse 2s infinite;
}

@keyframes sparkle {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; transform: scale(1.05); }
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.feature-item.highlight .tag.new,
.feature-item.highlight .tag.improved {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.feature-item.highlight:hover {
  background: linear-gradient(135deg, #2563EB 0%, #0891B2 100%);
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
}

.feature-icon {
  font-size: 24px;
  margin-bottom: 8px;
  transition: transform 0.3s ease;
}

.feature-item:hover .feature-icon {
  transform: scale(1.1);
}

.close-button {
  position: absolute;
  top: 16px;
  right: 16px;
  background: transparent;
  border: none;
  color: #64748b;
  padding: 4px;
  cursor: pointer;
  z-index: 10;
  transition: all 0.3s ease;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-button:hover {
  background: #f1f5f9;
  color: #1e293b;
  transform: rotate(90deg);
}

.stats-row {
  display: flex;
  gap: 16px;
  margin-top: 24px;
  animation: fadeInUp 0.5s ease-out;
}

.stat-item {
  flex: 1;
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  transition: all 0.3s ease;
}

.stat-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.welcome-container {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.user-header {
  animation: slideDown 0.5s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tooltip-container {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  position: relative;
  cursor: pointer;
}

.tooltip-container::before {
  content: "Stay updated with our latest features and improvements. We regularly enhance our platform to provide you with better tools and capabilities.";
  position: absolute;
  top: -10px;
  right: -10px;
  transform: translateX(100%);
  background-color: #1e293b;
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  width: 250px;
  white-space: normal;
  z-index: 1000;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
}

.tooltip-container::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -16px;
  transform: translateY(-50%);
  border: 6px solid transparent;
  border-right-color: #1e293b;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
}

.tooltip-container:hover::before,
.tooltip-container:hover::after {
  opacity: 1;
  visibility: visible;
}
  `;
  document.head.appendChild(style);

  const closeButton = document.createElement("button");
  closeButton.className = "close-button";
  closeButton.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 18L18 6M6 6l12 12" />
    </svg>
  `;
  closeButton.onclick = () => Swal.close();
  popup.querySelector(".welcome-container").appendChild(closeButton);
};

const displayName = useMemo(() => {
  const cookieFullName = sanitizeNameValue(
    Cookies.get("fullName") ||
    Cookies.get("full_name") ||
    Cookies.get("fullname") ||
    Cookies.get("FullName")
  );
  const cookieUsername = sanitizeNameValue(
    Cookies.get("username") ||
    Cookies.get("userName") ||
    Cookies.get("user_username")
  );
  const cookieEmail = sanitizeNameValue(
    Cookies.get("email") ||
    Cookies.get("userEmail") ||
    Cookies.get("user_email")
  );

  return (
    sanitizeNameValue(userDetails?.fullName) ||
    sanitizeNameValue(userDetails?.displayName) ||
    sanitizeNameValue(userDetails?.username) ||
    cookieFullName ||
    cookieUsername ||
    cookieEmail ||
    "User"
  );
}, [userDetails]);

const handleWhatsNewClick = () => {
  const userName = displayName;
  const userRole = userDetails?.role || "User";
  const userAvatar = userDetails?.profilePicture || "/default-avatar.png";
  const lastLogin = lastLoginTime
    ? lastLoginTime.toLocaleString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "First time login";

  const whatsNewFeaturesHtml = WHATS_NEW_ITEMS.map(
    (item) => `
              <div class="feature-item ${item.highlight ? "highlight" : ""}">
                <div class="feature-icon">${item.icon}</div>
                <div class="feature-content">
                  <h4>${item.title}</h4>
                  <p>${item.description}</p>
                  <div class="feature-tags">
                    <span class="tag ${item.tagType}">${item.tag}</span>
                  </div>
                </div>
              </div>`
  ).join("");

  Swal.fire({
    html: `
      <div class="welcome-container">
        <div class="welcome-left">
          <div class="user-header">
            <img src="${userAvatar}" class="avatar-img" alt="Profile"/>
            <div class="user-info">
              <h2>Welcome back, ${userName}!</h2>
              <p class="user-role">${userRole}</p>
              
            </div>
          </div>

          ${newJobsCount > 0 ? `
            <div class="stats-row">
              <div class="stat-item">
                <h3>${newJobsCount}</h3>
                <p>New Jobs</p>
              </div>
              <div class="stat-item">
                <h3>${activeJobsCount}</h3>
                <p>Active Jobs</p>
              </div>
            </div>
          ` : `
            <div class="stats-row">
              <div class="stat-item">
                <h3>${activeJobsCount}</h3>
                <p>Active Jobs</p>
              </div>
            </div>
          `}
        </div>

        <div class="welcome-right">
          <div class="welcome-header-fixed">
            <div class="welcome-title">
              <div class="title-row">
                <h2>
                  <span role="img" aria-label="celebration">🎉</span>
                  What's New!
                   <div class="tooltip-container">
                    <i class="fas fa-question-circle"></i>
                  </div>
                </h2>
              </div>
              <p class="subtitle">Discover our latest features and improvements</p>
            </div>
          </div>
          <div class="features-container">
            <div class="features-grid">
              ${whatsNewFeaturesHtml}
            </div>
          </div>
        </div>
      </div>
    `,
    showConfirmButton: false,
    width: "1000px",
    padding: 0,
    customClass: {
      popup: "welcome-popup",
    },
    didRender: (popup) => {
      addWelcomeAlertStyles(popup);
    },
  });
};

return (
  <div className="dashboard-wrapper" style={{ width: "100%", maxWidth: "100%" }}>
    <LoadingOverlay isLoading={isLoading || isOverviewLoading} />
    {/* Full-viewport-width blue strip; inner px matches layouts/dashboard/DashboardIndexTop PAGE_GUTTER */}
    <div
      className="dashboard-header"
      style={{
        width: "100vw",
        maxWidth: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginRight: "calc(50% - 50vw)",
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
          borderRadius: "0 0 24px 24px",
          marginTop: "-25px",
          marginBottom: "20px",
          marginLeft: "20px",
          marginRight: "20px",
          paddingTop: "1.5rem",
          paddingBottom: "1.5rem",
        }}
      >
        <div className="px-3 px-sm-4">
          <div className="d-flex flex-column gap-4">
          {/* Header Content */}
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-3">
            <div>
              <h1 className="h3 text-white fw-bold mb-1">
                Field Services Dashboard
              </h1>
              <p className="mb-0 text-white">
                Welcome back,{" "}
                <span className="fw-medium">
                  {displayName}
                </span>{" "}
                👋
              </p>
            </div>

            {/* Action Buttons */}
            <div className="d-flex gap-3 align-items-center">
              <Button
                onClick={handleWhatsNewClick}
                className="whats-new-button"
                variant="outline-light"
              >
                <FaBell size={16} />
                <span>What&apos;s New</span>
              </Button>

              <Button
                onClick={handleNewTask}
                className="create-job-button"
                variant="light"
              >
                <FaPlus size={16} />
                <span>Create Job</span>
              </Button>
            </div>
          </div>

          {/* Filter Buttons */}
          <div className="d-flex justify-content-between align-items-center">
            <FilterButtons
              currentFilter={timeFilter}
              onFilterChange={handleTimeFilterChange}
            />
          </div>
        </div>
        </div>
      </div>
    </div>

    {/* Dashboard Content */}
    <div style={{ width: "100%", maxWidth: "100%" }}>
   
            {/* Stats Row - Jobs */}
            <Row className="g-4 mb-4">
          {/* Total Jobs Card */}
          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Total Jobs ({timeFilter})</p>
                    <h3 className="mb-1">{totalTasks}</h3>
                    <span className={`text-${taskGrowth >= 0 ? 'success' : 'danger'}`}>
                      <i className={`fas fa-arrow-${taskGrowth >= 0 ? 'up' : 'down'} me-1`}></i>
                      {Math.abs(taskGrowth)}% {taskGrowth >= 0 ? 'increase' : 'decrease'}
                    </span>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-tasks text-primary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Pending Jobs Card */}
          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Pending Jobs ({timeFilter})</p>
                    <h3 className="mb-1">{pendingTasks}</h3>
                    <Badge bg={pendingTasks > 5 ? "danger" : "warning"}>
                      {pendingTasks > 5 ? 'Urgent' : 'Urgent'}
                    </Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-clock text-warning"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Completed Jobs Card */}
          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Completed ({timeFilter})</p>
                    <h3 className="mb-1">{completedToday}</h3>
                    <Badge 
                      bg={
                        completedToday >= totalTasks * 0.7 ? "success" :
                        completedToday >= totalTasks * 0.4 ? "info" : 
                        "warning"
                      }
                    >
                      {completedToday >= totalTasks * 0.7 ? 'Excellent' :
                       completedToday >= totalTasks * 0.4 ? 'On Track' :
                       'Needs Attention'}
                    </Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-check-circle text-info"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Stats Row - Follow Ups (Total Counts) */}
        <Row className="g-4 mb-4">
          {/* Total Follow Ups Card */}
          <Col lg={3} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Total FUP</p>
                    <h3 className="mb-1">{totalFollowUps}</h3>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-list-alt text-primary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Logged Follow Ups Card */}
          <Col lg={3} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Logged FUP</p>
                    <h3 className="mb-1">{loggedFollowUps}</h3>
                    <Badge bg="secondary">Logged</Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-file-alt text-secondary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* In Progress Follow Ups Card */}
          <Col lg={3} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">In Progress FUP</p>
                    <h3 className="mb-1">{inProgressFollowUps}</h3>
                    <Badge bg="primary">Active</Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-spinner text-primary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Closed Follow Ups Card */}
          <Col lg={3} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Closed FUP</p>
                    <h3 className="mb-1">{closedFollowUps}</h3>
                    <Badge bg="success">Closed</Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-check-circle text-success"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Cancelled Follow Ups Card - Separate row or can be added to above if needed */}
        {/* <Col lg={3} sm={6}>
          <Card>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <p className="text-muted mb-1">Cancelled FUP</p>
                  <h3 className="mb-1">{cancelledFollowUps}</h3>
                  <Badge bg="danger">Cancelled</Badge>
                </div>
                <div className="stat-icon">
                  <i className="fas fa-times-circle text-danger"></i>
                </div>
              </div>
            </Card.Body>
          </Card>
        </Col> */}

        {/* Stats Row - Customers - COMMENTED OUT FOR NOW */}
        {/* 
        <Row className="g-4 mb-4">
          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Total Cust</p>
                    <h3 className="mb-1">{totalCustomers}</h3>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-users text-primary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Active Cust</p>
                    <h3 className="mb-1">{activeCustomers}</h3>
                    <Badge bg="success">Active</Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-user-check text-success"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4} sm={6}>
            <Card>
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">Inactive Cust</p>
                    <h3 className="mb-1">{inactiveCustomers}</h3>
                    <Badge bg="secondary">Inactive</Badge>
                  </div>
                  <div className="stat-icon">
                    <i className="fas fa-user-times text-secondary"></i>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
        */}

      {/* Performance chart — full width */}
      <Row className="g-4 mb-4">
        <Col lg={12}>
          <Card>
            <Card.Body>
              <h5 className="mb-4">Performance Overview</h5>
              <ApexCharts
                options={performanceChartOptions}
                series={performanceChartSeries}
                type="bar"
                height={350}
              />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Field Service Distribution (left) | What&apos;s New + quick analytics (right) */}
      {/* align-items-start: avoid stretching the left card to the full height of the right stack (removes huge empty space below the donut). */}
      <Row className="g-4 align-items-start">
        <Col lg={5} md={12}>
          <Card className="shadow-sm" style={{ borderRadius: 12, border: "1px solid #e2e8f0" }}>
            <Card.Body className="pt-3 px-3 pb-3">
              <h5 className="mb-3" style={{ fontWeight: 700, color: "#1e293b" }}>
                Field Service Distribution
              </h5>
              <ApexCharts
                key={`fs-donut-${(taskDistributionChartOptions.labels || []).join('|')}-${(taskDistributionChartSeries || []).join(',')}`}
                options={taskDistributionChartOptions}
                series={Array.isArray(taskDistributionChartSeries) && taskDistributionChartSeries.length > 0 ? taskDistributionChartSeries : [1]}
                type="donut"
                height={300}
              />

              <div
                className="mt-3 pt-3 border-top"
                style={{ borderColor: "#e2e8f0" }}
              >
                <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2">
                  <h6
                    className="mb-0 text-uppercase fw-semibold text-muted"
                    style={{ fontSize: 11, letterSpacing: "0.06em" }}
                  >
                    Period workflow snapshot
                  </h6>
                  <Badge bg="light" text="dark" className="fw-normal border" style={{ fontSize: 10 }}>
                    By job created date · {timeFilter}
                  </Badge>
                </div>
                <p className="small text-muted mb-3" style={{ fontSize: 12 }}>
                  Same jobs as the chart above—useful for dispatch: staffing, risk, and completion in this window.
                </p>
                {fieldServiceInsights.periodTotal === 0 ? (
                  <p className="small text-muted mb-0 fst-italic">
                    No jobs with a created date in this period. Try &quot;This Week&quot; or &quot;This Month&quot;.
                  </p>
                ) : (
                  <Row className="g-2">
                    <Col xs={12}>
                      <div
                        className="rounded-3 px-3 py-2 d-flex flex-wrap align-items-center justify-content-between gap-2"
                        style={{ background: "#f1f5f9", border: "1px solid #e2e8f0" }}
                      >
                        <div className="d-flex align-items-center gap-2 min-w-0">
                          <i className="fas fa-flag-checkered text-primary" aria-hidden />
                          <div className="min-w-0">
                            <div className="text-muted small">Dominant status</div>
                            <div
                              className="fw-semibold small text-truncate"
                              title={fieldServiceInsights.topStatusLabel || ""}
                            >
                              {fieldServiceInsights.topStatusLabel || "—"}
                            </div>
                          </div>
                        </div>
                        <div className="text-end small">
                          <span className="fw-bold text-dark">
                            {fieldServiceInsights.topStatusCount}
                          </span>
                          <span className="text-muted">
                            {" "}
                            ({fieldServiceInsights.topStatusPct ?? "0"}%)
                          </span>
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-check-circle text-success me-1" aria-hidden />
                          Completion
                        </div>
                        <div className="fw-bold" style={{ fontSize: "1.1rem", color: "#15803d" }}>
                          {fieldServiceInsights.completionRatePct}%
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {fieldServiceInsights.completedCount} of {fieldServiceInsights.periodTotal} jobs
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-user-slash text-warning me-1" aria-hidden />
                          Unassigned
                        </div>
                        <div className="fw-bold text-warning" style={{ fontSize: "1.1rem" }}>
                          {fieldServiceInsights.unassignedCount}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          No technician on job
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-hard-hat text-primary me-1" aria-hidden />
                          In progress
                        </div>
                        <div className="fw-bold text-primary" style={{ fontSize: "1.1rem" }}>
                          {fieldServiceInsights.inProgressInPeriod}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          Active in period
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-exclamation-triangle text-danger me-1" aria-hidden />
                          High priority
                        </div>
                        <div className="fw-bold text-danger" style={{ fontSize: "1.1rem" }}>
                          {fieldServiceInsights.highPriorityCount}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          Urgent / high flags
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-clock text-secondary me-1" aria-hidden />
                          Past scheduled end
                        </div>
                        <div className="fw-bold text-secondary" style={{ fontSize: "1.1rem" }}>
                          {fieldServiceInsights.overdueScheduledCount}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          Not done / not cancelled
                        </div>
                      </div>
                    </Col>
                    <Col xs={6} sm={4}>
                      <div className="rounded-3 p-2 h-100" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <div className="text-muted small mb-1">
                          <i className="fas fa-building text-info me-1" aria-hidden />
                          Customers
                        </div>
                        <div className="fw-bold text-info" style={{ fontSize: "1.1rem" }}>
                          {fieldServiceInsights.uniqueCustomers}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          Distinct accounts
                        </div>
                      </div>
                    </Col>
                  </Row>
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={7} md={12}>
          <div className="d-flex flex-column gap-4">
            <Card style={{ borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <Card.Header className="bg-white py-3 px-4 d-flex flex-wrap justify-content-between align-items-center gap-2" style={{ borderBottom: "1px solid #e2e8f0", borderRadius: "12px 12px 0 0" }}>
                <div>
                  <h5 className="mb-0" style={{ fontWeight: 700, color: "#1e293b" }}>
                    What&apos;s New
                  </h5>
                  <small className="text-muted">Latest updates and improvements</small>
                </div>
                <Button variant="outline-primary" size="sm" className="d-flex align-items-center gap-2" style={{ borderRadius: 8 }} onClick={handleWhatsNewClick}>
                  <FaBell size={14} />
                  Full view
                </Button>
              </Card.Header>
              <Card.Body className="p-0">
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {WHATS_NEW_ITEMS.map((item, i) => (
                    <div
                      key={item.title}
                      className="px-4 py-3"
                      style={{
                        borderBottom: i < WHATS_NEW_ITEMS.length - 1 ? "1px solid #f1f5f9" : "none",
                        background: item.highlight ? "linear-gradient(90deg, #eff6ff 0%, #fff 12%)" : undefined,
                      }}
                    >
                      <div className="d-flex gap-3 align-items-start">
                        <span style={{ fontSize: "1.25rem", lineHeight: 1 }} aria-hidden>
                          {item.icon}
                        </span>
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                            <span style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>{item.title}</span>
                            <Badge bg={item.tagType === "new" ? "primary" : "secondary"} className="fw-normal" style={{ fontSize: 10 }}>
                              {item.tag}
                            </Badge>
                          </div>
                          <p className="mb-0 text-muted" style={{ fontSize: 13 }}>
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>

            <Card style={{ borderRadius: 12, border: "1px solid #e2e8f0" }}>
              <Card.Header className="bg-white py-3 px-4" style={{ borderBottom: "1px solid #e2e8f0", borderRadius: "12px 12px 0 0" }}>
                <h5 className="mb-0" style={{ fontWeight: 700, color: "#1e293b" }}>
                  Quick insights
                </h5>
                <small className="text-muted">At-a-glance totals and shortcuts</small>
              </Card.Header>
              <Card.Body className="px-4 py-3">
                <Row className="g-3 mb-3">
                  <Col xs={6} sm={4}>
                    <p className="text-muted mb-1 small text-uppercase fw-semibold" style={{ fontSize: 10, letterSpacing: "0.04em" }}>
                      Active jobs
                    </p>
                    <p className="mb-0 fs-5 fw-bold text-primary">{activeJobsCount}</p>
                  </Col>
                  <Col xs={6} sm={4}>
                    <p className="text-muted mb-1 small text-uppercase fw-semibold" style={{ fontSize: 10, letterSpacing: "0.04em" }}>
                      Open follow-ups
                    </p>
                    <p className="mb-0 fs-5 fw-bold" style={{ color: "#8b5cf6" }}>
                      {totalFollowUps}
                    </p>
                  </Col>
                  <Col xs={6} sm={4}>
                    <p className="text-muted mb-1 small text-uppercase fw-semibold" style={{ fontSize: 10, letterSpacing: "0.04em" }}>
                      Active workers
                    </p>
                    <p className="mb-0 fs-5 fw-bold text-success">{activeWorkers}</p>
                  </Col>
                </Row>
                <div className="d-flex flex-column gap-2">
                  <Link href="/dashboard/reports" className="btn btn-outline-primary btn-sm text-start d-flex align-items-center justify-content-between" style={{ borderRadius: 8 }}>
                    <span>Reports hub</span>
                    <i className="fas fa-chart-bar" />
                  </Link>
                  <Link href="/dashboard/reports/hours-by-employee" className="btn btn-outline-secondary btn-sm text-start d-flex align-items-center justify-content-between" style={{ borderRadius: 8 }}>
                    <span>Hours by employee</span>
                    <i className="fas fa-clock" />
                  </Link>
                  <Link href="/dashboard/reports/job-status" className="btn btn-outline-secondary btn-sm text-start d-flex align-items-center justify-content-between" style={{ borderRadius: 8 }}>
                    <span>Job status report</span>
                    <i className="fas fa-clipboard-list" />
                  </Link>
                </div>
              </Card.Body>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  </div>
);
};

export default Overview;