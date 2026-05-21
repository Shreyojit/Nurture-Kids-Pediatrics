import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authHeader } from '../lib/api';

type Props = {
  token: string | null;
};

type FieldConfig = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'checkbox';
};

type TemplateAnswerField = {
  field_id: string;
  field_name: string;
  field_type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'date' | 'signature' | string;
  acro_field_name: string;
  required: boolean;
  options?: string[];
  value: unknown;
  answered: boolean;
};

type TemplateAnswerSection = {
  section_key: string;
  fields: TemplateAnswerField[];
};

type TemplateBoundAnswerPayload = {
  template_id: string;
  template_key: string;
  template_version: number;
  answers_by_field_id: Record<string, { value: unknown; answered: boolean }>;
  sections: TemplateAnswerSection[];
};

type SubmissionResponsesPayload = {
  submission_id: string;
  status: string;
  updated_at: string;
  template_bound_answers: TemplateBoundAnswerPayload;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const rowTableConfigs: Record<string, FieldConfig[]> = {
  guardians: [
    { key: 'guardian_index', label: 'Guardian #', type: 'number' },
    { key: 'full_name', label: 'Full Name' },
    { key: 'relationship', label: 'Relationship' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'address', label: 'Address' },
    { key: 'employer', label: 'Employer' },
    { key: 'ssn_last4', label: 'SSN Last 4' },
  ],
  insurance_policies: [
    { key: 'policy_order', label: 'Policy #', type: 'number' },
    { key: 'company', label: 'Company' },
    { key: 'subscriber_name', label: 'Subscriber Name' },
    { key: 'subscriber_dob', label: 'Subscriber DOB', type: 'date' },
    { key: 'group_number', label: 'Group #' },
    { key: 'member_id', label: 'Member ID' },
  ],
  allergies: [
    { key: 'allergy_type', label: 'Type' },
    { key: 'allergy_name', label: 'Allergy' },
    { key: 'reaction', label: 'Reaction' },
  ],
  medications: [
    { key: 'medication_name', label: 'Medication' },
    { key: 'dose', label: 'Dose' },
    { key: 'frequency', label: 'Frequency' },
  ],
  family_history: [
    { key: 'condition_name', label: 'Condition' },
    { key: 'present', label: 'Present', type: 'checkbox' },
    { key: 'notes', label: 'Notes' },
  ],
};

const oneTableConfigs: Record<string, FieldConfig[]> = {
  pharmacies: [
    { key: 'name', label: 'Pharmacy Name' },
    { key: 'address', label: 'Address' },
    { key: 'zip', label: 'ZIP' },
  ],
  medical_history: [
    { key: 'gestational_age', label: 'Gestational Age' },
    { key: 'birth_weight', label: 'Birth Weight' },
    { key: 'birth_complications', label: 'Birth Complications' },
    { key: 'hospitalizations', label: 'Hospitalizations' },
    { key: 'surgeries', label: 'Surgeries' },
  ],
  concerns: [
    { key: 'visit_reason', label: 'Visit Reason' },
    { key: 'development_concerns', label: 'Development Concerns' },
  ],
  immunizations: [{ key: 'status', label: 'Immunization Status' }],
  social_history: [
    { key: 'household_adults', label: 'Adults in Household', type: 'number' },
    { key: 'household_children', label: 'Children in Household', type: 'number' },
    { key: 'smokers_in_home', label: 'Smokers in Home', type: 'checkbox' },
    { key: 'pets', label: 'Pets' },
    { key: 'daycare_school', label: 'Daycare/School' },
    { key: 'nutrition', label: 'Nutrition' },
  ],
  provider_preferences: [
    { key: 'physician_preference', label: 'Physician Preference' },
    { key: 'referral_source', label: 'Referral Source' },
    { key: 'referring_provider', label: 'Referring Provider' },
  ],
  consents_signatures: [
    { key: 'agreed', label: 'Agreed', type: 'checkbox' },
    { key: 'typed_name', label: 'Typed Name' },
    { key: 'signature_data', label: 'Signature Data' },
    { key: 'signed_at', label: 'Signed At', type: 'date' },
  ],
};

const defaultRows: Record<string, Record<string, any>> = {
  guardians: { guardian_index: 1, full_name: '', relationship: '', phone: '', email: '', address: '', employer: '', ssn_last4: '' },
  insurance_policies: { policy_order: 1, company: '', subscriber_name: '', subscriber_dob: '', group_number: '', member_id: '' },
  allergies: { allergy_type: '', allergy_name: '', reaction: '' },
  medications: { medication_name: '', dose: '', frequency: '' },
  family_history: { condition_name: '', present: false, notes: '' },
};

function normalizeTableRows(value: any, table: string): any[] {
  if (!Array.isArray(value)) return [];
  const fields = rowTableConfigs[table] ?? [];
  return value.map((row) => {
    const normalized: Record<string, any> = {};
    for (const field of fields) {
      const raw = row?.[field.key];
      if (field.type === 'checkbox') {
        normalized[field.key] = Boolean(raw === true || raw === 1 || raw === '1');
      } else {
        normalized[field.key] = raw ?? '';
      }
    }
    return normalized;
  });
}

function normalizeOneTable(value: any, table: string): Record<string, any> {
  const fields = oneTableConfigs[table] ?? [];
  const raw = value ?? {};
  const normalized: Record<string, any> = {};
  for (const field of fields) {
    const input = raw[field.key];
    if (field.type === 'checkbox') {
      normalized[field.key] = Boolean(input === true || input === 1 || input === '1');
    } else {
      normalized[field.key] = input ?? '';
    }
  }
  return normalized;
}

function parseDownloadFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return 'patientregistration.pdf';
  const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const raw = decodeURIComponent(match?.[1] || match?.[2] || 'patientregistration.pdf');
  return raw;
}

