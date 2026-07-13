import { useState } from 'react';
import { Button, Badge, Spinner, Alert } from 'react-bootstrap';
import PortalModal, { PortalConfirmPanel, PortalConfirmRow } from '../portal/PortalModal';

const ACTION_LABELS = {
  promote: { label: 'Promote', variant: 'warning' },
  insert: { label: 'Create', variant: 'success' },
  update: { label: 'Update', variant: 'primary' },
  skip: { label: 'Skip', variant: 'secondary' },
};

const ADDRESS_ACTION_LABELS = {
  add: { label: 'Add', variant: 'success' },
  update: { label: 'Update', variant: 'primary' },
  unchanged: { label: 'Unchanged', variant: 'secondary' },
  remove: { label: 'Remove from FSM', variant: 'danger' },
  keep: { label: 'Keep in FSM', variant: 'warning' },
};

function actionBadge(action) {
  const meta = ACTION_LABELS[action] || ACTION_LABELS.skip;
  return (
    <Badge bg={meta.variant} className="fw-normal">
      {meta.label}
    </Badge>
  );
}

function addressActionBadge(row) {
  if (row.action === 'remove' && row.willSkip) {
    const meta = ADDRESS_ACTION_LABELS.keep;
    const jobs = Number(row.jobCount) || 0;
    return (
      <Badge bg={meta.variant} className="fw-normal" style={{ fontSize: '0.7rem' }}>
        {`${meta.label} (${jobs} job${jobs === 1 ? '' : 's'})`}
      </Badge>
    );
  }
  const meta = ADDRESS_ACTION_LABELS[row.action] || ADDRESS_ACTION_LABELS.unchanged;
  return (
    <Badge bg={meta.variant} className="fw-normal" style={{ fontSize: '0.7rem' }}>
      {meta.label}
    </Badge>
  );
}

function filterPreviewItems(items, entityFilter) {
  if (!entityFilter || entityFilter === 'all') return items || [];
  return (items || []).filter((item) => item.entityType === entityFilter);
}

function formatModeLabel(preview) {
  if (!preview) return '';
  if (preview.mode === 'promotion') return 'CP → SAP promotion';
  if (preview.mode === 'targeted') return `Targeted sync (${preview.customerCode})`;
  const start = preview.dateRange?.start_date;
  const end = preview.dateRange?.end_date;
  return start && end ? `Delta sync (${start} → ${end})` : 'Delta sync (last 14 days)';
}

function itemRowKey(item) {
  return `${item.action}-${item.cardCode}-${item.portalCode || ''}`;
}

function countAddressChanges(addressChanges) {
  if (!Array.isArray(addressChanges)) return { total: 0, changed: 0 };
  const changed = addressChanges.filter((row) => row.action !== 'unchanged').length;
  return { total: addressChanges.length, changed };
}

function collectFsmAddressImpact(items) {
  let removeCount = 0;
  let skipCount = 0;
  const skipSamples = [];
  for (const item of items || []) {
    for (const row of item.addressChanges || []) {
      if (row.action !== 'remove') continue;
      if (row.willSkip) {
        skipCount += 1;
        if (skipSamples.length < 5) {
          const jobs = Number(row.jobCount) || 0;
          skipSamples.push(`${row.label} (${jobs} job${jobs === 1 ? '' : 's'})`);
        }
      } else {
        removeCount += 1;
      }
    }
  }
  return { removeCount, skipCount, skipSamples };
}

function AddressValue({ value, muted = false }) {
  if (!value) {
    return <span className="text-muted fst-italic">—</span>;
  }
  return (
    <span className={muted ? 'text-muted' : undefined} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {value}
    </span>
  );
}

