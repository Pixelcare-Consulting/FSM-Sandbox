import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Form,
  Row,
  Col,
  InputGroup,
} from 'react-bootstrap';
import { memoFoldersForEmail } from '../../../../lib/utils/companyMemoDevAccess';

const CompanyMemoBodyEditor = dynamic(
  () => import('sub-components/dashboard/company-memos/CompanyMemoBodyEditor'),
  {
    ssr: false,
    loading: () => (
      <div
        className="border rounded bg-light text-muted small p-3"
        style={{ minHeight: 180 }}
      >
        Loading editor…
      </div>
    ),
  }
);

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const GROUP_SUGGESTIONS = [
  'Accountants',
  'Field Technicians',
  'Dispatch',
  'Sales',
  'Management',
  'All',
];

/**
 * @param {object} props
 * @param {object} props.values
 * @param {(patch: object) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.viewerEmail]
 * @param {string} [props.editorKey]
 */
export default function CompanyMemoForm({
  values,
  onChange,
  disabled,
  viewerEmail = '',
  editorKey = 'new',
}) {
  const setField = (name, v) => onChange({ [name]: v });

  const [groupMode, setGroupMode] = useState('list');

  const folderOptions = useMemo(
    () => memoFoldersForEmail(viewerEmail),
    [viewerEmail]
  );

  const expiryDateStr = useMemo(() => {
    if (!values.expires_at) return '';
    const d = new Date(values.expires_at);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }, [values.expires_at]);

  const onExpiryChange = (e) => {
    const v = e.target.value;
    if (!v) {
      setField('expires_at', null);
      return;
    }
    setField('expires_at', new Date(`${v}T23:59:59.999Z`).toISOString());
  };

  return (
    <>
      <Form.Group className="mb-3">
        <Form.Label>Subject</Form.Label>
        <Form.Control
          value={values.subject}
          onChange={(e) => setField('subject', e.target.value)}
          disabled={disabled}
          placeholder="Short headline"
        />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label>Memo text</Form.Label>
        <CompanyMemoBodyEditor
          editorKey={editorKey}
          value={values.body || ''}
          onChange={(html) => setField('body', html)}
          disabled={disabled}
        />
      </Form.Group>
      <Row className="g-3 mb-3">
        <Col md={4}>
          <Form.Group>
            <Form.Label>Folder</Form.Label>
            <Form.Select
              value={values.folder || 'General'}
              onChange={(e) => setField('folder', e.target.value)}
              disabled={disabled}
            >
              {folderOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group>
            <Form.Label>Priority</Form.Label>
            <Form.Select
              value={values.priority}
              onChange={(e) => setField('priority', e.target.value)}
              disabled={disabled}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group>
            <Form.Label>Memo should expire on</Form.Label>
            <Form.Control
              type="date"
              value={expiryDateStr}
              onChange={onExpiryChange}
              disabled={disabled}
            />
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group>
            <Form.Label>Group</Form.Label>
            <InputGroup>
              <Form.Select
                value={groupMode === 'list' ? values.target_group || '' : '__custom__'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') {
                    setGroupMode('custom');
                  } else {
                    setGroupMode('list');
                    setField('target_group', v || '');
                  }
                }}
                disabled={disabled || !values.is_group_memo}
              >
                <option value="">— Select —</option>
                {GROUP_SUGGESTIONS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </Form.Select>
            </InputGroup>
            {values.is_group_memo && groupMode === 'custom' ? (
              <Form.Control
                className="mt-2"
                value={values.target_group || ''}
                onChange={(e) => setField('target_group', e.target.value)}
                disabled={disabled}
                placeholder="Custom group label"
              />
            ) : null}
          </Form.Group>
        </Col>
      </Row>
      <div className="d-flex flex-column gap-2 mb-4">
        <Form.Check
          type="switch"
          id="memo-is-group"
          checked={!!values.is_group_memo}
          onChange={(e) => setField('is_group_memo', e.target.checked)}
          disabled={disabled}
          label="This is a group memo"
        />
        {/* DO NOT REMOVE THIS COMMENTED OUT CODE 
        <Form.Check
          type="switch"
          id="memo-sign-in"
          checked={!!values.show_on_sign_in}
          onChange={(e) => setField('show_on_sign_in', e.target.checked)}
          disabled={disabled}
          label="Display upon sign in (dashboard landing)"
        />
        <Form.Check
          type="switch"
          id="memo-job"
          checked={!!values.show_on_job_screen}
          onChange={(e) => setField('show_on_job_screen', e.target.checked)}
          disabled={disabled}
          label="Display on job screen (reserved for future use)"
        />
        <Form.Check
          type="switch"
          id="memo-dispatch"
          checked={!!values.show_on_dispatch_screen}
          onChange={(e) => setField('show_on_dispatch_screen', e.target.checked)}
          disabled={disabled}
          label="Display on dispatch screen (reserved for future use)"
        /> */}
        <Form.Check
          type="switch"
          id="memo-header"
          checked={!!values.show_in_header}
          onChange={(e) => setField('show_in_header', e.target.checked)}
          disabled={disabled}
          label="Show in header ticker"
        />
        <Form.Check
          type="switch"
          id="memo-only-creator"
          checked={!!values.only_creator_can_edit}
          onChange={(e) => setField('only_creator_can_edit', e.target.checked)}
          disabled={disabled}
          label="Only I can modify this memo"
        />
      </div>
    </>
  );
}

export const defaultCompanyMemoValues = {
  subject: '',
  body: '',
  folder: 'General',
  priority: 'medium',
  expires_at: null,
  is_group_memo: false,
  target_group: '',
  show_on_sign_in: false,
  show_on_job_screen: false,
  show_on_dispatch_screen: false,
  show_in_header: true,
  only_creator_can_edit: false,
};
