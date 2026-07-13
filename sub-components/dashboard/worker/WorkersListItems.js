import React, { useState, useEffect, useMemo, Fragment, useCallback, useRef } from "react";
import {
  Row,
  Col,
  Card,
  Badge,
  Image,
  Tooltip,
  OverlayTrigger,
  Spinner,
  Button,
} from "react-bootstrap";
import { useRouter } from "next/router";
import { toast, ToastContainer } from "react-toastify";
import { userService } from "../../../lib/supabase/database";
import { useReactTable, createColumnHelper, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table';
import Swal from "sweetalert2";
import { Search } from 'react-feather';
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from '../DashboardListStickySearch';
import { format, parseISO } from 'date-fns'; // Add this import for date formatting
import { useWorkers } from '../../../hooks/useWorkers';
import { useEnterToSearch } from '../../../hooks/useEnterToSearch';
import { MailIcon, PhoneIcon, CheckIcon, XIcon, Eye, Trash } from 'lucide-react';
import { Users, Clock, CheckCircle, Activity } from 'lucide-react';
import Link from "next/link";
import { FaUser, FaPlus } from "react-icons/fa";
import { Filter, ChevronDown, ChevronUp, X as FeatherX } from 'react-feather';
import { Form } from 'react-bootstrap';
import TablePagination from '../../../components/common/TablePagination';
import { getWorkerViewPath } from '../../../utils/workerRoutes';
import { clientAuditLog } from '../../../utils/clientAuditLog';
import IndeterminateCheckbox from '../../../widgets/advance-table/Checkbox';

const formatAttendanceDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy · h:mm a');
  } catch {
    return '—';
  }
};

const formatAttendanceTooltip = (iso) => {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'PPpp');
  } catch {
    return '—';
  }
};

const formatDate = (date) => {
  try {
    if (!date) return '-';
    
    // If it's a timestamp
    if (date?.toDate) {
      return format(date.toDate(), 'MMM d, yyyy');
    }
    
    // If it's a string
    if (typeof date === 'string') {
      return format(parseISO(date), 'MMM d, yyyy');
    }
    
    // If it's a Date object
    if (date instanceof Date) {
      return format(date, 'MMM d, yyyy');
    }

    return '-';
  } catch (error) {
    console.error('Error formatting date:', error, date);
    return '-';
  }
};

