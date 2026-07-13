import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useAppWarmupContext } from '../contexts/AppWarmupContext';

export default function AppWarmupOverlay() {
  const { isWarming, progress, label } = useAppWarmupContext();

  if (!isWarming) return null;

  return (
    <div
      className="app-warmup-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="app-warmup-card shadow-lg">
        <Spinner animation="border" variant="primary" className="mb-3" />
        <div className="fw-semibold text-dark mb-1">Loading your workspace</div>
        <div className="text-muted small mb-3">{label || 'Preparing data…'}</div>
        <div className="progress" style={{ height: 6 }}>
          <div
            className="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            style={{ width: `${Math.max(5, progress)}%` }}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>
      <style jsx global>{`
        .app-warmup-overlay {
          position: fixed;
          inset: 0;
          z-index: 10050;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(4px);
        }
        .app-warmup-card {
          width: min(360px, 92vw);
          padding: 1.5rem 1.75rem;
          border-radius: 1rem;
          background: #fff;
          text-align: center;
        }
        .app-warmup-card .progress-bar {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
        }
      `}</style>
    </div>
  );
}
