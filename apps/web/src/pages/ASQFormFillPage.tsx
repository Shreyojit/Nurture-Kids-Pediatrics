import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDocument } from 'pdfjs-dist';
import { api, authHeader } from '../lib/api';
import { ensurePdfjsWorker } from '../lib/pdfjsSetup';
import { getStaffSession } from '../lib/staffSession';

ensurePdfjsWorker();

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const CANVAS_WIDTH = 780;

type Field = {
  id: string;
  field_name: string;
  field_key: string;
  field_type: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  group_name: string | null;
  option_value: string | null;
  required: number;
};

type SubmissionValue = {
  field_id: string;
  field_key: string;
  value: string;
};

type SubmissionData = {
  id: string;
  template_id: string;
  status: string;
  communication_total: number | null;
  gross_motor_total: number | null;
  fine_motor_total: number | null;
  problem_solving_total: number | null;
  personal_social_total: number | null;
  values: SubmissionValue[];
  fields: Field[];
};

// Responses keyed by field_key (for text/checkbox) or group_name (for radio)
type Responses = Record<string, string>;

function FieldOverlay({
  field,
  ph,
  responses,
  onChange,
}: {
  field: Field;
  ph: number;
  responses: Responses;
  onChange: (key: string, value: string) => void;
}) {
  const left = `${field.x_percent}%`;
  const top = `${field.y_percent}%`;
  const width = `${field.width_percent}%`;
  const height = `${field.height_percent}%`;

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left,
    top,
    width,
    height,
    boxSizing: 'border-box',
    zIndex: 5,
  };

  if (field.field_type === 'text') {
    return (
      <input
        style={{
          ...baseStyle,
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(37,99,235,0.5)',
          borderRadius: 2,
          padding: '1px 3px',
          fontSize: Math.max(8, (field.height_percent / 100) * ph * 0.6),
          outline: 'none',
        }}
        value={responses[field.field_key] ?? ''}
        onChange={(e) => onChange(field.field_key, e.target.value)}
        title={field.field_name}
      />
    );
  }

  if (field.field_type === 'textarea') {
    return (
      <textarea
        style={{
          ...baseStyle,
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(124,58,237,0.5)',
          borderRadius: 2,
          padding: '2px 4px',
          fontSize: Math.max(8, (field.height_percent / 100) * ph * 0.15),
          resize: 'none',
          outline: 'none',
          lineHeight: 1.3,
        }}
        value={responses[field.field_key] ?? ''}
        onChange={(e) => onChange(field.field_key, e.target.value)}
        title={field.field_name}
      />
    );
  }

  if (field.field_type === 'radio' && field.group_name && field.option_value) {
    const isSelected = responses[field.group_name] === field.option_value;
    return (
      <div
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          borderRadius: '50%',
          background: isSelected ? 'rgba(0,0,0,0.85)' : 'transparent',
          border: isSelected ? '2px solid #000' : '1px solid rgba(0,0,0,0.2)',
          transition: 'background 0.1s',
        }}
        onClick={() => onChange(field.group_name!, field.option_value!)}
        title={`${field.group_name}: ${field.option_value}`}
      />
    );
  }

  if (field.field_type === 'checkbox') {
    const isChecked = responses[field.field_key] === 'checked';
    return (
      <div
        style={{
          ...baseStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: isChecked ? 'rgba(5,150,105,0.2)' : 'transparent',
          border: '1px solid rgba(5,150,105,0.5)',
          borderRadius: 2,
        }}
        onClick={() => onChange(field.field_key, isChecked ? '' : 'checked')}
        title={field.field_name}
      >
        {isChecked && (
          <svg viewBox="0 0 14 14" style={{ width: '60%', height: '60%' }}>
            <polyline points="2,7 6,11 12,3" stroke="#059669" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    );
  }

  if (field.field_type === 'signature') {
    return (
      <input
        style={{
          ...baseStyle,
          background: 'rgba(255,255,255,0.85)',
          border: '1px solid rgba(217,119,6,0.5)',
          borderRadius: 2,
          padding: '1px 4px',
          fontSize: Math.max(8, (field.height_percent / 100) * ph * 0.55),
          fontStyle: 'italic',
          outline: 'none',
        }}
        value={responses[field.field_key] ?? ''}
        onChange={(e) => onChange(field.field_key, e.target.value)}
        placeholder="Type signature"
        title={field.field_name}
      />
    );
  }

  return null;
}

export function ASQFormFillPage() {
  const { templateId, submissionId: urlSubmissionId } = useParams<{
    templateId: string;
    submissionId?: string;
  }>();
  const navigate = useNavigate();
  const token = getStaffSession()?.token ?? null;

  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [responses, setResponses] = useState<Responses>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
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
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, urlSubmissionId, token]);

  async function init() {
    if (!token || !templateId) return;
    setLoading(true);
    setError('');
    try {
      let subId = urlSubmissionId;

      // Create new submission if no ID provided
      if (!subId) {
        const created = await api<{ id: string }>(`/api/staff/asq/${templateId}/submissions`, {
          method: 'POST',
          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        subId = created.id;
        navigate(`/staff/asq/${templateId}/fill/${subId}`, { replace: true });
      }

      // Load submission + fields
      const subData = await api<SubmissionData>(`/api/asq/submissions/${subId}`);
      setSubmission(subData);
      setFields(subData.fields);

      // Restore existing values → responses
      const restored: Responses = {};
      for (const v of subData.values) {
        restored[v.field_key] = v.value;
      }
      setResponses(restored);

      // Load PDF
      const pdfUrl = `${API_BASE}/api/staff/asq/${templateId}/pdf`;
      const pdfResp = await fetch(pdfUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const buf = await pdfResp.arrayBuffer();
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
      // Cancel any in-progress render for this page (prevents StrictMode double-render corruption)
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
      } catch {
        // RenderingCancelledException on cleanup — expected, not an error
      }
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

  async function saveResponses() {
    if (!submission) return;
    setSaving(true);
    setError('');
    try {
      // Build values array — for radio use group_name as field_key; otherwise field_key
      const fieldMap = new Map(fields.map((f) => [f.id, f]));
      const valuesList = Object.entries(responses)
        .filter(([, v]) => v !== '')
        .map(([fieldKey, value]) => {
          // Find a matching field by field_key or group_name
          const matchField = fields.find(
            (f) =>
              (f.field_type === 'radio' && f.group_name === fieldKey) ||
              (f.field_type !== 'radio' && f.field_key === fieldKey),
          );
          return {
            field_id: matchField?.id ?? '',
            field_key: fieldKey,
            value,
          };
        });

      const result = await api<{ scores: Record<string, number> }>(
        `/api/asq/submissions/${submission.id}/values`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: valuesList }),
        },
      );

      setSubmission((prev) => prev ? { ...prev, ...result } : prev);
      void fieldMap; // suppress unused warning
      navigate(`/staff/asq/submissions/${submission.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function generatePdf() {
    if (!submission) return;
    setGeneratingPdf(true);
    setError('');
    try {
      const result = await api<{ download_url: string }>(
        `/api/asq/submissions/${submission.id}/generate-pdf`,
        { method: 'POST' },
      );
      setDownloadUrl(result.download_url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="container">
          <p>Loading form…</p>
        </div>
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="page-shell">
        <div className="container">
          {error && <div className="alert alert-error">{error}</div>}
          <p>Submission not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)' }}>
      {/* ── Header bar ── */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid var(--color-border)',
          padding: '10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15 }}>ASQ-3 Form</span>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          {fields.length} fields · {numPages} pages
        </span>
        <span style={{ flex: 1 }} />
        {error && <span style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</span>}
        {downloadUrl && (
          <a href={downloadUrl} className="btn btn-sm btn-outline" target="_blank" rel="noreferrer">
            Download Filled PDF
          </a>
        )}
        <button
          className="btn btn-sm btn-outline"
          onClick={() => void generatePdf()}
          disabled={generatingPdf}
        >
          {generatingPdf ? 'Generating…' : 'Generate PDF'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void saveResponses()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save & Score'}
        </button>
      </div>

      {/* ── PDF + overlays ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#525659', padding: '16px 0' }}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          const ph = pageHeights[pageNum] ?? Math.round(CANVAS_WIDTH * 1.294);
          const pageFields = fields.filter((f) => f.page_number === pageNum);

          return (
            <div key={pageNum} style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: CANVAS_WIDTH,
                  minHeight: ph,
                  background: '#fff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
                }}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(pageNum, el);
                    else canvasRefs.current.delete(pageNum);
                  }}
                  style={{ display: 'block', width: CANVAS_WIDTH, height: ph || 'auto' }}
                />
                {/* Field overlays — only after page has rendered so ph is the real height */}
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
