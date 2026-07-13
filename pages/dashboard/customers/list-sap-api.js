import React, { Fragment, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Col, Row, Card, Button, OverlayTrigger, Tooltip, Badge, Breadcrumb, Placeholder, Spinner, Form, Collapse, Modal } from 'react-bootstrap';
import { useRouter } from 'next/router';
import { 
  Eye, 
  EnvelopeFill, 
  GeoAltFill, 
  CurrencyExchange, 
  HouseFill, 
  CalendarRange, 
  CheckCircleFill,
  XLg,
  ChevronLeft, 
  ChevronRight,
  FilterCircle,
  Calendar,
  ListUl
} from 'react-bootstrap-icons';
import { GeeksSEO, PageHeading } from 'widgets'
import moment from 'moment';
import DashboardListStickySearch, {
  STICKY_SEARCH_GRADIENT_BLUE,
} from 'sub-components/dashboard/DashboardListStickySearch';
import { 
  Search, 
  Filter as FeatherFilter,
  ChevronDown, 
  ChevronUp,
  ChevronRight as FeatherChevronRight,
  X as FeatherX
} from 'react-feather';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper
} from '@tanstack/react-table'
import toast from 'react-hot-toast';
import { TABLE_CONFIG } from 'constants/tableConfig';
import Link from 'next/link';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { customerService } from '../../../lib/supabase/database';
import { customerMatchesListGlobalSearch } from '../../../lib/customers/customerListGlobalSearchFilter';
import { mergeSapAddressFieldsDeduped } from '../../../lib/customers/mergeSapAddressSegments';
import { Download } from 'react-feather';
import TablePagination from '../../../components/common/TablePagination';
import { ExtensionFriendlyPhone } from '../../../components/common/ExtensionFriendlyPhone';
import CustomerListLoadingIndicator from '../../../components/loading/CustomerListLoadingIndicator';
import { useEnterToSearch } from '../../../hooks/useEnterToSearch';


// Define flag components for each country
const SGFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28.35 18.9" style={{ width: '16px', height: '11px' }}>
    <rect width="28.35" height="9.45" fill="#EF3340"/>
    <rect y="9.45" width="28.35" height="9.45" fill="#fff"/>
    <circle cx="7.087" cy="9.45" r="5.67" fill="#fff"/>
    <path d="M7.087,5.67l1.147,3.531h3.712L8.959,11.142l1.147,3.531L7.087,13.23L4.069,14.673l1.147-3.531L2.228,9.201h3.712Z" fill="#EF3340"/>
  </svg>
);

const GBFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" style={{ width: '16px', height: '11px' }}>
    <clipPath id="t">
      <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/>
    </clipPath>
    <path d="M0,0 v30 h60 v-30 z" fill="#00247d"/>
    <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
    <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#t)" stroke="#cf142b" strokeWidth="4"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#cf142b" strokeWidth="6"/>
  </svg>
);

const USFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 190 100" style={{ width: '16px', height: '11px' }}>
    <rect width="190" height="100" fill="#bf0a30"/>
    <rect y="7.69" width="190" height="7.69" fill="#fff"/>
    <rect y="23.08" width="190" height="7.69" fill="#fff"/>
    <rect y="38.46" width="190" height="7.69" fill="#fff"/>
    <rect y="53.85" width="190" height="7.69" fill="#fff"/>
    <rect y="69.23" width="190" height="7.69" fill="#fff"/>
    <rect y="84.62" width="190" height="7.69" fill="#fff"/>
    <rect width="76" height="53.85" fill="#002868"/>
    <g fill="#fff">
      {[...Array(9)].map((_, i) => 
        [...Array(11)].map((_, j) => (
          <circle key={`star-${i}-${j}`} cx={3.8 + j * 7.6} cy={3.8 + i * 5.38} r="2"/>
        ))
      )}
    </g>
  </svg>
);

const COUNTRY_CODE_MAP = {
  'Singapore': 'SG',
  'United Kingdom': 'GB',
  'United States': 'US',
};

const MAX_VISIBLE_ADDRESSES = 2; // Show first 2 addresses of each type

const copyToClipboard = (text, successMessage = 'Copied!') => {
  // Check if clipboard API is available
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    // Fallback to older method
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
      document.execCommand('copy');
      textArea.remove();
      alert(successMessage);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy text');
      textArea.remove();
    }
    return;
  }

  // Use modern clipboard API
  navigator.clipboard.writeText(text).then(() => {
    alert(successMessage);
  }).catch(err => {
    console.error('Failed to copy text: ', err);
    alert('Failed to copy text');
  });
};

// Fetch all addresses from SQL Query 14 API
const fetchAllAddresses = async () => {
  try {
    console.log('Fetching all addresses from getAllAddresses API...');
    
    const response = await fetch('/api/customers/getAllAddresses', {
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Fetched addresses:', data.addresses?.length || 0);

    return data.addresses || [];
  } catch (error) {
    console.error('Error fetching addresses:', error);
    throw error;
  }
};

// Build customer rows directly from SQL Query 14 address data
const buildCustomersFromAddresses = (addresses) => {
  const customerMap = new Map();
  const countryCounts = new Map();
  let skippedCount = 0;
  const skippedReasons = {};

  addresses.forEach((address, index) => {
    const customerCodeRaw = address.CustomerCode || address.CardCode || address.CustomerID || address.CustomerName || '';
    const customerCode = String(customerCodeRaw || '').trim();
    if (!customerCode) {
      skippedCount++;
      const reason = 'No customer code found';
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
      if (index < 10) {
        console.warn(`Skipping address record ${index}:`, {
          keys: Object.keys(address),
          sample: address
        });
      }
      return;
    }

    const customerName = address.CustomerName || address.CardName || customerCode;
    const existing = customerMap.get(customerCode);

    const customer = existing || {
      CardCode: customerCode,
      CardName: customerName,
      Phone1: address.Phone1 || address.Phone || '',
      EmailAddress: address.EmailAddress || address.Email || '',
      AllAddresses: []
    };

    if (!customer.Phone1 && (address.Phone1 || address.Phone)) {
      customer.Phone1 = address.Phone1 || address.Phone || '';
    }
    if (!customer.EmailAddress && (address.EmailAddress || address.Email)) {
      customer.EmailAddress = address.EmailAddress || address.Email || '';
    }

    customer.AllAddresses.push({
      Address1: address.Address1,
      Address2: address.Address2,
      Address3: address.Address3,
      Street: address.Street,
      Building: address.Building,
      BuildingFloorRoom: address.BuildingFloorRoom,
      PostalCode: address.PostalCode || address.ZipCode,
      ZipCode: address.ZipCode || address.PostalCode,
      Country: address.Country,
      CountryName: address.CountryName,
      AddressName: address.AddressName,
      SiteID: address.SiteID
    });

    customerMap.set(customerCode, customer);

    const countryKey = address.CountryName || address.Country;
    if (countryKey) {
      countryCounts.set(countryKey, (countryCounts.get(countryKey) || 0) + 1);
    }
  });

  const customers = Array.from(customerMap.values()).sort((a, b) => {
    // Sort by CardCode in ascending order to ensure C000001 comes first
    const codeA = (a.CardCode || '').toUpperCase();
    const codeB = (b.CardCode || '').toUpperCase();
    return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
  });

  let topCountry = '';
  let topCountryCount = 0;
  countryCounts.forEach((count, country) => {
    if (count > topCountryCount) {
      topCountry = country;
      topCountryCount = count;
    }
  });

  // Log statistics for debugging
  console.log('Customer grouping statistics:', {
    totalAddressRecords: addresses.length,
    uniqueCustomers: customers.length,
    skippedRecords: skippedCount,
    skippedReasons,
    averageAddressesPerCustomer: (addresses.length - skippedCount) / customers.length,
    customersWithMultipleAddresses: customers.filter(c => c.AllAddresses.length > 1).length
  });

  return { customers, topCountry, topCountryCount };
};

const fetchCustomers = async (page = 1, limit = 10, search = '', filters = {}, initialLoad = 'true') => {
  try {
    const timestamp = new Date().getTime();

    // Create a clean params object
    const params = {
      page: page.toString(),
      limit: limit.toString(),
      search,
      initialLoad,
      _: timestamp,
      ...filters
    };

    // Debug log
    console.log('Fetch Parameters:', {
      page,
      limit,
      search,
      filters,
      initialLoad
    });

    const queryParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        queryParams.append(key, value);
      }
    });

    let url = `/api/getCustomersList?${queryParams.toString()}`;

    console.log('Fetching customers with URL:', url);

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Debug log
    console.log('Raw API Response:', data);
    console.log('Received data:', {
      customerCount: data.customers?.length,
      totalCount: data.totalCount,
      requestedLimit: limit,
      dataStructure: data.customers?.[0] ? Object.keys(data.customers[0]) : 'No customers'
    });

    return {
      customers: data.customers || [],
      totalCount: data.totalCount || 0
    };
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
};

