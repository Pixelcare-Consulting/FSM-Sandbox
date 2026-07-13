import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Tabs,
  Tab,
  Button,
  Spinner,
  Badge,
} from 'react-bootstrap';
import { useRouter } from 'next/router';
import { GeeksSEO } from 'widgets';
import { AccountInfoTab } from 'sub-components/customer/AccountInfoTab';
import { ServiceLocationTab } from 'sub-components/customer/ServiceLocationTab';
import { HistoryTab } from 'sub-components/customer/HistoryTab';
import Link from 'next/link';
import { MasterlistEntityEditModal } from '../../../../sub-components/dashboard/MasterlistEntityEditModal';
import { useLeadDetailQuery } from '../../../../hooks/queries/useLeadDetailQuery';

const HEADER_BG = 'linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)';

function MasterlistOnlyTabMessage({ noun }) {
  return (
    <div className="p-4 text-muted">
      <p className="mb-0">
        {noun} is tied to portal customers or live SAP business partners. This page shows the imported SAP lead
        masterlist record only—open the customer view after conversion for full history, equipment, and documents.
      </p>
    </div>
  );
}

/** Next rewrites /leads/view/X → /dashboard/leads/view/X; in some cases query is briefly empty—parse from path. */
function useResolvedLeadCode(router) {
  return useMemo(() => {
    if (!router.isReady) return '';
    const raw = router.query.leadCode;
    const fromQuery = Array.isArray(raw) ? raw[0] : raw;
    if (fromQuery && String(fromQuery) !== '[leadCode]') {
      return String(fromQuery).trim();
    }
    const pathOnly = decodeURIComponent((router.asPath || '').split('?')[0]);
    const m = pathOnly.match(/\/(?:dashboard\/leads\/view|leads\/view)\/([^/]+)\/?$/);
    return m ? m[1].trim() : '';
  }, [router.isReady, router.query.leadCode, router.asPath]);
}