const WorkersListItems = () => {
  const {
    workers,
    loading,
    error,
    fetchWorkers,
    clearCache,
    page,
    pageSize,
    totalCount,
    totalPages,
    goToPage,
    search,
    updateSearch,
    stats,
  } = useWorkers({ pageSize: 10 });
  
  const [isEditing, setIsEditing] = useState(false);
  const router = useRouter();
  const [rowSelection, setRowSelection] = useState({});
  const [users, setUsers] = useState([]);
  const {
    draft: searchDraft,
    setDraft: setSearchDraft,
    applied: searchApplied,
    clear: clearSearch,
    onKeyDown: onSearchKeyDown,
  } = useEnterToSearch();

  // Modify handleRefresh to force a fresh fetch
  const handleRefresh = useCallback(async () => {
    try {
      clearCache();
      await fetchWorkers();
      toast.success('Data refreshed successfully', {
        position: "top-right",
        className: 'bg-success text-white'
      });
    } catch (error) {
      toast.error('Failed to refresh data', {
        position: "top-right",
        className: 'bg-danger text-white'
      });
    }
  }, [clearCache, fetchWorkers]);

  // Modify handleRemoveWorker to not need manual refresh
  const handleRemoveWorker = useCallback(async (row) => {
    const confirmDelete = await Swal.fire({
      title: 'Are you sure?',
      text: 'This action cannot be undone.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Yes, remove',
      cancelButtonText: 'Cancel',
    });

    if (confirmDelete.isConfirmed) {
      try {
        // Soft delete using Supabase
        await userService.delete(row.id);
        void clientAuditLog({
          action: 'WORKER_DELETE',
          category: 'worker',
          entityType: 'worker',
          entityId: row.id,
          entityLabel: row.fullName || row.email,
          description: `Worker ${row.fullName || row.email} deleted`,
        });
        // No need to manually refresh - real-time subscription will handle it
        
        toast.success('Worker removed successfully', {
          position: "top-right",
          className: 'bg-success text-white'
        });
      } catch (error) {
        console.error("Error removing worker:", error);
        toast.error('Error removing worker: ' + error.message, {
          position: "top-right",
          className: 'bg-danger text-white'
        });
      }
    }
  }, []);

  // Handle view worker - directly navigate to view page
  const handleViewWorker = useCallback((row) => {
    router.push(getWorkerViewPath(row.id));
  }, [router]);

  // Handle individual delete
  const handleDelete = useCallback(async (worker) => {
    const confirmDelete = await Swal.fire({
      title: 'Delete Worker?',
      text: `Are you sure you want to delete ${worker.fullName}? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
    });

    if (confirmDelete.isConfirmed) {
      try {
        await userService.delete(worker.id);
        void clientAuditLog({
          action: 'WORKER_DELETE',
          category: 'worker',
          entityType: 'worker',
          entityId: worker.id,
          entityLabel: worker.fullName || worker.email,
          description: `Worker ${worker.fullName || worker.email} deleted`,
        });
        clearCache();
        await fetchWorkers();
        
        toast.success('Worker deleted successfully', {
          position: "top-right",
          className: 'bg-success text-white'
        });
      } catch (error) {
        console.error("Error deleting worker:", error);
        toast.error('Error deleting worker: ' + error.message, {
          position: "top-right",
          className: 'bg-danger text-white'
        });
      }
    }
  }, [fetchWorkers, clearCache]);

  // Add new bulk delete handler
  const handleBulkDelete = useCallback(async (tableInstance) => {
    const selectedRows = tableInstance.getSelectedRowModel().rows;
    if (!selectedRows.length) return;

    const selectedWorkers = selectedRows.map(row => row.original);
    const confirmDelete = await Swal.fire({
      title: 'Delete Selected Workers?',
      text: `Are you sure you want to delete ${selectedWorkers.length} worker${selectedWorkers.length > 1 ? 's' : ''}? This action cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc3545',
      cancelButtonColor: '#6c757d',
      confirmButtonText: 'Yes, delete',
      cancelButtonText: 'Cancel',
    });

    if (confirmDelete.isConfirmed) {
      try {
        // Soft delete all selected workers using Supabase
        await Promise.all(
          selectedWorkers.map(async (worker) => {
            await userService.delete(worker.id);
            void clientAuditLog({
              action: 'WORKER_DELETE',
              category: 'worker',
              entityType: 'worker',
              entityId: worker.id,
              entityLabel: worker.fullName || worker.email,
              description: `Worker ${worker.fullName || worker.email} bulk deleted`,
              details: { bulk: true },
            });
          })
        );
        
        // Refresh the workers list
        clearCache();
        await fetchWorkers();
        
        setRowSelection({}); // Clear selection
        toast.success(`Successfully deleted ${selectedWorkers.length} worker${selectedWorkers.length > 1 ? 's' : ''}`, {
          position: "top-right",
          className: 'bg-success text-white'
        });
      } catch (error) {
        console.error("Error deleting workers:", error);
        toast.error('Error deleting workers: ' + error.message, {
          position: "top-right",
          className: 'bg-danger text-white'
        });
      }
    }
  }, [fetchWorkers, clearCache]);


  const columnHelper = createColumnHelper();

  const columns = [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <IndeterminateCheckbox
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          indeterminate={table.getIsSomeRowsSelected()}
        />
      ),
      size: 50,
      cell: ({ row }) => (
        <Form.Check
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    }),
    columnHelper.accessor((row, index) => {
      // Calculate row number accounting for pagination
      // pagination.pageIndex is 0-based, so we need to access it from the table context
      return index + 1; // This will be updated in the cell renderer
    }, {
      id: 'index',
      header: '#',
      size: 60,
      cell: info => {
        const rowNumber = (page - 1) * pageSize + info.row.index + 1;
        return (
          <span className="text-muted" style={{ fontSize: '14px' }}>
            {rowNumber}
          </span>
        );
      }
    }),

    columnHelper.accessor('fullName', {
      header: 'WORKER NAME',
      size: 280,
      cell: info => (
        <div className="d-flex align-items-center">
          <div className="position-relative">
            <Image
              src={info.row.original.profilePicture || '/images/avatar/default-avatar.png'}
              alt={info.getValue()}
              width={45}
              height={45}
              className="rounded-circle"
              style={{ 
                objectFit: 'cover', 
                border: '2px solid #fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            />
            <span 
              className={`position-absolute bottom-0 end-0 ${info.row.original.showOnlineIndicator ? 'bg-success' : 'bg-secondary'}`}
              style={{ 
                width: '12px', 
                height: '12px', 
                borderRadius: '50%', 
                border: '2px solid #fff' 
              }}
              title={
                info.row.original.isClockedIn
                  ? 'Clocked in (field app)'
                  : info.row.original.isOnline
                    ? 'Online'
                    : 'Offline'
              }
            />
          </div>
          <div className="ms-3">
            <div className="d-flex align-items-center gap-2">
              <span className="fw-semibold text-dark" style={{ fontSize: '14px' }}>
                {info.getValue()}
              </span>
              <div className="d-flex gap-1">
                {info.row.original.isFieldWorker && (
                  <Badge 
                    bg="warning" 
                    text="dark"
                    style={{ 
                      fontSize: '10px', 
                      padding: '4px 6px',
                      borderRadius: '4px'
                    }}
                  >
                    Field Worker
                  </Badge>
                )}
                {info.row.original.isAdmin && (
                  <Badge 
                    bg="danger" 
                    text="white"
                    style={{ 
                      fontSize: '10px', 
                      padding: '4px 6px',
                      borderRadius: '4px'
                    }}
                  >
                    Admin
                  </Badge>
                )}
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <small className="text-muted" style={{ fontSize: '12px' }}>
                {info.row.original.nric_fin_work_permit_number || '-'}
              </small>
            </div>
          </div>
        </div>
      )
    }),

    columnHelper.accessor(row => ({
      email: row.email,
      primaryPhone: row.primaryPhone,
      secondaryPhone: row.secondaryPhone
    }), {
      id: 'contact',
      header: 'CONTACT INFO',
      size: 250,
      cell: info => (
        <div>
          <div className="d-flex align-items-center mb-1">
            <MailIcon size={14} className="text-muted me-2" />
            <span style={{ fontSize: '14px' }}>{info.getValue().email || '-'}</span>
          </div>
          <div className="d-flex align-items-center mb-1">
            <PhoneIcon size={14} className="text-muted me-2" />
            <span style={{ fontSize: '14px' }} translate="no">{info.getValue().primaryPhone || '-'}</span>
          </div>
          {info.getValue().secondaryPhone && (
            <div className="d-flex align-items-center">
              <PhoneIcon size={14} className="text-muted me-2" />
              <span style={{ fontSize: '14px' }} translate="no">{info.getValue().secondaryPhone}</span>
            </div>
          )}
        </div>
      )
    }),

    columnHelper.accessor('skills', {
      header: 'SKILLS',
      size: 200,
      cell: info => {
        const skills = info.getValue() || [];
        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip>
                <div className="text-start">
                  <strong>Skills & Expertise:</strong>
                  <div className="mt-1">
                    {skills.map((skill, index) => (
                      <div key={index} className="d-flex align-items-center gap-1 mb-1">
                        <i className="fe fe-check-circle text-success" style={{ fontSize: '12px' }}></i>
                        <span>{skill}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Tooltip>
            }
          >
            <div className="d-flex flex-wrap gap-1">
              {skills.slice(0, 2).map((skill, index) => (
                <Badge 
                  key={index}
                  bg="light"
                  text="dark"
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '500',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  {skill}
                </Badge>
              ))}
              {skills.length > 2 && (
                <Badge 
                  bg="secondary"
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  +{skills.length - 2} more
                </Badge>
              )}
            </div>
          </OverlayTrigger>
        );
      }
    }),

    columnHelper.accessor('activeUser', {
      header: 'STATUS',
      size: 120,
      cell: info => (
        <div className="d-flex flex-column align-items-start">
          <Badge 
            bg={info.getValue() === true ? 'success' : 'danger'}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: '500'
            }}
          >
            {info.getValue() === true ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      )
    }),

    columnHelper.accessor((row) => row, {
      id: 'working',
      header: 'WORKING',
      size: 230,
      cell: (info) => {
        const row = info.row.original;
        if (!row.hasTechnicianProfile) {
          return (
            <OverlayTrigger
              placement="top"
              overlay={
                <Tooltip>
                  No technician profile — attendance is only tracked for linked field technicians.
                </Tooltip>
              }
            >
              <span className="text-muted" style={{ cursor: 'help', fontSize: '13px' }}>
                —
              </span>
            </OverlayTrigger>
          );
        }
        const hasPunch = row.attendanceClockIn != null || row.isWorking;
        if (!hasPunch) {
          return (
            <OverlayTrigger
              placement="top"
              overlay={<Tooltip>No clock in/out recorded yet.</Tooltip>}
            >
              <span className="text-muted" style={{ cursor: 'help', fontSize: '13px' }}>
                No punches
              </span>
            </OverlayTrigger>
          );
        }
        const inTxt = formatAttendanceDateTime(row.attendanceClockIn);
        const outTxt = row.isWorking ? '—' : formatAttendanceDateTime(row.attendanceClockOut);
        const workingBadgeLabel = row.isWorking
          ? row.isOnBreak
            ? 'On break'
            : 'Working'
          : 'Off duty';
        const workingBadgeBg = row.isWorking ? (row.isOnBreak ? 'info' : 'success') : 'secondary';
        const tooltip = (
          <Tooltip id={`working-tt-${row.id}`}>
            <div className="text-start small" style={{ minWidth: 200 }}>
              <div>
                <strong>Clock in</strong>
              </div>
              <div className="mb-2">{formatAttendanceTooltip(row.attendanceClockIn)}</div>
              <div>
                <strong>Clock out</strong>
              </div>
              <div>
                {row.isWorking ? (
                  <span className="text-warning">Still clocked in</span>
                ) : (
                  formatAttendanceTooltip(row.attendanceClockOut)
                )}
              </div>
              {row.assignmentStartedAt && (
                <div className="mt-2 pt-2 border-top border-secondary">
                  <div>
                    <strong>Assignment started</strong>
                  </div>
                  <div className="text-muted">{formatAttendanceTooltip(row.assignmentStartedAt)}</div>
                </div>
              )}
              {row.isWorking && row.isOnBreak && (
                <div className="mt-2 pt-2 border-top border-secondary text-muted">
                  This shift is flagged as on break (not working a job until break ends).
                </div>
              )}
            </div>
          </Tooltip>
        );
        return (
          <OverlayTrigger placement="top" overlay={tooltip}>
            <div style={{ cursor: 'help', maxWidth: 240 }}>
              <div className="mb-1">
                <Badge
                  bg={workingBadgeBg}
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    ...(row.isOnBreak ? { color: '#212529' } : {}),
                  }}
                >
                  {workingBadgeLabel}
                </Badge>
              </div>
              <div style={{ fontSize: '12px', lineHeight: 1.35 }} className="text-dark">
                <span className="text-muted">In:</span> {inTxt}
              </div>
              <div style={{ fontSize: '12px', lineHeight: 1.35 }} className="text-dark">
                <span className="text-muted">Out:</span> {outTxt}
              </div>
              {row.assignmentStartedAt ? (
                <div style={{ fontSize: '12px', lineHeight: 1.35 }} className="text-dark">
                  <span className="text-muted">Assignment:</span>{' '}
                  {formatAttendanceDateTime(row.assignmentStartedAt)}
                </div>
              ) : null}
            </div>
          </OverlayTrigger>
        );
      },
    }),

    columnHelper.accessor(() => 'actions', {
      id: 'actions',
      header: 'ACTIONS',
      size: 150,
      cell: info => (
        <div className="d-flex gap-2">
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>
                <div className="text-start">
                  <strong>View Details</strong>
                  <div className="mt-1 text-xs">Click to see full worker profile</div>
                </div>
              </Tooltip>
            }
          >
            <Button 
              variant="primary"
              size="sm"
              className="btn-icon-text"
              onClick={(e) => {
                e.stopPropagation();
                handleViewWorker(info.row.original);
              }}
              style={{
                backgroundColor: '#3b82f6',
                border: 'none',
                boxShadow: '0 2px 4px rgba(59, 130, 246, 0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: '500',
                fontSize: '0.875rem',
                padding: '0.5rem 0.875rem',
                borderRadius: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <Eye size={14} className="icon-left" />
              View
            </Button>
          </OverlayTrigger>
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>
                <div className="text-start">
                  <strong>Delete Worker</strong>
                  <div className="mt-1 text-xs">Permanently delete this worker</div>
                </div>
              </Tooltip>
            }
          >
            <Button 
              variant="danger"
              size="sm"
              className="btn-icon-text"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(info.row.original);
              }}
              style={{
                backgroundColor: '#fee2e2',
                color: '#dc2626',
                border: 'none',
                boxShadow: '0 2px 4px rgba(220, 38, 38, 0.15)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: '500',
                fontSize: '0.875rem',
                padding: '0.5rem 0.875rem',
                borderRadius: '6px',
                transition: 'all 0.2s ease'
              }}
            >
              <Trash size={14} className="icon-left" />

            </Button>
          </OverlayTrigger>
        </div>
      )
    })
  ];

  // Server-paginated table (page/limit from /api/workers/summary)
  const table = useReactTable({
    data: workers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
    manualPagination: true,
    pageCount: totalPages,
  });

  // Add debug logs
  useEffect(() => {
    console.log('Component state:', {
      workersCount: workers?.length,
      loading,
      error: error?.message
    });
  }, [workers, loading, error]);

  useEffect(() => {
    console.log('Workers data:', {
      raw: workers,
      loading,
      error,
      page,
      totalCount,
    });
  }, [workers, loading, error, page, totalCount]);


  useEffect(() => {
    updateSearch(searchApplied);
  }, [searchApplied, updateSearch]);

  const statCards = [
    {
      title: 'Workers Statistics',
      value: stats.totalUsers,
      icon: <Users className="text-primary" />,
      badge: { text: 'Total', variant: 'primary' },
      background: '#e7f1ff',
      summary: `${stats.active} Active | ${stats.inactive} Inactive`
    },
    {
      title: 'Active Workers',
      value: stats.active,
      icon: <Activity className="text-success" />,
      badge: { text: 'Active', variant: 'success' },
      background: '#e6f8f0',
      summary: 'Currently Active Users'
    },
    {
      title: 'Field Workers',
      value: stats.fieldWorkers,
      icon: <Clock className="text-warning" />,
      badge: { text: 'Field', variant: 'warning' },
      background: '#fff8ec',
      summary: 'Field Workers Available'
    },
    {
      title: 'Inactive Workers',
      value: stats.inactive,
      icon: <CheckCircle className="text-info" />,
      badge: { text: 'Inactive', variant: 'danger' },
      background: '#e7f6f8',
      summary: 'Currently Inactive Users'
    }
  ];

  // Update handleClearFilters

  // Filtering is now handled automatically by useMemo - no need for useEffect

  useEffect(() => {
    console.log('Pagination Debug:', {
      currentPage: page,
      pageSize,
      totalItems: totalCount,
      totalPages,
    });
  }, [page, pageSize, totalCount, totalPages]);

  return (
    <Fragment>
      {isEditing && (
        <div className="loading-overlay">
          <Spinner animation="border" variant="primary" />
        </div>
      )}
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div
            style={{
              width: "100vw",
              maxWidth: "100vw",
              marginLeft: "calc(50% - 50vw)",
              marginRight: "calc(50% - 50vw)",
            }}
          >
          <div
            style={{
              background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
              borderRadius: "0 0 24px 24px",
              marginTop: '-25px',
              marginBottom: "20px",
              marginLeft: "20px",
              marginRight: "20px",
              paddingTop: "1.5rem",
              paddingBottom: "1.5rem", 
            }}
          >
            <div className="px-3 px-sm-4">
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
                    Technicians List
                  </h1>
                  <div
                    className="d-flex align-items-center gap-2"
                    style={{
                      fontSize: "14px",
                      color: "rgba(255, 255, 255, 0.9)",
                      background: "rgba(255, 255, 255, 0.1)",
                      padding: "8px 12px ",
                      borderRadius: "6px",
                      marginTop: "8px",
                    }}
                  >
                    <i className="fe fe-info" style={{ fontSize: "16px" }}></i>
                    <span>
                      Track worker availability, skills, and performance metrics
                    </span>
                  </div>
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
                    Worker Management
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
                    Workforce
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
                    <span className="ms-2" style={{ color: "#FFFFFF" }}>
                      Workers
                    </span>
                  </div>
                </nav>
              </div>

              <div className="d-flex gap-2">
                {/* <OverlayTrigger
                  placement="bottom"
                  overlay={<Tooltip>Migrate user accounts from FSM User ID &amp; Password.xlsx</Tooltip>}
                >
                  <Link href="/dashboard/workers/migration" passHref>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      style={{
                        borderRadius: "12px",
                        padding: "10px 16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontWeight: "500",
                      }}
                    >
                      <span>Migrate Users</span>
                    </Button>
                  </Link>
                </OverlayTrigger> */}
                <OverlayTrigger
                  placement="left"
                  overlay={<Tooltip>Add a new worker</Tooltip>}
                >
                  <Link href="/workers/create">
                    <Button
                      variant="light"
                      className="create-worker-button"
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
                      <FaPlus className="plus-icon" size={16} />
                      <span>Add New Worker</span>
                    </Button>
                  </Link>
                </OverlayTrigger>
              </div>
            </div>
            </div>
          </div>
          </div>
        </Col>
      </Row>
      {/* Stats Cards Row */}
      <Row className="g-4 mb-4">
        {statCards.map((card, index) => (
          <Col key={index} lg={3} sm={6}>
            <Card className="border-0 shadow-sm">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="text-muted mb-1">{card.title}</p>
                    <h3 className="mb-1">{card.value}</h3>
                    <Badge bg={card.badge.variant}>{card.badge.text}</Badge>
                    <div className="small text-muted mt-2">{card.summary}</div>
                  </div>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background: card.background,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}>
                    {card.icon}
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
      <Row>
        <Col md={12} xs={12}>
          {/* Global Search Filter - Searches ALL fields in loaded workers in real-time */}
          <DashboardListStickySearch style={STICKY_SEARCH_GRADIENT_BLUE}>
              <Row className="align-items-center">
                <Col md={12}>
                  <div className="d-flex align-items-center gap-3">
                    <div style={{ minWidth: '140px' }}>
                      <h6 className="mb-0 text-white d-flex align-items-center">
                        <Search className="me-2" size={18} />
                        🌐 Global Search
                      </h6>
                      <small className="text-white" style={{ opacity: 0.9, fontSize: '0.75rem' }}>
                        Press Enter to search
                      </small>
                    </div>
                    <div className="flex-grow-1">
                      <Form.Control
                        type="text"
                        value={searchDraft}
                        onChange={(e) => setSearchDraft(e.target.value)}
                        onKeyDown={onSearchKeyDown}
                        placeholder="🔍 Search anything... Worker ID, Name, Email, Phone, Role, Status, Skills, Address, etc."
                        style={{ 
                          fontSize: '0.95rem', 
                          padding: '0.65rem 1rem',
                          border: 'none',
                          borderRadius: '8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                          fontWeight: '400'
                        }}
                        autoComplete="off"
                      />
                    </div>
                    {(searchDraft || searchApplied) ? (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={clearSearch}
                        className="d-flex align-items-center gap-1"
                        style={{ 
                          minWidth: '90px',
                          fontWeight: '500',
                          borderRadius: '6px'
                        }}
                      >
                        <FeatherX size={14} />
                        Clear
                      </Button>
                    ) : null}
                  </div>
                  {searchApplied ? (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.95 }}>
                      <small style={{ fontSize: '0.85rem' }}>
                        ✓ Showing <strong>{workers.length}</strong> of <strong>{totalCount}</strong> workers
                        {search ? (
                          <>
                            {' '}
                            · Search: <strong>{search}</strong>
                          </>
                        ) : null}
                      </small>
                    </div>
                  ) : (
                    <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.85 }}>
                      <small style={{ fontSize: '0.8rem' }}>
                        💡 <strong>Tip:</strong> Press Enter to search across Worker ID, Name, Email, Phone, Role, Status, Skills, Address, and more!
                      </small>
                    </div>
                  )}
                </Col>
              </Row>
          </DashboardListStickySearch>

          <Card className="border-0 shadow-sm">
            <Card.Body className="p-4">
              {/* Bulk Actions Bar */}
              {table.getSelectedRowModel().rows.length > 0 && (
                <div className="d-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded" style={{ backgroundColor: '#f8fafc' }}>
                  <div className="d-flex align-items-center gap-2">
                    <Badge bg="primary" style={{ fontSize: '14px', padding: '6px 12px' }}>
                      {table.getSelectedRowModel().rows.length} selected
                    </Badge>
                    <span className="text-muted" style={{ fontSize: '14px' }}>
                      {table.getSelectedRowModel().rows.length === 1 ? 'worker' : 'workers'} selected
                    </span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleBulkDelete(table)}
                    className="d-flex align-items-center gap-2"
                    style={{
                      backgroundColor: '#dc2626',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: '500'
                    }}
                  >
                    <Trash size={16} />
                    Delete Selected
                  </Button>
                </div>
              )}
             
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                          <th 
                            key={header.id}
                            style={{
                              width: header.getSize(),
                              cursor: header.column.getCanSort() ? 'pointer' : 'default',
                              backgroundColor: "#f8fafc",
                              fontSize: "13px",
                              fontWeight: "600",
                              color: "#475569",
                              padding: "16px",
                              borderBottom: "1px solid #e2e8f0"
                            }}
                            onClick={header.column.getToggleSortingHandler()}
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
                    {loading ? (
                      <tr>
                        <td colSpan={columns.length} className="text-center py-5">
                          <Spinner animation="border" variant="primary" className="me-2" />
                          <span className="text-muted">Loading workers...</span>
                        </td>
                      </tr>
                    ) : table.getRowModel().rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="text-center py-5">
                          <div className="text-muted mb-2">No workers found</div>
                          <small>Try adjusting your search terms</small>
                        </td>
                      </tr>
                    ) : (
                      table.getRowModel().rows.map(row => (
                        <tr 
                          key={row.id}
                          style={{
                            transition: "all 0.2s ease",
                            cursor: "pointer"
                          }}
                          className="table-row-hover"
                        >
                          {row.getVisibleCells().map(cell => (
                            <td 
                              key={cell.id}
                              style={{
                                fontSize: "14px",
                                color: "#64748b",
                                padding: "16px",
                                verticalAlign: "middle"
                              }}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="border-top">
                <TablePagination
                  currentPage={page}
                  totalPages={totalPages}
                  totalItems={totalCount}
                  onPageChange={goToPage}
                  disabled={loading || isEditing}
                />
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      <style jsx global>{`
         .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }

        .table-row-hover:hover {
          background-color: #f1f5f9;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        /* Button Base Styles */
        .btn-icon-text {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          font-size: 0.875rem;
          padding: 0.5rem 0.875rem;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .btn-icon-text .icon-left {
          transition: transform 0.2s ease;
        }

        /* Soft Variant Styles */
        .btn-soft-danger {
          background-color: #fee2e2;
          color: #dc2626;
          border: 1px solid transparent;
        }

        .btn-soft-danger:hover {
          background-color: #dc2626;
          color: white;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(220, 38, 38, 0.15);
        }

        .btn-soft-danger:hover .icon-left {
          transform: rotate(90deg);
        }

        /* Create Worker Button Style */
        .create-worker-button {
          background-color: #ffffff;
          color: #4171F5;
          transition: all 0.2s ease;
        }

        .create-worker-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
        }

        .create-worker-button:active {
          transform: translateY(0);
        }

        /* Table Styles */
        .table {
          margin-bottom: 0;
        }

        .table th {
          border-top: none;
          background-color: #f8fafc;
          font-weight: 600;
          color: #475569;
          text-transform: uppercase;
          font-size: 12px;
          letter-spacing: 0.5px;
        }

        .table td {
          vertical-align: middle;
          color: #64748b;
          font-size: 14px;
        }

        /* Badge Styles */
        .badge {
          font-weight: 500;
          padding: 0.35em 0.65em;
          border-radius: 6px;
        }

        /* Card Styles */
        .card {
          transition: all 0.2s ease;
        }

        .card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        /* View Button Hover Effects */
        .btn-icon-text:hover {
          background-color: #2563eb !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2) !important;
          color: white !important;
          text-decoration: none;
        }

        .btn-icon-text:hover .icon-left {
          transform: translateX(-2px);
        }

        /* Delete Button Styles */
        .btn-danger.btn-icon-text {
          background-color: #fee2e2 !important;
          color: #dc2626 !important;
          border: none !important;
        }

        .btn-danger.btn-icon-text:hover {
          background-color: #dc2626 !important;
          color: white !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 6px rgba(220, 38, 38, 0.2) !important;
        }

        .btn-danger.btn-icon-text:hover .icon-left {
          transform: none;
        }

        /* Tooltip Styles */
        .tooltip-inner {
          max-width: 300px;
          padding: 8px 12px;
          background-color: #1e293b;
          border-radius: 6px;
          font-size: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .tooltip.show {
          opacity: 1;
        }

        /* Checkbox Styles */
        .form-check-input {
          cursor: pointer;
          width: 18px;
          height: 18px;
          border: 2px solid #cbd5e1;
          border-radius: 4px;
        }

        .form-check-input:checked {
          background-color: #3b82f6;
          border-color: #3b82f6;
        }

        .form-check-input:indeterminate {
          background-color: #3b82f6;
          border-color: #3b82f6;
        }

        .form-check-input:focus {
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
      `}</style>
    </Fragment>
  );
};

export default WorkersListItems;
