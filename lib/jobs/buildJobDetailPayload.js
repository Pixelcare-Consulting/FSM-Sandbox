import {
  formatPaymentQrDollarsForInput,
  getDefaultPaymentQrExpiryYmd,
} from './paymentQrDefaults';
import {
  formatSingaporeTimeHm,
  toSingaporeYmd,
} from '../utils/singaporeDateTime';
import {
  buildActorInfo,
  buildTechnicianLocationsMap,
  mapJobTasksToTaskList,
  resolveJobSiteContact,
  resolveMatchedCustomerLocation,
} from './jobDetailHelpers';
import { jobDisplayCustomerName } from '../utils/embeddedCustomerName';
import { decodePortalHtmlEntities } from '../utils/formatPortalBpAddress';

/**
 * Build the normalized job detail view-model consumed by JobDetailsPage.
 * @param {Awaited<ReturnType<import('./fetchJobDetailBundle').fetchJobDetailBundle>>} bundle
 */
export function buildJobDetailPayload(bundle) {
  if (!bundle?.jobData) {
    return {
      job: null,
      jobUuid: null,
      workers: [],
      technicianLocations: {},
      jobAttendance: [],
      paymentProfiles: [],
      paymentState: null,
      expandedEquipments: {},
      technicianNotes: [],
      workerComments: [],
      images: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const {
    jobData,
    jobSchedule,
    customerLocations,
    contacts,
    followUps,
    taskCompletions,
    actorUsers,
    actorTechnicians,
    createdByUser,
    createdByTechnician,
    workers,
    locationTechnicians,
    attendance,
    paymentProfiles,
    resolvedScheduleAddress,
  } = bundle;

  const userMapById = {};
  for (const user of actorUsers || []) {
    userMapById[user.id] = user;
  }

  const technicianMapByUserId = {};
  for (const tech of actorTechnicians || []) {
    technicianMapByUserId[tech.user_id] = {
      full_name: tech.full_name,
      email: tech.email,
    };
  }

  const normalizedJob = {
    ...jobData,
    jobNo: jobData.job_number || jobData.jobNo,
    jobName: jobData.title || jobData.jobName,
    jobStatus: jobData.status || jobData.jobStatus,
    jobType: jobData.category || jobData.jobType || 'Maintenance',
    jobDescription: jobData.description || '',
    description: jobData.description || '',
    customerID: jobData.customer_id || jobData.customer?.id || jobData.customerID,
    customerName:
      jobDisplayCustomerName(jobData) ||
      decodePortalHtmlEntities(
        jobData.customer?.customer_name || jobData.customerName || ''
      ).trim() ||
      '',
    customerCode: jobData.customer?.customer_code || jobData.customerCode,
    customerPhone: jobData.customer?.phone_number || '',
    customerEmail: jobData.customer?.email || '',
    serviceCallNumber: jobData.service_call?.call_number ?? null,
    salesOrderNumber: jobData.sales_order?.document_number ?? null,
    location: (() => {
      const loc = jobData.location;
      if (!loc) return {};
      if (Array.isArray(loc)) return loc[0] && typeof loc[0] === 'object' ? loc[0] : {};
      return typeof loc === 'object' ? loc : {};
    })(),
    startTime: jobData.scheduled_start
      ? formatSingaporeTimeHm(jobData.scheduled_start) || jobData.startTime
      : jobData.startTime,
    endTime: jobData.scheduled_end
      ? formatSingaporeTimeHm(jobData.scheduled_end) || jobData.endTime
      : jobData.endTime,
    startDate: jobData.scheduled_start
      ? toSingaporeYmd(jobData.scheduled_start) || jobData.startDate
      : jobData.startDate,
    endDate: jobData.scheduled_end
      ? toSingaporeYmd(jobData.scheduled_end) || jobData.endDate
      : jobData.endDate,
    assignedWorkers: (() => {
      const technicianMap = new Map();
      (jobData.technician_jobs || [])
        .filter((tj) => tj.deleted_at == null)
        .forEach((tj) => {
          const techId = tj.technician_id || tj.technician?.id;
          if (techId && !technicianMap.has(techId)) {
            technicianMap.set(techId, {
              workerId: techId,
              technician_id: techId,
              ...tj.technician,
              ...tj,
            });
          }
        });
      return Array.from(technicianMap.values());
    })(),
    taskList: mapJobTasksToTaskList(jobData.job_tasks),
    equipments: (jobData.job_equipments || []).map((je) => {
      const eq = je.equipment || {};
      return {
        id: eq.id || je.equipment_id,
        itemName: eq.item_name || 'Unnamed Equipment',
        itemCode: eq.item_code || '',
        modelSeries: eq.model_series || '',
        itemGroup: eq.item_group || '',
        serialNo: eq.serial_number || '',
        equipmentLocation: eq.equipment_location || '',
        equipmentType: eq.equipment_type || '',
        warrantyStartDate: eq.warranty_start_date || '',
        warrantyEndDate: eq.warranty_end_date || '',
        notes: eq.notes || je.notes || '',
      };
    }),
    createdAt: jobData.created_at || jobData.createdAt,
    updatedAt: jobData.updated_at || jobData.updatedAt,
    scheduled_start: jobData.scheduled_start,
    scheduled_end: jobData.scheduled_end,
    payment_qr_uen: jobData.payment_qr_uen,
    payment_qr_amount: jobData.payment_qr_amount,
    payment_qr_editable: jobData.payment_qr_editable,
    payment_qr_expiry: jobData.payment_qr_expiry,
    payment_qr_ref_number: jobData.payment_qr_ref_number,
    payment_qr_company: jobData.payment_qr_company,
    payment_qr_inv_number: jobData.payment_qr_inv_number,
    payment_qr_code_string: jobData.payment_qr_code_string,
    payment_status: jobData.payment_status || 'pending',
    sap_cm_number: jobData.sap_cm_number,
    sap_cm_status: jobData.sap_cm_status,
    sap_job_income: jobData.sap_job_income,
  };

  if (jobSchedule?.dur && jobSchedule.dur_type === 'hours') {
    const durDecimal = parseFloat(jobSchedule.dur);
    if (!Number.isNaN(durDecimal)) {
      const hours = Math.floor(durDecimal);
      const minutes = Math.round((durDecimal - hours) * 60);
      normalizedJob.estimatedDurationHours = hours;
      normalizedJob.estimatedDurationMinutes = minutes;
      normalizedJob.manualDuration = true;
    }
  }

  if (jobSchedule?.address && String(jobSchedule.address).trim()) {
    normalizedJob.scheduleAddress = String(jobSchedule.address).trim();
  } else if (resolvedScheduleAddress) {
    normalizedJob.scheduleAddress = resolvedScheduleAddress;
  }

  if (normalizedJob.customerID && customerLocations?.length) {
    const matchedCustLoc = resolveMatchedCustomerLocation(normalizedJob, customerLocations);
    normalizedJob.customerLocation = matchedCustLoc || null;
    normalizedJob.customerLocations = customerLocations;
    normalizedJob.contact = resolveJobSiteContact({
      jobData,
      contactsRows: contacts,
      customerLocations,
      matchedCustLoc,
      customerPhone: normalizedJob.customerPhone,
      customerEmail: normalizedJob.customerEmail,
    });
  }

  const followUpsObj = {};
  for (const fu of followUps || []) {
    const createdByUserInfo = fu.user_id ? userMapById[fu.user_id] || fu.user : null;
    const createdByTechInfo = fu.user_id ? technicianMapByUserId[fu.user_id] : null;
    const statusUpdatedByUserInfo = fu.status_updated_by
      ? userMapById[fu.status_updated_by]
      : null;
    const statusUpdatedByTechInfo = fu.status_updated_by
      ? technicianMapByUserId[fu.status_updated_by]
      : null;

    followUpsObj[fu.id] = {
      id: fu.id,
      jobID: fu.job_id,
      jobName: normalizedJob.jobName,
      customerID: normalizedJob.customerID,
      customerName: normalizedJob.customerName,
      type: fu.type,
      status: fu.status,
      priority: fu.priority,
      notes: fu.notes || '',
      dueDate: fu.due_date,
      createdAt: fu.created_at,
      updatedAt: fu.updated_at,
      createdBy: buildActorInfo(createdByUserInfo, createdByTechInfo),
      updatedBy: buildActorInfo(
        statusUpdatedByUserInfo,
        statusUpdatedByTechInfo,
        fu.status_updated_by_account || null
      ),
      statusUpdatedBy: fu.status_updated_by || null,
      statusUpdatedByAccount: fu.status_updated_by_account || null,
    };
  }
  normalizedJob.followUps = followUpsObj;
  normalizedJob.followUpCount = Object.keys(followUpsObj).length;

  if (normalizedJob.taskList?.length && taskCompletions?.length) {
    normalizedJob.taskList = normalizedJob.taskList.map((task) => {
      const taskCompletionRows = taskCompletions.filter((c) => c.job_task_id === task.taskID);
      const hasCompletionRows = taskCompletionRows.length > 0;
      const isCompletedFromRows = taskCompletionRows.some((c) => c.is_completed);
      const isDone = hasCompletionRows ? isCompletedFromRows : Boolean(task.isDone);
      const completedRow = taskCompletionRows.find((c) => c.is_completed);
      return {
        ...task,
        isDone,
        completionDate: isDone ? completedRow?.completed_at || null : null,
        completions: taskCompletionRows.map((c) => ({
          technicianJobId: c.technician_job_id,
          isCompleted: c.is_completed,
          completedAt: c.completed_at,
          notes: c.completion_notes,
        })),
      };
    });
  }

  if (jobData.created_by) {
    normalizedJob.createdBy = buildActorInfo(createdByUser, createdByTechnician) || {
      fullName: jobData.created_by_user?.username || 'Unknown',
      email: jobData.created_by_user?.username || 'Unknown',
      username: jobData.created_by_user?.username || 'Unknown',
    };
  } else {
    normalizedJob.createdBy = null;
  }

  const expandedEquipments = {};
  if (normalizedJob.equipments?.length) {
    normalizedJob.equipments.forEach((_, index) => {
      expandedEquipments[index] = true;
    });
  }

  const technicianLocationsMap = buildTechnicianLocationsMap(locationTechnicians);
  const jobNo = jobData.job_number || jobData.jobNo || '';
  const defaultExpiry = getDefaultPaymentQrExpiryYmd();
  const profiles = paymentProfiles || [];
  const effectiveProfile =
    (jobData.payment_profile_id &&
      profiles.find((p) => p.id === jobData.payment_profile_id)) ||
    profiles.find((p) => p.is_default) ||
    profiles[0];
  const uenForQr =
    effectiveProfile?.paynow_uen_qr ||
    effectiveProfile?.paynow_uen ||
    jobData.payment_qr_uen ||
    '201019107ZDBS';
  const companyName =
    effectiveProfile?.pay_to || jobData.payment_qr_company || 'SAS M&E PTE LTD';

  const paymentState = {
    selectedPaymentProfileId: effectiveProfile?.id || null,
    paymentStatus: jobData.payment_status || 'pending',
    paymentDetails: {
      uen: uenForQr,
      company: companyName,
      invNumber: jobData.payment_qr_inv_number || jobNo,
      expiry: jobData.payment_qr_expiry || defaultExpiry,
      amount:
        jobData.payment_qr_amount != null
          ? formatPaymentQrDollarsForInput(jobData.payment_qr_amount)
          : '',
      editable: jobData.payment_qr_editable !== undefined ? jobData.payment_qr_editable : true,
    },
    qrCodeValue: jobData.payment_qr_code_string || '',
    paymentQrAutosaveSkip: true,
  };

  return {
    job: normalizedJob,
    jobUuid: jobData.id,
    workers: workers || [],
    technicianLocations: technicianLocationsMap,
    jobAttendance: attendance || [],
    paymentProfiles: profiles,
    paymentState,
    expandedEquipments,
    technicianNotes: jobData.technicianNotes || [],
    workerComments: jobData.workerComments || [],
    images: jobData.images || [],
    fetchedAt: new Date().toISOString(),
  };
}
