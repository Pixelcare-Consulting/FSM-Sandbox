import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Form } from "react-bootstrap";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CALENDAR_EVENT_COLORS } from "../../../../../lib/calendar/calendarEvents";
import PortalModal from "../../../../../components/portal/PortalModal";

export const WELCOME_SEEN_KEY = "fsm_company_calendar_welcome_seen_v1";
export const WELCOME_SESSION_KEY = "fsm_company_calendar_welcome_session_dismissed_v1";

const LEGEND_GROUPS = [
  {
    title: "Holiday / Company day off",
    subtitle: "Affects everyone",
    types: [
      { label: "Holiday", color: CALENDAR_EVENT_COLORS.holiday },
      { label: "Company day off", color: CALENDAR_EVENT_COLORS.company_day_off },
    ],
  },
  {
    title: "Leave / Medical / Others",
    subtitle: "Per technician",
    types: [
      { label: "Leave", color: CALENDAR_EVENT_COLORS.leave },
      { label: "Medical", color: CALENDAR_EVENT_COLORS.medical },
    ],
  },
];

export function hasPermanentlySeenWelcome() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasSessionDismissedWelcome() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(WELCOME_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markWelcomePermanentlySeen() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function markWelcomeSessionDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WELCOME_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function shouldAutoOpenWelcome() {
  return !hasPermanentlySeenWelcome() && !hasSessionDismissedWelcome();
}

export default function CompanyCalendarWelcomeModal({ show, onHide }) {
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (show) setDontShowAgain(true);
  }, [show]);

  const closeModal = () => {
    onHide?.();
  };

  const handleSessionDismiss = () => {
    markWelcomeSessionDismissed();
    closeModal();
  };

  const handleGotIt = () => {
    if (dontShowAgain) {
      markWelcomePermanentlySeen();
    } else {
      markWelcomeSessionDismissed();
    }
    closeModal();
  };

  return (
    <PortalModal
      show={show}
      onHide={handleSessionDismiss}
      size="md"
      title={
        <span className="portal-welcome-title-row">
          <span className="portal-welcome-new-pill" aria-label="New feature">
            📅 NEW
          </span>
          <span>Welcome to Company Calendar</span>
        </span>
      }
      bodyClassName="portal-welcome-body"
      footerClassName="portal-welcome-footer"
      footer={
        <>
          <div className="portal-welcome-footer-actions w-100">
            <Form.Check
              type="checkbox"
              id="company-calendar-welcome-dont-show"
              className="portal-welcome-checkbox"
              label="Don't show again"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <Button variant="primary" onClick={handleGotIt}>
              Got it
            </Button>
          </div>
          <div className="portal-welcome-footer-links w-100">
            <Link href="/scheduler" onClick={handleSessionDismiss}>
              Open Technicians Scheduler
            </Link>
            <Link href="/dashboard/help" onClick={handleSessionDismiss}>
              Learn more in Help
            </Link>
          </div>
        </>
      }
    >
      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">What this is</h3>
        <p className="portal-welcome-text">
          Manage company <strong>holidays</strong> and <strong>day-offs</strong>, plus{" "}
          <strong>technician leave</strong> (annual, medical, and more) in one place.
        </p>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">Event types</h3>
        <div className="portal-welcome-legend-cards">
          {LEGEND_GROUPS.map((group) => (
            <div key={group.title} className="portal-welcome-legend-card">
              <div className="portal-welcome-legend-title">{group.title}</div>
              <div className="portal-welcome-legend-subtitle">{group.subtitle}</div>
              <div className="portal-welcome-legend-items">
                {group.types.map((item) => (
                  <span key={item.label} className="portal-welcome-legend-item">
                    <span
                      className="portal-welcome-swatch"
                      style={{ backgroundColor: item.color }}
                      aria-hidden
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">How it helps</h3>
        <ul className="portal-welcome-list">
          <li>
            <strong>Technicians Scheduler</strong> — overlays and warn-only alerts on holidays or leave.
          </li>
          <li>
            <strong>Attendance</strong> — expected hours and badges for leave vs punch mismatches.
          </li>
          <li>
            <strong>Worker profile → Employee Schedule</strong> — add or view upcoming leave.
          </li>
        </ul>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">Get started</h3>
        <ul className="portal-welcome-list">
          <li>Click a date or <strong>Add event</strong> to create an entry.</li>
          <li>Use <strong>Filter</strong> for company-only or a single technician.</li>
          {isAdmin ? (
            <li>As an admin, you can add, edit, and remove calendar events.</li>
          ) : (
            <li>Contact your admin to add holidays or leave. All users can view the calendar.</li>
          )}
        </ul>
      </section>
    </PortalModal>
  );
}

