import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Tabs,
  Tab,
  Button,
  Spinner,
  Badge
} from 'react-bootstrap';
import { useRouter } from 'next/router';
import { GeeksSEO } from 'widgets';
import { AccountInfoTab } from 'sub-components/customer/AccountInfoTab';
import { ServiceLocationTab } from 'sub-components/customer/ServiceLocationTab';
import EquipmentsTab from 'sub-components/customer/EquipmentsTab';
import { DocumentsTab } from 'sub-components/customer/DocumentsTab';
import { HistoryTab } from 'sub-components/customer/HistoryTab';
import { NotesTab } from 'sub-components/customer/NotesTab';
import QuotationsTab from 'sub-components/customer/QuotationsTab';
import Link from 'next/link';
import Cookies from 'js-cookie';
import { MasterlistEntityEditModal } from '../../../sub-components/dashboard/MasterlistEntityEditModal';
import {
  enrichPartnerWithSapContacts,
  partnerHasMeaningfulContacts,
} from '../../../lib/customers/contactResolution';
import { useCustomerDetailQuery } from '../../../hooks/queries/useCustomerDetailQuery';

function useResolvedCustomerCardCode(router) {
  return useMemo(() => {
    if (!router.isReady) return '';
    const raw = router.query.id;
    const fromQuery = Array.isArray(raw) ? raw[0] : raw;
    if (fromQuery && String(fromQuery) !== '[id]') {
      return String(fromQuery).trim();
    }
    const pathOnly = decodeURIComponent((router.asPath || '').split('?')[0]);
    const m = pathOnly.match(/\/(?:customers\/view\/|dashboard\/customers\/)([^/]+)\/?$/);
    return m ? m[1].trim() : '';
  }, [router.isReady, router.query.id, router.asPath]);
}

