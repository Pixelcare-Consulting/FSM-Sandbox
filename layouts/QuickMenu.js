/* eslint-disable react/display-name */
import Link from 'next/link';
import React, { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useMediaQuery } from "react-responsive";
import { ListGroup, Dropdown, Badge, Button, InputGroup, Form } from "react-bootstrap";
import Image from "next/image";
import SimpleBar from "simplebar-react";
import { FaBell, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { globalQuickSearch } from '../utils/searchUtils';
import useMounted from "hooks/useMounted";
import { useRouter } from "next/router";
import Cookies from "js-cookie";
import { useQueryClient } from 'react-query';
import { getSupabaseClient } from "../lib/supabase/client";
import { useNotificationsQuery } from '../hooks/queries/useNotificationsQuery';
import { useDashboardBootstrap } from '../hooks/useDashboardBootstrap';
import { useCurrentUserProfile } from '@/hooks/useCurrentUser';
import { readCachedDashboardBootstrap, invalidateDashboardBootstrapCache } from '../utils/dashboardBootstrapCache';
import Swal from 'sweetalert2';
import { invalidateNotificationCache } from '../utils/notificationCache';
import { getCompanyDetails } from '../utils/companyCache';
// Removed: useSessionRenewal and handleSessionError - Session management now handled by ActivityTracker in _app.js
import { useLogo } from '../contexts/LogoContext';
import debounce from 'lodash/debounce';
import styles from './QuickMenu.module.css';
import { formatNotificationTime } from '../utils/notificationTime';

const sanitizeNameValue = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const invalidTokens = ['na', 'n/a', 'null', 'undefined', '-'];
  return invalidTokens.includes(trimmed.toLowerCase()) ? null : trimmed;
};

const JOB_NOTIF_TYPES_WITH_FALLBACK = new Set([
  'job_assigned',
  'job_created',
  'job_reassigned',
  'job_updated',
  'follow_up_created',
]);

/** Resolve in-app path for a notification row (prefers `action_href` from DB). */
function resolveNotificationHref(notification) {
  const raw = notification?.action_href ?? notification?.actionHref;
  if (raw && typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('/')) return t;
  }
  const type = notification?.type;
  if (type === 'follow_up_created') {
    return '/dashboard/follow-ups';
  }
  if (JOB_NOTIF_TYPES_WITH_FALLBACK.has(type)) {
    return '/dashboard/jobs/list-jobs';
  }
  return null;
}

const getStatusTag = (type, status) => {
  const statusClasses = {
    'Created': styles.qmStatusCreated,
    'In Progress': styles.qmStatusInProgress,
    'Completed': styles.qmStatusCompleted,
    'Cancelled': styles.qmStatusCancelled,
    'Pending': styles.qmStatusPending
  };

  const statusClass = statusClasses[status] || styles.qmStatusPending;

  return (
    <span className={`${styles.qmStatusTag} ${statusClass}`}>
      {status}
    </span>
  );
};

const NotificationListItem = React.memo(function NotificationListItem({ notification, onActivate }) {
  const unread = !notification.read;
  const href = resolveNotificationHref(notification);
  const handleClick = () => {
    onActivate(notification);
  };
  return (
    <ListGroup.Item
      action
      as="button"
      type="button"
      title={href ? 'Open' : 'Mark as read'}
      className={`${styles.qmNotifItem} border-0 border-bottom ${unread ? styles.qmNotifItemUnread : ''}`}
      onClick={handleClick}
    >
      <div className="d-flex align-items-start gap-3 w-100">
        <div className={`${styles.qmNotifIconWrap} flex-shrink-0`}>
          <FaBell size={14} className="text-primary" aria-hidden />
        </div>
        <div className="flex-grow-1 text-start overflow-hidden min-w-0">
          <div className={`${styles.qmNotifTitle} text-truncate`}>{notification.title}</div>
          {notification.message ? (
            <div className={`${styles.qmNotifBody} text-truncate`}>{notification.message}</div>
          ) : null}
          <div className={styles.qmNotifTime}>{formatNotificationTime(notification.created_at)}</div>
        </div>
        {unread ? (
          <span className={styles.qmNotifUnreadDot} title="Unread" aria-label="Unread" />
        ) : null}
      </div>
    </ListGroup.Item>
  );
});
NotificationListItem.displayName = 'NotificationListItem';