function coerceResponseInputValue(fieldType: string, value: unknown): unknown {
  if (fieldType === 'checkbox') {
    return Boolean(value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  return value;
}

type AssignmentRecord = {
  id: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
  template_name: string;
  template_key: string;
  assigned_by_email: string;
  submission_id: string | null;
};

type PublishedTemplate = {
  id: string;
  name: string;
  template_key: string;
};

type BundleResult = {
  bundle_id: string | null;
  bundle_token: string;
  patient_name: string;
  template_names: string[];
  fill_url: string;
  qr_code_data_url: string;
  expires_at: string;
};

export function StaffPatientDetailPage({ token }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [savingTable, setSavingTable] = useState('');
  const [exportedJson, setExportedJson] = useState<Record<string, unknown> | null>(null);

  const [rowData, setRowData] = useState<Record<string, any[]>>({});
  const [oneData, setOneData] = useState<Record<string, Record<string, any>>>({});
  const [submissionResponses, setSubmissionResponses] = useState<Record<string, SubmissionResponsesPayload>>({});
  const [responseDrafts, setResponseDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [loadingResponsesFor, setLoadingResponsesFor] = useState('');
  const [savingResponsesFor, setSavingResponsesFor] = useState('');

  // Form assignment state
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [assigning, setAssigning] = useState(false);
  const [createdBundle, setCreatedBundle] = useState<BundleResult | null>(null);
  const [smsPhone, setSmsPhone] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState('');
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [showQrId, setShowQrId] = useState<string | null>(null);
  const [portalLink, setPortalLink] = useState<{ portal_url: string; qr_code_data_url: string } | null>(null);
  const [portalLinkLoading, setPortalLinkLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function loadAssignments() {
    if (!token) return;
    try {
      const result = await api<AssignmentRecord[]>(`/api/staff/assignments/patient/${id}`, {
        headers: authHeader(token),
      });
      setAssignments(result);
    } catch {
      // non-fatal
    }
  }

  async function loadTemplates() {
    if (!token) return;
    try {
      const result = await api<any[]>('/api/staff/templates', { headers: authHeader(token) });
      setTemplates(
        result
          .filter((t: any) => t.status === 'published')
          .map((t: any) => ({ id: t.id, name: t.name, template_key: t.template_key })),
      );
    } catch {
      // non-fatal
    }
  }

  function toggleTemplate(templateId: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(templateId) ? prev.filter((t) => t !== templateId) : [...prev, templateId],
    );
  }

  async function handleAssign() {
    if (!token || selectedTemplateIds.length === 0) return;
    setAssigning(true);
    setSmsResult('');
    try {
      const days = expiresInDays >= 1 ? expiresInDays : 7;
      const result = await api<BundleResult>('/api/staff/assignments', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ patient_id: id, template_ids: selectedTemplateIds, expires_in_days: days }),
      });
      setCreatedBundle(result);
      setShowAssignForm(false);
      setShowQrId(null);
      setSelectedTemplateIds([]);
      await loadAssignments();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  }

  async function handleDeleteAssignment(assignmentId: string) {
    if (!token) return;
    if (!window.confirm('Delete this form assignment? This cannot be undone.')) return;
    try {
      await api(`/api/staff/assignments/${assignmentId}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      await loadAssignments();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleSendSms() {
    if (!token || !smsPhone || !createdBundle?.bundle_id) return;
    setSmsSending(true);
    setSmsResult('');
    try {
      await api(`/api/staff/assignments/bundle/${createdBundle.bundle_id}/send-sms`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ phone: smsPhone }),
      });
      setSmsResult('SMS sent.');
    } catch (e) {
      setSmsResult(`Failed: ${(e as Error).message}`);
    } finally {
      setSmsSending(false);
    }
  }

  async function loadPortalLink() {
    if (!token) return;
    setPortalLinkLoading(true);
    try {
      const result = await api<{ portal_url: string; qr_code_data_url: string }>(
        `/api/staff/patients/${id}/portal-link`,
        { headers: authHeader(token) },
      );
      setPortalLink(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPortalLinkLoading(false);
    }
  }

  async function handleRegeneratePortalToken() {
    if (!token) return;
    if (!window.confirm('This will invalidate the current portal link. The patient will need the new link to access their forms. Continue?')) return;
    setRegenerating(true);
    try {
      const result = await api<{ portal_url: string; qr_code_data_url: string }>(
        `/api/staff/patients/${id}/regenerate-portal-token`,
        { method: 'POST', headers: authHeader(token) },
      );
      setPortalLink(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  function copyLink(id: string, url: string) {
    const onSuccess = () => {
      setCopiedLinkId(id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(onSuccess).catch(() => {
        fallbackCopy(url, onSuccess);
      });
    } else {
      fallbackCopy(url, onSuccess);
    }
  }

  function fallbackCopy(url: string, onSuccess: () => void) {
    const el = document.createElement('textarea');
    el.value = url;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    if (ok) onSuccess();
  }

  async function load() {
    if (!token) return;
    try {
      const response = await api<any>(`/api/staff/patients/${id}`, {
        headers: authHeader(token),
      });
      setDetail(response);

      const rows: Record<string, any[]> = {};
      Object.keys(rowTableConfigs).forEach((table) => {
        rows[table] = normalizeTableRows(response[table], table);
      });
      setRowData(rows);

      const ones: Record<string, Record<string, any>> = {};
      Object.keys(oneTableConfigs).forEach((table) => {
        ones[table] = normalizeOneTable(response[table], table);
      });
      setOneData(ones);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }
    load();
    loadAssignments();
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  const core = detail?.patient ?? {};
  const submissions = detail?.submissions ?? [];

  const corePayload = useMemo(
    () => ({
      child_first_name: core.child_first_name ?? '',
      child_last_name: core.child_last_name ?? '',
      child_dob: core.child_dob ?? '',
      visit_type: core.visit_type ?? '',
      preferred_language: core.preferred_language ?? '',
      sex: core.sex ?? '',
      race_ethnicity: core.race_ethnicity ?? '',
    }),
    [core],
  );

  const [coreForm, setCoreForm] = useState(corePayload);
  useEffect(() => setCoreForm(corePayload), [corePayload]);

  async function saveCore() {
    if (!token) return;
    setSavingTable('core');
    try {
      await api(`/api/staff/patients/${id}/core`, {
        method: 'PATCH',
        headers: authHeader(token),
        body: JSON.stringify(coreForm),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingTable('');
    }
  }

  async function saveRowTable(table: string) {
    if (!token) return;
    setSavingTable(table);
    try {
      const cleaned = (rowData[table] ?? []).map((row) => {
        const mapped: Record<string, any> = { ...row };
        for (const field of rowTableConfigs[table]) {
          if (field.type === 'checkbox') {
            mapped[field.key] = row[field.key] ? 1 : 0;
          }
        }
        return mapped;
      });

      await api(`/api/staff/patients/${id}/table/${table}`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify({ rows: cleaned }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingTable('');
    }
  }

  async function saveOneTable(table: string) {
    if (!token) return;
    setSavingTable(table);
    try {
      const payload = { ...(oneData[table] ?? {}) };
      for (const field of oneTableConfigs[table]) {
        if (field.type === 'checkbox') {
          payload[field.key] = payload[field.key] ? 1 : 0;
        }
      }

      await api(`/api/staff/patients/${id}/table/${table}`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify({ data: payload }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingTable('');
    }
  }

  function addRow(table: string) {
    setRowData((prev) => ({
      ...prev,
      [table]: [...(prev[table] ?? []), { ...(defaultRows[table] ?? {}) }],
    }));
  }

  function removeRow(table: string, index: number) {
    setRowData((prev) => ({
      ...prev,
      [table]: (prev[table] ?? []).filter((_, idx) => idx !== index),
    }));
  }

  function updateRowCell(table: string, rowIndex: number, key: string, value: any) {
    setRowData((prev) => {
      const rows = [...(prev[table] ?? [])];
      rows[rowIndex] = { ...(rows[rowIndex] ?? {}), [key]: value };
      return { ...prev, [table]: rows };
    });
  }

  function updateOneCell(table: string, key: string, value: any) {
    setOneData((prev) => ({
      ...prev,
      [table]: { ...(prev[table] ?? {}), [key]: value },
    }));
  }

  async function exportSubmissionJson(submissionId: string) {
    if (!token) return;
    try {
      const exported = await api<Record<string, unknown>>(`/api/staff/submissions/${submissionId}/json`, {
        headers: authHeader(token),
      });
      setExportedJson(exported);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function exportSubmissionPdf(submissionId: string) {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/staff/submissions/${submissionId}/pdf`, {
        headers: authHeader(token),
      });

      if (!response.ok) {
        let message = 'Failed to export PDF';
        try {
          const payload = await response.json();
          message = payload?.error?.message ?? message;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const fileName = parseDownloadFilename(response.headers.get('content-disposition'));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function exportSubmissionResponsesPdf(submissionId: string) {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/staff/submissions/${submissionId}/responses-pdf`, {
        headers: authHeader(token),
      });

      if (!response.ok) {
        let message = 'Failed to export responses PDF';
        try {
          const payload = await response.json();
          message = payload?.error?.message ?? message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const fileName = parseDownloadFilename(response.headers.get('content-disposition'));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadSubmissionResponses(submissionId: string) {
    if (!token) return;
    setLoadingResponsesFor(submissionId);
    try {
      const payload = await api<SubmissionResponsesPayload>(`/api/staff/submissions/${submissionId}/responses`, {
        headers: authHeader(token),
      });
      setSubmissionResponses((prev) => ({ ...prev, [submissionId]: payload }));
      setResponseDrafts((prev) => {
        const next = { ...(prev[submissionId] ?? {}) };
        for (const section of payload.template_bound_answers.sections) {
          for (const field of section.fields) {
            next[field.field_id] = field.value;
          }
        }
        return { ...prev, [submissionId]: next };
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingResponsesFor('');
    }
  }

  async function saveSubmissionResponses(submissionId: string) {
    if (!token) return;
    const draft = responseDrafts[submissionId];
    if (!draft) return;

    setSavingResponsesFor(submissionId);
    try {
      await api(`/api/staff/submissions/${submissionId}/responses`, {
        method: 'PATCH',
        headers: authHeader(token),
        body: JSON.stringify({
          responses: draft,
        }),
      });
      await loadSubmissionResponses(submissionId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingResponsesFor('');
    }
  }

  function hideSubmissionResponses(submissionId: string) {
    setSubmissionResponses((prev) => {
      const next = { ...prev };
      delete next[submissionId];
      return next;
    });
    setResponseDrafts((prev) => {
      const next = { ...prev };
      delete next[submissionId];
      return next;
    });
  }

  function updateSubmissionDraftValue(submissionId: string, fieldId: string, value: unknown) {
    setResponseDrafts((prev) => ({
      ...prev,
      [submissionId]: {
        ...(prev[submissionId] ?? {}),
        [fieldId]: value,
      },
    }));
  }

  return (
    <div className="container">
      <div className="card">
        <Link to="/staff/patients">← Back to patients</Link>
        <h2>
          Patient: {core.child_first_name} {core.child_last_name}
        </h2>
        {error ? <div className="error">{error}</div> : null}

        <h3>Core Patient Record</h3>
        <div className="row">
          <div className="field">
            <label>First Name</label>
            <input value={coreForm.child_first_name} onChange={(e) => setCoreForm((p) => ({ ...p, child_first_name: e.target.value }))} />
          </div>
          <div className="field">
            <label>Last Name</label>
            <input value={coreForm.child_last_name} onChange={(e) => setCoreForm((p) => ({ ...p, child_last_name: e.target.value }))} />
          </div>
          <div className="field">
            <label>DOB</label>
            <input type="date" value={coreForm.child_dob} onChange={(e) => setCoreForm((p) => ({ ...p, child_dob: e.target.value }))} />
          </div>
          <div className="field">
            <label>Visit Type</label>
            <input value={coreForm.visit_type} onChange={(e) => setCoreForm((p) => ({ ...p, visit_type: e.target.value }))} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Preferred Language</label>
            <input value={coreForm.preferred_language} onChange={(e) => setCoreForm((p) => ({ ...p, preferred_language: e.target.value }))} />
          </div>
          <div className="field">
            <label>Sex</label>
            <input value={coreForm.sex} onChange={(e) => setCoreForm((p) => ({ ...p, sex: e.target.value }))} />
          </div>
          <div className="field">
            <label>Race/Ethnicity</label>
            <input value={coreForm.race_ethnicity} onChange={(e) => setCoreForm((p) => ({ ...p, race_ethnicity: e.target.value }))} />
          </div>
        </div>
        <button onClick={saveCore} disabled={savingTable === 'core'}>
          {savingTable === 'core' ? 'Saving...' : 'Save Core'}
        </button>

        {/* ── Patient Portal Link Panel ── */}
        <div className="card" style={{ background: '#f0f7ff', marginBottom: 12, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: 0 }}>Patient Portal Link</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#555' }}>
                One permanent link for all forms assigned to this patient.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!portalLink && (
                <button className="secondary" onClick={loadPortalLink} disabled={portalLinkLoading}>
                  {portalLinkLoading ? 'Loading...' : 'View Portal Link'}
                </button>
              )}
              <button
                className="secondary"
                style={{ color: '#c00', borderColor: '#c00' }}
                onClick={handleRegeneratePortalToken}
                disabled={regenerating}
              >
                {regenerating ? 'Regenerating...' : 'Regenerate Link'}
              </button>
            </div>
          </div>
          {portalLink && (
            <div style={{ marginTop: 12 }}>
              <div style={{ padding: '8px 12px', background: '#eef6ff', borderRadius: 6, border: '1px solid #b3d4f7', fontSize: 13, marginBottom: 8, wordBreak: 'break-all' }}>
                {portalLink.portal_url}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => copyLink('portal', portalLink.portal_url)}>
                  {copiedLinkId === 'portal' ? 'Copied!' : 'Copy Link'}
                </button>
                <button className="secondary" onClick={() => setShowQrId(showQrId === 'portal' ? null : 'portal')}>
                  {showQrId === 'portal' ? 'Hide QR' : 'Show QR'}
                </button>
              </div>
              {showQrId === 'portal' && (
                <img src={portalLink.qr_code_data_url} alt="Portal QR code" style={{ marginTop: 8, border: '1px solid #ddd', borderRadius: 4, display: 'block' }} />
              )}
            </div>
          )}
        </div>

        {/* ── Form Assignment Panel ── */}
        <div className="card" style={{ background: '#f0f7ff', marginBottom: 20, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Assign Forms</h3>
            <button onClick={() => { setShowAssignForm((v) => !v); setCreatedBundle(null); }}>
              {showAssignForm ? 'Cancel' : '+ Assign Forms'}
            </button>
          </div>

          {showAssignForm && (
            <div style={{ marginTop: 16 }}>
              <div className="row">
                <div className="field">
                  <label>Expires After (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                    style={{ width: 80 }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                  Forms to Assign
                  {selectedTemplateIds.length > 0 && (
                    <span style={{ fontWeight: 400, color: '#555', marginLeft: 8 }}>
                      ({selectedTemplateIds.length} selected)
                    </span>
                  )}
                </label>
                {templates.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#888' }}>No published templates available.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {templates.map((t) => (
                      <label
                        key={t.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 12px',
                          borderRadius: 6,
                          cursor: 'pointer',
                          background: selectedTemplateIds.includes(t.id) ? '#dbeafe' : '#fff',
                          border: `1px solid ${selectedTemplateIds.includes(t.id) ? '#3b82f6' : '#ddd'}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTemplateIds.includes(t.id)}
                          onChange={() => toggleTemplate(t.id)}
                          style={{ width: 16, height: 16 }}
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleAssign}
                disabled={assigning || selectedTemplateIds.length === 0}
                className="btn"
              >
                {assigning
                  ? 'Creating...'
                  : `Create ${selectedTemplateIds.length > 1 ? `${selectedTemplateIds.length} Assignment Links` : 'Assignment Link'}`}
              </button>
            </div>
          )}

          {createdBundle && (
            <div style={{ marginTop: 16, padding: 16, background: '#fff', borderRadius: 8, border: '1px solid #b3d4f7' }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Bundle created</p>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>
                Forms: {createdBundle.template_names.join(', ')}
              </p>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
                Expires: {new Date(createdBundle.expires_at).toLocaleDateString()}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button onClick={() => copyLink('bundle', createdBundle.fill_url)} style={{ whiteSpace: 'nowrap' }}>
                  {copiedLinkId === 'bundle' ? 'Copied!' : 'Copy Link'}
                </button>
                <button className="secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowQrId(showQrId === 'bundle' ? null : 'bundle')}>
                  {showQrId === 'bundle' ? 'Hide QR' : 'Show QR'}
                </button>
              </div>
              {showQrId === 'bundle' && (
                <img src={createdBundle.qr_code_data_url} alt="QR code" style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 4, display: 'block' }} />
              )}
              {createdBundle.bundle_id && (
                <div style={{ marginTop: 4 }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Send via SMS</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="tel"
                      placeholder="+15551234567"
                      value={smsPhone}
                      onChange={(e) => setSmsPhone(e.target.value)}
                      style={{ width: 180 }}
                    />
                    <button onClick={handleSendSms} disabled={smsSending || !smsPhone}>
                      {smsSending ? 'Sending...' : 'Send SMS'}
                    </button>
                  </div>
                  {smsResult && (
                    <p style={{ marginTop: 6, fontSize: 13, color: smsResult.startsWith('Failed') ? '#c00' : '#0a0' }}>
                      {smsResult}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {assignments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Existing Assignments</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th>Status</th>
                    <th>Assigned By</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.template_name}</td>
                      <td>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          background: a.status === 'completed' ? '#d4edda' : a.status === 'expired' ? '#f8d7da' : a.status === 'in_progress' ? '#fff3cd' : '#cfe2ff',
                          color: a.status === 'completed' ? '#155724' : a.status === 'expired' ? '#721c24' : a.status === 'in_progress' ? '#856404' : '#084298',
                        }}>
                          {a.status}
                        </span>
                      </td>
                      <td>{a.assigned_by_email}</td>
                      <td>{new Date(a.expires_at).toLocaleDateString()}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(a.status === 'pending' || a.status === 'in_progress') && (
                          <button
                            className="secondary"
                            style={{ fontSize: 12, padding: '2px 8px' }}
                            onClick={async () => {
                              if (!token) return;
                              try {
                                const result = await api<{ fill_url: string; qr_code_data_url: string; bundle_id: string | null }>(
                                  `/api/staff/assignments/${a.id}/link`,
                                  { headers: authHeader(token) },
                                );
                                setCreatedBundle({
                                  bundle_id: result.bundle_id,
                                  bundle_token: '',
                                  patient_name: `${detail?.patient?.child_first_name ?? ''} ${detail?.patient?.child_last_name ?? ''}`,
                                  template_names: [a.template_name],
                                  fill_url: result.fill_url,
                                  qr_code_data_url: result.qr_code_data_url,
                                  expires_at: a.expires_at,
                                });
                                setShowQrId(null);
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            View Link
                          </button>
                        )}
                        <button
                          className="secondary"
                          style={{ fontSize: 12, padding: '2px 8px', color: '#c00', borderColor: '#c00' }}
                          onClick={() => handleDeleteAssignment(a.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <h3 style={{ marginTop: 24 }}>Editable Sections</h3>

        {Object.entries(rowTableConfigs).map(([table, fields]) => (
          <div key={table} className="card" style={{ marginBottom: 12 }}>
            <h4>{table}</h4>
            {(rowData[table] ?? []).map((row, rowIndex) => (
              <div key={`${table}-${rowIndex}`} className="card" style={{ marginBottom: 8, background: '#f9fbff' }}>
                <div className="row">
                  {fields.map((field) => (
                    <div key={`${table}-${rowIndex}-${field.key}`} className="field">
                      <label>{field.label}</label>
                      {field.type === 'checkbox' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(row[field.key])}
                          onChange={(e) => updateRowCell(table, rowIndex, field.key, e.target.checked)}
                          style={{ width: 22, height: 22 }}
                        />
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={row[field.key] ?? ''}
                          onChange={(e) => {
                            const value = field.type === 'number' ? Number(e.target.value) : e.target.value;
                            updateRowCell(table, rowIndex, field.key, value);
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <button className="secondary" onClick={() => removeRow(table, rowIndex)}>
                  Remove Row
                </button>
              </div>
            ))}

            <div className="actions">
              <button className="secondary" onClick={() => addRow(table)}>
                Add Row
              </button>
              <button onClick={() => saveRowTable(table)} disabled={savingTable === table}>
                {savingTable === table ? 'Saving...' : `Save ${table}`}
              </button>
            </div>
          </div>
        ))}

        {Object.entries(oneTableConfigs).map(([table, fields]) => (
          <div key={table} className="card" style={{ marginBottom: 12 }}>
            <h4>{table}</h4>
            <div className="row">
              {fields.map((field) => (
                <div key={`${table}-${field.key}`} className="field">
                  <label>{field.label}</label>
                  {field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={Boolean(oneData[table]?.[field.key])}
                      onChange={(e) => updateOneCell(table, field.key, e.target.checked)}
                      style={{ width: 22, height: 22 }}
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={oneData[table]?.[field.key] ?? ''}
                      onChange={(e) => {
                        const value = field.type === 'number' ? Number(e.target.value) : e.target.value;
                        updateOneCell(table, field.key, value);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => saveOneTable(table)} disabled={savingTable === table}>
              {savingTable === table ? 'Saving...' : `Save ${table}`}
            </button>
          </div>
        ))}

        <h3 style={{ marginTop: 24 }}>Submission Exports</h3>
        {submissions.length === 0 ? <p>No submissions linked.</p> : null}
        {submissions.map((submission: any) => (
          <div key={submission.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>{submission.id}</strong> ({submission.status})
            </div>
            <div className="actions">
              <button onClick={() => exportSubmissionJson(submission.id)}>Export JSON</button>
              <button onClick={() => exportSubmissionPdf(submission.id)}>Export PDF</button>
              <button className="secondary" onClick={() => exportSubmissionResponsesPdf(submission.id)}>
                Responses PDF
              </button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
              {!submissionResponses[submission.id] ? (
                <button
                  className="secondary"
                  style={{ width: 'auto' }}
                  onClick={() => loadSubmissionResponses(submission.id)}
                  disabled={loadingResponsesFor === submission.id}
                >
                  {loadingResponsesFor === submission.id ? 'Loading...' : 'View/Edit Responses'}
                </button>
              ) : (
                <>
                  <button
                    className="secondary"
                    style={{ width: 'auto' }}
                    onClick={() => saveSubmissionResponses(submission.id)}
                    disabled={savingResponsesFor === submission.id}
                  >
                    {savingResponsesFor === submission.id ? 'Saving...' : 'Save Responses'}
                  </button>
                  <button className="secondary" style={{ width: 'auto' }} onClick={() => hideSubmissionResponses(submission.id)}>
                    Hide Responses
                  </button>
                </>
              )}
            </div>

            {submissionResponses[submission.id] ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  Template: {submissionResponses[submission.id].template_bound_answers.template_key} v
                  {submissionResponses[submission.id].template_bound_answers.template_version}
                </div>
                {submissionResponses[submission.id].template_bound_answers.sections.map((section) => (
                  <div key={`${submission.id}-${section.section_key}`} className="card" style={{ background: '#f8fbff', marginBottom: 8 }}>
                    <h4 style={{ marginTop: 0 }}>{section.section_key}</h4>
                    <div className="row">
                      {section.fields.map((field) => {
                        const draftValue = coerceResponseInputValue(
                          field.field_type,
                          responseDrafts[submission.id]?.[field.field_id] ?? field.value,
                        );

                        return (
                          <div key={`${submission.id}-${field.field_id}`} className="field">
                            <label>
                              {field.field_name} ({field.field_id})
                              {field.required ? ' *' : ''}
                            </label>
                            {field.field_type === 'checkbox' ? (
                              <input
                                type="checkbox"
                                checked={Boolean(draftValue)}
                                onChange={(event) =>
                                  updateSubmissionDraftValue(submission.id, field.field_id, event.target.checked)
                                }
                                style={{ width: 22, height: 22 }}
                              />
                            ) : field.field_type === 'textarea' ? (
                              <textarea
                                value={String(draftValue)}
                                onChange={(event) =>
                                  updateSubmissionDraftValue(submission.id, field.field_id, event.target.value)
                                }
                              />
                            ) : field.field_type === 'select' ? (
                              <select
                                value={String(draftValue)}
                                onChange={(event) =>
                                  updateSubmissionDraftValue(submission.id, field.field_id, event.target.value)
                                }
                              >
                                <option value="">Select...</option>
                                {(field.options ?? []).map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : field.field_type === 'radio' ? (
                              <div style={{ display: 'grid', gap: 8 }}>
                                {(field.options ?? []).map((option) => (
                                  <label
                                    key={`${submission.id}-${field.field_id}-${option}`}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}
                                  >
                                    <input
                                      type="radio"
                                      name={`${submission.id}-${field.field_id}`}
                                      checked={String(draftValue) === option}
                                      onChange={() => updateSubmissionDraftValue(submission.id, field.field_id, option)}
                                      style={{ width: 18, height: 18 }}
                                    />
                                    <span>{option}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <input
                                type={field.field_type === 'date' ? 'date' : 'text'}
                                value={String(draftValue)}
                                onChange={(event) =>
                                  updateSubmissionDraftValue(submission.id, field.field_id, event.target.value)
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {exportedJson ? (
          <>
            <h4>Latest Export Payload</h4>
            <div className="json-box">{JSON.stringify(exportedJson, null, 2)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
