import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { format, addDays, subDays, addMonths, subMonths, addWeeks, subWeeks, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, startOfDay, parseISO, isValid } from "date-fns";
import { useRouter } from "next/router";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import Select from "react-select";
import PortalModal, {
  PortalConfirmPanel,
  PortalConfirmRow,
} from "../../../../components/portal/PortalModal";
// import { toast, ToastContainer } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";
import {
  updateTechnicianSchedule,
  updateTechnicianColor,
  reassignTechnician,
  updateJobStatusFromScheduler,
  rescheduleJobAppointment,
  hydrateSchedulerEvent,
} from "../../../../lib/scheduler/technicianSchedulerService";
import { useSchedulerData } from "../../../../lib/scheduler/useSchedulerData";
import { useSchedulerFreshness } from "../../../../lib/scheduler/useSchedulerFreshness";
import {
  invalidateAllWindowCaches,
  invalidateSchedulerCache,
  invalidateSchedulerServerCache,
  techniciansCacheKey,
  getSiteContactFromCache,
  setSiteContactCache,
  seedSiteContactCacheFromEvents,
} from "../../../../lib/scheduler/schedulerCache";
import {
  computeSchedulerFetchRange,
  schedulerFetchRangeKey,
} from "../../../../lib/scheduler/schedulerFetchRange";
import {
  buildEventsByTechAndDay,
  getEventsForTechAndDay,
} from "../../../../lib/scheduler/buildEventsByTechAndDay";
import { getJobPlotRangeForDay } from "../../../../lib/scheduler/schedulerDayPlot";
import {
  TECHNICIAN_COLORS,
  getTechnicianStatusLabel,
} from "../../../../lib/scheduler/technicianSchedulerUtils";
import {
  AVAILABILITY_ISSUE_TYPES,
  companyEventsCoverDate,
  getTechnicianAvailabilityIssues,
  technicianOnLeaveDate,
} from "../../../../lib/calendar/availability";
import { toSingaporeYmd, buildSingaporeDateTimeFromForm } from "../../../../lib/utils/singaporeDateTime";
import { formatDurationLabel } from "../../../../lib/jobs/scheduleDuration";
import { getWorkerViewPath } from "../../../../utils/workerRoutes";
import {
  fetchJobStatuses,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
  readCachedJobStatuses,
  writeCachedJobStatuses,
  isJobStatusesCacheFresh,
} from "../../../../utils/jobStatusSettings";
import styles from './scheduler.module.css';
import JobServiceCallSalesOrder from "../../../../components/jobs/JobServiceCallSalesOrder";
import CustomerListLoadingIndicator from "../../../../components/loading/CustomerListLoadingIndicator";
import {
  TelephoneFill as TelephoneIcon,
  Phone as PhoneIcon,
  Envelope as EnvelopeIcon,
  Clock as ClockIcon,
  ArrowRepeat as ArrowRepeatIcon,
  PersonFill as PersonFillIcon,
} from "react-bootstrap-icons";
import { phoneLinkRow } from "../../../../lib/utils/toTelHref";
import SchedulerJobStatusEditModal from "./_components/SchedulerJobStatusEditModal";
import SchedulerJobScheduleEditModal from "./_components/SchedulerJobScheduleEditModal";

/** Shorter lines under the title while data loads */
const SCHEDULER_LOADING_STATUS_LINES = [
  "Fetching technicians and scheduled jobs…",
  "Building your calendar and assignments…",
  "Almost ready—thanks for your patience.",
];

/** Longer field-service tips for the footer while loading */
const SCHEDULER_LOADING_TIPS = [
  "Week view shows each technician in a row with Mon–Sun columns—scroll sideways if you have many days of work.",
  "Use the worker search in the toolbar to filter the list when you have a large team.",
  "Click a job card to open details, reassign a technician, or update status.",
  "Within each day column, jobs are ordered by start time, then by end time when two jobs share the same start.",
  "Switch between Day, Week, and Month to match how you plan the day versus the whole week.",
  "Technician colors help you spot the same person across rows—click the avatar to adjust color.",
  "Customer and site lines on a card reflect the job record—keep addresses current in your source system.",
  "Heavy weeks or many technicians can take longer to load; the schedule will appear when ready.",
];

/** Day view: tall enough for card text; extra lanes multiply this (see assignLanes) */
const DAILY_LANE_HEIGHT_PX = 124;
const DAILY_ROW_MIN_HEIGHT_PX = 104;
const DAILY_SLOT_MS = 30 * 60 * 1000;
/** One 7:00 → next-day 7:00 strip: 48 × 30 min */
const DAILY_VIEW_WINDOW_MS = 48 * DAILY_SLOT_MS;
/** Epsilon for (ms→slot) float math: avoids losing the last 30m or shifting start 1 block */
const DAILY_SLOT_INDEX_EPS = 1e-6;
/** Must match `.dailyTimeCell` / `.dailyTimeCellStrip`: 100px × 48 = 4800px timeline (use px, not %, for bar alignment). */
const DAILY_SLOT_WIDTH_PX = 100;

const REASSIGN_TECHNICIAN_SELECT_STYLES = {
  control: (base, state) => ({
    ...base,
    borderColor: state.isFocused ? "#93c5fd" : "#e2e8f0",
    borderRadius: 8,
    minHeight: 40,
    boxShadow: state.isFocused ? "0 0 0 3px rgba(59, 130, 246, 0.15)" : "none",
    fontSize: "0.875rem",
    backgroundColor: state.isDisabled ? "#f8fafc" : "#fff",
  }),
  menuPortal: (base) => ({ ...base, zIndex: 10050 }),
  option: (base, state) => ({
    ...base,
    fontSize: "0.875rem",
    backgroundColor: state.isSelected ? "#3b82f6" : state.isFocused ? "#eff6ff" : "#fff",
    color: state.isSelected ? "#fff" : "#1e293b",
  }),
  placeholder: (base) => ({ ...base, color: "#94a3b8" }),
  singleValue: (base) => ({ ...base, color: "#1e293b" }),
};

const CALENDAR_AVAILABILITY_ISSUES = new Set([
  AVAILABILITY_ISSUE_TYPES.COMPANY_HOLIDAY,
  AVAILABILITY_ISSUE_TYPES.COMPANY_DAY_OFF,
  AVAILABILITY_ISSUE_TYPES.ON_LEAVE,
]);

function getTechnicianProfileId(technician) {
  return technician?.workerId || technician?.raw?.user_id || null;
}

function SchedulerAvailabilityHelpLinks({
  availability,
  technician,
  dateLike,
  linkClassName = "",
}) {
  if (!availability?.labels?.length) return null;

  const profileId = getTechnicianProfileId(technician);
  const issues = availability.issues || [];
  const ymd = availability.ymd || (dateLike ? toSingaporeYmd(dateLike) : "");
  const links = [];

  if (issues.includes(AVAILABILITY_ISSUE_TYPES.OUTSIDE_SCHEDULE) && profileId) {
    links.push({
      key: "schedule",
      href: getWorkerViewPath(profileId, { tab: "schedule" }),
      label: "Configure schedule",
    });
  }

  if (issues.some((issue) => CALENDAR_AVAILABILITY_ISSUES.has(issue)) && ymd) {
    links.push({
      key: "calendar",
      href: `/company-calendar?date=${encodeURIComponent(ymd)}`,
      label: "View calendar",
    });
  }

  if (!links.length && profileId) {
    links.push({
      key: "schedule-fallback",
      href: getWorkerViewPath(profileId, { tab: "schedule" }),
      label: "Configure schedule",
    });
  }

  return (
    <>
      You can still proceed if needed.{" "}
      {links.map((link, index) => (
        <React.Fragment key={link.key}>
          {index > 0 ? " · " : null}
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName || undefined}
          >
            {link.label}
          </a>
        </React.Fragment>
      ))}
    </>
  );
}

const isTechnicianActive = (technician) => {
  const status = String(technician?.status || technician?.raw?.status || "").toUpperCase();
  if (status) return status === "ACTIVE";
  if (typeof technician?.isActive === "boolean") return technician.isActive;
  return true;
};

/** Customer appointment window end (`evt.end` / scheduled_end) — not work duration. */
function getAppointmentEndMs(evt) {
  const startMs = new Date(evt.start).getTime();
  const endMs = new Date(evt.end).getTime();
  if (Number.isFinite(endMs) && Number.isFinite(startMs) && endMs > startMs) {
    return endMs;
  }
  return Number.isFinite(startMs) ? startMs : endMs;
}

function getAppointmentEndDate(evt) {
  return new Date(getAppointmentEndMs(evt));
}

/** Timeline card width: work duration (start + dur), not full appointment slot. */
function getWorkDurationEndMs(evt) {
  if (evt?.workEnd) {
    const w = new Date(evt.workEnd).getTime();
    const startMs = new Date(evt.start).getTime();
    if (Number.isFinite(w) && Number.isFinite(startMs) && w > startMs) return w;
  }
  const startMs = new Date(evt.start).getTime();
  const dur =
    evt.durationHours != null && evt.durationHours !== ""
      ? parseFloat(evt.durationHours)
      : NaN;
  if (Number.isFinite(startMs) && Number.isFinite(dur) && !isNaN(dur) && dur > 0) {
    return startMs + dur * 60 * 60 * 1000;
  }
  return getAppointmentEndMs(evt);
}

/**
 * Job Details modal: appointment slot only (e.g. 9am–12pm). Work duration shown separately.
 */
function formatModalOriginalAppointmentTime(evt) {
  const start = new Date(evt.start);
  if (!isValid(start)) {
    return "N/A";
  }
  const end = getAppointmentEndDate(evt);
  if (!isValid(end)) {
    return format(start, "MMM dd, yyyy h:mm a");
  }
  if (isSameDay(start, end)) {
    return `${format(start, "MMM dd, yyyy h:mm a")} – ${format(end, "h:mm a")}`;
  }
  return `${format(start, "MMM dd, yyyy h:mm a")} – ${format(end, "MMM dd, yyyy h:mm a")}`;
}

