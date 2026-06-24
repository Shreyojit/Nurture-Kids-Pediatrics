import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDocument } from 'pdfjs-dist';
import { api, authHeader } from '../lib/api';
import { ensurePdfjsWorker } from '../lib/pdfjsSetup';
import { getStaffSession } from '../lib/staffSession';

ensurePdfjsWorker();

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const CANVAS_WIDTH = 780;

type MarkerField = {
  id: string;
  field_id: string;
  field_name: string;
  field_label: string | null;
  field_type: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  required: number;
  radio_group: string | null;
  radio_value: string | null;
  placeholder: string | null;
  default_value: string | null;
  font_size: number | null;
};

type Template = {
  id: string;
  name: string;
  template_key: string;
  page_count: number | null;
  fields: MarkerField[];
};

type Responses = Record<string, string>;

// ── Field overlay components ─────────────────────────────────────────────────

function FieldOverlay({
  field, ph, responses, onChange,
}: {
  field: MarkerField;
  ph: number;
  responses: Responses;
  onChange: (key: string, value: string) => void;
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${field.x_percent}%`,
    top: `${field.y_percent}%`,
    width: `${field.width_percent}%`,
    height: `${field.height_percent}%`,
    boxSizing: 'border-box',
    zIndex: 5,
  };

  const fsize = Math.max(8, Math.min(field.font_size ?? 10, (field.height_percent / 100) * ph * 0.65));

  if (field.field_type === 'text') {
    const key = field.field_id;
    return (
      <input
        style={{
          ...style,
          background: 'rgba(255,255,255,0.92)',
          border: '1.5px solid rgba(37,99,235,0.55)',
          borderRadius: 2,
          padding: '1px 3px',
          fontSize: fsize,
          outline: 'none',
        }}
        type="text"
        value={responses[key] ?? ''}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={field.placeholder ?? field.field_label ?? field.field_name}
        title={field.field_label ?? field.field_name}
      />
    );
  }

  if (field.field_type === 'date') {
    const key = field.field_id;
    return (
      <input
        style={{
          ...style,
          background: 'rgba(255,255,255,0.92)',
          border: '1.5px solid rgba(8,145,178,0.55)',
          borderRadius: 2,
          padding: '1px 3px',
          fontSize: fsize,
          outline: 'none',
        }}
        type="text"
        value={responses[key] ?? ''}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={field.placeholder ?? 'MM/DD/YYYY'}
        title={field.field_label ?? field.field_name}
      />
    );
  }

  if (field.field_type === 'textarea') {
    const key = field.field_id;
    return (
      <textarea
        style={{
          ...style,
          background: 'rgba(255,255,255,0.92)',
          border: '1.5px solid rgba(124,58,237,0.55)',
          borderRadius: 2,
          padding: '2px 4px',
          fontSize: Math.max(7, fsize * 0.8),
          resize: 'none',
          outline: 'none',
          lineHeight: 1.3,
        }}
        value={responses[key] ?? ''}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={field.placeholder ?? field.field_label ?? field.field_name}
        title={field.field_label ?? field.field_name}
      />
    );
  }

  if (field.field_type === 'signature') {
    const key = field.field_id;
    return (
      <input
        style={{
          ...style,
          background: 'rgba(255,255,255,0.92)',
          border: '1.5px solid rgba(217,119,6,0.55)',
          borderRadius: 2,
          padding: '1px 4px',
          fontSize: fsize,
          fontStyle: 'italic',
          outline: 'none',
        }}
        type="text"
        value={responses[key] ?? ''}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={field.placeholder ?? 'Type signature'}
        title="Signature"
      />
    );
  }

  if (field.field_type === 'checkbox') {
    const key = field.field_id;
    const checked = responses[key] === 'checked';
    return (
      <div
        style={{
          ...style,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          background: checked ? 'rgba(5,150,105,0.15)' : 'rgba(255,255,255,0.7)',
          border: `1.5px solid rgba(5,150,105,${checked ? '0.7' : '0.4'})`,
          borderRadius: 2,
        }}
        onClick={() => onChange(key, checked ? '' : 'checked')}
        title={field.field_label ?? field.field_name}
      >
        {checked && (
          <svg viewBox="0 0 14 14" style={{ width: '65%', height: '65%' }}>
            <polyline
              points="2,7 6,11 12,3"
              stroke="#059669" strokeWidth="2.5" fill="none"
              strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    );
  }

  if (field.field_type === 'radio' && field.radio_group && field.radio_value) {
    const selected = responses[field.radio_group] === field.radio_value;
    return (
      <div
        style={{
          ...style,
          cursor: 'pointer',
          borderRadius: '50%',
          background: selected ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.7)',
          border: `1.5px solid ${selected ? '#000' : 'rgba(0,0,0,0.25)'}`,
          transition: 'background 0.1s',
        }}
        onClick={() => onChange(field.radio_group!, field.radio_value!)}
        title={`${field.radio_group}: ${field.radio_value}`}
      />
    );
  }

  return null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PdfMarkerFillPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = getStaffSession()?.token ?? null;

  const [template, setTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<MarkerField[]>([]);
  const [responses, setResponses] = useState<Responses>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTasksRef = useRef<Map<number, any>>(new Map());

  useEffect(() => {
    if (!token) { navigate('/staff/login'); return; }
    if (!id) return;
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function init() {
    if (!token || !id) return;
    setLoading(true);
    setError('');
    try {
      const tpl = await api<Template>(`/api/staff/pdf-marker/${id}`, { headers: authHeader(token) });
      setTemplate(tpl);
      setFields(tpl.fields);

      // Pre-fill defaults
      const defaults: Responses = {};
      for (const f of tpl.fields) {
        if (f.default_value) {
          const key = f.field_type === 'radio' ? (f.radio_group ?? f.field_id) : f.field_id;
          defaults[key] = f.default_value;
        }
      }
      setResponses(defaults);

      // Fetch PDF
      const resp = await fetch(`${API_BASE}/api/staff/pdf-marker/${id}/source`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Failed to load PDF');
      const buf = await resp.arrayBuffer();
      const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const renderPage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (doc: any, pageNum: number, canvas: HTMLCanvasElement) => {
      renderTasksRef.current.get(pageNum)?.cancel();
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: CANVAS_WIDTH / page.getViewport({ scale: 1 }).width });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const task = page.render({ canvasContext: ctx, viewport });
      renderTasksRef.current.set(pageNum, task);
      try {
        await task.promise;
        renderTasksRef.current.delete(pageNum);
        setPageHeights((prev) => ({ ...prev, [pageNum]: Math.round(viewport.height) }));
      } catch { /* cancelled */ }
    },
    [],
  );

  useEffect(() => {
    if (!pdfDoc) return;
    for (let p = 1; p <= numPages; p++) {
      const canvas = canvasRefs.current.get(p);
      if (canvas) void renderPage(pdfDoc, p, canvas);
    }
    return () => {
      renderTasksRef.current.forEach((t) => t.cancel());
      renderTasksRef.current.clear();
    };
  }, [pdfDoc, numPages, renderPage]);

  function setResponse(key: string, value: string) {
    setResponses((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    if (!window.confirm('Clear all filled values?')) return;
    setResponses({});
    setDownloadUrl('');
  }

  async function generatePdf(forDownload = false) {
    if (!token || !id) return;
    setGenerating(true);
    setError('');
    try {
      const url = `${API_BASE}/api/staff/pdf-marker/${id}/generate-filled${forDownload ? '?download=1' : ''}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || 'PDF generation failed');
      }
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      setDownloadUrl(objectUrl);

      if (forDownload) {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `filled_${template?.template_key ?? 'form'}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(objectUrl, '_blank');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // Validate required fields
  const missingRequired = fields.filter((f) => {
    if (!f.required) return false;
    const key = f.field_type === 'radio' ? (f.radio_group ?? f.field_id) : f.field_id;
    return !responses[key];
  });

  if (loading) {
    return <div className="page-shell"><div className="container"><p>Loading form…</p></div></div>;
  }

  if (!template) {
    return (
      <div className="page-shell">
        <div className="container">
          {error && <div className="alert alert-error">{error}</div>}
          <p>Template not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)' }}>

      {/* ── Header ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => navigate(`/staff/pdf-builder/${id}/builder`)}
        >
          ← Builder
        </button>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-nav)' }}>
          Fill: {template.name}
        </span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {fields.length} field{fields.length !== 1 ? 's' : ''}
        </span>

        {missingRequired.length > 0 && (
          <span style={{ fontSize: 12, color: '#b45309', background: '#fef3c7', padding: '2px 8px', borderRadius: 20 }}>
            {missingRequired.length} required field{missingRequired.length > 1 ? 's' : ''} unfilled
          </span>
        )}

        <span style={{ flex: 1 }} />
        {error && <span style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</span>}

        {downloadUrl && (
          <a href={downloadUrl} download={`filled_${template.template_key}.pdf`} className="btn btn-sm btn-outline">
            Save PDF
          </a>
        )}
        <button className="btn btn-sm btn-outline" onClick={clearAll}>Clear</button>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => void generatePdf(false)}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Preview PDF'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void generatePdf(true)}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Download Filled PDF'}
        </button>
      </div>

      {/* ── PDF canvas + overlays ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#525659', padding: '16px 0' }}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          const ph = pageHeights[pageNum] ?? Math.round(CANVAS_WIDTH * 1.294);
          const pageFields = fields.filter((f) => f.page_number === pageNum);

          return (
            <div key={pageNum} style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                position: 'relative', width: CANVAS_WIDTH, minHeight: ph,
                background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.25)',
              }}>
                <canvas
                  ref={(el) => { if (el) canvasRefs.current.set(pageNum, el); else canvasRefs.current.delete(pageNum); }}
                  style={{ display: 'block', width: CANVAS_WIDTH, height: ph || 'auto' }}
                />
                {pageHeights[pageNum] != null && pageFields.map((f) => (
                  <FieldOverlay
                    key={f.id}
                    field={f}
                    ph={ph}
                    responses={responses}
                    onChange={setResponse}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
