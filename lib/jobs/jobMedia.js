import { getUserContextFromRequest } from '../services/auditLog';

/**
 * Resolve job_media.created_by — session user first (who generated/uploaded), then job creator.
 * Mirrors JobDetailsPage resolveUploaderId for server-side inserts.
 */
export function resolveJobMediaCreatedBy(req, jobData) {
  const sessionUserId = getUserContextFromRequest(req).userId;
  if (sessionUserId) return sessionUserId;
  return jobData?.created_by || null;
}
