import { requireSession } from '../../../lib/auth/requireSession';
import { blockIfProduction } from '../../../lib/api/blockInProduction';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import nodemailer from 'nodemailer';
import {
  getSampleVarsForTemplateKind,
  renderEmailTemplate,
  renderEmailTemplateContent,
} from '../../../lib/email/emailTemplatesShared';
import {
  buildMergeVarsFromBundle,
  fetchJobBundleForEmail,
} from '../../../lib/email/jobEmailContext';
import {
  ensureEmailTemplateRegistrySeeded,
  resolveTemplateBySlugOrLegacy,
} from '../../../lib/email/templateRegistry';

const SETTINGS_ID = 'emailSettings';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {readonly string[]} */
const PREVIEW_TEMPLATE_KEYS = ['jobAssigned', 'jobCompleted', 'followUpReminder'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Display name for sample templates from a technicians row (+ optional user join).
 * @param {Record<string, unknown>} row
 * @param {string} [sessionUsername]
 */
function technicianRowToSampleName(row, sessionUsername = '') {
  const u = row?.user && typeof row.user === 'object' ? row.user : null;
  const usernameFromJoin = u && typeof u.username === 'string' ? u.username.trim() : '';
  const full = typeof row?.full_name === 'string' ? row.full_name.trim() : '';
  const email = typeof row?.email === 'string' ? row.email.trim() : '';
  const uSession = typeof sessionUsername === 'string' ? sessionUsername.trim() : '';
  return full || usernameFromJoin || uSession || email || '';
}

/**
 * Resolve technician display name for preview emails: explicit id, then session user's technician, then first active tech.
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {{ explicitId?: string, sessionUser: Record<string, unknown> }} opts
 * @returns {Promise<string | null>}
 */
async function resolveSampleTechnicianName(admin, { explicitId, sessionUser }) {
  const selectRow = 'full_name, email, user:users!technicians_user_id_fkey(username)';

  if (isNonEmptyString(explicitId)) {
    const { data, error } = await admin
      .from('technicians')
      .select(selectRow)
      .eq('id', String(explicitId).trim())
      .is('deleted_at', null)
      .maybeSingle();
    if (!error && data) {
      const name = technicianRowToSampleName(data, '');
      if (name) return name;
    }
  }

  const rawTechs = sessionUser?.technicians;
  const techArr = Array.isArray(rawTechs) ? rawTechs : rawTechs && typeof rawTechs === 'object' ? [rawTechs] : [];
  const sessionTech =
    techArr.find((t) => t && typeof t === 'object' && !t.deleted_at) || techArr[0] || null;
  if (sessionTech && typeof sessionTech === 'object') {
    const su =
      sessionUser && typeof sessionUser.username === 'string' ? sessionUser.username : '';
    const name = technicianRowToSampleName(
      { ...sessionTech, user: sessionTech.user || null },
      su
    );
    if (name) return name;
    const full = typeof sessionTech.full_name === 'string' ? sessionTech.full_name.trim() : '';
    const em = typeof sessionTech.email === 'string' ? sessionTech.email.trim() : '';
    const fallback = full || su || em;
    if (fallback) return fallback;
  }

  const { data: first, error: firstErr } = await admin
    .from('technicians')
    .select(selectRow)
    .is('deleted_at', null)
    .order('full_name', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!firstErr && first) {
    const name = technicianRowToSampleName(first, '');
    if (name) return name;
  }

  return null;
}

function requestAppOrigin(req) {
  const xfProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfProto) ? xfProto[0] : xfProto || 'http';
  const xfHost = req.headers['x-forwarded-host'];
  const host = Array.isArray(xfHost) ? xfHost[0] : xfHost || req.headers.host;
  if (!host || typeof host !== 'string') return '';
  return `${proto}://${host}`;
}

/**
 * POST: send one test message using SMTP from settings (service role reads secrets).
 * Body: { to?, draft?, previewTemplate?, sampleTechnicianId? } — draft overrides form; previewTemplate sends a template sample; sampleTechnicianId (technicians.id) picks tech for {{technician_name}} / {{assignee_name}} (else session tech, else first active).
 */
