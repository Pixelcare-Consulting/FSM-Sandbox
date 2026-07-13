import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Form, Table, Badge, Spinner, Alert } from "react-bootstrap";
import Link from "next/link";
import ReportPageShell from "./_components/ReportPageShell";
import { FaDownload, FaFilter, FaSearch } from "react-icons/fa";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/themes/light.css";
import {
  normalizeStatusKey,
} from "../../../lib/supabase/reports";
import { format } from "date-fns";

const STATUS_COLORS = {
  completed: { bg: "#dcfce7", text: "#16a34a" },
  pending: { bg: "#fef9c3", text: "#ca8a04" },
  scheduled: { bg: "#dbeafe", text: "#2563eb" },
  inprogress: { bg: "#e0f2fe", text: "#0284c7" },
  cancelled: { bg: "#fee2e2", text: "#dc2626" },
  rescheduled: { bg: "#ede9fe", text: "#7c3aed" },
};

const JOB_STATUSES = ["All", "Pending", "Scheduled", "In Progress", "Completed", "Cancelled", "Rescheduled"];

function badgeColors(status) {
  const k = normalizeStatusKey(status).replace(/_/g, "").toLowerCase();
  if (k.includes("complete")) return STATUS_COLORS.completed;
  if (k.includes("cancel")) return STATUS_COLORS.cancelled;
  if (k.includes("schedule")) return STATUS_COLORS.scheduled;
  if (k.includes("progress")) return STATUS_COLORS.inprogress;
  if (k.includes("reschedule")) return STATUS_COLORS.rescheduled;
  if (k.includes("pending") || k.includes("created") || k.includes("unconfirm")) return STATUS_COLORS.pending;
  return { bg: "#f1f5f9", text: "#475569" };
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
}

