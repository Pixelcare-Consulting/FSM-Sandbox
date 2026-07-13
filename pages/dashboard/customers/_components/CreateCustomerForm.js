import React, { useState, useCallback } from 'react';
import {
  Row,
  Col,
  Form,
  Button,
  Spinner,
  Alert,
  Modal,
  Tab,
  Tabs,
} from 'react-bootstrap';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { GeoAlt } from 'react-bootstrap-icons';

const ADDRESS_TYPE_OPTIONS = [
  { value: 'bo_BillTo', label: 'Bill To' },
  { value: 'bo_ShipTo', label: 'Ship To' },
  { value: 'bo_ShipTo', label: 'Additional Site' },
];

const defaultAddress = (addressType, label = '') => ({
  AddressName: label,
  AddressName2: null,
  AddressName3: null,
  StreetNo: null,
  Street: '',
  Block: null,
  BuildingFloorRoom: '',
  Country: 'SG',
  State: 'SG',
  City: null,
  ZipCode: '',
  AddressType: addressType,
  U_Remarks: null,
});

const defaultContact = (index = 0) => ({
  Name: `Contact${index + 1}`,
  Position: null,
  Phone1: '',
  Phone2: null,
  MobilePhone: null,
  Fax: null,
  E_Mail: '',
  FirstName: '',
  MiddleName: null,
  LastName: '',
});

const resetFormState = () => ({
  cardName: '',
  phone1: '',
  phone2: '',
  emailAddress: '',
  block: '',
  unit: '',
  freeText: '',
  addresses: [defaultAddress('bo_BillTo'), defaultAddress('bo_ShipTo')],
  contacts: [defaultContact(0)],
  activeTab: 'info',
});

