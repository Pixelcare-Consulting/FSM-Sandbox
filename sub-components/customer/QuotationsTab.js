// QuotationsTab.js
import React, { useState, useEffect } from 'react';
import { Table, Spinner, Alert, Container, Row, Col, Form, InputGroup, Button } from 'react-bootstrap';
import { Search, Calendar, XCircle, CaretUpFill, CaretDownFill } from 'react-bootstrap-icons';
import { format, parse, isValid, startOfDay, endOfDay } from 'date-fns';
import TablePagination from 'components/common/TablePagination';

const QuotationsTab = ({ customerId }) => {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [quotationsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [maxRetries] = useState(2);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState('DocNum');
  const [sortDirection, setSortDirection] = useState('desc');

  useEffect(() => {
    const fetchQuotations = async () => {
      if (!customerId) {
        setError('Customer ID is required');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await fetch('/api/getQuotations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cardCode: customerId,
            page: currentPage,
            limit: quotationsPerPage,
          }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const apiMessage =
            (data && (data.error || data.message)) ||
            response.statusText ||
            `HTTP ${response.status}`;
          setError(typeof apiMessage === 'string' ? apiMessage : 'Failed to load quotations');
          setQuotations([]);
          return;
        }

        if (!data) {
          setError('Invalid response from quotations API');
          setQuotations([]);
          return;
        }

        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data.quotations)
            ? data.quotations
            : Array.isArray(data.data)
              ? data.data
              : [];

        setQuotations(rows);
        setTotalCount(
          typeof data.totalCount === 'number' ? data.totalCount : rows.length
        );
        setError(null);
        setRetryCount(0);
      } catch (err) {
        console.error('Error fetching quotations:', err);
        setError(err.message);

        if (retryCount < maxRetries) {
          setTimeout(() => {
            setRetryCount((prev) => prev + 1);
          }, 1000 * (retryCount + 1));
        } else {
          setQuotations([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchQuotations();
  }, [customerId, currentPage, quotationsPerPage, retryCount, maxRetries]);

  useEffect(() => {
    setQuotations([]);
    setError(null);
    setRetryCount(0);
    setLoading(true);
    setCurrentPage(1);
    setTotalCount(0);
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
  }, [customerId]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const year = dateString.substring(0, 4);
      const month = dateString.substring(4, 6);
      const day = dateString.substring(6, 8);
      const date = new Date(year, month - 1, day);
      return format(date, 'dd/MM/yyyy');
    } catch (error) {
      console.error('Error parsing date:', error);
      return 'Invalid Date';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const parseQuoteDocDate = (docDate) => {
    if (!docDate || String(docDate).length < 8) return null;
    try {
      const y = String(docDate).substring(0, 4);
      const m = String(docDate).substring(4, 6);
      const d = String(docDate).substring(6, 8);
      return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    } catch {
      return null;
    }
  };

  const filteredQuotations = quotations.filter((quote) => {
    const matchesSearch = Object.values(quote).some(
      (value) =>
        value && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );

    let matchesStatus = true;
    if (statusFilter === 'open') {
      matchesStatus = quote.DocStatus !== 'C';
    } else if (statusFilter === 'closed') {
      matchesStatus = quote.DocStatus === 'C';
    }

    let matchesDateRange = true;
    if (dateFrom || dateTo) {
      const qd = parseQuoteDocDate(quote.DocDate);
      if (!qd) {
        matchesDateRange = false;
      } else {
        if (dateFrom) {
          const from = startOfDay(parse(dateFrom, 'yyyy-MM-dd', new Date()));
          if (isValid(from) && qd < from) matchesDateRange = false;
        }
        if (dateTo && matchesDateRange) {
          const to = endOfDay(parse(dateTo, 'yyyy-MM-dd', new Date()));
          if (isValid(to) && qd > to) matchesDateRange = false;
        }
      }
    }

    return matchesSearch && matchesStatus && matchesDateRange;
  });

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleDateFrom = (e) => {
    setDateFrom(e.target.value);
    setCurrentPage(1);
  };

  const handleDateTo = (e) => {
    setDateTo(e.target.value);
    setCurrentPage(1);
  };

  const handleStatusFilter = (e) => {
    setStatusFilter(e.target.value);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
    setCurrentPage(1);
  };

  const hasActiveFilters =
    !!searchTerm.trim() || !!dateFrom || !!dateTo || statusFilter !== 'all';

  const sortQuotations = (quotations) => {
    return [...quotations].sort((a, b) => {
      let compareA = a[sortField];
      let compareB = b[sortField];

      // Special handling for dates
      if (sortField === 'DocDate') {
        compareA = parseInt(compareA);
        compareB = parseInt(compareB);
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // API already returns the current page; only sort/filter the fetched rows (no client page slice).
  const currentQuotations = sortQuotations(filteredQuotations);
  const totalPages = Math.max(1, Math.ceil(totalCount / quotationsPerPage));

  const handleSort = (field) => {
    setSortDirection(sortField === field && sortDirection === 'asc' ? 'desc' : 'asc');
    setSortField(field);
  };

  const getSortIcon = (direction) => {
    return direction === 'asc' ? 
      <CaretUpFill className="ms-1" /> : 
      <CaretDownFill className="ms-1" />;
  };

  const headerStyle = {
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: '#f8f9fa',
    position: 'relative',
    padding: '12px 8px',
  };

  if (loading) {
    return (
      <div className="text-center my-5">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading quotations...</span>
        </Spinner>
      </div>
    );
  }

  if (error && retryCount >= maxRetries) {
    return (
      <Alert variant="danger">
        <Alert.Heading>Error Loading Quotations</Alert.Heading>
        <p>{error}</p>
        <p>Unable to load quotations after {maxRetries} attempts. Please try refreshing the page or contact support if the problem persists.</p>
        <div className="mt-3">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => {
              setRetryCount(0);
              setError(null);
              setLoading(true);
            }}
          >
            Try Again
          </Button>
        </div>
      </Alert>
    );
  }

  if (error && retryCount < maxRetries) {
    return (
      <div className="text-center my-5">
        <Spinner animation="border" role="status" className="mb-3">
          <span className="visually-hidden">Retrying...</span>
        </Spinner>
        <p>Retrying... Attempt {retryCount + 1} of {maxRetries}</p>
      </div>
    );
  }

  if (!quotations.length && !loading && !error) {
    return (
      <Alert variant="info">
        <Alert.Heading>No Quotations Found</Alert.Heading>
        <p>No quotations were found for this customer (ID: {customerId}).</p>
        <p>This could mean:</p>
        <ul>
          <li>The customer has no quotations in the system</li>
          <li>The quotations data is not yet available</li>
          <li>There may be a temporary connectivity issue</li>
        </ul>
        <div className="mt-3">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={() => {
              setRetryCount(0);
              setError(null);
              setLoading(true);
            }}
          >
            Refresh Data
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <Container fluid>
      <Row className="mb-3 g-2 align-items-end flex-wrap">
        <Col xs={12} md={6} lg={4} style={{ maxWidth: 'min(100%, 28rem)' }}>
          <Form.Label className="small text-muted mb-1">Search quotations</Form.Label>
          <InputGroup size="sm">
            <InputGroup.Text>
              <Search />
            </InputGroup.Text>
            <Form.Control
              type="text"
              placeholder="Search quotations..."
              value={searchTerm}
              onChange={handleSearch}
            />
            {searchTerm ? (
              <Button variant="outline-secondary" onClick={() => setSearchTerm('')}>
                <XCircle />
              </Button>
            ) : null}
          </InputGroup>
        </Col>
        <Col xs={12} sm={6} md={4} lg={3}>
          <Form.Label className="small text-muted mb-1">Filter by status</Form.Label>
          <Form.Select size="sm" value={statusFilter} onChange={handleStatusFilter}>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Form.Select>
        </Col>
        <Col xs={12} md={12} lg>
          <Form.Label className="small text-muted mb-1 d-block">Filter by date range</Form.Label>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <InputGroup size="sm" style={{ width: 'auto', minWidth: '9.5rem', maxWidth: '11rem' }}>
              <InputGroup.Text className="px-2">
                <Calendar />
              </InputGroup.Text>
              <Form.Control type="date" value={dateFrom} onChange={handleDateFrom} aria-label="From date" />
            </InputGroup>
            <span className="text-muted small px-1">to</span>
            <InputGroup size="sm" style={{ width: 'auto', minWidth: '9.5rem', maxWidth: '11rem' }}>
              <InputGroup.Text className="px-2">
                <Calendar />
              </InputGroup.Text>
              <Form.Control type="date" value={dateTo} onChange={handleDateTo} aria-label="To date" />
            </InputGroup>
            {(dateFrom || dateTo) && (
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                  setCurrentPage(1);
                }}
              >
                Clear dates
              </Button>
            )}
          </div>
        </Col>
        {hasActiveFilters ? (
          <Col xs="auto" className="ms-lg-auto">
            <Button variant="outline-secondary" size="sm" onClick={resetFilters}>
              Clear all filters
            </Button>
          </Col>
        ) : null}
      </Row>
      <Row>
        <Col>
          <div className="table-responsive">
            <Table striped bordered hover className="shadow-sm">
              <thead className="bg-light">
                <tr>
                  <th onClick={() => handleSort('DocNum')} style={headerStyle}>
                    Quotation Number {sortField === 'DocNum' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('DocDate')} style={headerStyle}>
                    Date {sortField === 'DocDate' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('DocStatus')} style={headerStyle}>
                    Status {sortField === 'DocStatus' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('DocTotal')} style={headerStyle}>
                    Total {sortField === 'DocTotal' && getSortIcon(sortDirection)}
                  </th>
                  <th onClick={() => handleSort('subject')} style={headerStyle}>
                    Subject {sortField === 'subject' && getSortIcon(sortDirection)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentQuotations.map((quote) => (
                    <tr key={quote.DocNum} className="align-middle">
                      <td className="fw-bold text-primary">{quote.DocNum}</td>
                      <td>{formatDate(quote.DocDate)}</td>
                      <td>
                        <span className={`badge ${quote.DocStatus === 'C' ? 'bg-secondary' : 'bg-success'}`}>
                          {quote.DocStatus === 'C' ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td className="text-end">{formatCurrency(quote.DocTotal)}</td>
                      <td style={{ maxWidth: '300px' }} className="text-wrap">
                        {quote.subject || 'N/A'}
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
        totalItems={totalCount}
        onPageChange={(newPage) => setCurrentPage(newPage)}
        disabled={loading}
      />
    </Container>
  );
};

export default QuotationsTab;
