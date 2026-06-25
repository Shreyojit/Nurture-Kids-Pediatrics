/**
 * Patient dashboard — forms and files on one screen, no tabs.
 * Each form/file shows: Org Name › Branch Name (when a branch is known).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  clearPatientSession,
  getPatientSession,
  setPatientSession,
  type PatientPortalAccess,
  type PatientPortalForm,
  type PatientSession,
} from '../lib/patientSession';
import { patientDocumentTypeLabel } from '../lib/patientDocumentTypes';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

function formDescription(templateName: string, templateKey?: string): string {
  const key = (templateKey ?? templateName).toLowerCase();
  if (key.includes('registration')) return 'New patient info & insurance';
  if (key.includes('mchat') || key.includes('m-chat')) return 'Developmental screening';
  if (key.includes('asq')) return 'Ages & stages questionnaire';
  if (key.includes('epds')) return 'Postpartum mood screening';
  if (key.includes('lead')) return 'Lead exposure screening';
  if (key.includes('phq')) return 'Mental health questionnaire';
  if (key.includes('tb')) return 'Tuberculosis risk screen';
  return 'Complete before your visit';
}

function formatAppointmentLabel(date: string | null, time: string | null): string | null {
  if (!date?.trim()) return null;
  const datePart = date.trim().slice(0, 10);
  const parsed = new Date(time?.trim() ? `${datePart}T${time.trim()}` : datePart);
  if (Number.isNaN(parsed.getTime())) {
    return time?.trim() ? `${date} at ${time}` : date;
  }
  const day = parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  if (!time?.trim()) return day;
  const timeLabel = parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${timeLabel}`;
}

/** Renders "Org Name" or "Org Name › Branch" */
function PracticeTag({ name, location }: { name: string; location?: string | null }) {
  if (location?.trim()) {
    return (
      <p className="patient-portal-practice-tag" style={{ margin: '2px 0 0' }}>
        {name}
        <span style={{ margin: '0 4px', opacity: 0.5 }}>›</span>
        <span>{location}</span>
      </p>
    );
  }
  return <p className="patient-portal-practice-tag" style={{ margin: '2px 0 0' }}>{name}</p>;
}

function normalizeAccess(raw: Record<string, unknown>): PatientPortalAccess {
  const practiceNames = Array.isArray(raw.practice_names)
    ? (raw.practice_names as string[]).map(String)
    : raw.practice_name
      ? [String(raw.practice_name)]
      : [];

  const singlePractice =
    raw.practice_name != null && String(raw.practice_name).trim()
      ? String(raw.practice_name)
      : practiceNames.length === 1
        ? practiceNames[0]
        : null;

  const seenIds = new Set<string>();
  const forms = ((raw.forms as PatientPortalForm[]) ?? [])
    .map((f) => ({ ...f, practice_name: String(f.practice_name ?? singlePractice ?? '') }))
    .filter((f) => {
      if (seenIds.has(f.assignment_id)) return false;
      seenIds.add(f.assignment_id);
      return true;
    });

  return {
    patient_first_name: String(raw.patient_first_name ?? ''),
    practice_name: singlePractice,
    practice_names: practiceNames,
    next_appointment_date: (raw.next_appointment_date as string | null) ?? null,
    next_appointment_time: (raw.next_appointment_time as string | null) ?? null,
    forms,
    documents: (raw.documents as PatientPortalAccess['documents']) ?? [],
  };
}

type Props = {
  onSessionChange?: (session: PatientSession | null) => void;
};

