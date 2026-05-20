import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';

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
  created_at: string;
};

export function StaffTemplatesPage({ token }: Props) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const [templateKey, setTemplateKey] = useState('patient_registration');
  const [templateName, setTemplateName] = useState('Patient Registration');
  const [file, setFile] = useState<File | null>(null);

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
      setError('Template key, name, and PDF file are required.');
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
        <h2>Template Builder</h2>
        <p>Upload a source PDF, define fields, generate AcroForm, and publish for patient intake.</p>

        {error ? <div className="error">{error}</div> : null}

        <h3>Create New Template Version</h3>
        <div className="row">
          <div className="field">
            <label>Template Key</label>
            <input
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
              placeholder="patient_registration"
            />
          </div>
          <div className="field">
            <label>Template Name</label>
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Patient Registration" />
          </div>
          <div className="field">
            <label>Source PDF</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <button onClick={uploadTemplate} disabled={uploading}>
          {uploading ? 'Uploading...' : 'Upload and Open Editor'}
        </button>

        <h3 style={{ marginTop: 24 }}>Existing Templates</h3>
        {loading ? <p>Loading templates...</p> : null}
        {!loading && templates.length === 0 ? <p>No templates yet.</p> : null}

        {templates.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Version</th>
                <th>Status</th>
                <th>AcroForm</th>
                <th>Action</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{template.name}</strong>
                    <div style={{ fontSize: 12 }}>{template.template_key}</div>
                  </td>
                  <td>v{template.version}</td>
                  <td>
                    <span className="badge">{template.status}</span>
                  </td>
                  <td>{template.acroform_pdf_path ? 'Generated' : 'Not generated'}</td>
                  <td>
                    <Link to={`/staff/templates/${template.id}/editor`}>Open Editor</Link>
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
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
