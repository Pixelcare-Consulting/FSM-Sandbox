import React, { useEffect, useState } from "react";
import { Button, Form } from "react-bootstrap";
import PortalModal from "../../../../components/portal/PortalModal";

export const WELCOME_SEEN_KEY = "fsm_payment_confirmation_welcome_seen_v1";
export const WELCOME_SESSION_KEY = "fsm_payment_confirmation_welcome_session_dismissed_v1";

const FEATURE_CARDS = [
  {
    title: "PayNow QR",
    subtitle: "Generate payment QR",
    items: ["Bank & UEN", "Invoice ref", "Amount & expiry"],
  },
  {
    title: "Mark as Paid",
    subtitle: "Confirm payment received",
    items: ["Pending → Paid", "Optional bank reference"],
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

export default function PaymentConfirmationWelcomeModal({ show, onHide }) {
  const [dontShowAgain, setDontShowAgain] = useState(true);

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
            💳 NEW
          </span>
          <span>Payment Confirmation</span>
        </span>
      }
      bodyClassName="portal-welcome-body"
      footerClassName="portal-welcome-footer"
      footer={
        <div className="portal-welcome-footer-actions w-100">
          <Form.Check
            type="checkbox"
            id="payment-confirmation-welcome-dont-show"
            className="portal-welcome-checkbox"
            label="Don't show again"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <Button variant="primary" onClick={handleGotIt}>
            Got it
          </Button>
        </div>
      }
    >
      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">What this is</h3>
        <p className="portal-welcome-text">
          For <strong>completed jobs</strong>, confirm customer payment and generate{" "}
          <strong>PayNow QR</strong> codes. Use <strong>Mark as Paid</strong> after verifying
          payment in DBS IDEAL / bank statement.
        </p>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">What you can do</h3>
        <div className="portal-welcome-legend-cards">
          {FEATURE_CARDS.map((card) => (
            <div key={card.title} className="portal-welcome-legend-card">
              <div className="portal-welcome-legend-title">{card.title}</div>
              <div className="portal-welcome-legend-subtitle">{card.subtitle}</div>
              <ul className="portal-welcome-list mb-0">
                {card.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">How it helps</h3>
        <p className="portal-welcome-text">
          Payment records are stored for accurate job history and future{" "}
          <strong>Payroll</strong> reconciliation.
        </p>
      </section>

      <section className="portal-welcome-section">
        <h3 className="portal-welcome-section-title">Get started</h3>
        <ul className="portal-welcome-list">
          <li>
            On completed jobs: fill payment details → <strong>Generate QR</strong>.
          </li>
          <li>
            After the customer pays, toggle <strong>Mark as Paid</strong>.
          </li>
        </ul>
      </section>
    </PortalModal>
  );
}
