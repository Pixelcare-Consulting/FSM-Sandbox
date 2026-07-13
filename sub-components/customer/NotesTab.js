import React, { useState, useEffect, useCallback } from 'react';
import { Form, Button, Card, ListGroup, Row, Col, InputGroup, Modal, Badge } from 'react-bootstrap';
import TablePagination from 'components/common/TablePagination';
import { getSupabaseClient } from '../../lib/supabase/client';
import { customerService } from '../../lib/supabase/database';
import { Trash, PencilSquare, Plus, Save, X, Tags, Search } from 'react-bootstrap-icons';
import { formatDistanceToNow } from 'date-fns';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';
import { formatSingaporeDateWithTime } from '../../lib/utils/singaporeDateTime';
import { AllNotesTable } from './AllNotesTable';

function normalizeNoteRow(note) {
  return {
    id: note.id,
    content: note.content,
    userEmail: note.userEmail || note.user_email || 'Unknown',
    tags: note.tags || [],
    createdAt: note.createdAt
      ? (typeof note.createdAt === 'string'
        ? { toDate: () => new Date(note.createdAt) }
        : note.createdAt)
      : null,
    updatedAt: note.updatedAt
      ? (typeof note.updatedAt === 'string'
        ? { toDate: () => new Date(note.updatedAt) }
        : note.updatedAt)
      : null,
  };
}