const SearchResults = React.memo(({ results, onClose, router, isSearching }) => {
  const groupedResults = {
    customers: results.filter((r) => r.type === 'customer'),
    leads: results.filter((r) => r.type === 'lead'),
    workers: results.filter((r) => r.type === 'worker'),
    jobs: results.filter((r) => r.type === 'job'),
    followUps: results.filter((r) => r.type === 'followUp'),
  };

  const searchCategoryTitles = {
    customers: 'Customers',
    leads: 'Leads (masterlist)',
    workers: 'Workers',
    jobs: 'Jobs',
    followUps: 'Follow Ups',
  };

  const renderHighlightedText = (text) => {
    if (!text) return '';
    
    const parts = text.split(/\[\[HIGHLIGHT\]\]|\[\[\/HIGHLIGHT\]\]/);
    
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return (
          <strong 
            key={index}
            className={styles.qmHighlightText}
          >
            {part}
          </strong>
        );
      }
      return part;
    });
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'customers':
        return <i className="fe fe-users me-2"></i>;
      case 'leads':
        return <i className="fe fe-user-plus me-2"></i>;
      case 'workers':
        return <i className="fe fe-user-check me-2"></i>;
      case 'jobs':
        return <i className="fe fe-briefcase me-2"></i>;
      case 'followUps':
        return <i className="fe fe-bell me-2"></i>;
      default:
        return null;
    }
  };

  const handleItemClick = (link) => {
    router.push(link);
    onClose();
  };

  return (
    <SimpleBar style={{ maxHeight: "400px" }}>
      <ListGroup variant="flush">
        {isSearching ? (
          <ListGroup.Item>
            <div className={styles.qmLoadingState}>
              <div className={`spinner-border spinner-border-sm ${styles.qmSpinner}`} role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              Searching...
            </div>
          </ListGroup.Item>
        ) : results.length === 0 ? (
          <ListGroup.Item>
            <div className={styles.qmEmptyState}>
              <i className={`fe fe-search ${styles.qmEmptyIcon}`}></i>
              <p className={styles.qmEmptyText}>No results found</p>
            </div>
          </ListGroup.Item>
        ) : (
          Object.entries(groupedResults).map(([category, items]) => (
            items.length > 0 && (
              <div key={category}>
                <div className={styles.qmCategoryHeader}>
                  <strong className={styles.qmCategoryTitle}>
                    {getCategoryIcon(category)}
                    {searchCategoryTitles[category] || category.replace(/([A-Z])/g, ' $1').trim()}
                    <span className={styles.qmCategoryCount}>({items.length})</span>
                  </strong>
                </div>
                {items.map((item) => (
                  <ListGroup.Item
                    key={item.id}
                    action
                    onClick={() => handleItemClick(item.link)}
                    className={styles.qmSearchItem}
                  >
                    <div className="d-flex flex-column">
                      <div className="d-flex align-items-center mb-1">
                        <span className={styles.qmSearchItemTitle}>
                          {renderHighlightedText(item.title)}
                        </span>
                        {item.type === 'job' && item.status && getStatusTag(item.type, item.status)}
                      </div>
                      {item.subtitle && (
                        <small className={styles.qmSearchItemSubtitle}>
                          {renderHighlightedText(item.subtitle)}
                        </small>
                      )}
                      {item.type === 'worker' && (
                        <div className={styles.qmWorkerInfo}>
                          <small className={styles.qmWorkerEmail}>
                            <i className="fe fe-mail me-1"></i>
                            {renderHighlightedText(item.workerID)}
                          </small>
                          {item.role && (
                            <small className={styles.qmWorkerRole}>
                              <i className="fe fe-tag me-1"></i>
                              {item.role}
                            </small>
                          )}
                        </div>
                      )}
                    </div>
                  </ListGroup.Item>
                ))}
              </div>
            )
          ))
        )}
      </ListGroup>
    </SimpleBar>
  );
});

SearchResults.displayName = 'SearchResults';

// Memoize the user avatar component
const UserAvatar = React.memo(({ userDetails }) => {
  return (
    <div className={styles.qmAvatarWrapper}>
      {userDetails?.profilePicture ? (
        <div className={styles.qmAvatarContainer}>
          <Image
            alt="avatar"
            src={userDetails.profilePicture}
            className={styles.qmAvatarImage}
            width={38}
            height={38}
            priority // Add priority to load image faster
          />
          <div className={styles.qmAvatarStatus} />
        </div>
      ) : (
        <div className={styles.qmAvatarContainer}>
          <Image
            alt="default avatar"
            src="/images/avatar/NoProfile.png"
            className={styles.qmAvatarDefault}
            width={38}
            height={38}
            priority // Add priority to load image faster
          />
          <div className={styles.qmAvatarStatusDefault} />
        </div>
      )}
      {userDetails && (
        <div className={styles.qmAvatarName}>
          <span>{userDetails.fullName}</span>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.userDetails?.profilePicture === nextProps.userDetails?.profilePicture &&
         prevProps.userDetails?.fullName === nextProps.userDetails?.fullName;
});

const SearchBar = React.memo(({ value, onChange, onSubmit, onClear }) => {
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && value.trim()) {
      onSubmit(e);
    }
  };

  const handleClear = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClear();
  };

  return (
    <div className={styles.modernSearchContainer}>
      <div className={styles.modernSearchWrapper}>
        <div className={styles.modernSearchInputContainer}>
          <input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            role="searchbox"
            placeholder="Search masterlist customers, leads & form leads (name, code, phone, email, address)…"
            aria-label="Search portal DB masterlist customers, SAP leads, and form leads"
            value={value}
            onChange={onChange}
            onKeyPress={handleKeyPress}
            className={styles.modernSearchInput}
          />
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className={styles.modernSearchClear}
              aria-label="Clear search"
            >
              <FaTimes size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim()}
          className={styles.modernSearchButton}
          aria-label="Search"
        >
          <FaSearch size={14} />
        </button>
      </div>
      {/* <small className={styles.modernSearchHint}>
        Masterlist customers and SAP leads (portal DB), plus portal form leads (name, code, email, phone, address)
      </small> */}
    </div>
  );
});

