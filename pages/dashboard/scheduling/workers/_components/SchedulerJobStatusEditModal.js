"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "react-bootstrap";
import Select from "react-select";
import PortalModal from "../../../../../components/portal/PortalModal";
import { toDbStatus } from "../../../../../lib/jobs/jobStatusPersistence";
import styles from "../scheduler.module.css";

export default function SchedulerJobStatusEditModal({
  show,
  onHide,
  selectedJob,
  jobStatuses = [],
  onSave,
  isSaving = false,
  selectStyles,
}) {
  const [statusValue, setStatusValue] = useState("");

  useEffect(() => {
    if (!show || !selectedJob) return;
    setStatusValue(selectedJob.jobStatus != null ? String(selectedJob.jobStatus).trim() : "");
  }, [show, selectedJob?.jobStatus, selectedJob?.technicianJobId]);

  const statusOptions = useMemo(
    () =>
      jobStatuses.map((s) => ({
        value: s.value,
        label: s.name,
        color: s.color,
      })),
    [jobStatuses]
  );

  const selectedOption = useMemo(() => {
    if (!statusValue || statusOptions.length === 0) return null;
    const raw = String(statusValue).trim();
    return (
      statusOptions.find(
        (opt) =>
          String(opt.value || "").trim() === raw ||
          toDbStatus(opt.value) === toDbStatus(raw)
      ) || null
    );
  }, [statusOptions, statusValue]);

  const handleSave = () => {
    if (!statusValue || isSaving) return;
    onSave?.(statusValue);
  };

  return (
    <PortalModal
      show={show && !!selectedJob}
      onHide={onHide}
      title="Edit job status"
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
          <Button variant="secondary" onClick={onHide} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!statusValue || isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {selectedJob ? (
        <div className={styles.schedulerEditModalBody}>
          <label className="form-label" htmlFor="scheduler-status-select">
            Job status
          </label>
          <Select
            inputId="scheduler-status-select"
            instanceId="scheduler-status-select"
            options={statusOptions}
            value={selectedOption}
            onChange={(option) => setStatusValue(option?.value ?? "")}
            isDisabled={isSaving}
            isClearable={false}
            isSearchable
            placeholder="Select status…"
            noOptionsMessage={() => "No statuses found"}
            styles={selectStyles}
            menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            menuPlacement="auto"
            formatOptionLabel={({ label, color }) => (
              <span className={styles.schedulerStatusOption}>
                <span
                  className={styles.schedulerStatusOptionDot}
                  style={{ backgroundColor: color || "#6b7280" }}
                  aria-hidden
                />
                {label}
              </span>
            )}
          />
        </div>
      ) : null}
    </PortalModal>
  );
}