const ViewCustomer = () => {
  const [activeTab, setActiveTab] = useState('accountInfo');
  const [enrichedPartner, setEnrichedPartner] = useState(null);
  const [equipments, setEquipments] = useState(null);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['accountInfo']));
  const [editModalOpen, setEditModalOpen] = useState(false);
  const router = useRouter();
  const resolvedCustomerId = useResolvedCustomerCardCode(router);
  const sapContactsEnrichAttemptedRef = useRef(false);
  const previousCustomerIdRef = useRef('');

  const {
    data: detailData,
    isLoading: detailLoading,
    isFetching: detailFetching,
    error: detailQueryError,
    refetchFresh,
  } = useCustomerDetailQuery(resolvedCustomerId, {
    enabled: router.isReady && Boolean(resolvedCustomerId),
  });

  const customerData = enrichedPartner ?? detailData?.partner ?? null;
  const addressDetails = detailData?.addressDetails ?? null;
  const customerUuid = detailData?.customerUuid ?? null;
  const masterlistEditable = detailData?.fromMasterlist ?? false;
  const loading =
    !router.isReady ||
    (Boolean(resolvedCustomerId) && (detailLoading || detailFetching));
  const error = useMemo(() => {
    if (!router.isReady) return null;
    if (!resolvedCustomerId) {
      return 'Could not read the customer code from this URL. Open the customer again from the list.';
    }
    if (detailQueryError) {
      return detailQueryError?.name === 'AbortError'
        ? 'Request timed out loading customer data. Please try again.'
        : detailQueryError.message || 'Failed to load data.';
    }
    return null;
  }, [router.isReady, resolvedCustomerId, detailQueryError]);

  const isPortalCustomerNotSyncedError = (customerId, errorMessage) => {
    if (!customerId || typeof customerId !== 'string' || !errorMessage) return false;
    const normalizedId = customerId.toUpperCase();
    const message = String(errorMessage);

    return /^CP\d+$/i.test(normalizedId) && (
      message.includes('Error fetching BusinessPartner') ||
      message.includes('No matching records found') ||
      message.includes('Customer with CardCode') ||
      message.includes('not found') ||
      message.includes('BusinessPartner')
    );
  };
  
  useEffect(() => {
    if (!router.isReady || !resolvedCustomerId) return;
    if (previousCustomerIdRef.current === resolvedCustomerId) return;
    previousCustomerIdRef.current = resolvedCustomerId;
    sapContactsEnrichAttemptedRef.current = false;
    setEnrichedPartner(null);
    setEquipments(null);
    setVisitedTabs(new Set(['accountInfo']));
    setActiveTab('accountInfo');
  }, [router.isReady, resolvedCustomerId]);

  useEffect(() => {
    if (!router.isReady || !resolvedCustomerId) return;
    sapContactsEnrichAttemptedRef.current = false;
    setEnrichedPartner(null);
  }, [router.isReady, resolvedCustomerId, detailData]);

  const refreshCustomerDetail = useCallback(async () => {
    setEnrichedPartner(null);
    sapContactsEnrichAttemptedRef.current = false;
    await refetchFresh();
  }, [refetchFresh]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!error || !isPortalCustomerNotSyncedError(resolvedCustomerId, error)) return;

    const redirectTimer = window.setTimeout(() => {
      router.replace({
        pathname: '/customer-leads',
        query: {
          openCustomerCode: resolvedCustomerId,
          portalNotSynced: '1',
        },
      });
    }, 1200);

    return () => window.clearTimeout(redirectTimer);
  }, [router, resolvedCustomerId, error]);

  const maybeEnrichSapContacts = useCallback(() => {
    if (!masterlistEditable || !customerData || !resolvedCustomerId) return;
    if (sapContactsEnrichAttemptedRef.current) return;
    if (partnerHasMeaningfulContacts(customerData)) return;

    sapContactsEnrichAttemptedRef.current = true;
    const cardCode = resolvedCustomerId;
    const snapshot = customerData;

    enrichPartnerWithSapContacts(snapshot, cardCode).then((enriched) => {
      if (enriched === snapshot) return;
      setEnrichedPartner(enriched);
    });
  }, [masterlistEditable, customerData, resolvedCustomerId]);

  const handleEquipmentsLoaded = useCallback((data) => {
    setEquipments(Array.isArray(data) ? data : []);
  }, []);

  const handleTabChange = (key) => {
    if (!key) return;
    setActiveTab(key);
    setVisitedTabs((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    if (key === 'serviceLocation') {
      maybeEnrichSapContacts();
    }
  };

  if (loading) {
    return (
      <Container>
        <Row>
          <Col lg={12} md={12} sm={12}>
            <div
              style={{
                background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
                padding: "1.5rem 2rem",
                borderRadius: "0 0 24px 24px",
                marginTop: "-39px",
                marginLeft: "10px",
                marginRight: "10px",
                marginBottom: "20px",
              }}
            >
              <div className="placeholder-glow">
                <span className="placeholder col-4 bg-light rounded mb-2 d-block" style={{ height: '2rem' }} />
                <span className="placeholder col-6 bg-light opacity-75 rounded mb-3 d-block" style={{ height: '1rem' }} />
                <span className="placeholder col-3 bg-light opacity-50 rounded d-block" style={{ height: '0.875rem' }} />
              </div>
            </div>
          </Col>
        </Row>
        <Row>
          <Col>
            <Card className="shadow-sm">
              <Card.Body>
                <div className="placeholder-glow mb-3 d-flex gap-2">
                  {['Account', 'Address', 'Notes', 'Equipment', 'History'].map((label) => (
                    <span
                      key={label}
                      className="placeholder bg-secondary opacity-25 rounded"
                      style={{ width: '5.5rem', height: '2rem' }}
                    />
                  ))}
                </div>
                <div className="placeholder-glow">
                  <span className="placeholder col-12 bg-light rounded mb-2 d-block" style={{ height: '1rem' }} />
                  <span className="placeholder col-10 bg-light rounded mb-2 d-block" style={{ height: '1rem' }} />
                  <span className="placeholder col-8 bg-light rounded d-block" style={{ height: '1rem' }} />
                </div>
                <div className="text-center mt-4">
                  <Spinner animation="border" role="status" variant="primary" size="sm">
                    <span className="visually-hidden">Loading...</span>
                  </Spinner>
                  <p className="mt-2 mb-0 text-muted small">Loading customer data...</p>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  if (error) {
    const isLeadNotSynced =
      (resolvedCustomerId &&
        typeof resolvedCustomerId === 'string' &&
        resolvedCustomerId.toUpperCase().startsWith('LEAD-') &&
        (error.includes('CardCode') ||
          error.includes('Value too long') ||
          error.includes('BusinessPartner') ||
          error.includes('not found'))) ||
      isPortalCustomerNotSyncedError(resolvedCustomerId, error);

    return (
      <Container className="mt-5">
        <Row>
          <Col>
            <Card className="text-center shadow-sm">
              <Card.Body className="py-5">
                <Card.Title className="text-danger mb-3">
                  {isLeadNotSynced ? 'Customer Not Synced to SAP Yet' : 'Error Loading Customer'}
                </Card.Title>
                <Card.Text className="mb-4">
                  {isLeadNotSynced ? (
                    <>
                      This customer is a portal or lead record that has not been synced to SAP yet.
                      Redirecting you to Customer Leads so you can view the record there.
                      {resolvedCustomerId && (
                        <>
                          <br />
                          <span className="d-inline-block mt-3 px-3 py-2 bg-light rounded">
                            <strong>Customer Code:</strong>{' '}
                            <code className="text-dark">{resolvedCustomerId}</code>
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {error}
                      {resolvedCustomerId && (
                        <>
                          <br />
                          <small className="text-muted">Customer ID: {resolvedCustomerId}</small>
                        </>
                      )}
                    </>
                  )}
                </Card.Text>
                <div className="d-flex gap-2 justify-content-center flex-wrap">
                  <Button variant="primary" onClick={() => router.push('/customers')}>
                    Back to Customers List
                  </Button>
                  {isLeadNotSynced ? (
                    <Button
                      variant="outline-primary"
                      onClick={() =>
                        router.push({
                          pathname: '/customer-leads',
                          query: {
                            openCustomerCode: resolvedCustomerId,
                            portalNotSynced: '1',
                          },
                        })
                      }
                    >
                      Open in Customer Leads
                    </Button>
                  ) : (
                    <Button variant="outline-primary" onClick={() => router.push('/customer-leads')}>
                      Go to Customer Leads
                    </Button>
                  )}
                  {!isLeadNotSynced && (
                    <Button variant="secondary" onClick={() => window.location.reload()}>
                      Retry Loading
                    </Button>
                  )}
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  if (!customerData) {
    return (
      <Container className="mt-5">
        <Row>
          <Col>
            <Card className="text-center">
              <Card.Body>
                <Card.Title>No Data Found</Card.Title>
                <Card.Text>No customer data found for the given ID.</Card.Text>
                <Button variant="primary" onClick={() => router.push('/customers')}>
                  Back to Customers List
                </Button>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  return (
    <Container>
      <GeeksSEO title={`View Customer: ${customerData.CardName || ''} | FSM Portal`} />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div
            style={{
              background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
              padding: "1.5rem 2rem",
              borderRadius: "0 0 24px 24px",
              marginTop: "-39px",
              marginLeft: "10px",
              marginRight: "10px",
              marginBottom: "20px",
            }}
          >
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: "28px",
                      fontWeight: "600",
                      color: "#FFFFFF",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {customerData?.CardName}
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: "16px",
                      color: "rgba(255, 255, 255, 0.7)",
                      fontWeight: "400",
                      lineHeight: "1.5",
                    }}
                  >
                    View and manage customer details, equipment, and history
                  </p>
                  <div className="d-flex align-items-center gap-2">
                    <span className="badge bg-light text-dark">
                      ID: {customerData?.CardCode}
                    </span>
                    {customerData?.CustomerType && (
                      <Badge bg="secondary">
                        {customerData.CustomerType}
                      </Badge>
                    )}
                  </div>
                </div>

                <nav
                  style={{
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <div className="d-flex align-items-center">
                    <i
                      className="fe fe-home"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    ></i>
                    <Link
                      href="/"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Dashboard
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <Link
                      href="/customers"
                      className="text-decoration-none"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Customers
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <span style={{ color: "#FFFFFF" }}>Customer Details</span>
                  </div>
                </nav>
              </div>

              <div className="d-flex flex-column gap-2 align-items-end">
                <Button
                  variant="light"
                  className="d-flex align-items-center gap-2"
                  style={{
                    padding: "0.5rem 1rem",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                  }}
                  onClick={() => router.push('/customers')}
                >
                  <i className="fe fe-arrow-left"></i>
                  Back to Customers
                </Button>
                {masterlistEditable && (
                  <Button
                    variant="outline-light"
                    className="d-flex align-items-center gap-2"
                    style={{
                      padding: "0.5rem 1rem",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                    }}
                    onClick={() => setEditModalOpen(true)}
                  >
                    <i className="fe fe-edit-2" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Col>
      </Row>

      <MasterlistEntityEditModal
        show={editModalOpen}
        onHide={() => setEditModalOpen(false)}
        mode="customer"
        code={resolvedCustomerId}
        customerData={customerData}
        onSaved={refreshCustomerDetail}
      />

      <Row>
        <Col xl={12} lg={12} md={12} sm={12}>
          <Card className="shadow-sm">
            <Card.Body>
              <Tabs
                activeKey={activeTab}
                onSelect={handleTabChange}
                className="mb-3"
              >
                <Tab eventKey="accountInfo" title="Account Info">
                  <AccountInfoTab customerData={customerData} />
                </Tab>
                <Tab eventKey="serviceLocation" title="Address" mountOnEnter>
                  <ServiceLocationTab
                    customerData={customerData}
                    addressDetails={addressDetails}
                    masterlistContactEdit={
                      masterlistEditable && resolvedCustomerId
                        ? { kind: 'customer', code: resolvedCustomerId }
                        : null
                    }
                    onMasterlistContactSaved={refreshCustomerDetail}
                    onLocationDeleted={refreshCustomerDetail}
                  />
                </Tab>
                <Tab eventKey="notes" title="Notes" mountOnEnter>
                  <NotesTab customerId={resolvedCustomerId} customerUuid={customerUuid} />
                </Tab>
                <Tab eventKey="equipments" title="Equipments" mountOnEnter>
                  <EquipmentsTab
                    customerData={customerData}
                    equipments={equipments}
                    onEquipmentsLoaded={handleEquipmentsLoaded}
                  />
                </Tab>
                <Tab eventKey="history" title="Job History" mountOnEnter>
                  <HistoryTab
                    customerData={customerData}
                    customerID={resolvedCustomerId}
                    hasVisited={visitedTabs.has('history')}
                  />
                </Tab>
                <Tab eventKey="quotations" title="Quotations" mountOnEnter>
                  <QuotationsTab customerId={resolvedCustomerId} />
                </Tab>
                
                <Tab eventKey="documents" title="Documents" mountOnEnter>
                  <DocumentsTab customerData={customerData} />
                </Tab>
              </Tabs>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ViewCustomer;
