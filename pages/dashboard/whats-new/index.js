import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { Container, Row, Col, Badge, Card, Spinner } from 'react-bootstrap';
import { format } from 'date-fns';
import { Copy, Check } from 'react-feather';
import { useQuery } from 'react-query';
import toast from 'react-hot-toast';
import { GeeksSEO } from 'widgets';
import { DashboardHeader } from 'sub-components';
import DefaultDashboardLayout from 'layouts/dashboard/DashboardIndexTop';
import { UPDATE_LOGS_FOLDER } from '../../../lib/constants/companyMemoFolders';
import { memoCreatorDisplayName } from '../../../lib/utils/memoCreatorDisplayName';
import { memoHtmlForDisplay } from '../../../lib/utils/memoHtml';
import richTextStyles from '../../../styles/richTextContent.module.css';
import styles from './WhatsNew.module.css';

function priorityVariant(p) {
  if (p === 'high') return 'danger';
  if (p === 'low') return 'success';
  return 'warning';
}

function formatReleaseDate(iso) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'd MMMM yyyy');
  } catch {
    return '—';
  }
}

function formatNavDate(iso) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'd MMM yyyy');
  } catch {
    return '—';
  }
}

function buildMemoLink(id) {
  if (typeof window === 'undefined') return `/dashboard/whats-new${id ? `?memo=${id}` : ''}`;
  const base = `${window.location.origin}/dashboard/whats-new`;
  return id ? `${base}?memo=${encodeURIComponent(id)}` : base;
}

