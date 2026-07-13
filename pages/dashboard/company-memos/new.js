import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  normalizeMemoFolder,
  UPDATE_LOGS_FOLDER,
} from '../../../lib/constants/companyMemoFolders';
import { canManageUpdateLogsFolder } from '../../../lib/utils/companyMemoDevAccess';
import { Container, Row, Col, Button, Form } from 'react-bootstrap';
import { useQueryClient } from 'react-query';
import Swal from 'sweetalert2';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';
import { GeeksSEO } from 'widgets';
import { DashboardHeader } from 'sub-components';
import DefaultDashboardLayout from 'layouts/dashboard/DashboardIndexTop';
import CompanyMemoForm, {
  defaultCompanyMemoValues,
} from './_components/CompanyMemoForm';
import CompanyMemosSummaryPanel from './_components/CompanyMemosSummaryPanel';
import { normalizeMemoBodyForSave } from '../../../lib/utils/memoHtml';

const CompanyMemoNew = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState(null);
  const [values, setValues] = useState(defaultCompanyMemoValues);
  const [saving, setSaving] = useState(false);
  const { user } = useCurrentUser();
  const viewerEmail = user?.email || Cookies.get('email') || '';
  const canManageUpdateLogs = canManageUpdateLogsFolder(viewerEmail);

  useEffect(() => {
    if (user?.role !== 'ADMIN') {
      router.replace('/dashboard');
      setAllowed(false);
      return;
    }
    setAllowed(true);
  }, [router, user?.role]);

  useEffect(() => {
    if (!router.isReady) return;
    const folderRaw = router.query.folder;
    const folder = Array.isArray(folderRaw) ? folderRaw[0] : folderRaw;
    if (!folder) return;
    const normalized = normalizeMemoFolder(folder);
    if (normalized === UPDATE_LOGS_FOLDER && !canManageUpdateLogs) {
      toast.error(
        'Update Logs are restricted to @pixelcareconsulting.com developers.'
      );
      return;
    }
    setValues((v) => ({ ...v, folder: normalized }));
  }, [router.isReady, router.query.folder, canManageUpdateLogs]);

  const patchValues = (patch) => setValues((v) => ({ ...v, ...patch }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const uid = user?.id || user?.uid;
    if (!uid) {
      toast.error('Not signed in');
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
      const res = await fetch('/api/company-memos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || res.statusText || 'Save failed');
      }
      const created = json;
      await queryClient.invalidateQueries(['company-memos']);
      toast.success('Memo saved');
      router.replace(`/dashboard/company-memos/${created.id}`);
    } catch (err) {
      console.error(err);
      Swal.fire('Error', err.message || 'Save failed', 'error');
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

  return (
    <Container className="mt-1 mb-6">
      <GeeksSEO title="Add memo | SAS&ME Portal" />
      <DashboardHeader
        title="Add new memo"
        breadcrumbs={[
          { icon: 'fe fe-home', label: 'Dashboard', href: '/dashboard' },
          { label: 'Company memos', href: '/dashboard/company-memos' },
          { label: 'New' },
        ]}
      />
      <Row className="g-4">
        <Col xs={12} lg={8}>
          <div className="card shadow-sm">
            <div className="card-body">
              <Form onSubmit={onSubmit}>
                <CompanyMemoForm
                  editorKey="new"
                  values={values}
                  onChange={patchValues}
                  disabled={saving}
                  viewerEmail={viewerEmail}
                />
                <div className="d-flex gap-2 justify-content-center pt-2">
                  <Button type="submit" variant="primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save memo'}
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
        </Col>
        <Col xs={12} lg={4}>
          <CompanyMemosSummaryPanel enabled={allowed === true} />
        </Col>
      </Row>
    </Container>
  );
};

CompanyMemoNew.Layout = DefaultDashboardLayout;
export default CompanyMemoNew;