function AddressChangesPanel({ addressChanges }) {
  if (!Array.isArray(addressChanges) || addressChanges.length === 0) {
    return (
      <div className="small text-muted py-2 px-3 bg-light border-top">
        No SAP addresses returned for this business partner.
      </div>
    );
  }

  return (
    <div className="bg-light border-top">
      <table className="table table-sm table-borderless mb-0 small">
        <thead>
          <tr className="text-muted text-uppercase" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
            <th style={{ width: '18%' }}>Site</th>
            <th style={{ width: '14%' }}>Change</th>
            <th style={{ width: '34%' }}>Before (portal)</th>
            <th style={{ width: '34%' }}>After (SAP sync)</th>
          </tr>
        </thead>
        <tbody>
          {addressChanges.map((row) => (
            <tr key={`${row.label}-${row.action}-${row.willSkip ? 'skip' : 'go'}`}>
              <td className="align-top fw-medium">
                {row.label}
                {row.willSkip && Array.isArray(row.jobNumbers) && row.jobNumbers.length > 0 ? (
                  <div className="text-muted fw-normal" style={{ fontSize: '0.72rem' }}>
                    Jobs: {row.jobNumbers.join(', ')}
                    {(row.jobCount || 0) > row.jobNumbers.length ? '…' : ''}
                  </div>
                ) : null}
              </td>
              <td className="align-top">{addressActionBadge(row)}</td>
              <td className="align-top">
                <AddressValue value={row.before} muted={row.action === 'add'} />
              </td>
              <td className="align-top">
                <AddressValue value={row.after} muted={row.action === 'remove'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewItemRow({ item }) {
  const [expanded, setExpanded] = useState(false);
  const { total, changed } = countAddressChanges(item.addressChanges);
  const hasAddresses = total > 0;
  const toggleExpanded = () => {
    if (hasAddresses) setExpanded((prev) => !prev);
  };

  return (
    <>
      <tr
        className={hasAddresses ? 'cursor-pointer' : undefined}
        onClick={toggleExpanded}
        style={hasAddresses ? { cursor: 'pointer' } : undefined}
      >
        <td>{actionBadge(item.action)}</td>
        <td>
          <code className="small">
            {item.action === 'promote' ? `${item.portalCode} → ${item.cardCode}` : item.cardCode}
          </code>
        </td>
        <td className="text-truncate" style={{ maxWidth: 200 }} title={item.cardName}>
          {item.cardName}
        </td>
        <td className="text-muted small text-uppercase">{item.entityType}</td>
        <td className="small text-muted text-nowrap">
          {hasAddresses ? (
            <span>
              <span className="me-1" aria-hidden>
                {expanded ? '▾' : '▸'}
              </span>
              {changed > 0
                ? `${changed} address change${changed === 1 ? '' : 's'}`
                : `${total} address${total === 1 ? '' : 'es'}`}
            </span>
          ) : (
            '—'
          )}
        </td>
      </tr>
      {expanded && hasAddresses ? (
        <tr>
          <td colSpan={5} className="p-0">
            <AddressChangesPanel addressChanges={item.addressChanges} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function SapDeltaSyncPreviewModal({
  show,
  onHide,
  preview,
  loading = false,
  error = null,
  onConfirm,
  confirming = false,
  entityFilter = 'all',
  title = 'Sync from SAP — Preview',
}) {
  const counts = preview?.counts || {};
  const visibleItems = filterPreviewItems(preview?.items, entityFilter);
  const totalVisible = visibleItems.length;
  const totalPlannedChanges =
    (counts.promotions || 0) +
    (counts.customersToInsert || 0) +
    (counts.customersToUpdate || 0) +
    (counts.leadsToInsert || 0) +
    (counts.leadsToUpdate || 0);
  const hasBlockingError = Boolean(error) || (preview?.errors?.length > 0 && !preview?.counts?.sapHits);
  const canConfirm = !loading && !confirming && !hasBlockingError && totalPlannedChanges > 0;
  const { removeCount, skipCount, skipSamples } = collectFsmAddressImpact(visibleItems);
  const hasFsmAddressImpact = removeCount > 0 || skipCount > 0;

  const handleConfirm = () => {
    if (!onConfirm) return;
    if (hasFsmAddressImpact) {
      const lines = [
        'Address removals apply to the FSM portal only. SAP Business Partner addresses are not modified.',
      ];
      if (removeCount > 0) {
        lines.push(
          `${removeCount} portal service location${removeCount === 1 ? '' : 's'} will be removed from FSM.`
        );
      }
      if (skipCount > 0) {
        lines.push(
          `${skipCount} portal location${skipCount === 1 ? '' : 's'} will be kept in FSM because of linked jobs` +
            (skipSamples.length ? `: ${skipSamples.join('; ')}` : '.')
        );
      }
      lines.push('Proceed with sync?');
      if (typeof window !== 'undefined' && !window.confirm(lines.join('\n\n'))) {
        return;
      }
    }
    onConfirm();
  };

  return (
    <PortalModal
      show={show}
      onHide={() => !confirming && onHide()}
      title={title}
      subtitle="Review planned changes before writing to the portal masterlist."
      size="xl"
      scrollable
      hideCloseButton={confirming}
      footer={
        <>
          <Button variant="outline-secondary" onClick={onHide} disabled={confirming}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={!canConfirm || confirming}>
            {confirming ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Syncing…
              </>
            ) : (
              'Confirm sync'
            )}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="text-center py-4">
          <Spinner animation="border" variant="primary" className="mb-3" />
          <p className="mb-0 text-muted">Loading SAP preview…</p>
        </div>
      ) : error ? (
        <Alert variant="danger" className="mb-0">
          {error}
        </Alert>
      ) : preview ? (
        <>
          <PortalConfirmPanel className="mb-3">
            <PortalConfirmRow label="Mode" value={formatModeLabel(preview)} />
            {preview.customerCode ? (
              <PortalConfirmRow label="SAP code" value={preview.customerCode} />
            ) : null}
            <PortalConfirmRow label="SAP hits" value={String(counts.sapHits || 0)} />
            <PortalConfirmRow
              label="Customers"
              value={`${counts.customersToInsert || 0} create · ${counts.customersToUpdate || 0} update${
                counts.promotions ? ` · ${counts.promotions} promote` : ''
              }`}
            />
            <PortalConfirmRow
              label="Leads"
              value={`${counts.leadsToInsert || 0} create · ${counts.leadsToUpdate || 0} update`}
            />
          </PortalConfirmPanel>

          <Alert variant="info" className="small">
            Address removals apply to the <strong>FSM portal only</strong>. SAP Business Partner
            addresses are never deleted or modified by this sync.
          </Alert>

          {hasFsmAddressImpact ? (
            <Alert variant="warning" className="small">
              {removeCount > 0 ? (
                <div>
                  {removeCount} portal service location{removeCount === 1 ? '' : 's'} will be{' '}
                  <strong>removed from FSM</strong> (already gone in SAP).
                </div>
              ) : null}
              {skipCount > 0 ? (
                <div>
                  {skipCount} portal location{skipCount === 1 ? '' : 's'} will be{' '}
                  <strong>kept in FSM</strong> because active jobs still reference them
                  {skipSamples.length ? ` — ${skipSamples.join('; ')}` : ''}.
                </div>
              ) : null}
            </Alert>
          ) : null}

          {Array.isArray(preview.errors) && preview.errors.length > 0 && (
            <Alert variant="warning" className="small">
              {preview.errors.slice(0, 3).map((msg) => (
                <div key={msg}>{msg}</div>
              ))}
            </Alert>
          )}

          {totalVisible === 0 ? (
            <Alert variant="info" className="mb-0">
              {totalPlannedChanges > 0
                ? `No ${entityFilter === 'lead' ? 'lead' : 'customer'} rows match this view, but ${totalPlannedChanges} other masterlist change${totalPlannedChanges === 1 ? '' : 's'} will still run.`
                : 'No masterlist changes planned. Adjust the SAP code or date range and try again.'}
            </Alert>
          ) : (
            <>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <span className="fw-semibold small text-uppercase text-muted" style={{ letterSpacing: '0.04em' }}>
                  Planned changes
                </span>
                {preview.itemsTruncated ? (
                  <span className="small text-muted">
                    Showing first {totalVisible} of {counts.sapHits} SAP hits
                  </span>
                ) : (
                  <span className="small text-muted">{totalVisible} item{totalVisible === 1 ? '' : 's'}</span>
                )}
              </div>
              <p className="small text-muted mb-2">
                Click a row to expand address Before / After details.
              </p>
              <div className="table-responsive border rounded" style={{ maxHeight: 420 }}>
                <table className="table table-sm table-hover mb-0 align-middle">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th>Action</th>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Addresses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <PreviewItemRow key={itemRowKey(item)} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleItems.some((item) => item.note) && (
                <p className="small text-muted mt-2 mb-0">
                  {visibleItems.find((item) => item.note)?.note}
                </p>
              )}
            </>
          )}
        </>
      ) : null}
    </PortalModal>
  );
}
