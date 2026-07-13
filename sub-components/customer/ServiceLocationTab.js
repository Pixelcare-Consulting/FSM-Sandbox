import React, { useState, useEffect, useRef } from 'react';
import {
  Row,
  Col,
  Table,
  Button,
  Modal,
  Form,
  Alert,
  InputGroup,
  Badge,
  Spinner,
  OverlayTrigger,
  Tooltip,
} from 'react-bootstrap';
import { Eye, PinMap, Search, CaretUpFill, CaretDownFill, CurrencyExchange, GeoAltFill, HouseFill, Save, XCircle, Plus, Trash } from 'react-bootstrap-icons';
import { FaWhatsapp } from 'react-icons/fa';
import { CustomCountryFlag } from 'components/flags/CountryFlags';
import { toast } from 'react-toastify';
import TablePagination from 'components/common/TablePagination';
import { ExtensionFriendlyPhone } from 'components/common/ExtensionFriendlyPhone';
import PortalModal, {
  PortalConfirmPanel,
  PortalConfirmRow,
} from 'components/portal/PortalModal';
import {
  resolveCustomerAddressDetailRow,
  siteAddressLookupKeys,
} from '../../lib/utils/siteAddressKeyAliases';
import { digitsForPhoneLinks } from '../../lib/utils/toTelHref';
import { formatPortalBpAddressSubtitle } from '../../lib/utils/formatPortalBpAddress';
import {
  hasMeaningfulPortalSiteContact,
  hasMeaningfulSapContact,
  portalSiteContactToSapShape,
} from '../../lib/customers/contactResolution';

function waMeUrlFromDigits(digits) {
  return digits.length >= 8 ? `https://wa.me/${digits}` : '';
}

const headerStyle = {
  cursor: 'pointer',
  userSelect: 'none',
  backgroundColor: '#f8f9fa',
  position: 'relative',
  padding: '12px 8px',
};