SearchBar.displayName = 'SearchBar';

const QuickMenu = ({ children }) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const hasMounted = useMounted();
  const isDesktop = useMediaQuery({ query: "(min-width: 1224px)" });
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const { logo, setLogo } = useLogo();
  // Session management is handled by ActivityTracker in _app.js
  // Removed duplicate initializeSessionRenewalCheck to prevent conflicts

  const { data: bootstrap } = useDashboardBootstrap();
  const { profile: userDetails, user: currentUser } = useCurrentUserProfile();

  useEffect(() => {
    const email = sanitizeNameValue(Cookies.get("email")) || sanitizeNameValue(Cookies.get("username"));
    if (!email) {
      router.push("/sign-in");
    }
  }, [router]);

  useEffect(() => {
    if (!userDetails?.fullName) return;
    Cookies.set("fullName", userDetails.fullName, { expires: 7 });
    if (userDetails.username) {
      Cookies.set("username", userDetails.username, { expires: 7 });
    }
  }, [userDetails?.fullName, userDetails?.username]);

  // Company logo: bootstrap → localStorage → getCompanyDetails (single path)
  useEffect(() => {
    if (logo !== '/images/SAS-LOGO.png') return;

    const fromBootstrap =
      bootstrap?.companyInfo?.logo ||
      readCachedDashboardBootstrap()?.companyInfo?.logo;
    if (fromBootstrap) {
      setLogo(fromBootstrap);
      localStorage.setItem('companyLogo', fromBootstrap);
      return;
    }

    const cachedLogo = localStorage.getItem('companyLogo');
    if (cachedLogo) {
      setLogo(cachedLogo);
      return;
    }

    let cancelled = false;
    (async () => {
      const companyData = await getCompanyDetails();
      if (cancelled || !companyData?.logo) return;
      setLogo(companyData.logo);
      localStorage.setItem('companyLogo', companyData.logo);
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrap?.companyInfo?.logo, logo, setLogo]);

  // Sign out function
  const handleSignOut = async () => {
    try {
      // First show confirmation alert (without spinner - just confirmation)
      const confirmResult = await Swal.fire({
        title: '<span class="fw-bold text-primary">Sign Out? 👋</span>',
        html: `
          <div class="text-center mb-2">
            <div class="text-muted mb-2">Are you sure you want to sign out?</div>
          </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Yes, Sign Out',
        cancelButtonText: 'Cancel',
        allowOutsideClick: true,
        customClass: {
          popup: 'shadow-lg',
          confirmButton: 'btn btn-primary px-4 me-2',
          cancelButton: 'btn btn-outline-secondary px-4'
        },
        buttonsStyling: false
      });

      if (!confirmResult.isConfirmed) {
        return; // User cancelled
      }

      // Show loading state
      const loadingModal = Swal.fire({
        title: '<span class="fw-bold text-primary">Signing Out... 🔄</span>',
        html: `
          <div class="text-center mb-2">
            <div class="spinner-border text-primary mb-2" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <div class="text-muted mb-2">Clearing your session data...</div>
            <div class="progress" style="height: 6px;">
              <div class="progress-bar progress-bar-striped progress-bar-animated" 
                   role="progressbar" 
                   style="width: 15%">
              </div>
            </div>
          </div>
        `,
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: async (modal) => {
          try {
            // Store current time as last login
            localStorage.setItem('lastLoginTime', new Date().toISOString());

            // Update progress - 30%
            const progressBar = modal.querySelector('.progress-bar');
            const statusText = modal.querySelector('.text-muted');
            
            if (progressBar) progressBar.style.width = '30%';
            if (statusText) statusText.textContent = 'Disconnecting from SAP services...';
            await new Promise(resolve => setTimeout(resolve, 500));

            // Perform logout API call
            let logoutSuccess = false;
            try {
              const response = await fetch("/api/logout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: 'include',
              });

              logoutSuccess = response.ok;
              if (!response.ok) {
                console.warn("Logout API returned non-OK status:", response.status);
              }
            } catch (apiError) {
              console.error("Logout API error:", apiError);
              // Continue with client-side cleanup even if API fails
            }

            // Update progress - 60%
            if (progressBar) progressBar.style.width = '60%';
            if (statusText) statusText.textContent = 'Clearing session cookies...';
            await new Promise(resolve => setTimeout(resolve, 400));

            // Clear ALL cookies (including session cookies that might not be cleared by API)
            const allCookiesToClear = [
              'B1SESSION',
              'B1SESSION_EXPIRY',
              'ROUTEID',
              'customToken',
              'accessToken',
              'uid',
              'isAdmin',
              'email',
              'workerId',
              'LAST_ACTIVITY',
              'fullName',
              'full_name',
              'fullname',
              'FullName',
              'username',
              'sapConnectionStatus'
            ];
            
            // Clear cookies with all possible paths and options
            allCookiesToClear.forEach(cookieName => {
              // Try multiple methods to ensure cookies are cleared
              Cookies.remove(cookieName, { path: '/' });
              Cookies.remove(cookieName, { path: '/', domain: window.location.hostname });
              Cookies.remove(cookieName); // Without path
              // Also try to set expired cookie
              document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
              document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
            });

            // Update progress - 80%
            if (progressBar) progressBar.style.width = '80%';
            if (statusText) statusText.textContent = 'Clearing local storage...';
            await new Promise(resolve => setTimeout(resolve, 300));

            // Clear relevant localStorage items
            try {
              queryClient.clear();
              invalidateDashboardBootstrapCache();
              localStorage.removeItem('welcomeShown');
              localStorage.removeItem('companyLogo');
              localStorage.removeItem('lastLoginTime');
              // Clear any session-related items
              Object.keys(localStorage).forEach(key => {
                if (key.includes('session') || key.includes('auth') || key.includes('token')) {
                  localStorage.removeItem(key);
                }
              });
            } catch (storageError) {
              console.warn("Error clearing localStorage:", storageError);
            }

            // Update progress - 90%
            if (progressBar) progressBar.style.width = '90%';
            if (statusText) statusText.textContent = 'Finalizing sign out...';
            await new Promise(resolve => setTimeout(resolve, 300));

            // Show success state
            const titleElement = modal.querySelector('.swal2-title');
            const htmlElement = modal.querySelector('.swal2-html-container');
            
            if (titleElement) {
              titleElement.innerHTML = '<span class="fw-bold text-success">Successfully Signed Out! 🎉</span>';
            }
            
            if (htmlElement) {
              htmlElement.innerHTML = `
                <div class="text-center">
                  <div class="text-muted mb-2">You have been successfully signed out</div>
                  <div class="progress mb-2" style="height: 6px;">
                    <div class="progress-bar bg-success" role="progressbar" style="width: 100%"></div>
                  </div>
                  <div class="countdown-text text-muted small mb-2">
                    Redirecting in <span class="fw-bold text-primary">3</span> seconds...
                  </div>
                </div>
              `;
            }

            // Countdown and redirect
            let countdown = 3;
            const countdownElement = htmlElement?.querySelector('.countdown-text .fw-bold');
            const countdownInterval = setInterval(() => {
              countdown--;
              if (countdownElement) {
                countdownElement.textContent = countdown;
              }
              if (countdown <= 0) {
                clearInterval(countdownInterval);
                // Use window.location.replace for better redirect (doesn't add to history)
                window.location.replace('/sign-in');
              }
            }, 1000);

          } catch (error) {
            console.error("Error during logout process:", error);
            queryClient.clear();
            // Even if there's an error, try to redirect
            Swal.close();
            // Clear cookies as fallback
            const allCookiesToClear = [
              'B1SESSION', 'B1SESSION_EXPIRY', 'ROUTEID', 'customToken',
              'uid', 'isAdmin', 'email', 'workerId', 'LAST_ACTIVITY'
            ];
            allCookiesToClear.forEach(cookie => {
              Cookies.remove(cookie, { path: '/' });
              document.cookie = `${cookie}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
            });
            window.location.replace('/sign-in');
          }
        }
      });

    } catch (error) {
      console.error("Error logging out:", error);
      queryClient.clear();
      
      // Try to clear cookies and redirect even on error
      try {
        const allCookiesToClear = [
          'B1SESSION', 'B1SESSION_EXPIRY', 'ROUTEID', 'customToken',
          'uid', 'isAdmin', 'email', 'workerId', 'LAST_ACTIVITY'
        ];
        allCookiesToClear.forEach(cookie => {
          Cookies.remove(cookie, { path: '/' });
          document.cookie = `${cookie}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        });
      } catch (clearError) {
        console.error("Error clearing cookies:", clearError);
      }
      
      Swal.fire({
        icon: 'error',
        iconColor: '#dc3545',
        title: '<span class="fw-bold text-danger">Sign Out Error</span>',
        html: `
          <div class="text-muted mb-2">
            ${error.message || 'Unable to complete the sign out process.'}
          </div>
          <div class="text-muted small">
            You will be redirected to the sign-in page.
          </div>
        `,
        showConfirmButton: true,
        confirmButtonText: 'Go to Sign In',
        customClass: {
          popup: 'shadow-lg',
          confirmButton: 'btn btn-primary px-4'
        },
        buttonsStyling: false,
        didClose: () => {
          window.location.replace('/sign-in');
        }
      });
    }
  };

  // Add these states for notifications
  const [notifications, setNotifications] = useState([]);
  const workerId = currentUser?.workerId;
  const uid = currentUser?.id || currentUser?.uid;
  /** Stable channel filter ids from bootstrap user (avoids resubscribe when profile loads). */
  const notificationSubjectIds = useMemo(() => {
    const ids = [];
    if (uid) ids.push(uid);
    if (workerId && workerId !== uid) ids.push(workerId);
    return [...new Set(ids.filter(Boolean))];
  }, [uid, workerId]);
  const userDetailsId = userDetails?.id;

  const allNotificationSubjectIds = useMemo(() => {
    const ids = [...notificationSubjectIds];
    if (userDetailsId && !ids.includes(userDetailsId)) {
      ids.push(userDetailsId);
    }
    return ids;
  }, [notificationSubjectIds, userDetailsId]);
  const allNotificationSubjectIdsRef = useRef(allNotificationSubjectIds);

  const [notifMenuShow, setNotifMenuShow] = useState(false);
  const notifHoverCloseTimer = useRef(null);
  /** After first fetch, used to toast only newly arriving job notifications (not backlog). */
  const seenNotificationIdsRef = useRef(new Set());
  const notificationDebounceRef = useRef(null);
  const lastNotifFetchRef = useRef(0);
  const inFlightLoadRef = useRef(null);
  const REALTIME_DEBOUNCE_MS = 2500;
  const MIN_VISIBILITY_REFETCH_MS = 30000;
  const MIN_NOTIF_FETCH_MS = 30000;
  const MIN_HOVER_REFETCH_MS = 5000;

  const {
    data: notificationsPayload,
    refetch: refetchNotificationsQuery,
  } = useNotificationsQuery({
    enabled: notificationSubjectIds.length > 0,
    limit: 20,
  });

  useEffect(() => {
    allNotificationSubjectIdsRef.current = allNotificationSubjectIds;
  }, [allNotificationSubjectIds]);

  useEffect(() => {
    const notificationsList = notificationsPayload?.notifications || [];
    const nextUnreadCount =
      notificationsPayload?.unreadCount ?? notificationsList.filter((n) => !n.read).length;

    seenNotificationIdsRef.current = new Set(notificationsList.map((n) => n.id));
    if (notificationsPayload?.fetchedAt) {
      lastNotifFetchRef.current = Date.now();
    }

    queueMicrotask(() => {
      setNotifications(notificationsList);
      setUnreadCount(nextUnreadCount);
    });
  }, [notificationsPayload]);

  const clearNotifHoverCloseTimer = () => {
    if (notifHoverCloseTimer.current) {
      clearTimeout(notifHoverCloseTimer.current);
      notifHoverCloseTimer.current = null;
    }
  };

  const loadNotifications = useCallback(async (options = {}) => {
    const { force = false } = options;

    if (!notificationSubjectIds.length) return;

    const now = Date.now();
    if (!force && lastNotifFetchRef.current > 0 && now - lastNotifFetchRef.current < MIN_NOTIF_FETCH_MS) {
      return;
    }

    if (inFlightLoadRef.current) {
      return inFlightLoadRef.current;
    }

    try {
      const promise = refetchNotificationsQuery().finally(() => {
        inFlightLoadRef.current = null;
      });
      inFlightLoadRef.current = promise;
      await promise;
    } catch (error) {
      console.error('Error loading notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [notificationSubjectIds, refetchNotificationsQuery]);

  const handleNotifToggle = useCallback(
    (nextOpen) => {
      setNotifMenuShow(nextOpen);
      if (nextOpen) {
        void loadNotifications({ force: true });
      }
    },
    [loadNotifications]
  );

  const handleNotifWrapperEnter = useCallback(() => {
    clearNotifHoverCloseTimer();
    setNotifMenuShow(true);
    const now = Date.now();
    if (
      notifications.length > 0 &&
      lastNotifFetchRef.current > 0 &&
      now - lastNotifFetchRef.current < MIN_HOVER_REFETCH_MS
    ) {
      return;
    }
    void loadNotifications();
  }, [loadNotifications, notifications.length]);

  const handleNotifWrapperLeave = useCallback(() => {
    clearNotifHoverCloseTimer();
    notifHoverCloseTimer.current = setTimeout(() => setNotifMenuShow(false), 220);
  }, []);

  useEffect(() => () => clearNotifHoverCloseTimer(), []);

  const scheduleNotificationRefresh = useCallback(() => {
    if (notificationDebounceRef.current) {
      clearTimeout(notificationDebounceRef.current);
    }
    notificationDebounceRef.current = setTimeout(() => {
      void loadNotifications();
    }, REALTIME_DEBOUNCE_MS);
  }, [loadNotifications]);

  const isNotificationForSubject = useCallback((row) => {
    if (!row) return false;
    const ids = allNotificationSubjectIdsRef.current;
    return row.worker_id == null || ids.includes(row.worker_id);
  }, []);

  const sortNotificationsByCreatedAt = useCallback((rows) => {
    return [...rows].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  }, []);

  const patchNotificationFromRealtime = useCallback(
    (payload) => {
      const eventType = payload.eventType;
      const newRow = payload.new;
      const oldRow = payload.old;
      const rowId = newRow?.id || oldRow?.id;

      if (!rowId) {
        scheduleNotificationRefresh();
        return;
      }

      if (eventType === 'DELETE' || newRow?.hidden) {
        setNotifications((prev) => {
          const next = prev.filter((n) => n.id !== rowId);
          setUnreadCount(next.filter((n) => !n.read).length);
          return next;
        });
        return;
      }

      if (!isNotificationForSubject(newRow)) {
        return;
      }

      if (eventType === 'INSERT') {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === rowId)) return prev;
          const next = sortNotificationsByCreatedAt([newRow, ...prev]).slice(0, 20);
          setUnreadCount(next.filter((n) => !n.read).length);
          seenNotificationIdsRef.current.add(rowId);
          return next;
        });
        return;
      }

      if (eventType === 'UPDATE' && newRow) {
        setNotifications((prev) => {
          const idx = prev.findIndex((n) => n.id === rowId);
          if (idx < 0) {
            const next = sortNotificationsByCreatedAt([newRow, ...prev]).slice(0, 20);
            setUnreadCount(next.filter((n) => !n.read).length);
            return next;
          }
          const next = [...prev];
          next[idx] = { ...next[idx], ...newRow };
          setUnreadCount(next.filter((n) => !n.read).length);
          return next;
        });
        return;
      }

      scheduleNotificationRefresh();
    },
    [isNotificationForSubject, scheduleNotificationRefresh, sortNotificationsByCreatedAt]
  );

  const loadNotificationsRef = useRef(loadNotifications);
  const patchNotificationFromRealtimeRef = useRef(patchNotificationFromRealtime);

  useEffect(() => {
    loadNotificationsRef.current = loadNotifications;
    patchNotificationFromRealtimeRef.current = patchNotificationFromRealtime;
  }, [loadNotifications, patchNotificationFromRealtime]);

  // Notification realtime subscribe (initial fetch is owned by useNotificationsQuery)
  useEffect(() => {
    if (!notificationSubjectIds.length) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channelKey = notificationSubjectIds.slice().sort().join('-');
    const filter =
      notificationSubjectIds.length === 1
        ? `worker_id=eq.${notificationSubjectIds[0]}`
        : `worker_id=in.(${notificationSubjectIds.join(',')})`;

    const channel = supabase
      .channel(`notifications-changes-${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter,
        },
        (payload) => {
          if (notificationDebounceRef.current) {
            clearTimeout(notificationDebounceRef.current);
          }
          notificationDebounceRef.current = setTimeout(() => {
            patchNotificationFromRealtimeRef.current(payload);
          }, REALTIME_DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      if (notificationDebounceRef.current) {
        clearTimeout(notificationDebounceRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [notificationSubjectIds, router.events]);

  /** Instant refresh after local emits (`jobStakeholderNotificationsClient`); also catches missed Realtime events. */
  useEffect(() => {
    if (!notificationSubjectIds.length) return;
    const refresh = () => {
      void loadNotificationsRef.current();
    };
    window.addEventListener('fsm:notifications-refresh', refresh);
    return () => window.removeEventListener('fsm:notifications-refresh', refresh);
  }, [notificationSubjectIds, router.events]);

  /** Refetch when returning to the tab (throttled; Realtime can lag if reconnecting). */
  useEffect(() => {
    if (!notificationSubjectIds.length) return;

    const onBecameVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      const now = Date.now();
      if (now - lastNotifFetchRef.current < MIN_VISIBILITY_REFETCH_MS) {
        return;
      }
      void loadNotificationsRef.current();
    };

    document.addEventListener('visibilitychange', onBecameVisible);

    return () => {
      document.removeEventListener('visibilitychange', onBecameVisible);
    };
  }, [notificationSubjectIds]);

  /** New rows are created on other routes (e.g. job page); bell should update after navigation without waiting on Realtime. */
  useEffect(() => {
    if (!notificationSubjectIds.length) return;
    const onRouteDone = () => {
      const now = Date.now();
      if (lastNotifFetchRef.current > 0 && now - lastNotifFetchRef.current < MIN_NOTIF_FETCH_MS) {
        return;
      }
      void loadNotificationsRef.current();
    };
    router.events.on('routeChangeComplete', onRouteDone);
    return () => {
      router.events.off('routeChangeComplete', onRouteDone);
    };
  }, [notificationSubjectIds, router.events]);

  // Add mark all as read function
  const markAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length === 0) return;

      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds }),
      });
      if (!res.ok) {
        throw new Error(`mark-read ${res.status}`);
      }

      setNotifications(notifications.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const markNotificationAsRead = async (id) => {
    try {
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
        throw new Error(`mark-read ${res.status}`);
      }
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleNotificationActivate = (notification) => {
    const href = resolveNotificationHref(notification);
    if (!notification.read) {
      void markNotificationAsRead(notification.id);
    }
    setNotifMenuShow(false);
    if (href) {
      void router.push(href);
    }
  };

  const clearAllNotifications = async () => {
    if (!notificationSubjectIds.length) return;
    const confirmed =
      typeof window !== 'undefined' &&
      window.confirm('Remove all notifications? This cannot be undone.');
    if (!confirmed) return;
    try {
      const res = await fetch('/api/notifications/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`clear ${res.status}`);
      }
      setNotifications([]);
      setUnreadCount(0);
      seenNotificationIdsRef.current = new Set();
      invalidateNotificationCache();
    } catch (error) {
      console.error('Error clearing notifications:', error);
      toast.error('Could not clear notifications. Try again.');
    }
  };

  // Add debounced search function
  const debouncedSearch = useMemo(
    () => debounce(async (value) => {
      if (!value.trim()) {
        setShowSearchResults(false);
        setSearchResults([]);
        return;
      }

      setIsSearching(true);
      try {
        // Note: db parameter is null since Firebase is disabled and we're using Supabase
        // The search function will handle Firestore collections gracefully
        const results = await globalQuickSearch(null, value, true);
        setSearchResults(results);
        setShowSearchResults(true);
      } catch (error) {
        console.error('Search error:', error);
        // Show a more user-friendly error message
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  // Memoize search handlers
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value;
    setSearchQuery(value);
    debouncedSearch(value);
  }, [debouncedSearch]);

  const handleSearchSubmit = useCallback((e) => {
    e?.preventDefault?.();
    if (!searchQuery.trim()) return;

    setShowSearchResults(false);
    setSearchResults([]);
    
    toast.info('Searching...', {
      position: "top-right",
      autoClose: 1000,
      hideProgressBar: true,
      closeOnClick: true,
      pauseOnHover: false,
      draggable: true,
      style: {
        fontFamily: 'Poppins, sans-serif',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      },
      className: 'bg-white',
      toastId: 'search-start'
    });

    router.push({
      pathname: '/dashboard/search', 
      query: { q: searchQuery.trim() }
    });
  }, [searchQuery, router]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  // Global search: same bar on all dashboard routes (including overview)
  const renderSearch = useMemo(() => {
    return (
      <li className="me-2 me-lg-3">
        <SearchBar 
          value={searchQuery}
          onChange={handleSearchChange}
          onSubmit={handleSearchSubmit}
          onClear={handleClearSearch}
        />
      </li>
    );
  }, [searchQuery, handleSearchChange, handleSearchSubmit, handleClearSearch]);

  useEffect(() => {
    const clearSearchOnRouteChange = () => {
      setSearchQuery('');
      setShowSearchResults(false);
      setSearchResults([]);
    };

    router.events.on('routeChangeStart', clearSearchOnRouteChange);
    return () => {
      router.events.off('routeChangeStart', clearSearchOnRouteChange);
    };
  }, [router.events]);

  return (
    <Fragment>
      <ListGroup
        as="ul"
        bsPrefix="navbar-nav"
        className="navbar-right-wrap ms-2 d-flex nav-top-wrap align-items-center"
      >
        {renderSearch}

        <li
          className={`nav-item dropdown me-2 align-self-center ${styles.qmNotifLi}`}
          onMouseEnter={handleNotifWrapperEnter}
          onMouseLeave={handleNotifWrapperLeave}
        >
          <Dropdown
            align="end"
            autoClose="outside"
            show={notifMenuShow}
            onToggle={handleNotifToggle}
            drop="down"
          >
            <Dropdown.Toggle
              variant="light"
              id="qm-dropdown-notifications"
              className={styles.qmNotifToggle}
              aria-label="Notifications"
              aria-expanded={notifMenuShow}
            >
              <FaBell className={styles.qmNotifBellIcon} />
              {unreadCount > 0 ? (
                <span
                  className={`${styles.qmNotifBadge}${
                    unreadCount > 9 ? ` ${styles.qmNotifBadgeWide}` : ''
                  }`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : null}
            </Dropdown.Toggle>
            <Dropdown.Menu className={styles.qmNotifMenu} align="end">
              <div className={styles.qmNotifMenuHeader}>
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div className={`flex-grow-1 min-w-0 ${styles.qmNotifHeaderText}`}>
                    <h5 className={styles.qmNotifMenuTitle}>Notifications</h5>
                    {notifications.length > 0 ? (
                      <div className={styles.qmNotifHeaderSummary} aria-live="polite">
                        <span className={styles.qmNotifHeaderTotal}>
                          {notifications.length}
                          <span className={styles.qmNotifHeaderTotalLabel}>
                            {notifications.length === 1 ? ' item' : ' items'}
                          </span>
                        </span>
                        {unreadCount > 0 ? (
                          <>
                            <span className={styles.qmNotifHeaderSep} aria-hidden>
                              ·
                            </span>
                            <span className={styles.qmNotifHeaderUnread}>{unreadCount} unread</span>
                          </>
                        ) : (
                          <>
                            <span className={styles.qmNotifHeaderSep} aria-hidden>
                              ·
                            </span>
                            <span className={styles.qmNotifHeaderAllRead}>All read</span>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <Link
                    href="/dashboard/settings#notifications"
                    className={`text-muted p-1 flex-shrink-0 ${styles.qmNotifSettingsLink}`}
                    title="Notification settings"
                  >
                    <i className="fe fe-settings" />
                  </Link>
                </div>
              </div>
              <div className={styles.qmNotifListWrap}>
                {notifications.length === 0 ? (
                  <div className="text-center py-5 px-3 text-muted small">
                    No notifications yet — assignments and alerts will appear here.
                  </div>
                ) : (
                  <ListGroup variant="flush">
                    {notifications.map((notification) => (
                      <NotificationListItem
                        key={notification.id}
                        notification={notification}
                        onActivate={handleNotificationActivate}
                      />
                    ))}
                  </ListGroup>
                )}
              </div>
              {notifications.length > 0 ? (
                <div className={styles.qmNotifFooter}>
                  <div className={styles.qmNotifFooterActions}>
                    {unreadCount > 0 ? (
                      <Button
                        variant="link"
                        className={styles.qmNotifMarkAll}
                        onClick={markAllAsRead}
                      >
                        Mark all as read
                      </Button>
                    ) : null}
                    {unreadCount > 0 ? (
                      <span className={styles.qmNotifFooterSep} aria-hidden>
                        |
                      </span>
                    ) : null}
                    <Button
                      variant="link"
                      className={styles.qmNotifClearAll}
                      onClick={clearAllNotifications}
                    >
                      Clear all
                    </Button>
                  </div>
                </div>
              ) : null}
            </Dropdown.Menu>
          </Dropdown>
        </li>

        {/* User Dropdown */}
        <Dropdown as="li" className="ms-2">
          <Dropdown.Toggle
            as="a"
            bsPrefix=" "
            className="d-flex align-items-center"
            id="dropdownUser"
            style={{ cursor: 'pointer' }}
          >
            <UserAvatar userDetails={userDetails} />
            {/* <FaChevronDown className="ms-2 text-muted" size={12} /> */}
          </Dropdown.Toggle>
          <Dropdown.Menu
            className={`dashboard-dropdown dropdown-menu-end mt-4 py-0 ${styles.qmDropdownMenu} ${styles.qmUserDropdownMenu}`}
            align="end"
            aria-labelledby="dropdownUser"
            show={hasMounted && isDesktop ? true : false}
          >
            <Dropdown.Item className="mt-3">
              <div className={styles.qmUserProfile}>
                {userDetails && (
                  <div>
                    <h5 className={styles.qmUserProfileName}>{userDetails.fullName}</h5>
                    <p className={styles.qmUserProfileEmail}>{userDetails.email}</p>
                  </div>
                )}
              </div>
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item
              as={Link}
              href="/dashboard/profile/myprofile"
              className={styles.qmDropdownItem}
            >
              <i className="fe fe-user me-2"></i> Profile
            </Dropdown.Item>
            <Dropdown.Item
              as={Link}
              href="/dashboard/settings"
              className={styles.qmDropdownItem}
            >
              <i className="fe fe-settings me-2"></i> Settings
            </Dropdown.Item>
            <Dropdown.Item
              as={Link}
              href="/dashboard/audit-logs"
              className={styles.qmDropdownItem}
            >
              <i className="fe fe-file-text me-2"></i>
              Audit Logs
              <Badge
                pill
                bg="primary"
                className="ms-1 align-middle text-uppercase"
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  padding: '0.28em 0.55em',
                  lineHeight: 1,
                  boxShadow: '0 1px 2px rgba(13, 110, 253, 0.25)',
                }}
              >
                NEW
              </Badge>
            </Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item
              as={Link}
              href="/dashboard/help"
              className={styles.qmDropdownItem}
              badge="New"
            >
              <i className="fe fe-help-circle me-2"></i> Help & Support
            </Dropdown.Item>
            <Dropdown.Item className={`mb-3 ${styles.qmDropdownItem}`} onClick={handleSignOut}>
              <i className="fe fe-power me-2"></i> Sign Out
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>

      
      </ListGroup>

    </Fragment>
  );
};

// Memoize the entire QuickMenu component
export default React.memo(QuickMenu);
