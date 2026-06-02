import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnnotationMode, getDocument } from 'pdfjs-dist';
import { PdfOverlayFillView } from '../components/PdfOverlayFillView';
import { api } from '../lib/api';
import { ensurePdfjsWorker } from '../lib/pdfjsSetup';
import { getLocal, removeLocal, setLocal } from '../lib/storage';
import { getPatientSession } from '../lib/patientSession';
import type { FormTemplate, TemplateField } from '../lib/types';

ensurePdfjsWorker();

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

// Must match PdfFieldMapper's targetWidth so coordinates line up exactly
const TARGET_WIDTH = 760;

// ─── Per-page canvas component ───────────────────────────────────────────────
// Each page owns its canvas ref and render lifecycle.
// `scale` is passed from the parent (computed once from page 1) to stay in sync
// with how PdfFieldMapper stored the field coordinates.

type PageCanvasProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDoc: any;
  pageIndex: number;
  scale: number;
  fields: TemplateField[];
  allFields: TemplateField[];
  responses: Record<string, unknown>;
  setResponse: (id: string, value: unknown) => void;
  boxInputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
};

function PageCanvas({
  pdfDoc,
  pageIndex,
  scale,
  fields,
  allFields,
  responses,
  setResponse,
  boxInputRefs,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageH, setPageH] = useState<number>(0);

  useEffect(() => {
    if (!scale) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderTask: any = null;

    async function render() {
      const page = await pdfDoc.getPage(pageIndex + 1);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });

      // Use Math.round for both pixel buffer and CSS height so they match exactly.
      // (Assigning a float to canvas.width/height truncates; rounding avoids
      // the 1-pixel drift between the rendered content and the CSS overlay.)
      const w = Math.round(viewport.width);
      const h = Math.round(viewport.height);

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx || cancelled) return;

      // DISABLE annotations so pdfjs doesn't draw its own radio/checkbox circles —
      // our CSS overlays are the sole visual. Cancel the task on cleanup to avoid
      // the "same canvas during multiple render()" error in React StrictMode.
      renderTask = page.render({ canvasContext: ctx, viewport, annotationMode: AnnotationMode.DISABLE });
      try {
        await renderTask.promise;
        if (!cancelled) setPageH(h);
      } catch {
        // RenderingCancelledException on cleanup — expected, not an error
      }
    }

    render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageIndex, scale]);

  return (
    <div
      style={{
        position: 'relative',
        // Hold the layout height even before the canvas is ready
        width: TARGET_WIDTH,
        minHeight: pageH || TARGET_WIDTH * 1.294, // ~letter ratio placeholder
        marginBottom: 24,
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        background: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* Explicit CSS w/h prevents the browser from stretching the canvas */}
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: TARGET_WIDTH, height: pageH || 'auto' }}
      />
      {pageH > 0 &&
        fields.map((field) =>
          renderField(field, pageH, scale, responses, setResponse, allFields, boxInputRefs),
        )}
    </div>
  );
}

// ─── Field overlay renderer ───────────────────────────────────────────────────

