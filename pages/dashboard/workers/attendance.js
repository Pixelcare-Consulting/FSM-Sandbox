import React, { useState, useMemo, useCallback, Fragment } from "react";
import Link from "next/link";
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Form,
  Spinner,
  Alert,
  Badge,
  Collapse,
} from "react-bootstrap";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Box,
  Tooltip,
  useTheme,
} from "@mui/material";
import { FaDownload, FaArrowLeft, FaChevronDown, FaChevronRight } from "react-icons/fa";
import { X as FeatherX, RefreshCw } from "react-feather";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/themes/light.css";
import { startOfMonth, endOfMonth, format, parseISO } from "date-fns";
import { GeeksSEO } from "widgets";
import { DashboardHeader } from "sub-components";
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from "../../../sub-components/dashboard/DashboardListStickySearch";
import TablePagination from "../../../components/common/TablePagination";
import {
  getAttendanceMinutes,
  getAttendanceStatusBadge,
  isUnusuallyLongMinutes,
} from "../../../lib/supabase/attendanceUtils";
import { formatSingaporeTime } from "../../../lib/utils/singaporeDateTime";
import { getWorkerViewPath } from "../../../utils/workerRoutes";

const PER_PAGE = 25;
const PUNCH_LIMIT = 5000;

const filterControlStyle = {
  fontSize: "0.95rem",
  padding: "0.65rem 1rem",
  border: "none",
  borderRadius: "8px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  fontWeight: "400",
};

const filterLabelStyle = {
  fontSize: "0.75rem",
  fontWeight: "500",
  display: "block",
  opacity: 0.9,
};

function formatPortalLogin(iso) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy · h:mm a");
  } catch {
    return "—";
  }
}

function formatClockDateTime(iso) {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "MMM d, yyyy · h:mm a");
  } catch {
    return "—";
  }
}

function escapeCsvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename, lines) {
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function StatusBadge({ group }) {
  const { label, bg } = getAttendanceStatusBadge(group);
  return (
    <Badge
      bg={bg}
      style={{
        fontSize: "11px",
        fontWeight: 600,
        ...(group.isOnBreak ? { color: "#212529" } : {}),
      }}
    >
      {label}
    </Badge>
  );
}

function DayTotalCell({ minutes }) {
  if (minutes == null) return <span className="text-muted">—</span>;
  const unusual = isUnusuallyLongMinutes(minutes);
  const content = <span style={{ fontVariantNumeric: "tabular-nums" }}>{minutes}</span>;
  if (!unusual) return content;
  return (
    <Tooltip title="Unusually long — verify mobile punch data" arrow placement="top">
      <span style={{ cursor: "help", color: "#d97706" }}>{content}</span>
    </Tooltip>
  );
}

function PunchDetailTable({ punches }) {
  return (
    <div className="p-3" style={{ background: "#f8fafc" }}>
      <table className="table table-sm mb-0" style={{ fontSize: 12 }}>
        <thead>
          <tr style={{ color: "#64748b" }}>
            <th style={{ width: 40 }}>#</th>
            <th>Time In</th>
            <th>Time Out</th>
            <th className="text-end">Minutes</th>
            {/* <th>Note</th> */}
          </tr>
        </thead>
        <tbody>
          {punches.map((punch, idx) => {
            const isOpen = !punch.clock_out;
            const mins = getAttendanceMinutes(punch);
            return (
              <tr
                key={punch.id || `${punch.clock_in}-${idx}`}
                style={isOpen ? { background: "rgba(34, 197, 94, 0.08)" } : undefined}
              >
                <td className="text-muted">{idx + 1}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatSingaporeTime(punch.clock_in, { hour12: true })}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>
                  {punch.clock_out ? formatSingaporeTime(punch.clock_out, { hour12: true }) : "—"}
                </td>
                <td className="text-end" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {mins != null ? mins : "—"}
                </td>
                <td>
                  {isOpen ? (
                    <Badge bg="success" style={{ fontSize: 10 }}>
                      Open
                    </Badge>
                  ) : punch.is_break ? (
                    <Badge bg="info" text="dark" style={{ fontSize: 10 }}>
                      Break
                    </Badge>
                  ) : null }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceGroupedTable({ groups, expandedIds, onToggleExpand, rowOffset = 0 }) {
  const theme = useTheme();
  const headBg = theme.palette.mode === "light" ? "#f8f9fa" : "#1e1e1e";

  if (!groups.length) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200 }}>
        <span className="text-muted">No rows match the current filters.</span>
      </Box>
    );
  }

  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}
    >
      <Table size="small" sx={{ width: "100%", tableLayout: "fixed" }} stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "3%", padding: "8px 4px" }} />
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "3%", padding: "8px 4px" }} align="center">
              #
            </TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "10%" }}>Employee</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "7%" }}>Date</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "7%" }}>Status</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "11%" }}>Expected</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "9%" }}>Calendar</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "9%" }}>Notes</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "6%" }}>First In</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "6%" }}>Last Out</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "5%" }}>Punches</TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "5%" }} align="right">
              Day Total
            </TableCell>
            <TableCell sx={{ fontWeight: 600, backgroundColor: headBg, width: "8%" }}>Last Clock-In</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((group, index) => {
            const expanded = expandedIds.has(group.id);
            const punchLabel = `${group.punchCount} punch${group.punchCount === 1 ? "" : "es"}`;
            return (
              <Fragment key={group.id}>
                <TableRow
                  hover
                  sx={{ "&:hover": { backgroundColor: "#f8fafc" }, cursor: "pointer" }}
                  onClick={() => onToggleExpand(group.id)}
                >
                  <TableCell sx={{ padding: "8px 4px", verticalAlign: "middle" }}>
                    {expanded ? (
                      <FaChevronDown style={{ fontSize: 11, color: "#64748b" }} />
                    ) : (
                      <FaChevronRight style={{ fontSize: 11, color: "#64748b" }} />
                    )}
                  </TableCell>
                  <TableCell align="center" sx={{ padding: "8px 4px", verticalAlign: "middle", color: "#64748b", fontSize: "0.8125rem" }}>
                    {rowOffset + index + 1}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", fontWeight: 600, color: "#1e293b", fontSize: "0.8125rem" }}>
                    {group.workerViewId ? (
                      <Link
                        href={getWorkerViewPath(group.workerViewId)}
                        className="text-decoration-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.employee}
                      </Link>
                    ) : (
                      group.employee
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", color: "#475569", fontSize: "0.8125rem" }}>
                    {group.dateDisplay}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle" }}>
                    <StatusBadge group={group} />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", color: "#475569", fontSize: "0.75rem" }}>
                    {group.workerViewId ? (
                      <Link
                        href={getWorkerViewPath(group.workerViewId, { tab: "schedule" })}
                        className="text-decoration-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {group.expectedWork || "—"}
                      </Link>
                    ) : (
                      group.expectedWork || "—"
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle" }}>
                    <div className="d-flex flex-wrap gap-1">
                      {(group.calendarBadges || []).length ? (
                        (group.calendarBadges || []).map((badge) => (
                          <Link
                            key={`${badge.eventType}-${badge.title}`}
                            href={`/company-calendar?date=${encodeURIComponent(group.dateKey)}`}
                            className="text-decoration-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Badge bg={badge.variant} style={{ fontSize: 10 }}>
                              {badge.label}
                            </Badge>
                          </Link>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle" }}>
                    <div className="d-flex flex-wrap gap-1">
                      {(group.varianceFlags || []).length ? (
                        (group.varianceFlags || []).map((flag) => (
                          <Badge key={flag.type} bg={flag.variant} style={{ fontSize: 10 }}>
                            {flag.label}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", fontVariantNumeric: "tabular-nums", color: "#475569", fontSize: "0.8125rem" }}>
                    {group.firstIn ? formatSingaporeTime(group.firstIn, { hour12: true }) : "—"}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", fontVariantNumeric: "tabular-nums", color: "#475569", fontSize: "0.8125rem" }}>
                    {group.lastOut ? formatSingaporeTime(group.lastOut, { hour12: true }) : "—"}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle" }}>
                    {group.punchCount > 1 ? (
                      <Tooltip title="Multiple clock events this day" arrow placement="top">
                        <span style={{ display: "inline-block" }}>
                          <Badge bg="light" text="dark" style={{ fontSize: 11, fontWeight: 500 }}>
                            {punchLabel}
                          </Badge>
                        </span>
                      </Tooltip>
                    ) : (
                      <Badge bg="light" text="dark" style={{ fontSize: 11, fontWeight: 500 }}>
                        {punchLabel}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ verticalAlign: "middle", fontSize: "0.8125rem" }}>
                    <DayTotalCell minutes={group.dayTotalMinutes} />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", color: "#475569", fontSize: "0.8125rem" }}>
                    {formatPortalLogin(group.portalLogin)}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "middle", color: "#475569", fontSize: "0.8125rem" }}>
                    {formatClockDateTime(group.lastClockIn)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={14} sx={{ padding: 0, borderBottom: expanded ? undefined : "none" }}>
                    <Collapse in={expanded}>
                      <div>
                        <PunchDetailTable punches={group.punches} />
                      </div>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const today = new Date();

const AttendancePage = () => {
  const [dateFrom, setDateFrom] = useState(startOfMonth(today));
  const [dateTo, setDateTo] = useState(endOfMonth(today));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  const [rawPunchCount, setRawPunchCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarContextFilter, setCalendarContextFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);

  const rangeIso = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    const start = new Date(dateFrom);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    if (start > end) return null;
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }, [dateFrom, dateTo]);

  const dateLabel = useMemo(() => {
    if (!dateFrom || !dateTo) return "Select dates";
    return `${format(dateFrom, "MMM d, yyyy")} – ${format(dateTo, "MMM d, yyyy")}`;
  }, [dateFrom, dateTo]);

  const technicianOptions = useMemo(() => {
    const map = new Map();
    for (const g of groups) {
      if (g.technicianId && !map.has(g.technicianId)) {
        map.set(g.technicianId, g.employee);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  const load = useCallback(async () => {
    if (!rangeIso) {
      setError("From date must be on or before To date.");
      return;
    }
    setLoading(true);
    setError(null);
    setExpandedIds(new Set());
    setCurrentPage(1);
    try {
      const params = new URLSearchParams({
        startIso: rangeIso.startIso,
        endIso: rangeIso.endIso,
      });
      const response = await fetch(`/api/workers/attendance-summary?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Failed to load attendance");
      }

      setRawPunchCount(body.rawPunchCount ?? 0);
      setGroups(body.groups ?? []);
      setHasLoaded(true);
    } catch (e) {
      setError(e?.message || "Failed to load attendance");
      setGroups([]);
      setRawPunchCount(0);
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [rangeIso]);

  const filteredGroups = useMemo(() => {
    let out = groups;

    if (technicianFilter && technicianFilter !== "all") {
      out = out.filter((g) => g.technicianId === technicianFilter);
    }

    if (statusFilter === "working") {
      out = out.filter((g) => g.isWorking);
    } else if (statusFilter === "off_duty") {
      out = out.filter((g) => !g.isWorking);
    }

    if (calendarContextFilter === "anomalies") {
      out = out.filter((g) => g.hasVariance);
    } else if (calendarContextFilter === "on_leave") {
      out = out.filter((g) => g.isOnLeaveDay);
    } else if (calendarContextFilter === "company_holidays") {
      out = out.filter((g) => g.isCompanyHolidayDay);
    }

    const q = globalSearch.trim().toLowerCase();
    if (q) {
      out = out.filter((g) => {
        const firstIn = g.firstIn ? formatSingaporeTime(g.firstIn, { hour12: true }).toLowerCase() : "";
        const lastOut = g.lastOut ? formatSingaporeTime(g.lastOut, { hour12: true }).toLowerCase() : "";
        const portal = formatPortalLogin(g.portalLogin).toLowerCase();
        const lastClock = formatClockDateTime(g.lastClockIn).toLowerCase();
        const dayTotal = g.dayTotalMinutes != null ? String(g.dayTotalMinutes) : "";
        const status = getAttendanceStatusBadge(g).label.toLowerCase();
        return (
          g.employee.toLowerCase().includes(q) ||
          g.dateDisplay.toLowerCase().includes(q) ||
          firstIn.includes(q) ||
          lastOut.includes(q) ||
          portal.includes(q) ||
          lastClock.includes(q) ||
          dayTotal.includes(q) ||
          status.includes(q) ||
          String(g.punchCount).includes(q)
        );
      });
    }

    return out;
  }, [groups, technicianFilter, statusFilter, calendarContextFilter, globalSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedGroups = useMemo(() => {
    const start = (safePage - 1) * PER_PAGE;
    return filteredGroups.slice(start, start + PER_PAGE);
  }, [filteredGroups, safePage]);

  const summary = useMemo(() => {
    const techIds = new Set(filteredGroups.map((g) => g.technicianId));
    const dayKeys = new Set(filteredGroups.map((g) => g.dateKey));
    const totalPunches = filteredGroups.reduce((sum, g) => sum + g.punchCount, 0);
    const totalMinutes = filteredGroups.reduce((sum, g) => sum + (g.dayTotalMinutes || 0), 0);
    return {
      technicians: techIds.size,
      days: dayKeys.size,
      punches: totalPunches,
      minutes: totalMinutes,
    };
  }, [filteredGroups]);

  const filtersActive = useMemo(
    () =>
      Boolean(
        globalSearch.trim() ||
          (technicianFilter && technicianFilter !== "all") ||
          (statusFilter && statusFilter !== "all") ||
          (calendarContextFilter && calendarContextFilter !== "all")
      ),
    [globalSearch, technicianFilter, statusFilter, calendarContextFilter]
  );

  const clearFilters = useCallback(() => {
    setGlobalSearch("");
    setTechnicianFilter("all");
    setStatusFilter("all");
    setCalendarContextFilter("all");
    setCurrentPage(1);
  }, []);

  const toggleExpand = useCallback((groupId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const buildSummaryCsv = useCallback(
    (rows) => {
      const headers = [
        "Employee",
        "Date",
        "Status",
        "Expected",
        "Calendar",
        "Variance",
        "First In",
        "Last Out",
        "Punches",
        "Day Total Minutes",
        "Last Clock-In",
        "Timestamp",
      ];
      return [
        headers.map(escapeCsvCell).join(","),
        ...rows.map((g) => {
          const status = getAttendanceStatusBadge(g).label;
          const calendar = (g.calendarBadges || []).map((b) => b.label).join("; ");
          const variance = (g.varianceFlags || []).map((v) => v.label).join("; ");
          return [
            g.employee,
            g.dateDisplay,
            status,
            g.expectedWork || "",
            calendar,
            variance,
            g.firstIn ? formatSingaporeTime(g.firstIn, { hour12: true }) : "",
            g.lastOut ? formatSingaporeTime(g.lastOut, { hour12: true }) : "",
            g.punchCount,
            g.dayTotalMinutes ?? "",
            formatPortalLogin(g.portalLogin),
            formatClockDateTime(g.lastClockIn),
          ]
            .map(escapeCsvCell)
            .join(",");
        }),
      ];
    },
    []
  );

  const buildDetailCsv = useCallback((rows) => {
    const headers = ["Employee", "Date", "Time In", "Time Out", "Minutes", "Break", "Open"];
    const lines = [headers.map(escapeCsvCell).join(",")];
    for (const g of rows) {
      for (const punch of g.punches) {
        const mins = getAttendanceMinutes(punch);
        lines.push(
          [
            g.employee,
            g.dateDisplay,
            punch.clock_in ? formatSingaporeTime(punch.clock_in, { hour12: true }) : "",
            punch.clock_out ? formatSingaporeTime(punch.clock_out, { hour12: true }) : "",
            mins ?? "",
            punch.is_break ? "Yes" : "",
            punch.clock_out ? "" : "Yes",
          ]
            .map(escapeCsvCell)
            .join(",")
        );
      }
    }
    return lines;
  }, []);

  const handleExportSummary = useCallback(() => {
    if (!filteredGroups.length || !dateFrom || !dateTo) return;
    const d0 = format(dateFrom, "yyyy-MM-dd");
    const d1 = format(dateTo, "yyyy-MM-dd");
    downloadCsv(`attendance_summary_${d0}_${d1}.csv`, buildSummaryCsv(filteredGroups));
  }, [filteredGroups, dateFrom, dateTo, buildSummaryCsv]);

  const handleExportDetail = useCallback(() => {
    if (!filteredGroups.length || !dateFrom || !dateTo) return;
    const d0 = format(dateFrom, "yyyy-MM-dd");
    const d1 = format(dateTo, "yyyy-MM-dd");
    downloadCsv(`attendance_detail_${d0}_${d1}.csv`, buildDetailCsv(filteredGroups));
  }, [filteredGroups, dateFrom, dateTo, buildDetailCsv]);

  const canLoad = Boolean(rangeIso) && !loading;
  const canExport = !loading && filteredGroups.length > 0 && hasLoaded;

  return (
    <>
      <GeeksSEO title="Attendance | SAS&ME" />
      <DashboardHeader
        title="Attendance"
        subtitle="Daily time records — grouped by technician and day"
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Technicians", href: "/workers" },
          { label: "Attendance" },
        ]}
        rightAction={
          <div className="d-flex gap-2">
            <Button
              size="sm"
              variant="light"
              className="d-flex align-items-center gap-2"
              onClick={handleExportDetail}
              disabled={!canExport}
              title="Export flat punch detail"
            >
              <FaDownload style={{ fontSize: 12 }} />
              Detail CSV
            </Button>
            <Button
              size="sm"
              variant="light"
              className="d-flex align-items-center gap-2"
              onClick={handleExportSummary}
              disabled={!canExport}
              title="Export grouped summary"
            >
              <FaDownload style={{ fontSize: 12 }} />
              Summary CSV
            </Button>
          </div>
        }
      />

      <Container fluid className="mb-6">
        {error && (
          <Alert variant="danger" className="mb-4">
            {error}
          </Alert>
        )}

        <Link
          href="/workers"
          className="d-inline-flex align-items-center gap-2 text-decoration-none mb-3"
          style={{ fontSize: 13, color: "#64748b" }}
        >
          <FaArrowLeft style={{ fontSize: 11 }} />
          Back to Technicians
        </Link>

        <DashboardListStickySearch
          style={STICKY_SEARCH_GRADIENT_BLUE}
          bodyClassName="p-4"
        >
            <Row className="align-items-center mb-3">
              <Col md={12}>
                <div className="d-flex align-items-center gap-3 flex-wrap">
                  <div style={{ minWidth: 140 }}>
                    <h6 className="mb-0 text-white">Search Filters</h6>
                    <small className="text-white" style={{ opacity: 0.9, fontSize: "0.75rem" }}>
                      Load on demand
                    </small>
                  </div>
                  <div className="flex-grow-1" style={{ minWidth: 200 }}>
                    <Form.Control
                      type="text"
                      value={globalSearch}
                      onChange={(e) => {
                        setGlobalSearch(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search name, date, times, status…"
                      style={filterControlStyle}
                      disabled={!hasLoaded}
                    />
                  </div>
                  {filtersActive && (
                    <Button
                      variant="light"
                      size="sm"
                      onClick={clearFilters}
                      className="d-flex align-items-center gap-1"
                      style={{ minWidth: 90, fontWeight: 500, borderRadius: 6 }}
                    >
                      <FeatherX size={14} />
                      Clear
                    </Button>
                  )}
                </div>
              </Col>
            </Row>

            <Row className="g-3 align-items-end">
              <Col xs={6} md={3} lg={2}>
                <label className="text-white mb-2" style={filterLabelStyle}>
                  From
                </label>
                <Flatpickr
                  className="form-control"
                  value={dateFrom}
                  options={{ dateFormat: "M j, Y" }}
                  onChange={([d]) => setDateFrom(d || null)}
                />
              </Col>
              <Col xs={6} md={3} lg={2}>
                <label className="text-white mb-2" style={filterLabelStyle}>
                  To
                </label>
                <Flatpickr
                  className="form-control"
                  value={dateTo}
                  options={{ dateFormat: "M j, Y" }}
                  onChange={([d]) => setDateTo(d || null)}
                />
              </Col>
              <Col xs={6} md={3} lg={2}>
                <label className="text-white mb-2" style={filterLabelStyle}>
                  Technician
                </label>
                <Form.Select
                  value={technicianFilter}
                  onChange={(e) => {
                    setTechnicianFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={filterControlStyle}
                  disabled={!hasLoaded || !technicianOptions.length}
                >
                  <option value="all">All Technicians</option>
                  {technicianOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col xs={6} md={3} lg={2}>
                <label className="text-white mb-2" style={filterLabelStyle}>
                  Status
                </label>
                <Form.Select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={filterControlStyle}
                  disabled={!hasLoaded}
                >
                  <option value="all">All Status</option>
                  <option value="working">Currently working</option>
                  <option value="off_duty">Off duty</option>
                </Form.Select>
              </Col>
              <Col xs={6} md={3} lg={2}>
                <label className="text-white mb-2" style={filterLabelStyle}>
                  Calendar
                </label>
                <Form.Select
                  value={calendarContextFilter}
                  onChange={(e) => {
                    setCalendarContextFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  style={filterControlStyle}
                  disabled={!hasLoaded}
                >
                  <option value="all">All days</option>
                  <option value="anomalies">Anomalies only</option>
                  <option value="on_leave">On leave days</option>
                  <option value="company_holidays">Company holidays</option>
                </Form.Select>
              </Col>
              <Col xs={12} md={6} lg={2}>
                <Button
                  variant="light"
                  className="w-100 d-flex align-items-center justify-content-center gap-2 attendance-load-btn"
                  onClick={load}
                  disabled={!canLoad}
                  style={{
                    minWidth: 120,
                    padding: "0.7rem 1.25rem",
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#ffffff",
                    color: "#1e40af",
                    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.22)",
                  }}
                >
                  {loading ? (
                    <>
                      <Spinner animation="border" size="sm" />
                      Loading…
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} strokeWidth={2.5} />
                      Load
                    </>
                  )}
                </Button>
              </Col>
            </Row>

            {!rangeIso && dateFrom && dateTo ? (
              <p className="small text-white mb-0 mt-2" style={{ opacity: 0.9 }}>
                From date must be on or before To date.
              </p>
            ) : rangeIso ? (
              <p className="small text-white mb-0 mt-2" style={{ opacity: 0.85 }}>
                Range: {dateLabel}
              </p>
            ) : null}
        </DashboardListStickySearch>

        {hasLoaded && groups.length > 0 && (
          <Card className="border-0 shadow-sm mb-3">
            <Card.Body className="py-3 px-4">
              <div className="d-flex flex-wrap gap-3 align-items-center">
                <Badge bg="primary" className="fw-normal" style={{ fontSize: 12, padding: "6px 12px" }}>
                  {summary.technicians} technician{summary.technicians === 1 ? "" : "s"}
                </Badge>
                <Badge bg="secondary" className="fw-normal" style={{ fontSize: 12, padding: "6px 12px" }}>
                  {summary.days} day{summary.days === 1 ? "" : "s"}
                </Badge>
                <Badge bg="light" text="dark" className="fw-normal" style={{ fontSize: 12, padding: "6px 12px" }}>
                  {summary.punches} punch{summary.punches === 1 ? "" : "es"}
                </Badge>
                <Badge bg="light" text="dark" className="fw-normal" style={{ fontSize: 12, padding: "6px 12px" }}>
                  {summary.minutes.toLocaleString()} min total
                </Badge>
                {filteredGroups.length !== groups.length && (
                  <span className="text-muted small">
                    Showing {filteredGroups.length} of {groups.length} grouped rows
                  </span>
                )}
              </div>
            </Card.Body>
          </Card>
        )}

        <Card className="border-0 shadow-sm">
          <Card.Header className="bg-white py-3 px-4 border-bottom">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <h6 style={{ fontWeight: 700, margin: 0, color: "#1e293b" }}>Daily time records</h6>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {loading
                  ? "Loading…"
                  : hasLoaded
                    ? `${filteredGroups.length} row${filteredGroups.length === 1 ? "" : "s"}`
                    : "—"}
              </span>
            </div>
          </Card.Header>

          <Card.Body className="p-0">
            {!hasLoaded ? (
              <div className="text-center py-5 text-muted" style={{ fontSize: 14 }}>
                Select a date range and click Load to view attendance.
              </div>
            ) : loading ? (
              <div className="text-center py-5">
                <Spinner animation="border" size="sm" className="me-2" />
                Loading…
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center py-5 text-muted" style={{ fontSize: 14 }}>
                No attendance punches in this period.
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-5 text-muted" style={{ fontSize: 14 }}>
                No rows match the current filters.
              </div>
            ) : (
              <>
                <AttendanceGroupedTable
                  groups={paginatedGroups}
                  expandedIds={expandedIds}
                  onToggleExpand={toggleExpand}
                  rowOffset={(safePage - 1) * PER_PAGE}
                />
                <div className="border-top">
                  <TablePagination
                    currentPage={safePage}
                    totalPages={totalPages}
                    totalItems={filteredGroups.length}
                    onPageChange={setCurrentPage}
                    disabled={loading}
                  />
                </div>
              </>
            )}
          </Card.Body>

          {hasLoaded && rawPunchCount >= PUNCH_LIMIT && (
            <Card.Footer className="bg-white border-top py-2 px-4">
              <small className="text-warning">
                Showing first {PUNCH_LIMIT.toLocaleString()} punches — narrow the date range for complete data.
              </small>
            </Card.Footer>
          )}
        </Card>
      </Container>

      <style jsx global>{`
        .table tbody tr {
          transition: all 0.2s ease;
        }

        .form-control:focus,
        .form-select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 0.2rem rgba(59, 130, 246, 0.25);
        }

        .form-control,
        .form-select {
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .attendance-load-btn:not(:disabled) {
          transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
        }

        .attendance-load-btn:not(:disabled):hover {
          background-color: #f8fafc !important;
          color: #1d4ed8 !important;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28) !important;
          transform: translateY(-1px);
        }

        .attendance-load-btn:not(:disabled):active {
          background-color: #eff6ff !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18) !important;
          transform: translateY(0);
        }

        .attendance-load-btn:disabled {
          opacity: 0.65;
          box-shadow: none !important;
        }
      `}</style>
    </>
  );
};

export default AttendancePage;
