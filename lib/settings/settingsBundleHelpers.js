import { getDefaultFollowUpTypes } from '../../utils/followUpSettings';
import { getDefaultJobStatuses } from '../../utils/jobStatusDefaults';
import { normalizeFollowUpStatusOptions } from '../followUps/followUpListSummary';

export function parseFollowUpTypes(followUpValue) {
  if (!followUpValue?.types || typeof followUpValue.types !== 'object') {
    return getDefaultFollowUpTypes();
  }
  return Object.entries(followUpValue.types).map(([id, type]) => ({
    id,
    ...type,
  }));
}

export function parseFollowUpStatuses(followUpValue) {
  const configured = Array.isArray(followUpValue?.statuses)
    ? followUpValue.statuses.map((status) => status.name).filter(Boolean)
    : [];
  return normalizeFollowUpStatusOptions(configured);
}

export function parseJobStatusTypes(jobStatusesValue) {
  if (!jobStatusesValue?.types || typeof jobStatusesValue.types !== 'object') {
    return getDefaultJobStatuses();
  }
  return Object.entries(jobStatusesValue.types).map(([id, type]) => ({
    id,
    value: type.value ?? '',
    name: type.name ?? '',
    ...(type.color != null && String(type.color).trim() !== '' ? { color: type.color } : {}),
  }));
}

/** Legend rows for search page status chips (supports legacy `items` and `types`). */
export function parseJobStatusLegendItems(jobStatusesValue) {
  if (Array.isArray(jobStatusesValue?.items) && jobStatusesValue.items.length > 0) {
    return jobStatusesValue.items;
  }

  const types = jobStatusesValue?.types;
  if (!types || typeof types !== 'object') return [];

  return Object.values(types)
    .filter((type) => type?.name || type?.value)
    .map((type) => ({
      status: type.name || type.value,
      color: type.color || '#9e9e9e',
    }));
}
