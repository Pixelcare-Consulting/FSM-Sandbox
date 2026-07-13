import React, { useState, useEffect, useMemo } from "react";
import {
  Row,
  Col,
  Table,
  Badge,
  Spinner,
  OverlayTrigger,
  Tooltip,
  Form,
  InputGroup,
  Container,
  Button,
} from "react-bootstrap";
import { History } from "lucide-react";
import { useSettings } from '../../contexts/SettingsContext';
import {
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
} from "../../utils/jobStatusDefaults";
import { Search, XCircle } from 'react-bootstrap-icons';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { toast } from 'react-toastify';
import TablePagination from 'components/common/TablePagination';
import {
  isHtmlJobDescription,
  normalizePlainTextDescription,
  normalizeRichTextHtml,
} from '../../lib/utils/normalizeRichTextHtml';
import richTextStyles from '../../styles/richTextContent.module.css';
import { useCustomerJobHistoryQuery } from '../../hooks/queries/useCustomerJobHistoryQuery';

function renderJobDescriptionCell(description) {
  if (!description) {
    return 'No description';
  }

  if (isHtmlJobDescription(description)) {
    return (
      <div
        className={richTextStyles.richTextContentCompact}
        dangerouslySetInnerHTML={{
          __html: normalizeRichTextHtml(description, { compact: true }),
        }}
      />
    );
  }

  return (
    <div className={richTextStyles.richTextContentCompact} style={{ whiteSpace: 'pre-line' }}>
      {normalizePlainTextDescription(description)}
    </div>
  );
}