export default async function handler(req, res) {
  if (blockIfProduction(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const { user: userData } = session;

  /** Set before send for richer error hints */
  let smtpContext = { host: '', smtpUser: '', fromEmail: '' };

  try {
    const { to: toRaw, draft, previewTemplate: previewRaw, sampleTechnicianId, jobId: jobIdRaw } = req.body || {};
    const previewTemplate =
      typeof previewRaw === 'string' && PREVIEW_TEMPLATE_KEYS.includes(previewRaw) ? previewRaw : null;

    let dbValue = {};
    /** @type {import('@supabase/supabase-js').SupabaseClient | null} */
    let admin = null;
    try {
      admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from('settings')
        .select('value')
        .eq('id', SETTINGS_ID)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[test-smtp] Supabase:', error);
        return res.status(500).json({ message: 'Could not load email settings from database' });
      }
      if (data?.value && typeof data.value === 'object') {
        dbValue = data.value;
      }
    } catch (e) {
      console.error('[test-smtp] getSupabaseAdmin:', e);
      return res.status(500).json({
        message: 'Server configuration error (check SUPABASE_SERVICE_ROLE_KEY)',
      });
    }

    const draftObj = draft && typeof draft === 'object' ? draft : {};
    const merged = { ...dbValue };
    for (const [key, val] of Object.entries(draftObj)) {
      if (key === 'smtpPassword') {
        if (isNonEmptyString(val)) merged.smtpPassword = String(val).trim();
        continue;
      }
      if (key === 'emailTemplates' && val && typeof val === 'object') {
        merged.emailTemplates = val;
        continue;
      }
      if (val !== undefined && val !== null && val !== '') {
        merged[key] = val;
      }
    }
    if (!isNonEmptyString(merged.smtpPassword) && isNonEmptyString(dbValue.smtpPassword)) {
      merged.smtpPassword = dbValue.smtpPassword;
    }

    const host = String(merged.smtpHost || '').trim();
    const fromEmail = String(merged.fromEmail || '').trim();
    const smtpUser = String(merged.smtpUser || '').trim();
    const pass =
      merged.smtpPassword != null && String(merged.smtpPassword).length > 0
        ? String(merged.smtpPassword)
        : '';

    if (!host) {
      return res.status(400).json({
        message: 'SMTP host is missing. Fill in the form and/or save email settings first.',
      });
    }
    if (!fromEmail || !EMAIL_RE.test(fromEmail)) {
      return res.status(400).json({ message: 'A valid From email is required in your SMTP settings.' });
    }
    if (!smtpUser) {
      return res.status(400).json({ message: 'SMTP username is required.' });
    }
    if (!pass) {
      return res.status(400).json({
        message:
          'SMTP password is missing. Enter the password in the form (and save), or paste it for this test only.',
      });
    }

    let to = typeof toRaw === 'string' ? toRaw.trim() : '';
    if (!to) {
      const candidate =
        (userData.email && String(userData.email)) ||
        (userData.username && String(userData.username)) ||
        '';
      if (EMAIL_RE.test(candidate.trim())) {
        to = candidate.trim();
      }
    }
    if (!to || !EMAIL_RE.test(to)) {
      return res.status(400).json({
        message:
          'Recipient address missing or invalid. Enter “Send test to”, or log in with an account whose email/username is a valid address.',
      });
    }

    const port = parseInt(String(merged.smtpPort || '587'), 10) || 587;
    const enc = String(merged.smtpEncryption || 'tls').toLowerCase();

    // Port 587 + STARTTLS: secure must be false (TLS upgrade after connect). requireTLS: true
    // can break some providers (including Gmail) behind certain TLS stacks.
    const transportOpts = {
      host,
      port,
      secure: enc === 'ssl',
      auth: { user: smtpUser, pass },
      connectionTimeout: 25_000,
      greetingTimeout: 25_000,
      tls: {
        minVersion: 'TLSv1.2',
      },
    };
    if (enc === 'tls') {
      transportOpts.secure = false;
    }
    if (enc === 'none') {
      transportOpts.secure = false;
    }

    const transporter = nodemailer.createTransport(transportOpts);
    const fromName = String(merged.fromName || '').trim();
    const fromHeader = fromName
      ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>`
      : fromEmail;

    smtpContext = { host, smtpUser, fromEmail };

    const fromLower = fromEmail.toLowerCase();
    const userLower = smtpUser.toLowerCase();
    const fromDiffersFromAuthUser = fromLower !== userLower;

    const companyName = fromName || 'SAS FSM';
    const appOrigin = requestAppOrigin(req);

    let subject;
    let text;
    let html;
    if (previewTemplate) {
      let vars = getSampleVarsForTemplateKind(previewTemplate, { companyName, appOrigin });
      const jobId = typeof jobIdRaw === 'string' ? jobIdRaw.trim() : '';
      if (jobId && admin) {
        try {
          await ensureEmailTemplateRegistrySeeded(admin);
          const bundle = await fetchJobBundleForEmail(admin, jobId);
          if (bundle) {
            vars = buildMergeVarsFromBundle({
              bundle,
              appOrigin,
              mergedSettings: merged,
              completedAt: previewTemplate === 'jobCompleted' ? new Date() : undefined,
            });
          }
        } catch (e) {
          console.warn('[test-smtp] jobId preview:', e?.message || e);
        }
      }
      try {
        const techName = await resolveSampleTechnicianName(admin || getSupabaseAdmin(), {
          explicitId: typeof sampleTechnicianId === 'string' ? sampleTechnicianId : '',
          sessionUser: userData,
        });
        if (techName) {
          vars = {
            ...vars,
            technician_name: techName,
            ...(previewTemplate === 'followUpReminder' ? { assignee_name: techName } : {}),
          };
        }
      } catch (e) {
        console.warn('[test-smtp] sample technician lookup:', e?.message || e);
      }

      let rendered;
      if (admin) {
        await ensureEmailTemplateRegistrySeeded(admin);
        const resolved = await resolveTemplateBySlugOrLegacy(admin, previewTemplate, merged);
        if (resolved) {
          rendered = renderEmailTemplateContent(
            { subject: resolved.subject, body: resolved.body },
            vars
          );
        }
      }
      if (!rendered) {
        rendered = renderEmailTemplate(previewTemplate, merged.emailTemplates, vars);
      }
      const label =
        previewTemplate === 'jobAssigned'
          ? 'Job assigned'
          : previewTemplate === 'jobCompleted'
            ? 'Job completed'
            : 'Follow-up reminder';
      subject = rendered.subject.trim() ? rendered.subject : `SAS FSM — ${label} (sample)`;
      text = rendered.text;
      html = rendered.html;
    } else {
      subject = 'SAS FSM — SMTP test';
      text = `This is a test message sent at ${new Date().toISOString()} from Dashboard → Settings → Email Settings.`;
      html = `<p>This is a <strong>test message</strong> sent at ${new Date().toISOString()} from <strong>Dashboard → Settings → Email Settings</strong>.</p>`;
    }

    /** @type {import('nodemailer').SendMailOptions} */
    const mailOptions = {
      from: fromHeader,
      to,
      subject,
      text,
      html,
      replyTo: fromHeader,
    };

    // When From ≠ SMTP login: RFC 5322 Sender is the mailbox that submitted the message; some clients show From + “on behalf of”.
    if (fromDiffersFromAuthUser) {
      mailOptions.sender = smtpUser;
    }

    const info = await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
    });
  } catch (err) {
    console.error('[test-smtp] send failed:', err);
    let msg = err && typeof err.message === 'string' ? err.message : 'Failed to send test email';
    const response = err?.response;
    if (typeof response === 'string' && response.trim() && !msg.includes(response.trim())) {
      msg = `${msg} — ${response.trim()}`;
    }

    /** @type {string | undefined} */
    let hint;

    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo/i.test(msg)) {
      hint =
        'The server could not reach the SMTP host. Check host/port and outbound firewall rules (587/465).';
    }
    if (/535|authentication|Invalid login|Username and Password not accepted|AUTH/i.test(msg)) {
      hint =
        'For Gmail / Google: create an App Password (Google Account → Security → 2-Step Verification → App passwords) and use that 16-character value as the SMTP password, not your normal password.';
    }
    if (/553|sender address|not authorized|Envelope|^504|mail send.*not enabled|send mail as/i.test(msg)) {
      hint =
        'The SMTP account is not allowed to send as this “From” address. In Gmail, add the address under Settings → See all settings → Accounts → “Send mail as”, or set From email to the same address as SMTP username.';
    }
    if (
      !hint &&
      /smtp\.gmail\.com/i.test(smtpContext.host || '') &&
      smtpContext.fromEmail &&
      smtpContext.smtpUser &&
      smtpContext.fromEmail.toLowerCase() !== smtpContext.smtpUser.toLowerCase()
    ) {
      hint = `Gmail is logged in as ${smtpContext.smtpUser} but From is ${smtpContext.fromEmail}. Add that address in Gmail "Send mail as", or set From email to match the Gmail login.`;
    }
    if (/certificate|SSL|TLS|wrong version/i.test(msg)) {
      hint =
        'Try Encryption “SSL” with port 465, or “TLS” with port 587. Corporate proxies sometimes block STARTTLS.';
    }

    return res.status(502).json({
      success: false,
      message: msg,
      hint,
    });
  }
}
