import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleMap,
  InfoWindow,
  Polyline,
  useLoadScript,
} from "@react-google-maps/api";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import {
  ChevronUp,
  GeoAlt,
  InfoCircle,
  LightningChargeFill,
  Search,
  Sliders,
  XLg,
} from "react-bootstrap-icons";
import { Button, Form, Modal } from "react-bootstrap";
import toast from "react-hot-toast";
import { useLiveTrackingQuery } from "../../../../hooks/queries/useLiveTrackingQuery";
import { useJobStatusesQuery } from "../../../../hooks/queries/useJobStatusesQuery";
import {
  getTechnicianStatusColor,
  getTechnicianStatusLabel,
} from "../../../../lib/scheduler/technicianSchedulerUtils";
import { getGoogleMapsScriptLibraries } from "../../../../lib/googleMapsScriptLibraries";
import {
  findJobStatusEntry,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
} from "../../../../utils/jobStatusDefaults";
import LiveTrackingAdvancedMarkers, {
  LIVE_TRACKING_STOP_PIN_SIZE_PX,
  LiveTrackingVehicleLegendIcon,
} from "./LiveTrackingAdvancedMarkers";

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

/** Bump suffix (e.g. v2) to show the beta welcome again after changing the announcement. */
const LIVE_TRACKING_BETA_MODAL_STORAGE_KEY =
  "sas_fsm_live_tracking_beta_welcome_v1";

const LIVE_TRACKING_LEGEND_HIDDEN_KEY = "sas_fsm_live_tracking_legend_hidden";

/** Light dashboard chrome (map uses default roadmap styling). */
const LT = {
  pageBg: "#f1f5f9",
  surface: "#ffffff",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  headerBg: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  sidebarSelected: "rgba(65, 113, 245, 0.14)",
  timelineTrack: "#eef2f7",
  timelineGrid: "rgba(15, 23, 42, 0.1)",
  driverCardBg: "rgba(255, 255, 255, 0.97)",
  driverCardBorder: "rgba(15, 23, 42, 0.12)",
  barTrack: "#e2e8f0",
};

const ROUTE_COLORS = ["#16a34a", "#2563eb", "#ea580c", "#9333ea"];

/** Extra px above the stop pin so the InfoWindow tail clears the disk. */
const LIVE_MAP_INFOWINDOW_PIN_CLEARANCE_PX = 4;
/** Map zoom when focusing a single job from the list or marker. */
const LIVE_TRACKING_JOB_FOCUS_ZOOM = 15;

/** @param {unknown} path */
function normalizeRoutesPath(path) {
  if (!path?.length) return [];
  return path
    .map((p) => {
      if (p == null) return null;
      const lat = typeof p.lat === "function" ? p.lat() : p.lat;
      const lng = typeof p.lng === "function" ? p.lng() : p.lng;
      if (typeof lat !== "number" || typeof lng !== "number") return null;
      return { lat, lng };
    })
    .filter(Boolean);
}

function buildDemoDataset() {
  const drivers = [
    {
      id: "d1",
      name: "Bryan Erickson",
      vehicle: "Ford Transit",
    },
    {
      id: "d2",
      name: "Luis Walker",
      vehicle: "Renault Kangoo",
    },
    {
      id: "d3",
      name: "Andy Thorne",
      vehicle: "Mercedes Sprinter",
    },
  ];

  const stops = [
    {
      id: "s1",
      jobRef: "TOAYM2UC",
      customer: "Northwind Logistics",
      address: "Shoreditch, London",
      status: "Created",
      jobStatus: "PENDING",
      assignmentStatus: "ASSIGNED",
      windowStart: "09:45",
      windowEnd: "12:00",
      lat: 51.5231,
      lng: -0.087,
      driverId: "d1",
      seq: 0,
    },
    {
      id: "s2",
      jobRef: "ON12345",
      customer: "John Smith",
      address: "Bethnal Green, London",
      status: "En route",
      jobStatus: "IN_PROGRESS",
      assignmentStatus: "STARTED",
      windowStart: "10:15",
      windowEnd: "11:30",
      lat: 51.527,
      lng: -0.055,
      driverId: "d1",
      seq: 1,
    },
    {
      id: "s3",
      jobRef: "LDN7781",
      customer: "Canary Wharf HVAC",
      address: "Canary Wharf, London",
      status: "Created",
      jobStatus: "UPCOMING",
      assignmentStatus: "ASSIGNED",
      windowStart: "13:00",
      windowEnd: "15:30",
      lat: 51.5055,
      lng: -0.0235,
      driverId: "d1",
      seq: 2,
    },
    {
      id: "s4",
      jobRef: "UX12A9Q",
      customer: "Westminster Care",
      address: "Westminster, London",
      status: "Created",
      jobStatus: "WAITING",
      assignmentStatus: "ASSIGNED",
      windowStart: "08:30",
      windowEnd: "10:00",
      lat: 51.4995,
      lng: -0.1248,
      driverId: "d2",
      seq: 0,
    },
    {
      id: "s5",
      jobRef: "CAM4410",
      customer: "Camden Retail Group",
      address: "Camden, London",
      status: "Delayed",
      jobStatus: "OVERDUE",
      assignmentStatus: "STARTED",
      windowStart: "11:00",
      windowEnd: "12:45",
      lat: 51.5416,
      lng: -0.1437,
      driverId: "d2",
      seq: 1,
    },
    {
      id: "s6",
      jobRef: "THM8820",
      customer: "Thames Maintenance",
      address: "London Bridge",
      status: "Created",
      jobStatus: "PENDING",
      assignmentStatus: "ASSIGNED",
      windowStart: "14:20",
      windowEnd: "16:00",
      lat: 51.5055,
      lng: -0.0865,
      driverId: "d3",
      seq: 0,
    },
    {
      id: "s7",
      jobRef: "CLY5599",
      customer: "Clyde Facilities",
      address: "Clapham, London",
      status: "Created",
      jobStatus: "PENDING",
      assignmentStatus: "ASSIGNED",
      windowStart: "15:10",
      windowEnd: "17:00",
      lat: 51.4578,
      lng: -0.1655,
      driverId: "d3",
      seq: 1,
    },
  ];

  return { drivers, stops };
}