// Add this helper function to extract unit number
const getUnitNumber = (buildingFloorRoom) => {
  if (!buildingFloorRoom) return '';
  
  // Match the #XX-XX pattern
  const match = buildingFloorRoom.match(/#\d{2}-\d{2}/);
  return match ? match[0] : buildingFloorRoom;
};

function normalizeSiteContactRow(row) {
  return {
    id: row.id ?? null,
    contactPerson: (row.contactPerson || '').trim(),
    contactPhone: (row.contactPhone || '').trim(),
    contactEmail: (row.contactEmail || '').trim(),
  };
}

/** True when an existing DB row matches what we had when the modal opened (skip PATCH). */
function isSiteContactRowUnchanged(row, baselineById) {
  if (row.id == null || row.id === '') return false;
  const b = baselineById.get(String(row.id));
  if (!b) return false;
  const n = normalizeSiteContactRow(row);
  return (
    n.contactPerson === b.contactPerson &&
    n.contactPhone === b.contactPhone &&
    n.contactEmail === b.contactEmail
  );
}

/** Tooltip body for “+N more on site” (additional rows after primary in PortalSiteContacts). */
function ExtraSiteContactsTooltipBody({ extras }) {
  if (!extras?.length) {
    return (
      <span className="small">Open <strong>View Details</strong> to see all site contacts.</span>
    );
  }
  return (
    <div className="text-start small" style={{ maxWidth: 320 }}>
      <div className="fw-semibold mb-1 border-bottom border-light pb-1">Other contacts on this site</div>
      {extras.map((c, i) => (
        <div
          key={c.id || `extra-${i}`}
          className={i > 0 ? 'mt-2 pt-2' : ''}
          style={i > 0 ? { borderTop: '1px solid rgba(255,255,255,0.28)' } : undefined}
        >
          <div className="fw-semibold">{c.contactPerson?.trim() || '—'}</div>
          {(c.contactPhone || c.contactEmail) && (
            <div className="mt-1" style={{ opacity: 0.92 }}>
              {c.contactPhone ? <span className="d-block">{c.contactPhone}</span> : null}
              {c.contactEmail ? <span className="d-block text-break">{c.contactEmail}</span> : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function formatAddressTypeLabel(addressType) {
  if (addressType === 'bo_ShipTo') return 'Shipping Address';
  if (addressType === 'bo_BillTo') return 'Billing Address';
  return 'Other';
}

function normalizeAddressTypeForForm(addressType) {
  if (addressType === 'bo_ShipTo' || addressType === 'bo_BillTo') return addressType;
  return '__other__';
}

function addressTypeForApi(formValue) {
  if (formValue === '__other__' || formValue === 'Other') return null;
  return formValue || null;
}

export const ServiceLocationTab = ({
  customerData,
  addressDetails: addressDetailsProp = null,
  masterlistContactEdit = null,
  onMasterlistContactSaved,
  onLocationDeleted,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [localAddresses, setLocalAddresses] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('AddressName');
  const [sortDirection, setSortDirection] = useState('desc');
  const [addressDetailsMap, setAddressDetailsMap] = useState(
    () => addressDetailsProp?.data || {},
  );
  /** Matches GET API `dataByCustomerLocationId` — stable join when importer set customer_location_id. */
  const [addressDetailsByLocationId, setAddressDetailsByLocationId] = useState(
    () => addressDetailsProp?.dataByCustomerLocationId || {},
  );
  const [loadingDetails, setLoadingDetails] = useState(() => addressDetailsProp == null);
  const addressDetailsFetchGenRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [locationsPerPage] = useState(10);
  const [formData, setFormData] = useState({
    addressName: '',
    addressType: '__other__',
    fullAddress: '',
    status: 'Active',
    addressNotes: '',
  });
  /** Rows for site-scoped masterlist contacts; `id` null = new (insert on save). */
  const [siteContactRows, setSiteContactRows] = useState([]);
  const [pendingContactDeletes, setPendingContactDeletes] = useState([]);
  const [savingContact, setSavingContact] = useState(false);
  /** Map contact id → normalized fields at modal open; used to skip PATCH when only adding new contacts. */
  const siteContactsBaselineRef = useRef(new Map());

  useEffect(() => {
    if (customerData?.BPAddresses) {
      setLocalAddresses(customerData.BPAddresses);
    } else {
      setLocalAddresses([]);
    }
  }, [customerData?.BPAddresses]);

  // Use bundled address details from parent when provided; otherwise fetch once per customer.
  useEffect(() => {
    if (addressDetailsProp != null) {
      setAddressDetailsMap(addressDetailsProp.data || {});
      setAddressDetailsByLocationId(addressDetailsProp.dataByCustomerLocationId || {});
      setLoadingDetails(false);
      return;
    }

    const cardCode = customerData?.CardCode;
    if (!cardCode) {
      setLoadingDetails(false);
      return;
    }

    const generation = ++addressDetailsFetchGenRef.current;

    const loadAddressDetails = async () => {
      setLoadingDetails(true);
      try {
        const response = await fetch(
          `/api/customers/address-details/${encodeURIComponent(cardCode)}`,
        );
        if (generation !== addressDetailsFetchGenRef.current) return;
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            setAddressDetailsMap(result.data);
          }
          if (result.success && result.dataByCustomerLocationId) {
            setAddressDetailsByLocationId(result.dataByCustomerLocationId);
          }
        }
      } catch (error) {
        console.error('Error loading address details:', error);
      } finally {
        if (generation === addressDetailsFetchGenRef.current) {
          setLoadingDetails(false);
        }
      }
    };

    loadAddressDetails();
  }, [customerData?.CardCode, addressDetailsProp]);

  if (!customerData) {
    return <div className="p-4">Loading service locations...</div>;
  }

  const isSapLeadMasterlistUi =
    masterlistContactEdit?.kind === 'lead' ||
    (customerData?.CustomerType || '').includes('SAP Lead');
  const effectiveMasterlistCode =
    (masterlistContactEdit?.code && String(masterlistContactEdit.code).trim()) ||
    (isSapLeadMasterlistUi && customerData?.CardCode
      ? String(customerData.CardCode).trim()
      : '');
  const effectiveMasterlistKind =
    masterlistContactEdit?.kind || (isSapLeadMasterlistUi ? 'lead' : null);

  // Helper function to check if an address is blank/empty (defined early for use in initial check)
  const isAddressBlank = (location) => {
    // Helper to safely check if a value is non-empty
    const hasValue = (value) => {
      if (!value) return false;
      const strValue = String(value).trim();
      return strValue !== '' && strValue !== '-' && strValue.toLowerCase() !== 'n/a';
    };
    
    const hasStreet = hasValue(location.Street);
    const hasPortalFull = hasValue(location.PortalFullAddress);
    const hasBuildingFloorRoom = hasValue(location.BuildingFloorRoom);
    const hasAddressName = hasValue(location.AddressName);
    const hasCity = hasValue(location.City);
    const hasZipCode = hasValue(location.ZipCode);
    
    // Address is blank if it has no meaningful address fields
    if (!hasAddressName && !hasStreet && !hasPortalFull && !hasBuildingFloorRoom && !hasCity && !hasZipCode) {
      return true;
    }
    
    return false;
  };

  // Badge only when SAP/FSM default name matches this location of the correct type.
  // Empty or ghost defaults must not invent a Default badge.
  const isDefaultAddress = (location) => {
    const name = location.AddressName;
    if (!name) return false;
    const type = (location.AddressType || '').toString().trim().toUpperCase();
    if (type === 'BO_BILLTO' || type === 'B' || type === 'BILLTO') {
      const def = (customerData.BilltoDefault || '').toString().trim();
      return Boolean(def) && name === def;
    }
    if (type === 'BO_SHIPTO' || type === 'S' || type === 'SHIPTO') {
      const def = (
        customerData.ShipToDefault ||
        customerData.ShiptoDefault ||
        ''
      )
        .toString()
        .trim();
      return Boolean(def) && name === def;
    }
    return false;
  };

  // Filter out blank addresses
  const validAddresses = localAddresses.filter((location) => !isAddressBlank(location));

  const formatAddress = (address) => formatPortalBpAddressSubtitle(address);

  const findContactForAddress = (location) => {
    const portalList = Array.isArray(location?.PortalSiteContacts) ? location.PortalSiteContacts : [];
    const meaningfulPortal = portalList.find(hasMeaningfulPortalSiteContact);
    if (meaningfulPortal) {
      return portalSiteContactToSapShape(meaningfulPortal);
    }
    if (location?.LocationContact && hasMeaningfulSapContact(location.LocationContact)) {
      return location.LocationContact;
    }
    if (!customerData.ContactEmployees) return null;

    const contacts = customerData.ContactEmployees.filter(
      (contact) => (contact.Active === 'tYES' || !contact.Active) && hasMeaningfulSapContact(contact),
    );

    return contacts.length > 0 ? contacts[0] : null;
  };

  const contactPersonLabel = (c) => {
    if (!c) return '';
    const n = [c.FirstName, c.LastName].filter(Boolean).join(' ').trim();
    if (n && n !== '—') return n;
    if (c.Name && c.Name !== '—') return c.Name;
    return '';
  };

  const emptySiteContactRow = () => ({
    id: null,
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
  });

  const handleViewDetails = async (location) => {
    setSelectedLocation(location);
    setPendingContactDeletes([]);

    const portalList = location.PortalSiteContacts;
    const meaningfulPortal = Array.isArray(portalList)
      ? portalList.filter(hasMeaningfulPortalSiteContact)
      : [];
    let nextRows;
    if (meaningfulPortal.length > 0) {
      nextRows = meaningfulPortal.map((r) => ({ ...r }));
    } else {
      const c = findContactForAddress(location);
      nextRows = [
        {
          id: null,
          contactPerson: contactPersonLabel(c),
          contactPhone: (c?.Phone1 || '').trim(),
          contactEmail: (c?.E_Mail || '').trim(),
        },
      ];
    }
    setSiteContactRows(nextRows);
    const baseline = new Map();
    for (const r of nextRows) {
      if (r.id == null || r.id === '') continue;
      const n = normalizeSiteContactRow(r);
      baseline.set(String(r.id), n);
    }
    siteContactsBaselineRef.current = baseline;

    
    // Load saved details for this address if available (FK + dotted/comma address_name aliases)
    const savedDetails =
      resolveCustomerAddressDetailRow(addressDetailsMap, addressDetailsByLocationId, location) || {};
    setFormData({
      addressName: location.AddressName || '',
      addressType: normalizeAddressTypeForForm(location.AddressType),
      fullAddress:
        location.PortalFullAddress || formatPortalBpAddressSubtitle(location),
      status: savedDetails?.status || location.U_Status || 'Active',
      addressNotes: savedDetails?.address_notes || location.AddressNotes || location.U_AddressNotes || '',
    });
    
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedLocation(null);
    setFormData({
      addressName: '',
      addressType: '__other__',
      fullAddress: '',
      status: 'Active',
      addressNotes: '',
    });
    setSiteContactRows([]);
    setPendingContactDeletes([]);
    siteContactsBaselineRef.current = new Map();
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const updateSiteContactRow = (index, field, value) => {
    setSiteContactRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addSiteContactRow = () => {
    setSiteContactRows((prev) => [...prev, emptySiteContactRow()]);
  };

  const removeSiteContactRowAt = (index) => {
    setSiteContactRows((prev) => {
      const row = prev[index];
      if (row?.id) {
        setPendingContactDeletes((p) => [...p, row.id]);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const saveMasterlistLocationContact = async () => {
    if (!effectiveMasterlistCode || !selectedLocation?.PortalLocationId) return { ok: true };
    if (!effectiveMasterlistKind) return { ok: true };

    const path =
      effectiveMasterlistKind === 'lead'
        ? `/api/leads/masterlist/${encodeURIComponent(effectiveMasterlistCode)}`
        : `/api/customers/masterlist/${encodeURIComponent(effectiveMasterlistCode)}`;

    const locKey =
      effectiveMasterlistKind === 'lead' ? 'sap_lead_location_id' : 'customer_location_id';
    const locId = selectedLocation.PortalLocationId;

    for (const delId of pendingContactDeletes) {
      const body = { [locKey]: locId, delete_contact_id: delId };
      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Remove contact failed (${res.status})`);
      }
    }

    const baselineById = siteContactsBaselineRef.current || new Map();

    for (const row of siteContactRows) {
      const person = (row.contactPerson || '').trim();
      const phone = (row.contactPhone || '').trim();
      const email = (row.contactEmail || '').trim();
      if (!person && !phone && !email) continue;

      if (row.id && isSiteContactRowUnchanged(row, baselineById)) {
        continue;
      }

      const body = {
        [locKey]: locId,
        contact_person: person,
        contact_phone: phone,
        contact_email: email,
      };
      if (row.id) {
        body.contact_id = row.id;
      } else {
        body.create_new_site_contact = true;
      }

      const res = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Contact save failed (${res.status})`);
      }
    }

    return { ok: true };
  };

  const applySavedLocationFields = (loc, status, addressNotes) => {
    const fullAddress = (formData.fullAddress || '').trim();
    return {
      ...loc,
      AddressName: formData.addressName,
      SiteID: formData.addressName,
      AddressType:
        formData.addressType === '__other__'
          ? loc.AddressType && loc.AddressType !== 'bo_ShipTo' && loc.AddressType !== 'bo_BillTo'
            ? loc.AddressType
            : ''
          : formData.addressType,
      PortalFullAddress: fullAddress,
      Street: '',
      Building: '',
      BuildingFloorRoom: '',
      Block: '',
      U_Status: status,
      U_AddressNotes: addressNotes,
    };
  };

  const handleSave = async () => {
    if (!selectedLocation || !customerData?.CardCode) return;

    try {
      setSaving(true);

      let jobPropagation = null;

      if (selectedLocation.PortalLocationId) {
        const isLead = effectiveMasterlistKind === 'lead';
        const locPath = isLead
          ? `/api/leads/locations/${encodeURIComponent(selectedLocation.PortalLocationId)}`
          : `/api/customers/locations/${encodeURIComponent(selectedLocation.PortalLocationId)}`;
        const locBody = {
          addressName: formData.addressName,
          addressType: addressTypeForApi(formData.addressType),
          fullAddress: formData.fullAddress,
          ...(isLead
            ? { leadCode: effectiveMasterlistCode || customerData.CardCode }
            : { customerCode: customerData.CardCode }),
        };

        const locRes = await fetch(locPath, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(locBody),
        });
        const locResult = await locRes.json().catch(() => ({}));
        if (!locRes.ok || !locResult.success) {
          throw new Error(locResult.error || 'Failed to update service location');
        }
        jobPropagation = locResult;
      }

      // customer_location_id FK only references customer_location — omit for leads
      // so status/notes key by customer_code (lead code) + address name only.
      const isLeadDetails = effectiveMasterlistKind === 'lead';
      const response = await fetch('/api/customers/address-details', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerCode: customerData.CardCode,
          addressName: formData.addressName,
          addressType: addressTypeForApi(formData.addressType) ?? selectedLocation.AddressType,
          status: formData.status,
          addressNotes: formData.addressNotes,
          ...(isLeadDetails
            ? {}
            : { customerLocationId: selectedLocation.PortalLocationId || undefined }),
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        const successMessages = ['Address details saved successfully!'];
        if (jobPropagation?.jobsMatched > 0) {
          successMessages.push(
            `Updated address on ${jobPropagation.jobsMatched} linked job(s).`,
          );
        }
        toast.success(successMessages.join(' '), {
          position: 'top-right',
          autoClose: 4000,
        });

        const mergedRow =
          result.data && typeof result.data === 'object'
            ? result.data
            : {
                customer_code: customerData.CardCode,
                address_name: formData.addressName,
                address_type: addressTypeForApi(formData.addressType) ?? selectedLocation.AddressType,
                status: formData.status,
                address_notes: formData.addressNotes,
              };

        const updatedDetails = { ...addressDetailsMap };
        for (const key of siteAddressLookupKeys(
          mergedRow.address_name || formData.addressName,
          mergedRow.address_type || formData.addressType,
        )) {
          if (key) updatedDetails[key] = { ...(updatedDetails[key] || {}), ...mergedRow };
        }
        setAddressDetailsMap(updatedDetails);

        if (mergedRow.customer_location_id) {
          setAddressDetailsByLocationId((prev) => ({
            ...prev,
            [mergedRow.customer_location_id]: {
              ...(prev[mergedRow.customer_location_id] || {}),
              ...mergedRow,
            },
          }));
        }

        const refreshedLocation = applySavedLocationFields(
          selectedLocation,
          formData.status,
          formData.addressNotes,
        );
        setSelectedLocation(refreshedLocation);

        if (selectedLocation.PortalLocationId) {
          setLocalAddresses((prev) =>
            prev.map((loc) =>
              loc.PortalLocationId === selectedLocation.PortalLocationId
                ? applySavedLocationFields(loc, formData.status, formData.addressNotes)
                : loc,
            ),
          );
        }
      } else {
        throw new Error(result.error || 'Failed to save address details');
      }

      const canSaveSiteContact =
        effectiveMasterlistKind &&
        effectiveMasterlistCode &&
        selectedLocation.PortalLocationId;
      if (canSaveSiteContact) {
        setSavingContact(true);
        try {
          await saveMasterlistLocationContact();
          setPendingContactDeletes([]);
          toast.success('Site contacts saved to masterlist.', {
            position: 'top-right',
            autoClose: 3000,
          });
          onMasterlistContactSaved?.();
        } finally {
          setSavingContact(false);
        }
      }
    } catch (error) {
      console.error('Error saving address details:', error);
      toast.error(error.message || 'Failed to save address details. Please try again.', {
        position: "top-right",
        autoClose: 5000,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (location) => {
    setLocationToDelete(location);
    setShowDeleteModal(true);
  };

  const handleCloseDeleteModal = () => {
    if (deleting) return;
    setShowDeleteModal(false);
    setLocationToDelete(null);
  };

  const handleConfirmDelete = async () => {
    if (!locationToDelete?.PortalLocationId || !customerData?.CardCode) return;

    try {
      setDeleting(true);
      const isLead = effectiveMasterlistKind === 'lead';
      const leadCode = effectiveMasterlistCode || customerData.CardCode;
      const deleteUrl = isLead
        ? `/api/leads/locations/${encodeURIComponent(locationToDelete.PortalLocationId)}?leadCode=${encodeURIComponent(leadCode)}`
        : `/api/customers/locations/${encodeURIComponent(locationToDelete.PortalLocationId)}?customerCode=${encodeURIComponent(customerData.CardCode)}`;

      const res = await fetch(deleteUrl, { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          const jobCount = result.jobCount;
          const jobLabel =
            typeof jobCount === 'number'
              ? `${jobCount} active job${jobCount === 1 ? '' : 's'}`
              : 'active jobs';
          throw new Error(
            result.error ||
              `Cannot delete: ${jobLabel} reference this service location`,
          );
        }
        throw new Error(result.error || `Delete failed (${res.status})`);
      }

      const deletedId = locationToDelete.PortalLocationId;
      setLocalAddresses((prev) => prev.filter((loc) => loc.PortalLocationId !== deletedId));

      const nextDetailsMap = { ...addressDetailsMap };
      for (const key of siteAddressLookupKeys(
        locationToDelete.AddressName,
        locationToDelete.AddressType
      )) {
        delete nextDetailsMap[key];
      }
      setAddressDetailsMap(nextDetailsMap);
      setAddressDetailsByLocationId((prev) => {
        const next = { ...prev };
        delete next[deletedId];
        return next;
      });

      toast.success('Service location deleted.', {
        position: 'top-right',
        autoClose: 3000,
      });
      onLocationDeleted?.();
      setShowDeleteModal(false);
      setLocationToDelete(null);
    } catch (error) {
      console.error('Error deleting service location:', error);
      toast.error(error.message || 'Failed to delete service location.', {
        position: 'top-right',
        autoClose: 5000,
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleViewOnMap = (location) => {
    const address = formatAddress(location);
    const encodedAddress = encodeURIComponent(address);
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
    window.open(mapUrl, '_blank');
  };

  const handleSearch = (event) => {
    setSearchTerm(event.target.value);
    setCurrentPage(1); // Reset to first page when searching
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

  const sortLocations = (locations) => {
    return [...locations].sort((a, b) => {
      let compareA = a[sortField];
      let compareB = b[sortField];

      if (sortField === 'AddressType') {
        compareA = a.AddressType === 'bo_ShipTo' ? 'Shipping Address' : 
                   a.AddressType === 'bo_BillTo' ? 'Billing Address' : 'Other';
        compareB = b.AddressType === 'bo_ShipTo' ? 'Shipping Address' : 
                   b.AddressType === 'bo_BillTo' ? 'Billing Address' : 'Other';
      }

      if (compareA < compareB) return sortDirection === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Apply search filter to valid (non-blank) addresses
  const filteredLocations = validAddresses.filter((location) =>
    Object.values(location).some((value) =>
      value !== null && value !== undefined && 
      value.toString().toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const sortedLocations = sortLocations(filteredLocations);

  // Pagination logic
  const indexOfLastLocation = currentPage * locationsPerPage;
  const indexOfFirstLocation = indexOfLastLocation - locationsPerPage;
  const currentLocations = sortedLocations.slice(indexOfFirstLocation, indexOfLastLocation);
  const totalPages = Math.ceil(sortedLocations.length / locationsPerPage);

  const deleteConfirmModal = (
    <PortalModal
      show={showDeleteModal}
      onHide={handleCloseDeleteModal}
      title="Delete Service Location"
      size="md"
      footer={
        <>
          <Button
            variant="outline-secondary"
            className="rounded-3"
            onClick={handleCloseDeleteModal}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="rounded-3"
            onClick={handleConfirmDelete}
            disabled={deleting || !locationToDelete?.PortalLocationId}
          >
            {deleting ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Deleting...
              </>
            ) : (
              <>
                <Trash size={16} className="me-1" /> Delete
              </>
            )}
          </Button>
        </>
      }
    >
      {locationToDelete ? (
        <>
          <p className="text-muted mb-3">
            Delete this service location from the portal? This does not change SAP.
          </p>
          <PortalConfirmPanel>
            <PortalConfirmRow
              label="Address"
              value={locationToDelete.AddressName || '—'}
            />
            <PortalConfirmRow
              label="Type"
              value={formatAddressTypeLabel(locationToDelete.AddressType)}
            />
            <PortalConfirmRow label="Location">
              {formatAddress(locationToDelete) || '—'}
            </PortalConfirmRow>
          </PortalConfirmPanel>
          {isDefaultAddress(locationToDelete) ? (
            <Alert variant="warning" className="mt-3 mb-0">
              This is a default billing or shipping address in SAP. Deleting it here only
              removes the portal row — confirm you want to proceed.
            </Alert>
          ) : null}
        </>
      ) : null}
    </PortalModal>
  );

  if (validAddresses.length === 0) {
    return (
      <>
        <div className="p-4">No service locations found.</div>
        {deleteConfirmModal}
      </>
    );
  }

  return (
    <Row className="p-4">
      <Col>
        <h3 className="mb-4">Service Locations</h3>
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <InputGroup className="flex-grow-1" style={{ maxWidth: '420px' }}>
            <InputGroup.Text>
              <Search size={16} />
            </InputGroup.Text>
            <Form.Control
              placeholder="Search locations..."
              value={searchTerm}
              onChange={handleSearch}
            />
            {searchTerm && (
              <Button variant="outline-secondary" onClick={() => setSearchTerm('')}>
                <XCircle />
              </Button>
            )}
          </InputGroup>
        </div>
        <Table striped bordered hover responsive>
          <thead className="bg-light">
            <tr>
              <th onClick={() => handleSort('AddressType')} style={headerStyle}>
                Location Type {sortField === 'AddressType' && getSortIcon(sortDirection)}
              </th>
              <th onClick={() => handleSort('AddressName')} style={headerStyle}>
                Address {sortField === 'AddressName' && getSortIcon(sortDirection)}
              </th>
              <th onClick={() => handleSort('Name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Contact Person {getSortIcon('Name')}
              </th>
              <th onClick={() => handleSort('Phone1')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Phone {getSortIcon('Phone1')}
              </th>
              <th style={{ cursor: 'pointer', userSelect: 'none' }}>
                Address Notes
              </th>
              <th onClick={() => handleSort('U_Status')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Status {getSortIcon('U_Status')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {currentLocations.map((location, index) => {
              const contact = findContactForAddress(location);
              const label = contact ? contactPersonLabel(contact) : '';
              const phoneTrimmed = contact?.Phone1?.trim() ?? '';
              const sitePhoneDigits = digitsForPhoneLinks(phoneTrimmed);
              const siteWaHref = waMeUrlFromDigits(sitePhoneDigits);
              const showContact = Boolean(
                label || (contact && contact.Name && contact.Name !== '—')
              );
              const rowKey = location.PortalLocationId || `${location.AddressName || 'addr'}-${index}`;
              const portalList = Array.isArray(location.PortalSiteContacts) ? location.PortalSiteContacts : [];
              const extraSiteContacts = portalList.length > 1 ? portalList.slice(1) : [];
              return (
                <tr key={rowKey}>
                  <td>
                    <div className="d-flex align-items-center">
                      {location.AddressType === 'bo_BillTo' ? (
                        <CurrencyExchange className="me-2 text-primary" size={14} />
                      ) : (
                        <GeoAltFill className="me-2 text-primary" size={14} />
                      )}
                      <span className="fw-bold text-primary">
                        {location.AddressType === 'bo_ShipTo' ? 'Shipping Address' :
                         location.AddressType === 'bo_BillTo' ? 'Billing Address' : 'Other'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div>
                      <div className="d-flex align-items-center">
                        <HouseFill className="me-2 text-primary" size={14} />
                        <span className="fw-bold text-primary">
                        <div>{location.AddressName || location.SiteID || location.BuildingFloorRoom || '-'}</div>
                        </span>
                        {isDefaultAddress(location) && (
                          <Badge bg="primary" className="ms-2">Default</Badge>
                        )}
                        {location.Country && (
                          <div className="ms-2">
                            <CustomCountryFlag country={location.Country} />
                          </div>
                        )}
                      </div>
                      <div className="ms-4 text-muted">
                    
                        {formatAddress(location)}
                      </div>
                    </div>
                  </td>
                  <td>
                    {showContact ? (
                      <div>
                        <div className="fw-bold d-flex align-items-center flex-wrap gap-1">
                          <span>{label || contact.Name}</span>
                          {(location.PortalContactCount || 0) > 1 && (
                            <OverlayTrigger
                              placement="top"
                              delay={{ show: 200, hide: 120 }}
                              overlay={
                                <Tooltip id={`extra-site-ct-p${currentPage}-i${index}`}>
                                  <ExtraSiteContactsTooltipBody extras={extraSiteContacts} />
                                </Tooltip>
                              }
                            >
                              <span className="d-inline-flex align-items-center">
                                <Badge
                                  bg="secondary"
                                  pill
                                  className="small user-select-none"
                                  style={{ cursor: 'help' }}
                                >
                                  +{(location.PortalContactCount || 0) - 1} more on site
                                </Badge>
                              </span>
                            </OverlayTrigger>
                          )}
                        </div>
                        {(contact.Phone1?.trim() || contact.E_Mail?.trim()) && (
                          <div className="text-muted small mt-1">
                            {phoneTrimmed ? (
                              <div className="d-flex align-items-center mb-1" onClick={(e) => e.stopPropagation()}>
                                <ExtensionFriendlyPhone raw={phoneTrimmed} />
                              </div>
                            ) : null}
                            {contact.E_Mail?.trim() ? (
                              <div className="text-break mt-1">
                                <a
                                  href={`mailto:${encodeURIComponent(contact.E_Mail.trim())}`}
                                  className="text-muted text-decoration-none"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {contact.E_Mail.trim()}
                                </a>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">N/A</span>
                    )}
                  </td>
                  <td>
                    {contact && phoneTrimmed ? (
                      <div className="d-flex flex-column align-items-start gap-1">
                        <div className="d-flex align-items-center" onClick={(e) => e.stopPropagation()}>
                          <ExtensionFriendlyPhone raw={phoneTrimmed} />
                        </div>
                        {(() => {
                          const wa = siteWaHref;
                          if (!wa) return null;
                          return (
                            <a
                              href={wa}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="d-inline-flex align-items-center gap-1 small text-success text-decoration-none"
                              onClick={(e) => e.stopPropagation()}
                              title="WhatsApp chat"
                            >
                              <FaWhatsapp size={14} />
                              WhatsApp
                            </a>
                          );
                        })()}
                      </div>
                    ) : 'N/A'}
                  </td>
                  <td>
                    {loadingDetails ? (
                      <span className="text-muted d-inline-flex align-items-center gap-1">
                        <Spinner animation="border" size="sm" role="status" />
                        <span className="small">Loading…</span>
                      </span>
                    ) : (
                      (() => {
                        const savedDetails =
                          resolveCustomerAddressDetailRow(
                            addressDetailsMap,
                            addressDetailsByLocationId,
                            location,
                          ) || {};
                        return (
                          savedDetails.address_notes ||
                          location.AddressNotes ||
                          location.U_AddressNotes ||
                          'N/A'
                        );
                      })()
                    )}
                  </td>
                  <td>
                    {(() => {
                      const savedDetails =
                        resolveCustomerAddressDetailRow(
                          addressDetailsMap,
                          addressDetailsByLocationId,
                          location,
                        ) || {};
                      const status = savedDetails.status || location.U_Status || 'Active';
                      return (
                        <span className={`badge ${status === 'Active' ? 'bg-primary' : 'bg-success'}`}>
                          {status}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <Button variant="outline-primary" size="sm" onClick={() => handleViewDetails(location)} className="me-2">
                      <Eye size={16} className="me-1" /> View Details
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      disabled={!location.PortalLocationId || deleting}
                      title={
                        location.PortalLocationId
                          ? 'Delete service location from portal'
                          : 'No portal location id — cannot delete'
                      }
                      onClick={() => handleDeleteClick(location)}
                    >
                      <Trash size={16} className="me-1" /> Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={sortedLocations.length}
          onPageChange={(newPage) => setCurrentPage(newPage)}
          disabled={loadingDetails}
        />

        {deleteConfirmModal}

        <Modal show={showModal} onHide={handleCloseModal} size="xl">
          <Modal.Header closeButton>
            <Modal.Title>Location Details</Modal.Title>
          </Modal.Header>
          <Modal.Body className="pt-2">
            {isSapLeadMasterlistUi ? (
              <Alert variant="info" className="mb-3">
                <strong>Address Name</strong>, <strong>Type</strong>, and <strong>Full Address</strong> are editable
                in the portal only (not written back to SAP). Changes cascade to all linked jobs.{' '}
                <strong>Status</strong> and <strong>address notes</strong> are also saved in the portal, keyed by this
                lead code and address name. <strong>Site contacts</strong> on the right update the SAP lead masterlist in
                Supabase when this row has a location id.
              </Alert>
            ) : (
              <Alert variant="info" className="mb-3">
                You can edit <strong>Address Name</strong>, <strong>Type</strong>, and <strong>Full Address</strong>{' '}
                (portal only — not written back to SAP). Changes cascade to all linked jobs.{' '}
                <strong>Status</strong> and <strong>Address Notes</strong> are also saved in the portal. Site contacts
                are edited in the right column.
              </Alert>
            )}
            {selectedLocation && (
              <Form>
                {effectiveMasterlistCode && !selectedLocation.PortalLocationId && (
                  <Alert variant="warning" className="mb-3 small">
                    No portal location id on this row — site-level contact cannot be saved here. Use the page header{' '}
                    <strong>Edit</strong> for lead- or customer-level contact, or add structured locations in the import.
                  </Alert>
                )}
                <Row className="g-3 g-xl-4 align-items-start">
                  <Col xl={6}>
                    <Form.Group className="mb-3">
                      <Form.Label>Address Name</Form.Label>
                      <Form.Control
                        type="text"
                        value={formData.addressName}
                        onChange={(e) => handleInputChange('addressName', e.target.value)}
                        disabled={saving || savingContact || !selectedLocation.PortalLocationId}
                      />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Address Type</Form.Label>
                      <Form.Select
                        value={formData.addressType}
                        onChange={(e) => handleInputChange('addressType', e.target.value)}
                        disabled={saving || savingContact || !selectedLocation.PortalLocationId}
                      >
                        <option value="bo_ShipTo">Shipping Address</option>
                        <option value="bo_BillTo">Billing Address</option>
                        <option value="__other__">Other</option>
                      </Form.Select>
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>Full Address</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={formData.fullAddress}
                        onChange={(e) => handleInputChange('fullAddress', e.target.value)}
                        disabled={saving || savingContact || !selectedLocation.PortalLocationId}
                      />
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <Form.Label>
                        Status <span className="text-danger">*</span>
                      </Form.Label>
                      <Form.Select
                        value={formData.status}
                        onChange={(e) => handleInputChange('status', e.target.value)}
                        disabled={saving || savingContact}
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Pending">Pending</option>
                        <option value="Archived">Archived</option>
                      </Form.Select>
                    </Form.Group>
                    <Form.Group className="mb-0">
                      <Form.Label>Address Notes</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        value={formData.addressNotes}
                        onChange={(e) => handleInputChange('addressNotes', e.target.value)}
                        placeholder="Enter address notes..."
                        disabled={saving || savingContact}
                      />
                    </Form.Group>
                  </Col>
                  <Col xl={6}>
                    {effectiveMasterlistCode && selectedLocation.PortalLocationId ? (
                      <div
                        className="rounded border bg-light p-3 h-100"
                        style={{ maxHeight: 'min(62vh, 520px)', overflowY: 'auto' }}
                      >
                        <h6 className="mb-2">Site contacts (masterlist)</h6>
                        <p className="text-muted small mb-3">
                          Multiple contacts can be stored per site in FSM.</p>
                        {siteContactRows.length === 0 ? (
                          <p className="text-muted small mb-2">No contacts for this site yet.</p>
                        ) : (
                          siteContactRows.map((row, idx) => (
                            <div
                              key={row.id || `new-${idx}`}
                              className="border rounded p-3 mb-3 bg-white"
                            >
                              <div className="d-flex justify-content-between align-items-center mb-2">
                                <span className="small text-muted">
                                  Contact {idx + 1}
                                  {idx === 0 && siteContactRows.length > 1 ? (
                                    <Badge bg="secondary" className="ms-2">
                                      Primary
                                    </Badge>
                                  ) : null}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline-danger"
                                  size="sm"
                                  disabled={saving || savingContact}
                                  onClick={() => removeSiteContactRowAt(idx)}
                                >
                                  <Trash className="me-1" size={14} /> Remove
                                </Button>
                              </div>
                              <Form.Group className="mb-2">
                                <Form.Label className="small mb-1">Contact person</Form.Label>
                                <Form.Control
                                  value={row.contactPerson}
                                  onChange={(e) => updateSiteContactRow(idx, 'contactPerson', e.target.value)}
                                  disabled={saving || savingContact}
                                  placeholder="Full name"
                                />
                              </Form.Group>
                              <Form.Group className="mb-2">
                                <Form.Label className="small mb-1">Phone</Form.Label>
                                <Form.Control
                                  value={row.contactPhone}
                                  onChange={(e) => updateSiteContactRow(idx, 'contactPhone', e.target.value)}
                                  disabled={saving || savingContact}
                                />
                              </Form.Group>
                              <Form.Group className="mb-0">
                                <Form.Label className="small mb-1">Email</Form.Label>
                                <Form.Control
                                  type="email"
                                  value={row.contactEmail}
                                  onChange={(e) => updateSiteContactRow(idx, 'contactEmail', e.target.value)}
                                  disabled={saving || savingContact}
                                />
                              </Form.Group>
                            </div>
                          ))
                        )}
                        <Button
                          type="button"
                          variant="outline-primary"
                          size="sm"
                          disabled={saving || savingContact}
                          onClick={addSiteContactRow}
                        >
                          <Plus className="me-1" size={16} /> Add contact
                        </Button>
                      </div>
                    ) : (
                      <div className="text-muted small p-3 rounded border bg-light h-100 d-flex align-items-center justify-content-center text-center">
                        {effectiveMasterlistCode
                          ? 'Site contacts appear here when this location has a portal id.'
                          : 'Site contacts are available for masterlist-backed customers and SAP leads.'}
                      </div>
                    )}
                  </Col>
                </Row>
              </Form>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseModal} disabled={saving || savingContact}>
              Close
            </Button>
            <Button variant="primary" onClick={() => handleViewOnMap(selectedLocation)} disabled={saving || savingContact}>
              <PinMap size={16} className="me-1" /> View on Map
            </Button>
            <Button variant="success" onClick={handleSave} disabled={saving || savingContact}>
              {saving || savingContact ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} className="me-1" /> Save Changes
                </>
              )}
            </Button>
          </Modal.Footer>
        </Modal>
      </Col>
    </Row>
  );
};

export default ServiceLocationTab;
