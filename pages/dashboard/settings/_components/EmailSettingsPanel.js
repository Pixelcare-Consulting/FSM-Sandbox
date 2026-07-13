import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Card,
  Form,
  Button,
  Row,
  Col,
  Alert,
  Spinner,
  Badge,
  Collapse,
  InputGroup,
  Nav,
  Tab,
} from 'react-bootstrap';
import { ChevronDown } from 'react-bootstrap-icons';
import { getSupabaseClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import {
  DEFAULT_EMAIL_TEMPLATES,
  normalizeEmailTemplates,
  normalizeEmailTemplatesForUi,
  migratePlainTemplateBodyToHtml,
  sanitizeEmailTemplateHtml,
  EMAIL_TEMPLATE_KEYS,
} from '@/lib/email/emailTemplatesShared';
import EmailTemplateBodyEditor from './EmailTemplateBodyEditor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import layoutStyles from '../../settings.module.css';

const SETTINGS_ID = 'emailSettings';

function SectionLabel({ children, isFirst }) {
  return (
    <h3
      className={`h6 fw-semibold text-body mb-3 pb-2 border-bottom ${isFirst ? 'mt-0' : 'mt-4 pt-1 border-opacity-50'}`}
    >
      {children}
    </h3>
  );
}

function CollapsibleHowToAlert({ id, expanded, onToggle, children }) {
  const contentId = id ? `how-to-content-${id}` : undefined;
  return (
    <Alert variant="info" className="border rounded-3 py-2 small mb-3">
      <div
        className="d-flex align-items-center justify-content-between gap-2 user-select-none"
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <strong className="mb-0">How to use</strong>
        <ChevronDown
          size={16}
          className="flex-shrink-0 text-secondary"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
        />
      </div>
      <Collapse in={expanded}>
        <div id={contentId}>{children}</div>
      </Collapse>
    </Alert>
  );
}

const TEMPLATE_SECTIONS = [
  {
    key: 'jobAssigned',
    toggleField: 'sendJobAssigned',
    title: 'Job assigned to technician',
    blurb: 'Notify the technician when they are assigned to a job.',
    sampleLabel: 'Send sample',
    placeholders: [
      ['{{job_number}}', 'Job number'],
      ['{{job_title}}', 'Job title'],
      ['{{customer_name}}', 'Customer'],
      ['{{location_name}}', 'Site / location name'],
      ['{{service_location}}', 'Full service address'],
      ['{{contacts}}', 'Contacts (summary line)'],
      ['{{contact_name}}', 'Primary contact name'],
      ['{{contact_email}}', 'Primary contact email'],
      ['{{contact_phone}}', 'Primary contact phone'],
      ['{{technician_name}}', 'Technician'],
      ['{{scheduled_date}}', 'Scheduled date/time'],
      ['{{job_url}}', 'Link to job'],
      ['{{company_name}}', 'Company (From name)'],
    ],
  },
  {
    key: 'jobCompleted',
    toggleField: 'sendJobCompleted',
    title: 'Job completed',
    blurb: 'Notify the customer (or team) when a job is marked complete.',
    sampleLabel: 'Send sample',
    placeholders: [
      ['{{job_number}}', 'Job number'],
      ['{{job_title}}', 'Job title'],
      ['{{customer_name}}', 'Customer'],
      ['{{location_name}}', 'Site / location name'],
      ['{{service_location}}', 'Full service address'],
      ['{{contacts}}', 'Contacts (summary line)'],
      ['{{contact_name}}', 'Primary contact name'],
      ['{{contact_email}}', 'Primary contact email'],
      ['{{contact_phone}}', 'Primary contact phone'],
      ['{{technician_name}}', 'Technician'],
      ['{{completed_at}}', 'Completed date/time'],
      ['{{company_name}}', 'Company (From name)'],
    ],
  },
  {
    key: 'followUpReminder',
    toggleField: 'sendFollowUpReminder',
    title: 'Follow-up reminders',
    blurb: 'Reminder content for scheduled follow-ups.',
    sampleLabel: 'Send sample',
    placeholders: [
      ['{{follow_up_title}}', 'Follow-up title'],
      ['{{assignee_name}}', 'Assignee'],
      ['{{due_date}}', 'Due date'],
      ['{{job_number}}', 'Job number'],
      ['{{job_title}}', 'Job title'],
      ['{{location_name}}', 'Site / location name'],
      ['{{service_location}}', 'Full service address'],
      ['{{contacts}}', 'Contacts (summary line)'],
      ['{{contact_name}}', 'Primary contact name'],
      ['{{contact_email}}', 'Primary contact email'],
      ['{{contact_phone}}', 'Primary contact phone'],
      ['{{notes_line}}', 'Notes line'],
      ['{{follow_up_url}}', 'Link to follow-ups'],
      ['{{company_name}}', 'Company (From name)'],
    ],
  },
];

function previewTriggerId(label) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 58);
  return slug ? `custom.${slug}` : '';
}

const defaultPrefs = {
  smtpHost: '',
  smtpPort: '587',
  smtpEncryption: 'tls',
  smtpUser: '',
  smtpPassword: '',
  fromName: '',
  fromEmail: '',
  sendJobAssigned: true,
  sendJobCompleted: true,
  sendFollowUpReminder: false,
  emailTemplates: normalizeEmailTemplatesForUi({}),
};