function hexToRgb(hex) {
  if (hex == null) return null;
  let h = String(hex).trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Tinted pill from Dashboard → Settings → Job Statuses color. */
function pillThemeFromSettingsHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const bg = `rgba(${r},${g},${b},${lum > 0.7 ? 0.12 : 0.18})`;
  const border = `rgba(${r},${g},${b},${lum > 0.75 ? 0.28 : 0.42})`;
  const color =
    lum > 0.72
      ? `rgb(${Math.round(r * 0.52)},${Math.round(g * 0.52)},${Math.round(
          b * 0.52
        )})`
      : `rgb(${r},${g},${b})`;
  return { bg, color, border };
}

function stopMatchesJobStatusFilter(stop, filterVal, statusList) {
  if (filterVal === "all") return true;
  const fv = String(filterVal).trim();
  const entry = findJobStatusEntry(stop.jobStatus, statusList);
  if (entry && String(entry.value ?? "").trim() === fv) return true;
  return String(stop.jobStatus ?? "").trim() === fv;
}

/** @returns {{ bg: string, color: string, border: string }} */
function getJobStatusPillTheme(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "_").trim();
  if (!s || s === "—")
    return { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0" };
  if (s === "IN_PROGRESS")
    return { bg: "#d1fae5", color: "#047857", border: "rgba(4, 120, 87, 0.28)" };
  if (s === "OVERDUE")
    return { bg: "#ffedd5", color: "#c2410c", border: "rgba(194, 65, 12, 0.28)" };
  if (s === "COMPLETED")
    return { bg: "#e0e7ff", color: "#4338ca", border: "rgba(67, 56, 202, 0.25)" };
  if (s === "CANCELLED")
    return { bg: "#fee2e2", color: "#b91c1c", border: "rgba(185, 28, 28, 0.25)" };
  if (s === "WAITING")
    return { bg: "#fef9c3", color: "#a16207", border: "rgba(161, 98, 7, 0.28)" };
  if (s === "PENDING" || s === "UPCOMING")
    return { bg: "#e0f2fe", color: "#0369a1", border: "rgba(3, 105, 161, 0.25)" };
  return { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" };
}

/** @returns {{ bg: string, color: string, border: string }} */
function getAssignmentStatusPillTheme(raw) {
  const s = String(raw || "").toUpperCase().replace(/\s+/g, "_").trim();
  if (!s || s === "—")
    return { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0" };
  if (s === "STARTED")
    return { bg: "#dcfce7", color: "#166534", border: "rgba(22, 101, 52, 0.3)" };
  if (s === "ASSIGNED")
    return { bg: "#dbeafe", color: "#1d4ed8", border: "rgba(29, 78, 216, 0.28)" };
  if (s === "COMPLETED")
    return { bg: "#e0e7ff", color: "#4338ca", border: "rgba(67, 56, 202, 0.25)" };
  if (s === "CANCELLED")
    return { bg: "#fee2e2", color: "#b91c1c", border: "rgba(185, 28, 28, 0.25)" };
  return { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0" };
}

function LiveStatusPill({ raw, kind, compact, statusList = [] }) {
  const empty =
    raw == null || String(raw).trim() === "" || String(raw).trim() === "—";
  const label = empty
    ? "—"
    : kind === "job"
      ? getJobStatusLabelFromList(raw, statusList)
      : findJobStatusEntry(raw, statusList)?.name ||
        getTechnicianStatusLabel(raw);

  const hex = empty
    ? null
    : kind === "job"
      ? getJobStatusColorFromList(raw, statusList)
      : getJobStatusColorFromList(raw, statusList) || getTechnicianStatusColor(raw);

  const t =
    (hex ? pillThemeFromSettingsHex(hex) : null) ||
    (kind === "job"
      ? getJobStatusPillTheme(raw)
      : getAssignmentStatusPillTheme(raw));

  return (
    <span
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        padding: compact ? "2px 8px" : "4px 11px",
        borderRadius: 999,
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        lineHeight: 1.25,
        maxWidth: compact ? 120 : 200,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
      }}
    >
      {label}
    </span>
  );
}

function timeToMinutes(hhmm, dayStartHour = 6) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h - dayStartHour) * 60 + m;
}

function formatEta(baseDate, minutesFromStart, dayStartHour = 6) {
  const d = new Date(baseDate);
  d.setHours(dayStartHour, 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutesFromStart);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reorderStopsByWaypointOrder(stops, waypointOrder) {
  if (!waypointOrder?.length) return stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const middle = stops.slice(1, -1);
  const reord = waypointOrder.map((i) => middle[i]);
  return [first, ...reord, last];
}

function pointAlongPath(path, t) {
  if (!path?.length) return null;
  if (path.length === 1) return path[0];
  const clamped = Math.min(1, Math.max(0, t));
  const total = path.length - 1;
  const f = clamped * total;
  const i = Math.floor(f);
  const frac = f - i;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lng + (b.lng - a.lng) * frac,
  };
}