const formatAddress = (address) => {
  if (!address) return '-';
  
  // Combine address parts in a specific order
  const addressParts = [];
  
  // Add Street and Building (if they exist)
  if (address.Street) addressParts.push(address.Street);
  if (address.Building) addressParts.push(address.Building);
  
  // Add ZipCode and CountryName at the end
  const locationParts = [];
  if (address.ZipCode) locationParts.push(address.ZipCode);
  if (address.CountryName) locationParts.push(address.CountryName);
  
  // Combine all parts
  return [
    addressParts.join(' '),
    locationParts.join(', ')
  ].filter(Boolean).join(', ');
};

const formatMainAddress = (address) => {
  if (!address) return '-';
  
  // Display Sequence: siteId, Street, Building No., Country, ZipCode
  const parts = [
    address.SiteID || address.AddressName, // Location Name (siteId)
    address.Street, // Street Address
    address.Building || address.BuildingFloorRoom, // Building No.
    address.CountryName || (address.Country === 'SG' ? 'Singapore' : address.Country), // Country
    address.ZipCode // Zip/Postal Code
  ];
  
  return parts.filter(part => part && String(part).trim()).join(', ');
};

const AddressCell = ({ address, type = "main" }) => {
  let FlagComponent = null;
  const countryCode = COUNTRY_CODE_MAP[address.Country];
  if (countryCode) {
    switch (countryCode) {
      case 'SG':
        FlagComponent = SGFlag;
        break;
      case 'GB':
        FlagComponent = GBFlag;
        break;
      case 'US':
        FlagComponent = USFlag;
        break;
    }
  }

  // Get icon based on address type
  const getIcon = () => {
    switch (type) {
      case 'billing':
        return <CurrencyExchange className="me-2 flex-shrink-0" />;
      case 'shipping':
        return <GeoAltFill className="me-2 flex-shrink-0" />;
      default:
        return <HouseFill className="me-2 flex-shrink-0" />;
    }
  };

  // Format address according to display sequence: siteId, Street, Building No., Country, ZipCode
  const formattedAddress = [
    address.SiteID || address.AddressName, // Location Name (siteId)
    address.Street, // Street Address
    address.Building || address.BuildingFloorRoom, // Building No.
    address.CountryName || (address.Country === 'SG' ? 'Singapore' : address.Country), // Country
    address.ZipCode // Zip/Postal Code
  ].filter(part => part && String(part).trim()).join(', ');

  return (
    <div className="d-flex align-items-center">
      {getIcon()}
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>{formattedAddress || 'No address available'}</Tooltip>}
      >
        <div className="text-truncate" style={{ maxWidth: '250px' }}>
          {formattedAddress || '-'}
        </div>
      </OverlayTrigger>
      {FlagComponent && (
        <div className="ms-2 flex-shrink-0">
          <FlagComponent />
        </div>
      )}
    </div>
  );
};

const FilterPanel = ({ filters, setFilters, onClear, loading, loadData }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleFilterChange = (field, value) => {
    // Input validation based on field type
    switch (field) {
      case 'phone':
        // Only allow numbers and basic phone symbols
        if (!/^[0-9+\-\s]*$/.test(value)) {
          return; // Ignore invalid input
        }
        break;
      
      case 'email':
        // Allow all email characters
        if (!/^[a-zA-Z0-9.@]*$/.test(value)) {
          return; // Ignore invalid input
        }
        break;
      
      case 'customerCode':
        // Only allow numbers
        if (!/^\d*$/.test(value)) {
          return; // Ignore invalid input
        }
        break;
    }

    console.log(`Filter changed: ${field} = ${value}`); // Debug log
    setFilters(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !loading) {
      loadData(1);
    }
  };

  const handleSearch = async () => {
    try {
      // Validate email if present
      if (filters.email && !validateEmailSearch(filters.email)) {
        alert('Please enter a valid email address (e.g., example@domain.com)');
        return;
      }
      
      console.log('Search filters:', filters);
      await loadData(1);
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  return (
    <Card className="border-0 shadow-sm mb-4">
      <Card.Body className="p-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="d-flex align-items-center flex-grow-1">
            <OverlayTrigger
              placement="right"
              overlay={<Tooltip>Click to {isExpanded ? 'collapse' : 'expand'} search for customers</Tooltip>}
            >
              <div 
                className="d-flex align-items-center" 
                style={{ cursor: 'pointer' }}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <FeatherFilter size={16} className="me-2 text-primary" />
                <h6 className="mb-0 me-2" style={{ fontSize: '1rem' }}>
                  Advanced Filters
                  <small className="ms-2 text-muted" style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>
                    (Click Search to apply)
                  </small>
                  {Object.entries(filters).filter(([key, value]) => key !== 'globalSearch' && value !== '').length > 0 && (
                    <Badge 
                      bg="primary" 
                      className="ms-2" 
                      style={{ 
                        fontSize: '0.75rem', 
                        verticalAlign: 'middle',
                        borderRadius: '12px',
                        padding: '0.25em 0.6em'
                      }}
                    >
                      {Object.entries(filters).filter(([key, value]) => key !== 'globalSearch' && value !== '').length}
                    </Badge>
                  )}
                </h6>
                {isExpanded ? (
                  <ChevronUp size={16} className="text-muted" />
                ) : (
                  <ChevronDown size={16} className="text-muted" />
                )}
              </div>
            </OverlayTrigger>

          </div>

          <div className="d-flex justify-content-end align-items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={onClear}
              disabled={loading}
              className="clear-btn d-flex align-items-center"
            >
              <FeatherX size={14} className="me-1" />
              Clear
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSearch}
              disabled={loading}
              className="search-btn d-flex align-items-center"
            >
              <Search size={14} className="me-1" />
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>
        </div>
        <div style={{ 
          maxHeight: isExpanded ? '1000px' : '0',
          overflow: 'hidden',
          transition: 'all 0.3s ease-in-out',
          opacity: isExpanded ? 1 : 0
        }}>
          <Row>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Customer Code:</Form.Label>
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Enter numbers only (e.g. 0001)</Tooltip>}
                >
                  <Form.Control
                    size="sm"
                    type="text"
                    value={filters.customerCode}
                    onChange={(e) => handleFilterChange('customerCode', e.target.value)}
                    placeholder="Enter customer code..."
                    style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                    onKeyPress={handleKeyPress}
                  />
                </OverlayTrigger>
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Customer Name:</Form.Label>
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Enter full or partial customer name</Tooltip>}
                >
                  <Form.Control
                    size="sm"
                    type="text"
                    value={filters.customerName}
                    onChange={(e) => handleFilterChange('customerName', e.target.value)}
                    placeholder="Search by customer name..."
                    style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                    onKeyPress={handleKeyPress}
                  />
                </OverlayTrigger>
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Email:</Form.Label>
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Enter full email address (e.g., example@domain.com)</Tooltip>}
                >
                  <Form.Control
                    size="sm"
                    type="email"
                    value={filters.email}
                    onChange={(e) => handleFilterChange('email', e.target.value)}
                    placeholder="Enter email address..."
                    style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        if (!validateEmailSearch(filters.email)) {
                          alert('Please enter a valid email address (e.g., example@domain.com)');
                          return;
                        }
                        handleKeyPress(e);
                      }
                    }}
                  />
                </OverlayTrigger>
                {filters.email && !validateEmailSearch(filters.email) && (
                  <small className="text-danger d-block mt-1">
                    Please enter a valid email address
                  </small>
                )}
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Phone:</Form.Label>
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Enter numbers only (e.g. +65 1234 5678)</Tooltip>}
                >
                  <Form.Control
                    size="sm"
                    type="text"
                    value={filters.phone}
                    onChange={(e) => handleFilterChange('phone', e.target.value)}
                    placeholder="Enter phone number..."
                    style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                    onKeyPress={handleKeyPress}
                  />
                </OverlayTrigger>
              </Form.Group>
             
            </Col>
            <Col md={6}>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Contract Status:</Form.Label>
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Filter customers by their contract status</Tooltip>}
                >
                  <Form.Select
                    size="sm"
                    value={filters.contractStatus}
                    onChange={(e) => handleFilterChange('contractStatus', e.target.value)}
                    style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                    onKeyPress={handleKeyPress}
                  >
                    <option value="">All Contract Status</option>
                    <option value="Y">With Contract</option>
                    <option value="N">No Contract</option>
                  </Form.Select>
                </OverlayTrigger>
              </Form.Group>
              <Row className="align-items-end">
                <Col md={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Country:</Form.Label>
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Select customer&apos;s country</Tooltip>}
                    >
                      <Form.Select
                        size="sm"
                        value={filters.country}
                        onChange={(e) => handleFilterChange('country', e.target.value)}
                        style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                        onKeyPress={handleKeyPress}
                      >
                        <option value="">All Countries</option>
                        <option value="SG">Singapore</option>
                      </Form.Select>
                    </OverlayTrigger>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-2">
                    <Form.Label className="small mb-1" style={{ fontSize: '0.9rem' }}>Status:</Form.Label>
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Filter by customer account status</Tooltip>}
                    >
                      <Form.Select
                        size="sm"
                        value={filters.status}
                        onChange={(e) => handleFilterChange('status', e.target.value)}
                        style={{ fontSize: '0.9rem', padding: '0.5rem 0.75rem' }}
                        onKeyPress={handleKeyPress}
                      >
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Form.Select>
                    </OverlayTrigger>
                  </Form.Group>
                </Col>
              </Row>
            </Col>
          </Row>
        </div>
      </Card.Body>
      <style jsx global>{`
        .clear-btn, .search-btn {
          padding: 6px 12px !important;
          font-size: 14px !important;
          border-radius: 4px !important;
          transition: all 0.2s ease-in-out !important;
          border: none !important;
          position: relative;
          overflow: hidden;
        }

        .clear-btn {
          background-color: #FEE2E2 !important;
          color: #DC2626 !important;
        }

        .search-btn {
          background-color: #3B82F6 !important;
          color: white !important;
        }

        /* Hover animations */
        .clear-btn:hover, .search-btn:hover {
          transform: translateY(-1px);
        }

        .clear-btn:hover {
          background-color: #FEE2E2 !important;
          opacity: 0.9;
        }

        .search-btn:hover {
          background-color: #2563EB !important;
        }

        /* Active state animations */
        .clear-btn:active, .search-btn:active {
          transform: translateY(0);
        }

        /* Ripple effect */
        .clear-btn::after, .search-btn::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          width: 120%;
          height: 120%;
          background: rgba(255, 255, 255, 0.2);
          transform: translate(-50%, -50%) scale(0);
          border-radius: 50%;
          transition: transform 0.3s ease;
        }

        .clear-btn:active::after, .search-btn:active::after {
          transform: translate(-50%, -50%) scale(1);
          opacity: 0;
        }

        /* Disabled state */
        .clear-btn:disabled, .search-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none !important;
        }

        /* Icon animations */
        .clear-btn svg, .search-btn svg {
          transition: transform 0.2s ease;
        }

        .clear-btn:hover svg {
          transform: rotate(90deg);
        }

        .search-btn:hover svg {
          transform: translateX(-2px);
        }
          /* Primary Button Style */
  .btn-primary.btn-icon-text {
    background-color: #3b82f6;
    color: white;
    border: none;
    box-shadow: 0 2px 4px rgba(59, 130, 246, 0.15);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-size: 0.875rem;
    padding: 0.5rem 0.875rem;
    border-radius: 6px;
    transition: all 0.2s ease;
  }

  .btn-primary.btn-icon-text:hover {
    background-color: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);
    color: white;
    text-decoration: none;
  }

  .btn-primary.btn-icon-text:hover .icon-left {
    transform: translateX(-2px);
  }

  .btn-primary.btn-icon-text .icon-left {
    transition: transform 0.2s ease;
  }

  /* Small button variant */
  .btn-sm.btn-icon-text {
    padding: 0.4rem 0.75rem;
    font-size: 0.812rem;
  }

  /* Ripple effect */
  .btn-icon-text {
    position: relative;
    overflow: hidden;
  }

  .btn-icon-text::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 120%;
    height: 120%;
    background: rgba(255, 255, 255, 0.2);
    transform: translate(-50%, -50%) scale(0);
    border-radius: 50%;
    transition: transform 0.5s ease;
  }

  .btn-icon-text:active::after {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
    .Toaster {
            position: fixed;
            top: 1rem;
            right: 1rem;
            z-index: 9999;
          }
          
          /* Custom toast styles */
          .toast-custom {
            background: white;
            color: black;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }
          
          .toast-custom.success {
            border-left: 4px solid #10B981;
          }
          
          .toast-custom.error {
            border-left: 4px solid #EF4444;
          }
          
          .toast-custom.loading {
            border-left: 4px solid #3B82F6;
          }
      `}</style>
    </Card>
  );
};

