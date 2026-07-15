/** Stable React Query key factory for paginated list caches. */
export const queryKeys = {
  jobsList: (params) => (params ? ['jobs', 'list', params] : ['jobs', 'list']),
  customerJobHistory: (customerId, params) =>
    params
      ? ['customers', customerId, 'job-history', params]
      : ['customers', customerId, 'job-history'],
  customersList: (params) => (params ? ['customers', 'list', params] : ['customers', 'list']),
  followUpsList: (params) => (params ? ['follow-ups', 'list', params] : ['follow-ups', 'list']),
  workersList: (params) => (params ? ['workers', 'list', params] : ['workers', 'list']),
  portalCustomersList: () => ['portal-customers', 'list'],
  leadsList: (params) => (params ? ['leads', 'list', params] : ['leads', 'list']),
  customerDetail: (cardCode) => ['customers', 'detail', cardCode],
  leadDetail: (leadCode) => ['leads', 'detail', leadCode],
  googleFormsList: () => ['google-forms', 'list'],
  jobDetail: (jobId) => ['jobs', 'detail', jobId],
  jobChat: (jobId) => ['jobs', jobId, 'chat'],
  jobSignatures: (jobId) => ['jobs', jobId, 'signatures'],
  jobMedia: (jobId) => ['jobs', jobId, 'media'],
  customerAddressDetails: (customerCode) => ['customers', customerCode, 'address-details'],
  jobStatuses: () => ['settings', 'job-statuses'],
  followUpTypes: () => ['settings', 'follow-up-types'],
  jobsCalendar: (range) => ['jobs', 'calendar', range],
  liveTracking: (dateKey) => ['jobs', 'live-tracking', dateKey],
  auditLogs: (params) => (params ? ['audit-logs', 'list', params] : ['audit-logs', 'list']),
  notificationsSummary: (limit = 20) => ['notifications', 'summary', limit],
};