const ViewSapLeadMasterlist = () => {
  const [activeTab, setActiveTab] = useState('accountInfo');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const router = useRouter();
  const resolvedLeadCode = useResolvedLeadCode(router);

  const {
    data: detailBundle,
    isLoading: detailLoading,
    isFetching: detailFetching,
    error: detailQueryError,
    refetch: refetchLeadDetail,
  } = useLeadDetailQuery(resolvedLeadCode, {
    enabled: router.isReady && Boolean(resolvedLeadCode),
  });

  const detailData = detailBundle?.partner ?? null;
  const addressDetails = detailBundle?.addressDetails ?? null;
  const loading =
    !router.isReady ||
    (Boolean(resolvedLeadCode) && (detailLoading || detailFetching));
  const error = useMemo(() => {
    if (!router.isReady) return null;
    if (!resolvedLeadCode) {
      return 'Could not read the lead code from this URL. Use the leads list or try opening the lead again.';
    }
    if (detailQueryError) {
      return detailQueryError?.name === 'AbortError'
        ? 'Request timed out loading lead data. Please try again.'
        : detailQueryError.message || 'Failed to load lead.';
    }
    if (detailBundle && !detailBundle.partner) {
      return 'This code is not in the Supabase SAP lead masterlist. Import with pnpm migrate:aifm-sap-leads or open the live SAP list.';
    }
    return null;
  }, [router.isReady, resolvedLeadCode, detailQueryError, detailBundle]);

  const handleTabChange = (key) => {
    if (key) setActiveTab(key);
  };

  if (loading) {
    return (
      <Container>
        <Row>
          <Col lg={12} md={12} sm={12}>
            <div
              style={{
                background: HEADER_BG,
                padding: '1.5rem 2rem',
                borderRadius: '0 0 24px 24px',
                marginTop: '-39px',
                marginLeft: '10px',
                marginRight: '10px',
                marginBottom: '20px',
              }}
            >
              <div className="d-flex justify-content-between align-items-start">
                <div className="d-flex flex-column">
                  <div className="mb-3">
                    <h1
                      className="mb-2"
                      style={{
                        fontSize: '28px',
                        fontWeight: '600',
                        color: '#FFFFFF',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Loading…
                    </h1>
                    <p
                      className="mb-2"
                      style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontWeight: '400',
                        lineHeight: '1.5',
                      }}
                    >
                      View and manage lead details (masterlist)
                    </p>
                  </div>
                  <nav style={{ fontSize: '14px', fontWeight: '500' }}>
                    <div className="d-flex align-items-center">
                      <i className="fe fe-home" style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                      <Link href="/" className="text-decoration-none ms-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                        Dashboard
                      </Link>
                      <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                        /
                      </span>
                      <Link href="/leads" className="text-decoration-none" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                        Leads
                      </Link>
                      <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                        /
                      </span>
                      <span style={{ color: '#FFFFFF' }}>Loading…</span>
                    </div>
                  </nav>
                </div>
              </div>
            </div>
          </Col>
        </Row>
        <Row>
          <Col>
            <Card className="text-center shadow-sm">
              <Card.Body>
                <Spinner animation="border" role="status" variant="primary" style={{ width: '3rem', height: '3rem' }}>
                  <span className="visually-hidden">Loading…</span>
                </Spinner>
                <p className="mt-3 mb-0 text-muted">Loading lead from masterlist…</p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  if (error && !detailData) {
    return (
      <Container className="mt-4">
        <Row>
          <Col>
            <Card className="shadow-sm">
              <Card.Body className="text-center py-5">
                <Card.Title className="text-danger mb-3">Unable to load lead</Card.Title>
                <Card.Text className="text-muted mb-4">{error}</Card.Text>
                <div className="d-flex gap-2 justify-content-center flex-wrap">
                  <Button variant="primary" onClick={() => router.push('/leads')}>
                    Back to SAP Leads masterlist
                  </Button>
                  <Button variant="outline-secondary" onClick={() => router.push('/leads/sap-api')}>
                    SAP API lead list
                  </Button>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    );
  }

  if (!detailData) {
    return (
      <Container className="mt-4">
        <Row>
          <Col>
            <Card>
              <Card.Body className="text-center">
                <Card.Title>No data</Card.Title>
                <Button variant="primary" onClick={() => router.push('/leads')}>
                  Back to Leads
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
      <GeeksSEO title={`SAP Lead: ${detailData.CardName || ''} | FSM Portal`} />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div
            style={{
              background: HEADER_BG,
              padding: '1.5rem 2rem',
              borderRadius: '0 0 24px 24px',
              marginTop: '-39px',
              marginLeft: '10px',
              marginRight: '10px',
              marginBottom: '20px',
            }}
          >
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: '28px',
                      fontWeight: '600',
                      color: '#FFFFFF',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {detailData.CardName}
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: '16px',
                      color: 'rgba(255, 255, 255, 0.7)',
                      fontWeight: '400',
                      lineHeight: '1.5',
                    }}
                  >
                    View and manage lead details, equipment, and history
                  </p>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="badge bg-light text-dark">ID: {detailData.CardCode}</span>
                    {detailData.CustomerType && <Badge bg="secondary">{detailData.CustomerType}</Badge>}
                  </div>
                </div>

                <nav style={{ fontSize: '14px', fontWeight: '500' }}>
                  <div className="d-flex align-items-center">
                    <i className="fe fe-home" style={{ color: 'rgba(255, 255, 255, 0.7)' }} />
                    <Link href="/" className="text-decoration-none ms-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      Dashboard
                    </Link>
                    <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      /
                    </span>
                    <Link href="/leads" className="text-decoration-none" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      Leads
                    </Link>
                    <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                      /
                    </span>
                    <span style={{ color: '#FFFFFF' }}>Lead Details</span>
                  </div>
                </nav>
              </div>

              <div className="d-flex flex-column gap-2 align-items-end">
                <Button
                  variant="light"
                  className="d-flex align-items-center gap-2"
                  style={{ padding: '0.5rem 1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                  onClick={() => router.push('/leads')}
                >
                  <i className="fe fe-arrow-left" />
                  Back to Leads
                </Button>
                <Button
                  variant="outline-light"
                  className="d-flex align-items-center gap-2"
                  style={{ padding: '0.5rem 1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                  onClick={() => setEditModalOpen(true)}
                >
                  <i className="fe fe-edit-2" />
                  Edit
                </Button>
              </div>
            </div>
          </div>
        </Col>
      </Row>

      <MasterlistEntityEditModal
        show={editModalOpen}
        onHide={() => setEditModalOpen(false)}
        mode="lead"
        code={resolvedLeadCode}
        customerData={detailData}
        onSaved={() => refetchLeadDetail()}
      />

      <Row>
        <Col xl={12} lg={12} md={12} sm={12}>
          <Card className="shadow-sm">
            <Card.Body>
              <Tabs activeKey={activeTab} onSelect={handleTabChange} className="mb-3">
                <Tab eventKey="accountInfo" title="Account Info">
                  <AccountInfoTab customerData={detailData} />
                </Tab>
                <Tab eventKey="serviceLocation" title="Address">
                  <ServiceLocationTab
                    customerData={detailData}
                    addressDetails={addressDetails}
                    masterlistContactEdit={
                      resolvedLeadCode ? { kind: 'lead', code: resolvedLeadCode } : null
                    }
                    onMasterlistContactSaved={() => refetchLeadDetail()}
                    onLocationDeleted={refetchLeadDetail}
                  />
                </Tab>
                <Tab eventKey="notes" title="Notes">
                  <MasterlistOnlyTabMessage noun="Notes" />
                </Tab>
                <Tab eventKey="equipments" title="Equipments">
                  <MasterlistOnlyTabMessage noun="Equipment" />
                </Tab>
                <Tab eventKey="history" title="Job History">
                  <div className="mb-3">
                    <Link
                      href={`/customers/view/${encodeURIComponent(resolvedLeadCode)}`}
                      className="text-decoration-none"
                    >
                      Open customer view
                    </Link>
                  </div>
                  <HistoryTab customerID={resolvedLeadCode} />
                </Tab>
                <Tab eventKey="quotations" title="Quotations">
                  <MasterlistOnlyTabMessage noun="Quotations" />
                </Tab>
                <Tab eventKey="documents" title="Documents">
                  <MasterlistOnlyTabMessage noun="Documents" />
                </Tab>
              </Tabs>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ViewSapLeadMasterlist;
