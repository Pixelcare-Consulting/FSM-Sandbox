import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Form, InputGroup, Container, Row, Col } from 'react-bootstrap';
import TablePagination from 'components/common/TablePagination';
import { formatDistanceToNow } from 'date-fns';
import { Trash, PencilSquare, Search, ArrowLeft, Check, X, CaretUpFill, CaretDownFill } from 'react-bootstrap-icons';
import { getSupabaseClient } from '../../lib/supabase/client';
import { formatSingaporeDateWithTime } from '../../lib/utils/singaporeDateTime';
import toast from 'react-hot-toast';

const headerStyle = {
  cursor: 'pointer',
  userSelect: 'none',
  backgroundColor: '#f8f9fa',
  position: 'relative',
  padding: '12px 8px',
};

export const AllNotesTable = ({ notes: initialNotes = [], onClose, customerId, customerUuid = null }) => {
  const [notes, setNotes] = useState(initialNotes);
  const [totalCount, setTotalCount] = useState(initialNotes.length);
  const [loading, setLoading] = useState(Boolean(customerUuid));
  const [searchTerm, setSearchTerm] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editedContent, setEditedContent] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [notesPerPage] = useState(10);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');

  const fetchNotesPage = useCallback(async (page = currentPage) => {
    if (!customerUuid) return;

    setLoading(true);
    try {
      const searchParams = new URLSearchParams({
        page: String(page),
        limit: String(notesPerPage),
      });
      const response = await fetch(
        `/api/customers/notes/${encodeURIComponent(customerUuid)}?${searchParams.toString()}`,
        { credentials: 'same-origin', cache: 'no-store' }
      );
      if (!response.ok) return;
      const payload = await response.json();
      const rows = (payload.notes || []).map((note) => ({
        ...note,
        createdAt: note.createdAt
          ? (typeof note.createdAt === 'string'
            ? { toDate: () => new Date(note.createdAt) }
            : note.createdAt)
          : null,
      }));
      setNotes(rows);
      setTotalCount(payload.totalCount ?? rows.length);
    } catch (err) {
      console.error('AllNotesTable fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [customerUuid, currentPage, notesPerPage]);

  useEffect(() => {
    if (customerUuid) {
      fetchNotesPage(currentPage);
      return;
    }
    setNotes(initialNotes);
    setTotalCount(initialNotes.length);
  }, [customerUuid, currentPage, notesPerPage, fetchNotesPage, initialNotes]);

  const filteredNotes = notes.filter(note =>
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())) ||
    note.userEmail.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortNotes = (notes) => {
    return [...notes].sort((a, b) => {
      let compareA = a[sortField];
      let compareB = b[sortField];

      if (sortField === 'createdAt') {
        // Handle both Firestore Timestamp objects and ISO strings
        compareA = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : new Date());
        compareB = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : new Date());
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const indexOfLastNote = currentPage * notesPerPage;
  const indexOfFirstNote = indexOfLastNote - notesPerPage;
  const currentNotes = customerUuid
    ? sortNotes(filteredNotes)
    : sortNotes(filteredNotes).slice(indexOfFirstNote, indexOfLastNote);
  const totalPages = customerUuid
    ? Math.max(1, Math.ceil(totalCount / notesPerPage))
    : Math.ceil(filteredNotes.length / notesPerPage);

  const startEditing = (note) => {
    setEditingNoteId(note.id);
    setEditedContent(note.content);
  };

  const cancelEditing = () => {
    setEditingNoteId(null);
    setEditedContent('');
  };

  const handleEditNote = async (note) => {
    if (editedContent.trim() === '') {
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
          content: editedContent,
          updated_at: new Date().toISOString()
        })
        .eq('id', note.id);

      if (error) {
        throw error;
      }

      setEditingNoteId(null);
      setEditedContent('');
      toast.success('Note updated successfully!');
    } catch (error) {
      console.error('Error updating note:', error);
      toast.error(`Error updating note: ${error.message || 'Please try again.'}`);
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

      toast.success('Note deleted successfully!');
    } catch (error) {
      console.error('Error deleting note:', error);
      toast.error(`Error deleting note: ${error.message || 'Please try again.'}`);
    }
  };

  const getSortIcon = (direction) => {
    return direction === 'asc' ? 
      <CaretUpFill className="ms-1" /> : 
      <CaretDownFill className="ms-1" />;
  };

  const handleSort = (field) => {
    setSortDirection(sortField === field && sortDirection === 'asc' ? 'desc' : 'asc');
    setSortField(field);
  };

  return (
    <Container fluid>
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>All Notes</h2>
            <Button variant="outline-secondary" onClick={onClose}>
              <ArrowLeft /> Back to Summary
            </Button>
          </div>
        </Col>
      </Row>

      <Row className="mb-3">
        <Col md={6}>
          <InputGroup>
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
        </Col>
      </Row>

      <Row>
        <Col>
          {loading ? (
            <p className="text-muted text-center py-4">Loading notes...</p>
          ) : (
          <div className="table-responsive">
            <Table striped bordered hover>
              <thead className="bg-light">
                <tr>
                  <th onClick={() => handleSort('content')} style={headerStyle}>
                    Content {sortField === 'content' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('userEmail')} style={headerStyle}>
                    User {sortField === 'userEmail' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('createdAt')} style={headerStyle}>
                    Date {sortField === 'createdAt' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('tags')} style={headerStyle}>
                    Tags {sortField === 'tags' && getSortIcon(sortDirection)}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentNotes.map((note) => (
                  <tr key={note.id}>
                    <td>
                      {editingNoteId === note.id ? (
                        <Form.Control
                          as="textarea"
                          rows={3}
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                        />
                      ) : (
                        note.content
                      )}
                    </td>
                    <td>{note.userEmail}</td>
                    <td>
                      {formatSingaporeDateWithTime(note.createdAt?.toDate?.() ?? note.createdAt) || 'Date not available'}
                      <br />
                      <small>
                        ({formatDistanceToNow(note.createdAt?.toDate ? note.createdAt.toDate() : (note.createdAt ? new Date(note.createdAt) : new Date()), { addSuffix: true })})
                      </small>
                    </td>
                    <td>
                      {note.tags && note.tags.map((tag, index) => (
                        <span key={index} className="badge bg-secondary me-1">{tag}</span>
                      ))}
                    </td>
                    <td>
                      {editingNoteId === note.id ? (
                        <>
                          <Button 
                            variant="outline-success" 
                            size="sm"
                            onClick={() => handleEditNote(note)}
                            className="me-2"
                          >
                            <Check />
                          </Button>
                          <Button 
                            variant="outline-secondary" 
                            size="sm"
                            onClick={cancelEditing}
                          >
                            <X />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button 
                            variant="outline-danger" 
                            size="sm"
                            onClick={() => handleDeleteNote(note.id)}
                            className="me-2"
                          >
                            <Trash />
                          </Button>
                          <Button 
                            variant="outline-primary" 
                            size="sm"
                            onClick={() => startEditing(note)}
                          >
                            <PencilSquare />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          )}
        </Col>
      </Row>

      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={customerUuid ? totalCount : filteredNotes.length}
        onPageChange={(newPage) => setCurrentPage(newPage)}
      />
    </Container>
  );
};