// Add this new component for the addresses modal
const AddressesModal = ({ show, onHide, addresses, defaultAddress, billtoDefault, shiptoDefault, customerName }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10); // Default to 10 items

  // Simplified page size options
  const pageSizeOptions = [5, 10, 20, 50];

  // Filter addresses by search term
  const filteredAddresses = useMemo(() => {
    if (!searchTerm || searchTerm.trim() === '') {
      return addresses;
    }
    
    const searchLower = searchTerm.toLowerCase();
    return addresses.filter(address => {
      // Search across all address fields
      const searchableText = [
        address.Address1,
        address.Address2,
        address.Address3,
        address.Street,
        address.Building,
        address.BuildingFloorRoom,
        address.PostalCode,
        address.ZipCode,
        address.Country,
        address.City,
        address.AddressName,
        address.SiteID
      ].filter(Boolean).join(' ').toLowerCase();
      
      return searchableText.includes(searchLower);
    });
  }, [addresses, searchTerm]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredAddresses.length / itemsPerPage);

  // Get current page items
  const getCurrentPageItems = () => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAddresses.slice(start, start + itemsPerPage);
  };

  const currentPageItems = getCurrentPageItems();

  // Format address for display
  const formatAddressDisplay = (address) => {
    const addressLine = mergeSapAddressFieldsDeduped([
      address.Address1,
      address.Address2,
      address.Address3,
      address.Street,
      address.Building || address.BuildingFloorRoom,
    ]);
    const country = address.Country || (address.Country === 'SG' ? 'Singapore' : '');
    const zip = address.PostalCode || address.ZipCode;
    return [addressLine || null, country || null, zip || null].filter(Boolean).join(', ');
  };

  return (
    <Modal 
      show={show} 
      onHide={onHide} 
      size="xl" 
      onClick={(e) => e.stopPropagation()}
    >
      <Modal.Header closeButton onClick={(e) => e.stopPropagation()}>
        <Modal.Title>
          <HouseFill className="me-2" />
          All Addresses{customerName ? ` - ${customerName}` : ''}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body onClick={(e) => e.stopPropagation()}>
        {/* Search and Filter Controls */}
        <div className="mb-3">
          <Row className="g-2">
            <Col md={8}>
              <Form.Group>
                <div className="position-relative">
                  <Form.Control
                    type="text"
                    placeholder="Search addresses..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    size="sm"
                  />
                  <Search 
                    size={14} 
                    className="position-absolute" 
                    style={{ 
                      top: '50%', 
                      right: '10px', 
                      transform: 'translateY(-50%)',
                      color: '#6c757d'
                    }}
                  />
                </div>
              </Form.Group>
            </Col>
            <Col md={4}>
              <div className="d-flex align-items-center justify-content-end">
                <small className="text-muted me-2">Show:</small>
                <Form.Select
                  size="sm"
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{ width: '80px' }}
                >
                  {pageSizeOptions.map(size => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </Form.Select>
              </div>
            </Col>
          </Row>
        </div>

        {/* Results Summary */}
        <div className="mb-3 text-muted small d-flex align-items-center">
          <FilterCircle size={14} className="me-2" />
          Found {filteredAddresses.length} address{filteredAddresses.length !== 1 ? 'es' : ''}
        </div>

        {/* Single Consolidated Table */}
        <div className="table-responsive">
          <table className="table table-hover">
            <thead>
              <tr>
                <th style={{ width: '50px' }}>#</th>
                <th>
                  <div className="d-flex align-items-center">
                    <HouseFill className="me-2" size={14} />
                    Building
                  </div>
                </th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {currentPageItems.length === 0 ? (
                <tr>
                  <td colSpan="3" className="text-center py-4">
                    <div className="text-muted">
                      <Search size={20} className="mb-2" />
                      <p className="mb-0">No addresses found matching your search criteria</p>
                    </div>
                  </td>
                </tr>
              ) : (
                currentPageItems.map((address, index) => {
                  const globalIndex = (currentPage - 1) * itemsPerPage + index + 1;
                  const addressDisplay = formatAddressDisplay(address);
                  
                  return (
                    <tr key={index}>
                      <td>{globalIndex}</td>
                      <td>
                        <div className="d-flex align-items-center">
                          <HouseFill className="me-2 text-primary" size={14} />
                          <span className="fw-bold text-primary">
                            {address.Address1 || address.Building || '-'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="text-wrap" style={{ color: '#3B82F6', fontWeight: '500' }}>
                          {addressDisplay}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="d-flex justify-content-between align-items-center mt-4">
            <div className="text-muted small">
              <ListUl size={14} className="me-2" />
              Showing {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, filteredAddresses.length)} of {filteredAddresses.length}
            </div>
            <div className="d-flex align-items-center">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="me-2"
              >
                <ChevronLeft size={14} className="me-1" />
                Previous
              </Button>
              <div className="mx-3 d-flex align-items-center">
                <Calendar size={14} className="me-2" />
                Page {currentPage} of {totalPages}
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
                <FeatherChevronRight size={14} className="ms-1" />
              </Button>
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer onClick={(e) => e.stopPropagation()}>
        <Button variant="secondary" onClick={(e) => {
          e.stopPropagation();
          onHide();
        }}>
          <XLg size={14} className="me-1" />
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

// Update ViewCustomers component to include filters state
const ViewCustomers = () => {
  const [rawData, setRawData] = useState([]); // Store unfiltered data from API
  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const router = useRouter();
  const [perPage, setPerPage] = useState(TABLE_CONFIG.PAGE_SIZES.DEFAULT);
  const [initialLoad, setInitialLoad] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddressesModal, setShowAddressesModal] = useState(false);
  const [selectedCustomerAddresses, setSelectedCustomerAddresses] = useState([]);
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  
  // Loading progress state
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(['', '']); // Array for 2 steps
  const [addressCount, setAddressCount] = useState(0);
  const [customerCount, setCustomerCount] = useState(0);
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  const [topCountry, setTopCountry] = useState('');
  const [topCountryCount, setTopCountryCount] = useState(0);
  const [loadingLog, setLoadingLog] = useState([]);
  
  const [filters, setFilters] = useState({
    customerCode: '',
    customerName: '',
    email: '',
    phone: '',
    contractStatus: '',
    country: '',
    status: '',
  });

  const {
    draft: globalSearchDraft,
    setDraft: setGlobalSearchDraft,
    applied: globalSearchApplied,
    clear: clearGlobalSearch,
    onKeyDown: onGlobalSearchKeyDown,
  } = useEnterToSearch();

  // Global search filter (shared with dashboard global search — same token rules)
  const data = useMemo(() => {
    if (!globalSearchApplied || globalSearchApplied.trim() === '') {
      return rawData;
    }

    const searchTerm = globalSearchApplied.toLowerCase().trim();
    return rawData.filter((customer) => customerMatchesListGlobalSearch(customer, searchTerm));
  }, [rawData, globalSearchApplied]);

  // Reset to page 1 when search filter changes and current page exceeds filtered results
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (globalSearchApplied && data.length > 0) {
      const filteredPages = Math.ceil(data.length / perPage);
      if (currentPage > filteredPages && filteredPages > 0) {
        setCurrentPage(1);
      }
    } else if (!globalSearchApplied) {
      // Reset to page 1 when search is cleared
      const totalPages = Math.ceil(totalRows / perPage);
      if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(1);
      }
    }
  }, [globalSearchApplied, data.length, perPage, currentPage, totalRows]);

  // Add ref to track component mount status
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const columnHelper = createColumnHelper()

  const columns = [
    columnHelper.accessor((row, index) => (currentPage - 1) * perPage + index + 1, {
      id: 'index',
      header: '#',
      size: 50,
    }),
    columnHelper.accessor('CardCode', {
      header: 'Code',
      size: 100,
      enableSorting: true,
      sortingFn: (rowA, rowB) => {
        const codeA = (rowA.original.CardCode || '').toUpperCase();
        const codeB = (rowB.original.CardCode || '').toUpperCase();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      },
      cell: info => {
        const originalCardCode = info.getValue();
        return (
          <OverlayTrigger
            placement="top"
            overlay={<Tooltip id={`tooltip-${originalCardCode}`}>
              Click to copy customer code
            </Tooltip>}
          >
            <div
              style={{fontWeight: 'bold', cursor: 'pointer'}}
              onClick={() => copyToClipboard(originalCardCode, 'Customer code copied!')}
            >
              {originalCardCode}
            </div>
          </OverlayTrigger>
        );
      }
    }),
    columnHelper.accessor('CardName', {
      header: 'Customer',
      size: 200,
      cell: info => (
        <div className="d-flex align-items-center">
          {info.getValue()}
        </div>
      )
    }),

    // Primary Address Column (includes postal code and country)
    columnHelper.accessor('primaryAddress', {
      header: 'Address Information',
      size: 400,
      cell: info => {
        const row = info.row.original;

        // Priority: Use AllAddresses from SQL Query 14 if available
        const allAddresses = row.AllAddresses || [];
        const bpAddresses = row.BPAddresses || [];

        // Get primary address from AllAddresses (SQL Query 14 data)
        const getPrimaryAddressFromAllAddresses = () => {
          if (allAddresses.length > 0) {
            // Use the first address as primary
            const primaryAddr = allAddresses[0];
            return {
              Address1: primaryAddr.Address1 || '',
              Address2: primaryAddr.Address2 || '',
              Address3: primaryAddr.Address3 || '',
              Street: primaryAddr.Street || '',
              Building: primaryAddr.Building || '',
              PostalCode: primaryAddr.PostalCode || '',
              Country: primaryAddr.Country || ''
            };
          }
          return null;
        };

        const billingAddresses = bpAddresses.filter(addr => addr.AddressType === 'bo_BillTo');
        const shippingAddresses = bpAddresses.filter(addr => addr.AddressType === 'bo_ShipTo');

        // Find the mail address (default billing address) - same logic as detail view
        const getDefaultBillingAddress = () => {
          if (!billingAddresses || billingAddresses.length === 0) {
            // When BPAddresses is empty, construct address from customer record fields
            if (row.BilltoDefault || row.Address || row.Street) {
              return {
                AddressName: row.BilltoDefault || row.BillToBuildingFloorRoom || '', // Location Name (siteId)
                Street: row.Street || row.Address || row.MailAddress || '', // Street Address
                BuildingFloorRoom: row.BillToBuildingFloorRoom || row.Building || '', // Building No.
                Building: row.BillToBuildingFloorRoom || row.Building || '', // Building No. (alias)
                City: row.City || '',
                Country: row.Country || '',
                CountryName: row.Country === 'SG' ? 'Singapore' : row.Country || '',
                ZipCode: row.ZipCode || '',
                AddressType: 'bo_BillTo',
                SiteID: row.BilltoDefault || row.BillToBuildingFloorRoom || ''
              };
            }
            return null;
          }
          
          // First try to find address matching BilltoDefault
          if (row.BilltoDefault) {
            const defaultAddr = billingAddresses.find(addr => 
              addr.AddressName === row.BilltoDefault
            );
            if (defaultAddr) return defaultAddr;
          }
          
          // Try to find address marked as default
          const defaultMarked = billingAddresses.find(addr => 
            addr.Default === 'Y' || addr.Default === true
          );
          if (defaultMarked) return defaultMarked;
          
          // Try to find any billing address
          if (billingAddresses.length > 0) return billingAddresses[0];
          
          return null;
        };
        
        const primaryAddress = getPrimaryAddressFromAllAddresses();
        const mailAddress = getDefaultBillingAddress();

        // Fallback to basic address fields when BPAddresses is not available
        // Field mapping from customer record:
        // siteId = BilltoDefault (location name, e.g., "#11-01 HONG LEONG BUILDING")
        // street = Address or Street (actual street address, e.g., "16 RAFFLES QUAY")
        // building = BillToBuildingFloorRoom (building/unit name)
        const hasBasicAddress = row.Address || row.MailAddress || row.Street || row.BilltoDefault || row.City || row.Country;
        const basicAddressInfo = hasBasicAddress ? {
          siteId: row.BilltoDefault || row.BillToBuildingFloorRoom || '', // Location Name (siteId)
          street: row.Street || row.Address || row.MailAddress, // Street Address
          city: row.City,
          country: row.Country === 'SG' ? 'Singapore' : row.Country,
          zipCode: row.ZipCode,
          building: row.BillToBuildingFloorRoom || row.Building || '', // Building No.
          block: row.Block
        } : null;

        // Helper function to format address like in detail view
        const getFormattedAddressForList = (address) => {
          if (!address) return null;
          
          // Field mapping:
          // siteId = AddressName or SiteID
          // street = Street (actual street address)
          // building = BuildingFloorRoom or Building (building/unit name)
          const siteId = address.AddressName || address.SiteID || '';
          const street = address.Street || '';
          const building = address.BuildingFloorRoom || address.Building || '';
          const country = address.Country === 'SG' ? 'Singapore' : (address.Country || address.CountryName || '');
          
          // Display Sequence: siteId, Street, Building No., Country, ZipCode
          const fullAddressParts = [
            siteId, // Location Name (siteId) first
            address.Street, // Street Address
            building, // Building No.
            country, // Country
            address.ZipCode, // Zip/Postal Code
          ].filter(Boolean);
          
          return {
            siteId: siteId || '', // Location Name (siteId)
            street: street || '', // Street Address
            building: building || '', // Building No.
            country: country || '', // Country
            zipCode: address.ZipCode || '', // Zip/Postal Code
            fullAddress: fullAddressParts.length > 0 ? fullAddressParts.join(', ') : 'N/A'
          };
        };

        // Helper function to format basic address
        const getFormattedBasicAddress = (basicInfo) => {
          if (!basicInfo) return null;
          
          // Field mapping:
          // siteId = BilltoDefault (from customer record)
          // street = Address or Street (actual street address)
          // building = BillToBuildingFloorRoom (building/unit name)
          const siteId = basicInfo.siteId || ''; // Location Name (siteId) from BilltoDefault
          const street = basicInfo.street || ''; // Street Address
          const building = basicInfo.building || ''; // Building No.
          
          // Display Sequence: siteId, Street, Building No., Country, ZipCode
          const fullAddressParts = [
            siteId, // Location Name (siteId) first
            street, // Street Address
            building, // Building No.
            basicInfo.country, // Country
            basicInfo.zipCode // Zip/Postal Code
          ].filter(Boolean);
          
          return {
            siteId: siteId || '', // Location Name (siteId) from BilltoDefault
            street: street || '', // Street Address
            building: building || '', // Building No.
            country: basicInfo.country || '', // Country
            zipCode: basicInfo.zipCode || '', // Zip/Postal Code
            fullAddress: fullAddressParts.length > 0 ? fullAddressParts.join(', ') : 'N/A'
          };
        };

        // Helper function to format new address format from SQL Query 14 (includes postal code and country)
        const formatNewAddress = (addr) => {
          if (!addr) return null;
          
          const addressLine = mergeSapAddressFieldsDeduped([
            addr.Address1,
            addr.Address2,
            addr.Address3,
            addr.Street,
            addr.Building,
          ]);

          const locationParts = [
            addr.Country,
            addr.PostalCode
          ].filter(Boolean);
          
          const fullAddress = addressLine
            ? `${addressLine}${locationParts.length > 0 ? `, ${locationParts.join(' ')}` : ''}`
            : 'N/A';
          
          return {
            fullAddress: fullAddress,
            postalCode: addr.PostalCode || '',
            country: addr.Country || ''
          };
        };

        return (
          <div style={{ cursor: 'default' }}>
            {/* Display address information - prioritize AllAddresses (SQL Query 14), then BPAddresses, fallback to basic fields */}
            {primaryAddress ? (
              // Show address from SQL Query 14 (AllAddresses)
              (() => {
                const formatted = formatNewAddress(primaryAddress);
                const addressCount = allAddresses.length;
                
                return (
                  <div>
                    <div className="d-flex align-items-start">
                      <HouseFill className="me-2 flex-shrink-0 mt-1" style={{ color: '#6B7280' }} />
                      <div className="flex-grow-1">
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>
                            {addressCount > 1 ? `${addressCount} addresses available. Click to view all.` : 'Click to copy address'}
                          </Tooltip>}
                        >
                          <div
                            onClick={(e) => {
                              const addressText = formatted.fullAddress;
                              copyToClipboard(addressText, 'Address copied!');
                            }}
                            style={{ cursor: 'pointer' }}
                            className="text-break"
                          >
                            <div style={{ fontWeight: '500', color: '#3B82F6' }}>
                              {formatted.fullAddress}
                            </div>
                            {addressCount > 1 && (
                              <small 
                                className="text-primary" 
                                style={{ 
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                  textDecoration: 'underline'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCustomerAddresses(allAddresses);
                                  setSelectedCustomerName(row.CardName || 'Customer');
                                  setShowAddressesModal(true);
                                }}
                              >
                                +{addressCount - 1} more address{addressCount - 1 !== 1 ? 'es' : ''}
                              </small>
                            )}
                          </div>
                        </OverlayTrigger>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : mailAddress ? (
              // Show detailed address from BPAddresses - matching detail view format
              (() => {
                const formatted = getFormattedAddressForList(mailAddress);
                // Display: siteId highlighted, then Street, Building No., Country, ZipCode below
                const displaySiteId = formatted.siteId || '';
                
                // Format address according to sequence: Address ID/SiteID (blue), Street, Building, Singapore, ZipCode
                const addressId = mailAddress.AddressName || mailAddress.SiteID || '';
                const street = mailAddress.Street || '';
                const building = mailAddress.BuildingFloorRoom || mailAddress.Building || '';
                const country = mailAddress.Country === 'SG' ? 'Singapore' : (mailAddress.Country || '');
                const zipCode = mailAddress.ZipCode || '';
                
                // Build address parts in correct sequence: Street, Building, Singapore, ZipCode
                const addressParts = [
                  street,
                  building,
                  country,
                  zipCode
                ].filter(Boolean);
                const addressLine = addressParts.length > 0 ? addressParts.join(', ') : 'N/A';
                
                return (
                  <div className="mb-2">
                    <div className="d-flex align-items-center">
                      <HouseFill className="me-2 flex-shrink-0" />
                      <OverlayTrigger
                        placement="top"
                        overlay={<Tooltip>Click to copy address</Tooltip>}
                      >
                        <div
                          onClick={(e) => copyAddressToClipboard(mailAddress, e)}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* Address ID/SiteID in blue */}
                          {addressId && (
                            <span className="fw-bold" style={{ color: '#3B82F6' }}>
                              {addressId}
                            </span>
                          )}
                          {/* Street, Building, Singapore, ZipCode */}
                          {addressLine && (
                            <span className="ms-2 text-muted">
                              {addressLine}
                            </span>
                          )}
                        </div>
                      </OverlayTrigger>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="text-muted">-</div>
            )}
          </div>
        );
      }
    }),

    columnHelper.accessor('Phone1', {
      header: 'Phone',
      size: 100,
      cell: info => {
        const phoneValue = info.getValue();
        if (phoneValue == null || phoneValue === '') {
          return <span className="text-muted">-</span>;
        }
        return (
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip id={`tooltip-phone-${phoneValue}`}>
                Yeastar Linkus: hover the number, then click the extension popup to dial
              </Tooltip>
            }
          >
            <span>
              <ExtensionFriendlyPhone raw={phoneValue} />
            </span>
          </OverlayTrigger>
        );
      }
    }),
    columnHelper.accessor('EmailAddress', {
      header: 'Email',
      size: 200,
      cell: info => (
        <OverlayTrigger
          placement="top"
          overlay={<Tooltip id={`tooltip-email-${info.getValue()}`}>Click to send email</Tooltip>}
        >
          <a href={`mailto:${info.getValue()}`} className="text-decoration-none">
            <EnvelopeFill className="me-2" />
            {info.getValue()}
          </a>
        </OverlayTrigger>
      )
    }),
    columnHelper.accessor(() => null, {
      id: 'actions',
      header: 'Actions',
      size: 130,
      cell: info => (
        <div className="d-flex gap-2">
          <OverlayTrigger
            placement="left"
            overlay={
              <Tooltip>
                View complete details for customer #{info.row.original.CardCode}
              </Tooltip>
            }
          >
            <Link
              href={`/customers/view/${info.row.original.CardCode}`}
              className="btn btn-primary btn-icon-text btn-sm"
              style={{ textDecoration: "none" }}
            >
              <Eye size={14} className="icon-left" />
              View
            </Link>
          </OverlayTrigger>
        </div>
      )
    }),
  ]

  // Debug logs for table data
  console.log('Table data:', data);
  console.log('Table data length:', data?.length);
  console.log('Columns:', columns);
  console.log('Total rows:', totalRows);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      sorting: [{ id: 'CardCode', desc: false }], // Sort by CardCode ascending by default
    },
    state: {
      pagination: {
        pageIndex: currentPage - 1,
        pageSize: perPage,
      },
    },
    // Client-side pagination since we load all data at once
    manualPagination: false,
    onPaginationChange: updater => {
      if (typeof updater === 'function') {
        const newPagination = updater({ pageIndex: currentPage - 1, pageSize: perPage });
        setCurrentPage(newPagination.pageIndex + 1);
        if (newPagination.pageSize !== perPage) {
          setPerPage(newPagination.pageSize);
        }
      }
    },
  })

  const appendLoadingLog = useCallback((message) => {
    const time = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    setLoadingLog(prev => [...prev, { time, message }]);
  }, []);

  const loadData = useCallback(async (page, forceInitial = false) => {
    if (loading) {
      console.log('LoadData: Already loading, skipping...');
      return;
    }
    if (!isMountedRef.current) {
      console.log('LoadData: Component not mounted, skipping...');
      return;
    }

    console.log('LoadData called with:', { page, perPage, forceInitial, loading }); // Debug log

    console.log('Setting loading state to true...');
    setLoading(true);
    setError(null);
    setLoadingStep(0);
    setLoadingProgress(0);
    setLoadingMessages(['', '']); // Reset to empty array for 2 steps
    setAddressCount(0);
    setCustomerCount(0);
    setEstimatedTotal(0);
    setTopCountry('');
    setTopCountryCount(0);
    setLoadingLog([]);
    console.log('Loading state set, component should render now');

    try {
      // Step 1: Fetch all customers from new API endpoint
      setLoadingStep(1);
      setLoadingMessages(['Fetching all customers from SAP...', '']);
      appendLoadingLog('Fetching all customers from BusinessPartners API');
      console.log('Step 1: Fetching all customers from getAllCustomers API...');

      const customersResponse = await fetch('/api/customers/getAllCustomers', {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!customersResponse.ok) {
        throw new Error(`HTTP error! status: ${customersResponse.status}`);
      }

      const customersData = await customersResponse.json();
      const allCustomers = customersData.customers || [];
      const totalCount = customersData.totalCount || allCustomers.length;

      console.log(`Fetched ${allCustomers.length} customer records`);
      setCustomerCount(allCustomers.length);
      setEstimatedTotal(totalCount);
      setLoadingProgress(50);
      setLoadingMessages([
        `Fetched ${allCustomers.length.toLocaleString()} customers`,
        'Fetching address data from SQL Query 14...'
      ]);
      appendLoadingLog(`Fetched ${allCustomers.length.toLocaleString()} customers`);

      // Step 2: Fetch addresses from SQL Query 14 and merge
      setLoadingStep(2);
      console.log('Step 2: Fetching addresses from SQL Query 14 and merging...');
      appendLoadingLog('Fetching addresses from SQL Query 14');

      const addresses = await fetchAllAddresses();
      console.log(`Fetched ${addresses.length} address records from SQL Query 14`);
      setAddressCount(addresses.length);

      // Create a map of customers by CardCode
      const customerMap = new Map();
      allCustomers.forEach(customer => {
        customerMap.set(customer.CardCode, {
          CardCode: customer.CardCode,
          CardName: customer.CardName,
          Phone1: customer.Phone1 || '',
          EmailAddress: customer.EmailAddress || '',
          AllAddresses: []
        });
      });

      // Merge addresses into customers
      addresses.forEach(address => {
        const customerCode = address.CustomerCode || address.CardCode;
        if (customerCode && customerMap.has(customerCode)) {
          const customer = customerMap.get(customerCode);
          customer.AllAddresses.push({
            Address1: address.Address1,
            Address2: address.Address2,
            Address3: address.Address3,
            Street: address.Street,
            Building: address.Building,
            BuildingFloorRoom: address.BuildingFloorRoom,
            PostalCode: address.PostalCode || address.ZipCode,
            ZipCode: address.ZipCode || address.PostalCode,
            Country: address.Country,
            CountryName: address.CountryName,
            AddressName: address.AddressName,
            SiteID: address.SiteID
          });
        }
      });

      // Convert map to array and sort
      const customers = Array.from(customerMap.values()).sort((a, b) => {
        const codeA = (a.CardCode || '').toUpperCase();
        const codeB = (b.CardCode || '').toUpperCase();
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      });

      // Calculate country stats from addresses
      const countryCounts = new Map();
      addresses.forEach(address => {
        const countryKey = address.CountryName || address.Country;
        if (countryKey) {
          countryCounts.set(countryKey, (countryCounts.get(countryKey) || 0) + 1);
        }
      });

      let topCountry = '';
      let topCountryCount = 0;
      countryCounts.forEach((count, country) => {
        if (count > topCountryCount) {
          topCountry = country;
          topCountryCount = count;
        }
      });

      console.log('Final result:', {
        totalCustomers: customers.length,
        totalAddresses: addresses.length,
        customersWithAddresses: customers.filter(c => c.AllAddresses && c.AllAddresses.length > 0).length
      });

      setTopCountry(topCountry);
      setTopCountryCount(topCountryCount);
      setLoadingProgress(100);
      setLoadingMessages([
        `Fetched ${allCustomers.length.toLocaleString()} customers`,
        `Merged ${addresses.length.toLocaleString()} address records`
      ]);
      appendLoadingLog(`Merged ${addresses.length.toLocaleString()} addresses with ${customers.length.toLocaleString()} customers`);

      // Store raw data - address filtering happens automatically via useMemo
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setRawData(customers);
        setTotalRows(customers.length);
      }

      // Update message to indicate completion and that users can read tips
      if (isMountedRef.current) {
        setLoadingMessages([
          `✓ Fetched ${addresses.length.toLocaleString()} address records`,
          `✓ Grouped into ${customers.length.toLocaleString()} customers - Reading tips...`
        ]);
      }

    } catch (err) {
      console.error('Error loading customers:', err);
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setError('Failed to load customers. Please try again.');
        setRawData([]);
        setTotalRows(0);
        setLoadingMessages([`Error: ${err.message || 'Failed to load data'}`, '']);
      }
    } finally {
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        // Add a 10-second delay so users can read the modal tips
        // Update message to show remaining time
        for (let remaining = 10; remaining > 0; remaining--) {
          if (!isMountedRef.current) break;
          if (remaining <= 3) {
            setLoadingMessages([
              `✓ Data loaded successfully`,
              `Closing in ${remaining} second${remaining !== 1 ? 's' : ''}...`
            ]);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        setLoading(false);
        setInitialLoad(false);
        // Reset loading state after a brief delay to show completion
        setTimeout(() => {
          if (isMountedRef.current) {
            setLoadingStep(0);
            setLoadingProgress(0);
            setLoadingMessages(['', '']);
          }
        }, 1000);
      }
    }
  }, [perPage, loading, appendLoadingLog]); // Only include dependencies that are actually used

  // Keep only the initial load effect
  useEffect(() => {
    if (initialLoad) {
      console.log('Initial load triggered, calling loadData...');
      loadData(1).catch(err => {
        console.error('Error in initial load:', err);
      });
    }
  }, [initialLoad, loadData]);

  const handlePageChange = (page) => {
    // With client-side pagination, just update the page state
    // The table will handle displaying the correct page
    setCurrentPage(page);
  };

  const handleViewDetails = (customer) => {
    console.log('Viewing customer:', customer); // Debug log
    localStorage.setItem('viewCustomerToast', customer.CardName);
    router.push(`/customers/view/${customer.CardCode}`);
  };

  const handlePerRowsChange = async (newPerPage) => {
    // Since we're loading all data at once, just update the perPage state
    // The table will handle pagination client-side
    try {
      setPerPage(newPerPage);
      setCurrentPage(1); // Reset to first page when changing page size

      // Success toast
      toast.success(
        <div>
          <div className="fw-bold">View Updated Successfully</div>
          <small>Now showing {newPerPage} entries per page</small>
          {globalSearchApplied && (
            <small className="d-block mt-1">
              <i className="fas fa-filter me-1"></i>
              Showing {data.length} filtered result{data.length !== 1 ? 's' : ''}
            </small>
          )}
        </div>,
        {
          duration: 3000,
          style: {
            ...TOAST_STYLES.BASE,
            ...TOAST_STYLES.SUCCESS
          }
        }
      );
    } catch (err) {
      console.error('Error updating page size:', err);
      
      toast.error(
        <div>
          <div className="fw-bold">Update Failed</div>
          <small>Could not change the number of entries</small>
          <small className="d-block mt-1 text-danger">
            <i className="fas fa-exclamation-circle me-1"></i>
            {err.message}
          </small>
        </div>,
        {
          duration: 5000,
          style: {
            ...TOAST_STYLES.BASE,
            ...TOAST_STYLES.ERROR
          }
        }
      );
    }
  };

  const handleClearFilters = async () => {
    try {
      // Keep global search as it has its own clear button
      setFilters({
        customerCode: '',
        customerName: '',
        email: '',
        phone: '',
        contractStatus: '',
        country: '',
        status: '',
      });
      setCurrentPage(1);
      setInitialLoad(true);
      await loadData(1, true);
    } catch (err) {
      console.error('Error clearing filters:', err);
    }
  };

  const handleSaveToSupabase = async () => {
    setSaving(true);
    
    // Use the already-loaded customer data from getAllAddresses
    const actualTotalCount = totalRows || rawData.length;

    // Confirm with user since this will save all customers
    const confirmed = window.confirm(
      `This will save ALL customers (${actualTotalCount.toLocaleString()}) to Supabase.\n\n` +
      `Existing customers will be skipped.\n\n` +
      `This may take several minutes. Continue?`
    );

    if (!confirmed) {
      setSaving(false);
      return;
    }

    const loadingToast = toast.loading(
      <div className="d-flex align-items-center">
        <div className="me-3">
          <div className="fw-bold">Saving Customers to Supabase</div>
          <small>Preparing to save {actualTotalCount.toLocaleString()} customers...</small>
        </div>
      </div>,
      {
        style: {
          ...TOAST_STYLES.BASE,
          ...TOAST_STYLES.LOADING
        },
        duration: Infinity // Keep loading toast until we dismiss it
      }
    );

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      // Use the already-loaded customers from rawData
      const allCustomers = rawData || [];
      
      if (allCustomers.length === 0) {
        toast.dismiss(loadingToast);
        toast.error('No customers loaded. Please refresh the page and try again.');
        setSaving(false);
        return;
      }

      // Update loading message for saving
      toast.loading(
        <div className="d-flex align-items-center">
          <div className="me-3">
            <div className="fw-bold">Saving to Supabase</div>
            <small>Saving {allCustomers.length.toLocaleString()} customers to database...</small>
          </div>
        </div>,
        {
          id: loadingToast,
          style: {
            ...TOAST_STYLES.BASE,
            ...TOAST_STYLES.LOADING
          },
          duration: Infinity
        }
      );

      // Save all customers to Supabase
      const result = await customerService.saveCustomersFromSAP(allCustomers, supabase);

      try {
        await fetch('/api/customers/invalidate-sap-masterlist-cache', {
          method: 'POST',
          credentials: 'include',
        });
      } catch (cacheErr) {
        console.warn('Failed to invalidate SAP masterlist cache after bulk save:', cacheErr);
      }

      toast.dismiss(loadingToast);

      if (result.errors && result.errors.length > 0) {
        toast.error(
          <div>
            <div className="fw-bold">Save Completed with Errors</div>
            <small>Saved: {result.saved.toLocaleString()}, Skipped: {result.skipped.toLocaleString()}</small>
            <small className="d-block mt-1 text-danger">
              {result.errors.length} error{result.errors.length !== 1 ? 's' : ''} occurred
            </small>
          </div>,
          {
            duration: 8000,
            style: {
              ...TOAST_STYLES.BASE,
              ...TOAST_STYLES.ERROR
            }
          }
        );
      } else {
        toast.success(
          <div>
            <div className="fw-bold">Customers Saved Successfully</div>
            <small>Saved: {result.saved.toLocaleString()} new customers</small>
            {result.skipped > 0 && (
              <small className="d-block mt-1">
                Skipped: {result.skipped.toLocaleString()} existing customers
              </small>
            )}
            <small className="d-block mt-1 text-muted">
              Total processed: {result.total.toLocaleString()} customers
            </small>
          </div>,
          {
            duration: 8000,
            style: {
              ...TOAST_STYLES.BASE,
              ...TOAST_STYLES.SUCCESS
            }
          }
        );
      }
    } catch (err) {
      console.error('Error saving customers to Supabase:', err);
      toast.dismiss(loadingToast);
      toast.error(
        <div>
          <div className="fw-bold">Save Failed</div>
          <small>Could not save customers to Supabase</small>
          <small className="d-block mt-1 text-danger">
            {err.message || 'Unknown error occurred'}
          </small>
        </div>,
        {
          duration: 8000,
          style: {
            ...TOAST_STYLES.BASE,
            ...TOAST_STYLES.ERROR
          }
        }
      );
    } finally {
      setSaving(false);
    }
  };

  // Add this customStyles object near the top of your file
  const customStyles = {
    table: {
      style: {
        backgroundColor: "#ffffff",
        borderRadius: "8px",
        width: "100%",
        tableLayout: "fixed",
      },
    },
    headRow: {
      style: {
        backgroundColor: "#f8fafc",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottom: "1px solid #e2e8f0",
        minHeight: "52px",
      },
    },
    headCells: {
      style: {
        fontSize: "13px",
        fontWeight: "600",
        color: "#475569",
        paddingLeft: "16px",
        paddingRight: "16px",
      },
    },
    cells: {
      style: {
        fontSize: "14px",
        color: "#64748b",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingTop: "12px",
        paddingBottom: "12px",
      },
    },
    rows: {
      style: {
        minHeight: "60px",
        "&:hover": {
          backgroundColor: "#f1f5f9",
          cursor: "pointer",
          transition: "all 0.2s",
        },
      },
    },
    pagination: {
      style: {
        borderTop: "1px solid #e2e8f0",
        minHeight: "56px",
      },
      pageButtonsStyle: {
        borderRadius: "4px",
        height: "32px",
        padding: "4px 8px",
        margin: "0 4px",
      },
    },
  };

  return (
    <Fragment>
      <GeeksSEO title="View Customers | SAS&ME - SAP B1 | Portal" />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div 
            style={{
              background: 'linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)',
              padding: '1.5rem 2rem',
              borderRadius: '0 0 24px 24px',
              marginTop: '-39px',
              marginLeft: '10px',
              marginRight: '10px',
              marginBottom: '20px'
            }}
          >
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                {/* Title and Subtitle */}
                <div className="mb-3">
                  <h1 
                    className="mb-2" 
                    style={{ 
                      fontSize: '28px',
                      fontWeight: '600',
                      color: '#FFFFFF',
                      letterSpacing: '-0.02em'
                    }}
                  >
                    SAP Customers List
                  </h1>
                  <p 
                    className="mb-2" 
                    style={{ 
                      fontSize: '16px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontWeight: '400',
                      lineHeight: '1.5'
                    }}
                  >
                    Manage and view all your customer accounts, addresses, and contract details in one place
                  </p>
                  <div 
                    className="d-flex align-items-center gap-2"
                    style={{
                      fontSize: '14px',
                      color: 'rgba(255, 255, 255, 0.9)',
                      background: 'rgba(255, 255, 255, 0.1)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      marginTop: '8px'
                    }}
                  >
                    <i className="fe fe-info" style={{ fontSize: '16px' }}></i>
                    <span>
                      View-only access. Customer data is maintained in SAP Business One
                    </span>
                  </div>
                </div>

                {/* Badges */}
                <div className="d-flex align-items-center gap-2 mb-4">
                  <span 
                    className="badge" 
                    style={{ 
                      background: '#FFFFFF',
                      color: '#4171F5',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontWeight: '500',
                      fontSize: '14px'
                    }}
                  >
                    Customer Management
                  </span>
                  <span 
                    className="badge" 
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.2)',
                      color: '#FFFFFF',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontWeight: '500',
                      fontSize: '14px'
                    }}
                  >
                    <i className="fe fe-eye me-1"></i>
                    View Only
                  </span>
                </div>

                {/* Breadcrumb */}
                <nav 
                  style={{ 
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  <div className="d-flex align-items-center">
                    <i className="fe fe-home" style={{ color: 'rgba(255, 255, 255, 0.7)' }}></i>
                    <Link 
                      href="/dashboard" 
                      className="text-decoration-none ms-2" 
                      style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                    >
                      Dashboard
                    </Link>
                    <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>/</span>
                    <i className="fe fe-users" style={{ color: '#FFFFFF' }}></i>
                    <span className="ms-2" style={{ color: '#FFFFFF' }}>
                      Customers
                    </span>
                  </div>
                </nav>
              </div>

            </div>
          </div>
        </Col>
      </Row>
      <Row>
        
        <Col md={12} xs={12} className="mb-5">
        {/* Global Search Filter - Searches ALL fields in loaded customers in real-time */}
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
                      value={globalSearchDraft}
                      onChange={(e) => setGlobalSearchDraft(e.target.value)}
                      onKeyDown={onGlobalSearchKeyDown}
                      placeholder="🔍 Search anything... Customer Code, Name, Email, Phone, Address, Postal Code, etc. (e.g., C000002, John, #01-03 SOHO, 188 RACE COURSE ROAD, 93424144)"
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
                  {(globalSearchDraft || globalSearchApplied) && (
                    <Button
                      variant="light"
                      size="sm"
                      onClick={() => {
                        clearGlobalSearch();
                        setCurrentPage(1);
                      }}
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
                  )}
                </div>
                {globalSearchApplied ? (
                  <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.95 }}>
                    <FilterCircle size={14} />
                    <small style={{ fontSize: '0.85rem' }}>
                      ✓ Found <strong>{data.length}</strong> of <strong>{rawData.length}</strong> loaded customers
                      {rawData.length < totalRows && (
                        <span className="ms-1" style={{ opacity: 0.8 }}>
                          (from {totalRows.toLocaleString()} total in database)
                        </span>
                      )}
                    </small>
                  </div>
                ) : (
                  <div className="mt-2 text-white d-flex align-items-center gap-2" style={{ opacity: 0.85 }}>
                    <small style={{ fontSize: '0.8rem' }}>
                      💡 <strong>Tip:</strong> Press Enter to search across Customer Code, Name, Email, Phone, Address, Postal Code, Contact Person, Notes, and more!
                    </small>
                  </div>
                )}
              </Col>
            </Row>
        </DashboardListStickySearch>

        {/* Main Filters - Requires Search Button */}
        {/* <FilterPanel 
                filters={filters}
                setFilters={setFilters}
                onClear={handleClearFilters}
                loading={loading}
                loadData={loadData}
              /> */}
          <Card className="border-0 shadow-sm">
            <Card.Body className="p-4">
              {error && <div className="alert alert-danger mb-4">{error}</div>}
              
              
              <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center">
                  <span className="text-muted me-2">Show:</span>
                  <div className="position-relative" style={{ width: '90px' }}>
                    <Form.Select
                      size="sm"
                      value={perPage}
                      onChange={(e) => handlePerRowsChange(Number(e.target.value))}
                      className="me-2"
                      disabled={loading}
                    >
                      {TABLE_CONFIG.PAGE_SIZES.OPTIONS.map(size => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </Form.Select>
                  </div>
                  <span className="text-muted">entries per page</span>
                </div>
                <div className="text-muted">
                  <ListUl size={14} className="me-2" />
                  {loading ? (
                    <small>Loading...</small>
                  ) : globalSearchApplied ? (
                    `Showing ${data.length} of ${totalRows} customers (filtered)`
                  ) : (
                    `Showing ${((currentPage - 1) * perPage) + 1}-${Math.min(currentPage * perPage, totalRows)} of ${totalRows}`
                  )}
                </div>
              </div>

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
                    {(loading || initialLoad) ? (
                      Array.from({ length: 5 }).map((_, rowIndex) => (
                        <tr key={`skeleton-${rowIndex}`} className="table-skeleton-row">
                          {columns.map((_, colIndex) => (
                            <td key={`skeleton-${rowIndex}-${colIndex}`}>
                              <div
                                className="table-skeleton-line"
                                style={{
                                  width: ['30px', '80px', '160px', '320px', '80px', '140px', '90px'][colIndex] || '80%'
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : table.getRowModel().rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length} className="text-center py-5">
                          <div className="text-muted mb-2">No customers found</div>
                          <small>Try adjusting your search terms</small>
                        </td>
                      </tr>
                    ) : (
                      table.getRowModel().rows.map(row => (
                        <tr key={row.id}>
                          {row.getVisibleCells().map(cell => (
                            <td key={cell.id}>
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

              <div className="border-top">
                <TablePagination
                  currentPage={currentPage}
                  totalPages={globalSearchApplied
                    ? Math.ceil(data.length / perPage) 
                    : Math.ceil(totalRows / perPage)}
                  totalItems={globalSearchApplied ? data.length : totalRows}
                  onPageChange={(newPage) => {
                    handlePageChange(newPage);
                    table.setPageIndex(newPage - 1);
                  }}
                  disabled={loading}
                />
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {(loading || initialLoad) && (
        <CustomerListLoadingIndicator
          loading={loading || initialLoad}
          currentStep={loadingStep}
          totalSteps={2}
          stepMessages={Array.isArray(loadingMessages) && loadingMessages.length === 2 ? loadingMessages : ['', '']}
          progress={loadingProgress}
          fetchedCount={loadingStep === 1 ? addressCount : customerCount}
          estimatedTotal={estimatedTotal || addressCount}
          addressCount={addressCount}
          customerCount={customerCount}
          topCountry={topCountry}
          topCountryCount={topCountryCount}
          logEntries={loadingLog}
          onCancel={null}
        />
      )}

      {/* Addresses Modal */}
      <AddressesModal
        show={showAddressesModal}
        onHide={() => setShowAddressesModal(false)}
        addresses={selectedCustomerAddresses.map(addr => ({
          Address1: addr.Address1,
          Address2: addr.Address2,
          Address3: addr.Address3,
          Street: addr.Street,
          Building: addr.Building,
          BuildingFloorRoom: addr.Building,
          PostalCode: addr.PostalCode,
          ZipCode: addr.PostalCode,
          Country: addr.Country,
          City: '',
          AddressName: addr.Address1 || '',
          SiteID: addr.Address1 || ''
        }))}
        defaultAddress={selectedCustomerAddresses[0] ? {
          Address1: selectedCustomerAddresses[0].Address1,
          Street: selectedCustomerAddresses[0].Street,
          Building: selectedCustomerAddresses[0].Building,
          PostalCode: selectedCustomerAddresses[0].PostalCode,
          Country: selectedCustomerAddresses[0].Country
        } : null}
        billtoDefault={null}
        shiptoDefault={null}
        customerName={selectedCustomerName}
      />
      
      <div className="Toaster">
        
      </div>
      <style jsx global>{`
      .table-skeleton-row td {
        padding: 0.75rem 0.5rem;
      }

      .table-skeleton-line {
        height: 12px;
        border-radius: 4px;
        background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
        background-size: 200% 100%;
        animation: table-skeleton-shimmer 1.5s ease-in-out infinite;
      }

      @keyframes table-skeleton-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
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

      /* Create Button Style */
      .create-customer-button {
        background-color: #ffffff;
        color: #4171F5;
        transition: all 0.2s ease;
      }

      .create-customer-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
      }

      .create-customer-button:active {
        transform: translateY(0);
      }

      /* Card Animations */
      .card {
        transition: all 0.2s ease;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      /* Table Row Hover Effects */
      .table-row-hover:hover {
        background-color: #f1f5f9;
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
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

      /* Navigation Button Styles */
      .prev-btn,
      .next-btn {
        transition: all 0.2s ease;
      }

      .prev-btn:hover,
      .next-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .prev-btn:active,
      .next-btn:active {
        transform: translateY(0);
      }
    `}</style>
    </Fragment>
  )
}

export default ViewCustomers

// Helper function to format SAP address
const formatSAPAddress = (address) => {
    if (!address) return '-';
    
    // Format according to SAP B1 address display format
    let formattedAddress = '';
    
    // Building/Floor/Room + Address Name 2 (if exists)
    if (address.BuildingFloorRoom) {
      formattedAddress = address.BuildingFloorRoom;
      if (address.AddressName2) {
        formattedAddress += ` ${address.AddressName2}`;
      }
    }
    
    // Add Street and other components
    const additionalParts = [
      address.Street && `${address.Street}`,
      address.ZipCode,
      address.Country === 'SG' ? 'Singapore' : 
      address.Country === 'GB' ? 'United Kingdom' : 
      address.Country === 'US' ? 'United States' : 
      address.Country
    ].filter(Boolean);
    
    if (additionalParts.length > 0) {
      formattedAddress += formattedAddress ? `, ${additionalParts.join(', ')}` : additionalParts.join(', ');
    }
    
    return formattedAddress;
  };
  

// Country flag component
const CountryFlag = ({ country }) => {
  switch (country) {
    case 'SG':
      return <SGFlag />;
    case 'GB':
      return <GBFlag />;
    case 'US':
      return <USFlag />;
    default:
      return null;
  }
};

// Add this utility function at the top with your other utility functions
const copyAddressToClipboard = (address, e) => {
  e.stopPropagation(); // Prevent cell collapse
  
  // Format address according to sequence: Address ID/SiteID, Street, Building, Singapore, ZipCode
  const addressId = address.AddressName || address.SiteID || '';
  const formattedAddress = [
    addressId,
    address.Street,
    address.BuildingFloorRoom || address.Building,
    address.Country === 'SG' ? 'Singapore' : address.Country,
    address.ZipCode
  ].filter(Boolean).join(', ');

  navigator.clipboard.writeText(formattedAddress).then(() => {
    // You could use a toast notification here instead of alert
    alert('Address copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy address: ', err);
    alert('Failed to copy address');
  });
};

// Add a new validation function
const validateEmailSearch = (email) => {
  if (!email) return true; // Empty is valid
  
  // Basic email format check
  const emailRegex = /^[a-zA-Z0-9.]+@[a-zA-Z0-9]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

// Add these toast style constants at the top of your file
const TOAST_STYLES = {
  BASE: {
    background: '#fff',
    padding: '16px',
    borderRadius: '4px',
    maxWidth: '400px'
  },
  SUCCESS: {
    color: '#28a745',
    borderLeft: '6px solid #28a745'
  },
  WARNING: {
    color: '#856404',
    borderLeft: '6px solid #ffc107'
  },
  ERROR: {
    color: '#dc3545',
    borderLeft: '6px solid #dc3545'
  },
  LOADING: {
    color: '#0d6efd',
    borderLeft: '6px solid #0d6efd'
  }
};