const JobStatusPage = () => {
  const [dateRange, setDateRange] = useState([]);
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [technicians, setTechnicians] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const dateFrom = dateRange?.[0] || null;
  const dateTo = dateRange?.[1] || dateRange?.[0] || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        search,
        technicianId: technicianId || "",
        limit: "200",
        page: "1",
      });
      if (dateFrom) params.set("dateFrom", dateFrom.toISOString().slice(0, 10));
      if (dateTo) params.set("dateTo", dateTo.toISOString().slice(0, 10));

      const response = await fetch(`/api/reports/job-status?${params.toString()}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Failed to load jobs (${response.status})`);

      setTechnicians(body.technicians || []);
      setJobs(body.rows || []);
      setTotalCount(body.totalCount ?? (body.rows || []).length);
    } catch (e) {
      setError(e?.message || "Failed to load jobs");
      setJobs([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [status, search, technicianId, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(
    () =>
      (jobs || []).map((row) => {
        if (row.raw) {
          const techs = (row.raw.technician_jobs || []).filter((tj) => !tj.deleted_at);
          return {
            raw: row.raw,
            catDesc: row.catDesc,
            techLabel: row.techLabel,
            techs,
          };
        }
        return {
          raw: {
            id: row.id,
            job_number: row.job_number,
            title: row.title,
            status: row.status,
            scheduled_start: row.scheduled_start,
            scheduled_end: row.scheduled_end,
            created_at: row.created_at,
            customer: { customer_code: row.customer_code, customer_name: row.customer_name },
          },
          catDesc: row.category || "—",
          techLabel: row.technicians || "—",
          techs: (row.technician_ids || []).map((id) => ({ technician_id: id })),
        };
      }),
    [jobs]
  );

  const resetFilters = () => {
    setDateRange([]);
    setStatus("All");
    setSearch("");
    setTechnicianId("");
  };

  return (
    <ReportPageShell
      title="Job Status Record Search"
      subtitle="Live data from Supabase — filter by status, date, technician, or customer"
      headerRight={
        <Button size="sm" variant="light" className="d-flex align-items-center gap-2" style={{ fontSize: 13, borderRadius: 8 }}>
          <FaDownload style={{ fontSize: 12 }} />
          Export
        </Button>
      }
    >
      {error && (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      )}

      <div className="d-flex gap-2 flex-wrap mb-4">
        {JOB_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "primary" : "outline-secondary"}
            onClick={() => setStatus(s)}
            style={{ borderRadius: 20, fontSize: 12, padding: "5px 14px" }}
          >
            {s}
          </Button>
        ))}
      </div>

      <Card className="mb-4" style={{ borderRadius: 12, border: "1px solid #e2e8f0" }}>
        <Card.Body className="py-3 px-4">
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <FaFilter style={{ color: "#94a3b8", fontSize: 14 }} />
            <div className="position-relative" style={{ minWidth: 220 }}>
              <FaSearch
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                  fontSize: 12,
                  zIndex: 1,
                }}
              />
              <Form.Control
                size="sm"
                placeholder="Search job # or customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 13, borderRadius: 8, paddingLeft: 30 }}
              />
            </div>
            <div style={{ minWidth: 220 }}>
              <Flatpickr
                options={{ mode: "range", dateFormat: "M j, Y" }}
                value={dateRange}
                onChange={setDateRange}
                placeholder="Select date range"
                className="form-control form-control-sm"
                style={{ fontSize: 13, borderRadius: 8 }}
              />
            </div>
            <Form.Select
              size="sm"
              style={{ maxWidth: 200, fontSize: 13, borderRadius: 8 }}
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
            >
              <option value="">All Technicians</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </Form.Select>
            <Button size="sm" variant="outline-secondary" style={{ borderRadius: 8, fontSize: 13 }} onClick={resetFilters}>
              Reset
            </Button>
            <Button size="sm" variant="outline-primary" style={{ borderRadius: 8, fontSize: 13 }} onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>
        </Card.Body>
      </Card>

      <Card style={{ borderRadius: 12, border: "1px solid #e2e8f0" }}>
        <Card.Header className="bg-white py-3 px-4" style={{ borderBottom: "1px solid #e2e8f0", borderRadius: "12px 12px 0 0" }}>
          <div className="d-flex justify-content-between align-items-center">
            <h6 style={{ fontWeight: 700, margin: 0, color: "#1e293b" }}>Job Records</h6>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              {loading ? "Loading…" : `${filteredRows.length} result${filteredRows.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          <div className="table-responsive">
            <Table hover className="mb-0" style={{ fontSize: 13 }}>
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  <th className="px-4 py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Job #
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Customer
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Job Type
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Technician
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Scheduled
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Completed
                  </th>
                  <th className="py-3" style={{ fontWeight: 600, color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-5 text-center">
                      <Spinner animation="border" size="sm" className="me-2" />
                      Loading jobs…
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-5 text-center" style={{ color: "#94a3b8", fontSize: 14 }}>
                      No job records match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(({ raw, catDesc, techLabel, techs }) => {
                    const completedAt = techs
                      .map((tj) => tj.completed_at)
                      .filter(Boolean)
                      .sort()
                      .pop();
                    const colors = badgeColors(raw.status);
                    return (
                      <tr key={raw.id}>
                        <td className="px-4 py-2">
                          <Link href={`/dashboard/jobs/${raw.id}`} style={{ color: "#4171F5", fontWeight: 600 }}>
                            {raw.job_number || raw.id?.slice(0, 8)}
                          </Link>
                        </td>
                        <td>{raw.customer?.customer_name || raw.customer?.customer_code || "—"}</td>
                        <td>{catDesc}</td>
                        <td>{techLabel}</td>
                        <td>{fmtDate(raw.scheduled_start)}</td>
                        <td>{fmtDate(completedAt)}</td>
                        <td>
                          <Badge style={{ background: colors.bg, color: colors.text, fontWeight: 600 }}>
                            {raw.status || "—"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    </ReportPageShell>
  );
};

export default JobStatusPage;
