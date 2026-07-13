import React, { Fragment } from 'react';
import dynamic from 'next/dynamic';
import { Row, Col, Card } from 'react-bootstrap';
import Link from 'next/link';
import { GeeksSEO } from 'widgets';
import DefaultDashboardLayout from 'layouts/dashboard/DashboardIndexTop';

const CreateCustomerForm = dynamic(
  () => import('./_components/CreateCustomerForm'),
  { ssr: false, loading: () => <div className="text-center py-5">Loading form...</div> }
);

const CreateCustomerPage = () => {
  return (
    <Fragment>
      <GeeksSEO title="Create Customer | SAS&ME - SAP B1 | Portal" />
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
            <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
              <div className="d-flex flex-column">
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
                    Create Customer
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
                    Add a new portal customer with addresses and contacts across the tabs below.
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
                      Fill in customer details, addresses, and contacts across the tabs below. This creates a{' '}
                      <strong>portal code (<code>CP#####</code>)</strong> saved locally — not SAP. To get an{' '}
                      <strong>SAP Lead (<code>L#####</code>)</strong>, open the record in{' '}
                      <strong>Portal Customers</strong> and click <strong>Convert to SAP</strong>.
                    </span>
                  </div>
                </div>

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
                    Portal Customer
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
                    <i className="fe fe-user me-1"></i>
                    CP Code
                  </span>
                </div>

                <nav style={{ fontSize: '14px', fontWeight: '500' }}>
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
                    <Link
                      href="/customer-leads"
                      className="text-decoration-none"
                      style={{ color: 'rgba(255, 255, 255, 0.7)' }}
                    >
                      Customers
                    </Link>
                    <span className="mx-2" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>/</span>
                    <span className="ms-2" style={{ color: '#FFFFFF' }}>
                      Create Customer
                    </span>
                  </div>
                </nav>
              </div>

              <div>
                <Link
                  href="/customer-leads"
                  className="btn btn-light btn-sm d-flex align-items-center gap-2"
                  style={{
                    border: 'none',
                    borderRadius: '12px',
                    padding: '10px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    fontWeight: '500',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  <i className="fe fe-arrow-left"></i>
                  Back to Customers
                </Link>
              </div>
            </div>
          </div>
        </Col>
      </Row>
      <Row>
        <Col md={12} xs={12} className="mb-5">
          <Card className="shadow-sm">
            <Card.Body>
              <CreateCustomerForm />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Fragment>
  );
};

CreateCustomerPage.Layout = DefaultDashboardLayout;
export default CreateCustomerPage;