function renderField(
  field: TemplateField,
  pageH: number,
  scale: number,
  responses: Record<string, unknown>,
  setResponse: (id: string, value: unknown) => void,
  allFields: TemplateField[],
  boxInputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>,
): React.ReactNode {
  // Convert PDF coordinates (origin bottom-left) to CSS (origin top-left)
  const cssLeft = (field.x ?? 0) * scale;
  const cssTop = pageH - ((field.y ?? 0) + (field.height ?? 18)) * scale;
  const cssW = (field.width ?? 120) * scale;
  const cssH = (field.height ?? 18) * scale;
  const fontSize = (field.font_size ?? 12) * scale;

  // Shared style that exactly fits the PDF field rectangle.
  // `appearance: none` removes browser-enforced minimum sizes on inputs.
  const base: CSSProperties = {
    position: 'absolute',
    left: cssLeft,
    top: cssTop,
    width: cssW,
    height: cssH,
    fontSize,
    lineHeight: `${cssH}px`,
    fontFamily: 'Helvetica, Arial, sans-serif',
    padding: 0,
    margin: 0,
    border: '1px solid #9ca3af',
    borderRadius: 0,
    background: 'rgba(243,244,246,0.6)',
    boxSizing: 'border-box',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  };

  const val = responses[field.field_id];
  const strVal = val == null ? '' : String(val);

  switch (field.input_type) {
    case 'checkbox': {
      const isChecked = Boolean(val);
      const size = Math.min(cssW, cssH);
      const dotSize = Math.round(size * 0.6);
      return (
        <div
          key={field.field_id}
          onClick={() => setResponse(field.field_id, !isChecked)}
          style={{
            position: 'absolute',
            left: cssLeft + (cssW - size) / 2,
            top: cssTop + (cssH - size) / 2,
            width: size,
            height: size,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #555',
            boxSizing: 'border-box',
            background: '#fff',
          }}
        >
          {isChecked && (
            <div
              style={{
                width: dotSize,
                height: dotSize,
                background: '#1a1a1a',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      );
    }

    case 'radio_option': {
      const isChecked =
        responses[`__group_${field.group_id}`] === (field.group_value ?? field.field_id);
      const dotSize = Math.round(Math.min(cssW, cssH) * 0.55);
      return (
        <div
          key={field.field_id}
          role="radio"
          aria-checked={isChecked}
          onClick={() =>
            setResponse(`__group_${field.group_id!}`, field.group_value ?? field.field_id)
          }
          style={{
            position: 'absolute',
            left: cssLeft,
            top: cssTop,
            width: cssW,
            height: cssH,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isChecked ? 'rgba(26,26,26,0.08)' : 'transparent',
            borderRadius: '50%',
            border: isChecked ? '1.5px solid #1a1a1a' : '1.5px solid rgba(0,0,0,0.35)',
            boxSizing: 'border-box',
          }}
        >
          {isChecked && (
            <div
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: '50%',
                background: '#1a1a1a',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      );
    }

    case 'select':
      return (
        <select
          key={field.field_id}
          value={strVal}
          onChange={(e) => setResponse(field.field_id, e.target.value)}
          style={{ ...base, cursor: 'pointer' }}
        >
          <option value=""></option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );

    case 'textarea':
      return (
        <textarea
          key={field.field_id}
          value={strVal}
          onChange={(e) => setResponse(field.field_id, e.target.value)}
          style={{ ...base, lineHeight: 1.3, overflow: 'hidden', resize: 'none' }}
        />
      );

    case 'date':
      return (
        <input
          key={field.field_id}
          type="date"
          value={strVal}
          onChange={(e) => setResponse(field.field_id, e.target.value)}
          style={base}
        />
      );

    case 'box_char': {
      const siblings = allFields
        .filter(
          (f) =>
            f.input_type === 'box_char' &&
            f.group_id === field.group_id &&
            (f.page_number ?? 1) === (field.page_number ?? 1),
        )
        .sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
      const myIndex = siblings.findIndex((f) => f.field_id === field.field_id);

      return (
        <input
          key={field.field_id}
          type="text"
          maxLength={1}
          value={strVal}
          ref={(el) => {
            if (el) boxInputRefs.current.set(field.field_id, el);
            else boxInputRefs.current.delete(field.field_id);
          }}
          onChange={(e) => {
            const ch = e.target.value.slice(-1);
            setResponse(field.field_id, ch);
            if (ch && myIndex < siblings.length - 1) {
              boxInputRefs.current.get(siblings[myIndex + 1].field_id)?.focus();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !strVal && myIndex > 0) {
              boxInputRefs.current.get(siblings[myIndex - 1].field_id)?.focus();
            }
          }}
          style={{ ...base, textAlign: 'center', padding: 0 }}
        />
      );
    }

    default:
      // text, signature
      return (
        <input
          key={field.field_id}
          type="text"
          value={strVal}
          onChange={(e) => setResponse(field.field_id, e.target.value)}
          style={base}
        />
      );
  }
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PdfFillPage() {
  const { slug = 'nurturekidspediatrics', sessionId = '' } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  // Scale computed once from page 1 — same as PdfFieldMapper
  const [scale, setScale] = useState(0);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [loadingPdf, setLoadingPdf] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const boxInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Autosave every 30 seconds
  useEffect(() => {
    if (!sessionId) return;
    const timer = setInterval(() => {
      api(`/api/submissions/${sessionId}/autosave`, {
        method: 'PATCH',
        body: JSON.stringify({ responses }),
      }).catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [sessionId, responses]);

  // Fetch template with position data
  useEffect(() => {
    api<FormTemplate>(`/api/submissions/${sessionId}/template`)
      .then((t) => {
        setTemplate(t);
        const existing = t.responses ?? {};
        const normalized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(existing)) {
          if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
            normalized[k] = (v as { value: unknown }).value;
          } else {
            normalized[k] = v;
          }
        }
        setResponses(normalized);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingTemplate(false));
  }, [sessionId]);

  // Load source PDF and compute scale once from page 1
  useEffect(() => {
    async function loadPdf() {
      try {
        const response = await fetch(`${API_BASE}/api/submissions/${sessionId}/source-pdf`);
        if (!response.ok) throw new Error('Source PDF not available for this form.');
        const bytes = await response.arrayBuffer();
        const task = getDocument({ data: bytes });
        const doc = await task.promise;

        // Compute scale from page 1 — exactly what PdfFieldMapper does
        const page1 = await doc.getPage(1);
        const vp1 = page1.getViewport({ scale: 1 });
        setScale(TARGET_WIDTH / vp1.width);

        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingPdf(false);
      }
    }
    loadPdf();
  }, [sessionId]);

  const allFields = template?.steps.flatMap((s) => s.fields) ?? [];

  function setResponse(fieldId: string, value: unknown) {
    setResponses((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit() {
    if (!template) return;
    setSubmitting(true);
    setError('');
    try {
      await api(`/api/submissions/${sessionId}/autosave`, {
        method: 'PATCH',
        body: JSON.stringify({ responses }),
      });
      const completed = await api<{ confirmation_code: string; status: string }>(
        `/api/submissions/${sessionId}/complete`,
        { method: 'POST' },
      );
      const start = getLocal<Record<string, unknown>>(`pediform_start_${sessionId}`, {});
      setLocal(`pediform_start_${sessionId}`, {
        ...start,
        confirmation_code: completed.confirmation_code,
        completed: true,
      });
      if (getPatientSession()) {
        navigate('/parent/dashboard');
        return;
      }
      const portalAssignments = getLocal<Array<{ session_id: string; status: string; practice_slug: string }>>('pediform_portal_assignments', []);
      const nextForm = portalAssignments.find(
        (a) => a.session_id !== sessionId && a.status !== 'completed',
      );
      if (nextForm) {
        navigate(`/p/${nextForm.practice_slug}/session/${nextForm.session_id}/overview`);
      } else {
        const allDone = portalAssignments.length > 0;
        if (allDone) removeLocal('pediform_portal_assignments');
        navigate(`/p/${slug}/session/${sessionId}/confirmation`, { state: { allPortalFormsDone: allDone } });
      }
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const isMchatForm = template?.form_id === 'mchat' || /^mchat/i.test(template?.form_id ?? '');
  const overlaySchema =
    isMchatForm && template?.field_schema && template.field_schema.fields.length > 0
      ? template.field_schema
      : null;

  const loading = loadingTemplate || (overlaySchema ? false : loadingPdf);

  if (loading) {
    return (
      <div className="card mobile">
        <p>Loading PDF form...</p>
      </div>
    );
  }

  if (!template || (!overlaySchema && (!pdfDoc || !scale))) {
    return (
      <div className="card mobile">
        <div className="error">{error || 'No PDF form is available for this submission.'}</div>
        <p style={{ marginTop: 12 }}>
          <button onClick={() => navigate(-1)} style={{ background: '#6b7280' }}>
            Go back
          </button>
        </p>
      </div>
    );
  }

  if (overlaySchema) {
    return (
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>
          <h2 style={{ marginBottom: 4 }}>{template.title}</h2>
          <p style={{ marginTop: 0, marginBottom: 20, color: '#555' }}>
            Fill fields directly on the PDF below, then click Submit.
          </p>
          <PdfOverlayFillView
            sessionId={sessionId}
            schema={overlaySchema}
            responses={responses}
            onResponseChange={setResponses}
          />
          {error ? <div className="error" style={{ marginBottom: 12 }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, marginBottom: 32 }}>
            <button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Form'}
            </button>
            <button
              onClick={() => navigate(`/p/${slug}/session/${sessionId}/overview`)}
              disabled={submitting}
              style={{ background: '#6b7280' }}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
    <div style={{ maxWidth: TARGET_WIDTH + 40, margin: '0 auto', padding: '20px 16px', minWidth: TARGET_WIDTH + 40 }}>
      <h2 style={{ marginBottom: 4 }}>{template.title}</h2>
      <p style={{ marginTop: 0, marginBottom: 20, color: '#555' }}>
        Fill in the highlighted fields directly on the form below, then click Submit.
      </p>

      {Array.from({ length: numPages }, (_, i) => (
        <PageCanvas
          key={i}
          pdfDoc={pdfDoc}
          pageIndex={i}
          scale={scale}
          fields={allFields.filter((f) => (f.page_number ?? 1) === i + 1)}
          allFields={allFields}
          responses={responses}
          setResponse={setResponse}
          boxInputRefs={boxInputRefs}
        />
      ))}

      {error ? (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, marginTop: 8, marginBottom: 32 }}>
        <button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Form'}
        </button>
        <button
          onClick={() => navigate(`/p/${slug}/session/${sessionId}/overview`)}
          disabled={submitting}
          style={{ background: '#6b7280' }}
        >
          Back
        </button>
      </div>
    </div>
    </div>
  );
}