export function PatientFamilyDashboard({ onSessionChange }: Props) {
  const navigate = useNavigate();

  const [session, setSession] = useState<PatientSession | null>(() => getPatientSession());
  const [access, setAccess] = useState<PatientPortalAccess | null>(session?.access ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = useCallback(async (current: PatientSession) => {
    setRefreshing(true);
    try {
      const raw = await api<Record<string, unknown>>('/api/patient-portal/access', {
        method: 'POST',
        body: JSON.stringify({
          first_name: current.identity.firstName,
          last_name: current.identity.lastName,
          dob: current.identity.dob,
        }),
      });
      const nextAccess = normalizeAccess(raw);
      const updated: PatientSession = { ...current, access: nextAccess };
      setPatientSession(updated);
      setSession(updated);
      setAccess(nextAccess);
      onSessionChange?.(updated);
    } catch {
      // keep stale data
    } finally {
      setRefreshing(false);
    }
  }, [onSessionChange]);

  useEffect(() => {
    const s = getPatientSession();
    if (!s) return;
    setSession(s);
    setAccess(s.access);
    void refresh(s);
  }, [refresh]);

  const formStats = useMemo(() => {
    const forms = access?.forms ?? [];
    const total = forms.length;
    const done = forms.filter((f) => f.status === 'completed').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, pct, todo: forms.filter((f) => f.status !== 'completed') };
  }, [access?.forms]);

  const appointmentLabel = formatAppointmentLabel(
    access?.next_appointment_date ?? null,
    access?.next_appointment_time ?? null,
  );

  function logout() {
    clearPatientSession();
    onSessionChange?.(null);
    navigate('/parent/login');
  }

  async function downloadSubmissionPdf(submissionId: string, templateName: string) {
    if (!session) return;
    setDownloadingId(submissionId);
    try {
      const params = new URLSearchParams({
        first_name: session.identity.firstName,
        last_name: session.identity.lastName,
        dob: session.identity.dob,
      });
      const url = `${API_BASE}/api/patient-portal/submissions/${submissionId}/pdf?${params}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${templateName}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('Could not download PDF. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadDocument(docId: string, filename: string) {
    if (!session) return;
    setDownloadingId(docId);
    try {
      const params = new URLSearchParams({
        first_name: session.identity.firstName,
        last_name: session.identity.lastName,
        dob: session.identity.dob,
      });
      const url = `${API_BASE}/api/patient-portal/documents/${docId}/download?${params}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('Could not download file. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  }

  function openForm(form: PatientPortalForm) {
    if (!form.session_id || !form.practice_slug) return;
    navigate(`/p/${form.practice_slug}/session/${form.session_id}/pdf-form`);
  }

  if (!session || !access) {
    return <Navigate to="/parent/login" replace />;
  }

  const childName = access.patient_first_name?.trim() || 'your child';
  const practiceSummary =
    access.practice_names.length > 1
      ? `${access.practice_names.length} practices`
      : access.practice_name ?? access.practice_names[0] ?? 'Your care team';

  const completedForms = access.forms.filter((f) => f.status === 'completed');

  return (
    <div className="patient-portal-page">
      <div className="patient-portal-shell" style={{ width: 'min(640px, 100%)' }}>

        {/* ── Identity card ── */}
        <div className="patient-portal-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="brand-kicker">{practiceSummary}</div>
              <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>
                Hi, {childName}&apos;s family
              </h1>
            </div>
            <button type="button" className="secondary" style={{ fontSize: 13 }} onClick={logout}>
              Sign out
            </button>
          </div>

          {appointmentLabel ? (
            <div className="patient-portal-appointment" style={{ marginTop: 14 }}>
              <span>📅</span>
              <span>
                <strong>Appointment:</strong> {appointmentLabel}
              </span>
            </div>
          ) : null}
        </div>

        {/* ── Forms card ── */}
        <div className="patient-portal-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>Forms to complete</h2>
            <button
              type="button"
              className="patient-portal-refresh"
              onClick={() => refresh(session)}
              disabled={refreshing}
              style={{ position: 'static', margin: 0 }}
            >
              {refreshing ? 'Updating…' : 'Refresh'}
            </button>
          </div>

          {formStats.total > 0 ? (
            <div className="patient-portal-progress" style={{ marginBottom: 20 }}>
              <div className="patient-portal-progress-meta">
                <span>
                  {formStats.done} of {formStats.total} {formStats.total === 1 ? 'form' : 'forms'} done
                </span>
                <span>{formStats.pct}%</span>
              </div>
              <div className="patient-portal-progress-bar">
                <div className="patient-portal-progress-fill" style={{ width: `${formStats.pct}%` }} />
              </div>
            </div>
          ) : null}

          {formStats.total === 0 ? (
            <p style={{ color: '#666', fontSize: 14, textAlign: 'center', padding: '12px 0' }}>
              No forms assigned yet. Check back later or contact your practice.
            </p>
          ) : (
            <>
              {formStats.todo.length > 0 ? (
                <>
                  <p className="patient-portal-section-label">STILL TO DO</p>
                  <div className="patient-portal-form-list">
                    {formStats.todo.map((form) => (
                      <div key={form.assignment_id} className="patient-portal-form-item">
                        <div className="patient-portal-form-icon todo">📋</div>
                        <div className="patient-portal-form-body">
                          <p className="patient-portal-form-name">{form.template_name}</p>
                          {form.practice_name ? (
                            <PracticeTag name={form.practice_name} location={form.location_name} />
                          ) : null}
                          <p className="patient-portal-form-desc">
                            {formDescription(form.template_name, form.template_key)}
                          </p>
                        </div>
                        {form.session_id ? (
                          <button type="button" className="patient-portal-start-btn" onClick={() => openForm(form)}>
                            {form.status === 'in_progress' ? 'Continue' : 'Start'}
                          </button>
                        ) : form.template_key === 'patient_registration' ? (
                          <Link
                            to="/parent/enroll"
                            className="patient-portal-start-btn"
                            style={{ textDecoration: 'none', textAlign: 'center', display: 'inline-block' }}
                          >
                            Start
                          </Link>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {completedForms.length > 0 ? (
                <>
                  <p className="patient-portal-section-label" style={{ marginTop: 16 }}>
                    COMPLETED
                  </p>
                  <div className="patient-portal-form-list">
                    {completedForms.map((form) => (
                      <div key={form.assignment_id} className="patient-portal-form-item is-done">
                        <div className="patient-portal-form-icon done">✓</div>
                        <div className="patient-portal-form-body">
                          <p className="patient-portal-form-name">{form.template_name}</p>
                          {form.practice_name ? (
                            <PracticeTag name={form.practice_name} location={form.location_name} />
                          ) : null}
                          <p className="patient-portal-form-desc">Submitted — thank you!</p>
                        </div>
                        {form.session_id ? (
                          <button
                            type="button"
                            className="secondary"
                            style={{ fontSize: 13, whiteSpace: 'nowrap', width: 'auto', flexShrink: 0 }}
                            onClick={() => downloadSubmissionPdf(form.session_id!, form.template_name)}
                            disabled={downloadingId === form.session_id}
                          >
                            {downloadingId === form.session_id ? 'Downloading…' : 'Download PDF'}
                          </button>
                        ) : (
                          <span className="patient-portal-done-label">Done</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          <p className="patient-portal-footer">
            Completed forms are sent to the practice that assigned them. Please finish all forms before your visit.
          </p>
        </div>

        {/* ── Patient files card ── */}
        <div className="patient-portal-card">
          <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Patient files</h2>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555' }}>
            Files shared with your family by your care team.
          </p>

          {access.documents.length === 0 ? (
            <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>
              No files available right now.
            </p>
          ) : (
            access.documents.map((doc) => (
              <div
                key={doc.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  padding: '12px 0',
                  borderTop: '1px solid #e8eef4',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.original_filename}</div>
                  {doc.practice_name ? (
                    <PracticeTag name={doc.practice_name} location={doc.location_name} />
                  ) : null}
                  <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                    {patientDocumentTypeLabel(doc.document_type)}
                    {' · '}Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: 13, width: 'auto', flexShrink: 0 }}
                  onClick={() => downloadDocument(doc.id, doc.original_filename)}
                  disabled={downloadingId === doc.id}
                >
                  {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                </button>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
