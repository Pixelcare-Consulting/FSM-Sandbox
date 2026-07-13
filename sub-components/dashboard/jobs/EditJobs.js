import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Container,
  Row,
  Col,
  Form,
  Button,
  InputGroup,
  Tabs,
  Tab,
} from "react-bootstrap";
import Select from "react-select";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { refreshTechnicianHoursForJobId } from "../../../lib/supabase/technicianHours";
import { jobService, userService, customerService } from "../../../lib/supabase/database";
import { emitJobStakeholderNotifications } from "../../../lib/notifications/jobStakeholderNotificationsClient";
import {
  emitJobAssignmentEmails,
  emitJobCompletedEmail,
} from "../../../lib/notifications/transactionalJobEmailClient";
import { showJobCompletedEmailToast } from "../../../lib/email/jobEmailToastMessages";
import { fetchJobStatuses, getDefaultJobStatuses, formatJobStatusDisplayLabel } from "../../../utils/jobStatusSettings";
import { findJobStatusEntry } from "../../../utils/jobStatusDefaults";
import { clientAuditLog, buildAuditChanges } from "../../../utils/clientAuditLog";
import { buildJobEditAuditSnapshot } from "../../../utils/jobEditAudit";
import { toLocalYmd } from "../../../lib/utils/localDate";
import {
  buildSingaporeDateTimeFromForm,
  formatSingaporeTimeHm,
  toSingaporeYmd,
} from "../../../lib/utils/singaporeDateTime";
import { findServiceJobContactTypeOption } from "../../../lib/jobs/portalDefaultJobContactType";
import {
  resolveJobStatusForDb,
  mapJobStatusToAssignmentStatus,
  toDbStatus,
} from "../../../lib/jobs/jobStatusPersistence";
import {
  buildGroupedLocationOptions,
  countGroupedLocationOptions,
  flattenLocationOptions,
  locationSelectGroupLabel,
  locationSelectOptionLabel,
  locationSelectStyles,
} from "../../../lib/jobs/jobFormLocationSelect";
import {
  mapAssignableWorkersToOptions,
  mergeWorkerSelectOptions,
} from "../../../lib/jobs/assignableWorkerSelect";
import { upsertJobCustomerLocation } from "../../../lib/jobs/upsertJobCustomerLocation";
import { resolveContactIdFromSelection } from "../../../lib/jobs/upsertJobContactFromSelection";
import {
  buildJobFormLocationPatch,
  fillLocationOptionGranularFromComposite,
  isBareSiteLabelAddress,
  mergeSelectedLocationWithFormAddress,
  siteLabelFromLocationOption,
} from "../../../lib/jobs/mapJobFormLocationOption";
import { sanitizeAifmEmbeddedTagValue } from "../../../lib/utils/aifmLocationFormat";
import { normalizeRichTextHtml } from "../../../lib/utils/normalizeRichTextHtml";
import mapDbContactsToSelectOptions from "../../../lib/jobs/mapDbContactsToSelectOptions";
import {
  invalidateJobCachesAfterMutation,
} from "../../../lib/jobs/invalidateJobMutationCaches";
import { queryKeys } from "../../../lib/cache/queryKeys";
import JobRecurrenceModal from "./_components/JobRecurrenceModal";
import EditJobFormSkeleton from "./_components/EditJobFormSkeleton";
import {
  formatRecurrenceStartDate,
  generateOccurrenceDateRanges,
  getDefaultRecurrenceRule,
  normalizeRecurrenceRule,
  buildRecurrenceSummary,
} from "../../../lib/jobs/recurrence";
import { createRepeatSiblingJobs } from "../../../lib/jobs/repeatJobExtend";
import Cookies from "js-cookie";
import Swal from "sweetalert2";
import styles from "./CreateJobs.module.css";
import toast from "react-hot-toast";
import JobTask from "./tabs/JobTasklist";
import EquipmentsTableWithAddDelete from "pages/dashboard/tables/datatable-equipments-update";
import { useRouter } from "next/router";
import { useQueryClient } from "react-query";
import { FlatPickr, FormSelect, DropFiles, ReactQuillEditor } from "widgets";
import Flatpickr from "react-flatpickr";
import { OverlayTrigger, Tooltip } from "react-bootstrap";

// Priority mapping function to convert form values to database values
// Helper function to format date as DD/MM/YYYY
const formatDateDDMMYYYY = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// DB only allows: LOW, MEDIUM, HIGH, URGENT. Form uses "Normal" for medium. Never send NORMAL.
const mapPriorityToDatabase = (priority) => {
  const v = (priority && String(priority).trim()) || '';
  if (!v) return 'MEDIUM';

  const upper = v.toUpperCase();
  if (upper === 'NORMAL') return 'MEDIUM';
  if (upper === 'LOW') return 'LOW';
  if (upper === 'HIGH') return 'HIGH';
  if (upper === 'URGENT') return 'URGENT';
  if (upper === 'MEDIUM') return 'MEDIUM';

  const priorityMap = {
    Low: 'LOW',
    Normal: 'MEDIUM',
    High: 'HIGH',
  };
  return priorityMap[v] ?? priorityMap[v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()] ?? 'MEDIUM';
};

// Reverse mapping functions to convert database values to form values
const mapPriorityFromDatabase = (priority) => {
  if (!priority) return '';
  
  const reversePriorityMap = {
    'LOW': 'Low',
    'MEDIUM': 'Normal',
    'HIGH': 'High',
    'URGENT': 'High', // Map URGENT to High for form
    'Low': 'Low',
    'Normal': 'Normal',
    'High': 'High'
  };
  
  return reversePriorityMap[priority] || '';
};

// Helper function to format contact data
const formatContactData = (contactData) => {
  if (!contactData) return {};
  
  const fullName = `${contactData.firstName || ""} ${
    contactData.middleName || ""
  } ${contactData.lastName || ""}`.trim();

  return {
    contactID: contactData.value || contactData.contactID || "",
    contactFullname: fullName,
    firstName: contactData.firstName || "",
    middleName: contactData.middleName || "",
    lastName: contactData.lastName || "",
    phoneNumber: contactData.tel1 || contactData.phoneNumber || "",
    mobilePhone: contactData.tel2 || contactData.mobilePhone || "",
    email: contactData.email || "",
  };
};

// Helper function to convert status codes to readable text
const getStatusText = (status) => {
  const statusMap = {
    O: "Open",
    C: "Closed",
    P: "Pending",
  };
  return statusMap[status] || status;
};