const EmailSettingsPanel = () => {
  const [prefs, setPrefs] = useState(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smtpPasswordStored, setSmtpPasswordStored] = useState(false);
  const [testTo, setTestTo] = useState('');
  /** null | 'smtp' | template key */
  const [mailSending, setMailSending] = useState(null);
  const bodyEditorRefs = useRef({});
  const [expandedTemplates, setExpandedTemplates] = useState(() => ({
    jobAssigned: true,
    jobCompleted: false,
    followUpReminder: false,
  }));
  const [activeSettingsTab, setActiveSettingsTab] = useState('templates');
  /** Registry templates from API */
  const [libraryTemplates, setLibraryTemplates] = useState([]);
  const [triggerBindings, setTriggerBindings] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [savingTriggers, setSavingTriggers] = useState(false);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [eventDraft, setEventDraft] = useState({ label: '', description: '', template_id: '' });
  const [expandedLibraryTemplates, setExpandedLibraryTemplates] = useState({});
  const [showLibraryCreate, setShowLibraryCreate] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', subject: '', body_html: '' });
  const [overrideDraft, setOverrideDraft] = useState({
    template_id: '',
    scope_type: 'customer',
    scope_id: '',
    subject: '',
    body_html: '',
  });
  /** Technicians for sample-email merge ({{technician_name}}, follow-up {{assignee_name}}) */
  const [sampleTechnicians, setSampleTechnicians] = useState([]);
  /** '' = auto (session user's tech, else first in directory) */
  const [sampleTechnicianId, setSampleTechnicianId] = useState('');
  const [howToExpanded, setHowToExpanded] = useState({
    library: true,
    triggers: true,
  });

  const toggleTemplatePanel = (key) => {
    setExpandedTemplates((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) return;
        const { data, error } = await supabase
          .from('technicians')
          .select('id, full_name, email, user:users!technicians_user_id_fkey(username)')
          .is('deleted_at', null)
          .order('full_name', { ascending: true });
        if (error) throw error;
        if (!cancelled && data) setSampleTechnicians(data);
      } catch (e) {
        console.error('[EmailSettingsPanel] technicians list:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('id', SETTINGS_ID)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      const v = data?.value || {};
      setSmtpPasswordStored(!!(v.smtpPassword && String(v.smtpPassword).length > 0));
      setPrefs({
        ...defaultPrefs,
        ...v,
        smtpPassword: '',
        emailTemplates: normalizeEmailTemplatesForUi(v.emailTemplates),
      });
    } catch (e) {
      console.error(e);
      toast.error('Failed to load email settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadRegistry = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch('/api/settings/email-templates', {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load templates');
      setLibraryTemplates(data.templates || []);
      setTriggerBindings(data.bindings || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load template library');
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      activeSettingsTab === 'library' ||
      activeSettingsTab === 'triggers' ||
      activeSettingsTab === 'overrides'
    ) {
      loadRegistry();
    }
  }, [activeSettingsTab, loadRegistry]);

  const customLibraryTemplates = libraryTemplates.filter(
    (t) => t.category === 'custom' && !t.deleted_at
  );

  const customTemplatePlaceholders = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const sec of TEMPLATE_SECTIONS) {
      for (const pair of sec.placeholders) {
        if (!seen.has(pair[0])) {
          seen.add(pair[0]);
          out.push(pair);
        }
      }
    }
    return out;
  }, []);

  const toggleLibraryTemplatePanel = (id) => {
    setExpandedLibraryTemplates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLibraryTemplateActive = async (id, isActive) => {
    updateLibraryTemplateField(id, 'is_active', isActive);
    try {
      const res = await fetch(`/api/settings/email-templates/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to update template');
      await loadRegistry();
    }
  };

  const insertLibraryPlaceholder = (tplId, token) => {
    const ref = bodyEditorRefs.current[`lib-${tplId}-body`];
    if (ref?.insertAtCursor) {
      ref.insertAtCursor(token);
      return;
    }
    const tpl = libraryTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    const body = tpl.body_html || '';
    updateLibraryTemplateField(tplId, 'body_html', body + token);
  };

  const saveTriggerBindings = async () => {
    setSavingTriggers(true);
    try {
      const res = await fetch('/api/settings/email-trigger-bindings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bindings: triggerBindings.map((b) => ({
            trigger_id: b.trigger_id,
            template_id: b.template_id,
            enabled: b.enabled,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setTriggerBindings(data.bindings || []);
      toast.success('Automatic email settings saved');
    } catch (e) {
      toast.error(e.message || 'Failed to save triggers');
    } finally {
      setSavingTriggers(false);
    }
  };

  const createCustomTemplate = async () => {
    if (!customDraft.name.trim() || !customDraft.subject.trim()) {
      toast.error('Name and subject are required');
      return;
    }
    try {
      const res = await fetch('/api/settings/email-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customDraft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Create failed');
      toast.success('Template created');
      setCustomDraft({ name: '', subject: '', body_html: '' });
      setShowLibraryCreate(false);
      if (data.template?.id) {
        setExpandedLibraryTemplates((prev) => ({ ...prev, [data.template.id]: true }));
      }
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to create template');
    }
  };

  const duplicateTemplate = async (id) => {
    try {
      const res = await fetch('/api/settings/email-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyFromId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Duplicate failed');
      toast.success('Template duplicated');
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to duplicate');
    }
  };

  const archiveTemplate = async (id) => {
    if (!window.confirm('Archive this custom template?')) return;
    try {
      const res = await fetch(`/api/settings/email-templates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Archive failed');
      toast.success('Template archived');
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to archive');
    }
  };

  const saveCustomTemplate = async (id) => {
    const tpl = libraryTemplates.find((t) => t.id === id);
    if (!tpl) return;
    try {
      const res = await fetch(`/api/settings/email-templates/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tpl.name,
          subject: tpl.subject,
          body_html: tpl.body_html,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      toast.success('Template saved');
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to save template');
    }
  };

  const saveOverride = async () => {
    const { template_id, scope_type, scope_id } = overrideDraft;
    if (!template_id || !scope_id.trim()) {
      toast.error('Template and scope ID are required');
      return;
    }
    try {
      const res = await fetch('/api/settings/email-template-overrides', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideDraft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      toast.success('Override saved');
      setOverrideDraft((p) => ({ ...p, subject: '', body_html: '' }));
    } catch (e) {
      toast.error(e.message || 'Failed to save override');
    }
  };

  const updateLibraryTemplateField = (id, field, value) => {
    setLibraryTemplates((rows) =>
      rows.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const updateTriggerBinding = (triggerId, patch) => {
    setTriggerBindings((rows) =>
      rows.map((b) => (b.trigger_id === triggerId ? { ...b, ...patch } : b))
    );
  };

  const createCustomEvent = async () => {
    if (!eventDraft.label.trim()) {
      toast.error('Event name is required');
      return;
    }
    setCreatingEvent(true);
    try {
      const res = await fetch('/api/settings/email-triggers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: eventDraft.label.trim(),
          description: eventDraft.description.trim() || undefined,
          template_id: eventDraft.template_id || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Create failed');
      toast.success(`Event created: ${data.trigger?.trigger_id || previewTriggerId(eventDraft.label)}`);
      setEventDraft({ label: '', description: '', template_id: '' });
      setShowAddEvent(false);
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to create event');
    } finally {
      setCreatingEvent(false);
    }
  };

  const deleteCustomEvent = async (triggerId) => {
    if (!window.confirm(`Delete custom event "${triggerId}"? This removes its template mapping.`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/settings/email-triggers?triggerId=${encodeURIComponent(triggerId)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      toast.success('Event deleted');
      await loadRegistry();
    } catch (e) {
      toast.error(e.message || 'Failed to delete event');
    }
  };

  const { user: currentUser } = useCurrentUser();

  useEffect(() => {
    const addr = (currentUser?.email || '').trim();
    if (addr) setTestTo((prev) => prev || addr);
  }, [currentUser?.email]);

  const update = (field, value) => {
    setPrefs((p) => ({ ...p, [field]: value }));
  };

  const setTemplateField = (templateKey, field, value) => {
    setPrefs((p) => ({
      ...p,
      emailTemplates: {
        ...p.emailTemplates,
        [templateKey]: { ...p.emailTemplates[templateKey], [field]: value },
      },
    }));
  };

  const insertPlaceholder = (templateKey, token) => {
    const refKey = `${templateKey}-body`;
    const api = bodyEditorRefs.current[refKey];
    const body = prefs.emailTemplates[templateKey]?.body ?? '';
    if (api && typeof api.insertAtCursor === 'function' && api.insertAtCursor(token)) {
      requestAnimationFrame(() => api.focus?.());
      return;
    }
    setTemplateField(templateKey, 'body', `${body}${token}`);
  };

  const restoreTemplateDefaults = (templateKey) => {
    const d = DEFAULT_EMAIL_TEMPLATES[templateKey];
    if (!d) return;
    setPrefs((p) => ({
      ...p,
      emailTemplates: {
        ...p.emailTemplates,
        [templateKey]: {
          subject: d.subject,
          body: migratePlainTemplateBodyToHtml(d.body),
        },
      },
    }));
    toast.success('Template reset to default wording');
  };

  const handleSave = async () => {
    if (prefs.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefs.fromEmail.trim())) {
      toast.error('Please enter a valid From email address');
      return;
    }

    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase client not available');

      const { data: existing } = await supabase
        .from('settings')
        .select('value')
        .eq('id', SETTINGS_ID)
        .single();

      const prev = existing?.value || {};
      const normalizedTemplates = normalizeEmailTemplates(prefs.emailTemplates);
      const sanitizedEmailTemplates = {};
      for (const key of EMAIL_TEMPLATE_KEYS) {
        sanitizedEmailTemplates[key] = {
          subject: String(normalizedTemplates[key].subject || '').trim(),
          body: sanitizeEmailTemplateHtml(normalizedTemplates[key].body),
        };
      }

      const merged = {
        ...defaultPrefs,
        ...prev,
        ...prefs,
        emailTemplates: sanitizedEmailTemplates,
        smtpPassword:
          prefs.smtpPassword.trim() !== ''
            ? prefs.smtpPassword
            : prev.smtpPassword || '',
      };

      const { error } = await supabase
        .from('settings')
        .upsert(
          {
            id: SETTINGS_ID,
            value: merged,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );

      if (error) throw error;

      setSmtpPasswordStored(!!(merged.smtpPassword && String(merged.smtpPassword).length > 0));
      setPrefs((p) => ({ ...p, smtpPassword: '', emailTemplates: merged.emailTemplates }));
      toast.success('Email settings saved');
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const sendTestMail = async (mode) => {
    const previewTemplate =
      mode === 'smtp' ? undefined : mode === 'jobAssigned' || mode === 'jobCompleted' || mode === 'followUpReminder'
        ? mode
        : undefined;
    setMailSending(mode);
    const loadingToast = toast.loading(
      previewTemplate ? 'Sending sample with placeholders…' : 'Sending test email…'
    );
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testTo.trim() || undefined,
          ...(previewTemplate ? { previewTemplate } : {}),
          ...(previewTemplate && sampleTechnicianId
            ? { sampleTechnicianId: sampleTechnicianId.trim() }
            : {}),
          draft: {
            smtpHost: prefs.smtpHost,
            smtpPort: prefs.smtpPort,
            smtpEncryption: prefs.smtpEncryption,
            smtpUser: prefs.smtpUser,
            smtpPassword: prefs.smtpPassword,
            fromName: prefs.fromName,
            fromEmail: prefs.fromEmail,
            emailTemplates: prefs.emailTemplates,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      toast.dismiss(loadingToast);
      if (!res.ok) {
        const errText = [data.message || `Test failed (${res.status})`, data.hint].filter(Boolean).join(' ');
        toast.error(errText, { duration: 12_000 });
        return;
      }
      toast.success(
        data.messageId
          ? `Sent (message id: ${data.messageId}) — check inbox and spam.`
          : 'Sent — check the inbox (and spam).'
      );
    } catch (e) {
      toast.dismiss(loadingToast);
      console.error(e);
      toast.error(e.message || 'Failed to send email');
    } finally {
      setMailSending(null);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm border-0">
        <Card.Body className="d-flex justify-content-center py-5">
          <Spinner animation="border" size="sm" className="me-2" />
          Loading email settings…
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className="d-flex flex-column gap-3 email-settings-panel">
      <Tab.Container
        id="email-settings-tabs"
        activeKey={activeSettingsTab}
        onSelect={(k) => {
          if (k != null) setActiveSettingsTab(k);
        }}
      >
        <Card className="border rounded-4 overflow-hidden shadow-sm">
          <Card.Header className="bg-white border-bottom py-3 px-3 px-sm-4">
            <div className="mb-2">
              <div className="fw-semibold fs-6">Outgoing mail</div>
              <small className="text-muted d-block lh-base">
                Configure SMTP and message templates. One save updates everything below.
                Note: Do not touch the settings if you are not sure what you are doing. Contact the Pixelcare Admin if you need help.
              </small>
            </div>
            <Nav variant="underline" className="flex-nowrap gap-3 border-0 small fw-semibold">
              {/* DO NOT REMOVE THIS NAVIGATION ITEMS, THEY ARE USED FOR FUTURE FEATURES
              <Nav.Item>
                <Nav.Link eventKey="smtp" className="px-2 py-2">
                  SMTP &amp; sender
                </Nav.Link>
              </Nav.Item> 
              */}
              <Nav.Item>
                <Nav.Link eventKey="templates" className="px-2 py-2">
                  Email templates
                </Nav.Link>
              </Nav.Item>
              <Nav.Item>
                <Nav.Link eventKey="library" className="px-2 py-2 d-inline-flex align-items-center gap-1">
                  Template library
                  <Badge bg="primary" className="fw-normal" style={{ fontSize: '0.65rem' }}>
                    New
                  </Badge>
                </Nav.Link>
              </Nav.Item>
             
              <Nav.Item>
                <Nav.Link eventKey="triggers" className="px-2 py-2 d-inline-flex align-items-center gap-1">
                  Automatic emails
                  <Badge bg="primary" className="fw-normal" style={{ fontSize: '0.65rem' }}>
                    New
                  </Badge>
                </Nav.Link>
              </Nav.Item>
               {/* DO NOT REMOVE THIS NAVIGATION ITEMS, THEY ARE USED FOR FUTURE FEATURES
              <Nav.Item>
                <Nav.Link eventKey="overrides" className="px-2 py-2">
                  Customer overrides
                </Nav.Link>
              </Nav.Item> */}
            </Nav>
          </Card.Header>
          <Card.Body className="px-3 px-sm-4 pt-3 pb-2">
            <div className={layoutStyles.emailSettingsContentWell}>
              <Tab.Content>
                <Tab.Pane eventKey="smtp" className="" mountOnEnter>
                <Alert variant="warning" className="py-2 small mb-4 rounded-3 border border-warning border-opacity-50">
                    <strong className="text-dark">NOTE:</strong> Do not touch this settings if you are not sure what you are doing. Contact the Pixelcare Admin if you need help.
                  </Alert>
                 
                  <SectionLabel isFirst>Server connection</SectionLabel>
                  <Row className="g-3 mb-2">
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label className="small">Host</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="text"
                        value={prefs.smtpHost}
                        onChange={(e) => update('smtpHost', e.target.value)}
                        placeholder="smtp.example.com"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label className="small">Port</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="text"
                        value={prefs.smtpPort}
                        onChange={(e) => update('smtpPort', e.target.value)}
                        placeholder="587"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={3}>
                    <Form.Group>
                      <Form.Label className="small">Encryption</Form.Label>
                      <Form.Select
                        className="rounded-3"
                        value={prefs.smtpEncryption}
                        onChange={(e) => update('smtpEncryption', e.target.value)}
                      >
                        <option value="tls">TLS (STARTTLS)</option>
                        <option value="ssl">SSL</option>
                        <option value="none">None</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label className="small">Username</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="text"
                        autoComplete="off"
                        value={prefs.smtpUser}
                        onChange={(e) => update('smtpUser', e.target.value)}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label className="small">Password</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="password"
                        autoComplete="new-password"
                        value={prefs.smtpPassword}
                        onChange={(e) => update('smtpPassword', e.target.value)}
                        placeholder={smtpPasswordStored ? '•••••••• (enter new to replace)' : ''}
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <SectionLabel>Sender identity</SectionLabel>
                <Row className="g-3 mb-2">
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label className="small">From name</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="text"
                        value={prefs.fromName}
                        onChange={(e) => update('fromName', e.target.value)}
                        placeholder="Company Service Team"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group>
                      <Form.Label className="small">From email</Form.Label>
                      <Form.Control
                        className="rounded-3"
                        type="email"
                        value={prefs.fromEmail}
                        onChange={(e) => update('fromEmail', e.target.value)}
                        placeholder="service@yourdomain.com"
                      />
                    </Form.Group>
                  </Col>
                </Row>

                <SectionLabel>Test delivery</SectionLabel>
                <Form.Label className="small">Send test to</Form.Label>
                <InputGroup className="rounded-3 overflow-hidden shadow-sm mb-2 flex-wrap flex-md-nowrap">
                  <Form.Control
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="you@company.com"
                  />
                  <Button
                    variant="primary"
                    className="px-4 flex-shrink-0"
                    onClick={() => sendTestMail('smtp')}
                    disabled={mailSending !== null || saving}
                  >
                    {mailSending === 'smtp' ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Sending
                      </>
                    ) : (
                      'Send test'
                    )}
                  </Button>
                </InputGroup>
                <Form.Text muted className="small d-block">
                  Uses the saved password if the password field is empty. You can test before saving.
                </Form.Text>
              </Tab.Pane>

              <Tab.Pane eventKey="templates" className="" mountOnEnter>
                <Alert variant="light" className="border rounded-3 py-2 small mb-3 mb-md-4">
                  Enable each trigger on the right, expand a row to edit copy, and use <strong>Send sample</strong>{' '}
                  with your test address. One <strong>Save email settings</strong> saves SMTP and these templates.
                </Alert>
                {/* <Alert variant="light" className="border rounded-3 py-2 small mb-3 mb-md-4">
                  Enable each trigger on the right, expand a row to edit copy, and use <strong>Send sample</strong> with the
                  address from <strong>SMTP &amp; sender</strong>.
                  <Button
                    type="button"
                    variant="link"
                    className="p-0 align-baseline ms-1 small"
                    onClick={() => setActiveSettingsTab('smtp')}
                  >
                    Open SMTP tab
                  </Button>
                  <span className="d-block mt-2 text-muted">
                    <strong className="text-body">Technician in sample:</strong>{' '}
                    <code className="small">{`{{technician_name}}`}</code> and follow-up{' '}
                    <code className="small">{`{{assignee_name}}`}</code> use your real directory when possible (logged-in
                    technician, or first active tech). Pick a person below to force a specific row.
                  </span>
                </Alert> */}
                {/* <Form.Group className="mb-3 mb-md-4">
                  <Form.Label className="small fw-semibold text-body">Sample email uses technician</Form.Label>
                  <Form.Select
                    className="rounded-3"
                    value={sampleTechnicianId}
                    onChange={(e) => setSampleTechnicianId(e.target.value)}
                  >
                    <option value="">
                      Auto — my technician profile, else first in list
                    </option>
                    {sampleTechnicians.map((t) => {
                      const name =
                        (t.full_name || '').trim() ||
                        (t.user?.username || '').trim() ||
                        'Technician';
                      const email = (t.email || '').trim();
                      return (
                        <option key={t.id} value={t.id}>
                          {email ? `${name} — ${email}` : name}
                        </option>
                      );
                    })}
                  </Form.Select>
                </Form.Group> */}
                <div className="d-flex flex-column gap-3">
                  {TEMPLATE_SECTIONS.map((sec) => {
                    const enabled = !!prefs[sec.toggleField];
                    const isOpen = !!expandedTemplates[sec.key];
                    return (
                      <Card
                        key={sec.key}
                        className={`border-0 shadow-sm rounded-4 overflow-hidden email-template-card${
                          enabled ? '' : ' opacity-75'
                        }`}
                        style={{
                          boxShadow: enabled
                            ? '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(13,110,253,.12)'
                            : '0 1px 2px rgba(0,0,0,.06), inset 3px 0 0 var(--bs-secondary-bg)',
                        }}
                      >
                        <Card.Header className="bg-light bg-opacity-50 border-0 py-0 px-0">
                          <div className="d-flex align-items-stretch">
                            <div
                              className="d-flex align-items-center flex-grow-1 min-w-0 px-3 py-3 gap-3 user-select-none"
                              style={{ cursor: 'pointer' }}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleTemplatePanel(sec.key)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleTemplatePanel(sec.key);
                                }
                              }}
                            >
                              <ChevronDown
                                className="flex-shrink-0 text-secondary"
                                size={18}
                                style={{
                                  transform: isOpen ? 'rotate(180deg)' : 'none',
                                  transition: 'transform 0.2s ease',
                                }}
                              />
                              <div className="min-w-0 text-start">
                                <div className="fw-semibold small text-body">{sec.title}</div>
                                <div className="text-muted small lh-sm">{sec.blurb}</div>
                              </div>
                            </div>
                            <div
                              className="d-flex align-items-center px-3 py-2 border-start bg-body-secondary bg-opacity-25"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Form.Check
                                type="switch"
                                id={`mail-toggle-${sec.key}`}
                                className="m-0"
                                aria-label={`Enable emails: ${sec.title}`}
                                label={<span className="small fw-medium text-nowrap d-none d-sm-inline">On</span>}
                                checked={enabled}
                                onChange={(e) => update(sec.toggleField, e.target.checked)}
                              />
                            </div>
                          </div>
                        </Card.Header>
                        <Collapse in={isOpen}>
                          <div>
                            <Card.Body className="pt-4 pb-4 border-top bg-body-tertiary bg-opacity-25">
                              {!enabled && (
                                <Alert variant="secondary" className="py-2 small mb-3 rounded-3 border-0">
                                  This template is saved but won&apos;t send while the trigger is off.
                                </Alert>
                              )}
                              <Row className="g-3">
                                <Col xs={12}>
                                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                                    <Form.Label className="mb-0 small fw-semibold text-body">
                                      Subject
                                    </Form.Label>
                                    <Button
                                      type="button"
                                      variant="link"
                                      className="p-0 small text-decoration-none"
                                      onClick={() => restoreTemplateDefaults(sec.key)}
                                    >
                                      Reset to default
                                    </Button>
                                  </div>
                                  <Form.Control
                                    value={prefs.emailTemplates[sec.key]?.subject ?? ''}
                                    onChange={(e) => setTemplateField(sec.key, 'subject', e.target.value)}
                                    placeholder="Subject"
                                    className="rounded-3"
                                  />
                                </Col>
                                <Col xs={12}>
                            <Form.Label className="small fw-semibold text-body">Message body</Form.Label>
                                  <EmailTemplateBodyEditor
                                    ref={(el) => {
                                      bodyEditorRefs.current[`${sec.key}-body`] = el;
                                    }}
                                    className={layoutStyles.emailSettingsQuill}
                                    value={prefs.emailTemplates[sec.key]?.body ?? ''}
                                    onChange={(html) => setTemplateField(sec.key, 'body', html)}
                                  />
                                  <Form.Text muted className="small">
                                    Rich text (bold, lists, links, images). Merge tags like{' '}
                                    <code>{'{{job_number}}'}</code> work in the HTML source. Images should use a public
                                    https URL so inbox clients can load them.
                                  </Form.Text>
                                </Col>
                                <Col xs={12}>
                                  <div className="small fw-semibold text-body mb-2">Merge tags</div>
                                  <div className="d-flex flex-wrap gap-2">
                                    {sec.placeholders.map(([token, label]) => (
                                      <Button
                                        key={token}
                                        type="button"
                                        variant="light"
                                        size="sm"
                                        className="rounded-pill border py-1 px-2 shadow-sm"
                                        onClick={() => insertPlaceholder(sec.key, token)}
                                      >
                                        <span className="font-monospace small text-primary me-1">{token}</span>
                                        <Badge bg="light" text="dark" className="fw-normal border">
                                          {label}
                                        </Badge>
                                      </Button>
                                    ))}
                                  </div>
                                </Col>
                                <Col xs={12} className="d-flex flex-wrap align-items-center gap-2 pt-1">
                                  <Button
                                    type="button"
                                    variant="outline-primary"
                                    size="sm"
                                    className="rounded-pill px-4"
                                    disabled={mailSending !== null || saving}
                                    onClick={() => sendTestMail(sec.key)}
                                  >
                                    {mailSending === sec.key ? (
                                      <>
                                        <Spinner animation="border" size="sm" className="me-2" />
                                        Sending…
                                      </>
                                    ) : (
                                      sec.sampleLabel
                                    )}
                                  </Button>
                                  <small className="text-muted">
                                    Uses <strong>Send test to</strong> on the SMTP tab.
                                  </small>
                                </Col>
                              </Row>
                            </Card.Body>
                          </div>
                        </Collapse>
                      </Card>
                    );
                  })}
                </div>
              </Tab.Pane>

              <Tab.Pane eventKey="library" mountOnEnter>
                {libraryLoading ? (
                  <div className="text-center py-4">
                    <Spinner animation="border" size="sm" />
                  </div>
                ) : (
                  <>
                    <CollapsibleHowToAlert
                      id="library"
                      expanded={howToExpanded.library}
                      onToggle={() =>
                        setHowToExpanded((prev) => ({ ...prev, library: !prev.library }))
                      }
                    >
                      <ol className="mb-0 ps-3 mt-2">
                        <li>
                          Click <strong>+ Add template</strong> to create reusable messages for job pages.
                        </li>
                        <li>
                          Turn a template <strong>On</strong> so staff can pick it when sending email from a
                          job.
                        </li>
                        <li>
                          Expand a row to edit the subject, message body, and merge tags (for example{' '}
                          <code>{'{{job_number}}'}</code>).
                        </li>
                        <li>
                          Click <strong>Save template</strong> on each row, or use{' '}
                          <strong>Save email settings</strong> at the bottom to save everything together.
                        </li>
                      </ol>
                    </CollapsibleHowToAlert>
                    <Alert variant="warning" className="border rounded-3 py-2 small mb-3 mb-md-4">
                      <strong>Note:</strong> These features are in early experimental development and may not work as expected. Please report any issues you encounter. Bugs and missing features are to be expected while we continue working on improvements.
                    </Alert>
                    <div className="mb-3">
                      <Button
                        type="button"
                        variant="outline-primary"
                        size="sm"
                        className="rounded-pill px-3"
                        onClick={() => setShowLibraryCreate((v) => !v)}
                      >
                        {showLibraryCreate ? 'Cancel' : '+ Add template'}
                      </Button>
                    </div>
                    <Collapse in={showLibraryCreate}>
                      <Card className="border rounded-4 mb-3 shadow-sm">
                        <Card.Body>
                          <Row className="g-2">
                            <Col md={4}>
                              <Form.Control
                                className="rounded-3"
                                placeholder="Template name"
                                value={customDraft.name}
                                onChange={(e) => setCustomDraft((p) => ({ ...p, name: e.target.value }))}
                              />
                            </Col>
                            <Col md={8}>
                              <Form.Control
                                className="rounded-3"
                                placeholder="Subject"
                                value={customDraft.subject}
                                onChange={(e) => setCustomDraft((p) => ({ ...p, subject: e.target.value }))}
                              />
                            </Col>
                            <Col xs={12}>
                              <EmailTemplateBodyEditor
                                className={layoutStyles.emailSettingsQuill}
                                value={customDraft.body_html || '<p><br></p>'}
                                onChange={(html) => setCustomDraft((p) => ({ ...p, body_html: html }))}
                              />
                            </Col>
                            <Col xs={12}>
                              <Button
                                size="sm"
                                variant="primary"
                                className="rounded-pill px-4"
                                onClick={createCustomTemplate}
                              >
                                Create template
                              </Button>
                            </Col>
                          </Row>
                        </Card.Body>
                      </Card>
                    </Collapse>
                    {customLibraryTemplates.length === 0 ? (
                      <Alert variant="light" className="border rounded-3 py-2 small mb-0">
                        No custom templates yet. Click <strong>Add template</strong> above.
                      </Alert>
                    ) : (
                      <div className="d-flex flex-column gap-3">
                        {customLibraryTemplates.map((tpl) => {
                          const enabled = tpl.is_active !== false;
                          const isOpen = !!expandedLibraryTemplates[tpl.id];
                          return (
                            <Card
                              key={tpl.id}
                              className={`border-0 shadow-sm rounded-4 overflow-hidden email-template-card${
                                enabled ? '' : ' opacity-75'
                              }`}
                              style={{
                                boxShadow: enabled
                                  ? '0 1px 2px rgba(0,0,0,.06), 0 0 0 1px rgba(13,110,253,.12)'
                                  : '0 1px 2px rgba(0,0,0,.06), inset 3px 0 0 var(--bs-secondary-bg)',
                              }}
                            >
                              <Card.Header className="bg-light bg-opacity-50 border-0 py-0 px-0">
                                <div className="d-flex align-items-stretch">
                                  <div
                                    className="d-flex align-items-center flex-grow-1 min-w-0 px-3 py-3 gap-3 user-select-none"
                                    style={{ cursor: 'pointer' }}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleLibraryTemplatePanel(tpl.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggleLibraryTemplatePanel(tpl.id);
                                      }
                                    }}
                                  >
                                    <ChevronDown
                                      className="flex-shrink-0 text-secondary"
                                      size={18}
                                      style={{
                                        transform: isOpen ? 'rotate(180deg)' : 'none',
                                        transition: 'transform 0.2s ease',
                                      }}
                                    />
                                    <div className="min-w-0 text-start">
                                      <div className="fw-semibold small text-body">{tpl.name}</div>
                                      <div className="text-muted small lh-sm text-truncate">
                                        {tpl.subject || 'Manual send template'}
                                      </div>
                                    </div>
                                  </div>
                                  <div
                                    className="d-flex align-items-center px-3 py-2 border-start bg-body-secondary bg-opacity-25"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                  >
                                    <Form.Check
                                      type="switch"
                                      id={`lib-toggle-${tpl.id}`}
                                      className="m-0"
                                      aria-label={`Enable template: ${tpl.name}`}
                                      label={
                                        <span className="small fw-medium text-nowrap d-none d-sm-inline">
                                          On
                                        </span>
                                      }
                                      checked={enabled}
                                      onChange={(e) => toggleLibraryTemplateActive(tpl.id, e.target.checked)}
                                    />
                                  </div>
                                </div>
                              </Card.Header>
                              <Collapse in={isOpen}>
                                <div>
                                  <Card.Body className="pt-4 pb-4 border-top bg-body-tertiary bg-opacity-25">
                                    {!enabled && (
                                      <Alert variant="secondary" className="py-2 small mb-3 rounded-3 border-0">
                                        This template is saved but won&apos;t be available for sends while
                                        off.
                                      </Alert>
                                    )}
                                    <Row className="g-3">
                                      <Col xs={12}>
                                        <Form.Label className="small fw-semibold text-body">Name</Form.Label>
                                        <Form.Control
                                          className="rounded-3"
                                          value={tpl.name}
                                          onChange={(e) =>
                                            updateLibraryTemplateField(tpl.id, 'name', e.target.value)
                                          }
                                        />
                                      </Col>
                                      <Col xs={12}>
                                        <Form.Label className="small fw-semibold text-body">Subject</Form.Label>
                                        <Form.Control
                                          className="rounded-3"
                                          value={tpl.subject ?? ''}
                                          onChange={(e) =>
                                            updateLibraryTemplateField(tpl.id, 'subject', e.target.value)
                                          }
                                          placeholder="Subject"
                                        />
                                      </Col>
                                      <Col xs={12}>
                                        <Form.Label className="small fw-semibold text-body">
                                          Message body
                                        </Form.Label>
                                        <EmailTemplateBodyEditor
                                          ref={(el) => {
                                            bodyEditorRefs.current[`lib-${tpl.id}-body`] = el;
                                          }}
                                          className={layoutStyles.emailSettingsQuill}
                                          value={tpl.body_html || ''}
                                          onChange={(html) =>
                                            updateLibraryTemplateField(tpl.id, 'body_html', html)
                                          }
                                        />
                                        <Form.Text muted className="small">
                                          Rich text and merge tags like{' '}
                                          <code>{'{{job_number}}'}</code> are supported.
                                        </Form.Text>
                                      </Col>
                                      <Col xs={12}>
                                        <div className="small fw-semibold text-body mb-2">Merge tags</div>
                                        <div className="d-flex flex-wrap gap-2">
                                          {customTemplatePlaceholders.map(([token, label]) => (
                                            <Button
                                              key={token}
                                              type="button"
                                              variant="light"
                                              size="sm"
                                              className="rounded-pill border py-1 px-2 shadow-sm"
                                              onClick={() => insertLibraryPlaceholder(tpl.id, token)}
                                            >
                                              <span className="font-monospace small text-primary me-1">
                                                {token}
                                              </span>
                                              <Badge bg="light" text="dark" className="fw-normal border">
                                                {label}
                                              </Badge>
                                            </Button>
                                          ))}
                                        </div>
                                      </Col>
                                      <Col xs={12} className="d-flex flex-wrap gap-2 pt-1">
                                        <Button
                                          type="button"
                                          variant="primary"
                                          size="sm"
                                          className="rounded-pill px-4"
                                          onClick={() => saveCustomTemplate(tpl.id)}
                                        >
                                          Save template
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline-secondary"
                                          size="sm"
                                          className="rounded-pill"
                                          onClick={() => duplicateTemplate(tpl.id)}
                                        >
                                          Duplicate
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline-danger"
                                          size="sm"
                                          className="rounded-pill"
                                          onClick={() => archiveTemplate(tpl.id)}
                                        >
                                          Archive
                                        </Button>
                                      </Col>
                                    </Row>
                                  </Card.Body>
                                </div>
                              </Collapse>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </Tab.Pane>

              <Tab.Pane eventKey="triggers" mountOnEnter>
                {libraryLoading ? (
                  <div className="text-center py-4">
                    <Spinner animation="border" size="sm" />
                  </div>
                ) : (
                  <>
                    <CollapsibleHowToAlert
                      id="triggers"
                      expanded={howToExpanded.triggers}
                      onToggle={() =>
                        setHowToExpanded((prev) => ({ ...prev, triggers: !prev.triggers }))
                      }
                    >
                      <ol className="mb-0 ps-3 mt-2">
                        <li>
                          Each row is something that happens in your workflow (for example, a job is assigned
                          or completed).
                        </li>
                        <li>
                          Choose which email template to send from the <strong>Template</strong> dropdown.
                        </li>
                        <li>
                          Use the <strong>Enabled</strong> switch to turn automatic sending on or off for
                          that event.
                        </li>
                        <li>
                          Click <strong>+ Add event</strong> for custom event to link your template for automation and trigger email sending. e.g. Quotation sent, Job Invoiced, Cancelled, etc.
                        
                        </li>
                        <li>
                          Click <strong>Save automatic emails</strong> when you are done. If no template is
                          chosen here, the legacy toggles on <strong>Email templates</strong> still apply.
                        </li>
                      </ol>
                    </CollapsibleHowToAlert>
                    <Alert variant="warning" className="border rounded-3 py-2 small mb-3 mb-md-4">
                      <strong>Note:</strong> These features are in early experimental development and may not work as expected. Please report any issues you encounter. Bugs and missing features are to be expected while we continue working on improvements.
                    </Alert>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <span className="small text-muted">Choose which email goes out when something happens</span>
                      <Button
                        type="button"
                        variant="outline-primary"
                        size="sm"
                        className="rounded-pill"
                        onClick={() => setShowAddEvent((v) => !v)}
                      >
                        {showAddEvent ? 'Cancel' : '+ Add event'}
                      </Button>
                    </div>
                    {showAddEvent ? (
                      <Card className="border rounded-3 mb-3">
                        <Card.Body className="py-3">
                          <Row className="g-2">
                            <Col md={4}>
                              <Form.Label className="small">Event name</Form.Label>
                              <Form.Control
                                size="sm"
                                className="rounded-3"
                                placeholder="e.g. Quotation"
                                value={eventDraft.label}
                                onChange={(e) =>
                                  setEventDraft((p) => ({ ...p, label: e.target.value }))
                                }
                              />
                              {eventDraft.label.trim() ? (
                                <Form.Text className="text-muted">
                                  ID: <code>{previewTriggerId(eventDraft.label)}</code>
                                </Form.Text>
                              ) : null}
                            </Col>
                            <Col md={4}>
                              <Form.Label className="small">Description (optional)</Form.Label>
                              <Form.Control
                                size="sm"
                                className="rounded-3"
                                value={eventDraft.description}
                                onChange={(e) =>
                                  setEventDraft((p) => ({ ...p, description: e.target.value }))
                                }
                              />
                            </Col>
                            <Col md={4}>
                              <Form.Label className="small">Template (optional)</Form.Label>
                              <Form.Select
                                size="sm"
                                className="rounded-3"
                                value={eventDraft.template_id}
                                onChange={(e) =>
                                  setEventDraft((p) => ({ ...p, template_id: e.target.value }))
                                }
                              >
                                <option value="">— Select —</option>
                                {libraryTemplates
                                  .filter((t) => !t.deleted_at && t.is_active !== false)
                                  .map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({t.slug})
                                    </option>
                                  ))}
                              </Form.Select>
                            </Col>
                            <Col xs={12}>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                className="rounded-pill px-4"
                                disabled={creatingEvent}
                                onClick={createCustomEvent}
                              >
                                {creatingEvent ? 'Creating…' : 'Create event'}
                              </Button>
                            </Col>
                          </Row>
                        </Card.Body>
                      </Card>
                    ) : null}
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th>Event</th>
                            <th>Template</th>
                            <th className="text-center">Enabled</th>
                            <th className="text-end">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {triggerBindings.map((row) => (
                            <tr key={row.trigger_id}>
                              <td className="small">
                                <div className="fw-medium">{row.label || row.trigger_id}</div>
                                <code className="text-muted" style={{ fontSize: '0.75rem' }}>
                                  {row.trigger_id}
                                </code>
                              </td>
                              <td>
                                <Form.Select
                                  size="sm"
                                  className="rounded-3"
                                  value={row.template_id || ''}
                                  onChange={(e) =>
                                    updateTriggerBinding(row.trigger_id, {
                                      template_id: e.target.value || null,
                                    })
                                  }
                                >
                                  <option value="">— Select —</option>
                                  {libraryTemplates
                                    .filter((t) => !t.deleted_at && t.is_active !== false)
                                    .map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name} ({t.slug})
                                      </option>
                                    ))}
                                </Form.Select>
                              </td>
                              <td className="text-center">
                                <Form.Check
                                  type="switch"
                                  checked={row.enabled !== false}
                                  onChange={(e) =>
                                    updateTriggerBinding(row.trigger_id, { enabled: e.target.checked })
                                  }
                                  aria-label={`Enable ${row.trigger_id}`}
                                />
                              </td>
                              <td className="text-end">
                                {row.is_system === false ? (
                                  <Button
                                    type="button"
                                    variant="outline-danger"
                                    size="sm"
                                    className="rounded-pill"
                                    onClick={() => deleteCustomEvent(row.trigger_id)}
                                  >
                                    Delete
                                  </Button>
                                ) : (
                                  <span className="text-muted small">System</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="rounded-pill px-4"
                      disabled={savingTriggers}
                      onClick={saveTriggerBindings}
                    >
                      {savingTriggers ? 'Saving…' : 'Save automatic emails'}
                    </Button>
                  </>
                )}
              </Tab.Pane>

              <Tab.Pane eventKey="overrides" mountOnEnter>
                <Alert variant="light" className="border rounded-3 py-2 small mb-3">
                  Override template copy per customer or site. Resolution: site → customer → global
                  binding. Leave subject/body blank to inherit the base template field.
                </Alert>
                <Row className="g-2">
                  <Col md={6}>
                    <Form.Label className="small">Template</Form.Label>
                    <Form.Select
                      className="rounded-3"
                      value={overrideDraft.template_id}
                      onChange={(e) =>
                        setOverrideDraft((p) => ({ ...p, template_id: e.target.value }))
                      }
                    >
                      <option value="">Select template</option>
                      {libraryTemplates
                        .filter((t) => !t.deleted_at)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </Form.Select>
                  </Col>
                  <Col md={3}>
                    <Form.Label className="small">Scope</Form.Label>
                    <Form.Select
                      className="rounded-3"
                      value={overrideDraft.scope_type}
                      onChange={(e) =>
                        setOverrideDraft((p) => ({ ...p, scope_type: e.target.value }))
                      }
                    >
                      <option value="customer">Customer</option>
                      <option value="customer_location">Site</option>
                    </Form.Select>
                  </Col>
                  <Col md={3}>
                    <Form.Label className="small">Scope ID (UUID)</Form.Label>
                    <Form.Control
                      className="rounded-3"
                      placeholder="customer or site id"
                      value={overrideDraft.scope_id}
                      onChange={(e) =>
                        setOverrideDraft((p) => ({ ...p, scope_id: e.target.value }))
                      }
                    />
                  </Col>
                  <Col xs={12}>
                    <Form.Label className="small">Subject override (optional)</Form.Label>
                    <Form.Control
                      className="rounded-3"
                      value={overrideDraft.subject}
                      onChange={(e) =>
                        setOverrideDraft((p) => ({ ...p, subject: e.target.value }))
                      }
                    />
                  </Col>
                  <Col xs={12}>
                    <Form.Label className="small">Body override (optional)</Form.Label>
                    <EmailTemplateBodyEditor
                      className={layoutStyles.emailSettingsQuill}
                      value={overrideDraft.body_html || '<p><br></p>'}
                      onChange={(html) => setOverrideDraft((p) => ({ ...p, body_html: html }))}
                    />
                  </Col>
                  <Col xs={12}>
                    <Button size="sm" variant="primary" className="rounded-pill px-4" onClick={saveOverride}>
                      Save override
                    </Button>
                  </Col>
                </Row>
              </Tab.Pane>
            </Tab.Content>
            </div>
          </Card.Body>
          <Card.Footer className="bg-body-tertiary bg-opacity-25 border-top py-3 px-3 px-sm-4">
            <div className={`${layoutStyles.emailSettingsContentWell} d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-between gap-3`}>
              <small className="text-muted mb-0">
                Saves SMTP credentials, sender identity, toggles, and all templates together.
              </small>
              <Button variant="primary" className="px-4 align-self-stretch align-self-sm-auto" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Saving…
                  </>
                ) : (
                  'Save email settings'
                )}
              </Button>
            </div>
          </Card.Footer>
        </Card>
      </Tab.Container>

    </div>
  );
};

export default EmailSettingsPanel;
