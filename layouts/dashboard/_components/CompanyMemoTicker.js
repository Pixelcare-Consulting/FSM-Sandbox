import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import Link from 'next/link';
import { useQuery } from 'react-query';
import { FaBullhorn, FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { memoCreatorDisplayName } from '../../../lib/utils/memoCreatorDisplayName';
import { memoBodyToPlainText, memoHtmlForDisplay } from '../../../lib/utils/memoHtml';
import richTextStyles from '../../../styles/richTextContent.module.css';
import styles from './CompanyMemoTicker.module.css';

const ROTATE_MS = 7000;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(!!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

export default function CompanyMemoTicker() {
  const reducedMotion = usePrefersReducedMotion();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: memos = [], isLoading } = useQuery(
    ['company-memos', 'header'],
    async () => {
      try {
        const r = await fetch('/api/company-memos/header-ticker', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.memos)) return j.memos;
        }
      } catch {
        /* API-only — no browser Supabase fallback */
      }
      return [];
    },
    {
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    }
  );

  useEffect(() => {
    setIndex(0);
  }, [memos.length]);

  const count = memos.length;
  const current = count ? memos[Math.min(index, count - 1)] : null;

  useEffect(() => {
    if (count <= 1 || paused || detailOpen || typeof document === 'undefined') {
      return;
    }
    let hidden = document.visibilityState === 'hidden';
    const onVis = () => {
      hidden = document.visibilityState === 'hidden';
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(() => {
      if (hidden) return;
      setIndex((i) => (i + 1) % count);
    }, ROTATE_MS);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [count, paused, detailOpen]);

  const goPrev = useCallback(() => {
    if (count <= 1) return;
    setIndex((i) => (i - 1 + count) % count);
  }, [count]);

  const goNext = useCallback(() => {
    if (count <= 1) return;
    setIndex((i) => (i + 1) % count);
  }, [count]);

  const priorityClass = useMemo(() => {
    if (!current) return '';
    if (current.priority === 'high') return styles.pillHigh;
    if (current.priority === 'low') return styles.pillLow;
    return styles.pillMedium;
  }, [current]);

  if (isLoading || !count || !current) return null;

  const fromLabel =
    memoCreatorDisplayName(current.creator) || current.created_by || '';

  let detailBodyEl;
  if (current.body) {
    const safe = memoHtmlForDisplay(current.body);
    detailBodyEl = (
      <div
        className={`${styles.memoDetailHtml} ${richTextStyles.memoReadContent}`}
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  } else {
    detailBodyEl = (
      <p className={styles.memoDetailBodyMuted}>No additional message text.</p>
    );
  }

  const onHideDetail = () => setDetailOpen(false);

  return (
    <>
      <div
        className={`${styles.tickerWrap} d-none d-lg-flex align-items-center ms-3 me-2 flex-grow-1 min-w-0`}
        role="region"
        aria-label="Company memos"
        aria-live="polite"
      >
        <div className={styles.tickerRow}>
          <span className={styles.tickerMegaphone} aria-hidden>
            <FaBullhorn size={18} />
          </span>
          <div
            className={`${styles.track} min-w-0 flex-grow-1`}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <button
              type="button"
              className={`${styles.slideInner} btn btn-link text-start text-decoration-none p-0`}
              onClick={() => setDetailOpen(true)}
              title={
                memoBodyToPlainText(current.body || '')
                  ? `${current.subject || ''} — ${memoBodyToPlainText(current.body).slice(0, 160)}`.trim()
                  : current.subject || ''
              }
            >
              <span
                key={current.id}
                className={reducedMotion ? styles.slideContentReduced : styles.slideContent}
              >
                <span className={`${styles.pill} ${priorityClass} me-2`}>{current.priority}</span>
                <span className={styles.subject}>{current.subject}</span>
              </span>
            </button>
          </div>
          {count > 1 ? (
            <div className={`${styles.controls} d-flex align-items-center flex-shrink-0 ms-1`}>
              <button
                type="button"
                className="btn btn-sm btn-link p-1"
                aria-label="Previous memo"
                onClick={goPrev}
              >
                <FaChevronLeft size={12} />
              </button>
              <span key={`${index}-${count}`} className={styles.counter}>
                {index + 1}/{count}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-link p-1"
                aria-label="Next memo"
                onClick={goNext}
              >
                <FaChevronRight size={12} />
              </button>
            </div>
          ) : null}
          {isAdmin ? (
            <Link
              href="/dashboard/company-memos"
              className={`${styles.manageLink} flex-shrink-0 small ms-2`}
            >
              Manage
            </Link>
          ) : null}
        </div>
      </div>

      <Modal
        show={detailOpen}
        onHide={onHideDetail}
        centered
        scrollable
        className={styles.memoDetailOuter}
        contentClassName={styles.memoDetailContent}
      >
        <Fragment>
          <div className={styles.memoDetailAccent} aria-hidden />
          <Modal.Header closeButton className={styles.memoDetailHeader}>
            <div className={styles.memoDetailHeaderInner}>
              <Modal.Title as="div" className={styles.memoDetailTitle}>
                {current.subject}
              </Modal.Title>
              {current.priority ? (
                <span
                  className={`${styles.detailPill} ${priorityClass}`}
                  title="Priority"
                >
                  {current.priority}
                </span>
              ) : null}
            </div>
          </Modal.Header>
          <Modal.Body className={styles.memoDetailBody}>
            {detailBodyEl}
            {fromLabel ? (
              <p className={styles.memoDetailFrom}>
                From: <strong>{fromLabel}</strong>
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer className={styles.memoDetailFooter}>
            <Button variant="primary" onClick={onHideDetail}>
              Close
            </Button>
          </Modal.Footer>
        </Fragment>
      </Modal>
    </>
  );
}
