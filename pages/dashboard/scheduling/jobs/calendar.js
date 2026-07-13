import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "react-query";
import { getSupabaseClient } from "../../../../lib/supabase/client";
import { computeSchedulerFetchRange } from "../../../../lib/scheduler/schedulerFetchRange";
import {
  Row,
  Col,
  Card,
  Image,
  OverlayTrigger,
  Tooltip,
  Breadcrumb,
  ListGroup,
  Spinner,
  Dropdown,
  Form,
} from "react-bootstrap";
import { Scheduler } from "@aldabil/react-scheduler";
import {
  BsClock,
  BsFillPersonFill,
  BsGeoAlt,
  BsCalendarCheck,
  BsBuilding,
  BsTools,
  BsX,
  BsThreeDotsVertical,
  BsArrowRepeat,
  BsArrowRight,
  BsSearch,
} from "react-icons/bs";
import styles from "./calendar.module.css";
import { useRouter } from "next/router";
import truncate from "html-truncate";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Swal from "sweetalert2";
import format from "date-fns/format";
import Legend from "./legends";
import { Plus } from 'react-feather';
import Link from 'next/link';
import { Button } from 'react-bootstrap';
import { FaPlus } from 'react-icons/fa';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { GeeksSEO } from "widgets";
import { DashboardHeader } from "sub-components";
import { BsBriefcaseFill, BsCheckCircleFill } from "react-icons/bs";
import PortalModal from "../../../../components/portal/PortalModal";
import JobRecurrenceModal from "../../../../sub-components/dashboard/jobs/_components/JobRecurrenceModal";
import {
  formatRecurrenceStartDate,
  generateOccurrenceDateRanges,
  getDefaultRecurrenceRule,
} from "../../../../lib/jobs/recurrence";
import { createRepeatSiblingJobs } from "../../../../lib/jobs/repeatJobExtend";
import { useJobsCalendarQuery } from "../../../../hooks/queries/useJobsCalendarQuery";
import { queryKeys } from "../../../../lib/cache/queryKeys";

const DEFAULT_LEGEND_ITEMS = [
  { id: 'created', status: "Created", color: "#9e9e9e" },
  { id: 'confirmed', status: "Confirmed", color: "#2196f3" },
  { id: 'cancelled', status: "Cancelled", color: "#f44336" },
  { id: 'started', status: "Job Started", color: "#FFA500" },
  { id: 'complete', status: "Job Complete", color: "#32CD32" },
  { id: 'validate', status: "Validate", color: "#00bcd4" },
  { id: 'scheduled', status: "Scheduled", color: "#607d8b" }
];

