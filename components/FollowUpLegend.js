import React, { useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { BsQuestionCircle } from 'react-icons/bs';
import { Collapse } from 'react-bootstrap';
import StatusBadge from './StatusBadge';
import styles from './FollowUpLegend.module.css';

const FollowUpLegend = ({ followUpTypes }) => {
  const [isOpen, setIsOpen] = useState(false);

  const priorities = [
    { value: 1, label: 'Low', color: '#198754' },
    { value: 2, label: 'Normal', color: '#0d6efd' },
    { value: 3, label: 'High', color: '#fd7e14' },
    { value: 4, label: 'Urgent', color: '#dc3545' }
  ];

  const statuses = [
    { value: 'Quotation In Progress', color: '#6d28d9' },
    { value: 'Quotation Sent', color: '#0f766e' },
    { value: 'Open', color: '#1d4ed8' },
    { value: 'Completed', color: '#2d7a2d' },
    { value: 'Cancelled', color: '#dc2626' },
  ];

  return (
    <div className={styles.legendContainer}>
      <div className={styles.legendHeader} onClick={() => setIsOpen(!isOpen)}>
        <BsQuestionCircle className={styles.helpIcon} />
        <span className={styles.legendHeaderText}>
          {isOpen ? 'Hide Legend' : 'Show Legend'}
        </span>
      </div>

      <Collapse in={isOpen}>
        <div>
          <Row>
            <Col md={4}>
              <div className={styles.legendSection}>
                <h6 className={styles.legendTitle}>Priority</h6>
                <div className={styles.legendItems}>
                  {priorities.map((priority) => (
                    <div key={priority.value} className={styles.legendItem}>
                      <div 
                        className={styles.priorityIndicator} 
                        style={{ backgroundColor: priority.color }}
                      />
                      <span>{priority.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Col>

            <Col md={4}>
              <div className={styles.legendSection}>
                <h6 className={styles.legendTitle}>Status</h6>
                <div className={styles.legendItems}>
                  {statuses.map((status) => (
                    <div key={status.value} className={styles.legendItem}>
                      <StatusBadge 
                        status={status.value} 
                        withBorder={false}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Col>

            <Col md={4}>
              <div className={styles.legendSection}>
                <h6 className={styles.legendTitle}>Types</h6>
                <div className={styles.legendItemsMultiColumn}>
                  {followUpTypes.map((type) => (
                    <div key={type.id} className={styles.legendItem}>
                      <StatusBadge 
                        type={type.name}
                        color={type.color}
                        withBorder={true}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Col>
          </Row>
        </div>
      </Collapse>
    </div>
  );
};

export default FollowUpLegend; 