import { toLocalYmd } from '../utils/localDate';
import { parseSingaporeCompositeAddress } from './mapJobFormLocationOption';

const EMPTY_ADDRESS = {
  streetNo: '',
  streetAddress: '',
  block: '',
  buildingNo: '',
  city: '',
  stateProvince: '',
  postalCode: '',
  country: '',
};

function mapContactForEdit(contact) {
  if (!contact) return {};
  return {
    contactID: contact.contactID || contact.id || contact.contactId || '',
    contactFullname:
      contact.contactFullname ||
      contact.contact_fullname ||
      `${contact.firstName || contact.first_name || ''} ${contact.middleName || contact.middle_name || ''} ${contact.lastName || contact.last_name || ''}`.trim(),
    firstName: contact.firstName || contact.first_name || '',
    middleName: contact.middleName || contact.middle_name || '',
    lastName: contact.lastName || contact.last_name || '',
    phoneNumber: contact.phoneNumber || contact.tel1 || contact.phone_number || '',
    mobilePhone: contact.mobilePhone || contact.tel2 || contact.mobile_phone || '',
    email: contact.email || '',
  };
}

/** Normalize DB string or partial object address into the edit-form nested shape. */
function normalizeLocationAddress(address) {
  if (address == null || address === '') {
    return { ...EMPTY_ADDRESS };
  }
  if (typeof address === 'string') {
    const parsed = parseSingaporeCompositeAddress(address);
    return {
      streetNo: parsed.streetNo || '',
      streetAddress: parsed.streetAddress || address,
      block: '',
      buildingNo: parsed.buildingNo || '',
      city: parsed.city || '',
      stateProvince: '',
      postalCode: parsed.postalCode || '',
      country: parsed.country || '',
    };
  }
  if (typeof address !== 'object') {
    return { ...EMPTY_ADDRESS };
  }
  return {
    streetNo: address.streetNo || address.street_no || '',
    streetAddress:
      address.streetAddress || address.street_address || address.street || '',
    block: address.block || '',
    buildingNo: address.buildingNo || address.building_no || address.building || '',
    city: address.city || '',
    stateProvince: address.stateProvince || address.state_province || '',
    postalCode: address.postalCode || address.postal_code || address.zipCode || '',
    country: address.country || address.countryName || '',
  };
}

/** Empty/`{}` location → null so Edit seed does not treat it as a selected site. */
function mapLocationForEdit(location) {
  if (!location || typeof location !== 'object') return null;
  if (Object.keys(location).length === 0) return null;

  const locationName =
    location.location_name || location.locationName || location.siteId || '';
  const address = normalizeLocationAddress(location.address);
  const latitude =
    location.current_latitude || location.coordinates?.latitude || '';
  const longitude =
    location.current_longitude || location.coordinates?.longitude || '';

  const hasSiteLabel = String(locationName || '').trim() !== '';
  const hasAddressParts = Object.values(address).some(
    (v) => String(v || '').trim() !== ''
  );
  const hasCoords =
    String(latitude || '').trim() !== '' || String(longitude || '').trim() !== '';

  if (!hasSiteLabel && !hasAddressParts && !hasCoords) return null;

  return {
    locationName: locationName || '',
    address,
    coordinates: {
      latitude: latitude || '',
      longitude: longitude || '',
    },
  };
}

function mapAssignedWorkersForEdit(assignedWorkers = []) {
  return assignedWorkers.map((tj) => ({
    workerId: tj.technician?.user_id || tj.workerId || tj.technician?.user?.id,
    technician_id: tj.technician_id || tj.technician?.id,
    workerName:
      tj.technician?.full_name ||
      tj.technician?.user?.full_name ||
      tj.full_name ||
      tj.workerName ||
      'Unknown',
  }));
}

function deriveDurationFromTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  if (
    Number.isNaN(startHours) ||
    Number.isNaN(startMinutes) ||
    Number.isNaN(endHours) ||
    Number.isNaN(endMinutes)
  ) {
    return null;
  }
  let totalMinutes = endHours * 60 + endMinutes - (startHours * 60 + startMinutes);
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  if (totalMinutes <= 0) return null;
  return {
    estimatedDurationHours: Math.floor(totalMinutes / 60),
    estimatedDurationMinutes: totalMinutes % 60,
  };
}