const Calendar = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const [searchTerm, setSearchTerm] = useState("");
  const [legendItems, setLegendItems] = useState(DEFAULT_LEGEND_ITEMS);
  const [editingLegendId, setEditingLegendId] = useState(null);
  const [defaultStatus, setDefaultStatus] = useState(legendItems[0]?.id);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedJobEvent, setSelectedJobEvent] = useState(null);
  const [showJobActionModal, setShowJobActionModal] = useState(false);
  const [showRepeatModal, setShowRepeatModal] = useState(false);
  const [repeatJobEvent, setRepeatJobEvent] = useState(null);
  const [repeatRule, setRepeatRule] = useState(null);
  const [isCreatingRepeatJobs, setIsCreatingRepeatJobs] = useState(false);

  // Create a stable toast configuration
  const toastConfig = {
    position: "top-right",
    autoClose: 3000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
    draggable: true,
    progress: undefined,
    theme: "light"
  };

  // Create a stable showToast function with useCallback
  const showToast = useCallback((message, type = 'success') => {
    if (!message) return;

    try {
      switch (type) {
        case 'success':
          toast.success(message, toastConfig);
          break;
        case 'error':
          toast.error(message, toastConfig);
          break;
        default:
          toast.info(message, toastConfig);
      }
    } catch (error) {
      console.error('Toast error:', error);
    }
  }, []);

  const getStatusColor = useCallback((status, items = legendItems) => {
    const legendItem = items.find(item => 
      item.status.toLowerCase() === status.toLowerCase()
    );
    return legendItem 
      ? { backgroundColor: legendItem.color, color: '#fff' }
      : { backgroundColor: '#9e9e9e', color: '#fff' };
  }, [legendItems]);

  const fetchRange = useMemo(
    () => computeSchedulerFetchRange("month", selectedDate),
    [selectedDate]
  );
  const calendarRange = useMemo(
    () => ({ rangeStart: fetchRange.start, rangeEnd: fetchRange.end }),
    [fetchRange.start, fetchRange.end]
  );

  const {
    data: calendarPayload,
    isLoading: calendarLoading,
    isError: calendarIsError,
    error: calendarError,
  } = useJobsCalendarQuery(calendarRange);

  const hydrateCalendarEvents = useCallback(
    (apiEvents = []) =>
      apiEvents.map((event) => {
        const start = new Date(event.start);
        const end = new Date(event.end);
        const startTime = new Date(event.StartTime || event.start);
        const endTime = new Date(event.EndTime || event.end);
        return {
          ...event,
          start,
          end,
          StartTime: startTime,
          EndTime: endTime,
          color: getStatusColor(event.JobStatus || "Created").backgroundColor,
        };
      }),
    [getStatusColor]
  );

  const events = useMemo(
    () => hydrateCalendarEvents(calendarPayload?.events || []),
    [calendarPayload?.events, hydrateCalendarEvents]
  );

  const stats = useMemo(() => {
    const totalJobs = calendarPayload?.stats?.totalJobs ?? events.length;
    const activeJobs =
      calendarPayload?.stats?.activeJobs ??
      events.filter((job) => {
        const status = String(job.JobStatus || "").toLowerCase();
        return (
          status === "inprogress" ||
          status === "in progress" ||
          status === "started"
        );
      }).length;
    return { totalJobs, activeJobs };
  }, [calendarPayload, events]);

  const filteredEvents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return events;
    return events.filter(
      (event) =>
        event.Subject.toLowerCase().includes(term) ||
        event.JobNo.toLowerCase().includes(term) ||
        event.Customer.toLowerCase().includes(term) ||
        event.ServiceLocation.toLowerCase().includes(term)
    );
  }, [events, searchTerm]);

  useEffect(() => {
    if (calendarIsError && calendarError) {
      console.error("Error fetching job calendar events:", calendarError);
      showToast(
        `Failed to fetch jobs: ${calendarError?.message || "Unknown error"}`,
        "error"
      );
    }
  }, [calendarIsError, calendarError, showToast]);

  const invalidateCalendarQuery = useCallback(() => {
    void queryClient.invalidateQueries(queryKeys.jobsCalendar(calendarRange));
  }, [queryClient, calendarRange]);

  const createJobUpdateNotification = async (jobId, subject, updateType) => {
    // TODO: Implement notification creation in Supabase if needed
    // For now, we'll skip notifications to focus on core calendar functionality
    console.log(`Job ${jobId} (${subject}) was updated (${updateType})`);
  };

  const handleEventDrop = async (droppedOn, updatedEvent, originalEvent) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      const updatedStartTime = new Date(updatedEvent.start);
      const updatedEndTime = new Date(updatedEvent.end);

      // Update job schedule in Supabase
      const { error: scheduleError } = await supabase
        .from('job_schedule')
        .update({
          scheduled_date: updatedStartTime.toISOString().split('T')[0],
          scheduled_start_time: updatedStartTime.toTimeString().split(' ')[0].substring(0, 8),
          scheduled_end_time: updatedEndTime.toTimeString().split(' ')[0].substring(0, 8),
          updated_at: new Date().toISOString()
        })
        .eq('job_id', updatedEvent.event_id);

      if (scheduleError) {
        // If no schedule exists, create one
        await supabase
          .from('job_schedule')
          .insert({
            job_id: updatedEvent.event_id,
            scheduled_date: updatedStartTime.toISOString().split('T')[0],
            scheduled_start_time: updatedStartTime.toTimeString().split(' ')[0].substring(0, 8),
            scheduled_end_time: updatedEndTime.toTimeString().split(' ')[0].substring(0, 8),
          });
      }

      // Also update the job's scheduled_date
      await supabase
        .from('jobs')
        .update({
          scheduled_date: updatedStartTime.toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', updatedEvent.event_id);

      showToast(`Job ${updatedEvent.title} updated successfully.`, 'success');

      // Create notification for job update
      await createJobUpdateNotification(updatedEvent.event_id, updatedEvent.title, "Drag");

      invalidateCalendarQuery();

      return updatedEvent;
    } catch (error) {
      console.error("Error updating job:", error);
      showToast("Failed to update job. Please try again.", 'error');
      throw error;
    }
  };

  const handleEventResize = async (event, start, end) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      const updatedStartTime = new Date(start);
      const updatedEndTime = new Date(end);

      // Update job schedule in Supabase
      const { error: scheduleError } = await supabase
        .from('job_schedule')
        .update({
          scheduled_date: updatedStartTime.toISOString().split('T')[0],
          scheduled_start_time: updatedStartTime.toTimeString().split(' ')[0].substring(0, 8),
          scheduled_end_time: updatedEndTime.toTimeString().split(' ')[0].substring(0, 8),
          updated_at: new Date().toISOString()
        })
        .eq('job_id', event.event_id);

      if (scheduleError) {
        // If no schedule exists, create one
        await supabase
          .from('job_schedule')
          .insert({
            job_id: event.event_id,
            scheduled_date: updatedStartTime.toISOString().split('T')[0],
            scheduled_start_time: updatedStartTime.toTimeString().split(' ')[0].substring(0, 8),
            scheduled_end_time: updatedEndTime.toTimeString().split(' ')[0].substring(0, 8),
          });
      }

      // Also update the job's scheduled_date
      await supabase
        .from('jobs')
        .update({
          scheduled_date: updatedStartTime.toISOString().split('T')[0],
          updated_at: new Date().toISOString()
        })
        .eq('id', event.event_id);

      // Add notification for resize action
      await createJobUpdateNotification(event.event_id, event.title, "Resize");
      showToast(`Job ${event.title} resized successfully.`, 'success');

      invalidateCalendarQuery();

      return event;
    } catch (error) {
      console.error("Error updating job:", error);
      showToast("Failed to update job. Please try again.", 'error');
      throw error;
    }
  };


  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleEventClick = (event) => {
    setSelectedJobEvent(event);
    setShowJobActionModal(true);
  };

  const closeJobActionModal = () => {
    setShowJobActionModal(false);
    setSelectedJobEvent(null);
  };

  const openRepeatModal = (jobData) => {
    const startReference = jobData?.StartTime ? new Date(jobData.StartTime) : new Date();
    const anchor = formatRecurrenceStartDate(startReference);
    setRepeatJobEvent(jobData);
    setRepeatRule({
      ...getDefaultRecurrenceRule(anchor),
      isRepeat: true,
    });
    setShowJobActionModal(false);
    setShowRepeatModal(true);
  };

  const handleRepeatSave = async (rule) => {
    if (!repeatJobEvent || isCreatingRepeatJobs) {
      return;
    }

    setShowRepeatModal(false);
    setIsCreatingRepeatJobs(true);

    try {
      const { Id } = repeatJobEvent;
      const workerId = user?.workerId || user?.id;

      if (!workerId) {
        throw new Error("Worker ID not found in cookies");
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client not available");
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, username, full_name, first_name, last_name")
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
        .eq("id", Id)
        .single();

      if (jobError || !originalJob) {
        throw new Error("Original job not found");
      }

      const { data: jobSchedulesData } = await supabase
        .from("job_schedule")
        .select("*")
        .eq("job_id", Id)
        .order("created_at", { ascending: true });

      const scheduleTemplate = jobSchedulesData?.[0] || null;

      const startReference = originalJob.scheduled_start
        ? new Date(originalJob.scheduled_start)
        : new Date(repeatJobEvent.StartTime || Date.now());
      const endReference = originalJob.scheduled_end
        ? new Date(originalJob.scheduled_end)
        : new Date(startReference.getTime() + 2 * 60 * 60 * 1000);
      const duration = endReference.getTime() - startReference.getTime();

      const newDates = generateOccurrenceDateRanges(rule, duration, {
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
          Subject: repeatJobEvent.Subject,
          Description: repeatJobEvent.Description,
          scheduleTemplate,
        },
      });

      showToast(
        `${createdJobs.length} repeat job${createdJobs.length > 1 ? "s" : ""} created successfully.`,
        "success"
      );

      invalidateCalendarQuery();
    } catch (error) {
      console.error("Error creating repeated jobs:", error);
      showToast(`Failed to create repeated jobs: ${error.message}`, "error");
    } finally {
      setIsCreatingRepeatJobs(false);
      setRepeatJobEvent(null);
      setRepeatRule(null);
    }
  };

  const handleAddLegend = () => {
    Swal.fire({
      title: 'Add new Legends',
      html: `
        <div class="mb-3">
          <label class="form-label">Legend Name</label>
          <input 
            id="status" 
            class="form-control" 
            placeholder="Enter status name"
          >
        </div>
        <div class="mb-3">
          <label class="form-label">Color</label>
          <input 
            id="color" 
            class="form-control" 
            type="color" 
            value="#000000"
          >
        </div>
      `,
      customClass: {
        container: 'swal2-custom',
        popup: 'swal2-custom-popup',
      
        actions: 'swal2-actions-custom',
        confirmButton: 'btn btn-primary px-4',
        cancelButton: 'btn btn-outline-secondary'
      },
      showCancelButton: true,
      confirmButtonText: 'Create',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      preConfirm: () => {
        const status = document.getElementById('status').value;
        const color = document.getElementById('color').value;
        if (!status) {
          Swal.showValidationMessage('Please enter a status name');
          return false;
        }
        if (!validateNewStatus(status)) {
          Swal.showValidationMessage('Status name already exists');
          return false;
        }
        return { status, color };
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const newId = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const newLegendItems = [...legendItems, {
            id: newId,
            status: result.value.status,
            color: result.value.color
          }];
          
          await saveLegendToFirebase(newLegendItems);
          setLegendItems(newLegendItems);
          toast.success('New status added successfully', {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });
        } catch (error) {
          console.error('Error adding new status:', error);
          toast.error('Failed to add new status', {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });
        }
      }
    });
  };

  const handleEditLegend = (item) => {
    Swal.fire({
      title: 'Edit Status',
      html: `
        <div class="mb-3">
          <label class="form-label">Status Name</label>
          <input 
            id="status" 
            class="form-control" 
            value="${item.status}"
            placeholder="Enter status name"
          >
        </div>
        <div class="mb-3">
          <label class="form-label">Color</label>
          <input 
            id="color" 
            class="form-control" 
            type="color" 
            value="${item.color}"
          >
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Save',
      cancelButtonText: 'Cancel',
      customClass: {
        confirmButton: 'btn btn-primary me-2',
        cancelButton: 'btn btn-outline-secondary ms-2',
        actions: 'my-2'
      },
      buttonsStyling: false,
      preConfirm: () => {
        const status = document.getElementById('status').value;
        const color = document.getElementById('color').value;
        if (!status) {
          Swal.showValidationMessage('Please enter a status name');
          return false;
        }
        if (!validateNewStatus(status, item.id)) {
          Swal.showValidationMessage('Status name already exists');
          return false;
        }
        return { status, color };
      }
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const newLegendItems = legendItems.map(legend => 
            legend.id === item.id 
              ? { ...legend, status: result.value.status, color: result.value.color }
              : legend
          );
          
          await saveLegendToFirebase(newLegendItems);
          setLegendItems(newLegendItems);
          toast.success('Status updated successfully', {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });
        } catch (error) {
          console.error('Error updating status:', error);
          toast.error('Failed to update status', {
            position: "top-right",
            autoClose: 3000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });
        }
      }
    });
  };

  const handleDeleteLegend = (itemId) => {
    Swal.fire({
      title: 'Delete Status?',
      text: 'Are you sure you want to delete this status?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const newLegendItems = legendItems.filter(item => item.id !== itemId);
          await saveLegendToFirebase(newLegendItems);
          setLegendItems(newLegendItems);
          showToast('Status deleted successfully', 'success');
        } catch (error) {
          console.error('Error deleting status:', error);
          showToast('Failed to delete status', 'error');
        }
      }
    });
  };

  const calculateDuration = (start, end) => {
    const diffInMilliseconds = new Date(end) - new Date(start);
    const hours = Math.floor(diffInMilliseconds / (1000 * 60 * 60));
    const minutes = Math.floor(
      (diffInMilliseconds % (1000 * 60 * 60)) / (1000 * 60)
    );

    if (hours === 0) {
      return `${minutes}min`;
    } else if (minutes === 0) {
      return `${hours}hr`;
    } else {
      return `${hours}hr ${minutes}min`;
    }
  };

  // Save legend changes to localStorage (can be migrated to Supabase settings table later)
  const saveLegendToFirebase = async (newLegendItems) => {
    try {
      localStorage.setItem('jobStatusLegend', JSON.stringify(newLegendItems));
      setLegendItems(newLegendItems);
    } catch (error) {
      console.error('Error saving legend items:', error);
      showToast('Failed to save status settings', 'error');
    }
  };

  const validateNewStatus = (status, currentId = null) => {
    return !legendItems.some(item => 
      item.id !== currentId && 
      item.status.toLowerCase() === status.toLowerCase()
    );
  };

  const handleSetDefault = (itemId) => {
    setDefaultStatus(itemId);
    // You could also save this to Firebase
  };

  const handleCellClick = useCallback(
    (start, end) => {
      const startDate = new Date(start);
      const formattedStartDate = format(startDate, "yyyy-MM-dd");

      Swal.fire({
        title: "Create a Job?",
        text: `Are you sure you want to create a new job starting on ${format(
          startDate,
          "MMMM d, yyyy"
        )}?`,
        icon: "question",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Yes, create job",
      }).then((result) => {
        if (result.isConfirmed) {
          router.push({
            pathname: "/jobs/create",
            query: {
              startDate: formattedStartDate,
            },
          });
        }
      });
    },
    [router]
  );

  // Custom event renderer
  const customEventRenderer = (event) => {
    return (
      <div
        style={{
          backgroundColor: event.color || '#2196f3',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          height: '100%',
          overflow: 'hidden',
          cursor: 'pointer'
        }}
        onClick={() => handleEventClick(event)}
      >
        <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
          {event.title}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.9 }}>
          {event.Customer}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const fetchLegendItems = async () => {
      try {
        // Try to load from localStorage first
        const savedLegend = localStorage.getItem('jobStatusLegend');
        if (savedLegend) {
          const parsed = JSON.parse(savedLegend);
          setLegendItems(parsed);
        } else {
          // Use default items
          setLegendItems(DEFAULT_LEGEND_ITEMS);
        }
      } catch (error) {
        console.error('Error loading legend items:', error);
        showToast('Failed to load status settings', 'error');
        setLegendItems(DEFAULT_LEGEND_ITEMS);
      }
    };

    fetchLegendItems();
  }, []);

  useEffect(() => {
    // Component mount
    return () => {
      // Component cleanup
      toast.dismiss(); // Dismiss all toasts when component unmounts
    };
  }, []);

  return (
    <>
      <GeeksSEO title="Job Calendar | SAS&ME - SAP B1 | Portal" />
      <div className="container-fluid">
        <DashboardHeader
          title="Job Calendar"
          subtitle="View and manage all job schedules in an interactive calendar view"
          infoText="Drag and drop jobs to reschedule, click to view details, and manage your service assignments"
          stats={[
            {
              icon: BsBriefcaseFill,
              label: 'Total Jobs',
              value: stats.totalJobs,
              tooltip: 'Total number of jobs in the system'
            },
            {
              icon: BsCheckCircleFill,
              label: 'Active Jobs',
              value: stats.activeJobs,
              tooltip: 'Jobs currently in progress'
            }
          ]}
          badges={[
            { label: 'Calendar View' },
            { label: 'Schedule Management', icon: 'fe fe-calendar' }
          ]}
          breadcrumbs={[
            { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
            { icon: 'fe fe-briefcase', label: 'Jobs', href: '/jobs' },
            { icon: 'fe fe-calendar', label: 'Calendar' }
          ]}
          rightAction={
            <Button
              onClick={() => router.push("/jobs/create")}
              variant="light"
              style={{
                border: 'none',
                borderRadius: '12px',
                padding: '10px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
                fontWeight: '500',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
              }}
            >
              <FaPlus size={16} />
              <span>Add New Job</span>
            </Button>
          }
        />
      </div>
      
      <ToastContainer
        enableMultiContainer={false}
        containerId="main-toaster"
        limit={3}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable
        pauseOnHover
        theme="light"
      />
      
      <div className="container-fluid">
        <Row>
          <Col lg={12} md={12} sm={12}>
            <div style={{ display: "flex", width: "100%", marginRight: "20px" }}>
        {/* Left side: Calendar */}
        <div style={{ flex: 8, marginRight: "20px" }}>
          <Form.Group className="mb-3">
            <Form.Control
              type="text"
              placeholder="Search Job Name, Job No., Customer, Location etc........"
              value={searchTerm}
              onChange={handleSearch}
              style={{
                padding: '12px',
                fontSize: '14px',
                border: '1px solid #ddd',
                borderRadius: '8px'
              }}
            />
          </Form.Group>

          {/* Display loading spinner when loading is true */}
          {calendarLoading ? (
            <div className="d-flex justify-content-center mt-4">
              <Spinner animation="border" role="status">
                <span className="sr-only">Loading...</span>
              </Spinner>
            </div>
          ) : (
            <div style={{ marginTop: "15px" }}>
              <Scheduler
                view="month"
                selectedDate={selectedDate}
                onSelectedDateChange={setSelectedDate}
                events={filteredEvents}
                height={650}
                onEventDrop={handleEventDrop}
                onEventEdit={(event) => handleEventClick(event)}
                onCellClick={handleCellClick}
                editable={true}
                draggable={true}
                eventRenderer={(event) => customEventRenderer(event)}
                week={{
                  weekDays: [0, 1, 2, 3, 4, 5, 6],
                  weekStartOn: 0,
                  startHour: 8,
                  endHour: 18,
                  step: 60
                }}
                month={{
                  weekDays: [0, 1, 2, 3, 4, 5, 6],
                  weekStartOn: 0,
                }}
                day={{
                  startHour: 8,
                  endHour: 18,
                  step: 60
                }}
              />
            </div>
          )}
        </div>

        {/* Right side: Legend - update styles */}
        <div style={{ 
          flex: 1,
          minWidth: "250px",
          maxWidth: "300px", 
          height: '650px',
          display: 'flex',
          flexDirection: 'column',
          marginRight: "5px" // Add right margin to prevent sticking to edge
        }}>
          <Legend
            legendItems={legendItems}
            defaultStatus={defaultStatus}
            onAddLegend={handleAddLegend}
            onEditLegend={handleEditLegend}
            onDeleteLegend={handleDeleteLegend}
            onSetDefault={handleSetDefault}
          />
        </div>
      </div>
          </Col>
        </Row>
      </div>

      <PortalModal
        show={showJobActionModal}
        onHide={closeJobActionModal}
        title={selectedJobEvent?.Subject || "Job Actions"}
        size="sm"
        footer={
          <>
            <Button variant="outline-secondary" onClick={closeJobActionModal}>
              Cancel
            </Button>
            <Button
              variant="outline-primary"
              onClick={() => router.push(`/dashboard/jobs/${selectedJobEvent?.Id}`)}
              disabled={!selectedJobEvent?.Id}
            >
              View Job
            </Button>
            <Button
              variant="primary"
              onClick={() => openRepeatModal(selectedJobEvent)}
              disabled={!selectedJobEvent || isCreatingRepeatJobs}
            >
              <BsArrowRepeat className="me-1" />
              Repeat Job
            </Button>
          </>
        }
      >
        <p className="mb-2 text-muted small">
          {selectedJobEvent?.JobNo ? `Job No: ${selectedJobEvent.JobNo}` : null}
        </p>
        <p className="mb-0">
          Choose an action for this scheduled job.
        </p>
      </PortalModal>

      <JobRecurrenceModal
        show={showRepeatModal}
        onHide={() => {
          setShowRepeatModal(false);
          setRepeatJobEvent(null);
          setRepeatRule(null);
        }}
        initialRule={repeatRule}
        onSave={handleRepeatSave}
        mode="extend"
      />
    </>
  );
};

export default Calendar;