function truncateSubject(s, n = 42) {
  if (!s) return 'Untitled update';
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function isMemoExpired(row) {
  if (!row?.expires_at) return false;
  return new Date(row.expires_at) <= new Date();
}

const WhatsNewPage = () => {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState(null);
  const highlightId = useMemo(() => {
    const raw = router.query.memo;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [router.query.memo]);

  const { data: entries = [], isLoading, isError } = useQuery(
    ['company-memos', 'update-logs'],
    async () => {
      const r = await fetch('/api/company-memos/update-logs', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || 'Failed to load update logs');
      }
      const j = await r.json();
      return Array.isArray(j.entries) ? j.entries : [];
    },
    { staleTime: 60 * 1000, refetchOnWindowFocus: true }
  );

  const entriesByMonth = useMemo(() => {
    const map = new Map();
    for (const entry of entries) {
      let monthKey = 'Unknown date';
      try {
        monthKey = format(new Date(entry.created_at), 'MMMM yyyy');
      } catch {
        /* keep default */
      }
      if (!map.has(monthKey)) map.set(monthKey, []);
      map.get(monthKey).push(entry);
    }
    return map;
  }, [entries]);

  const highlightRef = useRef(null);
  const activeId = highlightId || entries[0]?.id;

  const scrollToEntry = useCallback((id) => {
    if (!id) return;
    const el = document.getElementById(`memo-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    router.replace(
      { pathname: '/dashboard/whats-new', query: { memo: id } },
      undefined,
      { shallow: true }
    );
  }, [router]);

  useEffect(() => {
    if (!highlightId || !entries.length || isLoading) return;
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
  }, [highlightId, entries.length, isLoading]);

  const copyEntryLink = useCallback(async (id, e) => {
    e?.stopPropagation?.();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(buildMemoLink(id));
      setCopiedId(id);
      toast.success('Link copied');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  }, []);

  return (
    <Container className={`mt-1 mb-6 ${styles.page}`}>
      <GeeksSEO title="What's New | SAS&ME Portal" />
      <DashboardHeader
        title="What's New"
        subtitle={`Portal updates and release notes from ${UPDATE_LOGS_FOLDER} memos.`}
        breadcrumbs={[
          { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
          { label: "What's New" },
        ]}
      />

      <Row>
        <Col lg={8} className="order-2 order-lg-1">
          {isLoading ? (
            <div className={styles.loadingWrap}>
              <Spinner animation="border" variant="primary" />
              <p className={styles.loadingText}>Loading release notes…</p>
            </div>
          ) : isError ? (
            <Card className={styles.stateCard}>
              <Card.Body className="text-center text-danger py-5">
                Could not load update logs. Try refreshing the page.
              </Card.Body>
            </Card>
          ) : entries.length === 0 ? (
            <Card className={styles.stateCard}>
              <Card.Body className={styles.emptyState}>
                <p className="mb-2 fw-semibold text-body">No release notes yet</p>
                <p className="mb-0 small">
                  When your team publishes memos in the{' '}
                  <strong>{UPDATE_LOGS_FOLDER}</strong> folder, they will appear here as a
                  timeline.
                </p>
              </Card.Body>
            </Card>
          ) : (
            <ol className={styles.timeline} aria-label="Portal update timeline">
              {entries.map((entry, index) => {
                const isHighlight = activeId && entry.id === activeId;
                const expired = isMemoExpired(entry);
                const fromLabel = memoCreatorDisplayName(entry.creator);
                return (
                  <li
                    key={entry.id}
                    id={`memo-${entry.id}`}
                    ref={isHighlight ? highlightRef : undefined}
                    className={`${styles.entry} ${isHighlight ? styles.entryHighlight : ''} ${
                      expired ? styles.entryExpired : ''
                    }`}
                  >
                    <span className={styles.dot} aria-hidden />
                    <article className={styles.card}>
                      <header className={styles.cardHeader}>
                        <div className="d-flex flex-wrap align-items-start justify-content-between gap-2">
                          <div>
                            <p className={`${styles.dateLabel} mb-1`}>
                              {formatReleaseDate(entry.created_at)}
                            </p>
                            <h2 className={styles.cardTitle}>{entry.subject}</h2>
                          </div>
                          <div className={styles.badgeRow}>
                            {entry.priority ? (
                              <Badge
                                bg={priorityVariant(entry.priority)}
                                className={`text-capitalize ${styles.priorityPill}`}
                              >
                                {entry.priority}
                              </Badge>
                            ) : null}
                            {index === 0 && !expired ? (
                              <Badge className={styles.latestPill}>Latest</Badge>
                            ) : null}
                            {expired ? (
                              <Badge bg="secondary" className={styles.expiredPill}>
                                Expired
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </header>
                      <div className={styles.cardBody}>
                        {entry.body ? (
                          <div
                            className={`${styles.memoHtml} ${richTextStyles.memoReadContent}`}
                            dangerouslySetInnerHTML={{
                              __html: memoHtmlForDisplay(entry.body),
                            }}
                          />
                        ) : (
                          <p className="text-muted mb-0">No details provided.</p>
                        )}
                        <div className={styles.cardFooter}>
                          {fromLabel ? (
                            <p className={styles.cardFooterMeta}>Published by {fromLabel}</p>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            className={`${styles.copyLinkBtn} ${
                              copiedId === entry.id ? styles.copyLinkBtnCopied : ''
                            }`}
                            onClick={(e) => copyEntryLink(entry.id, e)}
                          >
                            {copiedId === entry.id ? (
                              <>
                                <Check size={14} aria-hidden />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy size={14} aria-hidden />
                                Copy link
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </Col>

        <Col lg={4} className="order-1 order-lg-2 mt-0 mb-4 mb-lg-0">
          <aside className={styles.sidebarSticky}>
            <div className={styles.sidebarPanel}>
              {entries.length > 0 ? (
                <>
                  <div className={styles.sidebarHeader}>
                    <h2 className={styles.sidebarTitle}>On this page</h2>
                    <span className={styles.sidebarCount}>
                      {entries.length} {entries.length === 1 ? 'update' : 'updates'}
                    </span>
                  </div>
                  <nav aria-label="Update navigation" className={styles.quickNav}>
                    {[...entriesByMonth.entries()].map(([monthLabel, monthEntries]) => (
                      <div key={monthLabel} className={styles.quickNavGroup}>
                        <p className={styles.quickNavMonth}>{monthLabel}</p>
                        <ul className={styles.quickNavList}>
                          {monthEntries.map((entry) => {
                            const isActive = entry.id === activeId;
                            const expired = isMemoExpired(entry);
                            return (
                              <li key={entry.id}>
                                <button
                                  type="button"
                                  className={`${styles.quickNavItem} ${
                                    isActive ? styles.quickNavItemActive : ''
                                  }`}
                                  onClick={() => scrollToEntry(entry.id)}
                                  aria-current={isActive ? 'location' : undefined}
                                >
                                  <span className={styles.quickNavItemRow}>
                                    <span className={styles.quickNavItemDate}>
                                      {formatNavDate(entry.created_at)}
                                    </span>
                                    {isActive ? (
                                      <span className={styles.quickNavViewing}>Viewing</span>
                                    ) : expired ? (
                                      <span className={styles.quickNavExpired}>Expired</span>
                                    ) : null}
                                  </span>
                                  <span className={styles.quickNavItemTitle}>
                                    {truncateSubject(entry.subject, 64)}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </nav>
                </>
              ) : null}

              <div className={styles.sidebarAbout}>
                <p className={styles.sidebarAboutTitle}>About</p>
                <p className={styles.sidebarAboutText}>
                  Portal updates and technical changes for SAS&amp;ME FSM, sourced from{' '}
                  {UPDATE_LOGS_FOLDER} memos.
                </p>
                <ul className={styles.sidebarAboutList}>
                  <li>Newest updates appear at the top</li>
                  <li>All updates stay visible here, even after memo expiry</li>
                </ul>
              </div>
            </div>
          </aside>
        </Col>
      </Row>
    </Container>
  );
};

WhatsNewPage.Layout = DefaultDashboardLayout;
export default WhatsNewPage;
