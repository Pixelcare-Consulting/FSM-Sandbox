import React, { useState, useEffect } from 'react';
import { Modal, Form, Button } from 'react-bootstrap';
import { toast } from "react-toastify";
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { fetchFollowUpTypes } from '../utils/followUpSettings';

const FollowUpModal = ({ 
  show, 
  onHide, 
  jobId,
  onSuccess,
  handleCreateFollowUp
}) => {
  const [type, setType] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState(2);
  const [dueDate, setDueDate] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [followUpTypes, setFollowUpTypes] = useState([]);

  const priorityOptions = [
    { value: 1, label: 'Low' },
    { value: 2, label: 'Normal' },
    { value: 3, label: 'High' },
    { value: 4, label: 'Urgent' }
  ];

  useEffect(() => {
    const loadFollowUpTypes = async () => {
      const types = await fetchFollowUpTypes();
      setFollowUpTypes(types);
    };

    loadFollowUpTypes();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const followUpData = {
        type,
        notes,
        priority,
        dueDate: dueDate ? dueDate.toISOString() : null,
        status: "Open"
      };

      // handleCreateFollowUp returns the created follow-up
      const createdFollowUp = await handleCreateFollowUp(followUpData);
      
      // Reset form
      setType('');
      setNotes('');
      setPriority(2);
      setDueDate(null);
      
      // Call onSuccess with the created follow-up (not the input data)
      if (onSuccess && createdFollowUp) {
        onSuccess(createdFollowUp);
      }

      onHide();
    } catch (error) {
      console.error('Error creating follow-up:', error);
      const errorMessage = error?.message || "Failed to create follow-up";
      toast.error(errorMessage, {
        autoClose: 5000,
      });
      // Don't close modal on error so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Create Follow-up</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Type</Form.Label>
            <Form.Select 
              value={type} 
              onChange={(e) => setType(e.target.value)}
              required
            >
              <option value="">Select Type</option>
              {followUpTypes.map((type) => (
                <option 
                  key={type.id}
                  value={type.name}
                  style={{ color: type.color }}
                >
                  {type.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Priority</Form.Label>
            <Form.Select
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            >
              {priorityOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Due Date</Form.Label>
            <DatePicker
              selected={dueDate}
              onChange={(date) => setDueDate(date)}
              className="form-control"
              dateFormat="MMM d, yyyy"
              minDate={new Date()}
              placeholderText="Select due date"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Notes</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter follow-up details..."
              required
            />
          </Form.Group>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" onClick={onHide}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Creating...
                </>
              ) : (
                'Create Follow-up'
              )}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
};

export default FollowUpModal; 