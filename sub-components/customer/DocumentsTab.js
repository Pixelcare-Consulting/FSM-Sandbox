import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Table, Button, Badge, Form, Modal, Spinner, ProgressBar, Container, InputGroup } from 'react-bootstrap';
import { FileText, Download, Upload, Search, XCircle } from 'lucide-react';
import { getSupabaseClient } from '../../lib/supabase/client';
import { uploadFile, getDownloadURL, deleteFile, listFiles, uploadFileWithProgress } from '../../lib/supabase/storage';
import { formatSingaporeDate } from '../../lib/utils/singaporeDateTime';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import TablePagination from 'components/common/TablePagination';

export const DocumentsTab = ({ customerData }) => {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const [viewDocumentHtml, setViewDocumentHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [documentsPerPage] = useState(10);

  // Supabase storage is accessed via uploadFile function

  const headerStyle = {
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: '#f8f9fa',
    position: 'relative',
    padding: '12px 8px',
  };

  useEffect(() => {
    if (customerData?.CardCode) {
      fetchDocuments();
    }
  }, [customerData?.CardCode]);

  const fetchDocuments = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      if (!customerData?.CardCode) {
        return;
      }

      // List files from Supabase Storage - check both root and documents subfolder
      const basePath = `customers/${customerData.CardCode}`;
      let files = [];
      
      try {
        // Try listing from documents subfolder first
        files = await listFiles('documents', `${basePath}/documents`, {
          limit: 100
        });
      } catch (error) {
        // If that fails, try listing from the base path
        try {
          files = await listFiles('documents', basePath, {
            limit: 100
          });
        } catch (err) {
          console.error('Error listing files:', err);
          files = [];
        }
      }

      // Transform to match expected format
      const docs = files
        .filter(file => file.name && !file.name.endsWith('/')) // Filter out folders
        .map(file => {
          const fileName = file.name.split('/').pop(); // Get just the filename
          const filePath = file.name.startsWith(basePath) ? file.name : `${basePath}/documents/${fileName}`;
          return {
            id: file.id || file.name,
            name: fileName,
            type: fileName.split('.').pop()?.toUpperCase() || 'UNKNOWN',
            uploadDate: file.created_at || file.updated_at || new Date().toISOString(),
            size: file.metadata?.size ? `${(file.metadata.size / 1024).toFixed(2)} KB` : (file.size ? `${(file.size / 1024).toFixed(2)} KB` : 'Unknown'),
            url: getDownloadURL('documents', filePath),
            fullPath: filePath
          };
        });

      setDocuments(docs);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to fetch documents');
    }
  };

  const handleUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!customerData?.CardCode) {
      toast.error('Customer data not available');
      return;
    }

    setUploading(true);
    setShowUploadModal(true);
    setUploadProgress(0);

    try {
      // Create a unique filename to avoid conflicts
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `customers/${customerData.CardCode}/documents/${fileName}`;
      
      // Upload with progress tracking
      await uploadFileWithProgress(
        'documents',
        filePath,
        file,
        (progress) => {
          setUploadProgress(progress.bytesTransferred / progress.totalBytes * 100);
        },
        { upsert: true }
      );

      toast.success('Document uploaded successfully');
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      // Refresh documents list
      await fetchDocuments();
      setShowUploadModal(false);
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error(`Failed to upload document: ${error.message || 'Unknown error'}`);
      setShowUploadModal(false);
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (document) => {
    setLoading(true);
    
    try {
      if (['XLSX', 'XLS'].includes(document.type)) {
        // For Excel files, open in a new tab
        window.open(document.url, '_blank');
      } else if (['PDF'].includes(document.type)) {
        // For PDFs, open in a new tab
        window.open(document.url, '_blank');
      } else {
        // For other file types, show download prompt
        handleDownload(document.url);
      }
    } catch (error) {
      console.error('Error viewing document:', error);
      toast.error('Failed to view document. Try downloading instead.');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseViewModal = () => {
    setViewDocumentHtml(null);
  };

  const handleDownload = (documentUrl) => {
    window.open(documentUrl, '_blank');
  };

  const handleDelete = async (docId, fileName, fullPath) => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Delete from Supabase Storage - use fullPath if available, otherwise construct path
      const filePath = fullPath || `customers/${customerData.CardCode}/documents/${fileName}`;
      await deleteFile('documents', filePath);
      toast.success('Document deleted successfully');
      await fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error(`Failed to delete document: ${error.message || 'Unknown error'}`);
    }
  };

  const getTypeColor = (type) => {
    const colors = {
      'PDF': 'danger',
      'XLSX': 'success',
      'XLS': 'success',
      'DOC': 'primary',
      'DOCX': 'primary',
      'JPG': 'info',
      'PNG': 'info'
    };
    return colors[type] || 'secondary';
  };

  const handleUploadClick = () => {
    fileInputRef.current.click();
  };

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

  // Filter documents based on search term
  const filteredDocuments = documents.filter(doc =>
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedDocuments = [...filteredDocuments].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === 'type') {
      comparison = a.type.localeCompare(b.type);
    } else if (sortField === 'uploadDate') {
      comparison = new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime();
    } else if (sortField === 'size') {
      comparison = a.size.localeCompare(b.size);
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Pagination logic
  const indexOfLastDocument = currentPage * documentsPerPage;
  const indexOfFirstDocument = indexOfLastDocument - documentsPerPage;
  const currentDocuments = sortedDocuments.slice(indexOfFirstDocument, indexOfLastDocument);
  const totalPages = Math.ceil(sortedDocuments.length / documentsPerPage);

  return (
    <Container fluid>
      <Row className="p-4">
        <Col>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <div className="d-flex align-items-center">
              <FileText size={24} className="me-2" />
              <h3 className="mb-0">Customer Documents</h3>
            </div>
            <Button
              variant="primary"
              onClick={handleUploadClick}
              disabled={uploading}
            >
              <Upload size={14} className="me-2" />
              Upload Document
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleUpload}
              accept="*/*"
            />
          </div>
          <Row className="mb-3">
            <Col md={6}>
              <InputGroup>
                <InputGroup.Text>
                  <Search />
                </InputGroup.Text>
                <Form.Control
                  placeholder="Search documents..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1); // Reset to first page when searching
                  }}
                />
                {searchTerm && (
                  <Button variant="outline-secondary" onClick={() => setSearchTerm('')}>
                    <XCircle />
                  </Button>
                )}
              </InputGroup>
            </Col>
          </Row>

          <div className="table-responsive">
            <Table striped bordered hover className="shadow-sm">
              <thead className="bg-light">
                <tr>
                  <th onClick={() => handleSort('name')} style={headerStyle}>
                    Document Name {sortField === 'name' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('type')} style={headerStyle}>
                    Type {sortField === 'type' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('uploadDate')} style={headerStyle}>
                    Upload Date {sortField === 'uploadDate' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('size')} style={headerStyle}>
                    Size {sortField === 'size' && getSortIcon(sortDirection)}
                  </th>
                  <th style={{ width: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentDocuments.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center py-4 text-muted">
                      {searchTerm ? 'No documents found matching your search.' : 'No documents uploaded yet.'}
                    </td>
                  </tr>
                ) : (
                  currentDocuments.map((doc) => (
                  <tr key={doc.id} className="align-middle">
                    <td>
                      <div className="fw-medium">{doc.name}</div>
                    </td>
                    <td>
                      <Badge bg={getTypeColor(doc.type)}>{doc.type}</Badge>
                    </td>
                    <td>{formatSingaporeDate(doc.uploadDate) || 'Date not available'}</td>
                    <td>{doc.size}</td>
                    <td>
                      <Button 
                        variant="outline-primary" 
                        size="sm" 
                        onClick={() => handleView(doc)}
                        className="me-2"
                        disabled={loading}
                      >
                        View
                      </Button>
                      <Button 
                        variant="outline-primary" 
                        size="sm" 
                        onClick={() => handleDownload(doc.url)}
                        className="me-2"
                      >
                        <Download size={14} className="me-1" />
                        Download
                      </Button>
                      <Button 
                        variant="outline-danger" 
                        size="sm" 
                        onClick={() => handleDelete(doc.id, doc.name, doc.fullPath)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>

          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={sortedDocuments.length}
            onPageChange={(newPage) => setCurrentPage(newPage)}
            disabled={loading || uploading}
          />
        </Col>
      </Row>

      {/* Upload Modal */}
      <Modal show={showUploadModal} centered backdrop="static" keyboard={false}>
        <Modal.Body className="text-center">
          <h4>Uploading Document</h4>
          <Spinner animation="border" role="status" className="my-3" />
          <p>Please wait while your document is being uploaded...</p>
          <ProgressBar now={uploadProgress} label={`${Math.round(uploadProgress)}%`} className="mt-3" />
        </Modal.Body>
      </Modal>

      {/* View Document Modal */}
      <Modal show={!!viewDocumentHtml} onHide={handleCloseViewModal} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>View Document</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div dangerouslySetInnerHTML={{ __html: viewDocumentHtml }} />
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default DocumentsTab;