export const NotesTab = ({ customerId, customerUuid: customerUuidProp = null }) => {
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [latestNote, setLatestNote] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [customerUuid, setCustomerUuid] = useState(customerUuidProp);
  const [notesLoading, setNotesLoading] = useState(false);
  const [totalNoteCount, setTotalNoteCount] = useState(0);

  const [availableTags, setAvailableTags] = useState(['Important', 'Follow-up', 'Resolved', 'Pending', 'Question']);

  const [userEmail, setUserEmail] = useState('');

  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [notesPerPage] = useState(3);
  const [searchTerm, setSearchTerm] = useState('');

  const [showAllNotes, setShowAllNotes] = useState(false);

  useEffect(() => {
    // Retrieve email from cookies
    const emailFromCookie = Cookies.get('email');
    setUserEmail(emailFromCookie || 'Unknown');
  }, []);

  // Resolve customer UUID — skip findByCode when bundle already provided it
  useEffect(() => {
    if (customerUuidProp) {
      setCustomerUuid(customerUuidProp);
      return;
    }

    const fetchCustomerUuid = async () => {
      if (!customerId) return;

      try {
        const customer = await customerService.findByCode(customerId);
        if (customer) {
          setCustomerUuid(customer.id);
        }
      } catch (error) {
        console.error('Error fetching customer UUID:', error);
      }
    };

    fetchCustomerUuid();
  }, [customerId, customerUuidProp]);

  const fetchNotesPage = useCallback(async (page = currentPage) => {
    if (!customerUuid) return;

    setNotesLoading(true);
    try {
      const searchParams = new URLSearchParams({
        page: String(page),
        limit: String(notesPerPage),
      });
      const response = await fetch(
        `/api/customers/notes/${encodeURIComponent(customerUuid)}?${searchParams.toString()}`,
        { credentials: 'same-origin', cache: 'no-store' }
      );

      if (!response.ok) {
        console.error('Error fetching notes:', await response.text());
        return;
      }

      const payload = await response.json();
      const fetchedNotes = (payload.notes || []).map(normalizeNoteRow);
      setNotes(fetchedNotes);
      setTotalNoteCount(payload.totalCount ?? fetchedNotes.length);
      if (fetchedNotes.length > 0 && page === 1) {
        setLatestNote(fetchedNotes[0]);
      } else if (fetchedNotes.length === 0) {
        setLatestNote(null);
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    } finally {
      setNotesLoading(false);
    }
  }, [customerUuid, currentPage, notesPerPage]);

  useEffect(() => {
    if (!customerUuid) return;
    fetchNotesPage(currentPage);
  }, [customerUuid, currentPage, notesPerPage, fetchNotesPage]);

  useEffect(() => {
    if (!customerUuid) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    let debounceTimer = null;

    const channel = supabase
      .channel(`customer_notes:${customerUuid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_notes',
          filter: `customer_id=eq.${customerUuid}`
        },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            fetchNotesPage(currentPage);
          }, 400);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [customerUuid, currentPage, fetchNotesPage]);

  // Filter notes based on search term
  const filteredNotes = notes.filter(note =>
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
    note.userEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const currentNotes = filteredNotes;

  const paginate = (pageNumber) => setCurrentPage(pageNumber);

  const totalPages = Math.max(1, Math.ceil(totalNoteCount / notesPerPage));

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (newNote.trim() === '') {
      toast.error('Please enter a note before adding.');
      return;
    }

    if (!customerUuid) {
      toast.error('Customer not found. Please refresh the page.');
      return;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('customer_notes')
        .insert({
          customer_id: customerUuid,
          content: newNote,
          tags: selectedTags,
          user_email: userEmail
        });

      if (error) {
        throw error;
      }

      setNewNote('');
      setSelectedTags([]);
      setShowTagModal(false);
      toast.success('Note added successfully!');
      setCurrentPage(1);
      await fetchNotesPage(1);
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error(`Error adding note: ${error.message || 'Please try again.'}`);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('customer_notes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', noteId);

      if (error) {
        throw error;
      }

      // Optimistically update the UI
      const updatedNotes = notes.filter(note => note.id !== noteId);
      setNotes(updatedNotes);
      
      if (latestNote && latestNote.id === noteId) {
        setLatestNote(updatedNotes.length > 0 ? updatedNotes[0] : null);
      }
      
      toast.success('Note deleted successfully!');
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error(`Error deleting note: ${error.message || 'Please try again.'}`);
      await fetchNotesPage(currentPage);
    }
  };

  const handleEditNote = async (updatedNote) => {
    if (updatedNote.content.trim() === '') {
      toast.error('Note content cannot be empty');
      return;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('customer_notes')
        .update({
          content: updatedNote.content,
          updated_at: new Date().toISOString()
        })
        .eq('id', updatedNote.id);

      if (error) {
        throw error;
      }

      // Optimistically update the UI
      const updatedNotes = notes.map(note => 
        note.id === updatedNote.id 
          ? { ...note, content: updatedNote.content, updatedAt: { toDate: () => new Date() } }
          : note
      );
      setNotes(updatedNotes);
      
      setEditingNote(null);
      toast.success('Note updated successfully!');
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error(`Error updating note: ${error.message || 'Please try again.'}`);
    }
  };

  const handleSaveEdit = async () => {
    if (newNote.trim() === '') {
      toast.error('Note content cannot be empty');
      return;
    }

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const { error } = await supabase
        .from('customer_notes')
        .update({
          content: newNote,
          tags: selectedTags,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingNote.id);

      if (error) {
        throw error;
      }

      // Optimistically update the UI
      const updatedNotes = notes.map(note => 
        note.id === editingNote.id 
          ? { ...note, content: newNote, tags: selectedTags, updatedAt: { toDate: () => new Date() } }
          : note
      );
      setNotes(updatedNotes);

      setEditingNote(null);
      setNewNote('');
      setSelectedTags([]);
      toast.success('Note updated successfully!');
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error(`Error updating note: ${error.message || 'Please try again.'}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingNote(null);
    setNewNote('');
    setSelectedTags([]);
  };

  const handleTagSelection = (tag) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleAddNewTag = () => {
    if (newTag.trim() !== '' && !availableTags.includes(newTag.trim())) {
      const trimmedTag = newTag.trim();
      setAvailableTags(prev => [...prev, trimmedTag]);
      setSelectedTags(prev => [...prev, trimmedTag]);
      setNewTag('');
      setShowToast(true);
      setToastMessage(`New tag "${trimmedTag}" added successfully!`);
    }
  };

  const handleRemoveNewTag = (tagToRemove) => {
    setSelectedTags(prev => prev.filter(tag => tag !== tagToRemove));
    setAvailableTags(prev => prev.filter(tag => tag !== tagToRemove));
    setShowToast(true);
    setToastMessage(`Tag "${tagToRemove}" removed successfully!`);
  };

  // Add this function to handle view change
  const handleViewChange = (showAll) => {
    setShowAllNotes(showAll);
    setSearchTerm(''); // Clear search term when changing views
    setCurrentPage(1); // Reset to first page
  };

  return (
    <>
      {!showAllNotes ? (
        <Row className="g-4">
          <Col md={8}>
            <Card className="shadow-sm">
              <Card.Header className="bg-light">
                <h5 className="mb-0">Customer Notes</h5>
              </Card.Header>
              <Card.Body>
                {/* Add search input */}
                <InputGroup className="mb-3">
                  <InputGroup.Text>
                    <Search />
                  </InputGroup.Text>
                  <Form.Control
                    type="text"
                    placeholder="Search notes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </InputGroup>

                <ListGroup variant="flush">
                  {notesLoading ? (
                    <ListGroup.Item className="text-center py-4 text-muted">
                      Loading notes...
                    </ListGroup.Item>
                  ) : currentNotes.length === 0 ? (
                    <ListGroup.Item className="text-center py-4 text-muted">
                      No notes found.
                    </ListGroup.Item>
                  ) : (
                  currentNotes.map((note) => (
                    <ListGroup.Item key={note.id} className="border-bottom py-3">
                      <Row>
                        {/* Left side: Note content, tags, and email */}
                        <Col xs={9}>
                          {editingNote && editingNote.id === note.id ? (
                            <>
                              <Form.Control
                                as="textarea"
                                rows={3}
                                value={editingNote.content}
                                onChange={(e) => setEditingNote({...editingNote, content: e.target.value})}
                              />
                              <Button variant="outline-secondary" onClick={() => setShowTagModal(true)} className="mt-2">
                                <Tags /> Edit Tags
                              </Button>
                            </>
                          ) : (
                            <>
                              <p className="mb-1">{note.content}</p>
                              {note.tags && note.tags.length > 0 && (
                                <div className="mb-2">
                                  {note.tags.map((tag, index) => (
                                    <Badge key={index} bg="secondary" className="me-1">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              <small className="text-muted d-block mt-2">
                                By: {note.userEmail}
                              </small>
                            </>
                          )}
                        </Col>

                        {/* Right side: Date and action buttons */}
                        <Col xs={3} className="text-end">
                          <div className="mb-2">
                            <small className="text-muted d-block">
                              {formatSingaporeDateWithTime(note.createdAt?.toDate?.() ?? note.createdAt) || 'Date not available'}
                            </small>
                          </div>
                          
                          {editingNote && editingNote.id === note.id ? (
                            <div>
                              <Button 
                                variant="success" 
                                size="sm"
                                onClick={() => handleEditNote(editingNote)}
                                className="me-1 mb-1"
                              >
                                <Save /> Save
                              </Button>
                              <Button 
                                variant="secondary" 
                                size="sm"
                                onClick={() => setEditingNote(null)}
                                className="mb-1"
                              >
                                <X /> Cancel
                              </Button>
                            </div>
                          ) : (
                            <div>
                              <Button 
                                variant="outline-primary" 
                                size="sm"
                                onClick={() => setEditingNote(note)}
                                className="me-1 mb-1"
                              >
                                <PencilSquare /> Edit
                              </Button>
                              <Button 
                                variant="outline-danger" 
                                size="sm"
                                onClick={() => handleDeleteNote(note.id)}
                                className="mb-1"
                              >
                                <Trash /> Delete
                              </Button>
                            </div>
                          )}
                        </Col>
                      </Row>
                    </ListGroup.Item>
                  )))}
                </ListGroup>

                {/* Pagination */}
                <TablePagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalNoteCount}
                  onPageChange={(newPage) => paginate(newPage)}
                />

                <Button 
                  variant="primary" 
                  onClick={() => handleViewChange(true)}
                  className="w-100 mt-3"
                >
                  View All Notes
                </Button>
              </Card.Body>
            </Card>
          </Col>
          <Col md={4}>
            {/* <Card className="shadow-sm mb-4">
              <Card.Header className="bg-light">
                <h5 className="mb-0">Latest Note</h5>
              </Card.Header>
              <Card.Body>
                {latestNote ? (
                  <>
                    <Card.Text>{latestNote.content}</Card.Text>
                    <Card.Subtitle className="text-muted mt-2">
                      {formatSingaporeDateWithTime(latestNote.createdAt?.toDate?.() ?? latestNote.createdAt) || 'Date not available'}
                      ({formatDistanceToNow(latestNote.createdAt?.toDate() || new Date(), { addSuffix: true })})
                    </Card.Subtitle>
                    <div className="mt-2">
                      <small className="text-muted">By: {latestNote.userEmail}</small>
                    </div>
                    <div className="mt-2">
                      {latestNote.tags && latestNote.tags.map((tag, index) => (
                        <span key={index} className="badge bg-secondary me-1">{tag}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-muted">No notes available</p>
                )}
              </Card.Body>
            </Card> */}
            <Card className="shadow-sm mb-4">
              <Card.Header className="bg-light">
                <h5 className="mb-0">Add Note</h5>
              </Card.Header>
              <Card.Body>
                <Form onSubmit={editingNote ? handleSaveEdit : handleAddNote}>
                  <Form.Group className="mb-3">
                    <Form.Control
                      as="textarea"
                      rows={3}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder={editingNote ? "Edit your note here..." : "Enter your note here..."}
                    />
                  </Form.Group>
                  <Button variant="outline-secondary" onClick={() => setShowTagModal(true)} className="mb-2 w-100">
                    <Tags /> Add Tags
                  </Button>
                  {editingNote ? (
                    <>
                      <Button variant="success" onClick={handleSaveEdit} className="me-2 mb-2">
                        <Save className="me-1" /> Save
                      </Button>
                      <Button variant="secondary" onClick={handleCancelEdit} className="mb-2">
                        <X className="me-1" /> Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" type="submit" className="w-100">
                      <Plus className="me-1" /> Add Note
                    </Button>
                  )}
                </Form>
              </Card.Body>
            </Card>

            <Col md={12} className="mt-4">
             
            </Col>
          </Col>
        </Row>
      ) : (
        <AllNotesTable 
          notes={notes} 
          onClose={() => handleViewChange(false)}
          customerId={customerId}
          customerUuid={customerUuid}
        />
      )}

      <Modal show={showTagModal} onHide={() => setShowTagModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Select Tags</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {availableTags.map((tag, index) => (
            <Button
              key={index}
              variant={selectedTags.includes(tag) ? "primary" : "outline-primary"}
              className="me-2 mb-2"
              onClick={() => handleTagSelection(tag)}
            >
              {tag}
              {!['Important', 'Follow-up', 'Resolved', 'Pending', 'Question'].includes(tag) && (
                <X
                  className="ms-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveNewTag(tag);
                  }}
                />
              )}
            </Button>
          ))}
          <Form.Group className="mt-3">
            <Form.Control
              type="text"
              placeholder="Add new tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
            />
            <Button variant="secondary" className="mt-2" onClick={handleAddNewTag}>
              Add New Tag
            </Button>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowTagModal(false)}>
            Close
          </Button>
          <Button variant="primary" onClick={() => setShowTagModal(false)}>
            Apply Tags
          </Button>
        </Modal.Footer>
      </Modal>

    
    </>
  );
};
