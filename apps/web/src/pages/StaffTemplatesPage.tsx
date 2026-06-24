import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import { formatAcroformReady, formatTemplateStatus } from '../lib/staffLabels';

type Props = {
  token: string | null;
};

type TemplateRow = {
  id: string;
  template_key: string;
  version: number;
  name: string;
  status: 'draft' | 'published' | 'archived';
  acroform_pdf_path: string | null;
  is_marker_template: number; // 1 = PDF Builder form, 0 = AcroForm
  created_at: string;
};

export function StaffTemplatesPage({ token }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  // Show a banner if we were redirected here from the PDF Builder publish flow
  const justPublished = new URLSearchParams(location.search).get('published') === '1';
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const [templateKey, setTemplateKey] = useState('patient_registration');
  const [templateName, setTemplateName] = useState('Patient Registration');
  const [file, setFile] = useState<File | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState('');

  async function loadTemplates() {
    if (!token) return;
    setLoading(true);
    try {
      const rows = await api<TemplateRow[]>('/api/staff/templates', {
        headers: authHeader(token),
      });
      setTemplates(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function uploadTemplate() {
    setError('');
    if (!token) return;
    if (!templateKey.trim() || !templateName.trim() || !file) {
      setError('Form ID, form name, and PDF file are required.');
      return;
    }

    const body = new FormData();
    body.append('template_key', templateKey.trim());
    body.append('name', templateName.trim());
    body.append('file', file);

    setUploading(true);
    try {
      const created = await api<{ id: string }>('/api/staff/templates/upload-source', {
        method: 'POST',
        headers: authHeader(token),
        body,
      });

      setFile(null);
      await loadTemplates();
      navigate(`/staff/templates/${created.id}/editor`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function provisionTemplates() {
    if (!token) return;
    setProvisionMsg('');
    setProvisioning(true);
    try {
      const result = await api<{ message: string; copied: number; skipped: number }>('/api/staff/templates/provision', {
        method: 'POST',
        headers: authHeader(token),
      });
      setProvisionMsg(result.message);
      if (result.copied > 0) await loadTemplates();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProvisioning(false);
    }
  }

  async function deleteVersion(template: TemplateRow) {
    if (!token) return;
    setError('');

    const publishedWarning =
      template.status === 'published'
        ? '\n\nThis is the active published form. It will be removed from the database and parents will no longer be able to start new assignments for this version.'
        : '';
    const confirmed = window.confirm(
      `Delete "${template.name}" (${template.template_key} v${template.version})? This cannot be undone and removes field definitions, PDF files, and any pending assignments linked to this version.${publishedWarning}`,
    );
    if (!confirmed) return;

    setDeletingId(template.id);
    try {
      await api(`/api/staff/templates/${template.id}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      await loadTemplates();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId('');
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h2>Form builder</h2>
        <p>Upload a PDF, set up fields, and activate forms for families to complete.</p>

        {error ? <div className="error">{error}</div> : null}

        <h3>Add a new form</h3>
        <div className="row">
          <div className="field">
            <label>Form ID</label>
            <input
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
              placeholder="patient_registration"
            />
          </div>
          <div className="field">
            <label>Form name</label>
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Patient Registration" />
          </div>
          <div className="field">
            <label>Upload PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <button onClick={uploadTemplate} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Upload and set up fields'}
        </button>

        <h3 style={{ marginTop: 24 }}>Your forms</h3>

        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 13 }}
            onClick={provisionTemplates}
            disabled={provisioning}
            title="Copy the standard well-visit form library (EPDS, ASQ, M-CHAT, TB, Lead, PHQ-9 etc.) into your practice so auto-assignment works"
          >
            {provisioning ? 'Provisioning…' : '⚡ Add standard form library'}
          </button>
          {provisionMsg && (
            <span style={{ fontSize: 13, color: 'var(--color-brand)' }}>{provisionMsg}</span>
          )}
        </div>

        {loading ? <p>Loading forms...</p> : null}
        {!loading && templates.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted, #888)' }}>
            No forms yet. Click <strong>Add standard form library</strong> above to get started with the well-visit form set.
          </p>
        ) : null}

        {justPublished && (
          <div style={{
            marginBottom: 12, padding: '10px 14px', borderRadius: 6,
            background: '#d1fae5', border: '1px solid #6ee7b7', fontSize: 13, color: '#065f46',
          }}>
            Form published and now available for assignment.
          </div>
        )}

        {templates.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Form name</th>
                <th>Version</th>
                <th>Status</th>
                <th>Fields ready</th>
                <th>Action</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const isMarker = template.is_marker_template === 1;
                return (
                <tr key={template.id}>
                  <td>
                    <strong>{template.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {template.template_key}
                      {isMarker && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                          background: '#ede9fe', color: '#6d28d9',
                          padding: '1px 6px', borderRadius: 10,
                        }}>
                          PDF Builder
                        </span>
                      )}
                    </div>
                  </td>
                  <td>v{template.version}</td>
                  <td>
                    <span className="badge">{formatTemplateStatus(template.status)}</span>
                  </td>
                  <td>
                    {isMarker
                      ? <span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>Visual markers</span>
                      : formatAcroformReady(!!template.acroform_pdf_path)
                    }
                  </td>
                  <td>
                    {isMarker
                      ? <Link to={`/staff/pdf-builder/${template.id}/builder`}>Open PDF Builder</Link>
                      : <Link to={`/staff/templates/${template.id}/editor`}>Edit fields</Link>
                    }
                  </td>
                  <td>
                    <button
                      type="button"
                      className="secondary"
                      style={{
                        width: 36,
                        minHeight: 36,
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#b42318',
                        borderColor: '#fecdca',
                      }}
                      onClick={() => deleteVersion(template)}
                      disabled={deletingId === template.id}
                      title={
                        template.status === 'published'
                          ? 'Delete published form from database'
                          : 'Delete this template version'
                      }
                      aria-label={`Delete ${template.name} v${template.version}`}
                    >
                      {deletingId === template.id ? (
                        <span style={{ fontSize: 11 }}>…</span>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <path d="M3 6h18" strokeLinecap="round" />
                          <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" strokeLinecap="round" strokeLinejoin="round" />
                          <path
                            d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