export default function LiveTrackingDashboard() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey || "",
    libraries: getGoogleMapsScriptLibraries(),
  });

  const [drivers, setDrivers] = useState([]);
  const [stops, setStops] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [loadNotice, setLoadNotice] = useState(null);
  const [skippedNoCoords, setSkippedNoCoords] = useState(0);
  const [lastOptimizedAt, setLastOptimizedAt] = useState(null);
  const [routePaths, setRoutePaths] = useState({});
  const [routeMeta, setRouteMeta] = useState({});
  const [reoptimizeBusy, setReoptimizeBusy] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState(null);
  const [selectedVehicleDriverId, setSelectedVehicleDriverId] = useState(null);
  const [legendHidden, setLegendHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(LIVE_TRACKING_LEGEND_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [mapDate, setMapDate] = useState(() => new Date());
  const [driverTrackProgress, setDriverTrackProgress] = useState({});
  const { data: jobStatusesData = getDefaultJobStatuses() } = useJobStatusesQuery();
  const {
    data: trackingSnapshot,
    isLoading: trackingQueryLoading,
    isFetching: trackingQueryFetching,
    isPreviousData: trackingPreviousData,
  } = useLiveTrackingQuery(mapDate);
  const [showBetaWelcomeModal, setShowBetaWelcomeModal] = useState(false);
  const [betaModalDontShowAgain, setBetaModalDontShowAgain] = useState(false);

  const skipAutoRoutingRef = useRef(false);
  /** InfoWindow fires `close` (not `closeclick`) when dismissed by map click; keep selection in sync. */
  const liveStopInfoCloseListenerRef = useRef(null);
  const liveTrackingMapRef = useRef(null);

  const jobStatuses = jobStatusesData;

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (!window.localStorage.getItem(LIVE_TRACKING_BETA_MODAL_STORAGE_KEY)) {
        setShowBetaWelcomeModal(true);
      }
    } catch {
      setShowBetaWelcomeModal(true);
    }
  }, []);

  useEffect(() => {
    if (statusFilter === "all") return;
    const ok = jobStatuses.some(
      (s) => String(s.value ?? "").trim() === String(statusFilter).trim()
    );
    if (!ok) setStatusFilter("all");
  }, [jobStatuses, statusFilter]);

  useEffect(() => {
    if (
      trackingQueryLoading ||
      (trackingQueryFetching && trackingPreviousData)
    ) {
      setLoadState("loading");
      setLoadNotice(null);
      return;
    }

    if (!trackingSnapshot || trackingPreviousData) {
      return;
    }

    const snap = trackingSnapshot;
    setSkippedNoCoords(0);

    if (!snap.ok && snap.error === "NO_CLIENT") {
      const demo = buildDemoDataset();
      setDrivers(demo.drivers);
      setStops(demo.stops);
      setSelectedStopId(null);
      setSelectedVehicleDriverId(null);
      setLoadState("demo");
      setLoadNotice(
        "Supabase is not configured in the browser (NEXT_PUBLIC_SUPABASE_*). Showing demo data."
      );
      return;
    }

    if (!snap.ok) {
      toast.error(snap.message || snap.error || "Failed to load jobs");
      const demo = buildDemoDataset();
      setDrivers(demo.drivers);
      setStops(demo.stops);
      setSelectedStopId(null);
      setSelectedVehicleDriverId(null);
      setLoadState("demo");
      setLoadNotice("Could not load live jobs; showing demo data.");
      return;
    }

    setDrivers(snap.drivers);
    setStops(snap.stops);
    setSelectedStopId(null);
    setSelectedVehicleDriverId(null);
    setLoadState("ok");
    setLoadNotice(null);
    setSkippedNoCoords(snap.skippedNoCoords || 0);

    if (snap.skippedNoCoords > 0) {
      toast(
        `${snap.skippedNoCoords} job(s) skipped — add coordinates on the linked location.`,
        { duration: 5500 }
      );
    }
    if (snap.stops.length === 0) {
      toast("No assigned jobs with a time window on this day.", {
        duration: 4500,
      });
    }
  }, [
    trackingSnapshot,
    trackingQueryLoading,
    trackingQueryFetching,
    trackingPreviousData,
  ]);

  useEffect(() => {
    setDriverTrackProgress((prev) => {
      const next = { ...prev };
      drivers.forEach((d) => {
        if (next[d.id] == null) next[d.id] = 0.18 + Math.random() * 0.12;
      });
      Object.keys(next).forEach((k) => {
        if (!drivers.some((dd) => dd.id === k)) delete next[k];
      });
      return next;
    });
  }, [drivers]);

  useEffect(() => {
    const id = setInterval(() => {
      setDriverTrackProgress((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          next[k] = (next[k] + 0.004) % 1;
        });
        return next;
      });
    }, 8000);
    return () => clearInterval(id);
  }, []);

  const stopsByDriver = useMemo(() => {
    const map = {};
    drivers.forEach((d) => {
      map[d.id] = stops
        .filter((s) => s.driverId === d.id)
        .sort((a, b) => a.seq - b.seq);
    });
    return map;
  }, [stops, drivers]);

  const runRoutingWithOptimize = useCallback(
    async (optimizeWaypoints) => {
      if (!isLoaded || typeof window === "undefined" || !window.google?.maps) return;

      const { Route } = await google.maps.importLibrary("routes");

      const paths = {};
      const meta = {};
      const newStopsByDriver = { ...stopsByDriver };
      let hadError = false;

      await Promise.all(
        drivers.map(async (driver, idx) => {
          const ordered = [...stopsByDriver[driver.id]];
          if (ordered.length === 0) return;

          if (ordered.length === 1) {
            paths[driver.id] = [{ lat: ordered[0].lat, lng: ordered[0].lng }];
            meta[driver.id] = {
              meters: 0,
              seconds: 0,
              legs: 0,
              color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
            };
            return;
          }

          const origin = ordered[0];
          const destination = ordered[ordered.length - 1];
          const middle = ordered.slice(1, -1);

          const fields = ["path", "distanceMeters", "durationMillis", "legs"];
          if (optimizeWaypoints && middle.length > 0) {
            fields.push("optimizedIntermediateWaypointIndices");
          }

          const request = {
            origin: { lat: origin.lat, lng: origin.lng },
            destination: { lat: destination.lat, lng: destination.lng },
            travelMode: "DRIVING",
            fields,
          };
          if (middle.length > 0) {
            request.intermediates = middle.map((s) => ({
              lat: s.lat,
              lng: s.lng,
            }));
          }
          if (optimizeWaypoints && middle.length > 0) {
            request.optimizeWaypointOrder = true;
          }

          try {
            const { routes } = await Route.computeRoutes(request);
            if (!routes?.length) throw new Error("NO_ROUTES");

            const route = routes[0];
            const path = normalizeRoutesPath(route.path);
            if (!path.length) throw new Error("NO_PATH");

            paths[driver.id] = path;

            const meters = route.distanceMeters ?? 0;
            const seconds = Math.round((route.durationMillis ?? 0) / 1000);
            const legs = Array.isArray(route.legs)
              ? route.legs.length
              : Math.max(0, ordered.length - 1);

            meta[driver.id] = {
              meters,
              seconds,
              legs,
              color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
            };

            if (optimizeWaypoints && middle.length > 0) {
              const order = route.optimizedIntermediateWaypointIndices || [];
              const reordered = reorderStopsByWaypointOrder(ordered, order);
              newStopsByDriver[driver.id] = reordered.map((s, i) => ({
                ...s,
                seq: i,
              }));
            }
          } catch (e) {
            hadError = true;
            console.warn("[live-tracking] Route.computeRoutes failed", driver.id, e);
            const fallback = ordered.map((s) => ({ lat: s.lat, lng: s.lng }));
            paths[driver.id] = fallback;
            meta[driver.id] = {
              meters: 0,
              seconds: 0,
              legs: ordered.length - 1,
              color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
              approx: true,
            };
          }
        })
      );

      if (optimizeWaypoints) {
        const merged = [];
        drivers.forEach((d) => {
          merged.push(...(newStopsByDriver[d.id] || []));
        });
        skipAutoRoutingRef.current = true;
        setStops(merged);
        setLastOptimizedAt(new Date());
      }

      setRoutePaths(paths);
      setRouteMeta(meta);
      if (hadError) {
        toast.error(
          "Some routes failed to resolve; showing straight-line fallback for those drivers."
        );
      }
    },
    [isLoaded, drivers, stopsByDriver]
  );

  useEffect(() => {
    if (!isLoaded) return;
    if (skipAutoRoutingRef.current) {
      skipAutoRoutingRef.current = false;
      return;
    }
    void runRoutingWithOptimize(false);
  }, [isLoaded, mapDate, runRoutingWithOptimize]);

  const mapCenter = useMemo(() => {
    if (!stops.length) return { lat: 51.5074, lng: -0.08 };
    const lat = stops.reduce((acc, s) => acc + s.lat, 0) / stops.length;
    const lng = stops.reduce((acc, s) => acc + s.lng, 0) / stops.length;
    return { lat, lng };
  }, [stops]);

  const stopMarkerData = useMemo(
    () =>
      stops.map((s, i) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        driverId: s.driverId,
        label: String(i + 1),
        tooltip: s.jobRef ? { title: s.jobRef } : undefined,
      })),
    [stops]
  );

  const vehicleMarkerData = useMemo(() => {
    const out = [];
    drivers.forEach((driver, idx) => {
      const path = routePaths[driver.id];
      if (!path?.length) return;
      const pos = pointAlongPath(path, driverTrackProgress[driver.id] || 0);
      if (!pos) return;
      const color =
        routeMeta[driver.id]?.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
      const initial = String(driver.name || "")
        .trim()
        .charAt(0)
        .toUpperCase();
      const vehicle = String(driver.vehicle || "").trim();
      out.push({
        id: driver.id,
        position: pos,
        color,
        label: initial || String(idx + 1),
        tooltip: {
          crewName:
            String(driver.name || "").trim() || `Crew ${idx + 1}`,
          vehicle: vehicle && vehicle !== "—" ? vehicle : null,
          subtitle: "Simulated along route",
        },
      });
    });
    return out;
  }, [drivers, routePaths, driverTrackProgress, routeMeta]);

  const filteredStops = useMemo(() => {
    return stops.filter((s) => {
      if (teamFilter !== "all" && s.driverId !== teamFilter) return false;
      if (!stopMatchesJobStatusFilter(s, statusFilter, jobStatuses)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const statusLabel = getJobStatusLabelFromList(s.jobStatus, jobStatuses);
        const blob =
          `${s.jobRef} ${s.customer} ${s.address} ${statusLabel} ${s.jobStatus}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [stops, teamFilter, statusFilter, search, jobStatuses]);

  const selectedStop = useMemo(
    () => stops.find((s) => s.id === selectedStopId) || null,
    [stops, selectedStopId]
  );

  /** Driver row for the map overlay — only meaningful when a job (`selectedStop`) is selected. */
  const mapDriverForCard = useMemo(() => {
    if (!selectedStop) return null;
    return drivers.find((d) => d.id === selectedStop.driverId) ?? null;
  }, [selectedStop, drivers]);

  const mapVehicleDriverForCard = useMemo(() => {
    if (!selectedVehicleDriverId) return null;
    return drivers.find((d) => d.id === selectedVehicleDriverId) ?? null;
  }, [selectedVehicleDriverId, drivers]);

  const hasMapDriverCard = Boolean(
    (selectedStop && mapDriverForCard) || mapVehicleDriverForCard
  );

  const mapLegendBottomOffset = hasMapDriverCard ? 200 : 16;
  const mapOverlayBottomOffset = legendHidden ? 16 : mapLegendBottomOffset;

  const totals = useMemo(() => {
    let meters = 0;
    let seconds = 0;
    Object.values(routeMeta).forEach((m) => {
      meters += m.meters || 0;
      seconds += m.seconds || 0;
    });
    const km = (meters / 1000).toFixed(2);
    const h = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    const dur = `${h}h${String(min).padStart(2, "0")}`;
    return { km, dur, routes: Object.keys(routePaths).length };
  }, [routeMeta, routePaths]);

  const dismissBetaWelcomeModal = useCallback(() => {
    try {
      if (betaModalDontShowAgain && typeof window !== "undefined") {
        window.localStorage.setItem(LIVE_TRACKING_BETA_MODAL_STORAGE_KEY, "1");
      }
    } catch {
      /* ignore quota / private mode */
    }
    setShowBetaWelcomeModal(false);
  }, [betaModalDontShowAgain]);

  const clearLiveStopInfoCloseListener = useCallback(() => {
    const evt = typeof window !== "undefined" ? window.google?.maps?.event : null;
    if (liveStopInfoCloseListenerRef.current != null && evt) {
      evt.removeListener(liveStopInfoCloseListenerRef.current);
      liveStopInfoCloseListenerRef.current = null;
    }
  }, []);

  const clearLiveTrackingJobMapSelection = useCallback(() => {
    setSelectedStopId(null);
  }, []);

  const handleVehicleMarkerClick = useCallback((driverId) => {
    setSelectedVehicleDriverId(driverId);
    setSelectedStopId(null);
  }, []);

  const toggleLegendHidden = useCallback(() => {
    setLegendHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          LIVE_TRACKING_LEGEND_HIDDEN_KEY,
          next ? "1" : "0"
        );
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const onLiveStopInfoWindowLoad = useCallback(
    (iw) => {
      clearLiveStopInfoCloseListener();
      if (typeof window === "undefined" || !window.google?.maps?.event) return;
      liveStopInfoCloseListenerRef.current = window.google.maps.event.addListener(
        iw,
        "close",
        clearLiveTrackingJobMapSelection
      );
    },
    [clearLiveStopInfoCloseListener, clearLiveTrackingJobMapSelection]
  );

  const onLiveStopInfoWindowUnmount = useCallback(() => {
    clearLiveStopInfoCloseListener();
  }, [clearLiveStopInfoCloseListener]);

  const onLiveTrackingMapLoad = useCallback((map) => {
    liveTrackingMapRef.current = map;
  }, []);

  const onLiveTrackingMapUnmount = useCallback(() => {
    liveTrackingMapRef.current = null;
  }, []);

  const focusMapOnStop = useCallback((stop) => {
    if (
      !stop ||
      typeof stop.lat !== "number" ||
      typeof stop.lng !== "number" ||
      !Number.isFinite(stop.lat) ||
      !Number.isFinite(stop.lng)
    ) {
      return;
    }
    const map = liveTrackingMapRef.current;
    if (!map) return;
    map.panTo({ lat: stop.lat, lng: stop.lng });
    map.setZoom(LIVE_TRACKING_JOB_FOCUS_ZOOM);
  }, []);

  const handleReoptimize = () => {
    setReoptimizeBusy(true);
    const p = runRoutingWithOptimize(true);
    toast.promise(p, {
      loading: "Re-optimizing stop order and routes…",
      success: "Routes updated. Dispatch board and map are in sync.",
      error: "Could not complete optimization.",
    });
    void p.finally(() => setReoptimizeBusy(false));
  };

  const TIMELINE_START = 6;
  const TIMELINE_END = 22;
  const TIMELINE_MINUTES = (TIMELINE_END - TIMELINE_START) * 60;

  if (loadError) {
    return (
      <div className="p-4 text-danger">
        Could not load Google Maps. Check{" "}
        <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>.
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className="p-4 text-warning">
        Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in{" "}
        <code>.env</code> to enable the live map.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        minHeight: "calc(100vh - 200px)",
        background: LT.pageBg,
        color: LT.text,
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${LT.border}`,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: LT.headerBg,
          borderBottom: `1px solid ${LT.border}`,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, marginRight: 8, color: LT.text }}>
          Live job tracking
        </div>
        {loadNotice && (
          <span
            className="small"
            style={{ color: "#b45309", maxWidth: 480, lineHeight: 1.35 }}
          >
            {loadNotice}
          </span>
        )}
        {loadState === "loading" && (
          <span className="small" style={{ color: LT.muted }}>
            Loading jobs…
          </span>
        )}
        {lastOptimizedAt && (
          <span className="small" style={{ color: LT.muted }}>
            Last re-optimize: {lastOptimizedAt.toLocaleTimeString()}
          </span>
        )}
        <div
          className="d-flex align-items-center gap-2"
          style={{ minWidth: 200 }}
        >
          <span className="small" style={{ color: LT.muted }}>Day</span>
          <Flatpickr
            value={mapDate}
            options={{
              dateFormat: "Y-m-d",
              allowInput: false,
            }}
            onChange={(dates) => {
              if (dates[0]) setMapDate(dates[0]);
            }}
            className="form-control form-control-sm"
            style={{
              maxWidth: 160,
              background: LT.surface,
              color: LT.text,
              border: `1px solid ${LT.border}`,
            }}
          />
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="small" style={{ color: LT.muted }}>Team</span>
          <select
            className="form-select form-select-sm"
            style={{
              width: 180,
              background: LT.surface,
              color: LT.text,
              border: `1px solid ${LT.border}`,
            }}
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="all">All crews</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ms-auto d-flex align-items-center gap-2 small" style={{ color: LT.muted }}>
          <GeoAlt size={14} />
          <span>
            {loadState === "loading"
              ? "Loading jobs…"
              : loadState === "ok"
                ? "Job list and routes. Map dots move for illustration until a GPS feed is connected."
                : "Simulated live positions refresh periodically — connect your own GPS feed to replace demo motion."}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 520 }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 320,
            maxWidth: "100%",
            borderRight: `1px solid ${LT.border}`,
            display: "flex",
            flexDirection: "column",
            background: LT.surface,
          }}
        >
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="position-relative">
              <Search
                size={14}
                className="position-absolute"
                style={{ left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.45 }}
              />
              <input
                className="form-control form-control-sm"
                placeholder="Search jobs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  paddingLeft: 32,
                  background: LT.surface,
                  color: LT.text,
                  border: `1px solid ${LT.border}`,
                }}
              />
            </div>
            <div className="d-flex gap-2">
              <select
                className="form-select form-select-sm"
                style={{
                  flex: 1,
                  background: LT.surface,
                  color: LT.text,
                  border: `1px solid ${LT.border}`,
                }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All statuses</option>
                {jobStatuses.map((st) => {
                  const v = String(st.value ?? "").trim();
                  if (!v) return null;
                  return (
                    <option key={v} value={v}>
                      {st.name || v}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filteredStops.length === 0 ? (
              <div className="p-3 text-secondary small">No jobs match filters.</div>
            ) : (
              filteredStops.map((s) => {
                const jobHex = getJobStatusColorFromList(s.jobStatus, jobStatuses);
                const b =
                  pillThemeFromSettingsHex(jobHex) || getJobStatusPillTheme(s.jobStatus);
                const statusLabel = getJobStatusLabelFromList(s.jobStatus, jobStatuses);
                return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => {
                    setSelectedVehicleDriverId(null);
                    setSelectedStopId(s.id);
                    focusMapOnStop(s);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    borderBottom: `1px solid ${LT.border}`,
                    background:
                      s.id === selectedStopId
                        ? LT.sidebarSelected
                        : "transparent",
                    color: LT.text,
                    cursor: "pointer",
                  }}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div style={{ fontWeight: 600 }}>{s.jobRef}</div>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: b.bg,
                        color: b.color,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="small text-muted" style={{ marginTop: 4 }}>
                    {s.customer}
                  </div>
                  <div className="small text-muted" style={{ marginTop: 2 }}>
                    {s.windowStart} – {s.windowEnd}
                  </div>
                </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Map */}
        <div style={{ flex: 1, position: "relative", minHeight: 400 }}>
          {!isLoaded ? (
            <div
              className="d-flex align-items-center justify-content-center h-100 text-secondary"
              style={{ background: LT.timelineTrack }}
            >
              Loading map…
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={mapCenter}
              zoom={11}
              onLoad={onLiveTrackingMapLoad}
              onUnmount={onLiveTrackingMapUnmount}
              options={{
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: false,
                mapId:
                  process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ||
                  process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ||
                  "DEMO_MAP_ID",
              }}
            >
              {drivers.map((driver, idx) => {
                const path = routePaths[driver.id];
                if (!path?.length) return null;
                const color =
                  routeMeta[driver.id]?.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
                return (
                  <Polyline
                    key={driver.id}
                    path={path}
                    options={{
                      strokeColor: color,
                      strokeOpacity: 0.95,
                      strokeWeight: 5,
                    }}
                  />
                );
              })}

              <LiveTrackingAdvancedMarkers
                stopMarkers={stopMarkerData}
                selectedStopId={selectedStopId}
                onStopMarkerClick={({ id }) => {
                  setSelectedVehicleDriverId(null);
                  setSelectedStopId(id);
                  const st = stops.find((x) => x.id === id);
                  if (st) focusMapOnStop(st);
                }}
                vehicleMarkers={vehicleMarkerData}
                onVehicleClick={handleVehicleMarkerClick}
              />

              {selectedStop &&
                typeof window !== "undefined" &&
                window.google?.maps?.Size && (
                <InfoWindow
                  key={selectedStop.id}
                  position={{
                    lat: selectedStop.lat,
                    lng: selectedStop.lng,
                  }}
                  onCloseClick={clearLiveTrackingJobMapSelection}
                  onLoad={onLiveStopInfoWindowLoad}
                  onUnmount={onLiveStopInfoWindowUnmount}
                  options={{
                    maxWidth: 280,
                    /** Custom header row (title + close) so they align; removes default header chrome. */
                    headerDisabled: true,
                    pixelOffset: new window.google.maps.Size(
                      0,
                      -(
                        LIVE_TRACKING_STOP_PIN_SIZE_PX +
                        LIVE_MAP_INFOWINDOW_PIN_CLEARANCE_PX
                      )
                    ),
                    disableAutoPan: false,
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      minWidth: 200,
                      maxWidth: 260,
                      padding: "2px 8px 10px",
                      margin: 0,
                      color: "#1a2438",
                      fontFamily:
                        'system-ui, -apple-system, "Segoe UI", sans-serif',
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        minHeight: 30,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          lineHeight: 1.25,
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {selectedStop.jobRef}
                      </div>
                      <button
                        type="button"
                        aria-label="Close"
                        onClick={clearLiveTrackingJobMapSelection}
                        style={{
                          flexShrink: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 30,
                          height: 30,
                          margin: 0,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          color: "#5c6578",
                          cursor: "pointer",
                          borderRadius: 6,
                        }}
                      >
                        <XLg size={18} />
                      </button>
                    </div>
                    <div style={{ fontSize: 14, marginTop: 2 }}>
                      {selectedStop.customer}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6c757d",
                        marginTop: 2,
                      }}
                    >
                      {selectedStop.address}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Window {selectedStop.windowStart} –{" "}
                      {selectedStop.windowEnd}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        flexWrap: "nowrap",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 8,
                      }}
                    >
                      <LiveStatusPill
                        raw={selectedStop.jobStatus}
                        kind="job"
                        compact
                        statusList={jobStatuses}
                      />
                      <LiveStatusPill
                        raw={selectedStop.assignmentStatus}
                        kind="assignment"
                        compact
                        statusList={jobStatuses}
                      />
                    </div>
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      ETA (plan):{" "}
                      {formatEta(
                        mapDate,
                        timeToMinutes(
                          selectedStop.windowStart,
                          TIMELINE_START
                        )
                      )}
                    </div>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          )}

          <button
            type="button"
            className="btn d-flex align-items-center gap-2"
            onClick={handleReoptimize}
            disabled={reoptimizeBusy || !isLoaded}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "linear-gradient(135deg, #4171F5 0%, #3DAAF5 100%)",
              color: "#fff",
              fontWeight: 600,
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              boxShadow: "0 8px 24px rgba(65,113,245,0.35)",
            }}
          >
            <Sliders size={18} />
            Re-optimize
            <LightningChargeFill size={16} />
          </button>

          {isLoaded && legendHidden && skippedNoCoords > 0 && (
            <div
              role="status"
              className="small"
              style={{
                position: "absolute",
                bottom: mapLegendBottomOffset + 44,
                left: 16,
                maxWidth: 320,
                padding: "6px 10px",
                borderRadius: 8,
                background: "rgba(255, 251, 235, 0.97)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
                color: "#b45309",
                lineHeight: 1.4,
                boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
                zIndex: 2,
              }}
            >
              {skippedNoCoords} job(s) hidden — add coordinates on the linked
              customer location.
            </div>
          )}

          {isLoaded && legendHidden && (
            <button
              type="button"
              onClick={toggleLegendHidden}
              aria-label="Show map legend"
              className="d-inline-flex align-items-center gap-2"
              style={{
                position: "absolute",
                bottom: mapLegendBottomOffset,
                left: 16,
                padding: "8px 12px",
                borderRadius: 10,
                border: `1px solid ${LT.driverCardBorder}`,
                background: LT.driverCardBg,
                backdropFilter: "blur(8px)",
                color: LT.text,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                cursor: "pointer",
                zIndex: 2,
              }}
            >
              <InfoCircle size={16} style={{ color: LT.muted }} />
              Legend
            </button>
          )}

          {isLoaded && !legendHidden && (
            <div
              style={{
                position: "absolute",
                bottom: mapOverlayBottomOffset,
                left: 16,
                maxWidth: 280,
                background: LT.driverCardBg,
                backdropFilter: "blur(8px)",
                border: `1px solid ${LT.driverCardBorder}`,
                borderRadius: 12,
                padding: "10px 12px",
                color: LT.text,
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                zIndex: 2,
              }}
            >
              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                <div
                  className="small fw-semibold"
                  style={{ color: LT.text, fontSize: 11, letterSpacing: "0.04em" }}
                >
                  MAP LEGEND
                </div>
                <button
                  type="button"
                  onClick={toggleLegendHidden}
                  aria-label="Hide map legend"
                  className="d-inline-flex align-items-center justify-content-center"
                  style={{
                    flexShrink: 0,
                    width: 26,
                    height: 26,
                    margin: 0,
                    padding: 0,
                    border: `1px solid ${LT.border}`,
                    borderRadius: 6,
                    background: LT.surface,
                    color: LT.muted,
                    cursor: "pointer",
                  }}
                >
                  <ChevronUp size={14} />
                </button>
              </div>
              {loadState === "demo" && loadNotice && (
                <div
                  className="small mb-2"
                  style={{ color: "#b45309", lineHeight: 1.4 }}
                >
                  {loadNotice}
                </div>
              )}
              {loadState === "ok" && (
                <div
                  className="small mb-2"
                  style={{ color: LT.muted, lineHeight: 1.4 }}
                >
                  Crew positions are simulated along planned routes until a GPS
                  feed is connected.
                </div>
              )}
              {skippedNoCoords > 0 && (
                <div
                  className="small mb-2"
                  style={{ color: "#b45309", lineHeight: 1.4 }}
                >
                  {skippedNoCoords} job(s) hidden — add coordinates on the
                  linked customer location.
                </div>
              )}
              <div className="d-flex align-items-center gap-2 small mb-1">
                <span
                  aria-hidden
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "#2563eb",
                    border: "2px solid #fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  1
                </span>
                <span style={{ color: LT.muted }}>Scheduled job stop</span>
              </div>
              <div className="d-flex align-items-center gap-2 small mb-1">
                <LiveTrackingVehicleLegendIcon color={ROUTE_COLORS[1]} />
                <span style={{ color: LT.muted }}>Crew position along route</span>
              </div>
              <div className="d-flex align-items-center gap-2 small">
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 4,
                    borderRadius: 2,
                    background: ROUTE_COLORS[2],
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: LT.muted }}>Planned driving route</span>
              </div>
            </div>
          )}

          {mapVehicleDriverForCard && !selectedStop && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                right: 16,
                maxWidth: 360,
                background: LT.driverCardBg,
                backdropFilter: "blur(8px)",
                border: `1px solid ${LT.driverCardBorder}`,
                borderRadius: 12,
                padding: 14,
                color: LT.text,
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
                zIndex: 3,
              }}
            >
              <div className="d-flex justify-content-between align-items-start gap-2">
                <div style={{ fontWeight: 700 }}>{mapVehicleDriverForCard.name}</div>
                <button
                  type="button"
                  aria-label="Close crew card"
                  onClick={() => setSelectedVehicleDriverId(null)}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    margin: 0,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    color: LT.muted,
                    cursor: "pointer",
                    borderRadius: 6,
                  }}
                >
                  <XLg size={16} />
                </button>
              </div>
              <div className="small" style={{ color: LT.muted }}>
                {mapVehicleDriverForCard.vehicle}
              </div>
              {routeMeta[mapVehicleDriverForCard.id] && (
                <div className="small mt-2" style={{ color: LT.muted }}>
                  Route ~{(routeMeta[mapVehicleDriverForCard.id].meters / 1000).toFixed(1)} km
                  {routeMeta[mapVehicleDriverForCard.id].approx ? " (approx)" : ""} ·{" "}
                  {Math.round((routeMeta[mapVehicleDriverForCard.id].seconds || 0) / 60)} min drive
                </div>
              )}
              <div className="small mt-2" style={{ color: "#b45309", lineHeight: 1.4 }}>
                Position is simulated along the planned route until a live GPS feed
                is connected.
              </div>
            </div>
          )}

          {selectedStop && mapDriverForCard && (
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                right: 16,
                maxWidth: 360,
                background: LT.driverCardBg,
                backdropFilter: "blur(8px)",
                border: `1px solid ${LT.driverCardBorder}`,
                borderRadius: 12,
                padding: 14,
                color: LT.text,
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
              }}
            >
              <div style={{ fontWeight: 700 }}>{mapDriverForCard.name}</div>
              <div className="small" style={{ color: LT.muted }}>{mapDriverForCard.vehicle}</div>
              {routeMeta[mapDriverForCard.id] && (
                <div className="small mt-2" style={{ color: LT.muted }}>
                  Route ~{(routeMeta[mapDriverForCard.id].meters / 1000).toFixed(1)} km
                  {routeMeta[mapDriverForCard.id].approx ? " (approx)" : ""} ·{" "}
                  {Math.round((routeMeta[mapDriverForCard.id].seconds || 0) / 60)} min drive
                </div>
              )}
              <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${LT.border}` }}>
                <div className="d-flex justify-content-between align-items-center gap-2 small">
                  <span style={{ color: LT.muted, flex: "0 0 auto" }}>Job status</span>
                  <LiveStatusPill
                    raw={selectedStop.jobStatus}
                    kind="job"
                    statusList={jobStatuses}
                  />
                </div>
                <div className="d-flex justify-content-between align-items-center gap-2 small mt-2">
                  <span style={{ color: LT.muted, flex: "0 0 auto" }}>Assignment status</span>
                  <LiveStatusPill
                    raw={selectedStop.assignmentStatus}
                    kind="assignment"
                    statusList={jobStatuses}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Timeline footer */}
      <div
        style={{
          borderTop: `1px solid ${LT.border}`,
          background: LT.surface,
          padding: "10px 14px 14px",
        }}
      >
        <div className="d-flex flex-wrap align-items-center gap-3 small mb-2" style={{ color: LT.text }}>
          <span>
            <strong>{totals.routes}</strong> active routes
          </span>
          <span style={{ color: LT.muted }}>|</span>
          <span>
            <strong>{totals.km}</strong> km planned
          </span>
          <span style={{ color: LT.muted }}>|</span>
          <span>
            <strong>{totals.dur}</strong> drive time (all crews)
          </span>
          <span className="ms-auto" style={{ color: LT.muted }}>
            Timeline {TIMELINE_START}:00 – {TIMELINE_END}:00
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          {drivers.map((driver) => {
            const rowStops = stops
              .filter((s) => s.driverId === driver.id)
              .sort((a, b) => a.seq - b.seq);
            const rowContextStop =
              selectedStop?.driverId === driver.id
                ? selectedStop
                : rowStops[0] || null;
            return (
              <div
                key={driver.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "200px 1fr",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: LT.text }}>{driver.name}</div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      flexWrap: "nowrap",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 4,
                      fontSize: 11,
                      lineHeight: 1.2,
                      minWidth: 0,
                      overflowX: "auto",
                    }}
                  >
                    <span style={{ color: LT.muted, flexShrink: 0 }}>Job</span>
                    <LiveStatusPill
                      raw={rowContextStop?.jobStatus}
                      kind="job"
                      compact
                      statusList={jobStatuses}
                    />
                    <span style={{ color: LT.border, flexShrink: 0 }} aria-hidden>
                      ·
                    </span>
                    <span style={{ color: LT.muted, flexShrink: 0 }}>Assign</span>
                    <LiveStatusPill
                      raw={rowContextStop?.assignmentStatus}
                      kind="assignment"
                      compact
                      statusList={jobStatuses}
                    />
                  </div>
                </div>
                <div
                    style={{
                      position: "relative",
                      height: 36,
                      borderRadius: 8,
                      background: LT.timelineTrack,
                      border: `1px solid ${LT.border}`,
                    }}
                >
                  {[6, 10, 14, 18, 22].map((h) => (
                    <span
                      key={h}
                      style={{
                        position: "absolute",
                        left: `${((h - TIMELINE_START) / (TIMELINE_END - TIMELINE_START)) * 100}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: `1px dashed ${LT.timelineGrid}`,
                        fontSize: 10,
                        color: LT.muted,
                        paddingLeft: 4,
                      }}
                    >
                      {h}h
                    </span>
                  ))}
                  {rowStops.map((s) => {
                    const start = timeToMinutes(s.windowStart, TIMELINE_START);
                    const end = timeToMinutes(s.windowEnd, TIMELINE_START);
                    const left = (start / TIMELINE_MINUTES) * 100;
                    const width = Math.max(
                      3,
                      ((end - start) / TIMELINE_MINUTES) * 100
                    );
                    return (
                      <div
                        key={s.id}
                        title={`${s.jobRef} ${s.windowStart}-${s.windowEnd}`}
                        onClick={() => {
                          setSelectedStopId(s.id);
                          focusMapOnStop(s);
                        }}
                        style={{
                          position: "absolute",
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 10,
                          height: 18,
                          borderRadius: 6,
                          background:
                            s.id === selectedStopId
                              ? "rgba(22,163,74,0.85)"
                              : "rgba(37,99,235,0.8)",
                          cursor: "pointer",
                          border: "1px solid rgba(15,23,42,0.15)",
                        }}
                      />
                    );
                  })}
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min(
                        100,
                        Math.max(
                          0,
                          ((new Date().getHours() - TIMELINE_START) * 60 +
                            new Date().getMinutes()) /
                            TIMELINE_MINUTES *
                            100
                        )
                      )}%`,
                      top: 4,
                      bottom: 4,
                      width: 2,
                      background: "#FFB547",
                      borderRadius: 1,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        show={showBetaWelcomeModal}
        onHide={dismissBetaWelcomeModal}
        centered
        backdrop="static"
        contentClassName="border-0 shadow-lg"
      >
        <Modal.Header
          closeButton
          closeLabel="Close"
          className="border-0 pb-0"
          style={{ background: "linear-gradient(180deg, #f8fafc 0%, #fff 100%)" }}
        >
          <Modal.Title className="d-flex align-items-center gap-2 flex-wrap" style={{ fontSize: "1.15rem" }}>
            <span
              className="badge rounded-pill"
              style={{
                background: "linear-gradient(135deg, #4171F5 0%, #3DAAF5 100%)",
                fontSize: "0.65rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                padding: "0.35em 0.65em",
              }}
            >
              BETA
            </span>
            <span>Live job tracking</span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-2" style={{ color: "#334155" }}>
          <p className="mb-3 small" style={{ lineHeight: 1.55 }}>
            You’re using an early version of Live job tracking. Expect some bugs. We’re still polishing
            performance and workflows—thank you for trying it out.
          </p>
          <p className="mb-2 small fw-semibold" style={{ color: "#0f172a" }}>
            Tips
          </p>
          <ul className="small mb-3 ps-3" style={{ lineHeight: 1.6 }}>
            <li className="mb-2">
              Pick the <strong>day</strong> at the top to load jobs whose time window falls on that
              date.
            </li>
            <li className="mb-2">
              Jobs need an <strong>assigned technician</strong> and{" "}
              <strong>coordinates on the location</strong> to appear on the map.
            </li>
            <li className="mb-2">
              Use <strong>Team</strong> and <strong>status</strong> filters to narrow the list; status
              labels and colors follow <strong>Dashboard → Settings → Job Statuses</strong>.
            </li>
            <li className="mb-2">
              <strong>Re-optimize</strong> suggests a stop order along driving routes—double-check
              before you dispatch.
            </li>
            <li className="mb-2">
              If a route shows as a <strong>straight line</strong>, routing didn’t resolve for that
              crew (check Maps/Routes API access or coordinates).
            </li>
            <li>
              Moving dots on the map are <strong>illustrative</strong> until a live GPS feed is
              connected.
            </li>
          </ul>
          <Form.Check
            type="checkbox"
            id="live-tracking-beta-dont-show"
            className="small"
            label="Don’t show this message again on this browser"
            checked={betaModalDontShowAgain}
            onChange={(e) => setBetaModalDontShowAgain(e.target.checked)}
          />
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button
            variant="primary"
            className="px-4"
            style={{
              background: "linear-gradient(135deg, #4171F5 0%, #3DAAF5 100%)",
              border: "none",
              fontWeight: 600,
            }}
            onClick={dismissBetaWelcomeModal}
          >
            Continue to map
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
