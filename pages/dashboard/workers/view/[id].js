import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  Row,
  Col,
  Card,
  Badge,
  Button,
  Image,
  Tab,
  Nav,
  Table,
  OverlayTrigger,
  Tooltip,
  Spinner,
  Modal,
  Form,
  Pagination
} from 'react-bootstrap';
import { getSupabaseClient } from '../../../../lib/supabase/client';
import { uploadFile, getDownloadURL, deleteFile } from '../../../../lib/supabase/storage';
import {
  createTechnicianDocument,
  deleteTechnicianDocument,
  replaceTechnicianSchedule,
  cloneDefaultWorkerSchedule,
} from '../../../../lib/technicians/employeeProfile';
import {
  fetchTechnicianAttendanceSummary,
  fetchTechnicianAssignments,
  fetchWorkerCoreByUserId,
  fetchWorkerEmployeeSections,
  invalidateWorkerCache,
} from '../../../../lib/technicians/workerData';
import { buildAuditChanges, clientAuditLog } from '../../../../utils/clientAuditLog';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Clock,
  Award,
  Briefcase,
  Shield,
  Activity,
  Star,
  FileText,
  Edit3,
  ArrowLeft,
  Plus,
  Eye,
  Search,
  Filter,
  Trash,
  Download,
  Hash,
  CreditCard,
  CalendarDays,
  CircleCheck,
  X as LucideX,
  Info,
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { 
  Calendar2, 
  CheckCircle, 
  XCircle, 
  Upload
} from 'react-bootstrap-icons';
import toast from 'react-hot-toast';
import { FaUser, FaPlus, FaArrowLeft } from "react-icons/fa";
import { calculateTechnicianJobIncentive, formatHours, formatIncentiveAmount } from '../../../../lib/supabase/reports';
import { formatFsmPeriodLabel } from '../../../../lib/supabase/technicianHours';
import { formatSingaporeDate } from '../../../../lib/utils/singaporeDateTime';
import {
  fetchJobStatuses,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
} from '../../../../utils/jobStatusSettings';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
} from '@tanstack/react-table';
import { DebouncedInput } from '../../../../components/DebouncedInput';
import { EmployeeScheduleTab } from '../../../../sub-components/dashboard/worker/EmployeeProfileTabs';
import { fetchCalendarEventsForRange } from '../../../../lib/calendar/calendarEvents';
import CalendarEventForm from '../../scheduling/company-calendar/_components/CalendarEventForm';
// Supabase storage imported above

/** Resolved status labels that count as completed for assignment summary cards (terminal / done states). */
const COMPLETED_ASSIGNMENT_STATUS_LABELS = new Set([
  'completed',
  'job done',
  'invoiced',
  'repair complete',
  'job done to invoice',
]);

/** Normalize skills from JSONB / API ( technicians.skills must stay a string[] for updates). */
function normalizeSkillsList(skills) {
  if (skills == null) return [];
  if (Array.isArray(skills)) {
    return skills
      .map((s) => (typeof s === 'string' ? s.trim() : s != null ? String(s).trim() : ''))
      .filter(Boolean);
  }
  if (typeof skills === 'string') {
    try {
      return normalizeSkillsList(JSON.parse(skills));
    } catch {
      return [];
    }
  }
  return [];
}

function getTechnicianRowIdForProfile(technician) {
  if (!technician) return null;
  if (technician.hasTechnicianRecord) {
    return technician.technicianId || technician.id || null;
  }
  if (technician.technicianId && technician.workerId && technician.technicianId !== technician.workerId) {
    return technician.technicianId;
  }
  return null;
}

const getPriorityColor = (priority) => {
  switch (priority?.toLowerCase()) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    case 'low':
      return 'success';
    default:
      return 'secondary';
  }
};

/** Display label: show "Normal" for stored value MEDIUM (same as job list). */
const getPriorityDisplayLabel = (priority) => {
  if (priority == null || priority === '') return priority;
  const u = String(priority).trim().toUpperCase();
  if (u === 'MEDIUM') return 'Normal';
  return String(priority);
};

const toTwelveHourTime = (time) => {
  if (!time) return '';
  const s = String(time).trim();
  const already = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\s*$/i);
  if (already) {
    const h = Number(already[1]);
    const m = already[2];
    const p = already[3].toUpperCase();
    if (Number.isNaN(h)) return '';
    const displayHour = h % 12 || 12;
    return `${displayHour}:${m} ${p}`;
  }
  const [hourValue, minuteValue = '00'] = s.split(':');
  const hour = Number(hourValue);
  if (Number.isNaN(hour)) return '';
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  const mins = String(minuteValue).replace(/\D/g, '').slice(0, 2).padStart(2, '0') || '00';
  return `${displayHour}:${mins} ${period}`;
};

const toTwentyFourHourTime = (time) => {
  if (!time) return '';
  const match = String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return String(time).slice(0, 5);
  let hours = Number(match[1]);
  const minutes = match[2];
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
};

const employeeScheduleToDetailSchedule = (schedule = {}) => {
  const defaultDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return defaultDays.reduce((result, day) => {
    const daySchedule = schedule[day] || {};
    result[day] = {
      firstShift: {
        start: toTwelveHourTime(daySchedule.firstStart) || '8:00 AM',
        end: toTwelveHourTime(daySchedule.firstEnd) || '6:00 PM',
      },
      secondShift: {
        start: toTwelveHourTime(daySchedule.secondStart),
        end: toTwelveHourTime(daySchedule.secondEnd),
      },
    };
    return result;
  }, {});
};

const VALID_PROFILE_TABS = ['overview', 'skills', 'assignments', 'schedule', 'documents'];

const scheduleHasNoWorkingWindows = (schedule = {}) =>
  !Object.values(schedule).some((day) => day?.isWorking);

const employeeScheduleAuditSnapshot = (schedule = {}) => {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const parts = days.map((day) => {
    const daySchedule = schedule[day];
    if (!daySchedule?.isWorking) return `${day}: off`;
    const first =
      daySchedule.firstStart && daySchedule.firstEnd
        ? `${daySchedule.firstStart}–${daySchedule.firstEnd}`
        : null;
    const second =
      daySchedule.secondStart && daySchedule.secondEnd
        ? `${daySchedule.secondStart}–${daySchedule.secondEnd}`
        : null;
    const windows = [first, second].filter(Boolean).join(', ');
    return `${day}: ${windows || 'working'}`;
  });
  return parts.join('; ') || '—';
};

const mapStoredDocumentToDetailDocument = (document) => ({
  id: document.id,
  name: document.name || document.file_name || 'Document',
  url: document.file_url,
  type: document.file_type || document.document_type || '',
  size: document.file_size || 0,
  uploadedAt: document.created_at,
  path: document.storage_path,
});

const getFollowUpStatusColor = (status) => {
  switch (status?.toLowerCase()) {
    case 'closed':
      return 'success';
    case 'in progress':
      return 'warning';
    case 'logged':
      return 'info';
    default:
      return 'secondary';
  }
};

const getJobTypeIcon = (type) => {
  switch (type?.toLowerCase()) {
    case 'recurring':
      return <i className="fe fe-repeat text-primary"></i>;
    case 'one-time':
      return <i className="fe fe-clock text-warning"></i>;
    default:
      return <i className="fe fe-calendar text-secondary"></i>;
  }
};

const getJobContactTypeColor = (type) => {
  switch (type?.code) {
    case 1:
      return 'danger'; // Repair
    case 2:
      return 'warning'; // Maintenance
    case 3:
      return 'info'; // Installation
    default:
      return 'secondary';
  }
};

function mergeLastActiveFields(base, { isClockedIn, lastAttendanceAt, lastLogin }) {
  const lastLoginMs = lastLogin ? new Date(lastLogin).getTime() : 0;
  const attMs = lastAttendanceAt ? new Date(lastAttendanceAt).getTime() : 0;
  const effectiveMs = Math.max(
    !Number.isNaN(lastLoginMs) ? lastLoginMs : 0,
    !Number.isNaN(attMs) ? attMs : 0
  );
  return {
    ...base,
    isClockedIn,
    lastActiveAt: effectiveMs > 0 ? new Date(effectiveMs).toISOString() : null,
    showOnlineIndicator: Boolean(base.isOnline || isClockedIn),
  };
}

function formatWorkerRoleLabel(role) {
  if (!role) return 'Field Worker';
  if (role === 'ADMIN') return 'Admin';
  if (role === 'TECHNICIAN') return 'Field Worker';
  return String(role).replace(/_/g, ' ');
}