/**
 * Map cached job detail payload to EditJobs initial form shape.
 * @param {Awaited<ReturnType<import('./jobDetailQueryKeys').fetchJobDetail>> | null | undefined} payload
 */
export function mapJobDetailToEditForm(payload) {
  if (!payload?.job) return null;

  const job = payload.job;
  const rawStatus = job.jobStatus ?? job.status;
  const statusValue = rawStatus != null ? String(rawStatus).trim() : '';
  const jobStatus = !statusValue || statusValue.toLowerCase() === 'created' ? '554' : statusValue;

  const startTime = (job.startTime || '').substring(0, 5);
  const endTime = (job.endTime || '').substring(0, 5);

  const normalizedData = {
    id: job.id,
    jobID: job.id,
    jobNo: job.jobNo || job.job_number,
    jobName: job.jobName || job.title,
    jobStatus,
    jobDescription: job.jobDescription || job.description || '',
    customerID: job.customerID || job.customer_id,
    customerId: job.customerID || job.customer_id || job.customerId,
    customerName: job.customerName,
    customerCode: job.customerCode || '',
    customer_address: job.customer_address || job.customer?.customer_address || '',
    email: job.customerEmail || job.email || job.customer?.email || '',
    phone_number: job.customerPhone || job.phone_number || job.customer?.phone_number || '',
    source: job.source || job.customer?.source || '',
    startDate: job.startDate || (job.scheduled_start ? toLocalYmd(job.scheduled_start) : ''),
    endDate: job.endDate || (job.scheduled_end ? toLocalYmd(job.scheduled_end) : ''),
    startTime,
    endTime,
    priority: job.priority || '',
    serviceCallID: job.serviceCallNumber || job.serviceCallID || job.service_call?.call_number || '',
    salesOrderID: job.salesOrderNumber || job.salesOrderID || job.sales_order?.document_number || '',
    scheduleSession: job.scheduleSession || '',
    estimatedDurationHours:
      job.estimatedDurationHours !== undefined && job.estimatedDurationHours !== null
        ? job.estimatedDurationHours
        : '',
    estimatedDurationMinutes:
      job.estimatedDurationMinutes !== undefined && job.estimatedDurationMinutes !== null
        ? job.estimatedDurationMinutes
        : '',
    manualDuration: job.manualDuration || false,
    assignedWorkers: mapAssignedWorkersForEdit(job.assignedWorkers),
    taskList: (job.taskList || []).map((task, index) => ({
      taskID: task.taskID || task.id || `task-${index}`,
      taskName: task.taskName || task.task_name || '',
      taskDescription: task.taskDescription || task.task_description || '',
      isPriority: task.isPriority ?? task.is_required ?? false,
      isDone: task.isDone ?? task.is_completed ?? false,
      createdAt: task.createdAt || task.created_at || null,
      completionDate: task.completionDate || null,
    })),
    equipments: (job.equipments || []).map((eq) => ({
      id: eq.id,
      itemName: eq.itemName || 'Unnamed Equipment',
      itemCode: eq.itemCode || '',
      modelSeries: eq.modelSeries || '',
      itemGroup: eq.itemGroup || '',
      serialNo: eq.serialNo || '',
      equipmentLocation: eq.equipmentLocation || '',
      equipmentType: eq.equipmentType || '',
      brand: eq.brand || '',
      notes: eq.notes || '',
    })),
    location: mapLocationForEdit(job.location),
    contact: mapContactForEdit(job.contact),
    contactId: job.contact_id || job.contact?.id || job.contact?.contactID || null,
    jobContactType: job.jobContactType || job.job_contact_type?.[0] || null,
  };

  const hasSavedDuration =
    normalizedData.estimatedDurationHours !== '' &&
    normalizedData.estimatedDurationHours != null;
  if (!hasSavedDuration) {
    const derived = deriveDurationFromTimes(normalizedData.startTime, normalizedData.endTime);
    if (derived) {
      normalizedData.estimatedDurationHours = derived.estimatedDurationHours;
      normalizedData.estimatedDurationMinutes = derived.estimatedDurationMinutes;
    }
  }

  if (
    !normalizedData.source &&
    /^CP\d+$/i.test(String(normalizedData.customerCode || '').trim())
  ) {
    normalizedData.source = 'portal';
  }

  return normalizedData;
}
