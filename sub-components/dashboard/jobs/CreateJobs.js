import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import Select, { components as selectComponents } from "react-select";
import EquipmentsTable from "pages/dashboard/tables/datatable-equipments";
import { getSupabaseClient } from "../../../lib/supabase/client";
import { refreshTechnicianHoursForJobId } from "../../../lib/supabase/technicianHours";
import { jobService, userService, customerService } from "../../../lib/supabase/database";
import { emitJobStakeholderNotifications } from "../../../lib/notifications/jobStakeholderNotificationsClient";
import { emitJobAssignmentEmails } from "../../../lib/notifications/transactionalJobEmailClient";
import { fetchJobStatuses, getDefaultJobStatuses } from "../../../utils/jobStatusSettings";
import { findJobStatusEntry } from "../../../utils/jobStatusDefaults";
import { findServiceJobContactTypeOption } from "../../../lib/jobs/portalDefaultJobContactType";
import { normalizeJobTaskNameForInsert } from "../../../lib/jobs/jobTaskFields";
import {
  buildGroupedLocationOptions,
  countGroupedLocationOptions,
  flattenLocationOptions,
  locationSelectGroupLabel,
  locationSelectOptionLabel,
  locationSelectStyles,
} from "../../../lib/jobs/jobFormLocationSelect";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  mapAssignableWorkersToOptions,
  mergeWorkerSelectOptions,
} from "../../../lib/jobs/assignableWorkerSelect";
import { upsertJobCustomerLocation } from "../../../lib/jobs/upsertJobCustomerLocation";
import { resolveContactIdFromSelection } from "../../../lib/jobs/upsertJobContactFromSelection";
import { buildSingaporeDateTimeFromForm } from "../../../lib/utils/singaporeDateTime";
import { normalizeRichTextHtml } from "../../../lib/utils/normalizeRichTextHtml";
import { clientAuditLog } from "../../../utils/clientAuditLog";
import {
  buildRecurrenceSummary,
  generateOccurrenceDates,
  getDefaultRecurrenceRule,
  normalizeRecurrenceRule,
  validateRecurrenceRule,
} from "../../../lib/jobs/recurrence";
import JobRecurrenceModal from "./_components/JobRecurrenceModal";
import EditJobFormSkeleton from "./_components/EditJobFormSkeleton";
import {
  getNextJobNumber,
  isDuplicateJobNumberError,
} from "../../../lib/jobs/getNextJobNumber";
import mapDbContactsToSelectOptions from "../../../lib/jobs/mapDbContactsToSelectOptions";

const JOB_STATUS_DOT_FALLBACK = "currentColor";

const JobStatusSelectSingleValue = (props) => {
  const { data } = props;
  const dotColor = data?.color || JOB_STATUS_DOT_FALLBACK;
  return (
    <selectComponents.SingleValue {...props}>
      <span className="d-flex align-items-center">
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: dotColor,
            marginRight: 8,
            flexShrink: 0,
          }}
        />
        {data?.label}
      </span>
    </selectComponents.SingleValue>
  );
};
import Swal from "sweetalert2";
import styles from "./CreateJobs.module.css";
import toast from "react-hot-toast";
import JobTask from "./tabs/JobTasklist";
import { useRouter } from "next/router";
import { ReactQuillEditor } from "widgets";
import Flatpickr from "react-flatpickr";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { FaAsterisk } from "react-icons/fa";