function workerRoleBadgeProps(role) {
  if (role === 'ADMIN') return { bg: 'danger', text: undefined };
  if (role === 'TECHNICIAN') return { bg: 'warning', text: 'dark' };
  return { bg: 'secondary', text: undefined };
}

const TechnicianDetails = () => {
  const router = useRouter();
  const { id } = router.query;
  const [technician, setTechnician] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [assignments, setAssignments] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [showAddCertModal, setShowAddCertModal] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [addingSkill, setAddingSkill] = useState(false);
  const [newCertificate, setNewCertificate] = useState({
    name: '',
    issuer: '',
    issueDate: '',
    expiryDate: '',
    certificateId: ''
  });
  const [addingCertificate, setAddingCertificate] = useState(false);
  const [showAddCertForm, setShowAddCertForm] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const nowAssignments = new Date();
  const [assignmentPeriodYear, setAssignmentPeriodYear] = useState(nowAssignments.getFullYear());
  const [assignmentPeriodMonth, setAssignmentPeriodMonth] = useState(nowAssignments.getMonth() + 1);
  const [jobStatuses, setJobStatuses] = useState(() => getDefaultJobStatuses());
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [schedules, setSchedules] = useState({
    monday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    tuesday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    wednesday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    thursday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    friday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    saturday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
    sunday: { firstShift: { start: '8:00 AM', end: '6:00 PM' }, secondShift: { start: '', end: '' } },
  });
  const [employeeSchedule, setEmployeeSchedule] = useState(() => cloneDefaultWorkerSchedule());
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [upcomingLeave, setUpcomingLeave] = useState([]);
  const [loadingUpcomingLeave, setLoadingUpcomingLeave] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [incentiveRateInput, setIncentiveRateInput] = useState('0');
  const [savingIncentiveRate, setSavingIncentiveRate] = useState(false);
  const fileInputRef = useRef(null);

  const handleTabSelect = useCallback(
    (tabKey) => {
      if (!tabKey || !VALID_PROFILE_TABS.includes(tabKey)) return;
      setActiveTab(tabKey);
      if (router.isReady) {
        router.replace(
          { pathname: router.pathname, query: { ...router.query, tab: tabKey } },
          undefined,
          { shallow: true }
        );
      }
    },
    [router]
  );

  useEffect(() => {
    if (!router.isReady) return;
    const tab = typeof router.query.tab === 'string' ? router.query.tab : null;
    if (tab && VALID_PROFILE_TABS.includes(tab)) {
      setActiveTab(tab);
    }
  }, [router.isReady, router.query.tab]);

  const loadUpcomingLeave = useCallback(async () => {
    const technicianId = technician?.technicianId;
    if (!technicianId) {
      setUpcomingLeave([]);
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoadingUpcomingLeave(true);
    try {
      const today = new Date();
      const end = new Date(today);
      end.setDate(end.getDate() + 90);
      const startDate = format(today, 'yyyy-MM-dd');
      const endDate = format(end, 'yyyy-MM-dd');
      const { data, error } = await fetchCalendarEventsForRange(supabase, {
        startDate,
        endDate,
        scope: 'technician',
        technicianIds: [technicianId],
      });
      if (error) throw error;
      setUpcomingLeave(data || []);
    } catch (err) {
      console.error('Failed to load upcoming leave', err);
      setUpcomingLeave([]);
    } finally {
      setLoadingUpcomingLeave(false);
    }
  }, [technician?.technicianId]);

  useEffect(() => {
    if (activeTab === 'schedule') {
      loadUpcomingLeave();
    }
  }, [activeTab, loadUpcomingLeave]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const statuses = await fetchJobStatuses();
      if (mounted && Array.isArray(statuses) && statuses.length > 0) {
        setJobStatuses(statuses);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const fetchTechnicianDetails = async () => {
      if (!id || !router.isReady) return;

      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error('Supabase client not available');
        }

        const core = await fetchWorkerCoreByUserId(supabase, id);
        if (!core.userData) {
          console.error('No technician or user found with ID:', id);
          return;
        }

        const techId = core.technicianId;
        const [attendanceSummary, employeeProfile] = await Promise.all([
          fetchTechnicianAttendanceSummary(supabase, techId),
          techId
            ? fetchWorkerEmployeeSections(supabase, techId, {
                sections: ['schedule', 'documents'],
              })
            : Promise.resolve({
                schedule: cloneDefaultWorkerSchedule(),
                documents: [],
              }),
        ]);

        const mappedData = {
          ...core.viewTechnician,
          skills: normalizeSkillsList(core.viewTechnician?.skills),
        };
        const lastLoginVal = mappedData?.lastLogin ?? null;

        setTechnician(
          mergeLastActiveFields(mappedData, {
            ...attendanceSummary,
            lastLogin: lastLoginVal,
          })
        );

        if (techId && employeeProfile) {
          setSchedules(employeeScheduleToDetailSchedule(employeeProfile.schedule));
          setEmployeeSchedule(employeeProfile.schedule || cloneDefaultWorkerSchedule());
          setDocuments((employeeProfile.documents || []).map(mapStoredDocumentToDetailDocument));
        }
      } catch (error) {
        console.error('Error fetching technician details:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTechnicianDetails();
  }, [id, router.isReady]);

  useEffect(() => {
    if (activeTab !== 'assignments') return;

    const techId = getTechnicianRowIdForProfile(technician);

    if (!techId) {
      setAssignments([]);
      return;
    }

    let mounted = true;

    const loadAssignments = async () => {
      setLoadingAssignments(true);
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error('Supabase client not available');
        }

        const assignmentsList = await fetchTechnicianAssignments(supabase, techId, {
          year: assignmentPeriodYear,
          month: assignmentPeriodMonth,
        });

        if (mounted) {
          setAssignments(assignmentsList);
        }
      } catch (error) {
        console.error('Error fetching assignments:', error);
        toast.error('Failed to fetch job assignments');
        if (mounted) setAssignments([]);
      } finally {
        if (mounted) setLoadingAssignments(false);
      }
    };

    loadAssignments();

    return () => {
      mounted = false;
    };
  }, [
    activeTab,
    technician,
    assignmentPeriodYear,
    assignmentPeriodMonth,
  ]);

  const handleAddSkill = async () => {
    const trimmed = newSkill.trim();
    if (!trimmed) return;

    const techRowId = getTechnicianRowIdForProfile(technician);
    if (!techRowId) {
      toast.error('No technician profile is linked to this user. Add a technician record before managing skills.');
      return;
    }

    setAddingSkill(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const currentSkills = normalizeSkillsList(technician?.skills);
      if (currentSkills.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
        toast.error('This skill already exists');
        return;
      }

      const updatedSkills = [...currentSkills, trimmed];

      const { data: updatedRows, error: updateError } = await supabase
        .from('technicians')
        .update({
          skills: updatedSkills,
          updated_at: new Date().toISOString(),
        })
        .eq('id', techRowId)
        .select('id');

      if (updateError) {
        throw updateError;
      }
      if (!updatedRows?.length) {
        throw new Error('Update did not match a technician row (check permissions / id).');
      }

      setTechnician((prev) =>
        prev
          ? {
              ...prev,
              skills: updatedSkills,
            }
          : prev
      );

      setNewSkill('');
      invalidateWorkerCache(id);
      toast.success('Skill added successfully');
    } catch (error) {
      console.error('Error adding skill:', error);
      toast.error(
        error?.message ? `Failed to add skill: ${error.message}` : 'Failed to add skill'
      );
    } finally {
      setAddingSkill(false);
    }
  };

  const handleAddCertificate = async () => {
    if (!newCertificate.name || !newCertificate.issuer) return;

    setAddingCertificate(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const certificate = {
        ...newCertificate,
        id: `cert-${Date.now()}`,
        dateAdded: new Date().toISOString()
      };

      // Update technician record with new certificate
      // Note: Certificates may be stored as JSONB or in a separate table
      const updatedCertificates = [...(technician.certificates || []), certificate];
      
      const { error: updateError } = await supabase
        .from('technicians')
        .update({
          updated_at: new Date().toISOString()
        })
        .eq('id', technician.technicianId);

      if (updateError) {
        throw updateError;
      }

      // Update local state
      setTechnician(prev => ({
        ...prev,
        certificates: updatedCertificates
      }));

      setNewCertificate({
        name: '',
        issuer: '',
        issueDate: '',
        expiryDate: '',
        certificateId: ''
      });
      setShowAddCertModal(false);
      toast.success('Certificate added successfully');
    } catch (error) {
      console.error('Error adding certificate:', error);
      toast.error('Failed to add certificate');
    } finally {
      setAddingCertificate(false);
    }
  };

  const AddSkillModal = () => (
    <Modal show={showAddSkillModal} onHide={() => setShowAddSkillModal(false)}>
      <Modal.Header closeButton>
        <Modal.Title>Add New Skill</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group>
          <Form.Label>Skill Name</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter skill name"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowAddSkillModal(false)}>
          Cancel
        </Button>
        <Button 
          variant="primary" 
          onClick={handleAddSkill}
          disabled={addingSkill || !newSkill.trim()}
        >
          {addingSkill ? 'Adding...' : 'Add Skill'}
        </Button>
      </Modal.Footer>
    </Modal>
  );

  const AddCertificateModal = () => (
    <Modal show={showAddCertModal} onHide={() => setShowAddCertModal(false)}>
      <Modal.Header closeButton>
        <Modal.Title>Add New Certificate</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>Certificate Name*</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter certificate name"
            value={newCertificate.name}
            onChange={(e) => setNewCertificate(prev => ({ ...prev, name: e.target.value }))}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Issuing Organization*</Form.Label>
          <Form.Control
            type="text"
            value={newCertificate.issuer}
            onChange={(e) => setNewCertificate(prev => ({ ...prev, issuer: e.target.value }))}
            placeholder="Enter issuer name"
          />
        </Form.Group>
        <Row>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Issue Date</Form.Label>
              <Form.Control
                type="date"
                value={newCertificate.issueDate}
                onChange={(e) => setNewCertificate(prev => ({ ...prev, issueDate: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group className="mb-3">
              <Form.Label>Expiry Date</Form.Label>
              <Form.Control
                type="date"
                value={newCertificate.expiryDate}
                onChange={(e) => setNewCertificate(prev => ({ ...prev, expiryDate: e.target.value }))}
              />
            </Form.Group>
          </Col>
        </Row>
        <Form.Group>
          <Form.Label>Certificate ID (Optional)</Form.Label>
          <Form.Control
            size="sm"
            type="text"
            value={newCertificate.certificateId}
            onChange={(e) => setNewCertificate(prev => ({ ...prev, certificateId: e.target.value }))}
            placeholder="Enter certificate ID"
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowAddCertModal(false)}>
          Cancel
        </Button>
        <Button 
          variant="primary" 
          onClick={handleAddCertificate}
          disabled={addingCertificate || !newCertificate.name || !newCertificate.issuer}
        >
          {addingCertificate ? (
            <>
              <Spinner size="sm" className="me-1" />
              Adding...
            </>
          ) : (
            'Add Certificate'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );

  const handleRefresh = useCallback(async () => {
    const techId = getTechnicianRowIdForProfile(technician);
    if (!techId) return;
    setLoadingAssignments(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const assignmentsList = await fetchTechnicianAssignments(supabase, techId, {
        year: assignmentPeriodYear,
        month: assignmentPeriodMonth,
      });

      setAssignments(assignmentsList);
      toast.success('Assignments refreshed successfully');
    } catch (error) {
      console.error('Error refreshing assignments:', error);
      toast.error('Failed to refresh assignments');
    } finally {
      setLoadingAssignments(false);
    }
  }, [technician, assignmentPeriodYear, assignmentPeriodMonth]);

  // Memoize the columns definition
  const columns = React.useMemo(
    () => [
      {
        header: 'Job No',
        accessorKey: 'jobNo',
        cell: ({ row }) => (
          <div className="d-flex align-items-center">
            <span className="text-primary fw-medium">#{row.original.jobNo}</span>
            {getJobTypeIcon(row.original.jobType)}
          </div>
        ),
      },
      {
        header: 'Job Name',
        accessorKey: 'jobName',
      },
      {
        header: 'Customer',
        accessorKey: 'customerName',
      },
      {
        header: 'Status',
        accessorKey: 'jobStatus',
        cell: ({ row }) => {
          const status = row.original.jobStatus;
          if (!status) {
            return (
              <span className="badge bg-secondary" style={{ fontSize: '0.75rem' }}>
                N/A
              </span>
            );
          }
          const displayText = getJobStatusLabelFromList(status, jobStatuses);
          const bgColor = getJobStatusColorFromList(status, jobStatuses) ?? 'var(--bs-secondary)';
          return (
            <span
              className="badge"
              style={{
                fontSize: '0.75rem',
                padding: '0.35em 0.65em',
                fontWeight: '500',
                borderRadius: '6px',
                backgroundColor: bgColor,
                color: '#fff',
                border: 'none',
                display: 'inline-block',
                maxWidth: '100%',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                lineHeight: 1.25,
                textAlign: 'center',
              }}
            >
              {displayText}
            </span>
          );
        },
      },
      {
        header: 'Priority',
        accessorKey: 'priority',
        cell: ({ row }) => (
          row.original.priority && (
            <Badge
              bg={getPriorityColor(row.original.priority)}
              style={
                String(row.original.priority).trim().toUpperCase() === 'MEDIUM'
                  ? { color: '#000' }
                  : undefined
              }
            >
              {getPriorityDisplayLabel(row.original.priority)}
            </Badge>
          )
        ),
      },
      {
        header: 'Schedule',
        accessorKey: 'startDate',
        cell: ({ row }) => (
          <div className="d-flex flex-column">
            <span>{format(new Date(row.original.startDate), 'MMM d, yyyy')}</span>
            <small className="text-muted">
              {toTwelveHourTime(row.original.startTime) || row.original.startTime || '—'}
              {' - '}
              {toTwelveHourTime(row.original.endTime) || row.original.endTime || '—'}
            </small>
          </div>
        ),
      },
      {
        header: 'Period anchor',
        accessorKey: 'periodAnchorMs',
        cell: ({ row }) => {
          const ms = row.original.periodAnchorMs;
          if (!Number.isFinite(ms)) return <span className="text-muted">—</span>;
          return (
            <div className="d-flex flex-column">
              <span>{formatSingaporeDate(new Date(ms).toISOString())}</span>
              <small className="text-muted" title="Month bucket for incentive roll-up">
                Incentive month key
              </small>
            </div>
          );
        },
      },
      {
        header: 'Labor',
        accessorKey: 'laborHours',
        cell: ({ row }) => formatHours(row.original.laborHours || 0),
      },
      {
        header: 'Type',
        accessorKey: 'jobContactType',
        cell: ({ row }) => (
          row.original.jobContactType && (
            <Badge bg={getJobContactTypeColor(row.original.jobContactType)}>
              {row.original.jobContactType.name}
            </Badge>
          )
        ),
      },
      {
        header: 'Actions',
        id: 'actions',
        meta: { align: 'center' },
        cell: ({ row }) => (
          <Button
            variant="light"
            size="sm"
            href={`/dashboard/jobs/${row.original.jobNo}`}
            target="_blank"
            rel="noopener noreferrer"
            className="d-inline-flex align-items-center justify-content-center gap-2"
          >
            <Eye size={14} />
            View
          </Button>
        ),
      },
    ],
    [jobStatuses]
  );

  // Memoize the filtered data
  const laborPeriodLabel = useMemo(
    () => formatFsmPeriodLabel('M', assignmentPeriodYear, assignmentPeriodMonth),
    [assignmentPeriodYear, assignmentPeriodMonth]
  );

  const assignmentsInPeriod = assignments;

  const filteredData = React.useMemo(() => {
    return assignmentsInPeriod.filter(job => {
      const matchesStatus = !statusFilter || job.jobStatus === statusFilter;
      const matchesPriority = !priorityFilter || job.priority === priorityFilter;
      const matchesType = !typeFilter || job.jobContactType?.name === typeFilter;
      
      const matchesGlobal = !globalFilter || Object.values(job).some(value => 
        String(value).toLowerCase().includes(globalFilter.toLowerCase())
      );

      return matchesStatus && matchesPriority && matchesType && matchesGlobal;
    });
  }, [assignmentsInPeriod, statusFilter, priorityFilter, typeFilter, globalFilter]);

  const assignmentLaborTotalHours = React.useMemo(
    () => filteredData.reduce((sum, job) => sum + (job.laborHours || 0), 0),
    [filteredData]
  );

  const assignmentAllTimeLaborHours = React.useMemo(
    () => assignments.reduce((sum, job) => sum + (job.laborHours || 0), 0),
    [assignments]
  );

  const assignmentSummaryCounts = React.useMemo(() => {
    const assigned = filteredData.length;
    const completed = filteredData.filter((job) => {
      const label = getJobStatusLabelFromList(job.jobStatus, jobStatuses)
        .trim()
        .toLowerCase();
      return COMPLETED_ASSIGNMENT_STATUS_LABELS.has(label);
    }).length;
    return { assigned, completed };
  }, [filteredData, jobStatuses]);

  // Initialize table with memoized data
  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
    pageCount: Math.ceil(filteredData.length / pagination.pageSize),
  });

  // Render the assignments tab content
  const renderAssignmentsContent = () => {
    if (loadingAssignments) {
      return (
        <div className="text-center py-5">
          <Spinner animation="border" variant="primary" className="mb-2" />
          <div className="text-muted">Loading assignments...</div>
        </div>
      );
    }

    if (assignments.length === 0) {
      return (
        <div className="text-center py-5">
          <div className="mb-3">
            <Briefcase size={48} className="text-muted" />
          </div>
          <h6>No Assignments Found</h6>
          <p className="text-muted small">This technician has no job assignments yet</p>
        </div>
      );
    }

    if (filteredData.length === 0) {
      return (
        <div className="text-center py-5">
          <div className="mb-3">
            <Filter size={48} className="text-muted" />
          </div>
          <h6>No Matching Results</h6>
          <p className="text-muted small">Try adjusting your search or filters</p>
        </div>
      );
    }

    return (
      <>
        <Row className="g-3 mb-4">
          <Col md={4}>
            <Card className="border-0 bg-light h-100">
              <Card.Body className="py-3">
                <div className="text-muted small mb-1">Labor this month</div>
                <div className="fw-bold" style={{ fontSize: '1.25rem' }}>
                  {formatHours(assignmentLaborTotalHours)}
                </div>
                <div className="small text-muted">{laborPeriodLabel}</div>
                <div className="small text-muted mt-1">{assignments.length} total assignments (all time)</div>
              </Card.Body>
            </Card>
          </Col>
          <Col md={4}>
            <Card className="border-0 bg-light h-100">
              <Card.Body className="py-3">
                <div className="text-muted small mb-1">Jobs this month</div>
                <div className="fw-bold" style={{ fontSize: '1.25rem' }}>
                  {assignmentSummaryCounts.assigned}
                </div>
              </Card.Body>
            </Card>
          </Col>
          <Col md={4}>
            <Card className="border-0 bg-light h-100">
              <Card.Body className="py-3">
                <div className="text-muted small mb-1">Completed this month</div>
                <div className="fw-bold" style={{ fontSize: '1.25rem' }}>
                  {assignmentSummaryCounts.completed}
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th 
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`text-nowrap${header.column.columnDef.meta?.align === 'center' ? ' text-center' : ''}`}
                      style={{ cursor: 'pointer' }}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className={cell.column.columnDef.meta?.align === 'center' ? 'text-center' : undefined}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="d-flex justify-content-between align-items-center mt-3 px-2 flex-wrap gap-3">
          <small className="text-muted">
            Showing {table.getRowModel().rows.length} of {filteredData.length} assignments
            {" in "}
            {assignmentPeriodMonth}/{assignmentPeriodYear}
            {filteredData.length !== assignmentsInPeriod.length
              ? ` (${assignmentsInPeriod.length} in month before filters)`
              : null}
            {" · "}
            {assignments.length} total all-time
          </small>
          {table.getPageCount() > 1 && (
            <div className="d-flex align-items-center gap-2">
              <Pagination className="mb-0">
                <Pagination.First
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                />
                <Pagination.Prev
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                />
                {[...Array(table.getPageCount()).keys()].map((number) => (
                  <Pagination.Item
                    key={number + 1}
                    active={number === table.getState().pagination.pageIndex}
                    onClick={() => table.setPageIndex(number)}
                  >
                    {number + 1}
                  </Pagination.Item>
                ))}
                <Pagination.Next
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                />
                <Pagination.Last
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                />
              </Pagination>
            </div>
          )}
        </div>
      </>
    );
  };

  // Add these before the return statement
  const uniqueStatuses = useMemo(() => {
    if (!assignments) return [];
    const statuses = new Set(assignments.map(job => job.jobStatus).filter(Boolean));
    return Array.from(statuses);
  }, [assignments]);

  const uniquePriorities = useMemo(() => {
    if (!assignments) return [];
    const priorities = new Set(assignments.map(job => job.priority).filter(Boolean));
    return Array.from(priorities);
  }, [assignments]);

  const uniqueTypes = useMemo(() => {
    if (!assignments) return [];
    const types = new Set(assignments.map(job => job.jobContactType?.name).filter(Boolean));
    return Array.from(types);
  }, [assignments]);

  const scheduleNeedsConfiguration = useMemo(
    () => scheduleHasNoWorkingWindows(employeeSchedule),
    [employeeSchedule]
  );

  const handleEmployeeScheduleSubmit = async (scheduleData) => {
    if (!technician?.technicianId) {
      toast.error('Technician record not found');
      return;
    }

    const scheduleBefore = employeeScheduleAuditSnapshot(employeeSchedule);
    setSavingSchedule(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const savedSchedule = await replaceTechnicianSchedule(
        supabase,
        technician.technicianId,
        scheduleData
      );

      setEmployeeSchedule(savedSchedule);
      setSchedules(employeeScheduleToDetailSchedule(savedSchedule));
      invalidateWorkerCache(id);
      toast.success('Schedule saved successfully');
      void clientAuditLog({
        action: 'WORKER_UPDATE',
        category: 'worker',
        entityType: 'worker',
        entityId: technician?.technicianId || technician?.id,
        entityLabel: technician?.fullName || technician?.name,
        description: 'Worker schedule updated',
        details: { section: 'schedule' },
        changes: buildAuditChanges(
          { schedule: scheduleBefore },
          { schedule: employeeScheduleAuditSnapshot(savedSchedule) },
        ),
      });
    } catch (error) {
      console.error('Error saving schedule:', error);
      toast.error('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  };

  useEffect(() => {
    if (technician?.schedules) {
      setSchedules(technician.schedules);
    }
  }, [technician]);

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || !files.length) return;

    setUploadingDocument(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const uploadPromises = Array.from(files).map(async (file) => {
        const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
        const filePath = `technicians/${technician.technicianId}/${Date.now()}-${safeName}`;
        
        // Upload to Supabase Storage
        const result = await uploadFile('documents', filePath, file, { upsert: false });
        
        const document = await createTechnicianDocument(supabase, technician.technicianId, {
          document_type: file.type || 'Document',
          name: file.name,
          storage_bucket: 'documents',
          storage_path: result.path,
          file_url: result.url,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        });

        return mapStoredDocumentToDetailDocument(document);
      });

      const uploadedDocs = await Promise.all(uploadPromises);
      
      // Update local state
      setDocuments(prev => [...prev, ...uploadedDocs]);
      
      toast.success('Documents uploaded successfully');
      event.target.value = ''; // Reset file input
    } catch (error) {
      console.error('Error uploading documents:', error);
      toast.error('Failed to upload documents');
    } finally {
      setUploadingDocument(false);
    }
  };

  const handleDownload = async (document) => {
    try {
      window.open(document.url, '_blank');
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    }
  };

  const handleDeleteDocument = async (documentId) => {
    const document = documents.find(doc => doc.id === documentId);
    if (!document) return;

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      if (document.path) {
        await deleteFile('documents', document.path);
      }
      await deleteTechnicianDocument(supabase, documentId);

      // Update local state
      const updatedDocs = documents.filter(doc => doc.id !== documentId);
      setDocuments(updatedDocs);
      
      toast.success('Document deleted successfully');
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  useEffect(() => {
    if (technician?.documents) {
      setDocuments(technician.documents);
    }
  }, [technician]);

  useEffect(() => {
    if (!savingIncentiveRate) {
      setIncentiveRateInput(String(technician?.jobIncentiveHourlyRate ?? technician?.job_incentive_hourly_rate ?? 0));
    }
  }, [savingIncentiveRate, technician?.jobIncentiveHourlyRate, technician?.job_incentive_hourly_rate]);

  const handleSaveIncentiveRate = async () => {
    const nextRate = Number(incentiveRateInput);
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      toast.error('Enter a valid incentive rate');
      return;
    }

    if (!technician?.hasTechnicianRecord || !technician?.technicianId) {
      toast.error('This worker does not have a technician record to update');
      return;
    }

    const previousRate =
      technician?.jobIncentiveHourlyRate ?? technician?.job_incentive_hourly_rate ?? 0;

    setSavingIncentiveRate(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error: updateError } = await supabase
        .from('technicians')
        .update({
          job_incentive_hourly_rate: nextRate,
          updated_at: new Date().toISOString()
        })
        .eq('id', technician.technicianId);

      if (updateError) throw updateError;

      setTechnician(prev => ({
        ...prev,
        jobIncentiveHourlyRate: nextRate,
        job_incentive_hourly_rate: nextRate
      }));
      setAssignments(prev => prev.map(assignment => {
        const incentive = calculateTechnicianJobIncentive({
          started_at: assignment.startedAt,
          completed_at: assignment.completedAt,
          technician: {
            job_incentive_hourly_rate: nextRate,
          },
        });

        return {
          ...assignment,
          laborHours: incentive.laborHours,
          incentiveRate: incentive.incentiveRate,
          incentiveAmount: incentive.incentiveAmount,
          periodAnchorMs: assignment.periodAnchorMs,
        };
      }));
      invalidateWorkerCache(id);
      toast.success('Incentive rate updated');
      void clientAuditLog({
        action: 'WORKER_UPDATE',
        category: 'worker',
        entityType: 'worker',
        entityId: technician?.technicianId || technician?.id,
        entityLabel: technician?.fullName || technician?.name,
        description: 'Worker incentive rate updated',
        changes: {
          incentiveRate: { before: previousRate, after: nextRate },
        },
      });
    } catch (error) {
      console.error('Error saving incentive rate:', error);
      toast.error('Failed to save incentive rate');
    } finally {
      setSavingIncentiveRate(false);
    }
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh' }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  if (!technician) {
    return (
      <div className="text-center py-5">
        <h3>Technician not found</h3>
        <Link href="/workers">
          <Button variant="primary" className="mt-3">
            Back to Technicians List
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container-fluid px-4">
      {/* Header Section */}
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div
            style={{
              background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
              padding: "1.5rem 2rem",
              borderRadius: "0 0 24px 24px",
              marginTop: "-39px",
              marginLeft: "10px",
              marginRight: "10px",
              marginBottom: "20px",
            }}
          >
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: "28px",
                      fontWeight: "600",
                      color: "#FFFFFF",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    View Details for
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: "16px",
                      color: "rgba(255, 255, 255, 0.7)",
                      fontWeight: "400",
                      lineHeight: "1.5",
                    }}
                  >

                    View comprehensive technician details including personal info, certifications, assignments and performance history
                  </p>
                  
                </div>

                <div className="d-flex align-items-center gap-2 mb-4">
                  <span
                    className="badge"
                    style={{
                      background: "#FFFFFF",
                      color: "#4171F5",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontWeight: "500",
                      fontSize: "14px",
                    }}
                  >
                    Technician Management
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: "rgba(255, 255, 255, 0.2)",
                      color: "#FFFFFF",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      fontWeight: "500",
                      fontSize: "14px",
                    }}
                  >
                    <i className="fe fe-users me-1"></i>
                    Technicians
                  </span>
                </div>

                <nav style={{ fontSize: "14px", fontWeight: "500" }}>
                  <div className="d-flex align-items-center">
                    <i
                      className="fe fe-home"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    ></i>
                    <Link
                      href="/"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Dashboard
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <i
                      className="fe fe-users"
                      style={{ color: "#FFFFFF" }}
                    ></i>
                       <Link
                      href="/workers"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Technicians List
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <i
                      className="fe fe-users"
                      style={{ color: "#FFFFFF" }}
                    ></i>
                    <span className="ms-2" style={{ color: "#FFFFFF" }}>
                      View {technician.email || id}
                    </span>
                  </div>
                </nav>
              </div>

              <div>
                <OverlayTrigger
                  placement="left"
                  overlay={<Tooltip>Back to Technicians List</Tooltip>}
                >
                  <Link href="/workers">
                    <Button
                      variant="light"
                      className="create-technician-button"
                      style={{
                        border: "none",
                        borderRadius: "12px",
                        padding: "10px 20px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "all 0.2s ease",
                        fontWeight: "500",
                        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                      }}
                    >
                      <FaArrowLeft size={16} />
                      <span>Back to Technicians List</span>
                    </Button>
                  </Link>
                </OverlayTrigger>
              </div>
            </div>
          </div>
        </Col>
      </Row>
      {/* Profile Overview Card */}
      <Card className="border-0 shadow-sm mb-4">
        <Card.Body className="p-4">
          <div className="d-flex align-items-center gap-4">
            <div className="position-relative">
              <Image
                src={technician.profilePicture || '/images/avatar/NoProfile.png'}
                alt={technician.fullName}
                width={120}
                height={120}
                className="rounded-circle"
                style={{ 
                  objectFit: 'cover', 
                  border: '4px solid #fff',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = '/images/avatar/NoProfile.png';
                }}
              />
              <span 
                className={`position-absolute bottom-0 end-0 ${technician.showOnlineIndicator ? 'bg-success' : 'bg-secondary'}`}
                style={{ 
                  width: '20px', 
                  height: '20px', 
                  borderRadius: '50%', 
                  border: '3px solid #fff',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              />
            </div>

            <div className="flex-grow-1">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <h3 className="mb-1" style={{ fontSize: '1.75rem', fontWeight: '600' }}>
                    {technician.fullName}
                  </h3>
                  <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
                    <Badge
                      bg={workerRoleBadgeProps(technician.role).bg}
                      text={workerRoleBadgeProps(technician.role).text}
                      className="px-3 py-2"
                      style={{ fontSize: '0.75rem', fontWeight: '500' }}
                    >
                      {formatWorkerRoleLabel(technician.role)}
                    </Badge>
                    <Badge
                      bg={technician.isActive ? 'success' : 'danger'}
                      className="px-3 py-2"
                      style={{ fontSize: '0.75rem', fontWeight: '500' }}
                    >
                      {technician.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div className="d-flex gap-4 mt-3">
                    <div className="d-flex align-items-center text-muted">
                      <Mail size={18} className="me-2" />
                      {technician.email}
                    </div>
                    <div className="d-flex align-items-center text-muted">
                      <Phone size={18} className="me-2" />
                      {technician.primaryPhone || technician.phoneNumber}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline-primary"
                  className="d-flex align-items-center gap-2"
                  onClick={() => router.push(`/workers/edit-worker/${technician.workerId || technician.id}`)}
                  style={{
                    padding: '0.625rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Edit3 size={16} />
                  Edit Profile
                </Button>
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
      {/* Tabs Navigation */}
      <Tab.Container activeKey={activeTab} onSelect={handleTabSelect}>
        <Card className="border-0 shadow-sm mb-4 overflow-hidden">
          <Card.Header className="bg-white border-bottom px-3 px-sm-4 pt-3 pb-0">
            <Nav variant="tabs" className="technician-profile-tabs border-0 flex-nowrap">
              <Nav.Item>
                <Nav.Link
                  eventKey="overview"
                  className="px-4 py-3 d-flex align-items-center gap-2"
                >
                  <User size={18} />
                  Overview
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  eventKey="skills"
                  className="px-4 py-3 d-flex align-items-center gap-2"
                >
                  <Award size={18} />
                  Skills & Expertise
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  eventKey="assignments"
                  className="px-4 py-3 d-flex align-items-center gap-2"
                >
                  <Briefcase size={18} />
                  Job Assignments
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  eventKey="schedule"
                  className="px-4 py-3 d-flex align-items-center gap-2"
                >
                  <Calendar size={18} />
                  Employee Schedule
                  {scheduleNeedsConfiguration && (
                    <Badge bg="warning" text="dark" className="ms-1" title="No working hours configured">
                      !
                    </Badge>
                  )}
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link
                  eventKey="documents"
                  className="px-4 py-3 d-flex align-items-center gap-2"
                >
                  <FileText size={18} />
                  Documents
                </Nav.Link>
              </Nav.Item>
            </Nav>
          </Card.Header>
          <Card.Body className="p-4">
        <Tab.Content>
          <Tab.Pane eventKey="overview">
            <Row>
              <Col lg={8}>
                {/* Personal Information Card */}
                <Card className="border-0 shadow-sm mb-4">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <h5 className="mb-0">Personal Information</h5>
                        <small className="text-muted">Basic technician details and contact information</small>
                      </div>
                      <Badge 
                        className="profile-badge"
                        style={{
                          background: 'linear-gradient(45deg, #3b82f6, #60a5fa)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                        }}
                      >
                        <i className="fe fe-user"></i>
                        Profile Details
                      </Badge>
                    </div>
                  </Card.Header>
                  <Card.Body className="pt-4">
                    <div className="info-grid">
                      <div className="info-section">
                        <div className="info-items">
                          <div className="info-card">
                            <div className="info-icon">
                              <User size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Full Name</div>
                              <div className="info-value">{technician.fullName}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <Mail size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Email</div>
                              <div className="info-value">{technician.email || '—'}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <Calendar size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Date of Birth</div>
                              <div className="info-value">{technician.dateOfBirth ? format(new Date(technician.dateOfBirth), 'MMMM d, yyyy') : 'Not specified'}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <User size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Gender</div>
                              <div className="info-value" style={{ textTransform: 'capitalize' }}>{technician.gender || 'Not specified'}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <Hash size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Technician ID</div>
                              <div className="info-value" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem' }}>{technician.technicianId}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <Phone size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Primary Phone</div>
                              <div className="info-value">{technician.primaryPhone || technician.phoneNumber || 'Not specified'}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <CreditCard size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">NRIC/FIN/Work Permit Number</div>
                              <div className="info-value">{technician.nricFinWorkPermitNumber || 'Not specified'}</div>
                            </div>
                          </div>
                          <div className="info-card">
                            <div className="info-icon">
                              <CalendarDays size={20} />
                            </div>
                            <div className="info-content">
                              <div className="info-label">Work Permit Expiry Date</div>
                              <div className="info-value">{technician.workPermitExpiryDate ? format(new Date(technician.workPermitExpiryDate), 'MMMM d, yyyy') : 'Not specified'}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card.Body>
                </Card>

                {/* Emergency Contact Card */}
                <Card className="border-0 shadow-sm mb-4">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <h5 className="mb-0">Emergency Contact</h5>
                        <small className="text-muted">Emergency contact information</small>
                      </div>
                      <Badge 
                        className="emergency-badge"
                        style={{
                          background: 'linear-gradient(45deg, #ef4444, #f87171)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                        }}
                      >
                        <i className="fe fe-alert-circle"></i>
                        Emergency Contact
                      </Badge>
                    </div>
                  </Card.Header>
                  <Card.Body className="pt-4">
                    <div className="emergency-container">
                      <div className="emergency-items">
                        <div className="emergency-card">
                          <div className="emergency-icon">
                            <i className="fe fe-user"></i>
                          </div>
                          <div className="emergency-content">
                            <div className="emergency-label">Contact Name</div>
                            <div className="emergency-value">{technician.emergencyContactName || 'Not specified'}</div>
                          </div>
                        </div>
                        <div className="emergency-card">
                          <div className="emergency-icon">
                            <i className="fe fe-users"></i>
                          </div>
                          <div className="emergency-content">
                            <div className="emergency-label">Relationship</div>
                            <div className="emergency-value">{technician.emergencyRelationship || 'Not specified'}</div>
                          </div>
                        </div>
                        <div className="emergency-card">
                          <div className="emergency-icon">
                            <i className="fe fe-phone"></i>
                          </div>
                          <div className="emergency-content">
                            <div className="emergency-label">Emergency Phone</div>
                            <div className="emergency-value">{technician.emergencyContactPhone || 'Not specified'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>

              <Col lg={4}>
                {/* Account Status Card */}
                <Card className="border-0 shadow-sm mb-4">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <h5 className="mb-0">Account Status</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="status-item mb-4">
                      <div className="d-flex align-items-center mb-2">
                        <Activity size={16} className="text-primary me-2" />
                        <div className="text-muted">Account Status</div>
                      </div>
                      <Badge 
                        bg={technician.isActive ? 'success' : 'danger'}
                        className="status-badge"
                      >
                        {technician.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>

                    <div className="status-item mb-4">
                      <div className="d-flex align-items-center mb-2">
                        <Shield size={16} className="text-primary me-2" />
                        <div className="text-muted">Role & Access</div>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        <Badge
                          {...workerRoleBadgeProps(technician.role)}
                          className="role-badge"
                        >
                          {formatWorkerRoleLabel(technician.role)}
                        </Badge>
                      </div>
                    </div>

                    <div className="status-item">
                      <div className="d-flex align-items-center mb-2">
                        <Clock size={16} className="text-primary me-2" />
                        <div className="text-muted">Last Active</div>
                      </div>
                      <div className="d-flex align-items-center">
                        <div
                          className={`rounded-circle me-2 flex-shrink-0 ${
                            technician.showOnlineIndicator ? 'bg-success' : 'bg-secondary'
                          }`}
                          style={{ width: 10, height: 10 }}
                          title={
                            technician.isClockedIn
                              ? 'Clocked in (field app)'
                              : technician.isOnline
                                ? 'Online'
                                : 'Not on the clock'
                          }
                        />
                        <div>
                          {technician.lastActiveAt
                            ? format(new Date(technician.lastActiveAt), 'PPpp')
                            : 'Never'}
                          {technician.isClockedIn ? (
                            <div className="small text-success mt-1">Clocked in</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Card.Body>
                </Card>

            {/* Skills Summary Card */}
            <Card className="border-0 shadow-sm">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <h5 className="mb-0">Skills Overview</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="skills-grid">
                      {technician.skills?.map((skill, index) => (
                        <Badge 
                          key={index}
                          className="skill-badge"
                          bg="light"
                          text="dark"
                        >
                          <CircleCheck size={14} className="text-primary me-1 flex-shrink-0" aria-hidden />
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

          </Tab.Pane>

          <Tab.Pane eventKey="skills">
            <Row>
              <Col lg={8}>
                {/* Skills Card */}
                <Card className="border-0 shadow-sm mb-4">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <h5 className="mb-0">Skills & Expertise</h5>
                        <small className="text-muted">Manage technician&apos;s professional skills and competencies</small>
                      </div>
                      <Badge 
                        className="profile-badge"
                        style={{
                          background: 'linear-gradient(45deg, #3b82f6, #60a5fa)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                        }}
                      >
                        <Award size={14} className="flex-shrink-0" aria-hidden />
                        Skills Management
                      </Badge>
                    </div>
                  </Card.Header>
                  <Card.Body className="pt-4">
                    {/* Add Skill Input */}
                    <div className="mb-4 p-3" style={{ background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                      <Form.Group>
                        <Form.Label style={{ fontSize: '14px', fontWeight: '500', color: '#64748b' }}>Add New Skill</Form.Label>
                        <div className="d-flex gap-2">
                          <Form.Control
                            type="text"
                            placeholder="Type skill name here..."
                            value={newSkill}
                            onChange={(e) => setNewSkill(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newSkill.trim()) {
                                e.preventDefault();
                                handleAddSkill();
                              }
                            }}
                            style={{
                              fontSize: '14px',
                              padding: '10px 16px',
                              borderRadius: '8px',
                              maxWidth: '300px',
                              border: '1px solid #e2e8f0'
                            }}
                          />
                          <Button 
                            variant="primary"
                            onClick={handleAddSkill}
                            disabled={!newSkill.trim() || addingSkill}
                            style={{ 
                              padding: '10px 20px', 
                              borderRadius: '8px',
                              background: 'linear-gradient(45deg, #3b82f6, #60a5fa)',
                              border: 'none',
                              boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                            }}
                          >
                            {addingSkill ? (
                              <>
                                <Spinner size="sm" className="me-2" />
                                Adding...
                              </>
                            ) : (
                              <>
                                <Plus size={16} className="me-2" />
                                Add Skill
                              </>
                            )}
                          </Button>
                        </div>
                        <small className="text-muted mt-2 d-block">
                          Press Enter or click Add button to add the skill
                        </small>
                      </Form.Group>
                    </div>

                    {/* Skills List */}
                    <div className="skills-grid">
                      {technician.skills?.map((skill, index) => (
                        <div 
                          key={index}
                          className="skill-badge-item"
                        >
                          <div className="skill-badge-content">
                            <div className="skill-icon">
                              <CircleCheck size={16} strokeWidth={2} aria-hidden />
                            </div>
                            <span className="skill-name">{skill}</span>
                          </div>
                          <Button
                            variant="link"
                            className="remove-skill-btn"
                            title="Remove skill"
                            aria-label={`Remove skill ${skill}`}
                            onClick={async () => {
                              const techRowId = getTechnicianRowIdForProfile(technician);
                              if (!techRowId) {
                                toast.error('No technician profile is linked. Cannot remove skill.');
                                return;
                              }
                              try {
                                const supabase = getSupabaseClient();
                                if (!supabase) {
                                  throw new Error('Supabase client not available');
                                }

                                const currentSkills = normalizeSkillsList(technician?.skills);
                                const updatedSkills = currentSkills.filter((s) => s !== skill);

                                const { data: updatedRows, error: updateError } = await supabase
                                  .from('technicians')
                                  .update({
                                    skills: updatedSkills,
                                    updated_at: new Date().toISOString(),
                                  })
                                  .eq('id', techRowId)
                                  .select('id');

                                if (updateError) {
                                  throw updateError;
                                }
                                if (!updatedRows?.length) {
                                  throw new Error('Update did not match a technician row.');
                                }

                                setTechnician((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        skills: updatedSkills,
                                      }
                                    : prev
                                );

                                toast.success('Skill removed successfully');
                              } catch (error) {
                                console.error('Error removing skill:', error);
                                toast.error(
                                  error?.message
                                    ? `Failed to remove skill: ${error.message}`
                                    : 'Failed to remove skill'
                                );
                              }
                            }}
                          >
                            <LucideX size={18} strokeWidth={2.25} aria-hidden />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </Card.Body>
                </Card>


              </Col>

              <Col lg={4}>
                {/* Skills Summary Card 2 */}
                <Card className="border-0 shadow-sm mb-4">
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                    <h5 className="mb-0">Skills Overview</h5>
                  </Card.Header>
                  <Card.Body>
                    <div className="text-center mb-4">
                      <div style={{ fontSize: '2.5rem', fontWeight: '600', color: '#3b82f6' }}>
                        {technician.skills?.length || 0}
                      </div>
                      <div className="text-muted" style={{ fontSize: '16px' }}>Total Skills</div>
                    </div>
                    <div className="skills-info p-3" style={{ background: '#f8fafc', borderRadius: '12px' }}>
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <Info size={18} className="text-primary flex-shrink-0" aria-hidden />
                        <span style={{ fontSize: '14px', fontWeight: '500' }}>Quick Guide</span>
                      </div>
                      <ul className="list-unstyled mb-0" style={{ fontSize: '14px' }}>
                        <li className="mb-2">• Click &quot;Add New Skill&quot; to add skills</li>
                        <li className="mb-2">• Click the (×) button to remove skills</li>
                        <li>• Skills are shown on technician&apos;s profile</li>
                      </ul>
                    </div>
                  </Card.Body>
                </Card>

            
              </Col>
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="assignments">
            <Row>
              <Col lg={12}>
                <Card className="border-0 shadow-sm mb-4">
              
                  <Card.Header className="bg-transparent border-0 pt-4 pb-0 d-flex justify-content-between align-items-center">
                    <div>
                      <h5 className="mb-0">Job Assignments</h5>
                      <p className="text-muted small mb-0">View all assigned jobs and schedules</p>
                    </div>
                   
                      <Badge 
                        className="profile-badge"
                        style={{
                          background: 'linear-gradient(45deg, #3b82f6, #60a5fa)',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                        }}
                      >
                        <i className="fe fe-award"></i>
                        Job Assignments
                      </Badge>
                  </Card.Header>

                  <Card.Body>
                    {/* Filter Panel */}
                    <div className="filter-panel bg-light p-3 rounded-3 mb-3">
                      <div className="d-flex align-items-center gap-3 flex-wrap">
                        <div style={{ width: '88px' }}>
                          <Form.Label className="small mb-1">Year</Form.Label>
                          <Form.Control
                            type="number"
                            size="sm"
                            value={assignmentPeriodYear}
                            onChange={(e) =>
                              setAssignmentPeriodYear(parseInt(e.target.value, 10) || assignmentPeriodYear)
                            }
                          />
                        </div>
                        <div style={{ width: '88px' }}>
                          <Form.Label className="small mb-1">Month</Form.Label>
                          <Form.Select
                            size="sm"
                            value={assignmentPeriodMonth}
                            onChange={(e) => setAssignmentPeriodMonth(parseInt(e.target.value, 10))}
                          >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </Form.Select>
                        </div>

                        {/* Search - wider */}
                        <div style={{ flex: '1' }}>
                          <div className="position-relative">
                            <Search 
                              size={16} 
                              className="position-absolute top-50 start-0 translate-middle-y ms-3 text-muted"
                            />
                            <DebouncedInput
                              value={globalFilter ?? ''}
                              onChange={value => setGlobalFilter(String(value))}
                              className="form-control form-control-sm ps-5"
                              placeholder="Search jobs..."
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>

                        {/* Status Filter - smaller */}
                        <div style={{ width: '140px' }}>
                          <Form.Select 
                            size="sm"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                          >
                            <option value="">All Status</option>
                            {uniqueStatuses.map((status) => (
                              <option key={status} value={status}>
                                {getJobStatusLabelFromList(status, jobStatuses)}
                              </option>
                            ))}
                          </Form.Select>
                        </div>

                        {/* Priority Filter - smaller */}
                        <div style={{ width: '140px' }}>
                          <Form.Select
                            size="sm"
                            value={priorityFilter}
                            onChange={e => setPriorityFilter(e.target.value)}
                          >
                            <option value="">All Priority</option>
                            {uniquePriorities.map((priority) => (
                              <option key={priority} value={priority}>
                                {getPriorityDisplayLabel(priority)}
                              </option>
                            ))}
                          </Form.Select>
                        </div>

                        {/* Type Filter - smaller */}
                        <div style={{ width: '140px' }}>
                          <Form.Select
                            size="sm"
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value)}
                          >
                            <option value="">All Types</option>
                            {uniqueTypes.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </Form.Select>
                        </div>
                      </div>
                      <div className="small text-muted mt-2">
                        Month filter uses period anchor (completion / start / schedule), same as Job Incentives — {laborPeriodLabel}
                      </div>
                    </div>

                    {renderAssignmentsContent()}
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </Tab.Pane>

          <Tab.Pane eventKey="schedule">
            <Card className="border-0 shadow-sm mb-4">
              <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div>
                    <h5 className="mb-0">Upcoming leave</h5>
                    <small className="text-muted">Next 90 days from company calendar</small>
                  </div>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => setShowLeaveForm(true)}
                    disabled={!technician?.technicianId}
                  >
                    Add leave
                  </Button>
                </div>
              </Card.Header>
              <Card.Body>
                {loadingUpcomingLeave ? (
                  <div className="text-muted small d-flex align-items-center gap-2">
                    <Spinner size="sm" animation="border" />
                    Loading leave…
                  </div>
                ) : upcomingLeave.length === 0 ? (
                  <p className="text-muted mb-0 small">No upcoming leave recorded.</p>
                ) : (
                  <Table responsive size="sm" className="mb-0">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Type</th>
                        <th>Dates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingLeave.map((event) => (
                        <tr key={event.id}>
                          <td>{event.title}</td>
                          <td>
                            <Badge bg="info" style={{ fontSize: 10 }}>
                              {event.eventType}
                            </Badge>
                          </td>
                          <td>
                            {event.startDate === event.endDate
                              ? event.startDate
                              : `${event.startDate} – ${event.endDate}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
            <EmployeeScheduleTab
              initialValues={employeeSchedule}
              onSubmit={handleEmployeeScheduleSubmit}
              disabled={savingSchedule}
            />
            <CalendarEventForm
              show={showLeaveForm}
              onHide={() => setShowLeaveForm(false)}
              onSaved={() => {
                setShowLeaveForm(false);
                loadUpcomingLeave();
                toast.success('Leave saved');
              }}
              technicians={
                technician?.technicianId
                  ? [{ id: technician.technicianId, text: technician.name || technician.fullName }]
                  : []
              }
              presetTechnicianId={technician?.technicianId || null}
              presetScope="technician"
            />
          </Tab.Pane>

          <Tab.Pane eventKey="documents">
            <Card className="border-0 shadow-sm mb-4">
              <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <h5 className="mb-0">Documents</h5>
                    <small className="text-muted">Manage technician&apos;s documents and files</small>
                  </div>
                  <div className="d-flex gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                      multiple
                    />
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="d-flex align-items-center gap-2"
                      disabled={uploadingDocument}
                    >
                      {uploadingDocument ? (
                        <>
                          <Spinner size="sm" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload size={16} />
                          Upload Document
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Card.Header>
              <Card.Body>
                {documents.length === 0 ? (
                  <div className="text-center py-5">
                    <FileText size={48} className="text-muted mb-3" />
                    <h6>No Documents Yet</h6>
                    <p className="text-muted">Upload technician documents like contracts, certificates, or IDs</p>
                  </div>
                ) : (
                  <div className="documents-grid">
                    {documents.map((doc, index) => (
                      <div key={index} className="document-card">
                        <div className="document-icon">
                          <FileText size={24} />
                        </div>
                        <div className="document-info">
                          <h6>{doc.name}</h6>
                          <small className="text-muted">
                            Uploaded on {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
                          </small>
                        </div>
                        <div className="document-actions">
                          <Button
                            variant="link"
                            className="p-0 text-primary"
                            onClick={() => handleDownload(doc)}
                          >
                            <Download size={16} />
                          </Button>
                          <Button
                            variant="link"
                            className="p-0 text-danger"
                            onClick={() => handleDeleteDocument(doc.id)}
                          >
                            <Trash size={16} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card.Body>
            </Card>
          </Tab.Pane>
        </Tab.Content>
          </Card.Body>
        </Card>
      </Tab.Container>
      <style jsx global>{`
          .technician-profile-tabs {
            border-bottom: 1px solid #e2e8f0;
          }

          .technician-profile-tabs .nav-link {
            color: #64748b;
            border: none;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: all 0.2s ease;
            font-weight: 500;
            background-color: transparent;
          }

          .technician-profile-tabs .nav-link:hover {
            color: #3b82f6;
            border-color: transparent;
            background-color: #f8fafc;
          }

          .technician-profile-tabs .nav-link.active {
            color: #3b82f6;
            border-bottom: 2px solid #3b82f6;
            background-color: #ffffff;
          }

         /* Card Styles */
  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .info-items {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .info-card {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem;
    background: #f8fafc;
    border-radius: 12px;
    transition: all 0.2s ease;
    border: 1px solid #e2e8f0;
  }

  .info-card:hover {
    background: #f1f5f9;
    transform: translateY(-2px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  }

  .info-card.full-width {
    grid-column: 1 / -1;
  }

  .info-icon {
    width: 40px;
    height: 40px;
    min-width: 40px;
    border-radius: 10px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 1.2rem;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
    flex-shrink: 0;
  }

  .info-icon svg {
    width: 20px;
    height: 20px;
    stroke-width: 2;
  }

  .info-content {
    flex: 1;
  }

  .info-label {
    font-size: 0.75rem;
    color: #64748b;
    margin-bottom: 0.25rem;
    font-weight: 500;
  }

  .info-value {
    color: #1e293b;
    font-weight: 500;
    font-size: 0.9375rem;
  }

  /* Emergency Contact Styles */
  .emergency-container {
    background: #fef2f2;
    border: 1px dashed #fca5a5;
    border-radius: 12px;
    padding: 1.5rem;
  }

  .emergency-items {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .emergency-card {
    background: white;
    padding: 1.25rem;
    border-radius: 12px;
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    transition: all 0.2s ease;
    border: 1px solid #fee2e2;
  }

  .emergency-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  }

  .emergency-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: #fee2e2;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #dc2626;
    font-size: 1.2rem;
  }

  .emergency-content {
    flex: 1;
  }

  .emergency-label {
    font-size: 0.75rem;
    color: #64748b;
    margin-bottom: 0.25rem;
    font-weight: 500;
  }

  .emergency-value {
    color: #1e293b;
    font-weight: 500;
    font-size: 0.9375rem;
  }

  /* Skills & Certifications Styles */
  .certificates-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-top: 1rem;
  }

  .certificate-card {
    background: white;
    border-radius: 12px;
    transition: all 0.3s ease;
  }

  .certificate-content {
    padding: 1.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    height: 100%;
  }

  .certificate-card:hover .certificate-content {
    border-color: #cbd5e1;
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
  }

  .certificate-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .certificate-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 0.5rem;
  }

  .certificate-issuer {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .certificate-id {
    background: #f8fafc;
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    border: 1px dashed #cbd5e1;
  }

  .certificate-id code {
    display: block;
    color: #3b82f6;
    font-family: monospace;
    font-size: 0.875rem;
  }

  .certificate-dates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f8fafc;
    border-radius: 8px;
  }

  .date-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .date-item i,
  .date-item svg {
    padding: 0.5rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .certificate-status {
    position: absolute;
    bottom: 2rem;
    right: 2rem;
  }

  .certificate-status .badge {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  /* Skills Summary Styles */
  .skills-info {
    background: #f8fafc;
    border-radius: 12px;
    padding: 1.5rem;
    margin-top: 1rem;
  }

  .skills-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .skill-badge-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .skill-badge-item:hover {
    background: #f8fafc;
    transform: translateX(4px);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  }

  .skill-badge-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: #1e293b;
  }

  .skill-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e2e8f0;
    border-radius: 6px;
    color: #3b82f6;
  }

  .skill-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: #334155;
  }

  .remove-skill-btn {
    color: #64748b;
    padding: 4px;
    font-size: 18px;
    opacity: 0.85;
    transition: color 0.2s ease, transform 0.2s ease;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none !important;
  }

  .skill-badge-item:hover .remove-skill-btn {
    opacity: 1;
    color: #475569;
  }

  .remove-skill-btn:hover {
    color: #ef4444 !important;
    transform: scale(1.08);
  }

  /* Certificate Styles */
  .certificates-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
    padding: 1rem 0;
  }

  .certificate-card {
    perspective: 1000px;
    height: 100%;
  }

  .certificate-content {
    position: relative;
    background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
    border: 2px solid #e2e8f0;
    border-radius: 16px;
    padding: 2rem;
    transition: all 0.3s ease;
    transform-style: preserve-3d;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
  }

  .certificate-card:hover .certificate-content {
    transform: rotateX(5deg) rotateY(5deg);
    box-shadow: 0 20px 30px rgba(0, 0, 0, 0.1);
    border-color: #cbd5e1;
  }

  .certificate-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #f1f5f9;
  }

  .certificate-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 0.5rem;
    letter-spacing: -0.02em;
  }

  .certificate-issuer {
    margin-bottom: 1.5rem;
  }

  .certificate-issuer strong {
    display: block;
    color: #0f172a;
    font-size: 1rem;
    margin-top: 0.25rem;
  }

  .certificate-id {
    background: #f8fafc;
    padding: 1rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    border: 1px dashed #cbd5e1;
  }

  .certificate-id code {
    display: block;
    color: #3b82f6;
    font-family: monospace;
    font-size: 0.875rem;
  }

  .certificate-dates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: #f8fafc;
    border-radius: 8px;
  }

  .date-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .remove-cert-btn {
    opacity: 0;
    transition: all 0.2s ease;
    font-size: 1.25rem;
  }

  .certificate-item:hover .remove-cert-btn {
    opacity: 1;
  }

  .remove-cert-btn:hover {
    transform: scale(1.1);
  }

  @media (max-width: 768px) {
    .certificate-dates {
      grid-template-columns: 1fr;
    }
  }

  /* Table Styles */
  .table {
    margin-bottom: 0;
  }

  .table th {
    font-weight: 600;
    background: #f8fafc;
    padding: 1rem;
    font-size: 0.875rem;
    color: #64748b;
  }

  .table td {
    padding: 1rem;
    vertical-align: middle;
    font-size: 0.875rem;
  }

  .table tbody tr {
    transition: all 0.2s ease;
  }

  .table tbody tr:hover {
    background-color: #f8fafc;
  }

  .table-responsive {
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  /* Filter Styles */
  .form-control, .form-select {
    font-size: 0.875rem;
    border-color: #e2e8f0;
    background-color: #fff;
  }

  .form-control:focus, .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 0.2rem rgba(59, 130, 246, 0.25);
  }

  .form-select {
    padding-right: 2rem;
    background-position: right 0.5rem center;
  }

  /* Table Footer Styles */
  .table-footer {
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    padding: 0.75rem 1rem;
    font-size: 0.875rem;
  }

  /* Search Input Styles */
  .search-input {
    padding-left: 2.5rem;
    padding-right: 1rem;
    border-radius: 0.375rem;
  }

  .search-icon {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: #94a3b8;
  }

  .filter-panel {
    border: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .filter-panel .form-control,
  .filter-panel .form-select {
    border: 1px solid #e2e8f0;
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
  }

  .filter-panel .form-control:focus,
  .filter-panel .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  }

  .filter-panel .form-select {
    background-color: white;
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .filter-panel .d-flex {
      flex-direction: column;
    }

    .filter-panel .form-control,
    .filter-panel .form-select {
      width: 100% !important;
    }
  }
`}</style>
    </div>
  );
};


export default TechnicianDetails; 