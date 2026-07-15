import React from 'react';
import styles from './StatusBadge.module.css';

const StatusBadge = ({ 
  status, 
  type, 
  icon, 
  color, 
  withBorder = false,
  actionButton = null
}) => {
  const getStatusStyles = (status) => {
    const baseStyles = {
      logged: {
        backgroundColor: '#FFD580',
        color: '#B8860B',
        borderColor: '#B8860B',
      },
      'in progress': {
        backgroundColor: '#6A89CC',
        color: '#2E4A8C',
        borderColor: '#2E4A8C',
      },
      'quotation in progress': {
        backgroundColor: '#EDE9FE',
        color: '#6D28D9',
        borderColor: '#6D28D9',
      },
      'quotation sent': {
        backgroundColor: '#CCFBF1',
        color: '#0F766E',
        borderColor: '#0F766E',
      },
      open: {
        backgroundColor: '#DBEAFE',
        color: '#1E40AF',
        borderColor: '#1E40AF',
      },
      pending: {
        backgroundColor: '#CCCCCC',
        color: '#666666',
        borderColor: '#666666',
      },
      completed: {
        backgroundColor: '#77DD77',
        color: '#2D7A2D',
        borderColor: '#2D7A2D',
      },
      closed: {
        backgroundColor: '#77DD77',
        color: '#2D7A2D',
        borderColor: '#2D7A2D',
      },
      cancelled: {
        backgroundColor: '#FF6961',
        color: '#CC0000',
        borderColor: '#CC0000',
      },
      repair: {
        backgroundColor: '#fef2f2',
        color: '#dc2626',
        borderColor: '#dc2626',
      },
      default: {
        backgroundColor: '#f3f4f6',
        color: '#6b7280',
        borderColor: '#6b7280',
      },
    };

    const key = status?.toLowerCase()?.replace(/_/g, ' ');
    return baseStyles[key] || baseStyles.default;
  };

  const styles = color ? {
    backgroundColor: `${color}15`,
    color: color,
    borderColor: color,
  } : getStatusStyles(status);

  return (
    <div className="d-flex align-items-center gap-2">
      <span
        className={`status-badge ${withBorder ? 'with-border' : ''}`}
        style={{
          ...styles,
          border: withBorder ? `1px solid ${styles.borderColor}` : 'none',
        }}
      >
        {icon && <i className={`fe ${icon} me-1`}></i>}
        {type || status}
      </span>
      {actionButton && (
        <button
          className="action-button"
          onClick={actionButton.onClick}
          style={{
            backgroundColor: '#fff',
            border: '1px solid #FF9800',
            color: '#FF9800',
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {actionButton.label}
        </button>
      )}
    </div>
  );
};

export default StatusBadge; 