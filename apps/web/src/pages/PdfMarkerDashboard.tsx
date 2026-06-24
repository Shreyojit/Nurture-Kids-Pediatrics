import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import { getStaffSession } from '../lib/staffSession';

type MarkerTemplate = {
  id: string;
  name: string;
  template_key: string;
  status: string;
  page_count: number | null;
  field_count: number;
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#d97706',
  published: '#059669',
  archived: '#6b7280',
};

export function PdfMarkerDashboard() {
  const navigate = useNavigate();
  const token = getStaffSession()?.token ?? null;

  const [templates, setTemplates] = useState<MarkerTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Upload form state
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Import form state
  const [showImport, setShowImport] = useState(false);
  const [importPdf, setImportPdf] = useState<File | null>(null);
  const [importJson, setImportJson] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const importPdfRef = useRef<HTMLInputElement>(null);
  const importJsonRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) { navigate('/staff/login'); return; }
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const rows = await api<MarkerTemplate[]>('/api/staff/pdf-marker', {
        headers: authHeader(token),
      });
      setTemplates(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !uploadFile || !uploadName.trim()) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('pdf', uploadFile);
      body.append('name', uploadName.trim());
      body.append('template_key', uploadName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
      const tpl = await api<{ id: string }>('/api/staff/pdf-marker/upload', {
        method: 'POST',
        headers: authHeader(token),
        body,
      });
      navigate(`/staff/pdf-builder/${tpl.id}/builder`);
    } catch (e) {
      setError((e as Error).message);
      setUploading(false);
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !importPdf || !importJson) return;
    setImporting(true);
    setError('');
    try {
      const body = new FormData();
      body.append('pdf', importPdf);
      body.append('json', importJson);
      const tpl = await api<{ id: string }>('/api/staff/pdf-marker/import', {
        method: 'POST',
        headers: authHeader(token),
        body,
      });
      navigate(`/staff/pdf-builder/${tpl.id}/builder`);
    } catch (e) {
      setError((e as Error).message);
      setImporting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!token) return;
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await api(`/api/staff/pdf-marker/${id}`, { method: 'DELETE', headers: authHeader(token) });
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const handleExport = (id: string, key: string) => {
    const a = document.createElement('a');
    a.href = `/api/staff/pdf-marker/${id}/export`;
    a.download = `${key}_fields.json`;
    a.click();
  };

  return (
    <div className="page-shell">
      <div className="container" style={{ maxWidth: 960, padding: '28px 20px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--color-nav)' }}>
              PDF Form Builder
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
              Upload any PDF, mark fillable fields visually, assign to patients
            </p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => { setShowImport(!showImport); setShowUpload(false); }}
            >
              Import Template
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setShowUpload(!showUpload); setShowImport(false); }}
            >
              + Upload PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>
        )}

        {/* ── Upload panel ── */}
        {showUpload && (
          <div style={{
            background: '#f0f7ff', border: '1px solid #bfdbfe',
            borderRadius: 8, padding: 20, marginBottom: 24,
          }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}>Upload New PDF Form</h3>
            <form onSubmit={(e) => void handleUpload(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Template Name
                </label>
                <input
                  className="input"
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="e.g. EPDS Screening, TB Risk Form"
                  required
                  style={{ width: '100%', maxWidth: 380 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  PDF File
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  required
                  style={{ fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={uploading || !uploadFile || !uploadName.trim()}>
                  {uploading ? 'Uploading…' : 'Upload & Open Builder'}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowUpload(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Import panel ── */}
        {showImport && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac',
            borderRadius: 8, padding: 20, marginBottom: 24,
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Import Template from JSON</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Import a previously exported PDF + JSON field mapping.
            </p>
            <form onSubmit={(e) => void handleImport(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>PDF File</label>
                <input
                  ref={importPdfRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setImportPdf(e.target.files?.[0] ?? null)}
                  required
                  style={{ fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 4 }}>JSON Fields File</label>
                <input
                  ref={importJsonRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => setImportJson(e.target.files?.[0] ?? null)}
                  required
                  style={{ fontSize: 13 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={importing || !importPdf || !importJson}>
                  {importing ? 'Importing…' : 'Import & Open Builder'}
                </button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowImport(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Template list ── */}
        {loading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading templates…</p>
        ) : templates.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px',
            border: '2px dashed var(--color-border)', borderRadius: 12,
            color: 'var(--color-text-muted)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>No PDF templates yet</p>
            <p style={{ fontSize: 14, margin: 0 }}>Upload a PDF to create your first fillable form.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {templates.map((tpl) => (
              <div key={tpl.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <div style={{ padding: '16px 20px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-nav)', lineHeight: 1.3 }}>
                      {tpl.name}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      color: STATUS_COLORS[tpl.status] ?? '#6b7280',
                      background: STATUS_COLORS[tpl.status] ? `${STATUS_COLORS[tpl.status]}18` : '#f3f4f6',
                      padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
                    }}>
                      {tpl.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', gap: 12 }}>
                    <span>{tpl.field_count} field{tpl.field_count !== 1 ? 's' : ''}</span>
                    {tpl.page_count && <span>{tpl.page_count} page{tpl.page_count !== 1 ? 's' : ''}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    Key: <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>{tpl.template_key}</code>
                  </div>
                </div>
                <div style={{
                  borderTop: '1px solid var(--color-border)',
                  padding: '10px 16px',
                  display: 'flex', gap: 6, flexWrap: 'wrap',
                }}>
                  <Link
                    to={`/staff/pdf-builder/${tpl.id}/builder`}
                    className="btn btn-sm btn-primary"
                  >
                    Open Builder
                  </Link>
                  <Link
                    to={`/staff/pdf-builder/${tpl.id}/fill`}
                    className="btn btn-sm btn-outline"
                  >
                    Fill Form
                  </Link>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => handleExport(tpl.id, tpl.template_key)}
                    title="Export field mapping as JSON"
                  >
                    Export JSON
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => void handleDelete(tpl.id, tpl.name)}
                    title="Delete template"
                    style={{ marginLeft: 'auto' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Info box ── */}
        {templates.length > 0 && (
          <div style={{
            marginTop: 32, padding: 16, background: '#f8fafc',
            border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 13,
            color: 'var(--color-text-muted)',
          }}>
            <strong style={{ color: 'var(--color-text)' }}>How it works:</strong> Open Builder to place interactive markers on your PDF.
            Once markers are placed, use Fill Form to fill in values and download the completed PDF.
            Export JSON to share or back up your field mapping.
          </div>
        )}
      </div>
    </div>
  );
}