// Helper function to fetch coordinates from Google Maps API
const fetchCoordinates = async (locationName) => {
  // Check if location name is valid
  if (!locationName || locationName.trim().length === 0) {
    return null;
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn("Google Maps API key is not configured");
    return null;
  }

  try {
    const encodedLocation = encodeURIComponent(locationName);
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedLocation}&key=${apiKey}`
    );

    if (!response.ok) {
      console.warn("Google Maps API request failed:", response.statusText);
      return null;
    }

    const data = await response.json();
    
    // Handle different API response statuses
    if (data.status === "OK" && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        latitude: location.lat,
        longitude: location.lng,
      };
    } else {
      console.warn("Google Maps API returned no results:", data.status);
      return null;
    }
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
};

function resolveCustomerCardCode(jobData, selectedCustomer) {
  return (
    selectedCustomer?.cardCode ||
    selectedCustomer?.value ||
    jobData?.customerCode ||
    null
  ); // never use jobData.customerID (UUID)
}

/** Resolve jobs.customer_id FK — never use sap_lead.id from masterlist dropdown. */
async function resolveJobCustomerId(selectedCustomer, previousCustomerId) {
  const cardCode = String(
    selectedCustomer?.cardCode || selectedCustomer?.value || ''
  ).trim();
  const cardName =
    selectedCustomer?.cardName ||
    selectedCustomer?.label ||
    'Unknown Customer';

  if (selectedCustomer?.customerId && cardCode) {
    const existing = await customerService.findById(selectedCustomer.customerId);
    if (
      existing &&
      String(existing.customer_code || '').trim() === cardCode
    ) {
      return existing.id;
    }
  }

  if (cardCode) {
    const customer = await customerService.findOrCreate(cardCode, cardName);
    return customer.id;
  }

  return previousCustomerId || null;
}

function isPortalCustomerCode(code) {
  return /^CP\d+$/i.test(String(code || "").trim());
}

function normalizeLocationStr(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findSavedLocationMatch(formattedLocations, savedLocation) {
  if (!savedLocation || !formattedLocations?.length) return null;

  const savedName = savedLocation.locationName;

  // Portal customers use "Primary" as internal key; match by street address
  if (normalizeLocationStr(savedName) === "primary") {
    const savedStreet = normalizeLocationStr(savedLocation.address?.streetAddress);
    if (savedStreet) {
      const primaryMatch = formattedLocations.find((loc) => {
        const street = normalizeLocationStr(loc.street || loc.address);
        return (
          street &&
          (street === savedStreet ||
            street.includes(savedStreet) ||
            savedStreet.includes(street))
        );
      });
      if (primaryMatch) return primaryMatch;
    }
  }

  let match = formattedLocations.find(
    (loc) =>
      loc.siteId === savedName ||
      loc.value === savedName ||
      loc.locationName === savedName
  );
  if (match) return match;

  const savedStreet = normalizeLocationStr(savedLocation.address?.streetAddress);
  if (savedStreet) {
    match = formattedLocations.find((loc) => {
      const street = normalizeLocationStr(loc.street || loc.address);
      return (
        street &&
        (street === savedStreet ||
          street.includes(savedStreet) ||
          savedStreet.includes(street))
      );
    });
    if (match) return match;
  }

  if (savedName) {
    const normName = normalizeLocationStr(savedName);
    match = formattedLocations.find((loc) => {
      const label = normalizeLocationStr(loc.siteId || loc.value || loc.label);
      return label && (label.includes(normName) || normName.includes(label));
    });
  }

  return match || null;
}

function pickRichestPortalAddress(...candidates) {
  let best = "";
  for (const candidate of candidates) {
    const value = String(candidate == null ? "" : candidate).trim();
    if (value.length > best.length) best = value;
  }
  return best;
}

/**
 * Choose the richest available address for a portal location option. The
 * /api/getLocation result wins when it carries a real street; otherwise fall back
 * to the job's saved composite location name, then the customer_address. Keeps the
 * option's siteId/portalLocationId so the save still links to the right row.
 */
function enrichPortalLocationOption(option, savedLocation, customerAddress) {
  if (!option) return option;
  const siteLabel = option.value || option.siteId || "";
  const optionAddress = String(option.address || option.street || "").trim();
  if (!isBareSiteLabelAddress(optionAddress, siteLabel)) {
    // Already has a real composite address — still derive any missing granular
    // fields (Street No./Building No./Zip/Country) from it so the form is complete.
    return fillLocationOptionGranularFromComposite(option);
  }
  const richest = pickRichestPortalAddress(
    savedLocation?.locationName,
    savedLocation?.address?.streetAddress,
    customerAddress,
    optionAddress
  );
  if (!richest || isBareSiteLabelAddress(richest, siteLabel)) {
    return fillLocationOptionGranularFromComposite(option);
  }
  return fillLocationOptionGranularFromComposite({
    ...option,
    address: richest,
    street:
      option.street && !isBareSiteLabelAddress(option.street, siteLabel)
        ? option.street
        : richest,
  });
}

function mapSapContactsToSelectOptions(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const firstName = item.firstName || item.first_name || "";
    const middleName = item.middleName || item.middle_name || "";
    const lastName = item.lastName || item.last_name || "";
    const fullName =
      `${firstName} ${middleName} ${lastName}`.trim() ||
      item.contactId ||
      item.contact_id;
    const contactId = item.contactId || item.contact_id || item.id;
    return {
      value: contactId,
      label: fullName,
      contactId,
      firstName,
      middleName,
      lastName,
      email: item.email || "",
      tel1: item.tel1 || item.phoneNumber || "",
      tel2: item.tel2 || item.mobilePhone || "",
      ...item,
    };
  });
}

function buildSavedContactOption(savedContact) {
  const contactFullName =
    savedContact.contactFullname ||
    `${savedContact.firstName || ""} ${savedContact.middleName || ""} ${savedContact.lastName || ""}`.trim() ||
    savedContact.contactID;
  return {
    value: savedContact.contactID,
    label: contactFullName,
    contactId: savedContact.contactID,
    firstName: savedContact.firstName || "",
    middleName: savedContact.middleName || "",
    lastName: savedContact.lastName || "",
    email: savedContact.email || "",
    tel1: savedContact.phoneNumber || "",
    tel2: savedContact.mobilePhone || "",
    ...savedContact,
  };
}

function findMatchingContactOption(formattedContacts, savedContact) {
  if (!savedContact) return null;
  if (savedContact.contactID) {
    const byId = formattedContacts.find(
      (c) =>
        c.contactId === savedContact.contactID ||
        c.id === savedContact.contactID ||
        c.value === savedContact.contactID
    );
    if (byId) return byId;
  }
  if (savedContact.email) {
    const byEmail = formattedContacts.find(
      (c) =>
        c.email &&
        c.email.toLowerCase() === savedContact.email.toLowerCase()
    );
    if (byEmail) return byEmail;
  }
  if (savedContact.firstName && savedContact.lastName) {
    const byName = formattedContacts.find(
      (c) =>
        c.firstName === savedContact.firstName &&
        c.lastName === savedContact.lastName
    );
    if (byName) return byName;
  }
  return null;
}

/**
 * Synthetic Select option when the job's Service Call ID is not in the live SAP list.
 * Prefers local service_call.subject; never uses "(saved)" as subject (avoids DB pollution on upsert).
 */
async function buildSavedServiceCallOption(serviceCallID) {
  const id = String(serviceCallID ?? "").trim();
  if (!id) return null;

  let callNumber = id;
  let subject = "";

  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const isUUID = id.includes("-") && id.length === 36;
      const { data: row } = isUUID
        ? await supabase
            .from("service_call")
            .select("call_number, subject")
            .eq("id", id)
            .is("deleted_at", null)
            .maybeSingle()
        : await supabase
            .from("service_call")
            .select("call_number, subject")
            .eq("call_number", id)
            .is("deleted_at", null)
            .maybeSingle();

      if (row?.call_number) {
        callNumber = String(row.call_number).trim();
      }
      const rawSubject = row?.subject != null ? String(row.subject).trim() : "";
      if (rawSubject && rawSubject !== "(saved)") {
        subject = rawSubject;
      }
    }
  } catch (err) {
    console.warn("buildSavedServiceCallOption lookup:", err);
  }

  return {
    value: callNumber,
    label: subject ? `${callNumber} - ${subject}` : callNumber,
    serviceCallID: callNumber,
    subject,
  };
}

function resolveServiceCallSubjectForUpsert(selectedServiceCall) {
  const raw =
    selectedServiceCall?.subject != null
      ? String(selectedServiceCall.subject).trim()
      : "";
  if (raw && raw !== "(saved)") return raw;
  const id = selectedServiceCall?.value ?? selectedServiceCall?.serviceCallID;
  return id != null && String(id).trim() !== ""
    ? `Service Call ${String(id).trim()}`
    : "Service Call";
}

const EditJobs = ({ initialJobData, jobId: jobIdProp }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { startDate, endDate, startTime, endTime, workerId, scheduleSession } =
    router.query;
  // UI states
  const [isLoading, setIsLoading] = useState(false);
  const [jobDataLoaded, setJobDataLoaded] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [workersLoaded, setWorkersLoaded] = useState(false);
  const [jobStatusesLoaded, setJobStatusesLoaded] = useState(false);
  const [jobContactTypesLoaded, setJobContactTypesLoaded] = useState(false);
  const [schedulingWindowsLoaded, setSchedulingWindowsLoaded] = useState(false);
  const [customerRelatedDataLoaded, setCustomerRelatedDataLoaded] = useState(false);
  const [showServiceLocation, setShowServiceLocation] = useState(true);
  const [showEquipments, setShowEquipments] = useState(true);
  const [activeKey, setActiveKey] = useState("summary");
  const showJobSummaryTab = true;
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showRepeatExtendModal, setShowRepeatExtendModal] = useState(false);
  const [repeatRule, setRepeatRule] = useState(null);
  const [isExtendingRepeat, setIsExtendingRepeat] = useState(false);

  const customerSource = useMemo(() => {
    if (initialJobData?.source === "portal") return "portal";
    if (isPortalCustomerCode(initialJobData?.customerCode)) return "portal";
    return "sap";
  }, [initialJobData?.source, initialJobData?.customerCode]);

  // Form state
  //const [formData, setFormData] = useState(initialJobData || {});
  const [formData, setFormData] = useState({
    ...initialJobData,
    // Provide default values for all form fields
    jobID: initialJobData?.jobID || '',
    jobNo: initialJobData?.jobNo || '',
    jobName: initialJobData?.jobName || '',
    jobDescription: initialJobData?.jobDescription || '',
    startDate: initialJobData?.startDate || '',
    endDate: initialJobData?.endDate || '',
    startTime: initialJobData?.startTime || '',
    endTime: initialJobData?.endTime || '',
    priority: initialJobData?.priority || '',
    jobStatus: initialJobData?.jobStatus || initialJobData?.status || "554", // DB value from Settings > Job Statuses; dropdown matches by value
    scheduleSession: initialJobData?.scheduleSession || '',
    manualDuration: false,
    estimatedDurationHours:
      initialJobData?.estimatedDurationHours !== undefined &&
      initialJobData?.estimatedDurationHours !== null &&
      initialJobData?.estimatedDurationHours !== ''
        ? initialJobData.estimatedDurationHours
        : '',
    estimatedDurationMinutes:
      initialJobData?.estimatedDurationMinutes !== undefined &&
      initialJobData?.estimatedDurationMinutes !== null &&
      initialJobData?.estimatedDurationMinutes !== ''
        ? initialJobData.estimatedDurationMinutes
        : '',
    contact: {
      contactID: initialJobData?.contact?.contactID || '',
      contactFullname: initialJobData?.contact?.contactFullname || '',
      firstName: initialJobData?.contact?.firstName || '',
      middleName: initialJobData?.contact?.middleName || '',
      lastName: initialJobData?.contact?.lastName || '',
      email: initialJobData?.contact?.email || '',
      mobilePhone: initialJobData?.contact?.mobilePhone || '',
      phoneNumber: initialJobData?.contact?.phoneNumber || '',
      notification: {
        notifyCustomer: initialJobData?.contact?.notification?.notifyCustomer || false
      }
    },
    location: {
      locationName: initialJobData?.location?.locationName || '',
      address: {
        streetNo: initialJobData?.location?.address?.streetNo || '',
        streetAddress: initialJobData?.location?.address?.streetAddress || '',
        block: initialJobData?.location?.address?.block || '',
        buildingNo: initialJobData?.location?.address?.buildingNo || '',
        city: initialJobData?.location?.address?.city || '',
        stateProvince: initialJobData?.location?.address?.stateProvince || '',
        postalCode: initialJobData?.location?.address?.postalCode || '',
        country: initialJobData?.location?.address?.country || ''
      },
      coordinates: {
        latitude: initialJobData?.location?.coordinates?.latitude || '',
        longitude: initialJobData?.location?.coordinates?.longitude || ''
      }
    }
  });
  const [originalData, setOriginalData] = useState({
    startDate: initialJobData?.startDate || '',
    endDate: initialJobData?.endDate || '',
    startTime: initialJobData?.startTime || '',
    endTime: initialJobData?.endTime || '',
    assignedWorkers: initialJobData?.assignedWorkers || []
  });

  const repeatExtendSummary = useMemo(() => {
    if (!repeatRule) return "";
    try {
      return buildRecurrenceSummary(normalizeRecurrenceRule(repeatRule, formData.startDate));
    } catch {
      return "";
    }
  }, [repeatRule, formData.startDate]);

  // Selection states
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  /** Explicit Site/Location clear — honor null location_id on save even if job still has a stale FK. */
  const [locationClearedByUser, setLocationClearedByUser] = useState(false);
  /** User edited address fields — write form values (incl. clears) and skip bare-address guard. */
  const [locationAddressTouched, setLocationAddressTouched] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState([]);
  const [selectedServiceCall, setSelectedServiceCall] = useState(null);
  const [selectedSalesOrder, setSelectedSalesOrder] = useState(null);
  const [selectedJobContactType, setSelectedJobContactType] = useState(null);

  // Data lists
  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workerSearchInput, setWorkerSearchInput] = useState("");
  const [equipments, setEquipments] = useState([]);
  const [serviceCalls, setServiceCalls] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [schedulingWindows, setSchedulingWindows] = useState([]);
  const [jobStatuses, setJobStatuses] = useState(() => getDefaultJobStatuses()); // From Settings > Job Statuses; init with defaults so dropdown is never empty (same as Create Jobs)
  const [jobContactTypes, setJobContactTypes] = useState([]);
  const [tasks, setTasks] = useState(initialJobData?.taskList || []);
  const [assignedWorkersData, setAssignedWorkersData] = useState([]);

  // Other states
  const [jobNo, setJobNo] = useState("0000");
  const [retryCount, setRetryCount] = useState(0);

  const [selectedEquipments, setSelectedEquipments] = useState([]);
  const [originalEquipments, setOriginalEquipments] = useState([]);

  const handleCustomerChangeRef = useRef(null);
  const fetchCustomersRef = useRef(null);
  const customerSeededRef = useRef(false);
  const jobHydratedFromFetchRef = useRef(false);
  const workersHydratedRef = useRef(false);
  const workerQueryPrefillHandledRef = useRef(false);
  const pendingJobContactTypeRef = useRef(null);
  const initialCustomerAppliedRef = useRef(false);
  const customerChangeInFlightRef = useRef(false);

  // Match Create Job: show the form once core lookups are ready. SAP contacts /
  // locations / service calls hydrate in the background (customerRelatedDataLoaded).
  const isFormReady =
    jobDataLoaded &&
    customersLoaded &&
    workersLoaded &&
    jobStatusesLoaded &&
    jobContactTypesLoaded &&
    schedulingWindowsLoaded;

  useEffect(() => {
    if (jobHydratedFromFetchRef.current) return;
    setTasks(initialJobData?.taskList || []);
  }, [initialJobData]);

  // Helper function to format time to HH:MM format
  const formatTimeForInput = (timeString) => {
    if (!timeString) return '';
    // If already in HH:MM format, return as is
    if (typeof timeString === 'string' && /^\d{2}:\d{2}$/.test(timeString)) {
      return timeString;
    }
    // If it's a longer time string, extract HH:MM
    if (typeof timeString === 'string' && timeString.includes(':')) {
      const parts = timeString.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return '';
  };

  // Calculate duration function - moved here to be available for useEffects (same as CreateJobs.js)
  const calculateDuration = (startTime, endTime) => {
    if (!startTime || !endTime) return { hours: 0, minutes: 0 };

    const start = new Date(`2000/01/01 ${startTime}`);
    const end = new Date(`2000/01/01 ${endTime}`);

    // If end time is before start time, assume it's next day
    if (end < start) {
      end.setDate(end.getDate() + 1);
    }

    const diffMs = end - start;
    const diffMins = Math.floor(diffMs / 60000);

    return {
      hours: Math.floor(diffMins / 60),
      minutes: diffMins % 60,
    };
  };

  useEffect(() => {
    if (jobHydratedFromFetchRef.current) return;
    if (initialJobData?.equipments) {
      // Format the initial equipment data to match CreateJob format
      // This format works with EquipmentsTableWithAddDelete
      const formattedEquipments = initialJobData.equipments.map(equipment => ({
        // Support both camelCase (from DB) and PascalCase (from API)
        ItemCode: equipment.ItemCode || equipment.itemCode || '',
        ItemName: equipment.ItemName || equipment.itemName || '',
        ItemGroup: equipment.ItemGroup || equipment.itemGroup || 'Equipment',
        Brand: equipment.Brand || equipment.brand || '',
        EquipmentLocation: equipment.EquipmentLocation || equipment.equipmentLocation || null,
        EquipmentType: equipment.EquipmentType || equipment.equipmentType || '',
        ModelSeries: equipment.ModelSeries || equipment.modelSeries || '',
        SerialNo: equipment.SerialNo || equipment.serialNo || '',
        Notes: equipment.Notes || equipment.notes || '',
        WarrantyStartDate: equipment.WarrantyStartDate || equipment.warrantyStartDate || null,
        WarrantyEndDate: equipment.WarrantyEndDate || equipment.warrantyEndDate || null,
        // Also keep camelCase for compatibility
        itemCode: equipment.ItemCode || equipment.itemCode || '',
        itemName: equipment.ItemName || equipment.itemName || '',
        itemGroup: equipment.ItemGroup || equipment.itemGroup || 'Equipment',
        brand: equipment.Brand || equipment.brand || '',
        equipmentLocation: equipment.EquipmentLocation || equipment.equipmentLocation || null,
        equipmentType: equipment.EquipmentType || equipment.equipmentType || '',
        modelSeries: equipment.ModelSeries || equipment.modelSeries || '',
        serialNo: equipment.SerialNo || equipment.serialNo || '',
        notes: equipment.Notes || equipment.notes || '',
        warrantyStartDate: equipment.WarrantyStartDate || equipment.warrantyStartDate || null,
        warrantyEndDate: equipment.WarrantyEndDate || equipment.warrantyEndDate || null,
      }));

      setOriginalEquipments(formattedEquipments);
      setSelectedEquipments(formattedEquipments);
      
      // Update form data
      setFormData(prev => ({
        ...prev,
        equipments: formattedEquipments
      }));
    }
  }, [initialJobData]);

  // Update formData when initialJobData is available and has time fields
  useEffect(() => {
    if (jobHydratedFromFetchRef.current) return;
    if (initialJobData && (initialJobData.startTime || initialJobData.endTime || initialJobData.jobName)) {
      const formattedStartTime = formatTimeForInput(initialJobData.startTime) || '';
      const formattedEndTime = formatTimeForInput(initialJobData.endTime) || '';
      
      setFormData(prev => ({
        ...prev,
        startTime: formattedStartTime || prev.startTime,
        endTime: formattedEndTime || prev.endTime,
        startDate: initialJobData.startDate || prev.startDate,
        endDate: initialJobData.endDate || prev.endDate,
        jobName: initialJobData.jobName || prev.jobName,
        jobDescription: initialJobData.jobDescription || prev.jobDescription,
        priority: initialJobData.priority || prev.priority,
        jobStatus: initialJobData.jobStatus || initialJobData?.status || prev.jobStatus,
        scheduleSession: initialJobData.scheduleSession || prev.scheduleSession,
        // Use stored values directly - no auto-calculation
        estimatedDurationHours:
          initialJobData.estimatedDurationHours !== undefined &&
          initialJobData.estimatedDurationHours !== null &&
          initialJobData.estimatedDurationHours !== ''
            ? initialJobData.estimatedDurationHours
            : prev.estimatedDurationHours || '',
        estimatedDurationMinutes:
          initialJobData.estimatedDurationMinutes !== undefined &&
          initialJobData.estimatedDurationMinutes !== null &&
          initialJobData.estimatedDurationMinutes !== ''
            ? initialJobData.estimatedDurationMinutes
            : prev.estimatedDurationMinutes || '',
        serviceCallID: initialJobData.serviceCallID || prev.serviceCallID,
        salesOrderID: initialJobData.salesOrderID || prev.salesOrderID,
        customerID: initialJobData.customerID || prev.customerID,
      }));
      
      // Update originalData as well
      setOriginalData(prev => ({
        ...prev,
        startTime: formattedStartTime || prev.startTime,
        endTime: formattedEndTime || prev.endTime,
        startDate: initialJobData.startDate || prev.startDate,
        endDate: initialJobData.endDate || prev.endDate,
      }));

      // Service call will be set after fetching from API in initializeFormData
      // Don't set it here with just UUID - wait for API data

      // Set sales order if available
      if (initialJobData.salesOrderID) {
        setSelectedSalesOrder(prev => prev || {
          value: initialJobData.salesOrderID,
          label: initialJobData.salesOrderID.toString(),
        });
      }

      // Set job contact type if available
      if (initialJobData.jobContactType) {
        setSelectedJobContactType(prev => prev || {
          value: initialJobData.jobContactType.code || initialJobData.jobContactType.value,
          label: initialJobData.jobContactType.name || initialJobData.jobContactType.label,
        });
      }
    }
  }, [initialJobData]);

  // Task Management Functions
  const addTask = () => {
    setTasks((prevTasks) => [
      ...prevTasks,
      {
        taskID: `task-${prevTasks.length + 1}`,
        taskName: "",
        taskDescription: "",
        assignedTo: "",
        isPriority: false,
        isDone: false,
        completionDate: null,
      },
    ]);
  };

  // Keep all the handler functions from CreateJobs
  const handleTaskChange = (index, field, value) => {
    const updatedTasks = [...tasks];
    updatedTasks[index][field] = value;
    setTasks(updatedTasks);
  };

  const handleCheckboxChange = (index, field) => {
    const updatedTasks = [...tasks];
    updatedTasks[index][field] = !updatedTasks[index][field];
    setTasks(updatedTasks);
  };

  const deleteTask = async (index) => {
    try {
      const taskToDelete = tasks[index];

      if (taskToDelete.taskID && taskToDelete.taskID.startsWith("firebase-")) {
        setTasks((prevTasks) => {
          const updatedTasks = [...prevTasks];
          updatedTasks[index] = {
            ...updatedTasks[index],
            isDeleted: true,
            deletedAt: new Date().toISOString(),
          };
          return updatedTasks;
        });
      } else {
        setTasks((prevTasks) => prevTasks.filter((_, i) => i !== index));
      }

      setHasChanges(true);
    } catch (error) {
      console.error("Error deleting task:", error);
      toast.error("Failed to delete task");
    }
  };

  // Function to toggle the visibility of the Service Location section
  const toggleServiceLocation = () => {
    setShowServiceLocation(!showServiceLocation);
  };

  // Function to toggle the visibility of the Equipments section
  const toggleEquipments = () => {
    setShowEquipments(!showEquipments);
  };

  // Seed contact/location UI from saved job; SAP data loads via handleCustomerChange
  useEffect(() => {
    if (jobHydratedFromFetchRef.current) return;
    if (!initialJobData) return;

    if (initialJobData.contact) {
      const contactFullName =
        initialJobData.contact.contactFullname ||
        `${initialJobData.contact.firstName || ""} ${initialJobData.contact.middleName || ""} ${initialJobData.contact.lastName || ""}`.trim() ||
        initialJobData.contact.contactID;
      setSelectedContact({
        value: initialJobData.contact.contactID,
        label: contactFullName,
        ...initialJobData.contact,
      });
      setFormData((prev) => ({
        ...prev,
        contact: initialJobData.contact,
      }));
    }

    if (initialJobData.location) {
      setSelectedLocation({
        value: initialJobData.location.locationName,
        label: initialJobData.location.locationName,
        ...initialJobData.location,
      });
      setFormData((prev) => ({
        ...prev,
        location: initialJobData.location,
      }));
    }
  }, [initialJobData]);

  // Add useEffect to handle initial customer selection
  useEffect(() => {
    const initializeCustomer = async () => {
      const params = new URLSearchParams(window.location.search);
      const customerCode = params.get("customerCode");

      if (customerCode && customers.length > 0) {
        const customerOption = customers.find(
          (customer) => customer.value === customerCode
        );
        if (customerOption) {
          handleCustomerChangeRef.current?.(customerOption);
        }
      }
    };

    initializeCustomer();
  }, [customers]); // Dependency on customers ensures we wait for customer data to load

  // URL parameters useEffect
  useEffect(() => {
    if (!router.isReady) return;

    const hasScheduleQuery =
      router.query.startDate ||
      router.query.endDate ||
      router.query.startTime ||
      router.query.endTime ||
      router.query.scheduleSession;

    if (hasScheduleQuery) {
      setFormData((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          ...(router.query.startDate && { startDate: router.query.startDate }),
          ...(router.query.endDate && { endDate: router.query.endDate }),
          ...(router.query.startTime && { startTime: router.query.startTime }),
          ...(router.query.endTime && { endTime: router.query.endTime }),
          ...(router.query.scheduleSession && {
            scheduleSession: router.query.scheduleSession,
          }),
        };
      });
    }

    // Handle worker selection if workerId is provided (once only)
    if (
      !workerQueryPrefillHandledRef.current &&
      router.query.workerId &&
      workers.length > 0
    ) {
      const selectedWorker = workers.find(
        (worker) => String(worker.value) === String(router.query.workerId)
      );
      if (selectedWorker) {
        setSelectedWorkers([selectedWorker]);
        workerQueryPrefillHandledRef.current = true;
      }
    }
  }, [router.isReady, router.query, workers]);

  const fetchJobContactTypes = async () => {
    try {
      const jobContactTypeResponse = await fetch("/api/getJobContactType", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!jobContactTypeResponse.ok) {
        const errorData = await jobContactTypeResponse.json().catch(() => ({}));
        const message =
          errorData.error ||
          errorData.message ||
          jobContactTypeResponse.statusText ||
          "Unknown error";
        console.error("Job contact types API error:", errorData);
        toast.error(`Failed to fetch job contact types: ${message}`);
        setJobContactTypes([]);
        return;
      }

      const jobContactTypeData = await jobContactTypeResponse.json();

      if (!Array.isArray(jobContactTypeData)) {
        console.error("Job contact types data is not an array:", jobContactTypeData);
        setJobContactTypes([]);
        return;
      }

      const formattedJobContactTypes = jobContactTypeData.map((item) => ({
        value: item.code != null ? String(item.code) : item.code, // Ensure string for consistency
        label: item.name,
      }));

      setJobContactTypes(formattedJobContactTypes);
    } catch (error) {
      console.error("Error fetching job contact types:", error);
      toast.error(`Failed to fetch job contact types: ${error.message}`);
      setJobContactTypes([]);
    } finally {
      setJobContactTypesLoaded(true);
    }
  };

  // Fetch scheduling windows - same as CreateJobs.js
  const fetchSchedulingWindows = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        console.error("Supabase client not available");
        return;
      }

      const { data, error } = await supabase
        .from('scheduling_windows')
        .select('*')
        .is('deleted_at', null)
        .order('time_start', { ascending: true });

      if (error) {
        console.error("Error fetching scheduling windows:", error);
        return;
      }

      const windows = (data || []).map((window) => ({
        id: window.id,
        label: window.label,
        timeStart: window.time_start, // Keep time in 24-hour format for storage and display
        timeEnd: window.time_end, // Keep time in 24-hour format for storage and display
        isPublic: window.is_public,
      }));

      // Sort windows by timeStart in ascending order (as backup, though DB already sorted)
      windows.sort((a, b) => {
        const [aHours, aMinutes] = a.timeStart.split(":").map(Number);
        const [bHours, bMinutes] = b.timeStart.split(":").map(Number);
        return aHours * 60 + aMinutes - (bHours * 60 + bMinutes);
      });

      setSchedulingWindows(windows); // Use the windows directly without formatting
    } catch (error) {
      console.error("Error fetching scheduling windows:", error);
    } finally {
      setSchedulingWindowsLoaded(true);
    }
  };

  useEffect(() => {
    const loadJobStatuses = async () => {
      try {
        const statuses = await fetchJobStatuses();
        setJobStatuses(statuses);
      } finally {
        setJobStatusesLoaded(true);
      }
    };
    loadJobStatuses();
  }, []);

  useEffect(() => {
    if (!jobDataLoaded || !jobStatusesLoaded || jobStatuses.length === 0) return;

    setFormData((prev) => {
      if (!prev) return prev;
      const raw = prev.jobStatus != null ? String(prev.jobStatus).trim() : "";
      if (!raw) return prev;

      const hasMatch = jobStatuses.some(
        (s) =>
          String(s.value || "").trim() === raw ||
          toDbStatus(s.value) === toDbStatus(raw)
      );
      if (hasMatch) return prev;

      // Name match (e.g. saved "On Progress" → Settings option value)
      const byName = findJobStatusEntry(raw, jobStatuses);
      if (byName?.value != null && String(byName.value).trim() !== "") {
        const matchedVal = String(byName.value).trim();
        if (matchedVal !== raw) {
          return { ...prev, jobStatus: matchedVal };
        }
        return prev;
      }

      const resolved = resolveJobStatusForDb(prev.jobStatus, jobStatuses);
      if (String(resolved || "").trim() === raw) return prev;
      return { ...prev, jobStatus: resolved };
    });
  }, [jobDataLoaded, jobStatusesLoaded, jobStatuses]);

  const mergeCustomerOptions = (prev, incoming) => {
    const merged = new Map();
    for (const customer of incoming) {
      const key = customer.cardCode || customer.customerId || customer.value;
      if (key) merged.set(key, customer);
    }
    for (const customer of prev) {
      const key = customer.cardCode || customer.customerId || customer.value;
      if (key && !merged.has(key)) merged.set(key, customer);
    }
    return Array.from(merged.values());
  };

  useEffect(() => {
    if (customerSeededRef.current) return;

    const customerCode = initialJobData?.customerCode;
    const customerName = initialJobData?.customerName;
    const customerId =
      initialJobData?.customerId || initialJobData?.customerID;

    if (!customerCode && !customerName && !customerId) return;

    customerSeededRef.current = true;
    setCustomers([
      {
        value: customerId || customerCode,
        label: `${customerCode || customerId || ""} - ${customerName || ""}`.trim(),
        cardCode: customerCode || "",
        cardName: customerName || "",
        customerId,
        email: initialJobData?.email || "",
        phone_number: initialJobData?.phone_number || "",
        customer_address: initialJobData?.customer_address || "",
      },
    ]);
    setCustomersLoaded(true);
  }, [
    initialJobData?.customerCode,
    initialJobData?.customerName,
    initialJobData?.customerId,
    initialJobData?.customerID,
    initialJobData?.email,
    initialJobData?.phone_number,
    initialJobData?.customer_address,
  ]);

  const fetchCustomers = async () => {
    try {
      const url =
        customerSource === "portal"
          ? "/api/customers/generic"
          : "/api/customers/sap-masterlist";
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch customers: ${response.statusText}`);
      }

      const data = await response.json();

      let formattedCustomers;
      if (customerSource === "portal") {
        const list = (data.customers || data) || [];
        formattedCustomers = list.map((c) => ({
          value: c.id,
          label: `${c.customer_code || c.id} - ${c.customer_name || ""}`,
          cardCode: c.customer_code,
          cardName: c.customer_name,
          customerId: c.id,
          customer_address: c.customer_address,
          email: c.email || "",
          phone_number: c.phone_number || "",
          sap_card_code: c.sap_card_code || null,
        }));
      } else {
        const rows = Array.isArray(data) ? data : [];
        formattedCustomers = rows.map((customer) => ({
          value: customer.cardCode,
          label: `${customer.cardCode} - ${customer.cardName}`,
          cardCode: customer.cardCode,
          cardName: customer.cardName,
          customerId: customer.customerId,
          email: customer.email || "",
          phone_number: customer.phone_number || "",
          customer_address: customer.customer_address || "",
        }));
      }

      if (
        initialJobData?.customerCode &&
        !formattedCustomers.some(
          (c) =>
            c.cardCode === initialJobData.customerCode ||
            c.customerId === initialJobData.customerId ||
            c.value === initialJobData.customerId
        )
      ) {
        formattedCustomers.unshift({
          value: initialJobData.customerId || initialJobData.customerCode,
          label: `${initialJobData.customerCode} - ${initialJobData.customerName || ""}`,
          cardCode: initialJobData.customerCode,
          cardName: initialJobData.customerName || "",
          customerId: initialJobData.customerId || initialJobData.customerID,
          email: initialJobData.email || "",
          phone_number: initialJobData.phone_number || "",
          customer_address: initialJobData.customer_address || "",
        });
      }

      setCustomers((prev) => mergeCustomerOptions(prev, formattedCustomers));
    } catch (error) {
      console.error("❌ Error fetching customers:", {
        message: error.message,
        error: error,
      });
      toast.error("Failed to load customers data", {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    } finally {
      setCustomersLoaded(true);
    }
  };
  fetchCustomersRef.current = fetchCustomers;

  useEffect(() => {
    let isMounted = true;

    const initializeData = async () => {
      if (!isMounted) return;

      await Promise.allSettled([
        fetchSchedulingWindows(),
        fetchCustomersRef.current?.(),
        fetchJobContactTypes(),
      ]);
    };

    initializeData();

    return () => {
      isMounted = false;
    };
  }, []);

  const prevCustomerSourceRef = useRef(customerSource);
  useEffect(() => {
    if (prevCustomerSourceRef.current !== customerSource) {
      prevCustomerSourceRef.current = customerSource;
      initialCustomerAppliedRef.current = false;
      jobHydratedFromFetchRef.current = false;
      setCustomerRelatedDataLoaded(false);
      setSelectedCustomer(null);
      setSelectedContact(null);
      setSelectedLocation(null);
      setContacts([]);
      setLocations([]);
      fetchCustomersRef.current?.();
    }
  }, [customerSource]);

  useEffect(() => {
    if (!jobDataLoaded || customers.length === 0 || initialCustomerAppliedRef.current) {
      return;
    }

    const customerCode =
      selectedCustomer?.cardCode || initialJobData?.customerCode;
    const customerId =
      selectedCustomer?.customerId ||
      initialJobData?.customerId ||
      initialJobData?.customerID;

    if (!customerCode && !customerId) {
      initialCustomerAppliedRef.current = true;
      setCustomerRelatedDataLoaded(true);
      return;
    }

    const initialCustomer = customers.find(
      (c) =>
        (customerCode && c.cardCode === customerCode) ||
        (customerId &&
          (c.customerId === customerId || c.value === customerId))
    );
    if (initialCustomer) {
      initialCustomerAppliedRef.current = true;
      setSelectedCustomer(initialCustomer);
      handleCustomerChangeRef.current?.(initialCustomer);
    }
  }, [
    jobDataLoaded,
    customers,
    selectedCustomer,
    initialJobData?.customerCode,
    initialJobData?.customerId,
    initialJobData?.customerID,
  ]);

  // Apply pending job contact type from fetchJobData once options load; normalize selected value.
  useEffect(() => {
    if (jobContactTypes.length === 0) return;

    const pending = pendingJobContactTypeRef.current;
    if (pending) {
      const matchingOption = jobContactTypes.find(
        (opt) => String(opt.value) === String(pending.code)
      );
      if (matchingOption) {
        setSelectedJobContactType(matchingOption);
        setFormData((prev) => ({
          ...prev,
          jobContactType: {
            code: matchingOption.value,
            name: matchingOption.label,
          },
        }));
      } else {
        setSelectedJobContactType({
          value: String(pending.code),
          label: pending.name,
        });
        setFormData((prev) => ({
          ...prev,
          jobContactType: {
            code: pending.code,
            name: pending.name,
          },
        }));
      }
      pendingJobContactTypeRef.current = null;
      return;
    }

    if (!selectedJobContactType) return;

    const currentValue = String(selectedJobContactType.value);
    const matchingOption = jobContactTypes.find(
      (opt) => String(opt.value) === currentValue
    );
    if (
      matchingOption &&
      String(matchingOption.value) !== String(selectedJobContactType.value)
    ) {
      setSelectedJobContactType(matchingOption);
      setFormData((prev) => ({
        ...prev,
        jobContactType: {
          code: matchingOption.value,
          name: matchingOption.label,
        },
      }));
    }
  }, [jobContactTypes, selectedJobContactType]);

  // Jobs with no saved contact type (e.g. legacy portal-generated): default to Service.
  useEffect(() => {
    if (!jobDataLoaded || selectedJobContactType || jobContactTypes.length === 0) return;
    const serviceOption = findServiceJobContactTypeOption(jobContactTypes);
    if (!serviceOption) return;
    setSelectedJobContactType(serviceOption);
    setFormData((prev) => ({
      ...prev,
      jobContactType: {
        code: serviceOption.value,
        name: serviceOption.label,
      },
    }));
  }, [jobDataLoaded, jobContactTypes, selectedJobContactType]);

  const workerSearchDebounceRef = useRef(null);
  const workerSearchSeqRef = useRef(0);

  const fetchAssignableWorkers = useCallback(async (search = "") => {
    const seq = ++workerSearchSeqRef.current;
    setWorkersLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      const trimmed = String(search || "").trim();
      if (trimmed) params.set("search", trimmed);
      const res = await fetch(`/api/workers/assignable?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error(`Assignable workers failed (${res.status})`);
      }

      const payload = await res.json();
      if (seq !== workerSearchSeqRef.current) return;

      const usersList = mapAssignableWorkersToOptions(payload.workers);

      if (usersList.length === 0 && !trimmed) {
        console.warn("No technicians found in database");
        setWorkers([]);
        toast.warning(
          "No workers available. Please check technician records.",
          {
            duration: 5000,
          }
        );
        return;
      }

      setWorkers(usersList);
    } catch (error) {
      if (seq !== workerSearchSeqRef.current) return;
      console.error("Error fetching assignable workers:", error);
      toast.error("Failed to fetch workers. Please try again.", {
        duration: 5000,
      });
      setWorkers([]);
    } finally {
      if (seq === workerSearchSeqRef.current) {
        setWorkersLoading(false);
        setWorkersLoaded(true);
      }
    }
  }, []);

  const workerSelectOptions = useMemo(
    () => mergeWorkerSelectOptions(workers, selectedWorkers),
    [workers, selectedWorkers]
  );

  useEffect(() => {
    fetchAssignableWorkers("");
    return () => {
      if (workerSearchDebounceRef.current) clearTimeout(workerSearchDebounceRef.current);
    };
  }, [fetchAssignableWorkers]);

  const handleWorkerSearchInputChange = (inputValue, { action }) => {
    if (action !== "input-change") return;
    setWorkerSearchInput(inputValue);
    if (workerSearchDebounceRef.current) clearTimeout(workerSearchDebounceRef.current);
    workerSearchDebounceRef.current = setTimeout(() => {
      fetchAssignableWorkers(inputValue);
    }, 300);
  };

  // Match assigned workers with workers list once on initial load only
  useEffect(() => {
    if (workersHydratedRef.current) return;
    if (assignedWorkersData.length > 0 && workers.length > 0) {
      const matchedWorkers = assignedWorkersData
        .map((worker) => {
          // Try to find by workerId first (user ID - matches CreateJobs format)
          let foundWorker = workers.find(w => w.value === worker.workerId || w.workerId === worker.workerId);
          
          // If not found, try to find by technicianId
          if (!foundWorker && worker.technician_id) {
            foundWorker = workers.find(w => w.technicianId === worker.technician_id);
          }
          
          if (foundWorker) {
            return foundWorker;
          }
          
          // If not found, create a placeholder object
          const workerId = worker.workerId || worker.technician_id;
          return {
            value: workerId,
            label: worker.workerName || worker.full_name || 'Unknown',
            workerId: worker.workerId,
            technicianId: worker.technician_id
          };
        })
        .filter(Boolean); // Remove any undefined/null values
      
      if (matchedWorkers.length > 0) {
        setSelectedWorkers(matchedWorkers);
        workersHydratedRef.current = true;
      }
    }
  }, [assignedWorkersData, workers]);

  // Update the worker selection handler
  const handleWorkersChange = (selected) => {
    //console.log("Worker selection changed:", selected);
    const activeSelections = (selected || []).filter(
      (worker) => String(worker.status || "ACTIVE").toUpperCase() === "ACTIVE"
    );
    setSelectedWorkers(activeSelections);
    setWorkerSearchInput("");
    if (workerSearchDebounceRef.current) clearTimeout(workerSearchDebounceRef.current);
    fetchAssignableWorkers("");

    const formattedWorkers = activeSelections.map((worker) => ({
      workerId: worker.value,
      workerName: worker.label,
    }));

    setFormData((prev) => ({
      ...prev,
      assignedWorkers: formattedWorkers,
    }));

    setHasChanges(true);
  };

  const handleCustomerChange = async (selectedOption) => {
    if (!selectedOption) {
      // Handle clearing the selection
      setSelectedContact(null);
      setSelectedLocation(null);
      setSelectedCustomer(null);
      setSelectedServiceCall(null);
      setSelectedSalesOrder(null);
      setContacts([]);
      setLocations([]);
      setEquipments([]);
      setServiceCalls([]);
      setSalesOrders([]);
      setFormData((prev) => ({
        ...prev,
        customerID: "",
        customerName: "",
        contact: {
          contactID: "",
          contactFullname: "",
          firstName: "",
          middleName: "",
          lastName: "",
          email: "",
          mobilePhone: "",
          phoneNumber: "",
          notification: {
            notifyCustomer: false,
          },
        },
      }));
      setHasChanges(true);
      setCustomerRelatedDataLoaded(true);
      return;
    }

    if (customerChangeInFlightRef.current) return;
    customerChangeInFlightRef.current = true;

    const selectedCustomer = customers.find(
      (option) => option.value === selectedOption.value
    );

    const isSameAsInitialCustomer =
      selectedCustomer?.cardCode === initialJobData?.customerCode ||
      selectedCustomer?.customerId === initialJobData?.customerId ||
      selectedOption?.value === initialJobData?.customerId;
    const isInitialHydration =
      isSameAsInitialCustomer && !jobHydratedFromFetchRef.current;

    try {
      if (!isSameAsInitialCustomer) {
        setSelectedContact(null);
        setSelectedLocation(null);
        setSelectedServiceCall(null);
        setSelectedSalesOrder(null);
        setContacts([]);
        setLocations([]);
        setEquipments([]);
        setServiceCalls([]);
        setSalesOrders([]);
      }

      setSelectedCustomer(selectedOption);

      setFormData((prevFormData) => ({
        ...prevFormData,
        customerID: selectedCustomer ? selectedCustomer.cardCode : "",
        customerName: selectedCustomer ? selectedCustomer.cardName : "",
      }));

    // Portal (generic) customers: build contact from stored email/phone and location from customer_address
    if (customerSource === "portal" && selectedCustomer?.customerId) {
      const primaryContact = {
        value: "primary",
        label: "Primary Contact",
        contactId: "primary",
        firstName: selectedCustomer.cardName || "",
        middleName: "",
        lastName: "",
        email: selectedCustomer.email || "",
        tel1: selectedCustomer.phone_number || "",
        tel2: "",
      };
      setContacts(
        selectedCustomer.email || selectedCustomer.phone_number
          ? [primaryContact]
          : []
      );

      const portalAddress = String(selectedCustomer.customer_address || "").trim();
      // Fallback only: bare customer_address site label when getLocation returns nothing.
      const fallbackPrimaryLocation = portalAddress
        ? {
            value: portalAddress,
            label: portalAddress,
            address: portalAddress,
            siteId: portalAddress,
            street: portalAddress,
            streetNo: "",
            block: "",
            building: "",
            city: "",
            countryName: "",
            zipCode: "",
          }
        : null;

      // Load the customer's real service locations (full addresses) the same way the
      // SAP branch does. /api/getLocation -> fetchMasterlistLocationsByCardCode returns
      // full customer_location rows for CP* (portal) codes via mapCustomerBundleToJobFormLocations.
      let portalGroupedLocations = [];
      let flatPortalLocations = [];
      try {
        const portalCardCode = resolveCustomerCardCode(initialJobData, selectedCustomer);
        if (portalCardCode) {
          const locationsResponse = await fetch("/api/getLocation", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardCode: portalCardCode }),
          });
          if (locationsResponse.ok) {
            const locationsData = await locationsResponse.json();
            if (Array.isArray(locationsData) && locationsData.length > 0) {
              portalGroupedLocations = buildGroupedLocationOptions(locationsData);
              flatPortalLocations = flattenLocationOptions(portalGroupedLocations);
            }
          }
        }
      } catch (portalLocError) {
        console.warn(
          "Portal location load failed; falling back to customer_address:",
          portalLocError
        );
      }

      const hasRealPortalLocations = flatPortalLocations.length > 0;
      const portalLocationOptions = hasRealPortalLocations
        ? portalGroupedLocations
        : fallbackPrimaryLocation
          ? [fallbackPrimaryLocation]
          : [];
      const selectablePortalLocations = hasRealPortalLocations
        ? flatPortalLocations
        : fallbackPrimaryLocation
          ? [fallbackPrimaryLocation]
          : [];

      setLocations(portalLocationOptions);
      setEquipments([]);
      setServiceCalls([]);
      setSalesOrders([]);

      if (isSameAsInitialCustomer) {
        const savedContact = initialJobData?.contact;
        const savedLocation = initialJobData?.location;

        if (savedContact?.contactID || savedContact?.email || savedContact?.firstName) {
          const contactFullName =
            savedContact.contactFullname ||
            `${savedContact.firstName || ""} ${savedContact.middleName || ""} ${savedContact.lastName || ""}`.trim();
          setSelectedContact({
            value: savedContact.contactID,
            label: contactFullName || savedContact.contactID,
            ...savedContact,
          });
          setFormData((prev) => ({
            ...prev,
            contact: savedContact,
          }));
        } else {
          setSelectedContact(
            selectedCustomer.email || selectedCustomer.phone_number
              ? primaryContact
              : null
          );
          setFormData((prev) => ({
            ...prev,
            contact: {
              ...prev.contact,
              contactID:
                selectedCustomer.email || selectedCustomer.phone_number
                  ? "primary"
                  : "",
              contactFullname: selectedCustomer.cardName || "",
              firstName: selectedCustomer.cardName || "",
              middleName: "",
              lastName: "",
              phoneNumber: selectedCustomer.phone_number || "",
              mobilePhone: "",
              email: selectedCustomer.email || "",
            },
          }));
        }

        if (selectablePortalLocations.length > 0) {
          const matchedLocation =
            savedLocation?.locationName || savedLocation?.address?.streetAddress
              ? findSavedLocationMatch(selectablePortalLocations, savedLocation)
              : null;
          const baseLocation =
            matchedLocation ||
            selectablePortalLocations[0] ||
            fallbackPrimaryLocation;
          await handleLocationChange(
            enrichPortalLocationOption(baseLocation, savedLocation, portalAddress),
            { skipGeocode: true }
          );
        }
      } else {
        setSelectedContact(
          selectedCustomer.email || selectedCustomer.phone_number
            ? primaryContact
            : null
        );
        setFormData((prev) => ({
          ...prev,
          equipments: [],
          contact: {
            ...prev.contact,
            contactID:
              selectedCustomer.email || selectedCustomer.phone_number
                ? "primary"
                : "",
            contactFullname: selectedCustomer.cardName || "",
            firstName: selectedCustomer.cardName || "",
            middleName: "",
            lastName: "",
            phoneNumber: selectedCustomer.phone_number || "",
            mobilePhone: "",
            email: selectedCustomer.email || "",
          },
        }));
        const baseLocation =
          selectablePortalLocations[0] || fallbackPrimaryLocation;
        if (baseLocation) {
          await handleLocationChange(
            enrichPortalLocationOption(baseLocation, null, portalAddress)
          );
        }
      }

      setHasChanges(!isSameAsInitialCustomer);
      if (isInitialHydration) {
        jobHydratedFromFetchRef.current = true;
      }
    } else {
    // Background SAP hydration on mount — do not block the form with isLoading.
    if (!isInitialHydration) {
      setIsLoading(true);
    }

    const cardCode = resolveCustomerCardCode(initialJobData, selectedOption);
    if (!cardCode) {
      throw new Error("Customer SAP CardCode is required");
    }

    const savedContact = isSameAsInitialCustomer ? initialJobData?.contact : null;
    const savedLocation = isSameAsInitialCustomer ? initialJobData?.location : null;

    const existingServiceCallID =
      formData.serviceCallID || initialJobData?.serviceCallID;

    const warningToastStyle = {
      background: "#fff",
      color: "#856404",
      padding: "16px",
      borderLeft: "6px solid #ffc107",
    };

    const loadContacts = async () => {
      let formattedContacts = [];
      const masterlistRes = await fetch(
        `/api/customers/masterlist-contacts/${encodeURIComponent(cardCode)}`,
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );
      if (masterlistRes.ok) {
        const json = await masterlistRes.json().catch(() => ({}));
        if (json?.success && Array.isArray(json.contacts) && json.contacts.length > 0) {
          formattedContacts = mapDbContactsToSelectOptions(json.contacts);
        }
      }

      if (formattedContacts.length === 0) {
        const contactsResponse = await fetch("/api/getContacts", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardCode }),
        });
        if (contactsResponse.ok) {
          const contactsData = await contactsResponse.json();
          formattedContacts = mapSapContactsToSelectOptions(contactsData);
        }
      }

      return { formattedContacts };
    };

    const loadLocations = async () => {
      const locationsResponse = await fetch("/api/getLocation", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardCode }),
      });

      if (!locationsResponse.ok) {
        return { ok: false, groupedLocations: [], flatLocations: [] };
      }

      const locationsData = await locationsResponse.json();
      const groupedLocations = buildGroupedLocationOptions(
        Array.isArray(locationsData) ? locationsData : []
      );
      return {
        ok: true,
        groupedLocations,
        flatLocations: flattenLocationOptions(groupedLocations),
      };
    };

    const loadEquipments = async () => {
      const equipmentsResponse = await fetch("/api/getEquipments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardCode }),
      });

      if (!equipmentsResponse.ok) {
        return { ok: false, formattedEquipments: [] };
      }

      const equipmentsData = await equipmentsResponse.json();
      const formattedEquipments = (Array.isArray(equipmentsData)
        ? equipmentsData
        : []
      ).map((item) => ({
        brand: item.Brand,
        equipmentLocation: item.EquipmentLocation || null,
        equipmentType: item.EquipmentType || "",
        itemCode: item.ItemCode || "",
        itemGroup: item.ItemGroup || "Equipment",
        itemName: item.ItemName,
        modelSeries: item.ModelSeries,
        notes: item.Notes || "",
        serialNo: item.SerialNo,
        warrantyStartDate: item.WarrantyStartDate,
        warrantyEndDate: item.WarrantyEndDate,
      }));

      return { ok: true, formattedEquipments };
    };

    const loadServiceCalls = async () => {
      let formattedServiceCalls = [];
      let matchedServiceCall = null;

      const relatedCardCodes = [];
      if (selectedCustomer?.sap_card_code) {
        const sapCode = String(selectedCustomer.sap_card_code).trim();
        if (sapCode && sapCode.toUpperCase() !== String(cardCode).toUpperCase()) {
          relatedCardCodes.push(sapCode);
        }
      }

      const serviceCallResponse = await fetch("/api/getServiceCall", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardCode, relatedCardCodes }),
      });

      if (serviceCallResponse.ok) {
        const serviceCallsData = await serviceCallResponse.json();
        formattedServiceCalls = (Array.isArray(serviceCallsData)
          ? serviceCallsData
          : []
        ).map((item) => {
          const subject = item.subject || "";
          const suffix = item.fetchedForCardCode && item.fetchedForCardCode !== cardCode
            ? ` (${item.fetchedForCardCode})`
            : "";
          return {
            value: item.serviceCallID,
            label: `${item.serviceCallID} - ${subject}${suffix}`,
            serviceCallID: item.serviceCallID,
            subject: item.subject,
            customerName: item.customerName,
            createDate: item.createDate,
            createTime: item.createTime,
            description: item.description,
            fetchedForCardCode: item.fetchedForCardCode,
          };
        });
      }

      if (existingServiceCallID) {
        matchedServiceCall = formattedServiceCalls.find(
          (sc) =>
            sc.serviceCallID === existingServiceCallID ||
            sc.value === existingServiceCallID ||
            sc.serviceCallID?.toString() === existingServiceCallID?.toString()
        );

        if (!matchedServiceCall) {
          try {
            const supabase = getSupabaseClient();
            const isUUID =
              String(existingServiceCallID).includes("-") &&
              String(existingServiceCallID).length === 36;

            if (isUUID && supabase) {
              const { data: serviceCall } = await supabase
                .from("service_call")
                .select("call_number")
                .eq("id", existingServiceCallID)
                .is("deleted_at", null)
                .maybeSingle();

              if (serviceCall?.call_number) {
                matchedServiceCall = formattedServiceCalls.find(
                  (sc) =>
                    sc.serviceCallID?.toString() ===
                      serviceCall.call_number?.toString() ||
                    sc.value?.toString() === serviceCall.call_number?.toString()
                );
              }
            }
          } catch (matchError) {
            console.error("Error matching service call:", matchError);
          }
        }

        if (!matchedServiceCall && isSameAsInitialCustomer) {
          matchedServiceCall = await buildSavedServiceCallOption(existingServiceCallID);
          if (matchedServiceCall) {
            formattedServiceCalls = [...formattedServiceCalls, matchedServiceCall];
          }
        }
      }

      return { formattedServiceCalls, matchedServiceCall };
    };

    const [
      contactsSettled,
      locationsSettled,
      equipmentsSettled,
      serviceCallsSettled,
    ] = await Promise.allSettled([
      loadContacts(),
      loadLocations(),
      loadEquipments(),
      loadServiceCalls(),
    ]);

    if (contactsSettled.status === "fulfilled") {
      const { formattedContacts } = contactsSettled.value;
      if (
        savedContact?.contactID ||
        savedContact?.email ||
        savedContact?.firstName
      ) {
        const matchedContact = findMatchingContactOption(
          formattedContacts,
          savedContact
        );
        if (matchedContact) {
          setContacts(formattedContacts);
          setSelectedContact(matchedContact);
          setFormData((prev) => ({
            ...prev,
            contact: {
              ...savedContact,
              contactID:
                matchedContact.contactId ||
                matchedContact.id ||
                matchedContact.value,
            },
          }));
        } else {
          const synthetic = buildSavedContactOption(savedContact);
          setContacts([...formattedContacts, synthetic]);
          setSelectedContact(synthetic);
        }
      } else {
        setContacts(formattedContacts);
      }
    } else {
      console.error("Error loading contacts:", contactsSettled.reason);
      if (!isSameAsInitialCustomer) {
        setContacts([]);
      } else if (
        savedContact?.contactID ||
        savedContact?.email ||
        savedContact?.firstName
      ) {
        const synthetic = buildSavedContactOption(savedContact);
        setContacts([synthetic]);
        setSelectedContact(synthetic);
      }
    }

    let matchedServiceCall = null;
    if (locationsSettled.status === "fulfilled") {
      const { ok, groupedLocations, flatLocations } = locationsSettled.value;
      if (ok) {
        setLocations(groupedLocations);
        if (savedLocation?.locationName || savedLocation?.address?.streetAddress) {
          const matchedLocation = findSavedLocationMatch(
            flatLocations,
            savedLocation
          );
          if (matchedLocation) {
            // Initial hydration: keep job coordinates; geocode only on user change.
            await handleLocationChange(matchedLocation, { skipGeocode: true });
          }
        }
        if (countGroupedLocationOptions(groupedLocations) === 0) {
          toast("No locations found for this customer.", {
            icon: "⚠️",
            duration: 5000,
            style: warningToastStyle,
          });
        }
      } else if (!isSameAsInitialCustomer) {
        setLocations([]);
        toast("No locations found for this customer.", {
          icon: "⚠️",
          duration: 5000,
          style: warningToastStyle,
        });
      }
    } else {
      console.error("Error loading locations:", locationsSettled.reason);
      if (!isSameAsInitialCustomer) {
        setLocations([]);
      }
    }

    if (equipmentsSettled.status === "fulfilled") {
      const { ok, formattedEquipments } = equipmentsSettled.value;
      if (ok) {
        setEquipments(formattedEquipments);
        if (formattedEquipments.length === 0) {
          toast("No equipments found for this customer.", {
            icon: "⚠️",
            duration: 5000,
            style: warningToastStyle,
          });
        }
      } else if (!isSameAsInitialCustomer) {
        setEquipments([]);
      }
    } else {
      console.error("Error loading equipments:", equipmentsSettled.reason);
      if (!isSameAsInitialCustomer) {
        setEquipments([]);
      }
    }

    if (serviceCallsSettled.status === "fulfilled") {
      const { formattedServiceCalls, matchedServiceCall: matched } =
        serviceCallsSettled.value;
      matchedServiceCall = matched;
      setServiceCalls(formattedServiceCalls);

      if (matchedServiceCall) {
        setSelectedServiceCall(matchedServiceCall);
      } else if (!isSameAsInitialCustomer) {
        setSalesOrders([]);
      }

      if (formattedServiceCalls.length === 0 && !matchedServiceCall) {
        const sapLeadCode = selectedCustomer?.sap_card_code;
        const emptyHint = sapLeadCode
          ? `No service calls under ${cardCode}. Open quotations do not create service calls — check SAP Lead ${sapLeadCode} or create a Service Call in SAP first.`
          : `No service calls found. Open quotations do not create service calls — convert this portal customer to SAP (L*) first, then check the Lead code.`;
        toast(emptyHint, {
          icon: "⚠️",
          duration: 5000,
          style: warningToastStyle,
        });
      }
    } else {
      console.error("Error loading service calls:", serviceCallsSettled.reason);
      if (!isSameAsInitialCustomer) {
        setServiceCalls([]);
        setSalesOrders([]);
      } else if (existingServiceCallID) {
        matchedServiceCall = await buildSavedServiceCallOption(existingServiceCallID);
        if (matchedServiceCall) {
          setServiceCalls([matchedServiceCall]);
          setSelectedServiceCall(matchedServiceCall);
        }
      }
    }

    // Sales orders are deferred until service-call change or sales-order menu open
    // (selectedSalesOrder is already seeded from initialJobData).

    setHasChanges(!isSameAsInitialCustomer);
    if (isInitialHydration) {
      jobHydratedFromFetchRef.current = true;
    }
    }
    } catch (error) {
      console.error("Error in handleCustomerChange:", error);
      toast.error(`Error: ${error.message}`, {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
        iconTheme: {
          primary: "#dc3545",
          secondary: "#fff",
        },
      });
    } finally {
      setIsLoading(false);
      customerChangeInFlightRef.current = false;
      setCustomerRelatedDataLoaded(true);
    }
  };
  handleCustomerChangeRef.current = handleCustomerChange;

  const handleJobContactTypeChange = (selectedOption) => {
    setSelectedJobContactType(selectedOption);

    setFormData((prevData) => ({
      ...prevData,
      jobContactType: {
        code: selectedOption ? selectedOption.value : "",
        name: selectedOption ? selectedOption.label : "",
      },
    }));
    setHasChanges(true);
  };

  const handleContactChange = (selectedOption) => {
    if (!selectedOption) {
      setSelectedContact(null);
      setFormData((prev) => ({
        ...prev,
        contact: {
          contactID: "",
          contactFullname: "",
          firstName: "",
          middleName: "",
          lastName: "",
          email: "",
          mobilePhone: "",
          phoneNumber: "",
          notification: {
            notifyCustomer: prev?.contact?.notification?.notifyCustomer || false,
          },
        },
      }));
      setHasChanges(true);
      return;
    }

    setFormData((prevFormData) => ({
      ...prevFormData,
      contact: formatContactData(selectedOption)
    }));

    setSelectedContact(selectedOption);
    setHasChanges(true);
  };

  const handleLocationChange = async (selectedOption, options = {}) => {
    const { skipGeocode = false } = options;

    if (!selectedOption) {
      // Handle clearing the selection
      setSelectedLocation(null);
      setLocationClearedByUser(true);
      setLocationAddressTouched(false);
      setFormData(prev => ({
        ...prev,
        location: {
          locationName: '',
          address: {
            streetNo: '',
            streetAddress: '',
            block: '',
            buildingNo: '',
            city: '',
            stateProvince: '',
            postalCode: '',
            country: '',
          },
          coordinates: {
            latitude: '',
            longitude: '',
          }
        }
      }));
      setHasChanges(true);
      return;
    }

    // Find the selected location from the flattened options
    const selectedLocation = selectedOption;

    setLocationClearedByUser(false);
    setLocationAddressTouched(false);
    setSelectedLocation(selectedLocation);

    // Update nested `location` and `address` in `formData`
    setFormData((prevFormData) => ({
      ...prevFormData,
      location: buildJobFormLocationPatch(selectedLocation, prevFormData.location),
    }));

    // Initial hydration: keep coordinates already on the job; geocode only when the user changes location.
    if (skipGeocode) {
      setHasChanges(true);
      return;
    }

    // Construct full address for geocoding
    const fullAddress = [
      selectedLocation.value || selectedLocation.siteId || selectedLocation.address,
      selectedLocation.street,
      selectedLocation.building,
      selectedLocation.countryName,
      selectedLocation.zipCode,
    ]
      .filter(Boolean)
      .join(", ");

    // Only attempt geocoding if we have a valid address
    if (fullAddress.trim().length > 0) {
      try {
        const coordinates = await fetchCoordinates(fullAddress);

        if (coordinates) {
          setFormData((prevFormData) => ({
            ...prevFormData,
            location: {
              ...prevFormData.location,
              coordinates: {
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
              },
            },
          }));

          toast.success(`Location coordinates fetched successfully`, {
            duration: 3000,
            style: {
              background: "#fff",
              color: "#28a745",
              padding: "16px",
              borderLeft: "6px solid #28a745",
            },
          });
        } else {
          setFormData((prevFormData) => ({
            ...prevFormData,
            location: {
              ...prevFormData.location,
              coordinates: {
                latitude: null,
                longitude: null,
              },
            },
          }));

          toast(`Could not fetch coordinates for this location. You can still proceed.`, {
            duration: 4000,
            icon: "⚠️",
            style: {
              background: "#fff",
              color: "#856404",
              padding: "16px",
              borderLeft: "6px solid #ffc107",
            },
          });
        }
      } catch (error) {
        console.error("Error fetching coordinates:", error);
        setFormData((prevFormData) => ({
          ...prevFormData,
          location: {
            ...prevFormData.location,
            coordinates: {
              latitude: null,
              longitude: null,
            },
          },
        }));

        toast.warning(`Could not fetch coordinates for this location. You can still proceed.`, {
          duration: 4000,
          style: {
            background: "#fff",
            color: "#856404",
            padding: "16px",
            borderLeft: "6px solid #ffc107",
          },
        });
      }
    } else {
      setFormData((prevFormData) => ({
        ...prevFormData,
        location: {
          ...prevFormData.location,
          coordinates: {
            latitude: null,
            longitude: null,
          },
        },
      }));
    }

    // Set flag to indicate changes
    setHasChanges(true);
  };

  const handleContactFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      contact: {
        ...prev.contact,
        [field]: value,
      },
    }));
    setSelectedContact((prev) => {
      if (!prev || typeof prev !== "object") return prev;
      const next = { ...prev };
      if (field === "firstName") next.firstName = value;
      if (field === "middleName") next.middleName = value;
      if (field === "lastName") next.lastName = value;
      if (field === "phoneNumber") next.tel1 = value;
      if (field === "mobilePhone") next.tel2 = value;
      if (field === "email") next.email = value;
      const fn = String(next.firstName ?? "").trim();
      const mn = String(next.middleName ?? "").trim();
      const ln = String(next.lastName ?? "").trim();
      const display = [fn, mn, ln].filter(Boolean).join(" ").trim();
      const siteTag = String(prev.label || "").includes("· site") ? " · site" : "";
      next.label = (display || "Contact") + siteTag;
      return next;
    });
    setHasChanges(true);
  };

  const handleLocationFieldChange = (field, value) => {
    if (field === "locationName") {
      setFormData((prev) => ({
        ...prev,
        location: { ...prev.location, locationName: value },
      }));
    } else {
      setLocationAddressTouched(true);
      setFormData((prev) => ({
        ...prev,
        location: {
          ...prev.location,
          address: { ...prev.location.address, [field]: value },
        },
      }));
    }
    setHasChanges(true);
  };

  const addPortalEquipment = () => {
    setFormData((prev) => ({
      ...prev,
      equipments: [
        ...(prev.equipments || []),
        {
          itemCode: "",
          itemName: "",
          itemGroup: "",
          brand: "",
          equipmentLocation: "",
          equipmentType: "",
          modelSeries: "",
          serialNo: "",
          notes: "",
          warrantyStartDate: "",
          warrantyEndDate: "",
        },
      ],
    }));
    setHasChanges(true);
  };

  const removePortalEquipment = (index) => {
    setFormData((prev) => ({
      ...prev,
      equipments: (prev.equipments || []).filter((_, i) => i !== index),
    }));
    setHasChanges(true);
  };

  const handlePortalEquipmentChange = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...(prev.equipments || [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, equipments: updated };
    });
    setHasChanges(true);
  };

  const fetchSalesOrdersForServiceCall = async (
    serviceCall,
    { quiet = false } = {}
  ) => {
    if (!serviceCall) {
      setSalesOrders([]);
      return;
    }

    const cardCode = resolveCustomerCardCode(formData, selectedCustomer);
    if (!selectedCustomer || !cardCode) {
      if (!quiet) {
        toast.error("Please select a customer first", {
          duration: 3000,
        });
      }
      return;
    }

    const toastId = "salesOrdersFetch";
    try {
      if (!quiet) {
        toast.loading("Fetching sales orders...", { id: toastId });
      }

      const requestPayload = {
        cardCode,
        serviceCallID: serviceCall.value || serviceCall.serviceCallID,
      };

      const response = await fetch("/api/getSalesOrder", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (!quiet) {
          toast.dismiss(toastId);
          toast.error(
            `Error fetching sales orders: ${errorData.error || "Unknown error"}`,
            {
              duration: 5000,
            }
          );
        }
        setSalesOrders([]);
        return;
      }

      const data = await response.json();

      if (data && Array.isArray(data.value)) {
        const formattedSalesOrders = data.value.map((order) => ({
          value: order.DocNum.toString(),
          label: `${order.DocNum} - ${getStatusText(order.DocStatus)}`,
          docTotal: order.DocTotal,
          docStatus: order.DocStatus,
        }));

        setSalesOrders(formattedSalesOrders);

        const existingSalesOrderID =
          selectedSalesOrder?.value ||
          formData.salesOrderID ||
          initialJobData?.salesOrderID;
        if (existingSalesOrderID) {
          const matchedSalesOrder = formattedSalesOrders.find(
            (so) =>
              so.value === existingSalesOrderID?.toString() ||
              so.value?.toString() === existingSalesOrderID?.toString()
          );
          if (matchedSalesOrder) {
            setSelectedSalesOrder(matchedSalesOrder);
          }
        }

        if (!quiet) {
          toast.dismiss(toastId);
          if (formattedSalesOrders.length === 0) {
            toast("No sales orders found for this service call", {
              icon: "⚠️",
              duration: 5000,
            });
          } else {
            toast.success(
              `Found ${formattedSalesOrders.length} sales order${
                formattedSalesOrders.length > 1 ? "s" : ""
              } for Service Call ${serviceCall.value}`,
              {
                duration: 5000,
              }
            );
          }
        }
      } else {
        setSalesOrders([]);
        if (!quiet) {
          toast.dismiss(toastId);
          console.warn("No sales orders found or invalid data format:", data);
          toast("No sales orders found for this service call", {
            icon: "⚠️",
            duration: 5000,
          });
        }
      }
    } catch (error) {
      console.error("Error fetching sales orders:", error);
      if (!quiet) {
        toast.dismiss(toastId);
        toast.error(`Failed to fetch sales orders: ${error.message}`, {
          duration: 5000,
        });
      }
      setSalesOrders([]);
    }
  };

  const handleSelectedServiceCallChange = async (selectedServiceCall) => {
    setSelectedServiceCall(selectedServiceCall);
    setSelectedSalesOrder(null); // Reset sales order when service call changes
    setHasChanges(true);

    if (!selectedServiceCall) {
      setSalesOrders([]);
      return;
    }

    await fetchSalesOrdersForServiceCall(selectedServiceCall);
  };

  // Add a new function to handle equipment selection changes
  const handleEquipmentSelection = useCallback(({ currentSelections, added, removed }) => {
    // Update the selected equipments state
    setSelectedEquipments(currentSelections);
    
    // Update form data with the new equipment selections
    setFormData(prev => ({
      ...prev,
      equipments: currentSelections
    }));

    // Set flag to indicate changes
    setHasChanges(true);
  }, []);

  const handleNextClick = () => {
    if (activeKey === "summary") {
      setActiveKey("task");
    } else if (activeKey === "task") {
      setActiveKey("scheduling");
    }
  };

  const handleScheduleSessionChange = (e) => {
    const selectedSessionLabel = e.target.value;
    const selectedWindow = schedulingWindows.find(
      (window) => window.label === selectedSessionLabel
    );

    if (selectedWindow) {
      setFormData((prevState) => ({
        ...prevState,
        scheduleSession: selectedWindow.label,
        startTime: selectedWindow.timeStart,
        endTime: selectedWindow.timeEnd
      }));
    } else {
      setFormData((prevState) => ({
        ...prevState,
        scheduleSession: "custom",
        startTime: prevState.startTime || "",
        endTime: prevState.endTime || "",
      }));
    }
    setHasChanges(true);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    if (name === "startTime" || name === "endTime") {
      // Ensure time value is properly formatted (HTML5 time input returns HH:MM format)
      const timeValue = value ? String(value).trim() : "";
      
      // Validate time format (should be HH:MM from HTML5 time input)
      if (timeValue && !timeValue.match(/^\d{1,2}:\d{2}$/)) {
        console.warn(`Invalid time format for ${name}: ${timeValue}`);
      }
      
      setFormData(prev => ({
        ...prev,
        [name]: timeValue,
      }));
      setHasChanges(true);
    } else if (name === "estimatedDurationHours" || name === "estimatedDurationMinutes") {
      // Handle estimated duration fields - allow manual input without auto-calculating end time
      const newValue = value === '' ? '' : Number(value) || 0;
      
      setFormData(prev => ({
        ...prev,
        [name]: newValue
      }));
      setHasChanges(true);
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
      setHasChanges(true);
    }
  };

  // Function to check for overlapping jobs with improved date handling and worker schedule checking
  const checkForOverlappingJobs = async (jobData, existingJobId) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        return { hasConflicts: false, conflicts: [] };
      }

      // Check if we have selected workers from the form
      if (!selectedWorkers || selectedWorkers.length === 0) {
        return { hasConflicts: false, conflicts: [] };
      }

      // Check if the schedule hasn't changed from the original
      // Compare by technician_id, not user.id
      const selectedTechIds = selectedWorkers.map(w => w.technicianId || w.value).sort();
      const originalTechIds = originalData.assignedWorkers?.map(w => w.technician_id || w.workerId).sort() || [];
      const workersUnchanged = JSON.stringify(selectedTechIds) === JSON.stringify(originalTechIds);
      
      if (
        jobData.startDate === originalData.startDate &&
        jobData.endDate === originalData.endDate &&
        jobData.startTime === originalData.startTime &&
        jobData.endTime === originalData.endTime &&
        workersUnchanged
      ) {
        return { hasConflicts: false, conflicts: [] };
      }

      const promises = selectedWorkers.map(async (worker) => {
        if (!worker?.value || !worker?.label) return [];

        try {
          // Get technician_id from worker object (technicianId property) or fetch it
          let technicianId = worker.technicianId;
          
          // If technicianId is not available, fetch it from user
          if (!technicianId) {
            const user = await userService.findById(worker.value);
            const technician = user?.technicians?.[0] || user?.technicians;
            technicianId = technician?.id;
          }
          
          if (!technicianId) {
            console.warn(`No technician_id found for worker ${worker.value}`);
            return [];
          }

          // Query jobs assigned to this technician
          const { data: technicianJobs, error } = await supabase
            .from('technician_jobs')
            .select(`
              *,
              job:job_id(*)
            `)
            .eq('technician_id', technicianId)
            .eq('assignment_status', 'ASSIGNED')
            .is('deleted_at', null);

          if (error) {
            console.error(`Error checking conflicts for worker ${worker.label}:`, error);
            return [];
          }

          // Parse dates
          const newJobStart = new Date(`${jobData.startDate}T${jobData.startTime}`);
          const newJobEnd = new Date(`${jobData.endDate}T${jobData.endTime}`);

          const conflicts = [];

          for (const techJob of (technicianJobs || [])) {
            const existingJob = techJob.job;
            if (!existingJob) continue;

            // Skip comparing with the current job being edited
            if (existingJob.id === existingJobId) continue;

            // Parse existing job dates from Supabase schema
            const existingJobStart = new Date(existingJob.scheduled_start);
            const existingJobEnd = new Date(existingJob.scheduled_end);

            // Check for overlap
            const hasOverlap =
              (newJobStart <= existingJobEnd && newJobEnd >= existingJobStart) ||
              (existingJobStart <= newJobEnd && existingJobEnd >= newJobStart);

            if (hasOverlap) {
              conflicts.push({
                worker: worker.label,
                message: `${worker.label} has a scheduling conflict with Job #${existingJob.job_number || existingJob.id} (${formatDateDDMMYYYY(existingJobStart)} ${existingJobStart.toLocaleTimeString()} - ${existingJobEnd.toLocaleTimeString()})`
              });
            }
          }

          return conflicts;
        } catch (error) {
          console.error(`Error checking conflicts for worker ${worker.label}:`, error);
          return [];
        }
      });

      const results = await Promise.all(promises);
      const allConflicts = results.flat();

      return {
        hasConflicts: allConflicts.length > 0,
        conflicts: allConflicts,
      };
    } catch (error) {
      console.error("Error checking for schedule conflicts:", error);
      throw new Error(`Failed to check schedule conflicts: ${error.message}`);
    }
  };

  const buildJobUpdateSummaryForNotify = useCallback(
    ({ newAssigneesCount = 0 } = {}) => {
      const init = initialJobData || {};
      const parts = [];
      const initStatus = init.jobStatus || init.status || '';
      const curStatus = formData.jobStatus || '';
      if (String(curStatus) !== String(initStatus)) {
        parts.push(`Status: ${initStatus || '—'} → ${curStatus || '—'}`);
      }
      if (
        formData.startDate !== init.startDate ||
        formData.startTime !== init.startTime ||
        formData.endDate !== init.endDate ||
        formData.endTime !== init.endTime
      ) {
        parts.push('Date/time or schedule updated');
      }
      if (String(formData.scheduleSession || '') !== String(init.scheduleSession || '')) {
        parts.push('Schedule session updated');
      }
      if (String(formData.jobName || '') !== String(init.jobName || '')) {
        parts.push('Subject updated');
      }
      if (newAssigneesCount > 0) {
        parts.push(
          newAssigneesCount === 1 ? 'New technician assigned' : `${newAssigneesCount} new technicians assigned`
        );
      }
      if (parts.length === 0) {
        return 'Job details were saved';
      }
      return parts.join(' · ');
    },
    [formData, initialJobData]
  );

  const openRepeatExtendModal = () => {
    setRepeatRule((prev) =>
      normalizeRecurrenceRule(prev || getDefaultRecurrenceRule(formData.startDate), formData.startDate)
    );
    setShowRepeatExtendModal(true);
  };

  const handleRescheduleSave = async (rule) => {
    if (!jobIdProp || !rule?.startDate) {
      toast.error("A valid start date is required.");
      return;
    }

    try {
      setIsLoading(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      const formattedStartDateTime = buildSingaporeDateTimeFromForm(
        rule.startDate,
        formData.startTime
      );
      const endYmd = formData.endDate || rule.startDate;
      const formattedEndDateTime = buildSingaporeDateTimeFromForm(
        endYmd,
        formData.endTime
      );

      await jobService.update(jobIdProp, {
        scheduled_start: formattedStartDateTime
          ? formattedStartDateTime.toISOString()
          : null,
        scheduled_end: formattedEndDateTime
          ? formattedEndDateTime.toISOString()
          : null,
      });

      await supabase
        .from("job_schedule")
        .update({
          jsdate: rule.startDate,
          jedate: endYmd,
          jstime: formData.startTime || null,
          jetime: formData.endTime || null,
          updated_at: new Date().toISOString(),
        })
        .eq("job_id", jobIdProp);

      setFormData((prev) => ({
        ...prev,
        startDate: rule.startDate,
      }));
      setShowRescheduleModal(false);
      toast.success("Job start date updated.");
    } catch (error) {
      console.error("Error rescheduling job start date:", error);
      toast.error(error.message || "Failed to update job start date.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRepeatExtendSave = async (rule) => {
    if (!jobIdProp || isExtendingRepeat) {
      return;
    }

    const normalized = normalizeRecurrenceRule(rule, formData.startDate);
    setRepeatRule(normalized);
    setShowRepeatExtendModal(false);
    setIsExtendingRepeat(true);

    try {
      const workerId = Cookies.get("workerId");
      if (!workerId) {
        throw new Error("Worker ID not found in cookies");
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("id", workerId)
        .single();

      if (userError || !userData) {
        throw new Error("User not found");
      }

      const { data: originalJob, error: jobError } = await supabase
        .from("jobs")
        .select(`
          *,
          customer:customer_id(id, customer_name, customer_code),
          location:location_id(*),
          technician_jobs(
            *,
            technician:technician_id(id, full_name, email, avatar_url)
          ),
          job_equipments(*),
          job_tasks(*)
        `)
        .eq("id", jobIdProp)
        .single();

      if (jobError || !originalJob) {
        throw new Error("Original job not found");
      }

      const { data: jobSchedulesData } = await supabase
        .from("job_schedule")
        .select("*")
        .eq("job_id", jobIdProp)
        .order("created_at", { ascending: true });

      const scheduleTemplate = jobSchedulesData?.[0] || null;
      const startReference = originalJob.scheduled_start
        ? new Date(originalJob.scheduled_start)
        : new Date();
      const endReference = originalJob.scheduled_end
        ? new Date(originalJob.scheduled_end)
        : new Date(startReference.getTime() + 2 * 60 * 60 * 1000);
      const duration = endReference.getTime() - startReference.getTime();

      const newDates = generateOccurrenceDateRanges(normalized, duration, {
        skipFirst: true,
      });

      if (!newDates.length) {
        throw new Error("No repeat dates were generated");
      }

      const createdJobs = await createRepeatSiblingJobs({
        supabase,
        originalJob,
        occurrenceDateRanges: newDates,
        userId: userData.id,
        jobData: {
          Subject: formData.jobName,
          Description: formData.jobDescription,
          scheduleTemplate,
        },
      });

      toast.success(
        `${createdJobs.length} repeat job${createdJobs.length > 1 ? "s" : ""} created successfully.`
      );
    } catch (error) {
      console.error("Error extending repeat jobs:", error);
      toast.error(error.message || "Failed to create repeated jobs.");
    } finally {
      setIsExtendingRepeat(false);
    }
  };

  // Updated handleSubmitClick for editing

  const handleSubmitClick = async () => {
    let auditBefore = null;
    let auditAfter = null;
    try {
      setIsSubmitting(true);
      setProgress(10);
      let newAssigneesCount = 0;
      let technicianIdsAddedForEmail = [];

      const initialWorkersForAudit = (originalData.assignedWorkers || []).map((w) => ({
        label: w.workerName || w.full_name || "Unknown",
        value: w.workerId || w.technician_id,
      }));

      auditBefore = buildJobEditAuditSnapshot({
        formData: initialJobData,
        selectedWorkers: initialWorkersForAudit,
        initialJobData,
        tasks: initialJobData?.taskList,
        selectedContact: initialJobData?.contact
          ? {
              firstName: initialJobData.contact.firstName,
              middleName: initialJobData.contact.middleName,
              lastName: initialJobData.contact.lastName,
            }
          : null,
        selectedLocation: initialJobData?.location
          ? {
              value: initialJobData.location.locationName,
              label: initialJobData.location.locationName,
            }
          : null,
        selectedServiceCall: initialJobData?.serviceCallID
          ? {
              value: initialJobData.serviceCallID,
              label: String(initialJobData.serviceCallID),
            }
          : null,
        selectedSalesOrder: initialJobData?.salesOrderID
          ? {
              value: initialJobData.salesOrderID,
              label: String(initialJobData.salesOrderID),
            }
          : null,
      });

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Format dates for Supabase
      const formattedStartDateTime = buildSingaporeDateTimeFromForm(formData.startDate, formData.startTime);
      const formattedEndDateTime = buildSingaporeDateTimeFromForm(formData.endDate, formData.endTime);

      setProgress(20);

      // Get current job data to check existing location_id and service_call_id
      const currentJobData = await jobService.findById(jobIdProp);
      const previousCustomerId = currentJobData?.customer_id;

      const customerId = await resolveJobCustomerId(
        selectedCustomer,
        previousCustomerId
      );

      const customerChanged =
        customerId && previousCustomerId && customerId !== previousCustomerId;

      // Get or find location_id if location is selected (aligned with CreateJobs.js)
      // When customer changes, clear stale location unless user picked a new one below.
      // Explicit Site/Location clear must null jobs.location_id.
      let locationId = null;
      let resolvedCustomerLocationId = null;
      if (locationClearedByUser) {
        locationId = null;
      } else if (selectedLocation && customerId) {
        const locationName =
          selectedLocation.value ||
          selectedLocation.siteId ||
          selectedLocation.location_name ||
          selectedLocation.locationName ||
          selectedLocation.address ||
          selectedLocation.building ||
          '';

        // Prefer the richer of the selected option vs the nested form address so a
        // bare site label never wins over a full street address — unless the user
        // intentionally edited address fields (incl. clears).
        const formAddr = formData.location?.address || {};
        const formStreet = String(formAddr.streetAddress || '').trim() || null;
        const mergedLocation = locationAddressTouched
          ? {
              ...selectedLocation,
              street: formStreet,
              building: String(formAddr.buildingNo || '').trim() || null,
              block: String(formAddr.block || '').trim() || null,
              city: String(formAddr.city || '').trim() || null,
              zipCode: String(formAddr.postalCode || '').trim() || null,
              streetNo: String(formAddr.streetNo || '').trim() || null,
              countryName: String(formAddr.country || '').trim() || null,
              stateProvince: String(formAddr.stateProvince || '').trim() || null,
              address: formStreet,
              addressType:
                selectedLocation.addressType || selectedLocation.address_type || '',
            }
          : mergeSelectedLocationWithFormAddress(
              selectedLocation,
              formData.location
            );
        const siteLabel = siteLabelFromLocationOption(selectedLocation);

        if (locationName) {
          const { data: existingLocation } = await supabase
            .from('locations')
            .select('id, address, street, building, block, city, zip_code')
            .eq('customer_id', customerId)
            .eq('location_name', locationName)
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle();

          if (existingLocation) {
            locationId = existingLocation.id;

            let lat = formData.location?.coordinates?.latitude;
            let lng = formData.location?.coordinates?.longitude;
            if ((lat === null || lat === undefined || lat === '') && selectedLocation?.coordinates?.latitude) {
              lat = selectedLocation.coordinates.latitude;
            }
            if ((lng === null || lng === undefined || lng === '') && selectedLocation?.coordinates?.longitude) {
              lng = selectedLocation.coordinates.longitude;
            }

            const latStr = (lat !== null && lat !== undefined && lat !== '') ? String(lat) : null;
            const lngStr = (lng !== null && lng !== undefined && lng !== '') ? String(lng) : null;

            const updateData = {
              site_id: selectedLocation.value || selectedLocation.siteId || null,
              address_type: mergedLocation.addressType || null,
            };

            if (locationAddressTouched) {
              // Intentional address edits (incl. clears): write form values; skip bare-address guard.
              updateData.building = mergedLocation.building || null;
              updateData.street_number = mergedLocation.streetNo || null;
              updateData.street = mergedLocation.street || null;
              updateData.block = mergedLocation.block || null;
              updateData.address = mergedLocation.address || null;
              updateData.city = mergedLocation.city || null;
              updateData.country_name = mergedLocation.countryName || null;
              updateData.zip_code = mergedLocation.zipCode || null;
            } else {
              // Guard: don't clobber a richer existing address with a bare site label
              // (e.g. a technician-only save). Still allow legitimate full-address changes.
              const computedAddress = String(
                mergedLocation.address || mergedLocation.street || ''
              ).trim();
              const existingAddress = String(
                existingLocation.address || existingLocation.street || ''
              ).trim();
              const newAddressIsBare = isBareSiteLabelAddress(computedAddress, siteLabel);
              const existingIsRicher =
                !isBareSiteLabelAddress(existingAddress, siteLabel) &&
                existingAddress.length > computedAddress.length;

              if (!(newAddressIsBare && existingIsRicher)) {
                updateData.building = mergedLocation.building || null;
                updateData.street_number = mergedLocation.streetNo || null;
                updateData.street = mergedLocation.street || null;
                updateData.block = mergedLocation.block || null;
                updateData.address = mergedLocation.address || null;
                updateData.city = mergedLocation.city || null;
                updateData.country_name = mergedLocation.countryName || null;
                updateData.zip_code = mergedLocation.zipCode || null;
              }
            }

            if (latStr && lngStr) {
              updateData.current_latitude = latStr;
              updateData.current_longitude = lngStr;
              updateData.destination_latitude = latStr;
              updateData.destination_longitude = lngStr;
            }

            const { error: updateError } = await supabase
              .from('locations')
              .update(updateData)
              .eq('id', locationId);

            if (updateError) {
              console.warn('Error updating location:', updateError);
            }

            if (selectedLocation.value || selectedLocation.siteId) {
              try {
                const { customerLocationId } = await upsertJobCustomerLocation(supabase, {
                  customerId,
                  locationId,
                  selectedLocation: mergedLocation,
                });
                resolvedCustomerLocationId = customerLocationId;
              } catch (custLocErr) {
                console.error('Error upserting customer_location:', custLocErr);
              }
            }
          } else {
            let lat = formData.location?.coordinates?.latitude;
            let lng = formData.location?.coordinates?.longitude;
            if ((lat === null || lat === undefined || lat === '') && selectedLocation?.coordinates?.latitude) {
              lat = selectedLocation.coordinates.latitude;
            }
            if ((lng === null || lng === undefined || lng === '') && selectedLocation?.coordinates?.longitude) {
              lng = selectedLocation.coordinates.longitude;
            }

            const latStr = (lat !== null && lat !== undefined && lat !== '') ? String(lat) : null;
            const lngStr = (lng !== null && lng !== undefined && lng !== '') ? String(lng) : null;

            const { data: newLocation, error: locError } = await supabase
              .from('locations')
              .insert({
                customer_id: customerId,
                location_name: locationName,
                site_id: selectedLocation.value || selectedLocation.siteId || null,
                building: mergedLocation.building || null,
                street_number: mergedLocation.streetNo || null,
                street: mergedLocation.street || null,
                block: mergedLocation.block || null,
                address: mergedLocation.address || null,
                city: mergedLocation.city || null,
                country_name: mergedLocation.countryName || null,
                zip_code: mergedLocation.zipCode || null,
                address_type: mergedLocation.addressType || null,
                current_latitude: latStr,
                current_longitude: lngStr,
                destination_latitude: latStr,
                destination_longitude: lngStr,
              })
              .select()
              .single();

            if (locError) {
              console.error('Error creating location:', locError);
              throw locError;
            }
            locationId = newLocation.id;

            if (selectedLocation.value || selectedLocation.siteId) {
              try {
                const { customerLocationId } = await upsertJobCustomerLocation(supabase, {
                  customerId,
                  locationId,
                  selectedLocation: mergedLocation,
                });
                resolvedCustomerLocationId = customerLocationId;
              } catch (custLocErr) {
                console.error('Error upserting customer_location:', custLocErr);
              }
            }
          }
        }
      } else {
        locationId = customerChanged ? null : (currentJobData?.location_id || null);
      }

      if (
        resolvedCustomerLocationId &&
        selectedCustomer?.cardCode &&
        selectedLocation &&
        (selectedLocation.value || selectedLocation.siteId)
      ) {
        try {
          await fetch('/api/customers/address-details', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerCode: selectedCustomer.cardCode,
              addressName: selectedLocation.value || selectedLocation.siteId,
              addressType: selectedLocation.addressType,
              customerLocationId: resolvedCustomerLocationId,
            }),
          });
        } catch (linkErr) {
          console.warn('Link customer_address_details.customer_location_id:', linkErr);
        }
      }

      // Get or create service_call_id if service call is selected
      let serviceCallId = null;
      if (selectedServiceCall?.value && customerId) {
        const { data: existingServiceCall } = await supabase
          .from('service_call')
          .select('id')
          .eq('call_number', selectedServiceCall.value.toString())
          .eq('customer_id', customerId)
          .is('deleted_at', null)
          .maybeSingle();

        if (existingServiceCall) {
          serviceCallId = existingServiceCall.id;
        } else {
          const { data: newServiceCall, error: serviceCallError } = await supabase
            .from('service_call')
            .insert({
              customer_id: customerId,
              call_number: selectedServiceCall.value.toString(),
              subject: resolveServiceCallSubjectForUpsert(selectedServiceCall),
              description: selectedServiceCall.description || null,
              status: 'OPEN',
              priority: 'MEDIUM',
            })
            .select()
            .single();

          if (serviceCallError) {
            console.error('Error creating service call:', serviceCallError);
            toast.error(`Failed to link service call: ${serviceCallError.message}`);
          } else {
            serviceCallId = newServiceCall.id;
          }
        }
      }

      // Get or create sales_order_id if sales order is selected
      let salesOrderId = null;
      if (selectedSalesOrder?.value) {
        const { data: existingSalesOrder } = await supabase
          .from('sales_order')
          .select('id')
          .eq('document_number', selectedSalesOrder.value.toString())
          .is('deleted_at', null)
          .maybeSingle();

        if (existingSalesOrder) {
          salesOrderId = existingSalesOrder.id;
        } else {
          const { data: newSalesOrder, error: salesOrderError } = await supabase
            .from('sales_order')
            .insert({
              document_number: selectedSalesOrder.value.toString(),
              document_status: selectedSalesOrder.docStatus || null,
              document_total: selectedSalesOrder.docTotal || null,
            })
            .select()
            .single();

          if (salesOrderError) {
            console.error('Error creating sales order:', salesOrderError);
            toast.error(`Failed to link sales order: ${salesOrderError.message}`);
          } else {
            salesOrderId = newSalesOrder.id;
          }
        }
      }

      const contactId = await resolveContactIdFromSelection(supabase, {
        customerId,
        selectedContact,
      });

      // 1. Update main job record with proper schema fields (include status so it always persists when changed)
      const resolvedStatus = resolveJobStatusForDb(formData.jobStatus, jobStatuses) ||
        resolveJobStatusForDb(initialJobData?.jobStatus, jobStatuses) ||
        initialJobData?.status ||
        '554';
      const previousResolved =
        resolveJobStatusForDb(initialJobData?.jobStatus, jobStatuses) ||
        String(initialJobData?.status || '');
      const wasComplete = mapJobStatusToAssignmentStatus(previousResolved) === 'COMPLETED';
      const isNowComplete = mapJobStatusToAssignmentStatus(resolvedStatus) === 'COMPLETED';

      let description = normalizeRichTextHtml(formData.jobDescription || '');
      if (
        customerChanged &&
        /\[CUSTOMER:[^\]]+\]/.test(description) &&
        selectedCustomer
      ) {
        const displayName = selectedCustomer.cardName || selectedCustomer.label;
        const sanitized = sanitizeAifmEmbeddedTagValue(displayName);
        if (sanitized) {
          description = description.replace(
            /\[CUSTOMER:[^\]]+\]/,
            `[CUSTOMER:${sanitized}]`
          );
        }
      }

      const jobUpdateData = {
        title: formData.jobName || '',
        description,
        priority: mapPriorityToDatabase(formData.priority),
        status: resolvedStatus,
        scheduled_start: formattedStartDateTime ? formattedStartDateTime.toISOString() : null,
        scheduled_end: formattedEndDateTime ? formattedEndDateTime.toISOString() : null,
        customer_id: customerId,
        location_id: locationId,
        service_call_id: serviceCallId,
        sales_order_id: salesOrderId,
        contact_id: contactId || null,
      };

      await jobService.update(jobIdProp, jobUpdateData);

      setProgress(40);

      const jobCatId = String(formData.jobCategoryId || initialJobData?.jobCategoryId || '').trim();
      if (jobCatId) {
        try {
          const { data: existing } = await supabase
            .from('job_category')
            .select('id')
            .eq('job_id', jobIdProp)
            .maybeSingle();

          if (existing?.id) {
            await supabase.from('job_category').update({ description: jobCatId }).eq('id', existing.id);
          } else {
            await supabase.from('job_category').insert({ job_id: jobIdProp, description: jobCatId });
          }
        } catch (jobCatErr) {
          console.warn('Failed to persist job_category:', jobCatErr?.message || jobCatErr);
        }
      }

      // Phase 2: Sync job to SAP (non-blocking)
      fetch('/api/jobs/sync-to-sap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobIdProp }),
        credentials: 'include'
      }).then(r => { if (!r.ok) console.warn('SAP job sync failed'); }).catch(e => console.warn('SAP job sync error', e));

      // 2. Update job_tasks - smart sync to preserve created_at on existing rows
      const filteredTasks = tasks.filter(task => !task.isDeleted);
      const isPersistedTaskId = (taskID) =>
        taskID && !String(taskID).startsWith('task-') && !String(taskID).startsWith('firebase-');

      const { data: existingJobTasks, error: fetchTasksError } = await supabase
        .from('job_tasks')
        .select('id')
        .eq('job_id', jobIdProp);

      if (fetchTasksError) {
        console.error('Error fetching existing tasks:', fetchTasksError);
        toast.error(`Failed to load tasks: ${fetchTasksError.message}`);
        setIsSubmitting(false);
        return;
      }

      const currentPersistedIds = filteredTasks
        .map(task => task.taskID)
        .filter(isPersistedTaskId);
      const existingTaskIds = (existingJobTasks || []).map(task => task.id);
      const taskIdsToDelete = existingTaskIds.filter(id => !currentPersistedIds.includes(id));

      if (taskIdsToDelete.length > 0) {
        const { error: deleteTasksError } = await supabase
          .from('job_tasks')
          .delete()
          .in('id', taskIdsToDelete);

        if (deleteTasksError) {
          console.error('Error deleting removed tasks:', deleteTasksError);
          toast.error(`Failed to delete tasks: ${deleteTasksError.message}`);
          setIsSubmitting(false);
          return;
        }
      }

      for (let index = 0; index < filteredTasks.length; index++) {
        const task = filteredTasks[index];
        if (!isPersistedTaskId(task.taskID)) continue;

        const { error: updateTaskError } = await supabase
          .from('job_tasks')
          .update({
            task_name: task.taskName || '',
            task_description: task.taskDescription || '',
            task_order: index + 1,
            is_required: Boolean(task.isPriority),
          })
          .eq('id', task.taskID);

        if (updateTaskError) {
          console.error('Error updating task:', updateTaskError);
          toast.error(`Failed to update tasks: ${updateTaskError.message}`);
          setIsSubmitting(false);
          return;
        }
      }

      const newTasks = filteredTasks.filter(task => !isPersistedTaskId(task.taskID));
      if (newTasks.length > 0) {
        const taskInserts = filteredTasks
          .map((task, index) => ({ task, index }))
          .filter(({ task }) => !isPersistedTaskId(task.taskID))
          .map(({ task, index }) => ({
            job_id: jobIdProp,
            task_name: task.taskName || '',
            task_description: task.taskDescription || '',
            task_order: index + 1,
            is_required: Boolean(task.isPriority),
          }));

        const { error: insertTasksError } = await supabase
          .from('job_tasks')
          .insert(taskInserts);

        if (insertTasksError) {
          console.error('Error inserting new tasks:', insertTasksError);
          toast.error(`Failed to add tasks: ${insertTasksError.message}`);
          setIsSubmitting(false);
          return;
        }
      }

      setProgress(60);

      // 3. Update technician_jobs - smart update to preserve existing records
      // This prevents messages from losing their technician_job_id references
      if (selectedWorkers && selectedWorkers.length > 0) {
        // Get existing technician_jobs for this job
        const { data: existingTechJobs, error: fetchError } = await supabase
          .from('technician_jobs')
          .select('id, technician_id')
          .eq('job_id', jobIdProp)
          .is('deleted_at', null);

        if (fetchError) {
          console.error('Error fetching existing technician jobs:', fetchError);
          toast.error(`Failed to load worker assignments: ${fetchError.message}`);
          setIsSubmitting(false);
          return;
        } else {
          // Map selectedWorkers to get technician_id (not user.id)
          // selectedWorkers has value=user.id, but we need technician_id
          // First try to get technicianId from worker object, otherwise fetch it
          const selectedTechIds = await Promise.all(
            selectedWorkers.map(async (worker) => {
              // If worker already has technicianId, use it (from workers list)
              if (worker.technicianId) {
                return worker.technicianId;
              }
              
              // Otherwise, fetch the user to get technician_id (same as CreateJobs.js)
              try {
                const user = await userService.findById(worker.value);
                const technician = user?.technicians?.[0] || user?.technicians;
                if (technician?.id) {
                  return technician.id;
                }
                console.warn(`No technician found for user ${worker.value}`);
                return null;
              } catch (error) {
                console.error(`Error fetching technician for worker ${worker.value}:`, error);
                return null;
              }
            })
          );
          
          // Filter out null values
          const validTechIds = selectedTechIds.filter(id => id !== null);
          
          if (validTechIds.length === 0 && selectedWorkers.length > 0) {
            toast.error("Failed to get technician IDs for selected workers. Please try again.");
            setIsSubmitting(false);
            return;
          }
          
          // Find existing technician_jobs that should be kept
          const existingTechIds = (existingTechJobs || []).map(tj => tj.technician_id);
          const techIdsToKeep = validTechIds.filter(id => existingTechIds.includes(id));
          const techIdsToAdd = validTechIds.filter(id => !existingTechIds.includes(id));
          const techIdsToRemove = existingTechIds.filter(id => !validTechIds.includes(id));

          // Soft delete technician_jobs that are no longer assigned
          if (techIdsToRemove.length > 0) {
            const { error: deleteError } = await supabase
              .from('technician_jobs')
              .update({ deleted_at: new Date().toISOString() })
              .eq('job_id', jobIdProp)
              .in('technician_id', techIdsToRemove)
              .is('deleted_at', null);

            if (deleteError) {
              console.error('Error removing technician assignments:', deleteError);
              toast.error(`Failed to remove worker assignments: ${deleteError.message}`);
              setIsSubmitting(false);
              return;
            }
          }

          // Derive the assignment_status that mirrors the current job status
          const newAssignmentStatus = mapJobStatusToAssignmentStatus(resolvedStatus);

          // Insert new technician_jobs for newly assigned workers
          if (techIdsToAdd.length > 0) {
            const technicianJobInserts = techIdsToAdd.map(technicianId => ({
              technician_id: technicianId,
              job_id: jobIdProp,
              assignment_status: newAssignmentStatus
            }));

            const { error: insertError } = await supabase
              .from('technician_jobs')
              .insert(technicianJobInserts);

            if (insertError) {
              console.error('Error adding technician assignments:', insertError);
              toast.error(`Failed to add worker assignments: ${insertError.message}`);
              setIsSubmitting(false);
              return;
            }
            newAssigneesCount = techIdsToAdd.length;
            technicianIdsAddedForEmail = [...techIdsToAdd];
          }

          // Update assignment_status for technicians that are staying assigned
          if (techIdsToKeep.length > 0) {
            const { error: keepUpdateError } = await supabase
              .from('technician_jobs')
              .update({ assignment_status: newAssignmentStatus })
              .eq('job_id', jobIdProp)
              .in('technician_id', techIdsToKeep)
              .is('deleted_at', null);

            if (keepUpdateError) {
              console.error('Error updating assignment_status for kept technicians:', keepUpdateError);
              toast.error(`Failed to update worker assignments: ${keepUpdateError.message}`);
              setIsSubmitting(false);
              return;
            }
          }

          // Keep job_schedule.job_tech in sync with primary assignee (mirror scheduler reassign)
          const primaryWorkerName = selectedWorkers[0]?.label || selectedWorkers[0]?.full_name || null;
          if (primaryWorkerName) {
            const { data: primarySchedule } = await supabase
              .from('job_schedule')
              .select('id')
              .eq('job_id', jobIdProp)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();

            if (primarySchedule?.id) {
              const { error: jobTechError } = await supabase
                .from('job_schedule')
                .update({ job_tech: primaryWorkerName })
                .eq('id', primarySchedule.id);

              if (jobTechError) {
                console.error('Error updating job_schedule.job_tech:', jobTechError);
                toast.error(`Failed to update schedule technician: ${jobTechError.message}`);
                setIsSubmitting(false);
                return;
              }
            }
          }
        }
      } else {
        // If no workers selected, soft delete all existing technician_jobs
        const { error: deleteError } = await supabase
          .from('technician_jobs')
          .update({ deleted_at: new Date().toISOString() })
          .eq('job_id', jobIdProp)
          .is('deleted_at', null);

        if (deleteError) {
          console.error('Error removing all technician assignments:', deleteError);
          toast.error(`Failed to remove worker assignments: ${deleteError.message}`);
          setIsSubmitting(false);
          return;
        }

        const { data: primarySchedule } = await supabase
          .from('job_schedule')
          .select('id')
          .eq('job_id', jobIdProp)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (primarySchedule?.id) {
          const { error: jobTechError } = await supabase
            .from('job_schedule')
            .update({ job_tech: null })
            .eq('id', primarySchedule.id);

          if (jobTechError) {
            console.error('Error clearing job_schedule.job_tech:', jobTechError);
            toast.error(`Failed to update schedule technician: ${jobTechError.message}`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      setProgress(80);

      // 4. Update job_schedule table with duration (same as CreateJobs.js)
      // Calculate duration in hours and minutes
      const durationHours = formData.estimatedDurationHours || 0;
      const durationMinutes = formData.estimatedDurationMinutes || 0;
      const totalMinutes = (parseInt(durationHours) * 60) + parseInt(durationMinutes);
      const durationHoursDecimal = (totalMinutes / 60).toFixed(2);
      
      // Get full address from formData.location or selectedLocation
      const fullAddress = formData.location?.fullAddress || 
                         formData.location?.displayAddress || 
                         selectedLocation?.address || 
                         selectedLocation?.fullAddress || 
                         formData.location?.locationName || 
                         '';
      
      // Format time values for job_schedule table (ensure HH:MM:SS format)
      const formatTimeForSchedule = (time) => {
        if (!time) return null;
        const timeStr = String(time).trim();
        if (!timeStr) return null;
        
        // If already in HH:MM:SS format, return as is
        if (timeStr.match(/^\d{2}:\d{2}:\d{2}$/)) {
          return timeStr;
        }
        // If in HH:MM format, add seconds
        if (timeStr.match(/^\d{1,2}:\d{2}$/)) {
          const [hours, minutes] = timeStr.split(':');
          return `${hours.padStart(2, '0')}:${minutes}:00`;
        }
        return null;
      };
      
      const formattedStartTime = formatTimeForSchedule(formData.startTime);
      const formattedEndTime = formatTimeForSchedule(formData.endTime);
      // Check if job_schedule record exists
      const { data: existingSchedule } = await supabase
        .from('job_schedule')
        .select('id')
        .eq('job_id', jobIdProp)
        .maybeSingle();
      
      const scheduleData = {
        job_id: jobIdProp,
        jsdate: formData.startDate || null,
        jedate: formData.endDate || null,
        jstime: formattedStartTime,
        jetime: formattedEndTime,
        dur_type: 'hours', // Duration type: hours, minutes, etc.
        dur: durationHoursDecimal || String(totalMinutes), // Duration value as decimal hours
        address: fullAddress || ''
      };
      
      if (existingSchedule) {
        // Update existing job_schedule record
        const { error: scheduleUpdateError } = await supabase
          .from('job_schedule')
          .update(scheduleData)
          .eq('job_id', jobIdProp);
        
        if (scheduleUpdateError) {
          console.error('Error updating job schedule:', scheduleUpdateError);
          toast.error(`Failed to update schedule details: ${scheduleUpdateError.message}`);
        }
      } else {
        // Insert new job_schedule record
        const { error: scheduleInsertError } = await supabase
          .from('job_schedule')
          .insert(scheduleData);
        
        if (scheduleInsertError) {
          console.error('Error creating job schedule:', scheduleInsertError);
          toast.error(`Failed to save schedule details: ${scheduleInsertError.message}`);
        }
      }

      setProgress(85);

      // 5. Update job_contact_type
      await supabase
        .from('job_contact_type')
        .delete()
        .eq('job_id', jobIdProp);

      if (selectedJobContactType) {
        const contactTypeCode = selectedJobContactType.code || selectedJobContactType.value;
        const codeAsInt = contactTypeCode ? parseInt(contactTypeCode, 10) : null;
        const contactTypeName = selectedJobContactType.name || selectedJobContactType.label || '';
        
        const { error: contactTypeError } = await supabase
          .from('job_contact_type')
          .insert({
            job_id: jobIdProp,
            code: isNaN(codeAsInt) ? null : codeAsInt,
            name: contactTypeName
          });

        if (contactTypeError) {
          console.error('Error updating job contact type:', contactTypeError);
        }
      }

      // 5. Update job_equipments
      await supabase
        .from('job_equipments')
        .delete()
        .eq('job_id', jobIdProp);

      // Reuse customerId from earlier in the function
      if (selectedEquipments && selectedEquipments.length > 0 && customerId) {
        const equipmentInserts = [];
        
        for (const equipment of selectedEquipments) {
          if (equipment.itemCode) {
            // Check for existing equipment using item_code + serial_number + customer_id
            // This allows multiple entries with same item_code but different serial_numbers
            const { data: existingEquipment } = await supabase
              .from('equipments')
              .select('id')
              .eq('item_code', equipment.itemCode)
              .eq('customer_id', customerId)
              .eq('serial_number', equipment.serialNo || equipment.SerialNo || '')
              .is('deleted_at', null)
              .maybeSingle();

            let equipmentId = existingEquipment?.id;

            if (!equipmentId) {
              const { data: newEquipment } = await supabase
                .from('equipments')
                .insert({
                  customer_id: customerId,
                  item_code: equipment.itemCode,
                  item_name: equipment.itemName || equipment.itemCode,
                  item_group: equipment.itemGroup || null,
                  brand: equipment.brand || null,
                  equipment_location: equipment.equipmentLocation || null,
                  equipment_type: equipment.equipmentType || null,
                  model_series: equipment.modelSeries || null,
                  serial_number: equipment.serialNo || null,
                  notes: equipment.notes || null
                })
                .select()
                .single();

              if (newEquipment) equipmentId = newEquipment.id;
            }

            if (equipmentId) {
              equipmentInserts.push({
                job_id: jobIdProp,
                equipment_id: equipmentId,
                quantity_used: 1,
                notes: equipment.notes || null
              });
            }
          }
        }

        if (equipmentInserts.length > 0) {
          const { error: equipmentsError } = await supabase
            .from('job_equipments')
            .insert(equipmentInserts);

          if (equipmentsError) {
            console.error('Error updating equipments:', equipmentsError);
          }
        }
      }

      setProgress(100);

      await emitJobStakeholderNotifications({
        jobId: jobIdProp,
        jobNumber: currentJobData?.job_number || formData.jobNo || jobNo,
        jobTitle: formData.jobName,
        assigneeUserIds: [],
        kind: 'updated',
        updateSummary: buildJobUpdateSummaryForNotify({ newAssigneesCount }),
      });

      if (technicianIdsAddedForEmail.length > 0) {
        void emitJobAssignmentEmails({
          jobId: jobIdProp,
          technicianIds: technicianIdsAddedForEmail,
        });
      }

      if (isNowComplete && !wasComplete) {
        const emailResult = await emitJobCompletedEmail({
          jobId: jobIdProp,
          previousStatus: previousResolved,
        });
        showJobCompletedEmailToast(toast, emailResult);
      }

      try {
        const rh = await refreshTechnicianHoursForJobId(supabase, jobIdProp);
        if (rh?.error) console.error('refreshTechnicianHoursForJobId:', rh.error);
      } catch (e) {
        console.error('refreshTechnicianHoursForJobId:', e);
      }

      auditAfter = buildJobEditAuditSnapshot({
        formData,
        selectedWorkers,
        initialJobData,
        tasks,
        selectedContact,
        selectedLocation,
        selectedServiceCall,
        selectedSalesOrder,
      });
      const updateSummary = buildJobUpdateSummaryForNotify({ newAssigneesCount });

      void clientAuditLog({
        action: "JOB_UPDATE",
        category: "job",
        entityType: "job",
        entityId: jobIdProp,
        entityLabel: currentJobData?.job_number || formData.jobNo || jobNo,
        description: updateSummary || "Job edited via portal",
        details: { updateSummary, jobId: jobIdProp },
        changes: buildAuditChanges(auditBefore, auditAfter),
        status: "success",
      });

      toast.success('Job updated successfully!');
      // Await full mutation cache bust (detail + list/calendar/history/scheduler).
      await invalidateJobCachesAfterMutation(queryClient, jobIdProp, {
        customerCode:
          selectedCustomer?.cardCode ||
          initialJobData?.customerCode ||
          formData?.customerCode,
        customerId:
          selectedCustomer?.value ||
          initialJobData?.customerId ||
          formData?.customerId,
        aliasIds: [
          currentJobData?.id,
          currentJobData?.job_number,
          formData.jobNo,
          jobNo,
        ].filter((id) => id && id !== jobIdProp),
      });
      await queryClient.refetchQueries(queryKeys.jobDetail(jobIdProp));

      // Reset states
      setHasChanges(false);
      setOriginalEquipments(selectedEquipments);

      // Optionally refresh the data
      router.push(`/dashboard/jobs/${jobIdProp}`);

    } catch (error) {
      console.error('Error updating job:', error);
      auditAfter = buildJobEditAuditSnapshot({
        formData,
        selectedWorkers,
        initialJobData,
        tasks,
        selectedContact,
        selectedLocation,
        selectedServiceCall,
        selectedSalesOrder,
      });

      void clientAuditLog({
        action: "JOB_UPDATE",
        category: "job",
        entityType: "job",
        entityId: jobIdProp,
        entityLabel: formData.jobNo || jobNo,
        description: `Failed to update job: ${error.message}`,
        details: { error: error.message },
        changes: buildAuditChanges(auditBefore, auditAfter),
        status: "failure",
      });
      toast.error(`Failed to update job: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSubmitClick();
  };

  // Add this state for tracking changes
  const [hasChanges, setHasChanges] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const isFormDisabled = !isFormReady || isLoading || isSubmitting || isExtendingRepeat;
  // Add handleDescriptionChange function
  const handleDescriptionChange = (content) => {
    setFormData((prevState) => ({
      ...prevState,
      jobDescription: content,
    }));
    setHasChanges(true);
  };

  // Hydrate from parent-provided initialJobData (edit page already fetches job — no duplicate fetch)
  useEffect(() => {
    if (!jobIdProp || !initialJobData) return;

    workersHydratedRef.current = false;
    setJobDataLoaded(true);

    if (initialJobData.jobNo) {
      setJobNo(initialJobData.jobNo);
    }

    setOriginalData({
      startDate: initialJobData.startDate,
      endDate: initialJobData.endDate,
      startTime: initialJobData.startTime,
      endTime: initialJobData.endTime,
      assignedWorkers: initialJobData.assignedWorkers || [],
    });

    if (initialJobData.assignedWorkers?.length > 0) {
      setAssignedWorkersData(initialJobData.assignedWorkers);
    }

    if (initialJobData.jobContactType) {
      pendingJobContactTypeRef.current = {
        code: initialJobData.jobContactType.code,
        name: initialJobData.jobContactType.name,
      };
    }
  }, [jobIdProp, initialJobData]);


  const RequiredFieldLabel = ({ label, htmlFor, className = "mb-2" }) => (
    <Form.Label htmlFor={htmlFor} className={className}>
      {label}
      <span className="text-danger ms-1" title="This field is required">
        *
      </span>
    </Form.Label>
  );

  const FieldHelpIcon = ({ id, children }) => (
    <OverlayTrigger placement="right" overlay={<Tooltip id={id}>{children}</Tooltip>}>
      <span
        tabIndex={0}
        role="button"
        className="ms-1 d-inline-flex align-items-center"
        style={{ cursor: "pointer" }}
      >
        <i className="fe fe-help-circle text-muted" />
      </span>
    </OverlayTrigger>
  );

  // Add unsaved changes warning
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  // Update task management functions
  const handleAddTask = () => {
    const newTask = {
      taskID: `task-${tasks.length + 1}`,
      taskName: "",
      taskDescription: "",
      assignedTo: "",
      isPriority: false,
      isDone: false,
      completionDate: null,
      createdAt: null,
    };

    setTasks((prevTasks) => [...prevTasks, newTask]);
    setHasChanges(true);
  };

  const handleUpdateTask = (index, field, value) => {
    setTasks((prevTasks) => {
      const updatedTasks = [...prevTasks];
      updatedTasks[index] = {
        ...updatedTasks[index],
        [field]: value,
        updatedAt: new Date().toISOString(),
      };
      return updatedTasks;
    });
    setHasChanges(true);
  };

  if (!isFormReady) {
    return <EditJobFormSkeleton />;
  }

  return (
    <>
      <Tabs
        id="noanim-tab-example"
        activeKey={activeKey}
        onSelect={(key) => setActiveKey(key)} // Handle tab change event
        className="mb-3"
        mountOnEnter
        unmountOnExit
      >
        {showJobSummaryTab ? (
        <Tab eventKey="summary" title="Job Summary">
          <Form noValidate onSubmit={handleSubmit}>
            <fieldset disabled={isFormDisabled}>
            <Row className="mb-3">
              <Form.Group as={Col} md="7" controlId="customerList">
                <div className="d-flex align-items-center mb-2">
                  <RequiredFieldLabel label="Customer" className="mb-0" />
                  <FieldHelpIcon id="customer-search-tooltip">
                    <div className="text-start">
                      <strong>Customer Search:</strong>
                      <br />
                      • Search by customer code or name
                      <br />
                      • Selection will load related contacts and locations
                      <br />• Required to proceed with job creation
                    </div>
                  </FieldHelpIcon>
                </div>
                <Select
                  instanceId="customer-select"
                  options={customers}
                  value={selectedCustomer}
                  onChange={handleCustomerChange}
                  placeholder={isLoading ? "Loading customers..." : "Enter Customer Name"}
                  isDisabled={isFormDisabled}
                  isClearable
                  noOptionsMessage={() => isLoading ? "Loading..." : "No customers found"}
                />
              </Form.Group>
            </Row>

            <hr className="my-4" />
            <h5 className="mb-1">Primary Contact</h5>
            <p className="text-muted">Details about the customer.</p>

            <Row className="mb-3">
              <Form.Group as={Col} md="3" controlId="jobWorker">
                <div className="d-flex align-items-center mb-2">
                  <RequiredFieldLabel label="Contact ID" className="mb-0" />
                  <FieldHelpIcon id="contact-tooltip">
                    <div className="text-start">
                      <strong>Contact Information:</strong>
                      <br />
                      • Shows contacts linked to selected customer
                      <br />
                      Auto-fills contact details
                      <br />• Required for job communication
                    </div>
                  </FieldHelpIcon>
                </div>
                <Select
                  instanceId="contact-select"
                  options={contacts}
                  value={selectedContact}
                  onChange={handleContactChange}
                  placeholder="Select Contact ID"
                  isDisabled={isFormDisabled || !selectedCustomer || isLoading}
                  isClearable
                  key={`contact-${selectedCustomer?.value}`}
                />
              </Form.Group>
            </Row>

            {customerSource === "portal" && (
              <div className="alert alert-info py-2 px-3 mb-3" style={{ fontSize: "0.875rem" }}>
                <i className="fe fe-info me-1"></i>
                Portal customer — details are pre-filled from the customer record and can be edited below.
              </div>
            )}
            {customerSource === "sap" && (
              <div className="alert alert-light border py-2 px-3 mb-3" style={{ fontSize: "0.875rem" }}>
                <i className="fe fe-edit me-1"></i>
                Contact and address fields are editable for this job.
              </div>
            )}
            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="validationCustom01">
                <Form.Label>First name</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.contact.firstName}
                  onChange={(e) => handleContactFieldChange("firstName", e.target.value)}
                />
                <Form.Control.Feedback>Looks good!</Form.Control.Feedback>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="validationCustom02">
                <Form.Label>Middle name</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.contact.middleName}
                  onChange={(e) => handleContactFieldChange("middleName", e.target.value)}
                />
                <Form.Control.Feedback>Looks good!</Form.Control.Feedback>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="validationCustom03">
                <Form.Label>Last name</Form.Label>
                <Form.Control
                  type="text"
                  value={formData.contact.lastName}
                  onChange={(e) => handleContactFieldChange("lastName", e.target.value)}
                />
                <Form.Control.Feedback>Looks good!</Form.Control.Feedback>
              </Form.Group>
            </Row>
            <Row className="mb-3">
              <Form.Group
                as={Col}
                md="4"
                controlId="validationCustomPhoneNumber"
              >
                <Form.Label>Phone Number</Form.Label>
                <Form.Control
                  value={formData.contact.phoneNumber || ""}
                  type="text"
                  onChange={(e) => handleContactFieldChange("phoneNumber", e.target.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Please provide a valid phone number.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group
                as={Col}
                md="4"
                controlId="validationCustomMobilePhone"
              >
                <Form.Label>Mobile Phone</Form.Label>
                <Form.Control
                  value={formData.contact.mobilePhone || ""}
                  type="text"
                  onChange={(e) => handleContactFieldChange("mobilePhone", e.target.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Please provide a valid mobile phone number.
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="validationCustomEmail">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  value={formData.contact.email || ""}
                  type="email"
                  onChange={(e) => handleContactFieldChange("email", e.target.value)}
                />
                <Form.Control.Feedback type="invalid">
                  Please provide a valid email.
                </Form.Control.Feedback>
              </Form.Group>
            </Row>

            <hr className="my-4" />
            <h5
              className="mb-1"
              style={{ cursor: "pointer" }}
              onClick={toggleServiceLocation}
            >
              Job Address {showServiceLocation ? "(-)" : "(+)"}
            </h5>
            {showServiceLocation && (
              <>
                <p className="text-muted">Details about the Job Address.</p>
                <Row className="mb-3">
                  <Form.Group as={Col} md="4" controlId="jobLocation">
                    <div className="d-flex align-items-center mb-2">
                      <RequiredFieldLabel label="Site / Location" className="mb-0" />
                      <FieldHelpIcon id="location-tooltip">
                        <div className="text-start">
                          <strong>Location Details:</strong>
                          <br />
                          • Shows addresses linked to customer
                          <br />
                          • Auto-fills complete address
                          <br />• Used for job site information
                        </div>
                      </FieldHelpIcon>
                    </div>
                    <Select
                      instanceId="location-select"
                      options={locations}
                      value={selectedLocation}
                      onChange={handleLocationChange}
                      placeholder="Select Site ID"
                      isDisabled={isFormDisabled || !selectedCustomer || isLoading}
                      isClearable
                      key={`location-${selectedCustomer?.value}`}
                      formatGroupLabel={locationSelectGroupLabel}
                      formatOptionLabel={locationSelectOptionLabel}
                      styles={locationSelectStyles}
                      noOptionsMessage={() => (
                        <div
                          style={{
                            padding: "8px",
                            textAlign: "center",
                            color: "#666",
                          }}
                        >
                          No locations found for this customer
                        </div>
                      )}
                    />
                  </Form.Group>
                </Row>
                <Row className="mb-3">
                  <Form.Group as={Col} controlId="locationName">
                    <Form.Label>Location Name</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.locationName || ""}
                      onChange={(e) => handleLocationFieldChange("locationName", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} controlId="streetNo">
                    <Form.Label>Street No.</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.streetNo || ""}
                      onChange={(e) => handleLocationFieldChange("streetNo", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} controlId="streetAddress">
                    <Form.Label>Street Address</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.streetAddress || ""}
                      onChange={(e) => handleLocationFieldChange("streetAddress", e.target.value)}
                    />
                  </Form.Group>
                </Row>
                <Row className="mb-3">
                  <Form.Group as={Col} controlId="block">
                    <Form.Label>Block</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.block || ""}
                      onChange={(e) => handleLocationFieldChange("block", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} controlId="buildingNo">
                    <Form.Label>Building No.</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.buildingNo || ""}
                      onChange={(e) => handleLocationFieldChange("buildingNo", e.target.value)}
                    />
                  </Form.Group>
                </Row>
                <Row className="mb-3">
                  <Form.Group as={Col} md="3" controlId="country">
                    <Form.Label>Country</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.country || ""}
                      onChange={(e) => handleLocationFieldChange("country", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} md="3" controlId="stateProvince">
                    <Form.Label>State/Province</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.stateProvince || ""}
                      onChange={(e) => handleLocationFieldChange("stateProvince", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} md="3" controlId="city">
                    <Form.Label>City</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.city || ""}
                      onChange={(e) => handleLocationFieldChange("city", e.target.value)}
                    />
                  </Form.Group>
                  <Form.Group as={Col} md="3" controlId="postalCode">
                    <Form.Label>Zip/Postal Code</Form.Label>
                    <Form.Control
                      type="text"
                      value={formData.location?.address?.postalCode || ""}
                      onChange={(e) => handleLocationFieldChange("postalCode", e.target.value)}
                    />
                  </Form.Group>
                </Row>
              </>
            )}

            <hr className="my-4" />
            <h5
              className="mb-1"
              style={{ cursor: "pointer" }}
              onClick={toggleEquipments}
            >
              Job Equipments {showEquipments ? "(-)" : "(+)"}
            </h5>
            {showEquipments && (
              <>
                <p className="text-muted">Details about the Equipments.</p>
                {customerSource === "portal" ? (
                  <div className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span className="fw-semibold" style={{ fontSize: "0.9rem" }}>List of Equipments</span>
                      <Button
                        type="button"
                        variant="outline-primary"
                        size="sm"
                        onClick={addPortalEquipment}
                      >
                        <i className="fe fe-plus me-1"></i>
                        Add Equipment
                      </Button>
                    </div>
                    {(formData.equipments || []).length === 0 ? (
                      <div
                        className="text-center text-muted py-4 border rounded"
                        style={{ background: "#f8f9fa", fontSize: "0.875rem" }}
                      >
                        No equipment added yet. Click &quot;Add Equipment&quot; to add items.
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-bordered table-sm" style={{ fontSize: "0.85rem" }}>
                          <thead className="table-light">
                            <tr>
                              <th style={{ minWidth: 120 }}>Item Code</th>
                              <th style={{ minWidth: 150 }}>Item Name</th>
                              <th style={{ minWidth: 100 }}>Brand</th>
                              <th style={{ minWidth: 120 }}>Model/Series</th>
                              <th style={{ minWidth: 120 }}>Serial No.</th>
                              <th style={{ minWidth: 120 }}>Type</th>
                              <th style={{ minWidth: 150 }}>Location</th>
                              <th style={{ width: 50 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {(formData.equipments || []).map((eq, idx) => (
                              <tr key={idx}>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.itemCode || ""}
                                    placeholder="e.g. AIRCON-01"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "itemCode", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.itemName || ""}
                                    placeholder="e.g. Air Conditioner"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "itemName", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.brand || ""}
                                    placeholder="e.g. Daikin"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "brand", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.modelSeries || ""}
                                    placeholder="e.g. FTX35"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "modelSeries", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.serialNo || ""}
                                    placeholder="e.g. SN123456"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "serialNo", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.equipmentType || ""}
                                    placeholder="e.g. Cooling"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "equipmentType", e.target.value)}
                                  />
                                </td>
                                <td>
                                  <Form.Control
                                    size="sm"
                                    type="text"
                                    value={eq.equipmentLocation || ""}
                                    placeholder="e.g. Living Room"
                                    onChange={(e) => handlePortalEquipmentChange(idx, "equipmentLocation", e.target.value)}
                                  />
                                </td>
                                <td className="text-center align-middle">
                                  <Button
                                    type="button"
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => removePortalEquipment(idx)}
                                    style={{ padding: "2px 7px" }}
                                  >
                                    <i className="fe fe-trash-2"></i>
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <Row className="mb-3">
                    {equipments.length > 0 ? (
                      <EquipmentsTableWithAddDelete
                        equipments={equipments}
                        initialSelected={originalEquipments}
                        onSelectionChange={handleEquipmentSelection}
                      />
                    ) : (
                      <div className="text-center py-4">
                        <p>No equipment data available. Please select a customer first.</p>
                      </div>
                    )}
                  </Row>
                )}
              </>
            )}

            <hr className="my-4" />
            </fieldset>
          </Form>
          <Row className="align-items-center">
            <Col md={{ span: 4, offset: 8 }} xs={12} className="mt-1">
              <Button
                variant="primary"
                onClick={handleNextClick}
                className="float-end"
                disabled={isFormDisabled}
              >
                Next
              </Button>
            </Col>
          </Row>
        </Tab>
        ) : null}

        <Tab eventKey="task" title="Job Task">
          <fieldset disabled={isFormDisabled}>
            <JobTask
              tasks={tasks}
              addTask={addTask}
              handleTaskChange={handleTaskChange}
              handleCheckboxChange={handleCheckboxChange}
              deleteTask={deleteTask}
              requireFields={false}
            />
          </fieldset>

          <Row className="align-items-center">
            <Col md={{ span: 4, offset: 8 }} xs={12} className="mt-1">
              <Button
                variant="primary"
                onClick={handleNextClick}
                className="float-end"
                disabled={isFormDisabled}
              >
                Next
              </Button>
            </Col>
          </Row>
        </Tab>

        <Tab eventKey="scheduling" title="Job Scheduling">
          <Form>
            <fieldset disabled={isFormDisabled}>
            <Row className="mb-3">
              <Col xs="auto">
                <Form.Group as={Col} controlId="jobNo">
                  <Form.Label>Job No.</Form.Label>
                  <Form.Control
                    type="text"
                    value={jobNo}
                    readOnly
                    style={{ width: "220px" }}
                  />
                </Form.Group>
              </Col>
              {/* <Form.Group as={Col} md="2" controlId="scheduleSession">
                <Form.Label>Service Call</Form.Label>
                <Form.Select
                  name="scheduleSession"
                  value={formData.scheduleSession}
                  onChange={handleScheduleSessionChange}
                  aria-label="Select schedule session"
                >
                  <option value="custom">Custom</option>
                  <option value="morning">Morning (9:30am to 1:00pm)</option>
                  <option value="afternoon">
                    Afternoon (1:00pm to 5:30pm)
                  </option>
                </Form.Select>
              </Form.Group>
              <Form.Group as={Col} md="2" controlId="scheduleSession">
                <Form.Label>Sales Order</Form.Label>
                <Form.Select
                  name="scheduleSession"
                  value={formData.scheduleSession}
                  onChange={handleScheduleSessionChange}
                  aria-label="Select schedule session"
                >
                  <option value="custom">Custom</option>
                  <option value="morning">Morning (9:30am to 1:00pm)</option>
                  <option value="afternoon">
                    Afternoon (1:00pm to 5:30pm)
                  </option>
                </Form.Select>
              </Form.Group> */}

              <Form.Group as={Col} md="3" controlId="serviceCall">
                <Form.Label>Service Call</Form.Label>
                <Select
                  instanceId="service-call-select"
                  options={serviceCalls}
                  value={selectedServiceCall}
                  onChange={handleSelectedServiceCallChange}
                  placeholder={selectedCustomer ? "Select Service Call" : "Select Customer first"}
                  isDisabled={isFormDisabled || !selectedCustomer}
                  isClearable
                  noOptionsMessage={() =>
                    selectedCustomer
                      ? "No service calls found for this customer"
                      : "Please select a customer first"
                  }
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="salesOrder">
                <Form.Label>Sales Order</Form.Label>
                <Select
                  instanceId="sales-order-select"
                  options={salesOrders}
                  value={selectedSalesOrder}
                  onChange={(selectedOption) => {
                    setSelectedSalesOrder(selectedOption);
                    setHasChanges(true);
                  }}
                  onMenuOpen={() => {
                    if (selectedServiceCall && salesOrders.length === 0) {
                      void fetchSalesOrdersForServiceCall(selectedServiceCall, {
                        quiet: true,
                      });
                    }
                  }}
                  placeholder={
                    selectedServiceCall
                      ? "Select Sales Order"
                      : "Select Service Call first"
                  }
                  isDisabled={isFormDisabled || !selectedServiceCall}
                  isClearable
                  noOptionsMessage={() =>
                    selectedServiceCall
                      ? "No sales orders found for this service call"
                      : "Please select a service call first"
                  }
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="jobContactType">
                <RequiredFieldLabel label="Job Contact Type" />
                <Select
                  instanceId="job-contact-type-select"
                  options={jobContactTypes}
                  value={selectedJobContactType}
                  onChange={handleJobContactTypeChange}
                  placeholder="Select Contact Type"
                  isClearable
                  isDisabled={isFormDisabled}
                  noOptionsMessage={() => 
                    jobContactTypes.length === 0 
                      ? "No contact types available" 
                      : "No options found"
                  }
                />
                {jobContactTypes.length === 0 && !selectedJobContactType && (
                  <small className="text-muted">
                    No contact types available
                  </small>
                )}
              </Form.Group>
            </Row>

            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="jobCategory">
                <RequiredFieldLabel label="Job Priority" />
                <Form.Select
                  name="priority"
                  value={formData.priority}
                  onChange={handleInputChange}
                  aria-label="Select job category"
                >
                  <option value="" disabled>
                    Select Priority
                  </option>
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                </Form.Select>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="jobCategory">
                <Form.Label>Job Status</Form.Label>
                <Select
                  instanceId="job-status-select-edit"
                  isClearable={false}
                  isDisabled={isFormDisabled}
                  options={(() => {
                    const opts = jobStatuses.map((s) => ({
                      value: s.value,
                      label: s.name,
                      color: s.color,
                    }));
                    const raw =
                      formData.jobStatus != null
                        ? String(formData.jobStatus).trim()
                        : "";
                    if (!raw) return opts;
                    const hasMatch =
                      opts.some(
                        (s) =>
                          String(s.value || "").trim() === raw ||
                          toDbStatus(s.value) === toDbStatus(raw)
                      ) || Boolean(findJobStatusEntry(raw, jobStatuses));
                    if (!hasMatch) {
                      opts.push({
                        value: raw,
                        label: formatJobStatusDisplayLabel(raw),
                      });
                    }
                    return opts;
                  })()}
                  value={
                    formData.jobStatus != null &&
                    String(formData.jobStatus).trim() !== ""
                      ? (() => {
                          const raw = String(formData.jobStatus).trim();
                          const opt =
                            jobStatuses.find(
                              (s) =>
                                String(s.value || "").trim() === raw ||
                                toDbStatus(s.value) === toDbStatus(raw)
                            ) || findJobStatusEntry(raw, jobStatuses);
                          if (opt) {
                            return {
                              value: opt.value,
                              label: opt.name,
                              color: opt.color,
                            };
                          }
                          // Synthetic: saved status not in Settings list — keep field visible
                          return {
                            value: raw,
                            label: formatJobStatusDisplayLabel(raw),
                          };
                        })()
                      : null
                  }
                  onChange={(selected) =>
                    handleInputChange({
                      target: { name: "jobStatus", value: selected?.value ?? "" },
                    })
                  }
                  formatOptionLabel={({ label, color }) => (
                    <span className="d-flex align-items-center">
                      <span
                        style={{
                          display: "inline-block",
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          backgroundColor: color || "currentColor",
                          marginRight: 8,
                          flexShrink: 0,
                        }}
                      />
                      {label}
                    </span>
                  )}
                  placeholder="Select Status"
                  aria-label="Select job status"
                />
              </Form.Group>

              <Form.Group as={Col} md="4" controlId="jobWorker">
                <RequiredFieldLabel label="Assigned Worker" />
                <Select
                  instanceId="worker-select"
                  isMulti={true}
                  name="workers"
                  options={workerSelectOptions}
                  value={selectedWorkers}
                  onChange={handleWorkersChange}
                  onInputChange={handleWorkerSearchInputChange}
                  inputValue={workerSearchInput}
                  filterOption={() => true}
                  placeholder="Search Worker"
                  isSearchable={true}
                  isClearable={true}
                  isLoading={workersLoading}
                  isDisabled={isFormDisabled}
                  closeMenuOnSelect={false}
                  getOptionLabel={(option) => option.label || option.name || 'Unknown'}
                  getOptionValue={(option) => option.value || option.id}
                  noOptionsMessage={() => workers.length === 0 ? "No workers available" : "No workers found"}
                  styles={{
                    control: (baseStyles, state) => ({
                      ...baseStyles,
                      borderColor: state.isFocused ? "#80bdff" : "#ced4da",
                      boxShadow: state.isFocused
                        ? "0 0 0 0.2rem rgba(0,123,255,.25)"
                        : null,
                      "&:hover": {
                        borderColor: state.isFocused ? "#80bdff" : "#ced4da",
                      },
                    }),
                    multiValue: (styles) => ({
                      ...styles,
                      backgroundColor: "#e9ecef",
                      borderRadius: "4px",
                    }),
                    multiValueLabel: (styles) => ({
                      ...styles,
                      color: "#495057",
                      padding: "2px 6px",
                    }),
                    multiValueRemove: (styles) => ({
                      ...styles,
                      ":hover": {
                        backgroundColor: "#dc3545",
                        color: "white",
                      },
                    }),
                  }}
                />
              </Form.Group>
            </Row>
            <Row className="mb-3 align-items-center">
              <Col md="4" className="d-flex flex-wrap gap-2 mb-2 mb-md-0">
                {/* <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => setShowRescheduleModal(true)}
                  disabled={isFormDisabled || isLoading || isExtendingRepeat}
                >
                  Change Job Start Date
                </Button> */}
              </Col>

              {/*
                Repeat Job controls moved below Description (per request).
                <Form.Group as={Col} md="3" className="mb-2 mb-md-0">
                  <Form.Check
                    type="switch"
                    id="repeat-extend-switch"
                    label="Repeat Job"
                    checked={Boolean(repeatRule)}
                    disabled={isFormDisabled || isLoading || isExtendingRepeat}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (checked) {
                        openRepeatExtendModal();
                      } else {
                        setRepeatRule(null);
                      }
                    }}
                  />
                </Form.Group>

                {repeatRule && (
                  <Col md="5">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <span className="text-muted small">{repeatExtendSummary}</span>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={openRepeatExtendModal}
                        disabled={isFormDisabled || isLoading || isExtendingRepeat}
                      >
                        Configure schedule
                      </Button>
                    </div>
                  </Col>
                )}
              */}
            </Row>
            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="startDate">
                <RequiredFieldLabel label="Start Date" />
                <Flatpickr
                  value={formData.startDate ? new Date(formData.startDate + 'T00:00:00') : null}
                  options={{
                    dateFormat: 'd/m/Y',
                    altInput: true,
                    altFormat: 'd/m/Y',
                    allowInput: true,
                    placeholder: 'DD/MM/YYYY',
                    onOpen: (_selectedDates, _dateStr, instance) => {
                      if (repeatRule) {
                        instance.close();
                        setShowRescheduleModal(true);
                      }
                    },
                  }}
                  className="form-control"
                  onChange={(selectedDates, dateStr) => {
                    // Convert selected date to YYYY-MM-DD for storage
                    if (selectedDates && selectedDates.length > 0) {
                      const date = selectedDates[0];
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      handleInputChange({
                        target: {
                          name: 'startDate',
                          value: `${year}-${month}-${day}`
                        }
                      });
                    } else {
                      handleInputChange({
                        target: {
                          name: 'startDate',
                          value: ''
                        }
                      });
                    }
                  }}
                />
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="endDate">
                <RequiredFieldLabel label="End Date" />
                <Flatpickr
                  value={formData.endDate ? new Date(formData.endDate + 'T00:00:00') : null}
                  options={{
                    dateFormat: 'd/m/Y',
                    altInput: true,
                    altFormat: 'd/m/Y',
                    allowInput: true,
                    placeholder: 'DD/MM/YYYY'
                  }}
                  className="form-control"
                  onChange={(selectedDates, dateStr) => {
                    // Convert selected date to YYYY-MM-DD for storage
                    if (selectedDates && selectedDates.length > 0) {
                      const date = selectedDates[0];
                      const year = date.getFullYear();
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      handleInputChange({
                        target: {
                          name: 'endDate',
                          value: `${year}-${month}-${day}`
                        }
                      });
                    } else {
                      handleInputChange({
                        target: {
                          name: 'endDate',
                          value: ''
                        }
                      });
                    }
                  }}
                />
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="scheduleSession">
                <Form.Label>Schedule Session</Form.Label>
                <Form.Select
                  name="scheduleSession"
                  value={formData.scheduleSession || ""}
                  onChange={handleScheduleSessionChange}
                  aria-label="Select schedule session"
                >
                  <option value="">Select a session</option>
                  <option value="custom">Custom</option>
                  {schedulingWindows.map((window) => (
                    <option key={window.id} value={window.label}>
                      {window.label} ({window.timeStart} to {window.timeEnd})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Row>
            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="startTime">
                <RequiredFieldLabel label="Start Time" />
                <Form.Control
                  type="time"
                  name="startTime"
                  value={formData.startTime || ""}
                  onChange={handleInputChange}
                  readOnly={formData.scheduleSession && formData.scheduleSession !== "custom" && formData.scheduleSession !== ""}
                />
              </Form.Group>

              <Form.Group as={Col} md="4" controlId="endTime">
                <RequiredFieldLabel label="End Time" />
                <Form.Control
                  type="time"
                  name="endTime"
                  value={formData.endTime || ""}
                  onChange={handleInputChange}
                  readOnly={formData.scheduleSession && formData.scheduleSession !== "custom" && formData.scheduleSession !== ""}
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="estimatedDuration">
                <RequiredFieldLabel label="Estimated Duration" />
                <InputGroup>
                  <Form.Control
                    type="number"
                    name="estimatedDurationHours"
                    value={formData.estimatedDurationHours ?? ''}
                    onChange={handleInputChange}
                    placeholder="Hours"
                    min="0"
                  />
                  <InputGroup.Text>h</InputGroup.Text>
                  <Form.Control
                    type="number"
                    name="estimatedDurationMinutes"
                    value={formData.estimatedDurationMinutes ?? ''}
                    onChange={handleInputChange}
                    placeholder="Minutes"
                    min="0"
                    max="59"
                  />
                  <InputGroup.Text>m</InputGroup.Text>
                </InputGroup>
              </Form.Group>
            </Row>
            <hr className="my-4" />
            <Row className="mb-3">
              <Form.Group as={Col} controlId="jobName" className="mb-3">
                <RequiredFieldLabel label="Subject Name" />
                <Form.Control
                  type="text"
                  name="jobName"
                  value={formData.jobName}
                  onChange={handleInputChange}
                  placeholder="Enter Subject Name"
                />
              </Form.Group>
              <Form.Group controlId="description" className="mb-3">
                <RequiredFieldLabel label="Description" />
                <ReactQuillEditor
                  initialValue={formData.jobDescription} // Pass the initial value
                  onDescriptionChange={handleDescriptionChange} // Handle changes
                />
              </Form.Group>
            </Row>
            <Row className="mb-3 align-items-center">
              <Form.Group as={Col} md="3" className="mb-2 mb-md-0">
                <Form.Check
                  type="switch"
                  id="repeat-extend-switch"
                  label="Repeat Job"
                  checked={Boolean(repeatRule)}
                  disabled={isFormDisabled || isLoading || isExtendingRepeat}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      openRepeatExtendModal();
                    } else {
                      setRepeatRule(null);
                    }
                  }}
                />
              </Form.Group>

              {repeatRule && (
                <Col md="9">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span className="text-muted small">{repeatExtendSummary}</span>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={openRepeatExtendModal}
                      disabled={isFormDisabled || isLoading || isExtendingRepeat}
                    >
                      Configure schedule
                    </Button>
                  </div>
                </Col>
              )}
            </Row>
            {/* <p className="text-muted">Notification:</p>
            <Row className="mt-3">
              <Form.Group controlId="adminWorkerNotify">
                <Form.Check
                  type="checkbox"
                  name="adminWorkerNotify"
                  checked={formData.adminWorkerNotify}
                  onChange={handleInputChange}
                  label="Admin/Worker: Notify when Job Status changed and new Job message Submitted"
                />
              </Form.Group>
              <Form.Group controlId="customerNotify">
                <Form.Check
                  type="checkbox"
                  name="customerNotify"
                  checked={formData.customerNotify}
                  onChange={handleInputChange}
                  label="Customer: Notify when Job Status changed and new Job message Submitted"
                />
              </Form.Group>
            </Row> */}
            {/* SUBMIT BUTTON! */}
            <Row className="align-items-center">
              <Col md={{ span: 4, offset: 8 }} xs={12} className="mt-4">
                <Button
                  variant="primary"
                  onClick={handleSubmitClick}
                  className="float-end"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Creating Job...
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </Col>
            </Row>
            </fieldset>
          </Form>
        </Tab>
      </Tabs>

      {isSubmitting && (
        <div className={styles.loadingOverlay}>
          <div className="text-center">
            <div className="progress mb-3" style={{ width: "200px" }}>
              <div
                className="progress-bar progress-bar-striped progress-bar-animated"
                role="progressbar"
                style={{ width: `${progress}%` }}
                aria-valuenow={progress}
                aria-valuemin="0"
                aria-valuemax="100"
              />
            </div>
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <div className="mt-2">Updating Job...</div>
          </div>
        </div>
      )}

      <JobRecurrenceModal
        show={showRescheduleModal}
        onHide={() => setShowRescheduleModal(false)}
        initialRule={{
          ...getDefaultRecurrenceRule(formData.startDate),
          isRepeat: false,
          startDate: formData.startDate || formatRecurrenceStartDate(new Date()),
        }}
        onSave={handleRescheduleSave}
        mode="reschedule"
      />

      <JobRecurrenceModal
        show={showRepeatExtendModal}
        onHide={() => {
          setShowRepeatExtendModal(false);
          setRepeatRule(null);
        }}
        initialRule={repeatRule}
        onSave={handleRepeatExtendSave}
        mode="extend"
      />
    </>
  );
};

export default EditJobs;
