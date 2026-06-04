import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import { formatAssignmentStatus } from '../lib/staffLabels';
import { PATIENT_DOCUMENT_TYPE_OPTIONS, patientDocumentTypeLabel } from '../lib/patientDocumentTypes';

type Props = {
  token: string | null;
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


export function StaffPatientDetailPage({ token }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [exportedJson, setExportedJson] = useState<Record<string, unknown> | null>(null);

  const [submissionResponses, setSubmissionResponses] = useState<Record<string, SubmissionResponsesPayload>>({});
  const [responseDrafts, setResponseDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [loadingResponsesFor, setLoadingResponsesFor] = useState('');
  const [savingResponsesFor, setSavingResponsesFor] = useState('');

  // Form assignment state
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [templates, setTemplates] = useState<PublishedTemplate[]>([]);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState('');
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignMsg, setAutoAssignMsg] = useState('');

  // Patient files state
  type PatientDoc = {
    id: string; document_type: string; original_filename: string;
    uploaded_at: string; uploaded_by_email: string;
  };
  const [documents, setDocuments] = useState<PatientDoc[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  async function loadDocuments() {
    if (!token) return;
    try {
      const result = await api<PatientDoc[]>(`/api/staff/documents?patient_id=${id}`, {
        headers: authHeader(token),
      });
      setDocuments(result);
    } catch {
      // non-fatal
    }
  }

  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !uploadFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('patient_id', id);
      form.append('document_type', uploadType);
      await fetch(`${API_BASE}/api/staff/documents`, {
        method: 'POST',
        headers: authHeader(token),
        body: form,
      }).then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error((j as any)?.error?.message ?? 'Upload failed');
        }
      });
      setUploadFile(null);
      setUploadType('other');
      setFileInputKey((k) => k + 1);
      await loadDocuments();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadDocument(docId: string, filename: string) {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/api/staff/documents/${docId}/download`, {
        headers: authHeader(token),
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDeleteDocument(docId: string) {
    if (!token) return;
    if (!window.confirm('Delete this file? This cannot be undone.')) return;
    setDeletingDocId(docId);
    try {
      await api(`/api/staff/documents/${docId}`, { method: 'DELETE', headers: authHeader(token) });
      await loadDocuments();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingDocId(null);
    }
  }

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

  async function handleAutoAssignWellVisit() {
    if (!token || !id) return;
    setAutoAssigning(true);
    setAutoAssignMsg('');
    try {
      const result = await api<{
        assignments_created: number;
        form_labels: string[];
        age_group: string | null;
        message: string;
      }>(`/api/staff/assignments/patient/${id}/auto-assign`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({}),
      });
      setAutoAssignMsg(result.message);
      await loadAssignments();
    } catch (e) {
      setAutoAssignMsg((e as Error).message);
    } finally {
      setAutoAssigning(false);
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
    try {
      const result = await api<{ patient_name: string; template_names: string[] }>('/api/staff/assignments', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({ patient_id: id, template_ids: selectedTemplateIds }),
      });
      setAssignSuccess(`Forms assigned to ${result.patient_name}. Ask them to sign in at admin.pediformpro.com/parent/login`);
      setShowAssignForm(false);
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

  async function load() {
    if (!token) return;
    try {
      const response = await api<any>(`/api/staff/patients/${id}`, {
        headers: authHeader(token),
      });
      setDetail(response);
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
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  const core = detail?.patient ?? {};
  const submissions = detail?.submissions ?? []; 
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
        <Link to="/staff/patients">← Back to today's patients</Link>
        <h2>
          Patient: {core.child_first_name} {core.child_last_name}
        </h2>
        {error ? <div className="error">{error}</div> : null}

        {/* ── Form Assignment Panel ── */}
        <div className="card card-subtle" style={{ marginBottom: 20, marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Send forms</h3>
            <div className="toolbar">
              <button
                type="button"
                className="secondary btn-inline"
                onClick={() => void handleAutoAssignWellVisit()}
                disabled={autoAssigning}
              >
                {autoAssigning ? 'Assigning…' : 'Auto-assign (well visit)'}
              </button>
              <button
                type="button"
                className="btn-inline"
                onClick={() => setShowAssignForm((v) => !v)}
              >
                {showAssignForm ? 'Cancel' : '+ Send a form'}
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
            For well check, well visit, or annual checkup appointments, use auto-assign to send age-based forms
            (EPDS, ASQ, M-CHAT, TB, Lead, PHQ-9, etc.) from the patient&apos;s DOB and visit type on file.
          </p>
          {autoAssignMsg ? (
            <p
              style={{
                marginTop: 8,
                fontSize: 13,
                color: autoAssignMsg.toLowerCase().includes('assigned') ? '#155724' : '#555',
              }}
            >
              {autoAssignMsg}
            </p>
          ) : null}

          {showAssignForm && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                  Forms to send
                  {selectedTemplateIds.length > 0 && (
                    <span style={{ fontWeight: 400, color: '#555', marginLeft: 8 }}>
                      ({selectedTemplateIds.length} selected)
                    </span>
                  )}
                </label>
                {templates.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#888' }}>No active forms available.</p>
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
                  : `Send ${selectedTemplateIds.length > 1 ? `${selectedTemplateIds.length} forms` : 'form'}`}
              </button>
            </div>
          )}

          {assignSuccess && (
            <p style={{ marginTop: 12, fontSize: 13, color: '#155724', background: '#d4edda', padding: '8px 12px', borderRadius: 6 }}>
              {assignSuccess}
            </p>
          )}

          {assignments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Sent forms</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th>Status</th>
                    <th>Sent by</th>
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
                          {formatAssignmentStatus(a.status)}
                        </span>
                      </td>
                      <td>{a.assigned_by_email}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

        {/* ── Patient files ── */}
        <div className="card card-subtle" style={{ marginBottom: 20, marginTop: 8 }}>
          <h3 style={{ margin: '0 0 4px' }}>Patient files</h3>
          <p className="text-muted" style={{ margin: '0 0 16px', fontSize: 13 }}>
            Send files to the patient&apos;s family portal — vaccine records, lab reports, referrals, insurance cards,
            visit summaries, consent forms, and other PDFs or images.
          </p>

          <form onSubmit={handleUploadDocument} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>File type</label>
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} style={{ width: 180 }}>
                {PATIENT_DOCUMENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>File (PDF or image)</label>
              <input
                key={fileInputKey}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>
            <button type="submit" disabled={uploading || !uploadFile} style={{ whiteSpace: 'nowrap' }}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </form>

          {documents.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No files uploaded yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Uploaded</th>
                  <th>By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.original_filename}</td>
                    <td>{patientDocumentTypeLabel(doc.document_type)}</td>
                    <td>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                    <td style={{ fontSize: 12 }}>{doc.uploaded_by_email}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: '2px 8px' }}
                        onClick={() => handleDownloadDocument(doc.id, doc.original_filename)}
                      >
                        Download
                      </button>
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: '2px 8px', color: '#c00', borderColor: '#c00' }}
                        onClick={() => handleDeleteDocument(doc.id)}
                        disabled={deletingDocId === doc.id}
                      >
                        {deletingDocId === doc.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