// Add this helper function at the top of your file
const sanitizeDataForFirestore = (data) => {
  // Remove undefined values and convert null to empty strings
  const sanitized = {};

  Object.keys(data).forEach((key) => {
    const value = data[key];

    if (value === undefined) {
      return; // Skip undefined values
    }

    if (value === null) {
      sanitized[key] = ""; // Convert null to empty string
    } else if (Array.isArray(value)) {
      // Sanitize arrays
      sanitized[key] = value
        .map((item) => {
          if (typeof item === "object") {
            return sanitizeDataForFirestore(item);
          }
          return item ?? "";
        })
        .filter((item) => item !== undefined);
    } else if (value instanceof Date) {
      // Convert Date objects to ISO string for Supabase
      sanitized[key] = value.toISOString();
    } else if (typeof value === "object" && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeDataForFirestore(value);
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
};

// Priority mapping function to convert form values to database values
const mapPriorityToDatabase = (priority) => {
  if (!priority) return 'MEDIUM';
  
  const priorityMap = {
    'Low': 'LOW',
    'Normal': 'MEDIUM',
    'High': 'HIGH',
    'LOW': 'LOW',
    'MEDIUM': 'MEDIUM',
    'HIGH': 'HIGH',
    'URGENT': 'URGENT'
  };
  
  return priorityMap[priority] || 'MEDIUM';
};

// Job status: from SAP API (U_JobStatusID numeric) or Settings. Store as-is so DB gets numeric e.g. "554".
const resolveJobStatusForDb = (formStatus, jobStatusesList) => {
  const v = formStatus && String(formStatus).trim();
  if (v) {
    // If value looks like SAP numeric ID, persist as-is
    if (/^-?\d+$/.test(v)) return v;
    const fromList = jobStatusesList?.find((s) => String(s.value || "").trim() === v);
    if (fromList?.value) return fromList.value;
    return v.toUpperCase().replace(/\s+/g, "_");
  }
  return jobStatusesList?.[0]?.value || "554";
};

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

// Add this helper function near the top of your file
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

const mapSapEquipmentToSelectOptions = (items = []) =>
  items.map((item) => ({
    value: item.ItemCode || item.item_code || item.id,
    label: item.ItemCode || item.item_name || item.ItemName || "Equipment",
    ...item,
  }));

const generateBaseJobNo = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase client not available');
  }
  try {
    return await getNextJobNumber(supabase);
  } catch (error) {
    console.error("[generateBaseJobNo] Error generating job number:", error);
    throw new Error("Failed to generate job number");
  }
};


const generateRepeatJobNo = (baseJobNo, sequence) => {
  return `${baseJobNo}-${sequence.toString().padStart(3, '0')}`;
};

const generateRepeatGroupId = () => {
  return `R${Date.now()}`;
};

const FALLBACK_JOB_CONTACT_TYPES = [{ value: "3", label: "Service" }];

function hasUsableJobAddress(formData, selectedCustomer) {
  const loc = formData?.location;
  const addr = loc?.address;
  if (loc?.locationName?.trim()) return true;
  if (addr?.streetAddress?.trim()) return true;
  if (selectedCustomer?.customer_address?.trim()) return true;
  return false;
}

function buildSyntheticLocationFromForm(formData, selectedCustomer) {
  const loc = formData?.location || {};
  const addr = loc.address || {};
  const name =
    loc.locationName?.trim() ||
    addr.streetAddress?.trim() ||
    selectedCustomer?.customer_address?.trim() ||
    "Primary";
  return {
    value: name,
    label: name,
    siteId: loc.locationName?.trim() || name,
    address: addr.streetAddress || selectedCustomer?.customer_address || "",
    street: addr.streetAddress || "",
    streetNo: addr.streetNo || "",
    block: addr.block || "",
    building: addr.buildingNo || "",
    city: addr.city || "",
    countryName: addr.country || "",
    zipCode: addr.postalCode || "",
    addressType: loc.addressType === "Billing" ? "B" : "S",
  };
}

function resolveEffectiveLocation(selectedLocation, formData, selectedCustomer) {
  if (selectedLocation) return selectedLocation;
  if (hasUsableJobAddress(formData, selectedCustomer)) {
    return buildSyntheticLocationFromForm(formData, selectedCustomer);
  }
  return null;
}

function buildLocationFormPatchFromSelection(selectedLocation) {
  return {
    locationName:
      selectedLocation.value ||
      selectedLocation.siteId ||
      selectedLocation.address ||
      "",
    addressType: selectedLocation.addressType || "",
    address: {
      streetNo: selectedLocation.streetNo || "",
      streetAddress: selectedLocation.street || "",
      block: selectedLocation.block || "",
      buildingNo: selectedLocation.building || "",
      country: selectedLocation.countryName || "",
      stateProvince: selectedLocation.stateProvince || "",
      city: selectedLocation.city || "",
      postalCode: selectedLocation.zipCode || "",
      addressType:
        selectedLocation.addressType === "B" ? "Billing" : "Shipping",
    },
    displayAddress: `${
      selectedLocation.building ? `${selectedLocation.building} - ` : ""
    }${selectedLocation.address}`,
    fullAddress: [
      selectedLocation.value || selectedLocation.siteId || selectedLocation.address,
      selectedLocation.street,
      selectedLocation.building,
      selectedLocation.countryName,
      selectedLocation.zipCode,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

// Calculate duration function - moved outside component to avoid initialization issues
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

/** Local calendar YYYY-MM-DD — avoids UTC day shifts from Date#toISOString() when building SQL dates. */
const toLocalYmd = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const AddNewJobs = ({ validateJobForm }) => {
  const router = useRouter();
  const { startDate, endDate, startTime, endTime, workerId, scheduleSession, openRepeat } =
    router.query || {};

  // Removed Timestamp - using ISO strings for Supabase

  const [schedulingWindows, setSchedulingWindows] = useState([]); // State for scheduling windows
  const [jobStatuses, setJobStatuses] = useState(() => getDefaultJobStatuses()); // From Settings > Job Statuses; init with defaults so dropdown is never empty

  const [workers, setWorkers] = useState([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workerSearchInput, setWorkerSearchInput] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState([]);
  const workerSearchDebounceRef = useRef(null);
  const workerSearchSeqRef = useRef(0);
  const [tasks, setTasks] = useState([]); // Initialize tasks

  const [serviceCalls, setServiceCalls] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [selectedServiceCall, setSelectedServiceCall] = useState(null);
  const [selectedSalesOrder, setSelectedSalesOrder] = useState(null);

  const [customers, setCustomers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [equipments, setEquipments] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSource, setCustomerSource] = useState("sap"); // "sap" | "portal"
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [jobContactTypes, setJobContactTypes] = useState([]);
  const [selectedJobContactType, setSelectedJobContactType] = useState(null);
  const [jobCategories, setJobCategories] = useState([]);
  const [formData, setFormData] = useState({
    jobID: "", // unique
    jobNo: "",
    jobName: "",
    jobCategoryId: "",
    jobDescription: "",
    serviceCallID: "",
    salesOrderID: "",
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
        notifyCustomer: false, // Default false, can be updated based on user input
      },
    },
    assignedWorkers: {}, // Empty object, will be filled when workers are assigned
    jobStatus: "CREATED", // DB value; options from Settings > Job Statuses
    priority: "Normal", // Default to Normal; options: Low, Normal, High
    startDate: "", // Initialize as empty string instead of null
    endDate: "", // Initialize as empty string instead of null
    startTime: "", // Will be a string representing the time, e.g., '09:00'
    endTime: "", // Will be a string representing the time, e.g., '17:00'
    scheduleSession: "",
    estimatedDurationHours: "",
    estimatedDurationMinutes: "",
    location: {
      locationName: "",
      address: {
        streetNo: "",
        streetAddress: "",
        block: "",
        buildingNo: "",
        city: "",
        stateProvince: "",
        postalCode: "",
      },
      coordinates: {
        latitude: "", // Initialize as empty string instead of null
        longitude: "", // Initialize as empty string instead of null
      },
    },
    taskList: [
      {
        taskID: "", // Will be generated or populated
        taskName: "",
        taskDescription: "",
        assignedTo: "", // Will store worker ID or name
        isPriority: false, // Default false, can be updated later
        isDone: false, // Default false, can be updated when completed
        completionDate: "", // Initialize as empty string instead of null
      },
    ],
    equipments: [
      {
        ItemCode: "",
        itemName: "",
        itemGroup: "",
        brand: "",
        equipmentLocation: "",
        equipmentType: "",
        modelSeries: "",
        serialNo: "",
        notes: "",
        warrantyStartDate: "", // Initialize as empty string instead of null
        warrantyEndDate: "", // Initialize as empty string instead of null
      },
    ],
    customerSignature: {
      signatureURL: "", // URL for the signature image
      signedBy: "",
      signatureTimestamp: "", // Initialize as empty string instead of null
    },
    jobContactType: {
      code: "",
      name: "",
    },
    createdBy: {
      workerId: "",
      fullName: "",
      timestamp: "",
    },
  });
  const initialFormData = {
    jobID: "", // unique
    jobNo: "",
    jobName: "",
    jobCategoryId: "",
    jobDescription: "",
    serviceCallID: "",
    salesOrderID: "",
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
        notifyCustomer: false, // Default false, can be updated based on user input
      },
    },
    assignedWorkers: {}, // Empty object, will be filled when workers are assigned
    jobStatus: "CREATED", // DB value; options from Settings > Job Statuses
    priority: "Normal", // Default to Normal; options: Low, Normal, High
    startDate: "", // Initialize as empty string instead of null
    endDate: "", // Initialize as empty string instead of null
    startTime: "", // Will be a string representing the time, e.g., '09:00'
    endTime: "", // Will be a string representing the time, e.g., '17:00'
    scheduleSession: "",
    estimatedDurationHours: "",
    estimatedDurationMinutes: "",
    location: {
      locationName: "",
      address: {
        streetNo: "",
        streetAddress: "",
        block: "",
        buildingNo: "",
        city: "",
        stateProvince: "",
        postalCode: "",
      },
      coordinates: {
        latitude: "", // Initialize as empty string instead of null
        longitude: "", // Initialize as empty string instead of null
      },
    },
    taskList: [
      {
        taskID: "", // Will be generated or populated
        taskName: "",
        taskDescription: "",
        assignedTo: "", // Will store worker ID or name
        isPriority: false, // Default false, can be updated later
        isDone: false, // Default false, can be updated when completed
        completionDate: "", // Initialize as empty string instead of null
      },
    ],
    equipments: [
      {
        ItemCode: "",
        itemName: "",
        itemGroup: "",
        brand: "",
        equipmentLocation: "",
        equipmentType: "",
        modelSeries: "",
        serialNo: "",
        notes: "",
        warrantyStartDate: "", // Initialize as empty string instead of null
        warrantyEndDate: "", // Initialize as empty string instead of null
      },
    ],
    customerSignature: {
      signatureURL: "", // URL for the signature image
      signedBy: "",
      signatureTimestamp: "", // Initialize as empty string instead of null
    },
    jobContactType: {
      code: "",
      name: "",
    },
    createdBy: {
      workerId: "",
      fullName: "",
      timestamp: "",
    },
  };

  const [showServiceLocation, setShowServiceLocation] = useState(true);
  const [showEquipments, setShowEquipments] = useState(true);
  const [jobNo, setJobNo] = useState("Loading...");
  const [validated, setValidated] = useState(false);
  const [activeKey, setActiveKey] = useState("summary");
  const [editorResetKey, setEditorResetKey] = useState(0); // Key to force ReactQuillEditor remount
  const [isLoading, setIsLoading] = useState(true);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [workersLoaded, setWorkersLoaded] = useState(false);
  const [jobStatusesLoaded, setJobStatusesLoaded] = useState(false);
  const [jobContactTypesLoaded, setJobContactTypesLoaded] = useState(false);
  const [schedulingWindowsLoaded, setSchedulingWindowsLoaded] = useState(false);
  const [jobCategoriesLoaded, setJobCategoriesLoaded] = useState(false);
  const [initialBootstrapDone, setInitialBootstrapDone] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRY_ATTEMPTS = 3;
  const isFetchingCustomersRef = useRef(false);
  const retryCountRef = useRef(0);
  const fetchCustomersRef = useRef(null);

  const [currentUser, setCurrentUser] = useState({
    workerId: "",
    fullName: "",
    uid: "",
  });
  const { user: bootstrapUser } = useCurrentUser();

  useEffect(() => {
    if (!bootstrapUser) return;
    const workerId = bootstrapUser.workerId || bootstrapUser.id;
    if (!workerId) return;
    setCurrentUser({
      workerId,
      fullName: bootstrapUser.fullName || bootstrapUser.name || "anonymous",
      uid: bootstrapUser.uid || bootstrapUser.id || "",
    });
  }, [bootstrapUser]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Initial form state for resetting the form
  const initialFormState = {
    jobID: "",
    jobNo: "",
    jobName: "",
    jobCategoryId: "",
    jobDescription: "",
    priority: "Normal",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    estimatedDurationHours: "",
    estimatedDurationMinutes: "",
    scheduleSession: "custom",
    customerID: "",
    customerName: "",
    contact: {
      contactID: "",
      firstName: "",
      middleName: "",
      lastName: "",
      phoneNumber: "",
      mobilePhone: "",
      email: "",
    },
    location: {
      locationName: "",
      address: {
        streetNo: "",
        streetAddress: "",
        block: "",
        buildingNo: "",
        country: "",
        stateProvince: "",
        city: "",
        postalCode: "",
      },
    },
    equipments: [],
    adminWorkerNotify: false,
    customerNotify: false,
  };

  const [repeatSettings, setRepeatSettings] = useState(() => ({
    ...getDefaultRecurrenceRule(""),
    isRepeat: false,
  }));
  const [repeatConfigured, setRepeatConfigured] = useState(false);
  const [showRecurrenceModal, setShowRecurrenceModal] = useState(false);
  const openRepeatHandledRef = useRef(false);
  const workerQueryPrefillHandledRef = useRef(false);
  const urlCustomerPrefillHandledRef = useRef(false);
  const urlCustomerPrefillInFlightRef = useRef(false);

  // Apply schedule fields from router query params
  useEffect(() => {
    if (!router.isReady) return;

    setFormData((prev) => ({
      ...prev,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
      ...(scheduleSession && { scheduleSession }),
    }));
  }, [router.isReady, startDate, endDate, startTime, endTime, scheduleSession]);

  // One-time worker prefill from scheduler URL (do not reset on every workers refetch)
  useEffect(() => {
    if (!router.isReady || workerQueryPrefillHandledRef.current) return;
    if (!workerId || workers.length === 0) return;

    let selectedWorker = workers.find(
      (worker) => String(worker.value) === String(workerId)
    );

    if (!selectedWorker) {
      selectedWorker = workers.find(
        (worker) => worker.technicianId && String(worker.technicianId) === String(workerId)
      );
    }

    if (selectedWorker) {
      setSelectedWorkers([selectedWorker]);
      workerQueryPrefillHandledRef.current = true;
    }
  }, [router.isReady, workerId, workers]);

  useEffect(() => {
    if (!router.isReady || openRepeat !== "1" || openRepeatHandledRef.current) {
      return;
    }
    openRepeatHandledRef.current = true;
    const anchor = formData.startDate || startDate || "";
    setRepeatSettings({
      ...getDefaultRecurrenceRule(anchor),
      isRepeat: true,
    });
    setRepeatConfigured(false);
    setShowRecurrenceModal(true);
  }, [router.isReady, openRepeat, formData.startDate, startDate]);

  const handleRepeatToggle = (checked) => {
    if (checked) {
      const anchor = formData.startDate || "";
      setRepeatSettings({
        ...getDefaultRecurrenceRule(anchor),
        isRepeat: true,
      });
      setRepeatConfigured(false);
      setShowRecurrenceModal(true);
      return;
    }
    setRepeatConfigured(false);
    setRepeatSettings((prev) => ({ ...prev, isRepeat: false }));
  };

  const handleRecurrenceSave = (rule) => {
    setRepeatSettings(rule);
    setRepeatConfigured(true);
    setFormData((prev) => ({
      ...prev,
      startDate: rule.startDate,
      endDate: rule.startDate || prev.endDate,
    }));
    setShowRecurrenceModal(false);
  };

  const handleRecurrenceModalHide = () => {
    setShowRecurrenceModal(false);
    if (!repeatConfigured) {
      setRepeatSettings((prev) => ({ ...prev, isRepeat: false }));
    }
  };

  const recurrenceSummary = repeatSettings.isRepeat
    ? buildRecurrenceSummary(repeatSettings)
    : "";

  const displayStartDate =
    repeatSettings.isRepeat && repeatSettings.startDate
      ? repeatSettings.startDate
      : formData.startDate;

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
        setJobContactTypes(FALLBACK_JOB_CONTACT_TYPES);
        return;
      }

      const jobContactTypeData = await jobContactTypeResponse.json();

      if (!Array.isArray(jobContactTypeData)) {
        console.error("Job contact types data is not an array:", jobContactTypeData);
        setJobContactTypes(FALLBACK_JOB_CONTACT_TYPES);
        return;
      }

      const formattedJobContactTypes = jobContactTypeData.map((item) => ({
        value: item.code != null ? String(item.code) : item.code, // Ensure string for consistency
        label: item.name,
      }));

      setJobContactTypes(
        formattedJobContactTypes.length > 0
          ? formattedJobContactTypes
          : FALLBACK_JOB_CONTACT_TYPES
      );
    } catch (error) {
      console.error("Error fetching job contact types:", error);
      toast.error(`Failed to fetch job contact types: ${error.message}`);
      setJobContactTypes(FALLBACK_JOB_CONTACT_TYPES);
    } finally {
      setJobContactTypesLoaded(true);
    }
  };

  const fetchJobCategories = async () => {
    try {
      const res = await fetch("/api/getJobCategory", { method: "GET" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText || "Failed to fetch job categories");
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        setJobCategories([]);
        return;
      }
      setJobCategories(
        data.map((item) => ({
          value: item.U_JobCatID != null ? String(item.U_JobCatID) : "",
          label: item.U_JobCat || item.name || "",
        })).filter((c) => c.value && c.label)
      );
    } catch (error) {
      console.error("Error fetching job categories:", error);
      toast.error(`Failed to load job categories: ${error.message}`);
      setJobCategories([]);
    } finally {
      setJobCategoriesLoaded(true);
    }
  };

  const fetchCustomers = async () => {
    // Prevent multiple simultaneous calls
    if (isFetchingCustomersRef.current) {
      return;
    }

    setCustomersLoaded(false);
    const controller = new AbortController();
    let timeoutId = null;

    try {
      isFetchingCustomersRef.current = true;
      setIsLoading(true);
      toast.loading(
        customerSource === "portal"
          ? "Fetching portal customers..."
          : "Loading SAP customers from portal master list...",
        { id: "customersFetch" }
      );

      // Portal generic + SAP master list are Supabase-backed; keep a single generous cap.
      const customersFetchTimeoutMs = 60000;
      timeoutId = setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(
            new DOMException(
              "Loading customers timed out — try again.",
              "AbortError"
            )
          );
        }
      }, customersFetchTimeoutMs);

      let response;
      const url =
        customerSource === "portal" ? "/api/customers/generic" : "/api/customers/sap-masterlist";
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          credentials: "include",
        });
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      } catch (fetchError) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        throw fetchError;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      let formattedOptions;
      if (customerSource === "portal") {
        const list = (data.customers || data) || [];
        formattedOptions = list.map((c) => ({
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
        if (!Array.isArray(data)) throw new Error("Invalid data format: Expected array");
        formattedOptions = data.map((item) => ({
          value: item.cardCode,
          label: `${item.cardCode} - ${item.cardName}`,
          cardCode: item.cardCode,
          cardName: item.cardName,
          customerId: item.customerId,
          email: item.email || "",
          phone_number: item.phone_number || "",
          customer_address: item.customer_address || "",
          sap_card_code: item.sap_card_code || null,
        }));
      }

      setCustomers(formattedOptions);
      setIsLoading(false);
      setRetryCount(0);
      retryCountRef.current = 0;
      isFetchingCustomersRef.current = false;
      toast.dismiss("customersFetch");

      if (formattedOptions.length === 0) {
        toast(
          customerSource === "portal"
            ? "No portal customers found."
            : "No SAP master list customers in the database. Sync or import SAP customers into the portal, or use Portal Customers.",
          { icon: "⚠️", duration: 5000, style: { background: "#fff", color: "#856404", padding: "16px", borderLeft: "6px solid #ffc107", borderRadius: "4px" } }
        );
      } else {
        toast.success(`Successfully loaded ${formattedOptions.length} customers`, {
          duration: 5000,
          style: { background: "#fff", color: "#28a745", padding: "16px", borderLeft: "6px solid #28a745", borderRadius: "4px" },
          iconTheme: { primary: "#28a745", secondary: "#fff" },
        });
      }
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      console.error("Error fetching customers:", error);
      setCustomers([]);
      setIsLoading(false);
      toast.dismiss("customersFetch");

      const currentRetryCount = retryCountRef.current;
      const shouldRetry = currentRetryCount < MAX_RETRY_ATTEMPTS;
      if (!shouldRetry) isFetchingCustomersRef.current = false;

      const isAbortError =
        error.name === "AbortError" ||
        error.message?.includes("aborted") ||
        error.message === "signal is aborted without reason";
      if (isAbortError) {
        const abortMsg =
          error.message && error.message !== "signal is aborted without reason"
            ? error.message
            : "Request timed out. Retrying...";
        toast.error(abortMsg, { duration: 4000, style: { background: "#fff", color: "#dc3545", padding: "16px", borderLeft: "6px solid #dc3545", borderRadius: "4px" } });
      } else {
        toast.error(`Failed to fetch customers: ${error.message}`, {
          duration: 5000,
          style: { background: "#fff", color: "#dc3545", padding: "16px", borderLeft: "6px solid #dc3545", borderRadius: "4px" },
          iconTheme: { primary: "#dc3545", secondary: "#fff" },
        });
      }

      if (shouldRetry) {
        const retryDelay = Math.min(1000 * Math.pow(2, currentRetryCount), 5000);
        toast.error(`Retrying in ${retryDelay / 1000} seconds...`, {
          duration: retryDelay,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
            borderRadius: "4px",
          },
        });

        setTimeout(() => {
          retryCountRef.current = currentRetryCount + 1;
          setRetryCount((prev) => prev + 1);
          // Reset flag before retry
          isFetchingCustomersRef.current = false;
          fetchCustomersRef.current?.();
        }, retryDelay);
      } else {
        toast.error(
          "Maximum retry attempts reached. Please refresh the page.",
          {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
              borderRadius: "4px",
            },
          }
        );

        // Reset retry count after max attempts
        setRetryCount(0);
        retryCountRef.current = 0;
        isFetchingCustomersRef.current = false;
      }
    } finally {
      if (!isFetchingCustomersRef.current) {
        setCustomersLoaded(true);
      }
    }
  };
  fetchCustomersRef.current = fetchCustomers;

  useEffect(() => {
    let isMounted = true;

    const initializeData = async () => {
      if (!isMounted) return;

      // Load independent datasets concurrently so required dropdowns are not blocked
      // by slower customer loading.
      await Promise.allSettled([
        fetchSchedulingWindows(),
        fetchCustomersRef.current?.(),
        fetchJobContactTypes(),
        fetchJobCategories(),
      ]);
    };

    initializeData();

    return () => {
      isMounted = false;
    };
  }, []); // Remove retryCount from dependencies to prevent infinite loop

  const prevCustomerSourceRef = useRef(customerSource);
  useEffect(() => {
    if (prevCustomerSourceRef.current !== customerSource) {
      prevCustomerSourceRef.current = customerSource;
      setSelectedCustomer(null);
      setSelectedContact(null);
      setSelectedLocation(null);
      setSelectedJobContactType(null);
      setFormData((prev) => ({
        ...prev,
        customerID: "",
        customerName: "",
        jobContactType: { code: "", name: "" },
      }));
      fetchCustomersRef.current?.();
    }
  }, [customerSource]);

  // Default Job Contact Type to Service (SAP OCLT code 3) once options load.
  useEffect(() => {
    if (selectedJobContactType || jobContactTypes.length === 0) return;
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
  }, [jobContactTypes, selectedJobContactType]);

  useEffect(() => {
    let mounted = true;
    const loadJobStatuses = async () => {
      try {
        const statuses = await fetchJobStatuses();
        if (mounted && Array.isArray(statuses) && statuses.length > 0) {
          setJobStatuses(statuses);
          // Default new jobs to "Created" (match list value: CREATED or settings/SAP row named Created), not first API row (often "Worker on the Way").
          setFormData((prev) => {
            if (String(prev.jobStatus || "").trim().toUpperCase() !== "CREATED") {
              return prev;
            }
            const created =
              findJobStatusEntry("CREATED", statuses) ||
              statuses.find(
                (s) => String(s.name || "").trim().toLowerCase() === "created"
              );
            if (created?.value != null && String(created.value).trim() !== "") {
              return { ...prev, jobStatus: String(created.value).trim() };
            }
            return prev;
          });
        }
      } finally {
        if (mounted) {
          setJobStatusesLoaded(true);
        }
      }
    };
    loadJobStatuses();
    return () => { mounted = false; };
  }, []);

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
      if (!res.ok) throw new Error(`Assignable workers failed (${res.status})`);
      const payload = await res.json();
      if (seq !== workerSearchSeqRef.current) return;
      setWorkers(mapAssignableWorkersToOptions(payload.workers));
    } catch (error) {
      if (seq !== workerSearchSeqRef.current) return;
      console.error("Error fetching assignable workers:", error);
      toast.error("Failed to search workers. Please try again.", { duration: 5000 });
    } finally {
      if (seq === workerSearchSeqRef.current) {
        setWorkersLoading(false);
        if (search === "") {
          setWorkersLoaded(true);
        }
      }
    }
  }, []);

  const workerSelectOptions = useMemo(
    () => mergeWorkerSelectOptions(workers, selectedWorkers),
    [workers, selectedWorkers]
  );

  const isFormReady =
    customersLoaded &&
    workersLoaded &&
    jobStatusesLoaded &&
    jobContactTypesLoaded &&
    schedulingWindowsLoaded &&
    jobCategoriesLoaded;

  const isFormDisabled =
    !isFormReady ||
    isLoading ||
    isSubmitting ||
    (repeatSettings.isRepeat && !repeatConfigured);

  useEffect(() => {
    if (isFormReady) {
      setInitialBootstrapDone(true);
    }
  }, [isFormReady]);

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

  // Function to format duration to required format
  const formatDuration = (hours, minutes) => {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:00`;
  };

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
      } else if (data.status === "REQUEST_DENIED") {
        // API key issue - log detailed error
        console.error("Google Maps API REQUEST_DENIED:", {
          status: data.status,
          error_message: data.error_message || "No error message provided",
          address: locationName,
          possibleCauses: [
            "API key is invalid or expired",
            "Geocoding API is not enabled for this API key",
            "API key has restrictions that block this request",
            "Billing is not enabled on the Google Cloud project"
          ]
        });
        return null;
      } else {
        // Log other API response statuses for debugging
        console.warn("Google Maps API returned status:", data.status, "for address:", locationName, {
          error_message: data.error_message || "No error message",
          results: data.results?.length || 0
        });
        return null;
      }
    } catch (error) {
      console.error("Error fetching coordinates:", error);
      return null;
    }
  };

  // Handle ReactQuill change event for the job description
  const handleDescriptionChange = (htmlContent) => {
    //// console.log("Updated description (HTML):", htmlContent); // Debugging
    setFormData((prevState) => ({
      ...prevState,
      jobDescription: htmlContent, // Store the HTML content
    }));
  };

  // Function to handle task field change
  const handleTaskChange = (index, field, value) => {
    const updatedTasks = [...tasks];
    updatedTasks[index][field] = value;
    setTasks(updatedTasks);
  };

  // Function to handle checkbox change for priority and completion status
  const handleCheckboxChange = (index, field) => {
    const updatedTasks = [...tasks];
    updatedTasks[index][field] = !updatedTasks[index][field];
    setTasks(updatedTasks);
  };

  // Function to delete a task
  const deleteTask = (index) => {
    const updatedTasks = tasks.filter((_, i) => i !== index);
    setTasks(updatedTasks);
  };

  const handleWorkersChange = (selectedOptions) => {
    const activeSelections = (selectedOptions || []).filter(
      (worker) => String(worker.status || "ACTIVE").toUpperCase() === "ACTIVE"
    );
    setSelectedWorkers(activeSelections);
    setWorkerSearchInput("");
    if (workerSearchDebounceRef.current) clearTimeout(workerSearchDebounceRef.current);
    fetchAssignableWorkers("");
  };

  const handleCustomerChange = async (selectedOption) => {
    //// console.log("handleCustomerChange called with:", selectedOption);

    setSelectedContact(null);
    setSelectedLocation(null);
    setLocations([]);
    setEquipments([]);
    setSelectedCustomer(selectedOption);
    setSelectedServiceCall(null);
    setSelectedSalesOrder(null);

    // Prefer list match; fall back to the option itself (URL prefill / synthesized).
    const selectedCustomer =
      customers.find((option) => option.value === selectedOption?.value) ||
      selectedOption;

    //// console.log("Selected customer:", selectedCustomer);

    setFormData((prevFormData) => ({
      ...prevFormData,
      customerID: selectedCustomer?.cardCode || selectedOption?.cardCode || "",
      customerName: selectedCustomer?.cardName || selectedOption?.cardName || "",
    }));

    // Portal (generic) customers: build contact from stored email/phone and location from customer_address
    if (customerSource === "portal" && selectedCustomer?.customerId) {
      // Build a synthetic "Primary Contact" from the customer's own stored data
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

      // Build location option from customer_address and auto-select it
      const primaryLocation = selectedCustomer.customer_address
        ? {
            value: "primary",
            label: selectedCustomer.customer_address,
            address: selectedCustomer.customer_address,
            siteId: "Primary",
            street: selectedCustomer.customer_address,
            streetNo: "",
            block: "",
            building: "",
            city: "",
            countryName: "",
            zipCode: "",
          }
        : null;
      setLocations(primaryLocation ? [primaryLocation] : []);
      setSelectedLocation(primaryLocation);

      // Auto-populate contact fields and reset equipments for portal customer
      setSelectedContact(selectedCustomer.email || selectedCustomer.phone_number ? primaryContact : null);
      setFormData((prev) => ({
        ...prev,
        equipments: [],
        contact: {
          ...prev.contact,
          contactID: selectedCustomer.email || selectedCustomer.phone_number ? "primary" : "",
          contactFullname: selectedCustomer.cardName || "",
          firstName: selectedCustomer.cardName || "",
          middleName: "",
          lastName: "",
          phoneNumber: selectedCustomer.phone_number || "",
          mobilePhone: "",
          email: selectedCustomer.email || "",
        },
        location: {
          locationName: selectedCustomer.customer_address ? "Primary" : "",
          address: {
            streetNo: "",
            streetAddress: selectedCustomer.customer_address || "",
            block: "",
            buildingNo: "",
            country: "",
            stateProvince: "",
            city: "",
            postalCode: "",
          },
        },
      }));
      return;
    }

    // Load contacts from portal DB via server API (service role — matches customer detail embed; avoids client RLS on contacts).
    try {
      const cardCode = String(selectedOption.value || "").trim();
      const res = await fetch(
        `/api/customers/masterlist-contacts/${encodeURIComponent(cardCode)}`,
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("masterlist-contacts API:", res.status, errText);
        setContacts([]);
        toast.error("Could not load contacts from masterlist.", {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
          },
        });
      } else {
        const json = await res.json().catch(() => ({}));
        if (!json?.success) {
          setContacts([]);
          toast.error(json?.error || "Could not load contacts from masterlist.", {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          });
        } else if (!json.customerId) {
          setContacts([]);
          toast(
            "No portal masterlist customer for this code. Import/link the customer in Supabase to load contacts.",
            {
              icon: "⚠️",
              duration: 6000,
              style: {
                background: "#fff",
                color: "#856404",
                padding: "16px",
                borderLeft: "6px solid #ffc107",
              },
            }
          );
        } else {
          const formattedContacts = mapDbContactsToSelectOptions(json.contacts || []);
          setContacts(formattedContacts);

          if (formattedContacts.length === 0) {
            toast("No contacts found for this customer in the masterlist.", {
              icon: "⚠️",
              duration: 5000,
              style: {
                background: "#fff",
                color: "#856404",
                padding: "16px",
                borderLeft: "6px solid #ffc107",
              },
            });
          } else {
            toast.success(`Loaded ${formattedContacts.length} contact(s) from masterlist.`, {
              duration: 5000,
              style: {
                background: "#fff",
                color: "#28a745",
                padding: "16px",
                borderLeft: "6px solid #28a745",
              },
              iconTheme: {
                primary: "#28a745",
                secondary: "#fff",
              },
            });
          }
        }
      }
    } catch (error) {
      console.error("Error fetching contacts from masterlist:", error);
      setContacts([]);
      toast.error("Failed to fetch contacts from masterlist.", {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    }

    // Fetch locations from SAP Service Layer (sql03), masterlist fallback on server
    try {
      const cardCode = String(selectedOption.value || "").trim();
      const locationsResponse = await fetch("/api/getLocation", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardCode }),
      });

      if (!locationsResponse.ok) {
        const errorText = await locationsResponse.text();
        console.error("Failed to fetch locations:", locationsResponse.status, errorText);
        setLocations([]);
        toast.error("Failed to fetch locations from SAP. Please try again.", {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
          },
        });
      } else {
        const locationItems = await locationsResponse.json();
        const items = Array.isArray(locationItems) ? locationItems : [];

        if (items.length > 0) {
          const groupedLocations = buildGroupedLocationOptions(items);
          setLocations(groupedLocations);
          const flatLocations = flattenLocationOptions(groupedLocations);
          if (flatLocations.length === 1) {
            const onlyLocation = flatLocations[0];
            setSelectedLocation(onlyLocation);
            setFormData((prevFormData) => ({
              ...prevFormData,
              location: {
                ...prevFormData.location,
                ...buildLocationFormPatchFromSelection(onlyLocation),
              },
            }));
          }
          const locationCount = countGroupedLocationOptions(groupedLocations);
          toast.success(`Successfully fetched ${locationCount} locations.`, {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#28a745",
              padding: "16px",
              borderLeft: "6px solid #28a745",
            },
            iconTheme: {
              primary: "#28a745",
              secondary: "#fff",
            },
          });
        } else {
          if (selectedCustomer?.customer_address) {
            const fallbackLocation = {
              value: "primary",
              label: selectedCustomer.customer_address,
              address: selectedCustomer.customer_address,
              siteId: "Primary",
              street: selectedCustomer.customer_address,
              streetNo: "",
              block: "",
              building: "",
              city: "",
              countryName: "",
              zipCode: "",
            };
            setLocations([fallbackLocation]);
            setSelectedLocation(fallbackLocation);
            setFormData((prevFormData) => ({
              ...prevFormData,
              location: {
                ...prevFormData.location,
                ...buildLocationFormPatchFromSelection(fallbackLocation),
              },
            }));
          } else {
            setLocations([]);
          }
          toast(
            selectedCustomer?.customer_address
              ? "No SAP sites found — using customer address from masterlist."
              : "No locations found for this customer.",
            {
              icon: "⚠️",
              duration: 5000,
              style: {
                background: "#fff",
                color: "#856404",
                padding: "16px",
                borderLeft: "6px solid #ffc107",
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("Error fetching locations:", error);
      setLocations([]);
      toast.error("Failed to fetch locations. Please try again.", {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    }

    // Fetch equipments from SAP by CardCode (sql08)
    try {
      const cardCode = String(selectedOption.value || "").trim();
      const equipmentsResponse = await fetch("/api/getEquipments", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardCode }),
      });

      if (!equipmentsResponse.ok) {
        const errorText = await equipmentsResponse.text();
        console.error("Failed to fetch equipments:", equipmentsResponse.status, errorText);
        setEquipments([]);
        toast.error("Failed to fetch equipments from SAP. Please try again.", {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
          },
        });
      } else {
        const equipmentsData = await equipmentsResponse.json();
        const equipmentItems = Array.isArray(equipmentsData) ? equipmentsData : [];

        if (equipmentItems.length > 0) {
          const formattedEquipments = mapSapEquipmentToSelectOptions(equipmentItems);
          setEquipments(formattedEquipments);
          toast.success(`Successfully fetched ${formattedEquipments.length} equipments from SAP.`, {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#28a745",
              padding: "16px",
              borderLeft: "6px solid #28a745",
            },
            iconTheme: {
              primary: "#28a745",
              secondary: "#fff",
            },
          });
        } else {
          setEquipments([]);
          toast("No equipments found for this customer in SAP.", {
            icon: "⚠️",
            duration: 5000,
            style: {
              background: "#fff",
              color: "#856404",
              padding: "16px",
              borderLeft: "6px solid #ffc107",
            },
          });
        }
      }
    } catch (error) {
      console.error("Error fetching equipments:", error);
      setEquipments([]);
      toast.error("Failed to fetch equipments. Please try again.", {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    }

    // Fetch service calls from SAP Service Layer (sql10 + OData fallback; sibling L/C codes)
    try {
      const cardCode = String(
        selectedCustomer?.cardCode || selectedOption?.cardCode || selectedOption?.value || ""
      ).trim();
      const relatedCardCodes = [];
      const relatedSapCode = String(
        selectedCustomer?.sap_card_code || selectedOption?.sap_card_code || ""
      ).trim();
      if (
        relatedSapCode &&
        relatedSapCode.toUpperCase() !== cardCode.toUpperCase()
      ) {
        relatedCardCodes.push(relatedSapCode);
      }
      const serviceCallResponse = await fetch("/api/getServiceCall", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cardCode, relatedCardCodes }),
      });

      if (!serviceCallResponse.ok) {
        let errorPayload = null;
        try {
          errorPayload = await serviceCallResponse.json();
        } catch {
          errorPayload = null;
        }
        console.error(
          "Failed to fetch service calls:",
          serviceCallResponse.status,
          errorPayload
        );
        setServiceCalls([]);
        setSalesOrders([]);

        if (
          serviceCallResponse.status === 401 ||
          errorPayload?.sessionMissing
        ) {
          toast.error(
            "SAP session unavailable — log in to SAP (or renew B1 session) to load service calls.",
            {
              duration: 6000,
              style: {
                background: "#fff",
                color: "#dc3545",
                padding: "16px",
                borderLeft: "6px solid #dc3545",
              },
            }
          );
        } else {
          toast.error("Failed to fetch service calls from SAP. Please try again.", {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          });
        }
      } else {
        const serviceCallsData = await serviceCallResponse.json();
        const sapRows = Array.isArray(serviceCallsData) ? serviceCallsData : [];

        let formattedServiceCalls = sapRows.map((item) => {
          const subject = item.subject || "";
          const suffix =
            item.fetchedForCardCode && item.fetchedForCardCode !== cardCode
              ? ` (${item.fetchedForCardCode})`
              : "";
          return {
            value: item.serviceCallID,
            label: item.serviceCallID + " - " + subject + suffix,
            serviceCallID: item.serviceCallID,
            subject: item.subject,
            customerName: item.customerName,
            createDate: item.createDate,
            createTime: item.createTime,
            description: item.description,
            fetchedForCardCode: item.fetchedForCardCode,
          };
        });

        // Align with Edit Job: when SAP returns nothing, surface open local service_call rows.
        if (formattedServiceCalls.length === 0) {
          try {
            const supabase = getSupabaseClient();
            const customerId =
              selectedCustomer?.customerId || selectedOption?.customerId;
            if (supabase && customerId) {
              const { data: localRows } = await supabase
                .from("service_call")
                .select(
                  "call_number, subject, description, status, customer_name_sap, sap_create_date, sap_create_time"
                )
                .eq("customer_id", customerId)
                .in("status", ["OPEN", "IN_PROGRESS"])
                .is("deleted_at", null)
                .order("call_number", { ascending: false })
                .limit(50);

              if (Array.isArray(localRows) && localRows.length > 0) {
                formattedServiceCalls = localRows
                  .filter((row) => row?.call_number)
                  .map((row) => ({
                    value: row.call_number,
                    label: `${row.call_number} - ${row.subject || "(local)"}`,
                    serviceCallID: row.call_number,
                    subject: row.subject || "",
                    customerName: row.customer_name_sap || "",
                    createDate: row.sap_create_date || "",
                    createTime: row.sap_create_time || "",
                    description: row.description || "",
                    fetchedForCardCode: cardCode,
                    fromLocal: true,
                  }));
              }
            }
          } catch (localScErr) {
            console.warn("Local service_call fallback:", localScErr);
          }
        }

        setServiceCalls(formattedServiceCalls);

        if (formattedServiceCalls.length === 0) {
          const sapLeadCode =
            selectedCustomer?.sap_card_code || selectedOption?.sap_card_code;
          const emptyHint = sapLeadCode
            ? `No open service calls under ${cardCode} (also checked ${sapLeadCode}). Open quotations do not create service calls — create a Service Call in SAP first.`
            : `No open service calls found for ${cardCode}. Open quotations do not create service calls — create a Service Call in SAP first.`;
          toast(emptyHint, {
            icon: "⚠️",
            duration: 5000,
            style: {
              background: "#fff",
              color: "#856404",
              padding: "16px",
              borderLeft: "6px solid #ffc107",
            },
          });
        } else {
          const fromLocal = formattedServiceCalls.some((sc) => sc.fromLocal);
          toast.success(
            fromLocal
              ? `Loaded ${formattedServiceCalls.length} local service call(s) (SAP returned none).`
              : `Successfully fetched ${formattedServiceCalls.length} service calls.`,
            {
              duration: 5000,
              style: {
                background: "#fff",
                color: "#28a745",
                padding: "16px",
                borderLeft: "6px solid #28a745",
              },
              iconTheme: {
                primary: "#28a745",
                secondary: "#fff",
              },
            }
          );
        }

        // Clear sales orders when customer changes
        setSalesOrders([]);
      }
    } catch (error) {
      console.error("Error fetching service calls:", error);
      setServiceCalls([]);
      toast.error("Failed to fetch service calls. Please try again.", {
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
    }
  };

  const handleJobContactTypeChange = (selectedOption) => {
    setSelectedJobContactType(selectedOption);

    setFormData((prevData) => ({
      ...prevData,
      jobContactType: {
        code: selectedOption ? selectedOption.value : "",
        name: selectedOption ? selectedOption.label : "",
      },
    }));
  };

  const handleContactChange = (selectedOption) => {
    if (!selectedOption) return;

    setFormData((prevFormData) => ({
      ...prevFormData,
      contact: formatContactData(selectedOption)
    }));

    setSelectedContact(selectedOption);
  };

  const handleLocationChange = async (selectedOption) => {
    // Find the selected location from the flattened options
    const selectedLocation = selectedOption;

    setSelectedLocation(selectedLocation);

    // Update nested `location` and `address` in `formData`
    setFormData((prevFormData) => {
      const newFormData = {
      ...prevFormData,
      location: {
        ...prevFormData.location,
        locationName: selectedLocation.value || selectedLocation.siteId || selectedLocation.address || "", // FIXED: Location Name = siteId (value is siteId from API)
        addressType: selectedLocation.addressType || "", // Added addressType
        address: {
          ...prevFormData.location.address,
          streetNo: selectedLocation.streetNo || "", // Street No. = streetNo
          streetAddress: selectedLocation.street || "", // Street Address = street (e.g., "16 RAFFLES QUAY")
          block: selectedLocation.block || "", // Block = block
          buildingNo: selectedLocation.building || "", // Building No. = building (e.g., "#11-01 HONG LEONG BUILDING")
          country: selectedLocation.countryName || "", // Country = countryName
          stateProvince: selectedLocation.stateProvince || "", // State/Province = stateProvince
          city: selectedLocation.city || "", // City = city
          postalCode: selectedLocation.zipCode || "", // Zip/Postal Code = zipCode
          addressType:
            selectedLocation.addressType === "B" ? "Billing" : "Shipping", // Added human-readable addressType
        },
        displayAddress: `${
          selectedLocation.building ? `${selectedLocation.building} - ` : ""
        }${selectedLocation.address}`, // Building/Unit name for display
        // Display Sequence: siteId, Street, Building No., Country, ZipCode
        fullAddress: [
          selectedLocation.value || selectedLocation.siteId || selectedLocation.address, // Location Name (siteId)
          selectedLocation.street, // Street Address
          selectedLocation.building, // Building No.
          selectedLocation.countryName, // Country
          selectedLocation.zipCode, // Zip/Postal Code
        ]
          .filter(Boolean)
          .join(", "), // Added full formatted address
      },
    };
    
    return newFormData;
    });

    // Construct full address for geocoding
    // Display Sequence: siteId, Street, Building No., Country, ZipCode
    const fullAddress = [
      selectedLocation.value || selectedLocation.siteId || selectedLocation.address, // Location Name (siteId)
      selectedLocation.street, // Street Address
      selectedLocation.building, // Building No.
      selectedLocation.countryName, // Country
      selectedLocation.zipCode, // Zip/Postal Code
    ]
      .filter(Boolean)
      .join(", ");

    // Only attempt geocoding if we have a valid address
    if (fullAddress.trim().length > 0) {
      try {
        // console.log("Geocoding address:", fullAddress); // For debugging

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
          // Coordinates couldn't be fetched, but this is not a critical error
          // Set coordinates to empty/null
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

          toast(`Could not fetch coordinates for this location. You can still proceed with creating the job.`, {
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
        // Set coordinates to empty/null on error
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

        toast.warning(`Could not fetch coordinates for this location. You can still proceed with creating the job.`, {
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
      // No address to geocode, set coordinates to empty
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
  };

  const handleSelectedServiceCallChange = async (selectedServiceCall) => {
    // // console.log(
    //   "handleSelectedServiceCallChange called with:",
    //   selectedServiceCall
    // );
    setSelectedServiceCall(selectedServiceCall);
    setSelectedSalesOrder(null); // Reset sales order selection

    if (!selectedServiceCall) {
      setSalesOrders([]); // Clear sales orders if no service call selected
      toast.error("Please select a service call", {
        duration: 3000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
      return;
    }

    if (selectedCustomer && selectedServiceCall) {
      try {
        // Show loading toast
        toast.loading("Fetching sales orders...", { id: "salesOrdersFetch" });

        // console.log("Fetching sales orders with:", {
        //  cardCode: selectedCustomer.value,
       //   serviceCallID: selectedServiceCall.value,
      //  });

        const salesOrderResponse = await fetch("/api/getSalesOrder", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cardCode: selectedCustomer.value,
            serviceCallID: selectedServiceCall.value,
          }),
        });

        if (!salesOrderResponse.ok) {
          const errorData = await salesOrderResponse.json();
          console.error("Sales order fetch error:", errorData);
          toast.dismiss("salesOrdersFetch");
          toast.error(
            `Error fetching sales orders: ${
              errorData.error || "Unknown error"
            }`,
            {
              duration: 5000,
              style: {
                background: "#fff",
                color: "#dc3545",
                padding: "16px",
                borderLeft: "6px solid #dc3545",
              },
            }
          );
          setSalesOrders([]);
          return;
        }

        const response = await salesOrderResponse.json();
        // console.log("Fetched sales orders:", response);

        if (!response.value) {
          console.error("Unexpected response format:", response);
          toast.dismiss("salesOrdersFetch");
          toast.error("No sales orders found for this service call", {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          });
          setSalesOrders([]);
          return;
        }

        const formattedSalesOrders = response.value.map((item) => ({
          value: item.DocNum.toString(),
          label: `${item.DocNum} - ${getStatusText(item.DocStatus)}`,
          docTotal: item.DocTotal,
          docStatus: item.DocStatus,
        }));

        setSalesOrders(formattedSalesOrders);
        toast.dismiss("salesOrdersFetch");

        // Show success or warning toast based on the number of sales orders found
        if (formattedSalesOrders.length === 0) {
          toast("No sales orders found for this service call", {
            icon: "⚠️",
            duration: 5000,
            style: {
              background: "#fff",
              color: "#856404",
              padding: "16px",
              borderLeft: "6px solid #ffc107",
              borderRadius: "4px",
            },
          });
        } else {
          toast.success(
            `Found ${formattedSalesOrders.length} sales order${
              formattedSalesOrders.length > 1 ? "s" : ""
            } for Service Call ${selectedServiceCall.value}`,
            {
              duration: 5000,
              style: {
                background: "#fff",
                color: "#28a745",
                padding: "16px",
                borderLeft: "6px solid #28a745",
                borderRadius: "4px",
              },
              iconTheme: {
                primary: "#28a745",
                secondary: "#fff",
              },
            }
          );
        }
      } catch (error) {
        console.error("Error fetching sales orders:", error);
        toast.dismiss("salesOrdersFetch");
        toast.error(`Error: ${error.message}`, {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
            borderRadius: "4px",
          },
        });
        setSalesOrders([]);
      }
    }
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

  const handleSelectedEquipmentsChange = (selectedEquipments) => {
    // Helper function to build location address from equipment data (same as equipment table)
    const buildServiceLocationAddress = (equipment) => {
      const parts = [
        equipment.Building,
        equipment.street,
        equipment.zip,
        equipment.Country
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : (equipment.EquipmentLocation || equipment.equipmentLocation || '');
    };
    
    const formattedEquipments = selectedEquipments.map((equipment) => {
      // Get location - prefer EquipmentLocation, otherwise build from address fields
      const equipmentLocation = equipment.EquipmentLocation || equipment.equipmentLocation || buildServiceLocationAddress(equipment) || "";
      
      return {
        itemCode: equipment.ItemCode || equipment.itemCode || "",
        itemName: equipment.ItemName || equipment.itemName || "",
        itemGroup: equipment.ItemGroup || equipment.itemGroup || "",
        brand: equipment.Brand || equipment.brand || "",
        equipmentLocation: equipmentLocation,
        equipmentType: equipment.EquipmentType || equipment.equipmentType || "",
        modelSeries: equipment.ModelSeries || equipment.modelSeries || "",
        serialNo: equipment.SerialNo || equipment.serialNo || "",
        notes: equipment.Notes || equipment.notes || "",
        warrantyStartDate: equipment.WarrantyStartDate || equipment.warrantyStartDate || null,
        warrantyEndDate: equipment.WarrantyEndDate || equipment.warrantyEndDate || null,
        // Keep original fields for compatibility
        ...equipment
      };
    });

    setFormData((prevFormData) => ({
      ...prevFormData,
      equipments: formattedEquipments,
    }));
    
    toast.success(`Selected ${formattedEquipments.length} equipment(s)`, {
      duration: 3000,
      style: {
        background: "#fff",
        color: "#28a745",
        padding: "16px",
        borderLeft: "6px solid #28a745",
      },
    });
  };

  // Contact / location manual edits (SAP + portal)
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
  };

  const handleLocationFieldChange = (field, value) => {
    if (field === "locationName") {
      setFormData((prev) => ({
        ...prev,
        location: { ...prev.location, locationName: value },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        location: {
          ...prev.location,
          address: { ...prev.location.address, [field]: value },
        },
      }));
    }
  };

  // Portal manual equipment handlers
  const addPortalEquipment = () => {
    setFormData((prev) => ({
      ...prev,
      equipments: [
        ...prev.equipments,
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
  };

  const removePortalEquipment = (index) => {
    setFormData((prev) => ({
      ...prev,
      equipments: prev.equipments.filter((_, i) => i !== index),
    }));
  };

  const handlePortalEquipmentChange = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.equipments];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, equipments: updated };
    });
  };

  const handleNextClick = () => {
    if (activeKey === "summary") {
      if (!selectedCustomer) {
        toast.error("Please select a customer before continuing.", {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
          },
        });
        return;
      }

      const effectiveLocation = resolveEffectiveLocation(
        selectedLocation,
        formData,
        selectedCustomer
      );
      if (!effectiveLocation) {
        toast.error(
          "Please select a site/location or enter a job address before continuing.",
          {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          }
        );
        return;
      }

      setActiveKey("task");
    } else if (activeKey === "task") {
      setActiveKey("scheduling");
    }
  };

  const handleScheduleSessionChange = (e) => {
    const selectedSessionLabel = e.target.value;
    if (selectedSessionLabel === "") {
      setFormData({
        ...formData,
        scheduleSession: "",
      });
      return;
    }

    const selectedWindow = schedulingWindows.find(
      (window) => window.label === selectedSessionLabel
    );

    if (selectedWindow) {
      setFormData({
        ...formData,
        scheduleSession: selectedWindow.label,
        startTime: selectedWindow.timeStart,
        endTime: selectedWindow.timeEnd
      });
    } else if (selectedSessionLabel === "custom") {
      setFormData({
        ...formData,
        scheduleSession: "custom",
        startTime: "",
        endTime: "",
        estimatedDurationHours: "",
        estimatedDurationMinutes: "",
        manualDuration: false
      });
    }
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
      
      const newFormData = {
        ...formData,
        [name]: timeValue,
      };

      setFormData(newFormData);
    } else if (name === "estimatedDurationHours" || name === "estimatedDurationMinutes") {
      // Handle duration fields - convert to number, but keep as string for form state
      // Allow empty string for clearing the field
      const numValue = value === '' ? '' : (Number(value) || 0);
      setFormData({
        ...formData,
        [name]: numValue === '' ? '' : String(numValue),
      });
    } else {
      setFormData({
        ...formData,
        [name]: value,
      });
    }
  };

  // Function to check for overlapping jobs with improved date handling and worker schedule checking
  const checkForOverlappingJobs = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) return [];

      const promises = selectedWorkers.map(async (worker) => {
        // Get technician for this worker
        const user = await userService.findById(worker.value);
        const technician = user?.technicians?.[0] || user?.technicians;
        
        if (!technician?.id) return [];

        // Query jobs assigned to this technician
        const { data: technicianJobs, error } = await supabase
          .from('technician_jobs')
          .select(`
            *,
            job:job_id(*)
          `)
          .eq('technician_id', technician.id)
          .eq('assignment_status', 'ASSIGNED')
          .is('deleted_at', null);

        if (error) {
          console.error('Error checking overlaps:', error);
          return [];
        }

        // Parse dates using a more reliable method
        const newJobStart = new Date(
          `${formData.startDate}T${formData.startTime}`
        );
        const newJobEnd = new Date(`${formData.endDate}T${formData.endTime}`);

        // console.log(
        //   `New Job Schedule - Start: ${newJobStart}, End: ${newJobEnd}`
        // );

        const conflicts = [];

        for (const techJob of (technicianJobs || [])) {
          const jobData = techJob.job;
          if (!jobData) continue;

          // Parse existing job dates from Supabase schema (scheduled_start, scheduled_end)
          const existingJobStart = new Date(jobData.scheduled_start);
          const existingJobEnd = new Date(jobData.scheduled_end);

          // console.log(
        //    `Existing Job (${doc.id}) - Start: ${existingJobStart}, End: ${existingJobEnd}`
          // );

          // Check for overlap with improved date comparison
          const hasOverlap =
            (newJobStart <= existingJobEnd && newJobEnd >= existingJobStart) ||
            (existingJobStart <= newJobEnd && existingJobEnd >= newJobStart);

          if (hasOverlap) {
            conflicts.push({
              workerId: worker.value,
              workerName: worker.label,
              conflictingJobId: jobData.job_number || jobData.id,
              conflictingJobTime: `${formatDateDDMMYYYY(existingJobStart)} ${existingJobStart.toLocaleTimeString()} - ${existingJobEnd.toLocaleTimeString()}`,
              message: `Worker ${
                worker.label
              } has a scheduling conflict with Job #${
                jobData.job_number || jobData.id
              } (${formatDateDDMMYYYY(existingJobStart)} ${existingJobStart.toLocaleTimeString()} - ${existingJobEnd.toLocaleTimeString()})`,
            });
          }
        }

        return conflicts.length > 0 ? conflicts : undefined;
      });

      const results = await Promise.all(promises);
      const allConflicts = results.filter(Boolean).flat();

      // console.log("Schedule conflict check results:", allConflicts);
      return allConflicts;
    } catch (error) {
      console.error("Error checking for schedule conflicts:", error);
      throw new Error(`Failed to check schedule conflicts: ${error.message}`);
    }
  };

  // Generate new job numbers using Supabase (replaces Firestore version)
  // Must be defined before handleSubmitSuccess since it's called there
  const generateNewJobNo = async () => {
    try {
      // Use the existing generateBaseJobNo function which already uses Supabase
      return await generateBaseJobNo();
    } catch (error) {
      console.error("Error generating job number:", error);
      throw new Error("Failed to generate job number");
    }
  };

  // Add this function before handleSubmitClick
  const handleSubmitSuccess = async ({ jobId, jobNumber }) => {
    try {
      // Show success message with Swal
      await Swal.fire({
        icon: "success",
        title: "Job Created Successfully!",
        text: `Job #${jobNumber || jobId} has been created`,
        confirmButtonText: "View Job",
        showCancelButton: true,
        cancelButtonText: "Create Another",
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#6c757d",
      }).then(async (result) => {
        setIsSubmitting(false);
        setProgress(0);
        if (result.isConfirmed) {
          // Redirect to job details page using UUID
          router.push(`/dashboard/jobs/${jobId}`);
        } else {
          // Reset form for creating another job
          const newJobNo = await generateNewJobNo();
          setFormData({
            ...initialFormState,
            jobNo: newJobNo, 
          });
          setSelectedCustomer(null);
          setSelectedContact(null);
          setSelectedLocation(null);
          setSelectedWorkers([]);
          setTasks([]);
          setProgress(0);
          setIsSubmitting(false);
          setRepeatConfigured(false);
          setRepeatSettings({
            ...getDefaultRecurrenceRule(""),
            isRepeat: false,
          });
          setActiveKey("summary");
          setEditorResetKey(prev => prev + 1); // Force ReactQuillEditor to remount and clear description
          const serviceOption = findServiceJobContactTypeOption(jobContactTypes);
          setSelectedJobContactType(serviceOption);
          if (serviceOption) {
            setFormData((prev) => ({
              ...prev,
              jobContactType: {
                code: serviceOption.value,
                name: serviceOption.label,
              },
            }));
          }
        }
      });
    } catch (error) {
      console.error("Error in success handling:", error);
      setIsSubmitting(false);
      setProgress(0);
      toast.error("Error handling success state", {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    }
  };

  // Updated handleSubmitClick function
  const handleSubmitClick = async () => {
    try {
      const effectiveLocation = resolveEffectiveLocation(
        selectedLocation,
        formData,
        selectedCustomer
      );

      // Validation check
      const missingFields = [];
      if (!selectedCustomer) missingFields.push("Customer");
      if (!effectiveLocation) missingFields.push("Location");
      if (!formData.startDate) missingFields.push("Start Date");
      if (!formData.endDate) missingFields.push("End Date");
      if (!formData.startTime) missingFields.push("Start Time");
      if (!formData.endTime) missingFields.push("End Time");
      if (!formData.jobName) missingFields.push("Job Name");
      if (!formData.priority) missingFields.push("Priority");
      if (!selectedJobContactType) missingFields.push("Job Contact Type");

      if (repeatSettings.isRepeat && !repeatConfigured) {
        toast.error(
          "Please save your repeat schedule before submitting. Click Configure schedule.",
          {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          }
        );
        setShowRecurrenceModal(true);
        return;
      }

      if (repeatSettings.isRepeat) {
        const recurrenceValidation = validateRecurrenceRule(repeatSettings);
        if (!recurrenceValidation.valid) {
          toast.error(
            <div>
              <strong>Repeat schedule is invalid:</strong>
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                {recurrenceValidation.errors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </div>,
            {
              duration: 5000,
              style: {
                background: "#fff",
                color: "#dc3545",
                padding: "16px",
                borderLeft: "6px solid #dc3545",
                maxWidth: "500px",
              },
            }
          );
          setShowRecurrenceModal(true);
          return;
        }
      }

      if (missingFields.length > 0) {
        console.warn("[CreateJob] Submit blocked — missing fields:", missingFields);
        toast.error(
          <div>
            <strong>Please fill in all required fields:</strong>
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              {missingFields.map((field, index) => (
                <li key={index}>{field}</li>
              ))}
            </ul>
          </div>,
          {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
              maxWidth: "500px",
            },
          }
        );
        return;
      }

      const jobDates = repeatSettings.isRepeat
        ? generateOccurrenceDates(repeatSettings)
        : formData.startDate
          ? [new Date(formData.startDate + "T00:00:00")]
          : [];

      if (jobDates.length === 0) {
        console.warn("[CreateJob] Submit blocked — no job dates generated", {
          isRepeat: repeatSettings.isRepeat,
          startDate: formData.startDate,
          repeatSettings,
        });
        toast.error(
          repeatSettings.isRepeat
            ? "Could not generate repeat job dates. Open Configure schedule and check your settings."
            : "No job date could be generated. Please set a valid start date.",
          {
            duration: 5000,
            style: {
              background: "#fff",
              color: "#dc3545",
              padding: "16px",
              borderLeft: "6px solid #dc3545",
            },
          }
        );
        if (repeatSettings.isRepeat) {
          setShowRecurrenceModal(true);
        }
        return;
      }

      setProgress(0);
      setIsSubmitting(true);

      // Generate base job number
      const baseJobNo = await generateBaseJobNo();
      const repeatGroupId = repeatSettings.isRepeat ? generateRepeatGroupId() : null;

      // Check for overlaps
      // console.log("Checking for schedule conflicts...");
      setProgress(40);
      const conflicts = await checkForOverlappingJobs();

      if (conflicts.length > 0) {
        // Create a formatted message showing all conflicts
        const conflictMessage = conflicts
          .map((conflict) => `• ${conflict.message}`)
          .join("\n");

        const result = await Swal.fire({
          title: "Schedule Conflicts Detected",
          html: `
            <div class="text-start">
              <p class="mb-3">The following scheduling conflicts were found:</p>
              <div class="alert alert-warning">
                ${conflicts
                  .map((c) => `<p class="mb-2">${c.message}</p>`)
                  .join("")}
              </div>
              <p class="mt-3">Do you want to proceed with creating this job anyway?</p>
            </div>
          `,
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Yes, proceed anyway",
          cancelButtonText: "No, let me adjust the schedule",
          confirmButtonColor: "#28a745",
          cancelButtonColor: "#dc3545",
          customClass: {
            htmlContainer: "text-start",
          },
        });

        if (!result.isConfirmed) {
          setIsSubmitting(false);
          return;
        }
      }

      // Format dates and prepare base form data
      // console.log("Formatting dates and preparing form data...");
      setProgress(60);

      // Track the first job ID for redirect
      let firstJobId = null;
      // Track actual base job number (may change if duplicate detected)
      let actualBaseJobNo = baseJobNo;

      // Create jobs for each date
      for (let i = 0; i < jobDates.length; i++) {
        const currentDate = jobDates[i];
        let currentJobNo = repeatSettings.isRepeat && i > 0 
          ? generateRepeatJobNo(actualBaseJobNo, i + 1)
          : actualBaseJobNo;

        // Validate and format start/end datetimes using local calendar dates (not toISOString day parts).
        // Previous code used new Date(formData.endDate).getHours() on a date-only string and
        // endDate.toISOString().split('T')[0], which shifts the calendar day in non-UTC zones and
        // left jobs.scheduled_end / job_schedule out of sync with the form (scheduler modal vs job page).
        if (!formData.startTime || !formData.startTime.trim()) {
          throw new Error('Start Time is required');
        }
        const startYmd = toLocalYmd(currentDate);
        if (!startYmd) {
          throw new Error('Invalid service date for this job row');
        }
        const startFormYmd = formData.startDate
          ? String(formData.startDate).split('T')[0]
          : startYmd;
        const endFormYmd = formData.endDate
          ? String(formData.endDate).split('T')[0]
          : startYmd;
        const endYmd =
          endFormYmd && startFormYmd && endFormYmd !== startFormYmd
            ? endFormYmd
            : startYmd;

        const formattedStartDateTime = buildSingaporeDateTimeFromForm(startYmd, formData.startTime);
        if (!formattedStartDateTime) {
          throw new Error(`Invalid Start Time format: ${formData.startTime}. Please use HH:MM format (e.g., 14:30 for 2:30 PM)`);
        }

        if (!formData.endTime || !formData.endTime.trim()) {
          throw new Error('End Time is required');
        }
        const formattedEndDateTime = buildSingaporeDateTimeFromForm(endYmd, formData.endTime);
        if (!formattedEndDateTime) {
          throw new Error(`Invalid End Time format: ${formData.endTime}. Please use HH:MM format (e.g., 16:00 for 4:00 PM)`);
        }

        // Prepare the form data
        const updatedFormData = {
          // Basic Job Info
          jobID: currentJobNo,
          jobNo: currentJobNo,
          jobName: repeatSettings.isRepeat 
            ? `${formData.jobName} (${i + 1}/${jobDates.length})`
            : formData.jobName,
          jobDescription: formData.jobDescription || "",
          jobStatus: formData.jobStatus || "CREATED",
          priority: formData.priority || "",

          // Repeat Job Information
          repeatJob: repeatSettings.isRepeat ? {
            isRepeat: true,
            repeatGroupId: repeatGroupId,
            baseJobNo: baseJobNo,
            sequence: i + 1,
            totalOccurrences: jobDates.length,
            settings: repeatSettings
          } : null,

          // Customer Info
          customerID: selectedCustomer?.cardCode || "",
          customerName: selectedCustomer?.cardName || "",

          // Dates and Times
          startDate: formattedStartDateTime ? formattedStartDateTime.toISOString() : null,
          endDate: formattedEndDateTime ? formattedEndDateTime.toISOString() : null,
          startTime: formData.startTime || "",
          endTime: formData.endTime || "",
          estimatedDurationHours: formData.estimatedDurationHours || "",
          estimatedDurationMinutes: formData.estimatedDurationMinutes || "",

          // Location
          location: {
            locationName: effectiveLocation?.value || effectiveLocation?.siteId || effectiveLocation?.address || "", // FIXED: Location Name = siteId
            siteId: effectiveLocation?.value || effectiveLocation?.siteId || "",
            addressType: effectiveLocation?.addressType || "",
            address: {
              streetNo: effectiveLocation?.streetNo || "", // Street No. = streetNo
              streetAddress: effectiveLocation?.street || "", // Street Address = street (e.g., "16 RAFFLES QUAY")
              block: effectiveLocation?.block || "", // Block = block
              buildingNo: effectiveLocation?.building || "", // Building No. = building (e.g., "#11-01 HONG LEONG BUILDING")
              city: effectiveLocation?.city || "", // City = city
              stateProvince: effectiveLocation?.stateProvince || "", // State/Province = stateProvince
              postalCode: effectiveLocation?.zipCode || "", // Zip/Postal Code = zipCode
              country: effectiveLocation?.countryName || "", // Country = countryName
            },
            coordinates: formData.location?.coordinates || {
              latitude: "",
              longitude: "",
            },
            displayAddress: `${
              effectiveLocation?.building ? `${effectiveLocation.building} - ` : ""
            }${effectiveLocation?.address}`, // Building/Unit name for display
            // Display Sequence: siteId, Street, Building No., Country, ZipCode
            fullAddress: [
              effectiveLocation?.value || effectiveLocation?.siteId || effectiveLocation?.address, // Location Name (siteId)
              effectiveLocation?.street, // Street Address
              effectiveLocation?.building, // Building No.
              effectiveLocation?.countryName, // Country
              effectiveLocation?.zipCode, // Zip/Postal Code
            ]
              .filter(Boolean)
              .join(", "),
          },
          equipments: formData.equipments.map((equipment) => ({
            itemCode: equipment.itemCode || "",
            itemName: equipment.itemName || "",
            itemGroup: equipment.itemGroup || "",
            brand: equipment.brand || "",
            equipmentLocation: equipment.equipmentLocation || "",
            equipmentType: equipment.equipmentType || "",
            modelSeries: equipment.modelSeries || "",
            serialNo: equipment.serialNo || "",
            notes: equipment.notes || "",
            warrantyStartDate: equipment.warrantyStartDate || null,
            warrantyEndDate: equipment.warrantyEndDate || null,
          })),

          // Contact
          contact: formatContactData(selectedContact),

          // Workers
          assignedWorkers: selectedWorkers.map((worker) => ({
            workerId: worker.value || "",
            workerName: worker.label || "",
          })),

          // Tasks - will be created in job_tasks table separately
          // Metadata - stored in job record if needed
          // Timestamps - handled by Supabase automatically
        };

        // Get Supabase client
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error('Supabase client not available');
        }

        try {
          // 1. Get customer UUID: from portal (customerId) or SAP (server resolve by cardCode)
          let customerId;
          if (selectedCustomer.customerId) {
            customerId = selectedCustomer.customerId;
          } else {
            const resolveResponse = await fetch("/api/jobs/resolve-customer", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                cardCode: selectedCustomer.cardCode,
                cardName:
                  selectedCustomer.cardName ||
                  selectedCustomer.label ||
                  "Unknown Customer",
              }),
            });
            const resolveJson = await resolveResponse.json().catch(() => ({}));
            if (!resolveResponse.ok || !resolveJson?.customerId) {
              throw new Error(
                resolveJson?.error ||
                  "Could not resolve customer in masterlist. Sync the customer from SAP and try again."
              );
            }
            customerId = resolveJson.customerId;
          }

          // 2. Get or create location UUID
          let locationId = null;
          /** customer_location.id for linking customer_address_details.customer_location_id */
          let resolvedCustomerLocationId = null;
          if (!effectiveLocation && selectedCustomer.customer_address && selectedCustomer.customerId) {
            // Portal customer with address but no location selected: create default location
            const { data: newLoc, error: locErr } = await supabase
              .from('locations')
              .insert({
                customer_id: customerId,
                location_name: selectedCustomer.customer_address || 'Primary'
              })
              .select('id')
              .single();
            if (!locErr && newLoc) locationId = newLoc.id;
          }
          if (effectiveLocation) {
            // effectiveLocation.value is a siteId from SAP, not a UUID
            // Try to find existing location by customer_id and location_name
            // FIXED: Location Name = siteId (value is siteId from API)
            const locationName = effectiveLocation.value || effectiveLocation.siteId || effectiveLocation.address || effectiveLocation.building || '';
            const { data: existingLocation } = await supabase
              .from('locations')
              .select('id')
              .eq('customer_id', customerId)
              .eq('location_name', locationName)
              .is('deleted_at', null)
              .limit(1)
              .maybeSingle();
            
            if (existingLocation) {
              locationId = existingLocation.id;
              
              // Update coordinates and address fields if we have them (even if location exists)
              let lat = formData.location?.coordinates?.latitude;
              let lng = formData.location?.coordinates?.longitude;
              
              // If not in formData, try effectiveLocation
              if ((lat === null || lat === undefined || lat === '') && effectiveLocation?.coordinates?.latitude) {
                lat = effectiveLocation.coordinates.latitude;
              }
              if ((lng === null || lng === undefined || lng === '') && effectiveLocation?.coordinates?.longitude) {
                lng = effectiveLocation.coordinates.longitude;
              }
              
              // Prepare update data
              const latStr = (lat !== null && lat !== undefined && lat !== '') ? String(lat) : null;
              const lngStr = (lng !== null && lng !== undefined && lng !== '') ? String(lng) : null;
              
              const updateData = {
                site_id: effectiveLocation.value || effectiveLocation.siteId || null,
                building: effectiveLocation.building || null,
                street_number: effectiveLocation.streetNo || null,
                street: effectiveLocation.street || null,
                block: effectiveLocation.block || null,
                address: effectiveLocation.address || null,
                city: effectiveLocation.city || null,
                country_name: effectiveLocation.countryName || null,
                zip_code: effectiveLocation.zipCode || null,
                address_type: effectiveLocation.addressType || null
              };
              
              // Add coordinates if available
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
                // Don't throw - location exists, update is optional
              }
              
              if (effectiveLocation.value || effectiveLocation.siteId) {
                try {
                  const { customerLocationId } = await upsertJobCustomerLocation(supabase, {
                    customerId,
                    locationId,
                    selectedLocation: effectiveLocation,
                  });
                  if (customerLocationId) resolvedCustomerLocationId = customerLocationId;
                } catch (custLocErr) {
                  console.error('Error upserting customer_location:', custLocErr);
                }
              }
            } else {
              // Create new location with all address details
              // Get coordinates from formData or effectiveLocation
              // Handle both null and empty string cases
              let lat = formData.location?.coordinates?.latitude;
              let lng = formData.location?.coordinates?.longitude;
              
              // If not in formData, try effectiveLocation
              if ((lat === null || lat === undefined || lat === '') && effectiveLocation?.coordinates?.latitude) {
                lat = effectiveLocation.coordinates.latitude;
              }
              if ((lng === null || lng === undefined || lng === '') && effectiveLocation?.coordinates?.longitude) {
                lng = effectiveLocation.coordinates.longitude;
              }
              
              // Convert to string if it's a number, otherwise keep as null
              // Handle empty strings by converting to null
              const latStr = (lat !== null && lat !== undefined && lat !== '') ? String(lat) : null;
              const lngStr = (lng !== null && lng !== undefined && lng !== '') ? String(lng) : null;
              
              const { data: newLocation, error: locError } = await supabase
                .from('locations')
                .insert({
                  customer_id: customerId,
                  location_name: locationName,
                  site_id: effectiveLocation.value || effectiveLocation.siteId || null,
                  building: effectiveLocation.building || null,
                  street_number: effectiveLocation.streetNo || null,
                  street: effectiveLocation.street || null,
                  block: effectiveLocation.block || null,
                  address: effectiveLocation.address || null,
                  city: effectiveLocation.city || null,
                  country_name: effectiveLocation.countryName || null,
                  zip_code: effectiveLocation.zipCode || null,
                  address_type: effectiveLocation.addressType || null,
                  current_latitude: latStr,
                  current_longitude: lngStr,
                  destination_latitude: latStr,
                  destination_longitude: lngStr
                })
                .select()
                .single();
              
              if (locError) {
                console.error('Error creating location:', locError);
                throw locError;
              }
              locationId = newLocation.id;
              
              if (effectiveLocation.value || effectiveLocation.siteId) {
                try {
                  const { customerLocationId } = await upsertJobCustomerLocation(supabase, {
                    customerId,
                    locationId,
                    selectedLocation: effectiveLocation,
                  });
                  if (customerLocationId) resolvedCustomerLocationId = customerLocationId;
                } catch (custLocErr) {
                  console.error('Error upserting customer_location:', custLocErr);
                }
              }
            }
          }

          if (
            resolvedCustomerLocationId &&
            selectedCustomer?.cardCode &&
            effectiveLocation &&
            (effectiveLocation.value || effectiveLocation.siteId)
          ) {
            try {
              await fetch('/api/customers/address-details', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  customerCode: selectedCustomer.cardCode,
                  addressName: effectiveLocation.value || effectiveLocation.siteId,
                  addressType: effectiveLocation.addressType,
                  customerLocationId: resolvedCustomerLocationId,
                }),
              });
            } catch (linkErr) {
              console.warn('Link customer_address_details.customer_location_id:', linkErr);
            }
          }

          // 3. Get or create service call UUID if provided
          let serviceCallId = null;
          if (selectedServiceCall?.value) {
            // First, try to find existing service call by call_number
            const { data: serviceCall } = await supabase
              .from('service_call')
              .select('id')
              .eq('call_number', selectedServiceCall.value.toString())
              .is('deleted_at', null)
              .maybeSingle();
            
            if (serviceCall) {
              serviceCallId = serviceCall.id;
            } else {
              // Service call doesn't exist, create it
              // Get service call data from selectedServiceCall (preserved from API)
              const serviceCallData = {
                customer_id: customerId,
                call_number: selectedServiceCall.value.toString(),
                subject: selectedServiceCall.subject || `Service Call ${selectedServiceCall.value}`,
                description: selectedServiceCall.description || null,
                status: 'OPEN', // Default status
                priority: 'MEDIUM' // Default priority
              };
              
              const { data: newServiceCall, error: serviceCallError } = await supabase
                .from('service_call')
                .insert(serviceCallData)
                .select()
                .single();
              
              if (serviceCallError) {
                console.error('Error creating service call:', serviceCallError);
                toast.error(`Failed to create service call: ${serviceCallError.message}`, {
                  duration: 3000,
                  style: {
                    background: "#fff",
                    color: "#dc3545",
                    padding: "16px",
                    borderLeft: "6px solid #dc3545",
                  },
                });
                // Continue without service call link
              } else {
                serviceCallId = newServiceCall.id;
              }
            }
          }

          // 3.25. Get or create sales order UUID if provided
          let salesOrderId = null;
          if (selectedSalesOrder?.value) {
            // First, try to find existing sales order by document_number
            const { data: existingSalesOrder } = await supabase
              .from('sales_order')
              .select('id')
              .eq('document_number', selectedSalesOrder.value.toString())
              .is('deleted_at', null)
              .maybeSingle();
            
            if (existingSalesOrder) {
              salesOrderId = existingSalesOrder.id;
            } else {
              // Create new sales order record if it doesn't exist
              const { data: newSalesOrder, error: salesOrderError } = await supabase
                .from('sales_order')
                .insert({
                  document_number: selectedSalesOrder.value.toString(),
                  document_status: selectedSalesOrder.docStatus || null,
                  document_total: selectedSalesOrder.docTotal || null
                })
                .select()
                .single();
              
              if (salesOrderError) {
                console.error('Error creating sales order:', salesOrderError);
                // Continue without sales order link
              } else {
                salesOrderId = newSalesOrder.id;
              }
            }
          }

          // 3.5. Save or update contact in contacts table
          const contactId = await resolveContactIdFromSelection(supabase, {
            customerId,
            selectedContact,
          });

          // 4. Create job record in jobs table
          const jobTitle = repeatSettings.isRepeat 
            ? `${formData.jobName} (${i + 1}/${jobDates.length})`
            : formData.jobName;

          let jobDescription = normalizeRichTextHtml(formData.jobDescription || '');
          
          // Get current user ID for created_by
          let createdById = null;
          if (currentUser?.uid && currentUser.uid !== 'unknown' && currentUser.uid !== '') {
            createdById = currentUser.uid;
          } else {
            // Try to get user ID from Supabase auth session as fallback
            try {
              const supabase = getSupabaseClient();
              if (supabase) {
                const { data: { user: authUser } } = await supabase.auth.getUser();
                if (authUser?.id) {
                  createdById = authUser.id;
                }
              }
            } catch (authError) {
              console.warn('Could not get user from Supabase auth:', authError);
            }
          }

          // Prepare job data
          // Convert datetime strings to ISO format for Supabase if they're valid
          const scheduledStart = formattedStartDateTime ? formattedStartDateTime.toISOString() : null;
          const scheduledEnd = formattedEndDateTime ? formattedEndDateTime.toISOString() : null;
          
          const jobData = {
            customer_id: customerId,
            location_id: locationId,
            service_call_id: serviceCallId,
            contact_id: contactId || null,
            job_number: currentJobNo,
            title: jobTitle,
            description: jobDescription,
            priority: mapPriorityToDatabase(formData.priority),
            status: resolveJobStatusForDb(formData.jobStatus, jobStatuses),
            scheduled_start: scheduledStart,
            scheduled_end: scheduledEnd,
            created_by: createdById
          };

          // Create job with retry logic for duplicate key errors
          let job = null;
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount < maxRetries) {
            try {
              job = await jobService.create(jobData);
              void clientAuditLog({
                action: 'JOB_CREATE',
                category: 'job',
                entityType: 'job',
                entityId: job.id,
                entityLabel: job.job_number,
                description: `Job ${job.job_number} created`,
                details: {
                  job_id: job.id,
                  job_number: job.job_number,
                  customer_id: customerId,
                  contact_id: contactId || null,
                },
              });

              const jobCatId = String(formData.jobCategoryId || '').trim();
              if (jobCatId) {
                try {
                  const supabaseClient = supabase || getSupabaseClient();
                  if (supabaseClient) {
                    const { data: existing } = await supabaseClient
                      .from('job_category')
                      .select('id')
                      .eq('job_id', job.id)
                      .maybeSingle();

                    if (existing?.id) {
                      await supabaseClient
                        .from('job_category')
                        .update({ description: jobCatId })
                        .eq('id', existing.id);
                    } else {
                      await supabaseClient.from('job_category').insert({
                        job_id: job.id,
                        description: jobCatId,
                      });
                    }
                  }
                } catch (jobCatErr) {
                  console.warn('Failed to persist job_category:', jobCatErr?.message || jobCatErr);
                }
              }
              break; // Success, exit retry loop
            } catch (createError) {
              if (isDuplicateJobNumberError(createError) && retryCount < maxRetries - 1) {
                retryCount++;
                console.warn(`Duplicate job number detected (${jobData.job_number}), regenerating... (attempt ${retryCount}/${maxRetries})`);

                const supabase = getSupabaseClient();
                if (!supabase) {
                  throw new Error('Supabase client not available for retry');
                }

                const parts = jobData.job_number.split('-');
                const isRepeatJob = parts.length > 2;
                const newBase = await getNextJobNumber(supabase);
                jobData.job_number = isRepeatJob
                  ? `${newBase}-${parts[2]}`
                  : newBase;

                await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
                continue;
              }
              throw createError;
            }
          }
          
          if (!job) {
            throw new Error(`Failed to create job after ${maxRetries} retry attempts`);
          }
          
          // Update base job number if it changed during retry (for first job in repeat series)
          if (i === 0 && job.job_number !== currentJobNo) {
            // Extract base number from job number (remove sequence suffix if it's a repeat job)
            const parts = job.job_number.split('-');
            if (parts.length >= 2) {
              // For format YYYY-XXXXXX or YYYY-XXXXXX-XXX, extract YYYY-XXXXXX
              actualBaseJobNo = `${parts[0]}-${parts[1]}`;
            } else {
              actualBaseJobNo = job.job_number;
            }
            currentJobNo = job.job_number; // Update for logging/display
          }

          // Store the first job ID for redirect
          if (i === 0) {
            firstJobId = job.id;
          }

          // Phase 2: Sync job to SAP Activities (non-blocking)
          fetch('/api/jobs/sync-to-sap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId: job.id }),
            credentials: 'include'
          }).then(r => {
            if (!r.ok) console.warn('SAP job sync failed for job', job.id);
          }).catch(e => console.warn('SAP job sync error', e));

          // 4.5. Create job-sales_order relationship
          // Since jobs table doesn't have sales_order_id column, we'll try to create a relationship
          // First, try to add sales_order_id directly to jobs table (if column exists)
          if (salesOrderId) {
            try {
              // Try to update the job with sales_order_id (if the column exists in schema)
              const { error: updateJobError } = await supabase
                .from('jobs')
                .update({ sales_order_id: salesOrderId })
                .eq('id', job.id);
              
              if (updateJobError) {
                // Column doesn't exist, try relationship table instead
                const errorMsg = updateJobError.message?.toLowerCase() || '';
                const isColumnNotFound = errorMsg.includes('column') && 
                                        (errorMsg.includes('does not exist') || errorMsg.includes('unknown'));
                
                if (isColumnNotFound) {
                  // Try relationship table approach
                  const { error: jobSalesOrderError } = await supabase
                    .from('job_sales_orders')
                    .insert({
                      job_id: job.id,
                      sales_order_id: salesOrderId
                    });
                  
                  if (jobSalesOrderError) {
                    // Table doesn't exist either - log warning but don't fail
                    const tableErrorMsg = jobSalesOrderError.message?.toLowerCase() || '';
                    const isTableNotFound = tableErrorMsg.includes('does not exist') || 
                                           tableErrorMsg.includes('relation') || 
                                           tableErrorMsg.includes('table') ||
                                           tableErrorMsg.includes('schema cache');
                    
                    if (!isTableNotFound) {
                      console.warn('Could not create job-sales_order relationship:', jobSalesOrderError);
                      toast.warning('Sales order linked but relationship table not available. Consider adding sales_order_id column to jobs table.', {
                        duration: 4000,
                        style: {
                          background: "#fff",
                          color: "#856404",
                          padding: "16px",
                          borderLeft: "6px solid #ffc107",
                        },
                      });
                    } else {
                      console.warn('job_sales_orders table does not exist. Sales order relationship not saved. Consider adding sales_order_id column to jobs table.');
                      toast.warning('Sales order saved but not linked to job. Database schema needs sales_order_id column in jobs table or job_sales_orders relationship table.', {
                        duration: 5000,
                        style: {
                          background: "#fff",
                          color: "#856404",
                          padding: "16px",
                          borderLeft: "6px solid #ffc107",
                        },
                      });
                    }
                  }
                } else {
                  // Other error updating job
                  console.error('Error updating job with sales_order_id:', updateJobError);
                  toast.warning(`Sales order saved but link to job failed: ${updateJobError.message}`, {
                    duration: 3000,
                    style: {
                      background: "#fff",
                      color: "#856404",
                      padding: "16px",
                      borderLeft: "6px solid #ffc107",
                    },
                  });
                }
              }
            } catch (err) {
              console.error('Error creating job-sales_order relationship:', err);
              toast.warning('Sales order saved but relationship to job could not be created.', {
                duration: 3000,
                style: {
                  background: "#fff",
                  color: "#856404",
                  padding: "16px",
                  borderLeft: "6px solid #ffc107",
                },
              });
            }
          }

          // 5. Create tasks in job_tasks table
          if (tasks && tasks.length > 0) {
            const taskInserts = tasks.map((task, index) => ({
              job_id: job.id,
              task_name: normalizeJobTaskNameForInsert(task.taskName),
              task_description: task.taskDescription || '',
              task_order: index + 1,
              is_required: Boolean(task.isPriority)
            }));

            const { error: tasksError } = await supabase
              .from('job_tasks')
              .insert(taskInserts);

            if (tasksError) {
              console.error('Error creating tasks:', tasksError);
              // Continue even if tasks fail
            }
          }

          // 6. Create technician assignments in technician_jobs table
          let assignedUserIdsForNotify = [];
          let assignedTechnicianIdsForEmail = [];
          let technicianJobsInsertSucceeded = false;
          if (selectedWorkers && selectedWorkers.length > 0) {
            const technicianJobInserts = [];

            for (const worker of selectedWorkers) {
              // Get user and technician record
              const user = await userService.findById(worker.value);
              const technician = user?.technicians?.[0] || user?.technicians;

              if (technician?.id) {
                technicianJobInserts.push({
                  technician_id: technician.id,
                  job_id: job.id,
                  assignment_status: 'ASSIGNED'
                });
                assignedUserIdsForNotify.push(worker.value);
                assignedTechnicianIdsForEmail.push(technician.id);
              }
            }

            if (technicianJobInserts.length > 0) {
              const { error: techJobsError } = await supabase
                .from('technician_jobs')
                .insert(technicianJobInserts);

              if (techJobsError) {
                console.error('Error creating technician assignments:', techJobsError);
                // Continue even if assignments fail
              } else {
                technicianJobsInsertSucceeded = true;
                try {
                  const rh = await refreshTechnicianHoursForJobId(supabase, job.id);
                  if (rh?.error) console.error('refreshTechnicianHoursForJobId:', rh.error);
                } catch (e) {
                  console.error('refreshTechnicianHoursForJobId:', e);
                }
              }
            }
          }

          // Notify assigned technicians + all active ADMIN users (server-side insert)
          await emitJobStakeholderNotifications({
            jobId: job.id,
            jobNumber: job.job_number,
            jobTitle: job.title,
            assigneeUserIds: assignedUserIdsForNotify,
            kind: 'new',
            createdByUserId: createdById || null,
          });

          if (technicianJobsInsertSucceeded && assignedTechnicianIdsForEmail.length > 0) {
            void emitJobAssignmentEmails({
              jobId: job.id,
              technicianIds: assignedTechnicianIdsForEmail,
            });
          }

          // 7. Create job contact type in job_contact_type table
          if (selectedJobContactType) {
            // Convert code to integer if it's a string (schema expects INTEGER)
            const contactTypeCode = selectedJobContactType.code || selectedJobContactType.value;
            const codeAsInt = contactTypeCode ? parseInt(contactTypeCode, 10) : null;
            
            // Use name from selectedJobContactType or label
            const contactTypeName = selectedJobContactType.name || selectedJobContactType.label || '';
            
            const { error: contactTypeError } = await supabase
              .from('job_contact_type')
              .insert({
                job_id: job.id,
                code: isNaN(codeAsInt) ? null : codeAsInt,
                name: contactTypeName
              });

            if (contactTypeError) {
              console.error('Error creating job contact type:', contactTypeError);
              toast.error(`Failed to save job contact type: ${contactTypeError.message}`, {
                duration: 3000,
                style: {
                  background: "#fff",
                  color: "#dc3545",
                  padding: "16px",
                  borderLeft: "6px solid #dc3545",
                },
              });
              // Continue even if contact type fails
            }
          }

          // 8. Create equipment records in job_equipments table
          if (formData.equipments && formData.equipments.length > 0) {
            const equipmentInserts = [];
            
            for (const equipment of formData.equipments) {
              if (equipment.itemCode) {
                // Try to find existing equipment by item_code + serial_number + customer_id
                // This allows multiple entries with same item_code but different serial_numbers
                const { data: existingEquipment, error: findError } = await supabase
                  .from('equipments')
                  .select('id')
                  .eq('item_code', equipment.itemCode)
                  .eq('customer_id', customerId)
                  .eq('serial_number', equipment.serialNo || equipment.SerialNo || '')
                  .is('deleted_at', null)
                  .maybeSingle();

                let equipmentId = null;

                if (existingEquipment) {
                  // Equipment exists, use it
                  equipmentId = existingEquipment.id;
                } else {
                  // Equipment doesn't exist, create it
                  // Convert warranty dates if they exist
                  let warrantyStartDate = null;
                  let warrantyEndDate = null;
                  
                  if (equipment.warrantyStartDate) {
                    try {
                      warrantyStartDate = new Date(equipment.warrantyStartDate).toISOString().split('T')[0];
                    } catch (e) {
                      console.warn('Invalid warranty start date:', equipment.warrantyStartDate);
                    }
                  }
                  
                  if (equipment.warrantyEndDate) {
                    try {
                      warrantyEndDate = new Date(equipment.warrantyEndDate).toISOString().split('T')[0];
                    } catch (e) {
                      console.warn('Invalid warranty end date:', equipment.warrantyEndDate);
                    }
                  }

                  const { data: newEquipment, error: createError } = await supabase
                    .from('equipments')
                    .insert({
                      customer_id: customerId,
                      item_code: equipment.itemCode,
                      item_name: equipment.itemName || equipment.ItemName || equipment.itemCode,
                      item_group: equipment.itemGroup || equipment.ItemGroup || null,
                      brand: equipment.brand || equipment.Brand || null,
                      equipment_location: equipment.equipmentLocation || equipment.EquipmentLocation || null,
                      equipment_type: equipment.equipmentType || equipment.EquipmentType || null,
                      model_series: equipment.modelSeries || equipment.ModelSeries || null,
                      serial_number: equipment.serialNo || equipment.SerialNo || null,
                      warranty_start_date: warrantyStartDate,
                      warranty_end_date: warrantyEndDate,
                      notes: equipment.notes || equipment.Notes || null
                    })
                    .select()
                    .single();

                  if (createError) {
                    console.error('Error creating equipment:', createError);
                    // Try to find by item_code + serial_number + customer_id (might exist)
                    const { data: altEquipment } = await supabase
                      .from('equipments')
                      .select('id')
                      .eq('item_code', equipment.itemCode)
                      .eq('customer_id', customerId)
                      .eq('serial_number', equipment.serialNo || equipment.SerialNo || '')
                      .is('deleted_at', null)
                      .maybeSingle();
                    
                    if (altEquipment) {
                      equipmentId = altEquipment.id;
                    } else {
                      console.error(`Failed to create or find equipment: ${equipment.itemCode} with serial ${equipment.serialNo || equipment.SerialNo}`);
                      continue; // Skip this equipment
                    }
                  } else {
                    equipmentId = newEquipment.id;
                  }
                }

                if (equipmentId) {
                  equipmentInserts.push({
                    job_id: job.id,
                    equipment_id: equipmentId,
                    quantity_used: 1,
                    notes: equipment.notes || equipment.Notes || ''
                  });
                }
              } else {
                console.warn('Equipment missing itemCode, skipping:', equipment);
              }
            }

            if (equipmentInserts.length > 0) {
              const { error: equipError } = await supabase
                .from('job_equipments')
                .insert(equipmentInserts);

              if (equipError) {
                console.error('Error creating job equipments:', equipError);
                toast.error(`Failed to save some equipment: ${equipError.message}`, {
                  duration: 5000,
                  style: {
                    background: "#fff",
                    color: "#dc3545",
                    padding: "16px",
                    borderLeft: "6px solid #dc3545",
                  },
                });
                // Continue even if equipment fails
              }
            } else {
              console.warn('No equipment records to insert (all may have failed validation)');
            }
          }

          // 9. Create schedule in job_schedule table
          // Calculate duration in hours and minutes (same as EditJobs.js)
          const durationHours = formData.estimatedDurationHours || 0;
          const durationMinutes = formData.estimatedDurationMinutes || 0;
          const totalMinutes = (parseInt(durationHours) * 60) + parseInt(durationMinutes);
          const durationHoursDecimal = (totalMinutes / 60).toFixed(2);
          
          // Get full address from formData.location or effectiveLocation
          const fullAddress = formData.location?.fullAddress || 
                             formData.location?.displayAddress || 
                             effectiveLocation?.address || 
                             effectiveLocation?.fullAddress || 
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
          
          const { error: scheduleError } = await supabase
            .from('job_schedule')
            .insert({
              job_id: job.id,
              jsdate: startYmd,
              jedate: endYmd,
              jstime: formattedStartTime,
              jetime: formattedEndTime,
              dur_type: 'hours', // Duration type: hours, minutes, etc.
              dur: durationHoursDecimal || String(totalMinutes), // Duration value
              address: fullAddress || formData.location?.locationName || ''
            });

          if (scheduleError) {
            console.error('Error creating job schedule:', scheduleError);
            toast.error(`Failed to save schedule details: ${scheduleError.message}`, {
              duration: 3000,
              style: {
                background: "#fff",
                color: "#dc3545",
                padding: "16px",
                borderLeft: "6px solid #dc3545",
              },
            });
            // Continue even if schedule fails
          }

          setProgress(60 + (35 * (i + 1) / jobDates.length));
        } catch (supabaseError) {
          console.error(`Supabase save error for job ${i + 1}:`, supabaseError);
          throw new Error(`Failed to save job ${i + 1}: ${supabaseError.message}`);
        }
      }

      setProgress(100);

      // Show success message
      const successLabel =
        repeatSettings.isRepeat && jobDates.length > 1
          ? `Successfully created ${jobDates.length} repeat jobs!`
          : `Successfully created ${jobDates.length} job(s)!`;
      toast.success(successLabel, {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#28a745",
          padding: "16px",
          borderLeft: "6px solid #28a745",
        },
      });
      initializeJobNo();
      // Handle success (redirect, reset form, etc.)
      // Use the first job's UUID for redirect, but show job number in message
      handleSubmitSuccess({ 
        jobId: firstJobId || baseJobNo, 
        jobNumber: baseJobNo 
      });

    } catch (error) {
      console.error("Submit error:", error);
      setIsSubmitting(false);
      setProgress(0);

      toast.error(`Error creating job: ${error.message}`, {
        duration: 5000,
        style: {
          background: "#fff",
          color: "#dc3545",
          padding: "16px",
          borderLeft: "6px solid #dc3545",
        },
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const missingFields = validateJobForm(formData);

    if (missingFields.length > 0) {
      toast.error(
        <div>
          <strong>Please check the following:</strong>
          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
            {missingFields.map((field, index) => (
              <li key={index}>{field}</li>
            ))}
          </ul>
        </div>,
        {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
            maxWidth: "500px",
          },
        }
      );

      // If there's a task-related error, switch to the Task tab
      if (missingFields.some((field) => field.toLowerCase().includes("task"))) {
        setActiveKey("task");
      }
      return;
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

  // Prefill customer from ?customerCode= even when missing from SAP masterlist dropdown
  useEffect(() => {
    const initializeCustomer = async () => {
      if (urlCustomerPrefillHandledRef.current || urlCustomerPrefillInFlightRef.current) {
        return;
      }
      if (!customersLoaded) return;

      const params = new URLSearchParams(window.location.search);
      const customerCode = String(params.get("customerCode") || "").trim();
      if (!customerCode) {
        urlCustomerPrefillHandledRef.current = true;
        return;
      }

      const codeUpper = customerCode.toUpperCase();
      const matchInList = (list) =>
        (list || []).find((customer) => {
          const value = String(customer.value || "").trim().toUpperCase();
          const card = String(customer.cardCode || "").trim().toUpperCase();
          return value === codeUpper || card === codeUpper;
        });

      const customerOption = matchInList(customers);
      if (customerOption) {
        urlCustomerPrefillHandledRef.current = true;
        await handleCustomerChange(customerOption);
        return;
      }

      // Not in loaded list (e.g. source=portal still, or not yet synced) — fetch & synthesize.
      urlCustomerPrefillInFlightRef.current = true;
      try {
        let synthesized = null;

        const bundleRes = await fetch(
          `/api/customers/masterlist-bundle/${encodeURIComponent(customerCode)}?refresh=1`,
          { credentials: "include", headers: { Accept: "application/json" } }
        );
        if (bundleRes.ok) {
          const bundleJson = await bundleRes.json().catch(() => ({}));
          const partner = bundleJson?.partner;
          if (partner?.CardCode) {
            synthesized = {
              value: partner.CardCode,
              label: `${partner.CardCode} - ${partner.CardName || ""}`,
              cardCode: partner.CardCode,
              cardName: partner.CardName || "",
              customerId: bundleJson.customerUuid || null,
              email: partner.EmailAddress || "",
              phone_number: partner.Phone1 || "",
              customer_address: partner.MailAddress || partner.Address || "",
              sap_card_code: bundleJson.sapCardCode || null,
            };
          }
        }

        if (!synthesized) {
          try {
            const sapRes = await fetch(
              `/api/getCustomerCode?cardCode=${encodeURIComponent(customerCode)}`,
              { credentials: "include" }
            );
            if (sapRes.ok) {
              const sapPartner = await sapRes.json().catch(() => null);
              if (sapPartner?.CardCode) {
                synthesized = {
                  value: sapPartner.CardCode,
                  label: `${sapPartner.CardCode} - ${sapPartner.CardName || ""}`,
                  cardCode: sapPartner.CardCode,
                  cardName: sapPartner.CardName || "",
                  customerId: null,
                  email: sapPartner.EmailAddress || "",
                  phone_number: sapPartner.Phone1 || "",
                  customer_address:
                    sapPartner.MailAddress || sapPartner.Address || "",
                  sap_card_code: null,
                };
              }
            }
          } catch (sapPrefillErr) {
            console.warn("URL customerCode SAP fallback:", sapPrefillErr);
          }
        }

        urlCustomerPrefillHandledRef.current = true;

        if (!synthesized) {
          toast(
            `Customer ${customerCode} was not found in the master list. Select the customer manually.`,
            {
              icon: "⚠️",
              duration: 6000,
              style: {
                background: "#fff",
                color: "#856404",
                padding: "16px",
                borderLeft: "6px solid #ffc107",
              },
            }
          );
          return;
        }

        setCustomers((prev) => {
          if (matchInList(prev)) return prev;
          return [...prev, synthesized];
        });
        await handleCustomerChange(synthesized);
      } catch (prefillErr) {
        console.error("URL customerCode prefill failed:", prefillErr);
        urlCustomerPrefillHandledRef.current = true;
        toast.error("Could not prefill customer from URL. Select the customer manually.", {
          duration: 5000,
          style: {
            background: "#fff",
            color: "#dc3545",
            padding: "16px",
            borderLeft: "6px solid #dc3545",
          },
        });
      } finally {
        urlCustomerPrefillInFlightRef.current = false;
      }
    };

    initializeCustomer();
  }, [customers, customersLoaded]);

  // Required field indicator component
  const RequiredField = () => (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>This field is required</Tooltip>}
    >
      <FaAsterisk
        style={{
          color: "red",
          marginLeft: "4px",
          fontSize: "8px",
          verticalAlign: "super",
        }}
      />
    </OverlayTrigger>
  );

  // Add this component for fields that need tooltips
  const RequiredFieldWithTooltip = ({ label }) => (
    <Form.Label>
      {label}
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>This field is required</Tooltip>}
      >
        <span
          className="text-danger"
          style={{ marginLeft: "4px", cursor: "help" }}
        >
          *
        </span>
      </OverlayTrigger>
    </Form.Label>
  );

  const initializeJobNo = async () => {
    try {
      const newJobNo = await generateBaseJobNo();
      setJobNo(newJobNo);
    } catch (error) {
      console.error("Error initializing job number:", error);
      setJobNo("Error");
    }
  };

  useEffect(() => {
    initializeJobNo();
  }, []); // Empty dependency array means this runs once when component mounts

  if (!initialBootstrapDone && !isFormReady) {
    return (
      <EditJobFormSkeleton
        message="Please wait while we prepare the job form"
        subMessage="Loading customers, workers, job statuses, schedule options, and job categories."
      />
    );
  }

  return (
    <>
      <Tabs
        id="noanim-tab-example"
        activeKey={activeKey}
        onSelect={(key) => setActiveKey(key)} // Handle tab change event
        className="mb-3"
      >
        <Tab eventKey="summary" title="Job Summary">
          <Form noValidate validated={validated} onSubmit={handleSubmit}>
            <fieldset disabled={isFormDisabled}>
            <Row className="mb-3">
              <Form.Group as={Col} md="7" controlId="customerList">
                <Form.Label>
                  <RequiredFieldWithTooltip label="Customer" />
                  <OverlayTrigger
                    placement="right"
                    overlay={
                      <Tooltip id="customer-search-tooltip">
                        <div className="text-start">
                          <strong>Customer:</strong>
                          <br />
                          Choose &quot;SAP Customers&quot; for the portal master list (imported SAP customers). Contacts load from the database; sites/locations may still use SAP when a session is available. Choose &quot;Portal Customers&quot; for portal-only records.
                        </div>
                      </Tooltip>
                    }
                  >
                    <i
                      className="fe fe-help-circle text-muted"
                      style={{ cursor: "pointer" }}
                    ></i>
                  </OverlayTrigger>
                </Form.Label>
                <div className="mb-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={customerSource === "sap" ? "primary" : "outline-primary"}
                    className="me-2"
                    onClick={() => setCustomerSource("sap")}
                  >
                    SAP Customers
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={customerSource === "portal" ? "primary" : "outline-primary"}
                    onClick={() => setCustomerSource("portal")}
                  >
                    Portal Customers
                  </Button>
                </div>
                <Select
                  instanceId="customer-select"
                  options={customers}
                  value={selectedCustomer}
                  onChange={handleCustomerChange}
                  placeholder={
                    isLoading ? "Loading customers..." : "Enter Customer Name"
                  }
                  isDisabled={isFormDisabled}
                  noOptionsMessage={() =>
                    isLoading ? "Loading..." : "No customers found"
                  }
                />
              </Form.Group>
            </Row>

            <hr className="my-4" />
            <h5 className="mb-1">Primary Contact</h5>
            <p className="text-muted">Details about the customer.</p>

            <Row className="mb-3">
              <Form.Group as={Col} md="3" controlId="jobWorker">
                <Form.Label>
                  Contact ID (Optional)
                  <OverlayTrigger
                    placement="right"
                    overlay={
                      <Tooltip id="contact-tooltip">
                        <div className="text-start">
                          <strong>Contact Information:</strong>
                          <br />
                          • Lists masterlist contacts (same person repeated on multiple sites appears once)
                          <br />
                          • Auto-fills contact details; you can edit fields below
                          <br />
                          • Optional for job communication
                        </div>
                      </Tooltip>
                    }
                  >
                    <i
                      className="fe fe-help-circle text-muted"
                      style={{ cursor: "pointer" }}
                    ></i>
                  </OverlayTrigger>
                </Form.Label>
                <Select
                  instanceId="contact-select"
                  options={contacts}
                  value={selectedContact}
                  onChange={handleContactChange}
                  placeholder="Select Contact ID"
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
                Contact and address fields are editable for this job. Duplicate contacts from multiple sites are collapsed to one entry in the list above.
              </div>
            )}
            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="validationCustom01">
                <Form.Label>First name</Form.Label>
                <Form.Control
                  required
                  type="text"
                  value={formData.contact.firstName}
                  onChange={(e) => handleContactFieldChange("firstName", e.target.value)}
                />
                <Form.Control.Feedback>Looks good!</Form.Control.Feedback>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="validationCustom02">
                <Form.Label>Middle name</Form.Label>
                <Form.Control
                  required
                  type="text"
                  value={formData.contact.middleName}
                  onChange={(e) => handleContactFieldChange("middleName", e.target.value)}
                />
                <Form.Control.Feedback>Looks good!</Form.Control.Feedback>
              </Form.Group>
              <Form.Group as={Col} md="4" controlId="validationCustom03">
                <Form.Label>Last name</Form.Label>
                <Form.Control
                  required
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
                  value={formData.contact.phoneNumber}
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
                  value={formData.contact.mobilePhone}
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
                  value={formData.contact.email}
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
                    <Form.Label>
                      <RequiredFieldWithTooltip label="Site / Location" />
                      <OverlayTrigger
                        placement="right"
                        overlay={
                          <Tooltip id="location-tooltip">
                            <div className="text-start">
                              <strong>Location Details:</strong>
                              <br />
                              • Shows addresses linked to customer
                              <br />
                              • Auto-fills complete address
                              <br />• Used for job site information
                            </div>
                          </Tooltip>
                        }
                      >
                        <i
                          className="fe fe-help-circle text-muted ms-1"
                          style={{ cursor: "pointer" }}
                        ></i>
                      </OverlayTrigger>
                    </Form.Label>
                    <Select
                      instanceId="location-select"
                      options={locations}
                      value={selectedLocation}
                      onChange={handleLocationChange}
                      placeholder="Select Site ID"
                      isGrouped={true}
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
                    {formData.equipments.length === 0 ? (
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
                            {formData.equipments.map((eq, idx) => (
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
                    <EquipmentsTable
                      equipments={equipments}
                      onSelectedRowsChange={handleSelectedEquipmentsChange}
                    />
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
        <Tab eventKey="task" title="Job Task">
          <fieldset disabled={isFormDisabled}>
          <JobTask
            tasks={tasks}
            addTask={addTask}
            handleTaskChange={handleTaskChange}
            handleCheckboxChange={handleCheckboxChange}
            deleteTask={deleteTask}
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
                  <option value="afternoon">Afternoon (1:00pm to 5:30pm)</option>
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
                  <option value="afternoon">Afternoon (1:00pm to 5:30pm)</option>
                </Form.Select>
              </Form.Group> */}
              <Form.Group as={Col} md="3" controlId="serviceCall">
                <Form.Label>Service Call</Form.Label>
                <Select
                  instanceId="service-call-select"
                  options={serviceCalls}
                  value={selectedServiceCall}
                  onChange={handleSelectedServiceCallChange}
                  placeholder="Select Service Call"
                  isDisabled={!selectedCustomer}
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="salesOrder">
                <Form.Label>Sales Order</Form.Label>
                <Select
                  instanceId="sales-order-select"
                  options={salesOrders}
                  value={selectedSalesOrder}
                  onChange={(selectedOption) =>
                    setSelectedSalesOrder(selectedOption)
                  }
                  placeholder={
                    selectedServiceCall
                      ? "Select Sales Order"
                      : "Select Service Call first"
                  }
                  isDisabled={!selectedServiceCall || salesOrders.length === 0}
                  noOptionsMessage={() =>
                    selectedServiceCall
                      ? "No sales orders found for this service call"
                      : "Please select a service call first"
                  }
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="jobContactType">
                <RequiredFieldWithTooltip label="Job Contact Type" />
                <Select
                  instanceId="job-contact-type-select"
                  options={jobContactTypes}
                  value={selectedJobContactType}
                  onChange={handleJobContactTypeChange}
                  placeholder="Select Contact Type"
                  isClearable
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
                <RequiredFieldWithTooltip label="Job Priority" />
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
                  instanceId="job-status-select"
                  isClearable={false}
                  components={{ SingleValue: JobStatusSelectSingleValue }}
                  options={jobStatuses.map((s) => ({
                    value: s.value,
                    label: s.name,
                    color: s.color,
                  }))}
                  value={
                    jobStatuses.length > 0
                      ? (() => {
                          const opt = jobStatuses.find((s) => s.value === formData.jobStatus);
                          return opt ? { value: opt.value, label: opt.name, color: opt.color } : null;
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
                          backgroundColor: color || JOB_STATUS_DOT_FALLBACK,
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
                <Form.Label>Assigned Worker (optional)</Form.Label>
                <Select
                  instanceId="worker-select"
                  isMulti
                  options={workerSelectOptions}
                  value={selectedWorkers}
                  onChange={handleWorkersChange}
                  onInputChange={handleWorkerSearchInputChange}
                  inputValue={workerSearchInput}
                  filterOption={() => true}
                  placeholder={isFormReady ? "Search Worker" : "Loading workers..."}
                  isSearchable
                  isLoading={workersLoading}
                  isDisabled={isFormDisabled}
                  closeMenuOnSelect={false}
                  getOptionLabel={(option) => option.label || option.name || "Unknown"}
                  getOptionValue={(option) => option.value || option.id}
                  noOptionsMessage={() =>
                    workersLoading ? "Loading workers..." : "No workers found"
                  }
                />
              </Form.Group>
            </Row>
            <Row className="mb-3">
              <Form.Group as={Col} md="4" controlId="startDate">
                <RequiredFieldWithTooltip label="Start Date" />
                <Flatpickr
                  value={displayStartDate ? new Date(displayStartDate + 'T00:00:00') : null}
                  options={{
                    dateFormat: 'd/m/Y',
                    altInput: true,
                    altFormat: 'd/m/Y',
                    allowInput: true,
                    placeholder: 'DD/MM/YYYY',
                    onOpen: (_selectedDates, _dateStr, instance) => {
                      if (repeatSettings.isRepeat) {
                        instance.close();
                        setShowRecurrenceModal(true);
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
                <RequiredFieldWithTooltip label="End Date" />
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
                <RequiredFieldWithTooltip label="Schedule Session" />
                <Form.Select
                  name="scheduleSession"
                  value={formData.scheduleSession}
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
                <RequiredFieldWithTooltip label="Start Time" />
                <Form.Control
                  type="time"
                  name="startTime"
                  value={formData.startTime}
                  onChange={handleInputChange}
                  readOnly={formData.scheduleSession !== "custom"}
                />
              </Form.Group>

              <Form.Group as={Col} md="4" controlId="endTime">
                <RequiredFieldWithTooltip label="End Time" />
                <Form.Control
                  type="time"
                  name="endTime"
                  value={formData.endTime}
                  onChange={handleInputChange}
                  readOnly={formData.scheduleSession !== "custom"}
                />
              </Form.Group>

              <Form.Group as={Col} md="3" controlId="estimatedDuration">
                <RequiredFieldWithTooltip label="Estimated Duration" />
                <InputGroup>
                  <Form.Control
                    type="number"
                    name="estimatedDurationHours"
                    value={formData.estimatedDurationHours || 0}
                    onChange={handleInputChange}
                    placeholder="Hours"
                    min="0"
                  />
                  <InputGroup.Text>h</InputGroup.Text>
                  <Form.Control
                    type="number"
                    name="estimatedDurationMinutes"
                    value={formData.estimatedDurationMinutes || 0}
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
                <RequiredFieldWithTooltip label="Subject" />
                <Form.Select
                  name="jobCategoryId"
                  value={formData.jobCategoryId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const option = jobCategories.find((c) => c.value === id);
                    setFormData((prev) => ({
                      ...prev,
                      jobCategoryId: id,
                      jobName: option ? option.label : prev.jobName,
                    }));
                  }}
                  aria-label="Select job subject"
                >
                  <option value="" disabled>
                    Select Subject
                  </option>
                  {jobCategories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </Form.Select>
                {jobCategories.length === 0 && !formData.jobCategoryId && (
                  <small className="text-muted">No job categories available</small>
                )}
              </Form.Group>
              <Form.Group controlId="description" className="mb-3">
                <RequiredFieldWithTooltip label="Description" />
                <ReactQuillEditor
                  key={editorResetKey} // Force remount when form is reset
                  initialValue={formData.jobDescription} // Pass the initial value
                  onDescriptionChange={handleDescriptionChange} // Handle changes
                />
              </Form.Group>
            </Row>
            <hr className="my-4" />
            <h5 className="mb-3">Repeat Job</h5>
            <Row className="mb-3 align-items-center">
              <Form.Group as={Col} md="3">
                <Form.Check
                  type="switch"
                  id="repeat-switch"
                  label="Repeat Job"
                  checked={repeatSettings.isRepeat}
                  onChange={(e) => handleRepeatToggle(e.target.checked)}
                />
              </Form.Group>
              {repeatSettings.isRepeat && (
                <Col md="9">
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <span className="text-muted small">{recurrenceSummary}</span>
                    {!repeatConfigured && (
                      <span className="text-warning small">
                        Repeat schedule not saved — open Configure schedule and save.
                      </span>
                    )}
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => setShowRecurrenceModal(true)}
                    >
                      Configure schedule
                    </Button>
                  </div>
                </Col>
              )}
            </Row>
            {/* SUBMIT BUTTON! */}
            <Row className="align-items-center">
              <Col md={{ span: 4, offset: 8 }} xs={12} className="mt-4">
                <Button
                  variant="primary"
                  onClick={handleSubmitClick}
                  className="float-end"
                  disabled={isFormDisabled}
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
            <div className="mt-2">Creating Job...</div>
          </div>
        </div>
      )}

      <JobRecurrenceModal
        show={showRecurrenceModal}
        onHide={handleRecurrenceModalHide}
        initialRule={normalizeRecurrenceRule(repeatSettings, formData.startDate)}
        onSave={handleRecurrenceSave}
        mode="configure"
      />
    </>
  );
};

export default AddNewJobs;