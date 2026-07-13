import { isJobStatusCompleted } from './isJobStatusCompleted';

// Job status: use Settings > Job Statuses only. DB expects CANCELLED (two Ls), not CANCELED.
export const toDbStatus = (val) => {
  if (!val || !String(val).trim()) return '';
  const s = String(val).trim().toUpperCase().replace(/\s+/g, '_');
  return s === 'CANCELED' ? 'CANCELLED' : s;
};

// Persist numeric U_JobStatusID as-is when from SAP API; otherwise use toDbStatus for legacy values.
export const resolveJobStatusForDb = (formStatus, jobStatusesList) => {
  const v = formStatus && String(formStatus).trim();
  if (v) {
    if (/^-?\d+$/.test(v)) return v;
    const normalized = toDbStatus(v);
    const fromList = jobStatusesList?.find(
      (s) => toDbStatus(s.value) === normalized || String(s.value || '').trim() === v
    );
    if (fromList?.value) {
      return /^-?\d+$/.test(String(fromList.value)) ? fromList.value : toDbStatus(fromList.value);
    }
    return normalized;
  }
  return jobStatusesList?.[0]?.value != null ? String(jobStatusesList[0].value) : '554';
};

// Maps a resolved jobs.status value to the allowed technician_jobs.assignment_status value.
export const mapJobStatusToAssignmentStatus = (jobStatus) => {
  if (isJobStatusCompleted(jobStatus)) return 'COMPLETED';
  const s = (jobStatus || '').toUpperCase();
  if (s.includes('CANCEL')) return 'CANCELLED';
  if (s.includes('STARTED') || s.includes('IN_PROGRESS') || s.includes('INPROGRESS')) return 'STARTED';
  return 'ASSIGNED';
};