function getAssignedTechnicianNames(job, resources, allEvents) {
  const names = [];

  const pushName = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed) names.push(trimmed);
  };

  if (Array.isArray(job?.assignedWorkers)) {
    job.assignedWorkers.forEach((w) => pushName(w?.fullName || w?.name || w?.text));
  }

  if (!names.length && Array.isArray(job?.technicians)) {
    job.technicians.forEach((t) =>
      pushName(t?.full_name || t?.fullName || t?.name || t?.text),
    );
  }

  if (!names.length && job?.jobId != null && Array.isArray(allEvents) && Array.isArray(resources)) {
    const jobIdStr = String(job.jobId);
    const resourceIds = new Set(
      allEvents
        .filter((evt) => evt?.jobId != null && String(evt.jobId) === jobIdStr)
        .map((evt) => evt?.resourceId ?? evt?.technicianId ?? evt?.technician_id)
        .filter((id) => id != null)
        .map((id) => String(id)),
    );

    resourceIds.forEach((resourceId) => {
      const tech = resources.find((r) => String(r?.resourceId ?? r?.id) === resourceId);
      pushName(tech?.text || tech?.name || tech?.full_name || tech?.fullName);
    });
  }

  if (!names.length) {
    const resourceId = job?.resourceId ?? job?.technicianId ?? job?.technician_id;
    if (resourceId != null && Array.isArray(resources)) {
      const tech = resources.find(
        (r) => String(r?.resourceId ?? r?.id) === String(resourceId),
      );
      pushName(tech?.text || tech?.name || tech?.full_name || tech?.fullName);
    }
  }

  return [...new Set(names)];
}

function getReplacingTechnicianName(job, resources) {
  const resourceId = job?.resourceId ?? job?.technicianId ?? job?.technician_id;
  if (resourceId == null || !Array.isArray(resources)) return "";
  const tech = resources.find((r) => String(r?.resourceId ?? r?.id) === String(resourceId));
  return tech?.text || tech?.name || tech?.full_name || tech?.fullName || "";
}

function getContactInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function JobDetailContactRow({ icon: Icon, label, value, telHref, waHref, mailto, styles: s }) {
  const hasValue = Boolean(value);
  return (
    <div className={`${s.jobDetailContactRow} ${!hasValue ? s.jobDetailContactRowMuted : ""}`}>
      <div className={s.jobDetailContactRowIcon}>
        <Icon aria-hidden />
      </div>
      <div className={s.jobDetailContactRowBody}>
        <div className={s.jobDetailContactRowLabel}>{label}</div>
        {hasValue ? (
          <div className={s.jobDetailContactRowValue}>
            {mailto ? (
              <a href={mailto} className={s.jobDetailLink}>
                {value}
              </a>
            ) : telHref ? (
              <a href={telHref} className={s.jobDetailLink}>
                {value}
              </a>
            ) : (
              value
            )}
          </div>
        ) : (
          <div className={s.jobDetailContactRowEmpty}>Not specified</div>
        )}
      </div>
      {hasValue && (telHref || waHref) ? (
        <div className={s.jobDetailContactRowActions}>
          {telHref ? (
            <a href={telHref} className={s.jobDetailActionBtn}>
              Call
            </a>
          ) : null}
          {waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${s.jobDetailActionBtn} ${s.jobDetailActionBtnWhatsApp}`}
            >
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JobDetailDescription({ raw, sanitizeHtml, styles: s }) {
  const text = sanitizeHtml(raw);
  if (!text) return null;

  if (/<(?:p|br|ul|ol|li|div|table)\b/i.test(text)) {
    return (
      <div
        className={s.jobDetailDescription}
        dangerouslySetInnerHTML={{ __html: text }}
      />
    );
  }

  const tokenRegex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRegex.exec(text)) !== null) {
    lastIndex = match.index + match[0].length;
  }
  const bodyText = text.slice(lastIndex).trim().replace(/\s+/g, " ");
  const plainText = bodyText || text.replace(tokenRegex, "").replace(/\s+/g, " ").trim();
  if (!plainText) return null;

  const formatted = plainText.replace(/\s+(?=FTKS[A-Z0-9]+\s)/gi, "\n");

  return (
    <div className={s.jobDetailDescription}>
      <p className={s.jobDetailDescBody}>{formatted}</p>
    </div>
  );
}

const mapEmbedUrlCache = new Map();
const mapIframePool = new Map();

const HIDDEN_MAP_POOL_ID = "fsm-scheduler-map-iframe-pool";

function getCachedMapEmbedUrl(location) {
  const key = String(location || "").trim();
  if (!key) return "";
  if (mapEmbedUrlCache.has(key)) return mapEmbedUrlCache.get(key);
  const url = `https://maps.google.com/maps?q=${encodeURIComponent(key)}&z=16&output=embed`;
  mapEmbedUrlCache.set(key, url);
  return url;
}

function getHiddenMapPoolHost() {
  if (typeof document === "undefined") return null;
  let host = document.getElementById(HIDDEN_MAP_POOL_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HIDDEN_MAP_POOL_ID;
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;";
    document.body.appendChild(host);
  }
  return host;
}

function parkMapIframe(locationKey, container) {
  if (!locationKey || !container) return;
  const iframe = mapIframePool.get(locationKey);
  if (!iframe || iframe.parentElement !== container) return;
  const host = getHiddenMapPoolHost();
  if (host) host.appendChild(iframe);
}

function acquireMapIframe(locationKey, embedUrl, frameClassName, title, onLoad) {
  let iframe = mapIframePool.get(locationKey);
  if (iframe) {
    if (onLoad) {
      if (iframe.dataset.loaded === "true") onLoad();
      else iframe.addEventListener("load", onLoad, { once: true });
    }
    return iframe;
  }

  iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.src = embedUrl;
  iframe.className = frameClassName;
  iframe.loading = "lazy";
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.allowFullscreen = true;
  iframe.addEventListener(
    "load",
    () => {
      iframe.dataset.loaded = "true";
      onLoad?.();
    },
    { once: true }
  );
  mapIframePool.set(locationKey, iframe);
  return iframe;
}

function JobDetailLocationPanel({ location, locationParts, styles: s, mapActive = false }) {
  const mapWrapRef = useRef(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const locationKey = String(location || "").trim();

  useEffect(() => {
    const pooled = locationKey ? mapIframePool.get(locationKey) : null;
    setIframeLoaded(Boolean(pooled?.dataset?.loaded === "true"));
  }, [locationKey]);

  useEffect(() => {
    if (!mapActive || !locationKey) return undefined;

    const wrap = mapWrapRef.current;
    if (!wrap) return undefined;

    const embedUrl = getCachedMapEmbedUrl(locationKey);
    const iframe = acquireMapIframe(
      locationKey,
      embedUrl,
      s.jobDetailMapFrame,
      `Map for ${locationKey}`,
      () => setIframeLoaded(true)
    );

    if (iframe.dataset.loaded === "true") {
      setIframeLoaded(true);
    } else {
      setIframeLoaded(false);
    }

    wrap.appendChild(iframe);

    return () => {
      parkMapIframe(locationKey, wrap);
    };
  }, [mapActive, locationKey, s.jobDetailMapFrame]);

  useEffect(() => {
    if (mapActive || !locationKey) return undefined;
    const wrap = mapWrapRef.current;
    if (wrap) parkMapIframe(locationKey, wrap);
    return undefined;
  }, [mapActive, locationKey]);

  if (!location || location === "No Location") {
    return (
      <section className={s.jobDetailBlock}>
        <h3 className={s.jobDetailBlockTitle}>Location</h3>
        <div className={s.jobDetailLocationPanel}>
          <p className={s.jobDetailLocationEmpty}>No location on file</p>
        </div>
      </section>
    );
  }

  const mapsSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  const showMapSkeleton = mapActive && !iframeLoaded;

  return (
    <section className={s.jobDetailBlock}>
      <h3 className={s.jobDetailBlockTitle}>Location</h3>
      <div className={s.jobDetailLocationPanel}>
        <div className={s.jobDetailLocationText}>
          {locationParts[0] ? (
            <div className={s.jobDetailLocHeadline}>{locationParts[0]}</div>
          ) : null}
          {locationParts.length > 1 ? (
            <div className={s.jobDetailLocFull}>{location}</div>
          ) : (
            <div className={s.jobDetailLocFull}>{location}</div>
          )}
        </div>
        <div
          ref={mapWrapRef}
          className={s.jobDetailMapWrap}
          aria-busy={mapActive && !iframeLoaded}
        >
          {showMapSkeleton ? (
            <div className={s.jobDetailMapSkeleton} aria-hidden />
          ) : null}
        </div>
        <a
          href={mapsSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={s.jobDetailMapsLink}
        >
          Open in Google Maps
        </a>
      </div>
    </section>
  );
}

function compareJobsByScheduleTime(a, b) {
  const startA = new Date(a.start).getTime();
  const startB = new Date(b.start).getTime();
  if (startA !== startB) return startA - startB;
  const endA = getAppointmentEndMs(a);
  const endB = getAppointmentEndMs(b);
  if (endA !== endB) return endA - endB;
  const idA = String(a.event_id ?? a.id ?? "");
  const idB = String(b.event_id ?? b.id ?? "");
  return idA.localeCompare(idB);
}

function formatSchedulerDateInputValue(date, viewMode) {
  return viewMode === "month" ? format(date, "yyyy-MM") : format(date, "yyyy-MM-dd");
}

function formatSchedulerDateDisplay(date, viewMode) {
  if (viewMode === "month") {
    return format(date, "MM/yyyy");
  }
  return `${format(date, "dd/MM/yyyy")} (${format(date, "EEE")})`;
}

function parseSchedulerDateInputValue(value, viewMode) {
  if (!value) return null;
  const raw = value + (viewMode === "month" ? "-01" : "");
  const parsed = parseISO(raw);
  return isValid(parsed) ? startOfDay(parsed) : null;
}

function getEventsForDayFromIndex(eventsByTechAndDay, ymd, allowedTechIds) {
  const dayJobs = [];
  if (allowedTechIds) {
    for (const techId of allowedTechIds) {
      const dayMap = eventsByTechAndDay.get(techId);
      const jobs = dayMap?.get(ymd);
      if (jobs?.length) dayJobs.push(...jobs);
    }
    return dayJobs;
  }
  for (const dayMap of eventsByTechAndDay.values()) {
    const jobs = dayMap.get(ymd);
    if (jobs?.length) dayJobs.push(...jobs);
  }
  return dayJobs;
}

const Scheduler = () => {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [dateInputValue, setDateInputValue] = useState(() =>
    formatSchedulerDateInputValue(new Date(), "day")
  );
  const [selectedJob, setSelectedJob] = useState(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('day');
  const includeUndated = viewMode === 'day';
  const schedulerRangeKey = useMemo(() => {
    const range = computeSchedulerFetchRange(viewMode, selectedDate);
    return `${schedulerFetchRangeKey(range)}|undated:${includeUndated}`;
  }, [viewMode, selectedDate, includeUndated]);
  const {
    resources,
    setResources,
    events,
    setEvents,
    calendarEvents,
    undatedByTech,
    loading,
    isInitialLoad,
    isRefreshing,
    hasLoadedOnceRef,
    refreshData,
    patchEvent,
  } = useSchedulerData({ viewMode, selectedDate, includeUndated });
  useSchedulerFreshness({
    viewMode,
    selectedDate,
    refreshData,
    enabled: !isInitialLoad,
    includeUndated,
  });

  useEffect(() => {
    seedSiteContactCacheFromEvents(schedulerRangeKey, events);
  }, [schedulerRangeKey, events]);

  const handleRefreshSchedule = useCallback(async () => {
    invalidateSchedulerServerCache();
    invalidateAllWindowCaches();
    invalidateSchedulerCache(techniciansCacheKey());
    await refreshData(undefined, { force: true });
  }, [refreshData]);

  const [customerFilter, setCustomerFilter] = useState('');
  const [showAssignConfirm, setShowAssignConfirm] = useState(false);
  const [assignmentData, setAssignmentData] = useState(null);
  const [createAsRecurring, setCreateAsRecurring] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [showStatusEditModal, setShowStatusEditModal] = useState(false);
  const [showScheduleEditModal, setShowScheduleEditModal] = useState(false);
  const [selectedNewTechnician, setSelectedNewTechnician] = useState(null);
  const [isReassigning, setIsReassigning] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedTechnicianForColor, setSelectedTechnicianForColor] = useState(null);
  const [selectedColor, setSelectedColor] = useState('#667eea');
  const [isUpdatingColor, setIsUpdatingColor] = useState(false);
  const dailyHeaderScrollRef = useRef(null);
  const dailyGridScrollRef = useRef(null);
  const schedulerPageRootRef = useRef(null);
  const toolbarRef = useRef(null);
  const hiddenDateInputRef = useRef(null);
  const jobModalClosingRef = useRef(false);
  const jobSiteContactAbortRef = useRef(null);
  const [jobStatuses, setJobStatuses] = useState(
    () => readCachedJobStatuses() || getDefaultJobStatuses()
  );
  const jobStatusesReadyRef = useRef(Boolean(readCachedJobStatuses()?.length));

  const reassignAvailability = React.useMemo(() => {
    if (!selectedNewTechnician || !selectedJob?.start) return null;
    return getTechnicianAvailabilityIssues({
      dateLike: selectedJob.start,
      employeeSchedule: selectedNewTechnician.employeeSchedule,
      calendarEvents,
      technicianId: selectedNewTechnician.id,
      technicianName: selectedNewTechnician.text || selectedNewTechnician.name || "Technician",
    });
  }, [selectedNewTechnician, selectedJob, calendarEvents]);

  const reassignTechnicianOptions = useMemo(() => {
    if (!selectedJob) return [];
    return resources
      .filter(
        (tech) =>
          isTechnicianActive(tech) &&
          tech.id !== selectedJob.resourceId &&
          tech.id !== selectedJob.technicianId
      )
      .sort((a, b) =>
        (a.text || a.name || "").localeCompare(b.text || b.name || "", undefined, {
          sensitivity: "base",
        })
      )
      .map((tech) => ({
        value: tech.id,
        label: `${tech.text || tech.name || "Technician"}${
          tech.subtext || tech.email ? ` (${tech.subtext || tech.email})` : ""
        }`,
      }));
  }, [resources, selectedJob]);

  const selectedReassignOption = useMemo(
    () =>
      reassignTechnicianOptions.find((opt) => opt.value === selectedNewTechnician?.id) ||
      null,
    [reassignTechnicianOptions, selectedNewTechnician]
  );

  const loadJobStatuses = useCallback(async ({ wait = false } = {}) => {
    const applyStatuses = async () => {
      const statuses = await fetchJobStatuses();
      if (Array.isArray(statuses) && statuses.length > 0) {
        setJobStatuses(statuses);
        writeCachedJobStatuses(statuses);
        jobStatusesReadyRef.current = true;
      }
    };

    const cacheFresh = isJobStatusesCacheFresh();

    if (wait || !jobStatusesReadyRef.current) {
      if (cacheFresh && jobStatusesReadyRef.current) return;
      await applyStatuses();
      return;
    }

    if (!cacheFresh) {
      void applyStatuses();
    }
  }, []);

  useEffect(() => {
    void loadJobStatuses({ wait: !jobStatusesReadyRef.current });
  }, [loadJobStatuses]);

  const getJobStatusColorFromSettings = (statusValue) => getJobStatusColorFromList(statusValue, jobStatuses);
  const getJobStatusLabelFromSettings = (statusValue) => getJobStatusLabelFromList(statusValue, jobStatuses);

  useEffect(() => {
    setDateInputValue(formatSchedulerDateInputValue(selectedDate, viewMode));
  }, [selectedDate, viewMode]);

  /* Keep sticky timeline header offset in sync when toolbar wraps (narrow screens) */
  useEffect(() => {
    const pageRoot = schedulerPageRootRef.current;
    const toolbar = toolbarRef.current;
    if (!pageRoot || !toolbar) return;

    const updateToolbarHeight = () => {
      const height = Math.ceil(toolbar.getBoundingClientRect().height);
      pageRoot.style.setProperty("--scheduler-sticky-toolbar-h", `${height}px`);
    };

    updateToolbarHeight();
    const observer = new ResizeObserver(updateToolbarHeight);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [viewMode, loading]);

  const commitDateFromInput = useCallback(() => {
    const parsed = parseSchedulerDateInputValue(dateInputValue, viewMode);
    if (parsed) {
      setSelectedDate(parsed);
      setDateInputValue(formatSchedulerDateInputValue(parsed, viewMode));
      return;
    }
    setDateInputValue(formatSchedulerDateInputValue(selectedDate, viewMode));
  }, [dateInputValue, viewMode, selectedDate]);

  const loadJobSiteContact = useCallback(async (job, { signal } = {}) => {
    if (!job?.jobId) return job;
    const m = job.meta || {};
    if (m.siteContactResolved) return job;
    if (signal?.aborted) return job;

    const cached = getSiteContactFromCache(schedulerRangeKey, job.jobId);
    if (cached) {
      return { ...job, meta: { ...m, ...cached, siteContactResolved: true } };
    }

    try {
      const response = await fetch(
        `/api/scheduler/job-site-contact?jobId=${encodeURIComponent(job.jobId)}`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal,
        }
      );
      if (signal?.aborted) return job;
      if (!response.ok) return job;
      const siteMeta = await response.json();
      if (signal?.aborted) return job;
      if (!siteMeta || typeof siteMeta !== "object") return job;
      setSiteContactCache(schedulerRangeKey, job.jobId, siteMeta);
      return { ...job, meta: { ...m, ...siteMeta, siteContactResolved: true } };
    } catch (err) {
      if (err?.name === "AbortError") return job;
      return job;
    }
  }, [schedulerRangeKey]);

  /* Sync horizontal scroll: header scroll → update grid; grid scroll → update header */
  const scrollSyncLockRef = useRef(false);
  const scrollSyncTeardownRef = useRef(null);
  useEffect(() => {
    if (viewMode !== 'day' || loading) {
      if (scrollSyncTeardownRef.current) {
        scrollSyncTeardownRef.current();
        scrollSyncTeardownRef.current = null;
      }
      return;
    }
    function attachScrollSync() {
      const headerEl = dailyHeaderScrollRef.current;
      const gridEl = dailyGridScrollRef.current;
      if (!headerEl || !gridEl) return false;
      const syncHeaderToGrid = () => {
        if (scrollSyncLockRef.current) return;
        scrollSyncLockRef.current = true;
        const left = headerEl.scrollLeft;
        if (gridEl.scrollLeft !== left) gridEl.scrollLeft = left;
        requestAnimationFrame(() => { scrollSyncLockRef.current = false; });
      };
      const syncGridToHeader = () => {
        if (scrollSyncLockRef.current) return;
        scrollSyncLockRef.current = true;
        const left = gridEl.scrollLeft;
        if (headerEl.scrollLeft !== left) headerEl.scrollLeft = left;
        requestAnimationFrame(() => { scrollSyncLockRef.current = false; });
      };
      headerEl.addEventListener('scroll', syncHeaderToGrid, { passive: true });
      gridEl.addEventListener('scroll', syncGridToHeader, { passive: true });
      scrollSyncTeardownRef.current = () => {
        headerEl.removeEventListener('scroll', syncHeaderToGrid);
        gridEl.removeEventListener('scroll', syncGridToHeader);
        scrollSyncTeardownRef.current = null;
      };
      return true;
    }
    const t = setTimeout(() => {
      if (attachScrollSync()) return;
      /* Retry a few times so first visit (after loading) always gets sync */
      let attempts = 0;
      const retry = () => {
        attempts += 1;
        if (attachScrollSync() || attempts >= 5) return;
        setTimeout(retry, 100);
      };
      setTimeout(retry, 100);
    }, 50);
    return () => {
      clearTimeout(t);
      if (scrollSyncTeardownRef.current) {
        scrollSyncTeardownRef.current();
      }
    };
  }, [viewMode, loading]);

  /**
   * Per open/close cycle (Network tab cleared, Fetch/XHR filter):
   * - 0 GET /api/scheduler/job-site-contact when meta.siteContactResolved (Phase 2 window load).
   * - 0 GET /api/scheduler/technician-data while 90s client cache is warm.
   * - 0 portal XHR on close; reopen same job = 0 new portal XHR if contact already resolved.
   * - Google Maps: one embed per unique location per session; reopen same location = 0 reload (pooled iframe).
   */
  const handleJobClick = (job) => {
    if (jobModalClosingRef.current) return;
    jobSiteContactAbortRef.current?.abort();
    jobSiteContactAbortRef.current = null;

    setSelectedJob(job);
    setShowJobModal(true);
    if (job?.meta?.siteContactResolved) return;

    const abortController = new AbortController();
    jobSiteContactAbortRef.current = abortController;
    void loadJobSiteContact(job, { signal: abortController.signal }).then((enriched) => {
      if (abortController.signal.aborted || !enriched) return;
      setSelectedJob((prev) =>
        prev && (prev.event_id === enriched.event_id || prev.id === enriched.id) ? enriched : prev
      );
      setEvents((prevEvents) =>
        prevEvents.map((evt) =>
          evt.jobId === enriched.jobId
            ? { ...evt, meta: { ...evt.meta, ...enriched.meta } }
            : evt
        )
      );
    });
  };

  const handleCloseModal = (event) => {
    event?.stopPropagation?.();
    jobSiteContactAbortRef.current?.abort();
    jobSiteContactAbortRef.current = null;
    jobModalClosingRef.current = true;
    setShowJobModal(false);
    setShowReassignModal(false);
    setSelectedNewTechnician(null);
    setSelectedJob(null);
    window.setTimeout(() => {
      jobModalClosingRef.current = false;
    }, 200);
  };

  const handleViewFullJob = () => {
    if (selectedJob?.jobId) {
      const url = `/dashboard/jobs/${selectedJob.jobId}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };


  const handleCellClick = (tech, startDate) => {
    if (!isTechnicianActive(tech)) {
      // toast.info(`${tech?.text || tech?.name || "This technician"} is inactive and unavailable for new assignments.`);
      return;
    }

    const startTime = new Date(startDate);
    const endTime = new Date(startTime);
    endTime.setHours(startTime.getHours() + 1, startTime.getMinutes(), 0, 0);

    setAssignmentData({
      technician: tech,
      startTime,
      endTime,
      availabilityIssues: getTechnicianAvailabilityIssues({
        dateLike: startTime,
        employeeSchedule: tech?.employeeSchedule,
        calendarEvents,
        technicianId: tech?.id,
        technicianName: tech?.text || tech?.name || "Technician",
      }),
    });
    setShowAssignConfirm(true);
  };

  const handleConfirmAssignment = () => {
    if (assignmentData) {
      // Format dates and times to match CreateJobs expectations
      const startDate = format(assignmentData.startTime, 'yyyy-MM-dd');
      const endDate = format(assignmentData.endTime, 'yyyy-MM-dd');
      const startTime = format(assignmentData.startTime, 'HH:mm');
      const endTime = format(assignmentData.endTime, 'HH:mm');
      
      // Navigate to create job with pre-filled data
      const params = new URLSearchParams({
        workerId: assignmentData.technician.id,
        startDate: startDate,
        endDate: endDate,
        startTime: startTime,
        endTime: endTime,
        scheduleSession: 'custom'
      });
      if (createAsRecurring) {
        params.set('openRepeat', '1');
      }
      router.push(`/dashboard/jobs/create-jobs?${params.toString()}`);
    }
    setShowAssignConfirm(false);
    setCreateAsRecurring(false);
  };

  const handleCancelAssignment = () => {
    setShowAssignConfirm(false);
    setAssignmentData(null);
    setCreateAsRecurring(false);
  };

  const handleReassign = async () => {
    if (!selectedJob || !selectedNewTechnician) {
      // toast.error('Please select a technician to reassign to');
      return;
    }

    setIsReassigning(true);
    try {
      // Pure reassign: only change the technician. Do NOT re-send start/end — prefer
      // jobs.scheduled_end for appointment display; stale job_schedule.jetime must not widen the slot.
      const updatedEvent = await reassignTechnician({
        technicianJobId: selectedJob.technicianJobId,
        jobId: selectedJob.jobId,
        technicianId: selectedNewTechnician.id,
      });

      const hydrated = hydrateSchedulerEvent(updatedEvent, resources);
      patchEvent({
        ...hydrated,
        resourceId: selectedNewTechnician.id,
        technicianId: selectedNewTechnician.id,
        color: selectedNewTechnician.color || hydrated.color,
      });

      invalidateSchedulerServerCache();

      setShowReassignModal(false);
      setSelectedNewTechnician(null);
    } catch (error) {
      console.error('Reassign error:', error);
      // toast.error(error.message || 'Failed to reassign job');
    } finally {
      setIsReassigning(false);
    }
  };

  const jobSubModalOpen =
    showReassignModal || showStatusEditModal || showScheduleEditModal;

  const handleOpenReassignModal = () => {
    setSelectedNewTechnician(null);
    setShowReassignModal(true);
  };

  const handleCloseReassignModal = () => {
    if (isReassigning) return;
    setShowReassignModal(false);
    setSelectedNewTechnician(null);
  };

  const handleOpenStatusEditModal = () => {
    setShowStatusEditModal(true);
  };

  const handleCloseStatusEditModal = () => {
    if (isUpdatingStatus) return;
    setShowStatusEditModal(false);
  };

  const handleOpenScheduleEditModal = () => {
    setShowScheduleEditModal(true);
  };

  const handleCloseScheduleEditModal = () => {
    if (isUpdatingSchedule) return;
    setShowScheduleEditModal(false);
  };

  const handleUpdateStatus = async (nextStatus) => {
    if (!selectedJob || !nextStatus) return;

    setIsUpdatingStatus(true);
    try {
      const updatedEvent = await updateJobStatusFromScheduler({
        jobId: selectedJob.jobId,
        technicianJobId: selectedJob.technicianJobId,
        status: nextStatus,
        previousStatus: selectedJob.jobStatus,
        jobStatuses,
      });

      const hydrated = hydrateSchedulerEvent(updatedEvent, resources);
      patchEvent({
        ...hydrated,
        color: getJobStatusColorFromSettings(hydrated.jobStatus) || hydrated.color,
      });
      setSelectedJob(hydrated);
      invalidateSchedulerServerCache();
      setShowStatusEditModal(false);
    } catch (error) {
      console.error("Status update error:", error);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleUpdateSchedule = async ({
    appointmentDate,
    startTime,
    endTime,
    durationHours,
    durationMinutes,
  }) => {
    if (!selectedJob) return;

    const hasAppointmentChange = appointmentDate && startTime && endTime;
    const hasDurationChange =
      durationHours !== undefined || durationMinutes !== undefined;

    if (!hasAppointmentChange && !hasDurationChange) return;

    let start = null;
    let end = null;
    if (hasAppointmentChange) {
      start = buildSingaporeDateTimeFromForm(appointmentDate, startTime);
      end = buildSingaporeDateTimeFromForm(appointmentDate, endTime);
      if (!start || !end) return;
    }

    setIsUpdatingSchedule(true);
    try {
      const updatedEvent = await rescheduleJobAppointment({
        jobId: selectedJob.jobId,
        jobScheduleId: selectedJob.jobScheduleId,
        technicianJobId: selectedJob.technicianJobId,
        technicianId: selectedJob.technicianId || selectedJob.resourceId,
        start: hasAppointmentChange ? start : undefined,
        end: hasAppointmentChange ? end : undefined,
        location: selectedJob.location,
        durationHours: hasDurationChange ? durationHours : undefined,
        durationMinutes: hasDurationChange ? durationMinutes : undefined,
      });

      const hydrated = hydrateSchedulerEvent(updatedEvent, resources);
      patchEvent({
        ...hydrated,
        color: getJobStatusColorFromSettings(hydrated.jobStatus) || hydrated.color,
      });
      setSelectedJob(hydrated);
      invalidateSchedulerServerCache();
      setShowScheduleEditModal(false);
    } catch (error) {
      console.error("Schedule update error:", error);
    } finally {
      setIsUpdatingSchedule(false);
    }
  };

  const handleWorkerAvatarClick = (tech, e) => {
    e.stopPropagation();
    setSelectedTechnicianForColor(tech);
    setSelectedColor(tech.color || '#667eea');
    setShowColorPicker(true);
  };

  const handleCloseColorPicker = () => {
    setShowColorPicker(false);
    setSelectedTechnicianForColor(null);
    setSelectedColor('#667eea');
  };

  const handleColorUpdate = async () => {
    if (!selectedTechnicianForColor) return;

    setIsUpdatingColor(true);
    try {
      await updateTechnicianColor(selectedTechnicianForColor.id, selectedColor);
      
      // Update the local state immediately
      setResources(prevResources => 
        prevResources.map(tech => 
          tech.id === selectedTechnicianForColor.id 
            ? { ...tech, color: selectedColor }
            : tech
        )
      );

      // Update events with the new color
      setEvents(prevEvents =>
        prevEvents.map(evt => {
          const resourceId = evt.resourceId || evt.technicianId;
          if (String(resourceId) === String(selectedTechnicianForColor.id)) {
            return { ...evt, color: selectedColor };
          }
          return evt;
        })
      );

      // toast.success(`Color updated for ${selectedTechnicianForColor.text || selectedTechnicianForColor.name}`);
      handleCloseColorPicker();
    } catch (error) {
      console.error('Color update error:', error);
      // toast.error(error.message || 'Failed to update color');
    } finally {
      setIsUpdatingColor(false);
    }
  };

  const sanitizeHtml = (html) => {
    if (!html) return '';
    // Replace basic HTML entities and clean up
    return html
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  };

  /** Daily view: timeline starts at 7 AM. Slot 0 = 7:00 AM, slot 47 = 6:30 AM next day. */
  const DAILY_FIRST_HOUR = 7;
  const getSlotIndexFromTime = (hour, minute) => {
    if (hour >= DAILY_FIRST_HOUR) {
      return (hour - DAILY_FIRST_HOUR) * 2 + Math.floor(minute / 30);
    }
    return (hour + 24 - DAILY_FIRST_HOUR) * 2 + Math.floor(minute / 30);
  };
  const getTimeFromSlotIndex = (slotIndex) => {
    const hour = (DAILY_FIRST_HOUR + Math.floor(slotIndex / 2)) % 24;
    const minute = (slotIndex % 2) * 30;
    return { hour, minute };
  };

  /** Day header: "9:00-9:30 AM" — start of pair slot → start of next slot in pair. */
  const formatDailyHeaderSlotRange = (pairIndex) => {
    const startSlot = pairIndex * 2;
    const start = getTimeFromSlotIndex(startSlot);
    const end = getTimeFromSlotIndex(startSlot + 1);
    const formatClock = (hour, minute) => {
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return minute === 0
        ? `${displayHour}:00`
        : `${displayHour}:${minute.toString().padStart(2, '0')}`;
    };
    const startPeriod = start.hour >= 12 ? 'PM' : 'AM';
    const endPeriod = end.hour >= 12 ? 'PM' : 'AM';
    const startStr = formatClock(start.hour, start.minute);
    const endStr = formatClock(end.hour, end.minute);
    if (startPeriod === endPeriod) {
      return `${startStr}-${endStr} ${startPeriod}`;
    }
    return `${startStr} ${startPeriod}-${endStr} ${endPeriod}`;
  };

  /**
   * 30-min slots on the visible 7:00 → +24h strip (48 cells).
   * Card width uses daily work window (start time-of-day + dur), including multi-day jobs.
   */
  const getJobDaySlotRange = (job) => {
    const selectedDayStart = startOfDay(selectedDate);
    const t0d = new Date(selectedDayStart);
    t0d.setHours(DAILY_FIRST_HOUR, 0, 0, 0);
    const t0 = t0d.getTime();
    const t1 = t0 + DAILY_VIEW_WINDOW_MS;

    const { plotStartMs, plotEndMs, inSpan } = getJobPlotRangeForDay(job, selectedDayStart, {
      firstHour: DAILY_FIRST_HOUR,
    });

    if (!inSpan) {
      return {
        startSlot: 0,
        endSlot: 0,
        duration: 0,
        inView: false,
        clipStartMs: null,
        clipEndMs: null,
      };
    }

    // Intersection of [plotStartMs, plotEndMs] with the half-open day strip [t0, t1)
    const cS = Math.max(t0, plotStartMs);
    const cE = Math.min(t1, plotEndMs);
    const inView = Number.isFinite(cS) && Number.isFinite(cE) && cE > cS;

    if (!inView) {
      return {
        startSlot: 0,
        endSlot: 0,
        duration: 0,
        inView: false,
        clipStartMs: null,
        clipEndMs: null,
      };
    }

    const relS = (cS - t0) / DAILY_SLOT_MS;
    const relE = (cE - t0) / DAILY_SLOT_MS;
    const startSlot = Math.max(0, Math.min(47, Math.floor(relS + DAILY_SLOT_INDEX_EPS)));
    const endSlot = Math.min(
      48,
      Math.max(startSlot + 1, Math.ceil(relE - DAILY_SLOT_INDEX_EPS))
    );
    const duration = Math.max(1, endSlot - startSlot);
    return {
      startSlot,
      endSlot,
      duration,
      inView: true,
      clipStartMs: cS,
      clipEndMs: cE,
    };
  };

  /**
   * Day view: keep jobs on a **single horizontal band** so they overlap in time (like
   * stacked cards), matching the previous Technician Scheduler. Only add a new vertical
   * lane when two jobs share the same **30-minute start slot** (same “appointment
   * time” on the grid)—not when their intervals merely overlap.
   */
  const assignLanes = (jobs) => {
    if (!jobs || jobs.length === 0) return { lanes: [], laneCount: 0 };
    const withRanges = jobs.map((job) => {
      const { startSlot, endSlot } = getJobDaySlotRange(job);
      return { job, startSlot, endSlot };
    });
    withRanges.sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot);
    const slotsUsedPerLane = [];
    const result = [];
    for (const item of withRanges) {
      const { job, startSlot } = item;
      let lane = 0;
      while (true) {
        if (!slotsUsedPerLane[lane]) slotsUsedPerLane[lane] = new Set();
        const used = slotsUsedPerLane[lane];
        if (!used.has(startSlot)) {
          used.add(startSlot);
          result.push({ job, laneIndex: lane, startSlot });
          break;
        }
        lane++;
      }
    }
    return { lanes: result, laneCount: Math.max(1, slotsUsedPerLane.length) };
  };

  // Filter resources by search
  const filteredResources = resources.filter((tech) => {
    const searchLower = searchTerm.toLowerCase();
    const name = (tech.text || tech.name || '').toLowerCase();
    const email = (tech.subtext || tech.email || '').toLowerCase();
    return name.includes(searchLower) || email.includes(searchLower);
  });
  const allowedTechIds = new Set(filteredResources.map((t) => String(t.id)));
  const activeWorkerCount = filteredResources.filter(isTechnicianActive).length;
  const inactiveWorkerCount = filteredResources.length - activeWorkerCount;
  const workerAccountStatusSummary = (
    <div className={styles.workerAccountStatusSummary}>
      <span className={styles.activeWorkerCount}>Active: {activeWorkerCount}</span>
      <span className={styles.inactiveWorkerCount}>Inactive: {inactiveWorkerCount}</span>
    </div>
  );

  const filteredEvents = useMemo(
    () =>
      events.filter((evt) => {
        const eventStart = new Date(evt.start);
        const eventEnd = new Date(evt.end);

        if (viewMode === "day") {
          const selectedDay = startOfDay(selectedDate);
          return (
            isSameDay(eventStart, selectedDay) ||
            isSameDay(eventEnd, selectedDay) ||
            (eventStart < selectedDay && eventEnd > selectedDay)
          );
        }
        if (viewMode === "week") {
          const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
          const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 1 });
          return eventStart <= weekEnd && eventEnd >= weekStart;
        }
        if (viewMode === "month") {
          const monthStart = startOfMonth(selectedDate);
          const monthEnd = endOfMonth(selectedDate);
          return eventStart <= monthEnd && eventEnd >= monthStart;
        }
        return true;
      }),
    [events, viewMode, selectedDate]
  );

  const eventsByTechAndDay = useMemo(
    () => buildEventsByTechAndDay(filteredEvents, viewMode, selectedDate),
    [filteredEvents, viewMode, selectedDate]
  );

  const renderMonthCalendar = () => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

    return (
      <>
        <div className={styles.calendarHeader}>
          <div className={styles.dayName}>Sun</div>
          <div className={styles.dayName}>Mon</div>
          <div className={styles.dayName}>Tue</div>
          <div className={styles.dayName}>Wed</div>
          <div className={styles.dayName}>Thu</div>
          <div className={styles.dayName}>Fri</div>
          <div className={styles.dayName}>Sat</div>
        </div>
        <div className={styles.calendarGrid}>
          {calendarDays.map((day) => {
            const isCurrentMonth = day.getMonth() === selectedDate.getMonth();
            const dayYmd = toSingaporeYmd(day);
            const hasCompanyEvent = companyEventsCoverDate(calendarEvents, dayYmd);
            const dayJobs = getEventsForDayFromIndex(eventsByTechAndDay, dayYmd, allowedTechIds);

            return (
              <div 
                key={day.toISOString()} 
                className={`${styles.calendarDay} ${!isCurrentMonth ? styles.otherMonth : ''} ${
                  hasCompanyEvent ? styles.companyCalendarMonthDay : ""
                }`}
              >
                <div className={styles.dayNumber}>
                  {format(day, 'd')}
                  {hasCompanyEvent && (
                    <span className={styles.companyCalendarMonthDot} title="Company event" />
                  )}
                </div>
                <div className={styles.dayJobs}>
                  {dayJobs.map((job) => (
                    <div
                      key={job.event_id || job.id}
                      className={styles.calendarJobBadge}
                      style={{ backgroundColor: getJobStatusColorFromSettings(job.jobStatus) || job.color || "currentColor" }}
                      onClick={() => handleJobClick(job)}
                      title={`${job.jobNumber} - ${job.title} | Job: ${getJobStatusLabelFromSettings(job.jobStatus)}`}
                    >
                      {job.jobNumber}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  if (isInitialLoad) {
    return (
      <CustomerListLoadingIndicator
        loading
        currentStep={0}
        totalSteps={1}
        progress={0}
        title="Loading scheduler"
        showStepsSection={false}
        showTipsSection={false}
        rotatingProgressCaptions={SCHEDULER_LOADING_STATUS_LINES}
        rotateProgressIntervalMs={4500}
        indeterminate
        rotatingTips={SCHEDULER_LOADING_TIPS}
        rotateTipsIntervalMs={6000}
      />
    );
  }

  return (
    <>
      <div className={`container-fluid px-0 ${styles.schedulerPageRoot}`} ref={schedulerPageRootRef}>
        <div className={styles.schedulerContainer}>
          {/* Day/Week: page scroll; toolbar + grid header stick below dashboard nav */}
          <div className={viewMode === 'day' || viewMode === 'week' ? styles.schedulerBodyFlow : undefined}>
          <div className={styles.toolbar} ref={toolbarRef}>
            <div className={styles.toolbarLeft}>
              <button 
                onClick={() => {
                  if (viewMode === 'month') {
                    setSelectedDate(subMonths(selectedDate, 1));
                  } else if (viewMode === 'week') {
                    setSelectedDate(subWeeks(selectedDate, 1));
                  } else {
                    setSelectedDate(subDays(selectedDate, 1));
                  }
                }} 
                className={styles.btnOutline}
                title={viewMode === 'month' ? 'Previous month' : viewMode === 'week' ? 'Previous week' : 'Previous day'}
              >
                ←
              </button>
              {viewMode === 'month' ? (
                <input
                  type="month"
                  value={dateInputValue}
                  onChange={(e) => setDateInputValue(e.target.value)}
                  onBlur={commitDateFromInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitDateFromInput();
                      e.currentTarget.blur();
                    }
                  }}
                  className={styles.dateInput}
                />
              ) : (
                <div className={styles.datePickerGroup}>
                  <button
                    type="button"
                    className={styles.dateDisplayBtn}
                    onClick={() => hiddenDateInputRef.current?.showPicker?.()}
                    title="Change date"
                  >
                    {formatSchedulerDateDisplay(selectedDate, viewMode)}
                  </button>
                  <input
                    ref={hiddenDateInputRef}
                    type="date"
                    value={dateInputValue}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setDateInputValue(nextValue);
                      const parsed = parseSchedulerDateInputValue(nextValue, viewMode);
                      if (parsed) setSelectedDate(parsed);
                    }}
                    className={styles.hiddenDateInput}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              )}
              <button 
                onClick={() => {
                  if (viewMode === 'month') {
                    setSelectedDate(addMonths(selectedDate, 1));
                  } else if (viewMode === 'week') {
                    setSelectedDate(addWeeks(selectedDate, 1));
                  } else {
                    setSelectedDate(addDays(selectedDate, 1));
                  }
                }} 
                className={styles.btnOutline}
                title={viewMode === 'month' ? 'Next month' : viewMode === 'week' ? 'Next week' : 'Next day'}
              >
                →
              </button>
              <button onClick={() => setSelectedDate(new Date())} className={styles.btnOutline}>
                Today
              </button>
              
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Worker:</label>
                <input
                  type="text"
                  placeholder="Search workers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.viewToggle}>
                <button 
                  className={`${styles.toggleBtn} ${viewMode === 'day' ? styles.toggleBtnActive : ''}`}
                  onClick={() => setViewMode('day')}
                >
                  Day
                </button>
                <button 
                  className={`${styles.toggleBtn} ${viewMode === 'week' ? styles.toggleBtnActive : ''}`}
                  onClick={() => setViewMode('week')}
                >
                  Week
                </button>
                <button 
                  className={`${styles.toggleBtn} ${viewMode === 'month' ? styles.toggleBtnActive : ''}`}
                  onClick={() => setViewMode('month')}
                >
                  Month
                </button>
              </div>
            </div>

            {/* DO NOT REMOVE THIS REFRESH SCHEDULE BUTTON 
            <div className={styles.toolbarRight}>
              {isRefreshing && (
                <span className="text-muted small d-flex align-items-center gap-1 me-2">
                  <Spinner animation="border" size="sm" />
                  Updating…
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleRefreshSchedule()}
                className={styles.btnOutline}
                disabled={isRefreshing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {isRefreshing ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  <ArrowRepeatIcon size={16} />
                )}
                Refresh Schedule
              </button>
            </div> */}
          </div>

          {/* Week view: WORKERS title + day names - direct child of scroll container so sticky works */}
          {viewMode === 'week' && (
            <div className={styles.toolbarSchedulerHeaderWeek}>
              <div className={styles.toolbarWorkerLabel}>
                <span>WORKERS ({filteredResources.length})</span>
                {workerAccountStatusSummary}
              </div>
              {(() => {
                const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
                return Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(weekStart, i);
                  const isToday = isSameDay(day, new Date());
                  const dayYmd = toSingaporeYmd(day);
                  const hasCompanyEvent = companyEventsCoverDate(calendarEvents, dayYmd);
                  return (
                    <div
                      key={i}
                      className={`${styles.toolbarDayName} ${isToday ? styles.todayHeader : ""} ${
                        hasCompanyEvent ? styles.companyCalendarDayHeader : ""
                      }`}
                      title={
                        hasCompanyEvent
                          ? "Company holiday or day off on this date"
                          : undefined
                      }
                    >
                      {format(day, 'EEE')} {format(day, 'd')} {format(day, 'MMM')}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* Day view: WORKERS + date/time - direct child of scroll container (like week) so sticky works */}
          {viewMode === 'day' && (
            <div className={styles.dailyViewHeaderSticky}>
              <div className={styles.dailyViewHeaderScroll} ref={dailyHeaderScrollRef}>
                <div className={`${styles.dailyViewDateCell} ${isSameDay(selectedDate, new Date()) ? styles.todayHeader : ''} ${
                    companyEventsCoverDate(calendarEvents, toSingaporeYmd(selectedDate))
                      ? styles.companyCalendarDayHeader
                      : ""
                  }`}>
                  {format(selectedDate, 'EEE')} {format(selectedDate, 'd')} {format(selectedDate, 'MMM')}
                </div>
                <div className={styles.dailyViewDateSpacer} aria-hidden="true" />
                <div className={styles.dailyViewWorkerLabel}>
                  <span>WORKERS ({filteredResources.length})</span>
                  {workerAccountStatusSummary}
                </div>
                <div className={styles.dailyViewTimeSlots}>
                  {Array.from({ length: 24 }, (_, pairIndex) => (
                    <div key={pairIndex} className={styles.dailyViewTimeSlot}>
                      {formatDailyHeaderSlotRange(pairIndex)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {viewMode === 'day' ? (
            /* Day View - grid in its own horizontal scroll; scroll synced with header above */
            <div className={styles.dailyViewGridWrapper} ref={dailyGridScrollRef}>
              <div className={styles.dailyCalendarGrid}>
                {/* Worker Rows with Jobs - no header row */}
                {filteredResources.map((tech) => {
                  const technicianActive = isTechnicianActive(tech);
                  const technicianStatusLabel = tech.statusLabel || tech.status || "Inactive";
                  const dayYmd = toSingaporeYmd(selectedDate);
                  const techJobs = getEventsForTechAndDay(eventsByTechAndDay, tech.id, dayYmd);
                  const techJobsInView = techJobs.filter((evt) => getJobDaySlotRange(evt).inView);
                  const { lanes, laneCount } = assignLanes(techJobsInView);
                  const rowLanes = Math.max(1, laneCount);
                  const rowHeight = Math.max(
                    DAILY_ROW_MIN_HEIGHT_PX,
                    DAILY_LANE_HEIGHT_PX * rowLanes
                  );
                  const onLeave = technicianOnLeaveDate(calendarEvents, tech.id, dayYmd);
                  const companyDay = companyEventsCoverDate(calendarEvents, dayYmd);

                  return (
                    <React.Fragment key={tech.id}>
                      {/* Worker Info */}
                      <div
                        className={`${styles.dailyWorkerRow} ${!technicianActive ? styles.inactiveWorkerRow : ''}`}
                        style={{ minHeight: rowHeight, height: rowHeight }}
                      >
                        <div className={styles.weeklyWorkerInfo}>
                          <div 
                            className={styles.workerAvatar} 
                            style={{ backgroundColor: tech.color || '#667eea', cursor: 'pointer' }}
                            onClick={(e) => handleWorkerAvatarClick(tech, e)}
                            title="Click to change color"
                          >
                            {tech.text?.substring(0, 2).toUpperCase() || 'T'}
                          </div>
                          <div className={styles.workerInfo}>
                            <div className={styles.workerName} title={tech.text || tech.name || ''}>
                              {tech.text || tech.name}
                            </div>
                            {!technicianActive && (
                              <span className={styles.inactiveStatusBadge}>
                                {technicianStatusLabel}
                              </span>
                            )}
                            <div 
                              className={styles.workerEmail} 
                              title={tech.subtext || tech.email || ''}
                            >
                              {tech.subtext || tech.email}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Day Column with Timeline and Jobs */}
                      <div 
                        className={`${styles.dailyTimelineCell} ${!technicianActive ? styles.inactiveWorkerTimeline : ''} ${
                          onLeave ? styles.technicianLeaveDayCell : ""
                        } ${companyDay ? styles.companyCalendarDayCell : ""}`}
                        style={{ minHeight: rowHeight, height: rowHeight }}
                      >
                        <div className={styles.dailyTimelineRow}>
                          {/* 48 time cells: isolated grid so job cards are never implicit grid rows */}
                          <div className={styles.dailyTimeCellStrip}>
                            {Array.from({ length: 48 }, (_, i) => {
                              const { hour, minute } = getTimeFromSlotIndex(i);
                              return (
                                <div 
                                  key={i} 
                                  className={`${styles.dailyTimeCell} ${!technicianActive ? styles.inactiveTimeCell : ''}`}
                                  onClick={() => {
                                    const clickDate = new Date(selectedDate);
                                    clickDate.setHours(hour, minute, 0, 0);
                                    handleCellClick(tech, clickDate);
                                  }}
                                  title={
                                    technicianActive
                                      ? `Click to assign job at ${hour}:${minute.toString().padStart(2, '0')}`
                                      : `${tech.text || tech.name || 'Technician'} is inactive and unavailable`
                                  }
                                ></div>
                              );
                            })}
                          </div>
                          <div className={styles.dailyJobsOverlay}>
                          {lanes.map(({ job, laneIndex }) => {
                            const {
                              startSlot,
                              endSlot,
                              duration,
                            } = getJobDaySlotRange(job);
                            const laneGapPct = 0.05;
                            const laneHeight = (100 / rowLanes) - laneGapPct / rowLanes;
                            const top = (laneIndex / rowLanes) * 100 + laneGapPct * 0.1;
                            const stackZ = 1 + laneIndex;
                            
                            return (
                              <div
                                key={job.event_id || job.id}
                                className={styles.dailyJobCard}
                                style={{
                                  left: `${startSlot * DAILY_SLOT_WIDTH_PX}px`,
                                  width: `${Math.max(1, duration) * DAILY_SLOT_WIDTH_PX}px`,
                                  top: `${top}%`,
                                  height: `${laneHeight}%`,
                                  zIndex: stackZ,
                                  backgroundColor: getJobStatusColorFromSettings(job.jobStatus) || job.color || tech.color || "currentColor",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJobClick(job);
                                }}
                                title={`${job.jobNumber || 'Job'} — ${job.title || ''}`}
                              >
                                <div className={styles.dailyJobNumber}>#{job.jobNumber || 'N/A'}</div>
                                <div className={styles.dailyJobStatusRow}>
                                  <span className={styles.dailyJobStatusLabel}>Job:</span>
                                  <span>{getJobStatusLabelFromSettings(job.jobStatus)}</span>
                                </div>
                                <div className={styles.dailyJobTitle}>{job.title || 'Untitled'}</div>
                                {job.meta?.customerName && (
                                  <div className={styles.dailyJobCustomer}>
                                    {job.meta.customerName}
                                  </div>
                                )}
                                {job.location && (
                                  <div className={styles.dailyJobLocation}>
                                    {job.location}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      </div>

                      {/* Unscheduled jobs strip — jobs assigned to this tech with no valid scheduled date */}
                      {(undatedByTech[tech.id] || []).length > 0 && (
                        <div className={styles.unscheduledJobsRow}>
                          <span className={styles.unscheduledLabel}>
                            No date set ({(undatedByTech[tech.id] || []).length}):
                          </span>
                          {(undatedByTech[tech.id] || []).map((a) => (
                            <span
                              key={a.assignmentId}
                              className={styles.unscheduledJobPill}
                              title={`${a.jobTitle || 'Untitled'} — ${a.customerName || 'No customer'} | Status: ${a.jobStatus || 'N/A'}`}
                              onClick={() => router.push(`/dashboard/jobs/${a.jobId}`)}
                            >
                              #{a.jobNumber || a.jobId}
                            </span>
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ) : viewMode === 'week' ? (
            /* Weekly View - Grid has no header row; WORKERS + day names are in toolbar above */
            <div className={styles.schedulerScrollArea}>
            <div className={styles.weeklyWrapper}>
              <div className={styles.weeklyCalendarGrid}>
                {/* Worker Rows with Jobs - no header row */}
                {filteredResources.map((tech) => {
                  const technicianActive = isTechnicianActive(tech);
                  const technicianStatusLabel = tech.statusLabel || tech.status || "Inactive";
                  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
                  
                  return (
                    <React.Fragment key={tech.id}>
                      {/* Worker Info */}
                      <div className={`${styles.weeklyWorkerRow} ${!technicianActive ? styles.inactiveWorkerRow : ''}`}>
                        <div className={styles.weeklyWorkerInfo}>
                          <div 
                            className={styles.workerAvatar} 
                            style={{ backgroundColor: tech.color || '#667eea', cursor: 'pointer' }}
                            onClick={(e) => handleWorkerAvatarClick(tech, e)}
                            title="Click to change color"
                          >
                            {tech.text?.substring(0, 2).toUpperCase() || 'T'}
                          </div>
                          <div className={styles.workerInfo}>
                            <div className={styles.workerName} title={tech.text || tech.name || ''}>
                              {tech.text || tech.name}
                            </div>
                            {!technicianActive && (
                              <span className={styles.inactiveStatusBadge}>
                                {technicianStatusLabel}
                              </span>
                            )}
                            <div 
                              className={styles.workerEmail} 
                              title={tech.subtext || tech.email || ''}
                            >
                              {tech.subtext || tech.email}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Day Columns with Jobs */}
                      {Array.from({ length: 7 }, (_, dayIndex) => {
                        const day = addDays(weekStart, dayIndex);
                        const dayYmd = toSingaporeYmd(day);
                        const onLeave = technicianOnLeaveDate(calendarEvents, tech.id, dayYmd);
                        const companyDay = companyEventsCoverDate(calendarEvents, dayYmd);

                        const techJobs = getEventsForTechAndDay(eventsByTechAndDay, tech.id, dayYmd)
                          .sort(compareJobsByScheduleTime);

                        return (
                          <div 
                            key={dayIndex} 
                            className={`${styles.weeklyDayCell} ${!technicianActive ? styles.inactiveWeeklyDayCell : ''} ${
                              onLeave ? styles.technicianLeaveDayCell : ""
                            } ${companyDay ? styles.companyCalendarDayCell : ""}`}
                            title={
                              !technicianActive
                                ? `${tech.text || tech.name || "Technician"} is inactive and unavailable`
                                : onLeave
                                  ? "Technician on approved leave — click to assign"
                                  : companyDay
                                    ? "Company holiday or day off — click to assign"
                                    : "Click to assign job"
                            }
                            onClick={() => {
                              const clickDate = new Date(day);
                              clickDate.setHours(12, 0, 0, 0);
                              handleCellClick(tech, clickDate);
                            }}
                          >
                            <div className={styles.weeklyDayJobs}>
                              {techJobs.map((job) => (
                                <div
                                  key={job.event_id || job.id}
                                  className={styles.weeklyJobCard}
                                  style={{
                                    backgroundColor: getJobStatusColorFromSettings(job.jobStatus) || job.color || tech.color || "currentColor",
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleJobClick(job);
                                  }}
                                  title={`${job.jobNumber || 'Job'} - ${job.title}`}
                                >
                                  <div className={styles.weeklyJobNumber}>#{job.jobNumber || 'N/A'}</div>
                                  <div className={styles.weeklyJobStatusRow}>
                                    <span className={styles.weeklyJobStatusLabel}>Job:</span>
                                    <span>{getJobStatusLabelFromSettings(job.jobStatus)}</span>
                                  </div>
                                  <div className={styles.weeklyJobTitle}>{job.title || 'Untitled'}</div>
                                  {job.meta?.customerName && (
                                    <div className={styles.weeklyJobCustomer}>
                                      {job.meta.customerName}
                                    </div>
                                  )}
                                  {job.location && (
                                    <div className={styles.weeklyJobLocation}>
                                      {job.location}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            </div>
          ) : (
            /* Month Calendar View */
            <div className={styles.calendarView}>
              {renderMonthCalendar()}
            </div>
          )}
          </div>
        </div>
      </div>
      
      {/* Assignment Confirmation Modal */}
      {showAssignConfirm && (
        <PortalModal
          show={showAssignConfirm}
          onHide={handleCancelAssignment}
          title="Assign Job"
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={handleCancelAssignment}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirmAssignment}>
                Yes, Create Job
              </Button>
            </>
          }
        >
          {assignmentData && (
            <div>
              {assignmentData.availabilityIssues?.labels?.length > 0 && (
                <div className="alert alert-warning mb-3" role="alert">
                  {assignmentData.availabilityIssues.labels.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  <div className="mt-2">
                    <SchedulerAvailabilityHelpLinks
                      availability={assignmentData.availabilityIssues}
                      technician={assignmentData.technician}
                      dateLike={assignmentData.startTime}
                      linkClassName="alert-link fw-semibold"
                    />
                  </div>
                </div>
              )}
              <p className="mb-3">Are you sure you want to assign a job for this technician?</p>
              <PortalConfirmPanel className="mt-0">
                <PortalConfirmRow
                  label="Technician"
                  value={assignmentData.technician.text || assignmentData.technician.name}
                />
                <PortalConfirmRow
                  label="Date"
                  value={format(assignmentData.startTime, "MMMM dd, yyyy")}
                />
                <PortalConfirmRow
                  label="Time"
                  value={`${format(assignmentData.startTime, "h:mm a")} - ${format(assignmentData.endTime, "h:mm a")}`}
                />
              </PortalConfirmPanel>
              <Form.Check
                type="checkbox"
                id="create-as-recurring"
                className="mt-3"
                label="Create as recurring"
                checked={createAsRecurring}
                onChange={(e) => setCreateAsRecurring(e.target.checked)}
              />
            </div>
          )}
        </PortalModal>
      )}

      {/* Job Detail Modal */}
      <PortalModal
        show={showJobModal && !jobSubModalOpen}
        onHide={handleCloseModal}
        title={
          selectedJob?.jobNumber
            ? `Job ${selectedJob.jobNumber}`
            : "Job Details"
        }
        subtitle={
          selectedJob ? (
            <span className={styles.jobDetailHeaderMeta}>
              <span className={styles.jobDetailHeaderMetaGroup}>
                <span
                  className={styles.jobStatusPill}
                  style={{
                    background:
                      getJobStatusColorFromSettings(selectedJob.jobStatus) || "#6b7280",
                  }}
                >
                  {getJobStatusLabelFromSettings(selectedJob.jobStatus) ||
                    selectedJob.jobStatus ||
                    "N/A"}
                </span>
                <button
                  type="button"
                  className={styles.jobDetailHeaderEditAction}
                  onClick={handleOpenStatusEditModal}
                  disabled={isUpdatingStatus || isUpdatingSchedule || isReassigning}
                >
                  Edit status
                </button>
              </span>
              <span className={styles.jobDetailHeaderMetaGroup}>
                <span className={styles.jobDetailHeaderTime}>
                  <ClockIcon aria-hidden />
                  {formatModalOriginalAppointmentTime(selectedJob)}
                </span>
                <button
                  type="button"
                  className={styles.jobDetailHeaderEditAction}
                  onClick={handleOpenScheduleEditModal}
                  disabled={isUpdatingStatus || isUpdatingSchedule || isReassigning}
                >
                  Edit schedule
                </button>
              </span>
              {formatDurationLabel(selectedJob.durationHours) ? (
                <span className={styles.jobDetailHeaderDuration}>
                  Est. work: {formatDurationLabel(selectedJob.durationHours)}
                </span>
              ) : null}
            </span>
          ) : null
        }
        size="xl"
        modalClassName={styles.jobDetailPortalModal}
        headerClassName={styles.jobDetailModalHeader}
        contentExtraClassName={styles.jobDetailModalContent}
        bodyClassName={styles.jobDetailModalBody}
        footer={
          <>
            <Button variant="secondary" onClick={handleCloseModal}>
              Close
            </Button>
            <Button variant="primary" onClick={handleViewFullJob}>
              View Full Job
            </Button>
          </>
        }
      >
          {selectedJob &&
            (() => {
              const job = selectedJob;
              const m = job.meta || {};
              const name = (m.siteContactName || "").trim();
              const office = (m.siteContactPhone || "").trim();
              const mobile = (m.siteContactMobile || "").trim();
              const email = (m.siteContactEmail || "").trim();
              const extra =
                typeof m.siteContactExtraCount === "number" && m.siteContactExtraCount > 0
                  ? m.siteContactExtraCount
                  : 0;
              const officeRow = office ? phoneLinkRow(office) : null;
              const mobileRow = mobile ? phoneLinkRow(mobile) : null;
              const loc = job.location || "";
              const contactDisplayName = name || m.customerName || "Site contact";
              const locationParts =
                loc && loc !== "No Location"
                  ? loc.split(",").map((s) => s.trim()).filter(Boolean)
                  : [];

              return (
                <div className={styles.jobDetailModalLayout}>
                  <div className={styles.jobDetailHero}>
                    <div className={styles.jobDetailHeroTop}>
                      <h2 className={styles.jobDetailHeroTitle}>
                        {job.title || "Untitled job"}
                      </h2>
                      <button
                        type="button"
                        className={styles.jobDetailHeroReassign}
                        onClick={handleOpenReassignModal}
                        disabled={isReassigning}
                      >
                        <ArrowRepeatIcon aria-hidden />
                        Reassign
                      </button>
                    </div>
                    <JobServiceCallSalesOrder
                      className={styles.jobDetailHeroIdentifiers}
                      serviceCallNumber={m.serviceCallNumber}
                      salesOrderNumber={m.salesOrderNumber}
                      variant="scheduler"
                    />
                    {m.customerName ? (
                      <p className={styles.jobDetailHeroCustomer}>{m.customerName}</p>
                    ) : null}
                    {(() => {
                      const assigned = getAssignedTechnicianNames(job, resources, events);
                      const hasAssigned = assigned.length > 0;

                      return (
                        <div className={styles.jobDetailHeroAssignedCard}>
                          <div className={styles.jobDetailHeroAssignedHeader}>
                            <span className={styles.jobDetailHeroAssignedIcon} aria-hidden>
                              <PersonFillIcon />
                            </span>
                            <span className={styles.jobDetailHeroAssignedLabel}>
                              Assigned technician
                            </span>
                          </div>

                          <div className={styles.jobDetailHeroAssignedBody}>
                            {hasAssigned ? (
                              <div className={styles.jobDetailHeroAssignedPills}>
                                {assigned.map((name) => (
                                  <span
                                    key={name}
                                    className={styles.jobDetailHeroAssignedPill}
                                    title={name}
                                  >
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className={styles.jobDetailHeroAssignedEmpty}>
                                Unassigned
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className={styles.jobDetailColumns}>
                    <div className={styles.jobDetailColLeft}>
                      <section className={styles.jobDetailBlock}>
                        <h3 className={styles.jobDetailBlockTitle}>Site contact</h3>
                        <div className={styles.jobDetailContactCard}>
                          <div className={styles.jobDetailContactProfile}>
                            <div className={styles.jobDetailContactAvatar} aria-hidden>
                              {getContactInitials(contactDisplayName)}
                            </div>
                            <div className={styles.jobDetailContactIdentity}>
                              <div className={styles.jobDetailContactName}>
                                {name || (
                                  <span className={styles.jobDetailContactNameMuted}>
                                    Not specified
                                  </span>
                                )}
                              </div>
                              {extra > 0 ? (
                                <span className={styles.jobDetailExtraBadge}>
                                  +{extra} on site
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className={styles.jobDetailContactRows}>
                            <JobDetailContactRow
                              icon={TelephoneIcon}
                              label="Office phone"
                              value={officeRow?.label}
                              telHref={officeRow?.telHref}
                              waHref={officeRow?.waHref}
                              styles={styles}
                            />
                            <JobDetailContactRow
                              icon={PhoneIcon}
                              label="Mobile"
                              value={mobileRow?.label}
                              telHref={mobileRow?.telHref}
                              waHref={mobileRow?.waHref}
                              styles={styles}
                            />
                            <JobDetailContactRow
                              icon={EnvelopeIcon}
                              label="Email"
                              value={email || null}
                              mailto={email ? `mailto:${encodeURIComponent(email)}` : null}
                              styles={styles}
                            />
                          </div>
                        </div>
                      </section>

                      {m.description ? (
                        <section className={styles.jobDetailBlock}>
                          <h3 className={styles.jobDetailBlockTitle}>Work Description</h3>
                          <JobDetailDescription
                            raw={m.description}
                            sanitizeHtml={sanitizeHtml}
                            styles={styles}
                          />
                        </section>
                      ) : null}
                    </div>

                    <div className={styles.jobDetailColRight}>
                      <JobDetailLocationPanel
                        location={loc}
                        locationParts={locationParts}
                        styles={styles}
                        mapActive={showJobModal && !jobSubModalOpen}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}
      </PortalModal>

      <SchedulerJobStatusEditModal
        show={showStatusEditModal}
        onHide={handleCloseStatusEditModal}
        selectedJob={selectedJob}
        jobStatuses={jobStatuses}
        onSave={handleUpdateStatus}
        isSaving={isUpdatingStatus}
        selectStyles={REASSIGN_TECHNICIAN_SELECT_STYLES}
      />

      <SchedulerJobScheduleEditModal
        show={showScheduleEditModal}
        onHide={handleCloseScheduleEditModal}
        selectedJob={selectedJob}
        onSave={handleUpdateSchedule}
        isSaving={isUpdatingSchedule}
      />

      <PortalModal
        show={showReassignModal && !!selectedJob}
        onHide={handleCloseReassignModal}
        title="Reassign technician"
        subtitle={
          selectedJob?.jobNumber ? (
            <span>
              Job {selectedJob.jobNumber}
              {selectedJob.title ? ` · ${selectedJob.title}` : ""}
            </span>
          ) : null
        }
        size="md"
        bodyClassName="portal-form-body"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={handleCloseReassignModal}
              disabled={isReassigning}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleReassign}
              disabled={!selectedNewTechnician || isReassigning}
            >
              {isReassigning ? "Reassigning…" : "Confirm reassignment"}
            </Button>
          </>
        }
      >
        {selectedJob ? (
          <div className={styles.reassignModalBody}>
            {(() => {
              const before = getAssignedTechnicianNames(selectedJob, resources, events);
              const replacing = getReplacingTechnicianName(selectedJob, resources);
              const replacingDisplay = replacing || before[0] || "";
              const afterName =
                selectedNewTechnician?.text ||
                selectedNewTechnician?.name ||
                selectedNewTechnician?.full_name ||
                selectedNewTechnician?.fullName ||
                "";

              return (
                <div className={styles.reassignPreviewCard}>
                  <div className={styles.reassignPreviewTitle}>Assignment preview</div>
                  <div className={styles.reassignPreviewRows}>
                    <div className={styles.reassignPreviewRow}>
                      <div className={styles.reassignPreviewLabel}>Before</div>
                      <div className={styles.reassignPreviewValue}>
                        {before.length ? (
                          <div className={styles.jobDetailHeroAssignedPills}>
                            {before.map((name) => (
                              <span
                                key={`before-${name}`}
                                className={`${styles.jobDetailHeroAssignedPill} ${
                                  replacingDisplay && name === replacingDisplay
                                    ? styles.reassignPreviewReplacingPill
                                    : ""
                                }`}
                                title={name}
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className={styles.reassignPreviewEmpty}>Unassigned</span>
                        )}
                      </div>
                    </div>

                    <div className={styles.reassignPreviewDivider} aria-hidden>
                      →
                    </div>

                    <div className={styles.reassignPreviewRow}>
                      <div className={styles.reassignPreviewLabel}>After</div>
                      <div className={styles.reassignPreviewValue}>
                        {afterName ? (
                          <div className={styles.reassignAfterStack}>
                            <div className={styles.jobDetailHeroAssignedPills}>
                              <span
                                className={`${styles.jobDetailHeroAssignedPill} ${styles.reassignPreviewAfterPill}`}
                                title={afterName}
                              >
                                {afterName}
                              </span>
                            </div>
                            {replacingDisplay ? (
                              <div className={styles.reassignReplacingInline}>
                                <span className={styles.reassignReplacingInlineLabel}>
                                  Replacing
                                </span>
                                <span
                                  className={`${styles.jobDetailHeroAssignedPill} ${styles.reassignPreviewReplacingPill}`}
                                  title={replacingDisplay}
                                >
                                  {replacingDisplay}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className={styles.reassignPreviewHint}>
                            Select a technician to preview
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <label className="form-label" htmlFor="reassign-tech-select">
              Select new technician
            </label>
            <Select
              inputId="reassign-tech-select"
              instanceId="reassign-tech-select"
              options={reassignTechnicianOptions}
              value={selectedReassignOption}
              onChange={(option) => {
                const tech = resources.find((r) => r.id === option?.value);
                setSelectedNewTechnician(tech || null);
              }}
              isDisabled={isReassigning}
              isClearable
              isSearchable
              placeholder="Search or choose a technician…"
              noOptionsMessage={() => "No technicians found"}
              styles={REASSIGN_TECHNICIAN_SELECT_STYLES}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              menuPlacement="auto"
            />
            {reassignAvailability?.labels?.length > 0 ? (
              <div className={styles.jobDetailReassignAlert} role="alert">
                {reassignAvailability.labels.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                <div className={styles.jobDetailReassignAlertFoot}>
                  <SchedulerAvailabilityHelpLinks
                    availability={reassignAvailability}
                    technician={selectedNewTechnician}
                    dateLike={selectedJob.start}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </PortalModal>

      {/* Color Picker Modal */}
      {showColorPicker && (
        <Modal show={showColorPicker} onHide={handleCloseColorPicker} centered>
        <Modal.Header closeButton>
          <Modal.Title>Change Worker Color</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedTechnicianForColor && (
            <div>
              <p className="mb-3">
                Select a color for <strong>{selectedTechnicianForColor.text || selectedTechnicianForColor.name}</strong>
              </p>
              
              {/* Predefined Colors */}
              <div className={styles.colorPickerGrid}>
                {TECHNICIAN_COLORS.map((color) => (
                  <div
                    key={color}
                    className={`${styles.colorOption} ${selectedColor === color ? styles.colorOptionSelected : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                    title={color}
                  />
                ))}
              </div>

              {/* Custom Color Input */}
              <div className={styles.customColorSection}>
                <label className={styles.customColorLabel}>Custom Color:</label>
                <div className={styles.customColorInputWrapper}>
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(e) => setSelectedColor(e.target.value)}
                    className={styles.colorInput}
                  />
                  <input
                    type="text"
                    value={selectedColor}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (/^#[0-9A-F]{6}$/i.test(value) || value === '') {
                        setSelectedColor(value);
                      }
                    }}
                    className={styles.colorTextInput}
                    placeholder="#667eea"
                    maxLength={7}
                  />
                </div>
              </div>

              {/* Preview */}
              <div className={styles.colorPreview}>
                <div 
                  className={styles.colorPreviewAvatar}
                  style={{ backgroundColor: selectedColor }}
                >
                  {selectedTechnicianForColor.text?.substring(0, 2).toUpperCase() || 'T'}
                </div>
                <span className={styles.colorPreviewText}>Preview</span>
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseColorPicker} disabled={isUpdatingColor}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleColorUpdate} disabled={isUpdatingColor}>
            {isUpdatingColor ? 'Saving...' : 'Save Color'}
          </Button>
        </Modal.Footer>
        </Modal>
      )}
      
      {/* <ToastContainer position="top-right" autoClose={4000} /> */}
    </>
  );
};

export default dynamic(() => Promise.resolve(Scheduler), { ssr: false });

