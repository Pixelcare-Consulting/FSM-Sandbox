"use client";

import React, { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import PortalModal from "../../../../../components/portal/PortalModal";
import { parseDurationHoursToForm } from "../../../../../lib/jobs/scheduleDuration";
import {
  buildSingaporeDateTimeFromForm,
  formatSingaporeTimeHm,
  toSingaporeYmd,
} from "../../../../../lib/utils/singaporeDateTime";
import styles from "../scheduler.module.css";

function getAppointmentEndForJob(job) {
  if (!job) return null;
  if (job.appointmentEnd) {
    const d = new Date(job.appointmentEnd);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (job.end) {
    const d = new Date(job.end);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export default function SchedulerJobScheduleEditModal({
  show,
  onHide,
  selectedJob,
  onSave,
  isSaving = false,
}) {
  const [appointmentDate, setAppointmentDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [durationHours, setDurationHours] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [validationError, setValidationError] = useState("");
  const [initialAppointment, setInitialAppointment] = useState(null);
  const [initialDuration, setInitialDuration] = useState(null);

  useEffect(() => {
    if (!show || !selectedJob) return;

    const start = selectedJob.start ? new Date(selectedJob.start) : null;
    const end = getAppointmentEndForJob(selectedJob);
    const nextAppointment = {
      date: start && !Number.isNaN(start.getTime()) ? toSingaporeYmd(start) : "",
      startTime: start && !Number.isNaN(start.getTime()) ? formatSingaporeTimeHm(start) || "" : "",
      endTime: end && !Number.isNaN(end.getTime()) ? formatSingaporeTimeHm(end) || "" : "",
    };
    const { hours, minutes } = parseDurationHoursToForm(selectedJob.durationHours);
    const nextDuration = {
      hours: hours === "" ? "" : String(hours),
      minutes: minutes === "" ? "" : String(minutes),
    };

    setAppointmentDate(nextAppointment.date);
    setStartTime(nextAppointment.startTime);
    setEndTime(nextAppointment.endTime);
    setDurationHours(nextDuration.hours);
    setDurationMinutes(nextDuration.minutes);
    setInitialAppointment(nextAppointment);
    setInitialDuration(nextDuration);
    setValidationError("");
  }, [show, selectedJob?.technicianJobId, selectedJob?.start, selectedJob?.durationHours, selectedJob?.appointmentEnd]);

  const handleSave = () => {
    const appointmentChanged =
      initialAppointment &&
      (appointmentDate !== initialAppointment.date ||
        startTime !== initialAppointment.startTime ||
        endTime !== initialAppointment.endTime);

    const durationChanged =
      initialDuration &&
      (durationHours !== initialDuration.hours ||
        durationMinutes !== initialDuration.minutes);

    const fullAppointment = appointmentDate && startTime && endTime;
    const hasDuration = durationHours !== "" || durationMinutes !== "";

    if (appointmentChanged && !fullAppointment) {
      setValidationError("Complete all appointment fields (date, start, end).");
      return;
    }

    if (!appointmentChanged && !durationChanged) {
      setValidationError("Change the appointment or work duration before saving.");
      return;
    }

    if (appointmentChanged && fullAppointment) {
      const start = buildSingaporeDateTimeFromForm(appointmentDate, startTime);
      const end = buildSingaporeDateTimeFromForm(appointmentDate, endTime);
      if (!start || !end) {
        setValidationError("Enter valid appointment date and times.");
        return;
      }
      if (end.getTime() <= start.getTime()) {
        setValidationError("Appointment end must be after start.");
        return;
      }
    }

    const h = parseInt(durationHours, 10) || 0;
    const m = parseInt(durationMinutes, 10) || 0;
    if (durationChanged) {
      if (h < 0 || m < 0) {
        setValidationError("Duration hours and minutes must be zero or greater.");
        return;
      }
      if (m >= 60) {
        setValidationError("Duration minutes must be less than 60.");
        return;
      }
      if (hasDuration && h === 0 && m === 0) {
        setValidationError("Work duration must be greater than zero when set.");
        return;
      }
    }

    setValidationError("");

    onSave?.({
      appointmentDate: appointmentChanged && fullAppointment ? appointmentDate : undefined,
      startTime: appointmentChanged && fullAppointment ? startTime : undefined,
      endTime: appointmentChanged && fullAppointment ? endTime : undefined,
      durationHours: durationChanged && hasDuration ? durationHours : durationChanged ? 0 : undefined,
      durationMinutes: durationChanged && hasDuration ? durationMinutes : durationChanged ? 0 : undefined,
    });
  };

  return (
    <PortalModal
      show={show && !!selectedJob}
      onHide={onHide}
      title="Edit schedule"
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
          <Button variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {selectedJob ? (
        <div className={styles.schedulerEditModalBody}>
          <section className={styles.schedulerScheduleSection}>
            <h3 className={styles.schedulerScheduleSectionTitle}>Appointment window</h3>
            <p className={styles.schedulerScheduleSectionHint}>
              Customer-facing slot shown in the job popup (independent of work duration).
            </p>
            <Form.Group className="mb-3">
              <Form.Label htmlFor="scheduler-appointment-date">Date</Form.Label>
              <Form.Control
                id="scheduler-appointment-date"
                type="date"
                value={appointmentDate}
                onChange={(e) => {
                  setValidationError("");
                  setAppointmentDate(e.target.value);
                }}
                disabled={isSaving}
              />
            </Form.Group>
            <div className={styles.schedulerScheduleTimeRow}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="scheduler-appointment-start">Start time</Form.Label>
                <Form.Control
                  id="scheduler-appointment-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setValidationError("");
                    setStartTime(e.target.value);
                  }}
                  disabled={isSaving}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="scheduler-appointment-end">End time</Form.Label>
                <Form.Control
                  id="scheduler-appointment-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setValidationError("");
                    setEndTime(e.target.value);
                  }}
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
          </section>

          <div className={styles.schedulerScheduleDivider} role="separator" aria-hidden />

          <section className={styles.schedulerScheduleSection}>
            <h3 className={styles.schedulerScheduleSectionTitle}>Estimated work duration</h3>
            <p className={styles.schedulerScheduleSectionHint}>
              Controls day-view card width (work window from start + duration).
            </p>
            <div className={styles.schedulerScheduleTimeRow}>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="scheduler-duration-hours">Hours</Form.Label>
                <Form.Control
                  id="scheduler-duration-hours"
                  type="number"
                  min={0}
                  value={durationHours}
                  onChange={(e) => {
                    setValidationError("");
                    setDurationHours(e.target.value);
                  }}
                  disabled={isSaving}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="scheduler-duration-minutes">Minutes</Form.Label>
                <Form.Control
                  id="scheduler-duration-minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={durationMinutes}
                  onChange={(e) => {
                    setValidationError("");
                    setDurationMinutes(e.target.value);
                  }}
                  disabled={isSaving}
                />
              </Form.Group>
            </div>
          </section>

          {validationError ? (
            <div className={styles.schedulerEditValidation} role="alert">
              {validationError}
            </div>
          ) : null}
        </div>
      ) : null}
    </PortalModal>
  );
}
