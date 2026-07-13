import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Container, Row, Col, Button, Form, Alert } from 'react-bootstrap';
import { useQuery, useQueryClient } from 'react-query';
import Swal from 'sweetalert2';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';
import { GeeksSEO } from 'widgets';
import { DashboardHeader } from 'sub-components';
import DefaultDashboardLayout from 'layouts/dashboard/DashboardIndexTop';
import {
  COMPANY_MEMOS_DETAIL_STALE_MS,
  COMPANY_MEMOS_QUERY_OPTIONS,
  companyMemoDetailQueryKey,
  fetchCompanyMemoById,
} from '../../../lib/companyMemos/companyMemosQueryKeys';
import CompanyMemoForm, {
  defaultCompanyMemoValues,
} from './_components/CompanyMemoForm';
import CompanyMemosSummaryPanel from './_components/CompanyMemosSummaryPanel';
import {
  canManageUpdateLogsFolder,
  canMutateCompanyMemoWithFolder,
} from '../../../lib/utils/companyMemoDevAccess';
import { memoBodyForQuill, normalizeMemoBodyForSave } from '../../../lib/utils/memoHtml';

function rowToFormValues(row) {
  if (!row) return { ...defaultCompanyMemoValues };
  return {
    subject: row.subject || '',
    body: memoBodyForQuill(row.body),
    priority: row.priority || 'medium',
    expires_at: row.expires_at || null,
    is_group_memo: !!row.is_group_memo,
    target_group: row.target_group || '',
    show_on_sign_in: !!row.show_on_sign_in,
    show_on_job_screen: !!row.show_on_job_screen,
    show_on_dispatch_screen: !!row.show_on_dispatch_screen,
    show_in_header: row.show_in_header !== false,
    only_creator_can_edit: !!row.only_creator_can_edit,
    folder: row.folder || 'General',
  };
}

const CompanyMemoEdit = () => {
  const router = useRouter();
  const idRaw = router.query.id;
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState(null);
  const [values, setValues] = useState(defaultCompanyMemoValues);
  const [saving, setSaving] = useState(false);

  const { user } = useCurrentUser();
  const viewerUid = user?.id || user?.uid;
  const viewerEmail = user?.email || Cookies.get('email') || '';

  useEffect(() => {
    if (user?.role !== 'ADMIN') {
      router.replace('/dashboard');
      setAllowed(false);
      return;
    }
    setAllowed(true);
  }, [router, user?.role]);

  const { data: row, isLoading } = useQuery(
    companyMemoDetailQueryKey(id),
    () => (id ? fetchCompanyMemoById(id) : null),
    {
      enabled: allowed === true && router.isReady && !!id,
      staleTime: COMPANY_MEMOS_DETAIL_STALE_MS,
      ...COMPANY_MEMOS_QUERY_OPTIONS,
    }
  );

  useEffect(() => {
    if (!row) return;
    setValues(rowToFormValues(row));
  }, [row]);

  const patchValues = (patch) => setValues((v) => ({ ...v, ...patch }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!row || !canMutateCompanyMemoWithFolder(row, viewerUid, viewerEmail)) {
      toast.error(
        row?.folder === 'Update Logs' && !canManageUpdateLogsFolder(viewerEmail)
          ? 'Update Logs can only be edited by @pixelcareconsulting.com developers.'
          : 'Only the memo creator can change this memo.'
      );
      return;
    }
    if (!values.subject?.trim()) {
      toast.error('Subject is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subject: values.subject.trim(),
        body: normalizeMemoBodyForSave(values.body),
        priority: values.priority,
        expires_at: values.expires_at || null,
        is_group_memo: values.is_group_memo,
        target_group: values.is_group_memo ? values.target_group?.trim() || null : null,
        show_on_sign_in: values.show_on_sign_in,
        show_on_job_screen: values.show_on_job_screen,
        show_on_dispatch_screen: values.show_on_dispatch_screen,
        show_in_header: values.show_in_header,
        only_creator_can_edit: values.only_creator_can_edit,
        folder: values.folder || 'General',
      };
      const res = await fetch(
        `/api/company-memos/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || res.statusText || 'Update failed');
      }
      await queryClient.invalidateQueries(['company-memos']);
      toast.success('Memo updated');
      router.push('/dashboard/company-memos');
    } catch (err) {
      console.error(err);
      Swal.fire('Error', err.message || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (allowed !== true) {
    return (
      <Container className="py-5">
        <p className="text-muted">Checking access…</p>
      </Container>
    );
  }

  const headerBreadcrumbLabel =
    row && !isLoading ? truncateSubject(row.subject) : 'Edit';

  const headerTitle =
    row && !isLoading
      ? canMutateCompanyMemoWithFolder(row, viewerUid, viewerEmail)
        ? 'Edit memo'
        : 'View memo'
      : 'Edit memo';

  const mainCard = (() => {
    if (!router.isReady || !id) {
      return (
        <div className="card shadow-sm">
          <div className="card-body">
            <p className="text-muted mb-0">Loading…</p>
          </div>
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className="card shadow-sm">
          <div className="card-body">
            <p className="text-muted mb-0">Loading memo…</p>
          </div>
        </div>
      );
    }
    if (!row) {
      return (
        <div className="card shadow-sm">
          <div className="card-body">
            <p className="text-muted">Memo not found.</p>
            <Button as={Link} href="/dashboard/company-memos" variant="link" className="px-0">
              Back to list
            </Button>
          </div>
        </div>
      );
    }
    const canMutate = canMutateCompanyMemoWithFolder(row, viewerUid, viewerEmail);
    return (
      <div className="card shadow-sm">
        <div className="card-body">
          {!canMutate &&
          row.folder === 'Update Logs' &&
          !canManageUpdateLogsFolder(viewerEmail) ? (
            <Alert variant="info" className="small">
              <strong>Read-only.</strong> Update Logs memos can only be edited by developers with a
              @pixelcareconsulting.com email.
            </Alert>
          ) : null}
          {!canMutate && row.only_creator_can_edit ? (
            <Alert variant="warning" className="small">
              <strong>Read-only for you.</strong> The creator restricted this memo to edits by themselves
              only (&quot;Only I can modify this memo&quot;). You can read the details but cannot save
              changes or delete this memo from the portal.
            </Alert>
          ) : null}
          <Form onSubmit={onSubmit}>
            <CompanyMemoForm
              editorKey={id || 'edit'}
              values={values}
              onChange={patchValues}
              disabled={saving || !canMutate}
              viewerEmail={viewerEmail}
            />
            <div className="d-flex gap-2 justify-content-center pt-2">
              <Button type="submit" variant="primary" disabled={saving || !canMutate}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="outline-secondary"
                as={Link}
                href="/dashboard/company-memos"
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </div>
      </div>
    );
  })();

  return (
    <Container className="mt-1 mb-6">
      <GeeksSEO title={`Edit memo | SAS&ME Portal`} />
      <DashboardHeader
        title={headerTitle}
        breadcrumbs={[
          { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
          { label: 'Company memos', href: '/dashboard/company-memos' },
          { label: headerBreadcrumbLabel },
        ]}
      />
      <Row className="g-4">
        <Col xs={12} lg={8}>
          {mainCard}
        </Col>
        <Col xs={12} lg={4}>
          <CompanyMemosSummaryPanel currentId={id} enabled={allowed === true} />
        </Col>
      </Row>
    </Container>
  );
};

function truncateSubject(s) {
  if (!s) return 'Edit';
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

CompanyMemoEdit.Layout = DefaultDashboardLayout;
export default CompanyMemoEdit;
