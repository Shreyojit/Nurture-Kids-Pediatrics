import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authHeader } from '../lib/api';

type Props = { token: string | null };

type AsqTemplate = {
  id: string;
  name: string;
  template_type: string;
  version: number;
  original_file_name: string;
  created_at: string;
};

export function ASQTemplateDashboard({ token }: Props) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<AsqTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Upload new template
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('ASQ-3 48 Month');
  const [uploadType, setUploadType] = useState('ASQ_48');
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Import template
  const [importing, setImporting] = useState(false);
  const [importPdf, setImportPdf] = useState<File | null>(null);
  const [importJson, setImportJson] = useState<File | null>(null);
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
      const rows = await api<AsqTemplate[]>('/api/staff/asq', { headers: authHeader(token) });
      setTemplates(rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!token || !uploadFile || !uploadName.trim()) {
      setError('Name and PDF file are required.');
      return;
    }
    setError(''); setMsg('');
    setUploading(true);
    try {
      const body = new FormData();
      body.append('name', uploadName.trim());
      body.append('template_type', uploadType);
      body.append('version', '1');
      body.append('file', uploadFile);
      await api('/api/staff/asq/upload', { method: 'POST', headers: authHeader(token), body });
      setUploadFile(null);
      setMsg('Template uploaded successfully.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleImport() {
    if (!token || !importPdf || !importJson) {
      setError('Both a PDF file and a JSON mapping file are required.');
      return;
    }
    setError(''); setMsg('');
    setImporting(true);
    try {
      const body = new FormData();
      body.append('pdf', importPdf);
      body.append('json', importJson);
      const result = await api<{ fields_imported: number; name: string }>(
        '/api/staff/asq/import',
        { method: 'POST', headers: authHeader(token), body },
      );
      setImportPdf(null);
      setImportJson(null);
      if (importPdfRef.current) importPdfRef.current.value = '';
      if (importJsonRef.current) importJsonRef.current.value = '';
      setMsg(`Imported "${result.name}" with ${result.fields_imported} fields.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!token) return;
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/staff/asq/${id}`, { method: 'DELETE', headers: authHeader(token) });
      setMsg('Template deleted.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleExport(id: string, name: string) {
    if (!token) return;
    try {
      const response = await fetch(`/api/staff/asq/${id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]/gi, '_')}_template.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="page-shell">
      <div className="container">
        <h1 style={{ marginBottom: 4 }}>ASQ-3 Template Manager</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 28 }}>
          Upload an ASQ PDF, mark fields visually, export/import mappings.
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}
        {msg && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            {msg}
          </div>
        )}

        {/* ── Upload new ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title">Upload New PDF Template</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="field-label">Template Name</label>
              <input
                className="input"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                placeholder="e.g. ASQ-3 48 Month"
              />
            </div>
            <div>
              <label className="field-label">Type</label>
              <select className="input" value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                <option value="ASQ_48">ASQ-48 Month</option>
                <option value="ASQ_36">ASQ-36 Month</option>
                <option value="ASQ_24">ASQ-24 Month</option>
                <option value="ASQ_18">ASQ-18 Month</option>
                <option value="ASQ_12">ASQ-12 Month</option>
                <option value="ASQ_9">ASQ-9 Month</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="field-label">PDF File</label>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="input"
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleUpload}
            disabled={uploading || !uploadFile}
          >
            {uploading ? 'Uploading…' : 'Upload PDF'}
          </button>
        </div>

        {/* ── Import existing mapping ── */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="card-title">Import Template (PDF + JSON Mapping)</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Upload the original PDF and an exported JSON field mapping to skip manual field placement.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label className="field-label">ASQ PDF File</label>
              <input
                ref={importPdfRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => setImportPdf(e.target.files?.[0] ?? null)}
                className="input"
              />
            </div>
            <div>
              <label className="field-label">JSON Mapping File</label>
              <input
                ref={importJsonRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => setImportJson(e.target.files?.[0] ?? null)}
                className="input"
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={importing || !importPdf || !importJson}
          >
            {importing ? 'Importing…' : 'Import Template'}
          </button>
        </div>

        {/* ── Template list ── */}
        <div className="card">
          <h2 className="card-title">Templates ({templates.length})</h2>
          {loading && <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>}
          {!loading && templates.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No ASQ templates yet. Upload one above.</p>
          )}
          {templates.length > 0 && (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Original File</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td><span className="badge">{t.template_type}</span></td>
                    <td>v{t.version}</td>
                    <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t.original_file_name}</td>
                    <td style={{ fontSize: 13 }}>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Link
                          to={`/staff/asq/${t.id}/builder`}
                          className="btn btn-sm btn-outline"
                        >
                          Field Builder
                        </Link>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => void handleExport(t.id, t.name)}
                        >
                          Export JSON
                        </button>
                        <Link
                          to={`/staff/asq/${t.id}/fill`}
                          className="btn btn-sm btn-primary"
                        >
                          Fill Form
                        </Link>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => void handleDelete(t.id, t.name)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
