import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ClipLoader } from 'react-spinners';
import { BsCalendarX } from 'react-icons/bs';
import TimelineHeader from './TimelineHeader';
import TechnicianRow from './TechnicianRow';
import ToolbarControls from './ToolbarControls';
import JobDetailModal from './JobDetailModal';
import styles from './TimelineScheduler.module.css';

const TimelineScheduler = ({
  resources = [],
  events = [],
  loading = false,
  startHour = 6,
  endHour = 21,
  cellWidth = 60,
  selectedDate: externalDate,
  onDateChange: externalDateChange,
  onCellClick,
  onEventClick,
  onEventDrop,
  onRefresh,
  onDownload,
  onViewJob,
  onReassign,
  customers = [],
}) => {
  const [internalDate, setInternalDate] = useState(new Date());
  const [searchValue, setSearchValue] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [viewMode, setViewMode] = useState('day');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Use external date if provided, otherwise use internal
  const selectedDate = externalDate || internalDate;
  const handleDateChange = externalDateChange || setInternalDate;

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Filter resources by search
  const filteredResources = useMemo(() => {
    if (!searchValue.trim()) return resources;
    const query = searchValue.toLowerCase();
    return resources.filter((resource) =>
      (resource.text || resource.name || '').toLowerCase().includes(query)
    );
  }, [resources, searchValue]);

  // Filter events by resources and customer
  const filteredEvents = useMemo(() => {
    let filtered = events;
    
    // Filter by visible technicians
    if (searchValue.trim()) {
      const allowedIds = new Set(
        filteredResources.map((r) => String(r.resourceId || r.id))
      );
      filtered = filtered.filter((event) => {
        const techId = String(event.resourceId || event.technicianId);
        return allowedIds.has(techId);
      });
    }
    
    // Filter by customer
    if (customerFilter) {
      filtered = filtered.filter((event) => 
        event.customerId === customerFilter || 
        event.meta?.customerId === customerFilter
      );
    }
    
    return filtered;
  }, [events, filteredResources, searchValue, customerFilter]);

  const handleEventClick = useCallback((event) => {
    setSelectedEvent(event);
    onEventClick?.(event);
  }, [onEventClick]);

  const handleCloseModal = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const handleViewFullJob = useCallback((jobId) => {
    if (!jobId) return;
    window.open(`/dashboard/jobs/${jobId}`, '_blank', 'noopener,noreferrer');
    handleCloseModal();
    onViewJob?.(jobId);
  }, [onViewJob, handleCloseModal]);

  const handleReassign = useCallback(async (event, newTechnician) => {
    if (!onReassign) return;
    await onReassign(event, newTechnician);
    handleCloseModal();
  }, [onReassign, handleCloseModal]);

  const handleDownload = useCallback(() => {
    onDownload?.();
  }, [onDownload]);

  if (loading) {
    return (
      <div className={styles.loadingOverlay}>
        <div className={styles.loadingCard}>
          <ClipLoader color="#3b82f6" size={48} />
          <p className={styles.loadingText}>Loading Schedule...</p>
          <p className={styles.loadingSubtext}>Fetching technician availability and jobs</p>
        </div>
      </div>
    );
  }

  const totalHours = endHour - startHour;

  return (
    <div className={styles.schedulerContainer}>
      {/* Toolbar */}
      <ToolbarControls
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        customerFilter={customerFilter}
        onCustomerFilterChange={setCustomerFilter}
        customers={customers}
        onRefresh={onRefresh}
        onDownload={handleDownload}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isLoading={loading}
      />

      {/* Timeline */}
      <div className={styles.timelineWrapper}>
        {filteredResources.length === 0 ? (
          <div className={styles.emptyState}>
            <BsCalendarX className={styles.emptyStateIcon} />
            <h3 className={styles.emptyStateTitle}>No Workers Found</h3>
            <p className={styles.emptyStateText}>
              {searchValue 
                ? `No workers match "${searchValue}". Try a different search term.`
                : 'No technicians are available. Add workers to start scheduling.'}
            </p>
          </div>
        ) : (
          <div 
            className={styles.timeline}
            style={{
              gridTemplateColumns: `140px repeat(${totalHours}, minmax(${cellWidth}px, 1fr))`,
            }}
          >
            {/* Header */}
            <TimelineHeader
              selectedDate={selectedDate}
              startHour={startHour}
              endHour={endHour}
              cellWidth={cellWidth}
              currentTime={currentTime}
            />

            {/* Technician Rows */}
            {filteredResources.map((technician) => (
                <TechnicianRow
                  key={technician.resourceId || technician.id}
                  technician={technician}
                  events={filteredEvents}
                  selectedDate={selectedDate}
                  startHour={startHour}
                  endHour={endHour}
                  cellWidth={cellWidth}
                  onCellClick={onCellClick}
                  onEventClick={handleEventClick}
                  onEventDrop={onEventDrop}
                  currentTime={currentTime}
                />
              ))}
          </div>
        )}
      </div>

      {/* Job Detail Modal */}
      {selectedEvent && (
        <JobDetailModal
          event={selectedEvent}
          onClose={handleCloseModal}
          onViewJob={handleViewFullJob}
          onReassign={handleReassign}
          technicians={resources}
        />
      )}
    </div>
  );
};

export default TimelineScheduler;