export default function CreateCustomerForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successCardCode, setSuccessCardCode] = useState(null);
  const [duplicateError, setDuplicateError] = useState(null);
  const [cardName, setCardName] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [block, setBlock] = useState('');
  const [unit, setUnit] = useState('');
  const [freeText, setFreeText] = useState('');
  const [activeTab, setActiveTab] = useState('info');

  const [addresses, setAddresses] = useState(() => [
    defaultAddress('bo_BillTo'),
    defaultAddress('bo_ShipTo'),
  ]);

  const [contacts, setContacts] = useState(() => [defaultContact(0)]);

  const updateAddress = useCallback((index, field, value) => {
    setAddresses((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value === '' ? null : value };
      return next;
    });
  }, []);

  const updateContact = useCallback((index, field, value) => {
    setContacts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value === '' ? null : value };
      return next;
    });
  }, []);

  const addContact = useCallback(() => {
    setContacts((prev) => [...prev, defaultContact(prev.length)]);
  }, []);

  const removeContact = useCallback((index) => {
    if (contacts.length <= 1) return;
    setContacts((prev) => prev.filter((_, i) => i !== index));
  }, [contacts.length]);

  const addLocation = useCallback(() => {
    setAddresses((prev) => [
      ...prev,
      defaultAddress('bo_ShipTo', `Site ${prev.length - 1}`),
    ]);
  }, []);

  const removeLocation = useCallback((index) => {
    if (index < 2) return;
    setAddresses((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const copyBillToToShipTo = useCallback(() => {
    setAddresses((prev) => {
      const billTo = prev[0];
      if (!billTo) return prev;
      const next = [...prev];
      const shipTo = { ...billTo, AddressType: 'bo_ShipTo' };
      shipTo.AddressName = (billTo.AddressName || '').trim()
        ? `${(billTo.AddressName || '').trim()} - T`
        : '';
      next[1] = shipTo;
      return next;
    });
  }, []);

  const buildPayload = useCallback(() => {
    const payload = {
      CardName: cardName.trim(),
      Phone1: phone1 || null,
      Phone2: phone2 || null,
      EmailAddress: emailAddress || null,
      Block: block || null,
      Unit: unit || null,
      FreeText: freeText || null,
      BPAddresses: addresses.map((a) => ({
        AddressName: a.AddressName,
        AddressName2: a.AddressName2,
        AddressName3: a.AddressName3,
        StreetNo: a.StreetNo,
        Street: a.Street,
        Block: a.Block,
        BuildingFloorRoom: a.BuildingFloorRoom,
        Country: a.Country || 'SG',
        State: a.State || 'SG',
        City: a.City,
        ZipCode: a.ZipCode,
        AddressType: a.AddressType,
        U_Remarks: a.U_Remarks,
      })),
      ContactEmployees: contacts.map((c) => ({
        Name: c.Name,
        Position: c.Position,
        Phone1: c.Phone1,
        Phone2: c.Phone2,
        MobilePhone: c.MobilePhone,
        Fax: c.Fax,
        E_Mail: c.E_Mail,
        FirstName: c.FirstName,
        MiddleName: c.MiddleName,
        LastName: c.LastName,
      })),
    };
    return payload;
  }, [cardName, phone1, phone2, emailAddress, block, unit, freeText, addresses, contacts]);

  const resetForm = useCallback(() => {
    const fresh = resetFormState();
    setCardName(fresh.cardName);
    setPhone1(fresh.phone1);
    setPhone2(fresh.phone2);
    setEmailAddress(fresh.emailAddress);
    setBlock(fresh.block);
    setUnit(fresh.unit);
    setFreeText(fresh.freeText);
    setAddresses(fresh.addresses);
    setContacts(fresh.contacts);
    setActiveTab(fresh.activeTab);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setDuplicateError(null);
    if (!cardName.trim()) {
      setMessage({ type: 'danger', text: 'Customer name is required.' });
      setActiveTab('info');
      return;
    }
    if (!addresses[0]?.AddressName?.trim() || !addresses[0]?.Street?.trim()) {
      setMessage({ type: 'danger', text: 'Bill To address requires Address Name and Street.' });
      setActiveTab('addresses');
      return;
    }
    if (!addresses[1]?.AddressName?.trim() || !addresses[1]?.Street?.trim()) {
      setMessage({ type: 'danger', text: 'Ship To address requires Address Name and Street.' });
      setActiveTab('addresses');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/customers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409 && data.existingCode) {
          setDuplicateError({
            existingCode: data.existingCode,
            existingType: data.existingType,
            message: data.message || 'A portal record already exists for this email or phone.',
          });
          return;
        }
        const errMsg = data.message || data.error || 'Failed to create customer';
        const errList = data.errors?.length ? ` ${data.errors.join(', ')}` : '';
        setMessage({ type: 'danger', text: `${errMsg}${errList}` });
        return;
      }

      setSuccessCardCode(data.cardCode || null);
      setShowSuccessModal(true);
    } catch (err) {
      setMessage({ type: 'danger', text: err.message || 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  };

  const router = useRouter();

  const addressLabel = (addr, idx) => {
    if (idx === 0) return 'Bill To';
    if (idx === 1) return 'Ship To';
    return addr.AddressName || `Additional location ${idx - 1}`;
  };

  const handleNextFromInfo = () => {
    setMessage(null);
    if (!cardName.trim()) {
      setMessage({ type: 'danger', text: 'Customer name is required.' });
      return;
    }
    setActiveTab('addresses');
  };

  const handleNextFromAddresses = () => {
    setMessage(null);
    if (!addresses[0]?.AddressName?.trim() || !addresses[0]?.Street?.trim()) {
      setMessage({ type: 'danger', text: 'Bill To address requires Address Name and Street.' });
      return;
    }
    if (!addresses[1]?.AddressName?.trim() || !addresses[1]?.Street?.trim()) {
      setMessage({ type: 'danger', text: 'Ship To address requires Address Name and Street.' });
      return;
    }
    setActiveTab('contacts');
  };

  const renderTabFooter = ({ showNext, showSubmit, onNext }) => (
    <>
      <hr className="my-4" />
      <Row className="align-items-center">
        <Col md={{ span: 4, offset: 8 }} xs={12} className="mt-1">
          {showNext && (
            <Button variant="primary" type="button" onClick={onNext} className="float-end">
              Next
            </Button>
          )}
          {showSubmit && (
            <Button type="submit" variant="primary" disabled={submitting} className="float-end">
              {submitting ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" /> Creating...
                </>
              ) : (
                'Create Portal Customers'
              )}
            </Button>
          )}
        </Col>
      </Row>
    </>
  );

  return (
    <>
      {duplicateError && (
        <Alert variant="danger" onClose={() => setDuplicateError(null)} dismissible>
          {duplicateError.message}{' '}
          <Link href={`/customer-leads?highlight=${encodeURIComponent(duplicateError.existingCode)}`}>
            View {duplicateError.existingCode} in Portal Customers
          </Link>
        </Alert>
      )}

      {message && (
        <Alert variant={message.type} onClose={() => setMessage(null)} dismissible>
          {message.text}
        </Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Tabs
          id="portal-customer-tabs"
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k || 'info')}
          className="mb-3"
        >
          <Tab eventKey="info" title="Customer Information">
            <Row>
                    <Col md={6}>
                      <Form.Group className="mb-3">
                        <Form.Label>
                          Customer Name <span className="text-danger">*</span>
                        </Form.Label>
                        <Form.Control
                          value={cardName}
                          onChange={(e) => setCardName(e.target.value)}
                          placeholder="e.g. Test Customer"
                          maxLength={100}
                          required
                        />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group className="mb-3">
                        <Form.Label>Block</Form.Label>
                        <Form.Control
                          value={block}
                          onChange={(e) => setBlock(e.target.value)}
                          placeholder="e.g. 188"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={3}>
                      <Form.Group className="mb-3">
                        <Form.Label>Unit</Form.Label>
                        <Form.Control
                          value={unit}
                          onChange={(e) => setUnit(e.target.value)}
                          placeholder="e.g. #01-03"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Row>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Phone 1</Form.Label>
                        <Form.Control
                          value={phone1}
                          onChange={(e) => setPhone1(e.target.value)}
                          placeholder="e.g. 65-9123-4567"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Phone 2 (Optional)</Form.Label>
                        <Form.Control
                          value={phone2}
                          onChange={(e) => setPhone2(e.target.value)}
                          placeholder="Optional"
                        />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group className="mb-3">
                        <Form.Label>Email (Optional)</Form.Label>
                        <Form.Control
                          type="email"
                          value={emailAddress}
                          onChange={(e) => setEmailAddress(e.target.value)}
                          placeholder="e.g. sample@gmail.com"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Row>
                    <Col md={12}>
                      <Form.Group className="mb-0">
                        <Form.Label>Remarks (Optional)</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={freeText}
                          onChange={(e) => setFreeText(e.target.value)}
                          placeholder="Notes or special instructions"
                        />
                      </Form.Group>
                    </Col>
                  </Row>
            {renderTabFooter({ showNext: true, onNext: handleNextFromInfo })}
          </Tab>

          <Tab eventKey="addresses" title="Addresses">
            <div className="d-flex flex-wrap gap-2 mb-3">
                    <Button
                      type="button"
                      variant="outline-primary"
                      size="sm"
                      onClick={copyBillToToShipTo}
                      className="d-inline-flex align-items-center gap-2"
                    >
                      <GeoAlt />
                      Copy Bill To → Ship To
                    </Button>
                    <Button type="button" variant="outline-secondary" size="sm" onClick={addLocation}>
                      Add another location
                    </Button>
                  </div>
                  {addresses.map((addr, idx) => (
                    <div key={idx} className="mb-4 p-3 border rounded">
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <h6 className="text-secondary mb-0">{addressLabel(addr, idx)}</h6>
                        {idx >= 2 && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            type="button"
                            onClick={() => removeLocation(idx)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <Row>
                        <Col md={6}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Address Name</Form.Label>
                            <Form.Control
                              size="sm"
                              value={addr.AddressName || ''}
                              onChange={(e) => updateAddress(idx, 'AddressName', e.target.value)}
                              placeholder="#01-03 SOHO HOUSE"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={6}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Street</Form.Label>
                            <Form.Control
                              size="sm"
                              value={addr.Street || ''}
                              onChange={(e) => updateAddress(idx, 'Street', e.target.value)}
                              placeholder="188 RACE COURSE ROAD"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Block</Form.Label>
                            <Form.Control
                              size="sm"
                              value={addr.Block || ''}
                              onChange={(e) => updateAddress(idx, 'Block', e.target.value)}
                              placeholder="188"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Building / Floor / Room</Form.Label>
                            <Form.Control
                              size="sm"
                              value={addr.BuildingFloorRoom || ''}
                              onChange={(e) => updateAddress(idx, 'BuildingFloorRoom', e.target.value)}
                              placeholder="#01-03"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Postcode</Form.Label>
                            <Form.Control
                              size="sm"
                              value={addr.ZipCode || ''}
                              onChange={(e) => updateAddress(idx, 'ZipCode', e.target.value)}
                              placeholder="218612"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Country</Form.Label>
                            <Form.Select
                              size="sm"
                              value={addr.Country || 'SG'}
                              onChange={(e) => updateAddress(idx, 'Country', e.target.value)}
                            >
                              <option value="SG">SG</option>
                              <option value="GB">GB</option>
                              <option value="US">US</option>
                            </Form.Select>
                          </Form.Group>
                        </Col>
                        {idx < 2 && (
                          <Col md={4}>
                            <Form.Group className="mb-2">
                              <Form.Label className="small">Address Type</Form.Label>
                              <Form.Select
                                size="sm"
                                value={addr.AddressType}
                                disabled
                              >
                                {ADDRESS_TYPE_OPTIONS.filter(
                                  (o, i) => (idx === 0 ? o.value === 'bo_BillTo' : o.value === 'bo_ShipTo' && i === 1)
                                ).map((o) => (
                                  <option key={o.value + o.label} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </Form.Select>
                            </Form.Group>
                          </Col>
                        )}
                      </Row>
                    </div>
                  ))}
            {renderTabFooter({ showNext: true, onNext: handleNextFromAddresses })}
          </Tab>

          <Tab eventKey="contacts" title="Contacts">
            {contacts.map((contact, idx) => (
                    <div key={idx} className="mb-4 p-3 border rounded">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h6 className="text-secondary mb-0">Contact {idx + 1}</h6>
                        {contacts.length > 1 && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            type="button"
                            onClick={() => removeContact(idx)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <Row>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Display Name</Form.Label>
                            <Form.Control
                              size="sm"
                              value={contact.Name || ''}
                              onChange={(e) => updateContact(idx, 'Name', e.target.value)}
                              placeholder="Contact1"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">First Name</Form.Label>
                            <Form.Control
                              size="sm"
                              value={contact.FirstName || ''}
                              onChange={(e) => updateContact(idx, 'FirstName', e.target.value)}
                              placeholder="First name"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Last Name</Form.Label>
                            <Form.Control
                              size="sm"
                              value={contact.LastName || ''}
                              onChange={(e) => updateContact(idx, 'LastName', e.target.value)}
                              placeholder="Last name"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Phone</Form.Label>
                            <Form.Control
                              size="sm"
                              value={contact.Phone1 || ''}
                              onChange={(e) => updateContact(idx, 'Phone1', e.target.value)}
                              placeholder="Phone number"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={4}>
                          <Form.Group className="mb-2">
                            <Form.Label className="small">Email</Form.Label>
                            <Form.Control
                              size="sm"
                              type="email"
                              value={contact.E_Mail || ''}
                              onChange={(e) => updateContact(idx, 'E_Mail', e.target.value)}
                              placeholder="email@example.com"
                            />
                          </Form.Group>
                        </Col>
                      </Row>
                    </div>
                  ))}
            <Button type="button" variant="outline-primary" size="sm" onClick={addContact}>
              Add Contact
            </Button>
            {renderTabFooter({ showSubmit: true })}
          </Tab>
        </Tabs>
      </Form>

      <Modal show={showSuccessModal} onHide={() => setShowSuccessModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="text-success">Portal customer created</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0">Customer has been saved to the portal successfully.</p>
          {successCardCode && (
            <p className="mb-0 mt-2">
              <strong>Portal code:</strong> <code>{successCardCode}</code>
            </p>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-primary"
            onClick={() => {
              setShowSuccessModal(false);
              setSuccessCardCode(null);
              resetForm();
            }}
          >
            Create another
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowSuccessModal(false);
              if (successCardCode) {
                router.push(`/customer-leads?highlight=${encodeURIComponent(successCardCode)}`);
              } else {
                router.push('/customer-leads');
              }
            }}
          >
            Back to Customers
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
