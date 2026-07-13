import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Badge } from 'react-bootstrap';
import { useQuery } from 'react-query';
import { memoCreatorDisplayName } from '../../../lib/utils/memoCreatorDisplayName';
import { memoHtmlForDisplay } from '../../../lib/utils/memoHtml';
import richTextStyles from '../../../styles/richTextContent.module.css';
import PortalModal from '../../../components/portal/PortalModal';
import {
  DASHBOARD_BOOTSTRAP_QUERY_KEY,
  fetchDashboardBootstrapFromApi,
  readCachedDashboardBootstrap,
} from '../../../utils/dashboardBootstrapCache';

const SEEN_MEMO_IDS_KEY = 'fsm_company_memos_seen_ids';
const SESSION_DISMISSED_KEY = 'fsm_company_memos_session_dismissed';

function readSeenMemoIds() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEEN_MEMO_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function markMemoIdsSeen(ids = []) {
  if (typeof window === 'undefined' || !ids.length) return;
  try {
    const merged = [...new Set([...readSeenMemoIds(), ...ids.map(String)])];
    window.localStorage.setItem(SEEN_MEMO_IDS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}

function hasSessionDismissedModal() {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function markSessionDismissedModal() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_DISMISSED_KEY, '1');
  } catch {
    /* ignore */
  }
}

function priorityVariant(p) {
  if (p === 'high') return 'danger';
  if (p === 'low') return 'success';
  return 'warning';
}

export default function CompanyMemosSignInModal() {
  const [open, setOpen] = useState(false);
  const hasTriggeredRef = useRef(false);

  const { data: bootstrap } = useQuery(
    DASHBOARD_BOOTSTRAP_QUERY_KEY,
    async () => {
      const cached = readCachedDashboardBootstrap();
      if (cached) return cached;
      return fetchDashboardBootstrapFromApi();
    },
    { staleTime: 60 * 1000, refetchOnWindowFocus: false }
  );

  const memos = bootstrap?.companyMemos ?? bootstrap?.signInMemos ?? [];

  const unseenMemos = useMemo(() => {
    const seenIds = new Set(readSeenMemoIds());
    return memos.filter((memo) => memo?.id && !seenIds.has(String(memo.id)));
  }, [memos]);

  useEffect(() => {
    if (!unseenMemos.length) return;
    if (hasTriggeredRef.current || hasSessionDismissedModal()) return;

    hasTriggeredRef.current = true;
    markSessionDismissedModal();
    setOpen(true);
  }, [unseenMemos]);

  const handleClose = () => {
    markMemoIdsSeen(unseenMemos.map((memo) => memo.id));
    markSessionDismissedModal();
    setOpen(false);
  };

  if (!unseenMemos.length) return null;

  const single = unseenMemos.length === 1;
  const headerTitle = single
    ? unseenMemos[0].subject?.trim() || 'Company announcement'
    : 'Company announcements';

  return (
    <PortalModal
      show={open}
      onHide={handleClose}
      scrollable
      size="sm"
      title={
        single ? (
          headerTitle
        ) : (
          <span className="d-flex align-items-center gap-2 flex-wrap">
            <span aria-hidden>📢</span>
            {headerTitle}
          </span>
        )
      }
      titleClassName="portal-memo-title"
      headerClassName="portal-memo-header"
      bodyClassName="portal-memo-body"
      footerClassName="portal-memo-footer"
      footer={
        <>
          <Button
            variant="outline-primary"
            as={Link}
            href="/dashboard/whats-new"
            onClick={handleClose}
          >
            What&apos;s New
          </Button>
          <Button variant="primary" onClick={handleClose}>
            Close
          </Button>
        </>
      }
    >
      {unseenMemos.map((m) => {
        const fromLabel = memoCreatorDisplayName(m.creator);
        return (
          <div key={m.id} className="portal-memo-block">
            {!single ? (
              <div className="portal-memo-subject-row">
                <h3 className="portal-memo-subject flex-grow-1 mb-0">
                  {m.subject || '—'}
                </h3>
                {m.priority ? (
                  <Badge
                    bg={priorityVariant(m.priority)}
                    className="text-capitalize flex-shrink-0 align-self-start"
                    style={{
                      borderRadius: 20,
                      fontWeight: 500,
                      padding: '0.35em 0.65em',
                    }}
                  >
                    {m.priority}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            {m.body ? (
              <div
                className={`portal-memo-html ${richTextStyles.memoReadContent}`}
                dangerouslySetInnerHTML={{
                  __html: memoHtmlForDisplay(m.body),
                }}
              />
            ) : null}
            {fromLabel ? (
              <p className="portal-memo-from mb-0 mt-1">
                From: {fromLabel}
              </p>
            ) : null}
          </div>
        );
      })}
    </PortalModal>
  );
}