export const HistoryTab = ({ customerID, hasVisited = true }) => {
  const [jobHistory, setJobHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [jobsPerPage, setJobsPerPage] = useState(25);
  const router = useRouter();
  const [sortField, setSortField] = useState('jobNumber');
  const [sortDirection, setSortDirection] = useState('asc');
  const { jobStatusTypes: jobStatuses } = useSettings();

  const historyParams = useMemo(
    () => ({
      page: currentPage,
      limit: jobsPerPage,
      search: debouncedSearch,
    }),
    [currentPage, jobsPerPage, debouncedSearch]
  );

  const {
    data: historyData,
    isLoading: loading,
    error: historyError,
  } = useCustomerJobHistoryQuery(customerID, historyParams, { enabled: hasVisited });

  const totalCount = historyData?.totalCount ?? 0;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, customerID, jobsPerPage]);

  useEffect(() => {
    if (historyError) {
      console.error('Error fetching job history:', historyError);
      toast.error('Error loading job history. Please try again.');
      setJobHistory([]);
      return;
    }

    if (!customerID) {
      setJobHistory([]);
      return;
    }

    let cancelled = false;

    const enrichJobs = async () => {
      let jobs = historyData?.jobs || [];
      const needingAifm = jobs.filter((job) => job.needsAifmAddress);
      if (needingAifm.length > 0) {
        try {
          const resolveRes = await fetch('/api/jobs/resolve-addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ jobIds: needingAifm.map((j) => j.id) }),
          });
          if (resolveRes.ok) {
            const { addresses = {} } = await resolveRes.json();
            jobs = jobs.map((job) => {
              const addr = addresses[job.id];
              if (!addr) return job;
              return {
                ...job,
                location: { locationName: addr, id: job.location?.id || null },
                needsAifmAddress: false,
              };
            });
          }
        } catch (resolveErr) {
          console.warn('AIFM address resolve failed:', resolveErr);
        }
      }

      if (!cancelled) {
        setJobHistory(jobs);
      }
    };

    void enrichJobs();

    return () => {
      cancelled = true;
    };
  }, [customerID, historyData, historyError]);

  const resolvedJobStatuses =
    Array.isArray(jobStatuses) && jobStatuses.length > 0
      ? jobStatuses
      : getDefaultJobStatuses();

  const getStatusBadge = (status) => {
    if (!status) return <span className="badge bg-secondary">N/A</span>;
    const displayText = getJobStatusLabelFromList(status, resolvedJobStatuses);
    const bgColor = getJobStatusColorFromList(status, resolvedJobStatuses) ?? "var(--bs-secondary)";
    return (
      <span
        className="badge"
        style={{
          fontSize: "0.75rem",
          padding: "0.35em 0.65em",
          fontWeight: "500",
          borderRadius: "6px",
          backgroundColor: bgColor,
          color: "#fff",
          border: "none",
        }}
      >
        {displayText}
      </span>
    );
  };

  const getIdBadge = (id) => {
    return (
      <Badge style={{ backgroundColor: "#b1c8f3", color: "#fff" }}>{id}</Badge>
    );
  };

  const getWorkerDisplayName = (worker) =>
    worker?.technician?.full_name || 'Unknown Worker';

  // Sort comparator (current API page only)
  const compareJobs = (a, b) => {
    let aVal = null;
    let bVal = null;
    switch (sortField) {
      case 'jobNumber':
        aVal = (a.jobNumber || '').toString();
        bVal = (b.jobNumber || '').toString();
        return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * (sortDirection === 'asc' ? 1 : -1);
      case 'startDate':
        aVal = a.startDate ? new Date(a.startDate).getTime() : 0;
        bVal = b.startDate ? new Date(b.startDate).getTime() : 0;
        return (aVal - bVal) * (sortDirection === 'asc' ? 1 : -1);
      case 'appointmentTime':
        aVal = a.startDate ? new Date(a.startDate).getTime() : 0;
        bVal = b.startDate ? new Date(b.startDate).getTime() : 0;
        return (aVal - bVal) * (sortDirection === 'asc' ? 1 : -1);
      case 'location':
        aVal = (a.location?.locationName || '').toLowerCase();
        bVal = (b.location?.locationName || '').toLowerCase();
        return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * (sortDirection === 'asc' ? 1 : -1);
      case 'jobDescription':
        aVal = (a.jobDescription || '').toString().replace(/<[^>]*>/g, '').toLowerCase();
        bVal = (b.jobDescription || '').toString().replace(/<[^>]*>/g, '').toLowerCase();
        return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * (sortDirection === 'asc' ? 1 : -1);
      case 'assignedWorkers':
        aVal = getWorkerDisplayName(a.assignedWorkers?.[0]);
        bVal = getWorkerDisplayName(b.assignedWorkers?.[0]);
        return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * (sortDirection === 'asc' ? 1 : -1);
      case 'estimatedDurationHours':
        aVal = a.estimatedDurationHours ?? -1;
        bVal = b.estimatedDurationHours ?? -1;
        return (aVal - bVal) * (sortDirection === 'asc' ? 1 : -1);
      case 'jobStatus':
        aVal = (a.jobStatus || '').toLowerCase();
        bVal = (b.jobStatus || '').toLowerCase();
        return (aVal < bVal ? -1 : aVal > bVal ? 1 : 0) * (sortDirection === 'asc' ? 1 : -1);
      default:
        return 0;
    }
  };

  const currentJobs = [...jobHistory].sort(compareJobs);
  const totalPages = Math.max(1, Math.ceil(totalCount / jobsPerPage));

  const handleSort = (field) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
    }
  };

  const getSortIcon = (direction) => {
    return direction === 'asc' ? '↑' : '↓';
  };

  const headerStyle = {
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: '#f8f9fa',
    position: 'relative',
    padding: '12px 8px',
  };

  return (
    <Container fluid className="p-4">
      <Row className="mb-4">
        <Col>
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center">
              <History size={24} className="me-2" />
              <h3 className="mb-0">Job History</h3>
            </div>
            <Button 
              variant="primary"
              onClick={() => router.push(`/dashboard/jobs/create-jobs?customerCode=${customerID}`)}
              className="d-flex align-items-center"
            >
              <span className="me-1">+</span> New Job
            </Button>
          </div>
        </Col>
      </Row>

      {/* Search bar and per-page dropdown */}
      <Row className="mb-3">
        <Col md={6}>
          <InputGroup>
            <InputGroup.Text>
              <Search />
            </InputGroup.Text>
            <Form.Control
              placeholder="Search by keyword (multiple words narrow results): job no, date, location, description, technician, status…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchTerm && (
              <Button
                variant="outline-secondary"
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
              >
                <XCircle />
              </Button>
            )}
          </InputGroup>
        </Col>
        <Col md={3} className="d-flex align-items-center justify-content-end ms-auto">
          <Form.Group className="d-flex align-items-center mb-0">
            <Form.Label className="mb-0 me-2 text-nowrap">Per page:</Form.Label>
            <Form.Select
              value={jobsPerPage}
              onChange={(e) => {
                setJobsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{ width: 'auto', minWidth: '80px' }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover className="shadow-sm">
              <thead className="bg-light">
                <tr>
                  <th onClick={() => handleSort('jobNumber')} style={headerStyle}>
                    Job No {sortField === 'jobNumber' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('startDate')} style={headerStyle}>
                    Date {sortField === 'startDate' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('appointmentTime')} style={headerStyle}>
                    Appt Time {sortField === 'appointmentTime' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('location')} style={headerStyle}>
                    Location {sortField === 'location' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('jobDescription')} style={headerStyle}>
                    Description {sortField === 'jobDescription' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('assignedWorkers')} style={headerStyle}>
                    Technician {sortField === 'assignedWorkers' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('estimatedDurationHours')} style={headerStyle}>
                    Duration {sortField === 'estimatedDurationHours' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('jobStatus')} style={headerStyle}>
                    Status {sortField === 'jobStatus' && getSortIcon(sortDirection)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentJobs.length > 0 ? (
                  currentJobs.map((job) => (
                    <tr key={job.id} className="align-middle">
                      <td>
                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip>View details for job #{job.jobNumber || job.id}</Tooltip>
                          }
                        >
                          <Link
                            href={`/dashboard/jobs/${job.id}`}
                            className="text-decoration-none"
                            style={{ cursor: 'pointer' }}
                          >
                            {getIdBadge(job.jobNumber || job.id)}
                          </Link>
                        </OverlayTrigger>
                      </td>
                      <td>{job.startDate ? new Date(job.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</td>
                      <td>
                        {job.appointmentTime
                          ? (job.appointmentTimeEnd
                              ? `${job.appointmentTime} - ${job.appointmentTimeEnd}`
                              : job.appointmentTime)
                          : 'N/A'}
                      </td>
                      <td>
                        {job.location?.locationName || 'N/A'}
                      </td>
                      <td>{renderJobDescriptionCell(job.jobDescription)}</td>
                      <td>
                        {job.assignedWorkers && job.assignedWorkers.length > 0
                          ? job.assignedWorkers.map((worker) => {
                              const workerName = getWorkerDisplayName(worker);
                              return (
                                <div key={worker.workerId || worker.technician?.id}>
                                  {workerName}
                                </div>
                              );
                            })
                          : "No workers assigned"}
                      </td>
                      <td>{job.estimatedDurationHours ? `${job.estimatedDurationHours} Hrs` : 'N/A'}</td>
                      <td>{getStatusBadge(job.jobStatus)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="text-center py-4">
                      <i className="text-muted">No job history found for this customer.</i>
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>

          {/* Add pagination */}
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalCount}
            onPageChange={(newPage) => setCurrentPage(newPage)}
            disabled={loading}
          />
        </>
      )}
    </Container>
  );
};

export default HistoryTab;
