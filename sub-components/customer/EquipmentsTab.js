import React, { useState, useEffect, useRef } from 'react';
import { Table, Spinner, Button, Modal, Form, InputGroup, Container, Row, Col } from 'react-bootstrap';
import { Search, Eye, CaretUpFill, CaretDownFill, XCircle } from 'react-bootstrap-icons';
import TablePagination from 'components/common/TablePagination';

const headerStyle = {
  cursor: 'pointer',
  userSelect: 'none',
  backgroundColor: '#f8f9fa',
  position: 'relative',
  padding: '12px 8px',
};

const EQUIPMENT_FIELDS = [
  { key: 'ItemCode', label: 'Item Code' },
  { key: 'ModelSeries', label: 'Model Series' },
  
  { key: 'SerialNo', label: 'Serial No' },
  { key: 'ItemName', label: 'Item Name' },
  { key: 'ItemGroup', label: 'Item Group' },

  { key: 'Brand', label: 'Brand' },
  { key: 'WarrantyStartDate', label: 'Warranty Start Date' },
  { key: 'WarrantyEndDate', label: 'Warranty End Date' },

  { key: 'EquipmentLocation', label: 'Equipment Location' },
  { key: 'Notes', label: 'Notes' },
];

const EquipmentsTab = ({ customerData, equipments: initialEquipments = null, onEquipmentsLoaded }) => {
  const [equipments, setEquipments] = useState(
    Array.isArray(initialEquipments) ? initialEquipments : []
  );
  const [loading, setLoading] = useState(!Array.isArray(initialEquipments));
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [equipmentsPerPage, setEquipmentsPerPage] = useState(20);
  const [sortField, setSortField] = useState('ItemCode');
  const [sortDirection, setSortDirection] = useState('desc');
  const fetchGenerationRef = useRef(0);
  const hasFetchedRef = useRef(Array.isArray(initialEquipments));
  const lastCardCodeRef = useRef(customerData?.CardCode);

  useEffect(() => {
    if (customerData?.CardCode !== lastCardCodeRef.current) {
      lastCardCodeRef.current = customerData?.CardCode;
      hasFetchedRef.current = Array.isArray(initialEquipments);
    }

    if (Array.isArray(initialEquipments)) {
      setEquipments(initialEquipments);
      setLoading(false);
      hasFetchedRef.current = true;
      return;
    }

    const cardCode = customerData?.CardCode;
    if (!cardCode || hasFetchedRef.current) {
      if (!cardCode) setLoading(false);
      return;
    }

    hasFetchedRef.current = true;
    const generation = ++fetchGenerationRef.current;
    const isStale = () => generation !== fetchGenerationRef.current;

    const fetchEquipments = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/getEquipments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cardCode }),
        });

        if (!response.ok) {
          throw new Error('Failed to fetch equipment data');
        }

        const data = await response.json();
        const rows = Array.isArray(data) ? data : [];
        if (!isStale()) {
          setEquipments(rows);
          onEquipmentsLoaded?.(rows);
        }
      } catch (err) {
        if (!isStale()) {
          setError(err.message);
        }
      } finally {
        if (!isStale()) {
          setLoading(false);
        }
      }
    };

    fetchEquipments();
  }, [customerData?.CardCode, initialEquipments, onEquipmentsLoaded]);

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1);
  };

  const filteredEquipments = equipments.filter((item) =>
    Object.values(item).some((value) =>
      value != null && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const indexOfLastEquipment = currentPage * equipmentsPerPage;
  const indexOfFirstEquipment = indexOfLastEquipment - equipmentsPerPage;
  const currentEquipments = filteredEquipments.slice(indexOfFirstEquipment, indexOfLastEquipment);
  const totalPages = Math.ceil(filteredEquipments.length / equipmentsPerPage);

  const handleViewDetails = (equipment) => {
    setSelectedEquipment(equipment);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedEquipment(null);
  };

  const buildServiceLocationAddress = (equipment) => {
    const parts = [
      equipment.Building,
      equipment.street,
      equipment.zip,
      equipment.Country
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : 'N/A';
  };

  const handleSort = (field) => {
    setSortDirection(sortField === field && sortDirection === 'asc' ? 'desc' : 'asc');
    setSortField(field);
  };

  const getSortIcon = (direction) => {
    return direction === 'asc' ? 
      <CaretUpFill className="ms-1" /> : 
      <CaretDownFill className="ms-1" />;
  };

  const sortEquipments = (items) => {
    return [...items].sort((a, b) => {
      let compareA = a[sortField];
      let compareB = b[sortField];

      if (sortField === 'ServiceLocationAddress') {
        compareA = buildServiceLocationAddress(a);
        compareB = buildServiceLocationAddress(b);
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const sortedEquipments = sortEquipments(currentEquipments);

  if (loading) {
    return (
      <div className="p-4 text-center">
        <Spinner animation="border" />
        <span className="ms-2">Loading equipment...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-danger">
        Error loading equipment data: {error}
      </div>
    );
  }

  if (!equipments?.length) {
    return (
      <div className="p-4 text-center">
        <p>No equipment records found for this customer.</p>
      </div>
    );
  }

  return (
    <Container fluid>
      <h3 className="mb-4">Customer Equipment</h3>
      <Row className="mb-3">
        <Col md={6}>
          <InputGroup className="mb-3">
            <InputGroup.Text>
              <Search />
            </InputGroup.Text>
            <Form.Control
              type="text"
              placeholder="Search equipment..."
              value={searchTerm}
              onChange={handleSearch}
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
        <Col md={3} className="d-flex align-items-start justify-content-end ms-auto">
          <Form.Group className="d-flex align-items-center mb-0">
            <Form.Label className="mb-0 me-2 text-nowrap">Per page:</Form.Label>
            <Form.Select
              value={equipmentsPerPage}
              onChange={(e) => {
                setEquipmentsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              style={{ width: 'auto', minWidth: '70px' }}
            >
              <option value={20}>20</option>
              <option value={25}>25</option>
              <option value={30}>30</option>
              <option value={40}>40</option>
              <option value={50}>50</option>
            </Form.Select>
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col>
          <div className="table-responsive">
            <Table striped bordered hover className="shadow-sm">
            <thead className="bg-light">
  <tr>
    <th onClick={() => handleSort('ItemCode')} style={headerStyle}>
      Item Code {sortField === 'ItemCode' && getSortIcon(sortDirection)}
    </th>

    <th onClick={() => handleSort('ModelSeries')} style={headerStyle}>
      Model Series {sortField === 'ModelSeries' && getSortIcon(sortDirection)}
    </th>
    <th onClick={() => handleSort('SerialNo')} style={headerStyle}>
      Serial No {sortField === 'SerialNo' && getSortIcon(sortDirection)}
    </th>
    <th onClick={() => handleSort('EquipmentLocation')} style={headerStyle}>
      Location {sortField === 'EquipmentLocation' && getSortIcon(sortDirection)}
    </th>
    <th onClick={() => handleSort('ServiceLocationAddress')} style={headerStyle}>
      Service Location Address {sortField === 'ServiceLocationAddress' && getSortIcon(sortDirection)}
    </th>
    <th onClick={() => handleSort('Notes')} style={headerStyle}>
      Notes {sortField === 'Notes' && getSortIcon(sortDirection)}
    </th>
    <th>Actions</th>
  </tr>
</thead>

<tbody>
  {sortedEquipments.map((item, index) => (
    <tr key={`${item.ItemCode}-${item.SerialNo}-${index}`} className="align-middle">
      <td>{item.ItemCode || 'N/A'}</td>
   
      <td>{item.ModelSeries || 'N/A'}</td>
      <td>{item.SerialNo || 'N/A'}</td>
      <td>{item.EquipmentLocation || 'N/A'}</td>
      <td>{buildServiceLocationAddress(item)}</td>
      <td>{item.Notes || 'N/A'}</td> 

      <td>
        <Button variant="outline-primary" size="sm" onClick={() => handleViewDetails(item)}>
          <Eye className="me-1" /> View Details
        </Button>
      </td>
    </tr>
  ))}
</tbody>
            </Table>
          </div>
        </Col>
      </Row>
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={filteredEquipments.length}
        onPageChange={(newPage) => setCurrentPage(newPage)}
        disabled={loading}
      />

      <Modal show={showModal} onHide={handleCloseModal} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Equipment Details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedEquipment && (
            <Table striped bordered>
              <tbody>
                {EQUIPMENT_FIELDS.map(({ key, label }) => (
                  <tr key={key}>
                    <td className="fw-bold" style={{ width: '200px' }}>{label}</td>
                    <td>{selectedEquipment[key] || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModal}>
            Close
          </Button>
         
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default EquipmentsTab;
