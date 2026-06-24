import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Rnd } from 'react-rnd';
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
  display_order: number;
};

type Template = {
  id: string;
  name: string;
  template_key: string;
  status: string;
  page_count: number | null;
  fields: MarkerField[];
};

const FIELD_TYPE_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  text:      { label: 'Text',      color: '#1d4ed8', bg: 'rgba(219,234,254,0.85)', border: '#2563eb' },
  textarea:  { label: 'Textarea',  color: '#6d28d9', bg: 'rgba(237,233,254,0.85)', border: '#7c3aed' },
  checkbox:  { label: 'Checkbox',  color: '#065f46', bg: 'rgba(209,250,229,0.85)', border: '#059669' },
  radio:     { label: 'Radio',     color: '#991b1b', bg: 'rgba(254,226,226,0.85)', border: '#dc2626' },
  date:      { label: 'Date',      color: '#0e7490', bg: 'rgba(207,250,254,0.85)', border: '#0891b2' },
  signature: { label: 'Signature', color: '#92400e', bg: 'rgba(254,243,199,0.85)', border: '#d97706' },
};

// Convert px position inside a canvas container to % coords
function toPercent(px: number, total: number): number {
  return Math.max(0, Math.min(100, (px / total) * 100));
}

export function PdfMarkerBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = getStaffSession()?.token ?? null;

  const [template, setTemplate] = useState<Template | null>(null);
  const [fields, setFields] = useState<MarkerField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // PDF rendering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTasksRef = useRef<Map<number, any>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Placing mode: when non-null, clicking the PDF places a field of this type
  const [placingType, setPlacingType] = useState<string | null>(null);

  // Radio group quick-add panel
  const [showRadioPanel, setShowRadioPanel] = useState(false);
  const [radioGroup, setRadioGroup] = useState('');
  const [radioOptions, setRadioOptions] = useState(['yes', 'sometimes', 'not_yet']);

  // Edit panel for selected field
  const [editLabel, setEditLabel] = useState('');
  const [editFontSize, setEditFontSize] = useState(10);
  const [editRequired, setEditRequired] = useState(false);
  const [editPlaceholder, setEditPlaceholder] = useState('');

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  // ── Load template + PDF ──────────────────────────────────────────────────

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

      // Fetch source PDF via authenticated request
      const resp = await fetch(`${API_BASE}/api/staff/pdf-marker/${id}/source`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Failed to fetch PDF');
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

  // ── PDF rendering with StrictMode cancel-guard ──────────────────────────

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
      } catch { /* RenderingCancelledException — expected */ }
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

  // ── Select field → populate edit panel ──────────────────────────────────

  useEffect(() => {
    if (selectedField) {
      setEditLabel(selectedField.field_label ?? '');
      setEditFontSize(selectedField.font_size ?? 10);
      setEditRequired(Boolean(selectedField.required));
      setEditPlaceholder(selectedField.placeholder ?? '');
    }
  }, [selectedField]);

  // ── Get page number currently most visible on screen ─────────────────────

  function getVisiblePage(): number {
    if (!containerRef.current) return 1;
    let best = 1;
    let bestVisible = 0;
    containerRef.current.querySelectorAll<HTMLElement>('[data-page]').forEach((el) => {
      const rect = el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top));
      if (visible > bestVisible) { bestVisible = visible; best = Number(el.dataset.page); }
    });
    return best;
  }

  // ── Handle PDF canvas click → place field ────────────────────────────────

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>, pageNum: number) {
    if (!placingType || placingType === 'radio') return;
    const ph = pageHeights[pageNum];
    if (!ph) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const xPct = toPercent(clickX, CANVAS_WIDTH);
    const yPct = toPercent(clickY, ph);

    const defaultW = placingType === 'textarea' ? 30 : placingType === 'checkbox' ? 3 : placingType === 'signature' ? 25 : 20;
    const defaultH = placingType === 'textarea' ? 10 : placingType === 'checkbox' ? 3 : 4;

    void addField({
      field_name: `${placingType}_${Date.now()}`,
      field_type: placingType,
      page_number: pageNum,
      x_percent: Math.max(0, xPct - defaultW / 2),
      y_percent: Math.max(0, yPct - defaultH / 2),
      width_percent: defaultW,
      height_percent: defaultH,
    });

    setPlacingType(null);
  }

  // ── Add field via API ─────────────────────────────────────────────────────

  async function addField(data: Partial<MarkerField>) {
    if (!token || !id) return;
    try {
      const newField = await api<MarkerField>(`/api/staff/pdf-marker/${id}/fields`, {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setFields((prev) => [...prev, newField]);
      setSelectedId(newField.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Add radio group ───────────────────────────────────────────────────────

  async function addRadioGroup() {
    if (!token || !id || !radioGroup.trim() || radioOptions.filter(Boolean).length === 0) return;
    const pageNum = getVisiblePage();
    const ph = pageHeights[pageNum] ?? CANVAS_WIDTH * 1.294;
    const optionH = 3;
    const optionW = 5;
    const startY = 20;
    const gap = 5;

    const validOptions = radioOptions.filter((o) => o.trim());
    setSaving(true);
    setError('');
    try {
      const created: MarkerField[] = [];
      for (let i = 0; i < validOptions.length; i++) {
        const f = await api<MarkerField>(`/api/staff/pdf-marker/${id}/fields`, {
          method: 'POST',
          headers: { ...authHeader(token!), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_name: `${radioGroup.trim()}_${validOptions[i]}`,
            field_type: 'radio',
            page_number: pageNum,
            x_percent: 10,
            y_percent: startY + i * (optionH + gap),
            width_percent: optionW,
            height_percent: optionH,
            radio_group: radioGroup.trim(),
            radio_value: validOptions[i].trim(),
          }),
        });
        created.push(f);
      }
      setFields((prev) => [...prev, ...created]);
      setShowRadioPanel(false);
      setRadioGroup('');
      setRadioOptions(['yes', 'sometimes', 'not_yet']);
      void ph; // silence unused warning
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Update field position/size after drag/resize ──────────────────────────

  async function updateFieldGeometry(fieldId: string, x: number, y: number, w: number, h: number, pageNum: number) {
    if (!token || !id) return;
    const ph = pageHeights[pageNum];
    if (!ph) return;

    const xPct = toPercent(x, CANVAS_WIDTH);
    const yPct = toPercent(y, ph);
    const wPct = toPercent(w, CANVAS_WIDTH);
    const hPct = toPercent(h, ph);

    // Find the field so we can check its radio_group for sibling sync
    const movedField = fields.find((f) => f.id === fieldId);

    // Update local state immediately: move this field, and sync size to radio siblings
    setFields((prev) => prev.map((f) => {
      if (f.id === fieldId) return { ...f, x_percent: xPct, y_percent: yPct, width_percent: wPct, height_percent: hPct };
      // Keep radio siblings the same size (not position) when any sibling is resized
      if (
        movedField?.field_type === 'radio' &&
        f.field_type === 'radio' &&
        f.radio_group === movedField.radio_group
      ) {
        return { ...f, width_percent: wPct, height_percent: hPct };
      }
      return f;
    }));

    try {
      await api(`/api/staff/pdf-marker/${id}/fields/${fieldId}`, {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ x_percent: xPct, y_percent: yPct, width_percent: wPct, height_percent: hPct }),
      });

      // Persist size sync to all siblings in the same radio group
      if (movedField?.field_type === 'radio' && movedField.radio_group) {
        const siblings = fields.filter(
          (f) => f.id !== fieldId && f.field_type === 'radio' && f.radio_group === movedField.radio_group,
        );
        await Promise.all(
          siblings.map((sib) =>
            api(`/api/staff/pdf-marker/${id}/fields/${sib.id}`, {
              method: 'PUT',
              headers: { ...authHeader(token!), 'Content-Type': 'application/json' },
              body: JSON.stringify({ width_percent: wPct, height_percent: hPct }),
            }),
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Save edit panel changes for selected field ────────────────────────────

  async function saveFieldEdit() {
    if (!token || !id || !selectedId) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api<MarkerField>(`/api/staff/pdf-marker/${id}/fields/${selectedId}`, {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field_label: editLabel || null,
          font_size: editFontSize,
          required: editRequired ? 1 : 0,
          placeholder: editPlaceholder || null,
        }),
      });
      setFields((prev) => prev.map((f) => f.id === updated.id ? updated : f));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete selected field ────────────────────────────────────────────────

  async function deleteField(fieldId: string) {
    if (!token || !id) return;
    if (!window.confirm('Delete this field marker?')) return;
    try {
      await api(`/api/staff/pdf-marker/${id}/fields/${fieldId}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      setFields((prev) => prev.filter((f) => f.id !== fieldId));
      if (selectedId === fieldId) setSelectedId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ── Export JSON ──────────────────────────────────────────────────────────

  function handleExport() {
    if (!template) return;
    const a = document.createElement('a');
    a.href = `${API_BASE}/api/staff/pdf-marker/${id}/export`;
    a.download = `${template.template_key}_fields.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  async function publishTemplate() {
    if (!token || !id || !template) return;
    setSaving(true);
    try {
      const updated = await api<Template>(`/api/staff/pdf-marker/${id}`, {
        method: 'PATCH',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: template.status === 'published' ? 'draft' : 'published' }),
      });
      setTemplate((prev) => prev ? { ...prev, status: updated.status } : prev);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="page-shell"><div className="container"><p>Loading builder…</p></div></div>;
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

  const isPlacing = Boolean(placingType) && placingType !== 'radio';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 52px)' }}>

      {/* ── Top bar ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid var(--color-border)',
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button className="btn btn-sm btn-outline" onClick={() => navigate('/staff/pdf-builder')}>
          ← Templates
        </button>
        <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-nav)' }}>{template.name}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 0.4, padding: '2px 8px', borderRadius: 20,
          background: template.status === 'published' ? '#d1fae5' : '#fef9c3',
          color: template.status === 'published' ? '#065f46' : '#92400e',
        }}>
          {template.status.toUpperCase()}
        </span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          {fields.length} marker{fields.length !== 1 ? 's' : ''}
        </span>
        <span style={{ flex: 1 }} />
        {error && <span style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</span>}
        <button className="btn btn-sm btn-outline" onClick={handleExport}>Export JSON</button>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => void publishTemplate()}
          disabled={saving}
        >
          {template.status === 'published' ? 'Unpublish' : 'Publish'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => navigate(`/staff/pdf-builder/${id}/fill`)}
        >
          Fill Form →
        </button>
      </div>

      {/* ── Main layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left sidebar ── */}
        <div style={{
          width: 280, flexShrink: 0, background: '#fff',
          borderRight: '1px solid var(--color-border)',
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}>

          {/* Add fields section */}
          <div style={{ padding: '14px 14px 8px', borderBottom: '1px solid var(--color-border)' }}>
            <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Add Field
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {Object.entries(FIELD_TYPE_META).filter(([t]) => t !== 'radio').map(([type, meta]) => (
                <button
                  key={type}
                  onClick={() => { setPlacingType(type); setShowRadioPanel(false); }}
                  style={{
                    padding: '7px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', textAlign: 'left',
                    border: `1.5px solid ${placingType === type ? meta.border : '#e2e8f0'}`,
                    background: placingType === type ? meta.bg : '#f8fafc',
                    color: placingType === type ? meta.color : '#374151',
                    transition: 'all 0.1s',
                  }}
                >
                  {meta.label}
                </button>
              ))}
              {/* Radio group button */}
              <button
                onClick={() => { setShowRadioPanel(!showRadioPanel); setPlacingType(null); }}
                style={{
                  padding: '7px 6px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', textAlign: 'left', gridColumn: '1 / -1',
                  border: `1.5px solid ${showRadioPanel ? FIELD_TYPE_META.radio.border : '#e2e8f0'}`,
                  background: showRadioPanel ? FIELD_TYPE_META.radio.bg : '#f8fafc',
                  color: showRadioPanel ? FIELD_TYPE_META.radio.color : '#374151',
                }}
              >
                + Radio Group
              </button>
            </div>

            {isPlacing && (
              <div style={{
                marginTop: 10, padding: '8px 10px', borderRadius: 6,
                background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 12,
                color: '#1d4ed8',
              }}>
                Click on the PDF to place a <strong>{placingType}</strong> field.
                <button
                  onClick={() => setPlacingType(null)}
                  style={{ marginLeft: 8, fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Radio group panel */}
          {showRadioPanel && (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', background: '#fef2f2' }}>
              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#991b1b' }}>Radio Group</p>
              <input
                className="input"
                type="text"
                value={radioGroup}
                onChange={(e) => setRadioGroup(e.target.value)}
                placeholder="Group name (e.g. comm_q1)"
                style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
              />
              <p style={{ margin: '0 0 6px', fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Options (one per line):</p>
              {radioOptions.map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input
                    className="input"
                    type="text"
                    value={opt}
                    onChange={(e) => setRadioOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                    placeholder={`option_${i + 1}`}
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <button
                    onClick={() => setRadioOptions((prev) => prev.filter((_, j) => j !== i))}
                    style={{ padding: '0 6px', background: 'none', border: '1px solid #fca5a5', borderRadius: 4, color: '#dc2626', cursor: 'pointer', fontSize: 14 }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setRadioOptions((prev) => [...prev, ''])}
                style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginBottom: 8 }}
              >
                + Add option
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void addRadioGroup()}
                disabled={saving || !radioGroup.trim() || radioOptions.filter(Boolean).length === 0}
                style={{ width: '100%', background: '#dc2626', borderColor: '#dc2626' }}
              >
                Place Radio Group
              </button>
            </div>
          )}

          {/* Edit panel for selected field */}
          {selectedField && (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Selected Field
                </p>
                <button
                  onClick={() => void deleteField(selectedField.id)}
                  style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Delete
                </button>
              </div>
              <div style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 4,
                background: FIELD_TYPE_META[selectedField.field_type]?.bg ?? '#f3f4f6',
                color: FIELD_TYPE_META[selectedField.field_type]?.color ?? '#374151',
                display: 'inline-block', marginBottom: 10, fontWeight: 700,
              }}>
                {FIELD_TYPE_META[selectedField.field_type]?.label ?? selectedField.field_type.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10, wordBreak: 'break-all' }}>
                <strong>Response key:</strong><br />
                <code style={{ background: '#e2e8f0', padding: '2px 4px', borderRadius: 3 }}>
                  {selectedField.field_type === 'radio' ? selectedField.radio_group : selectedField.field_id}
                </code>
                {selectedField.field_type === 'radio' && (
                  <span style={{ display: 'block', marginTop: 2 }}>
                    <strong>Value:</strong>{' '}
                    <code style={{ background: '#e2e8f0', padding: '2px 4px', borderRadius: 3 }}>{selectedField.radio_value}</code>
                  </span>
                )}
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 2 }}>Label</label>
              <input
                className="input"
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder="Display label (optional)"
                style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
              />

              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 2 }}>Font size</label>
              <input
                className="input"
                type="number"
                value={editFontSize}
                min={6} max={24}
                onChange={(e) => setEditFontSize(Number(e.target.value))}
                style={{ width: 80, marginBottom: 8, fontSize: 12 }}
              />

              {['text', 'textarea', 'date', 'signature'].includes(selectedField.field_type) && (
                <>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 2 }}>Placeholder</label>
                  <input
                    className="input"
                    type="text"
                    value={editPlaceholder}
                    onChange={(e) => setEditPlaceholder(e.target.value)}
                    placeholder="Hint text for filler"
                    style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
                  />
                </>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  id="editRequired"
                  checked={editRequired}
                  onChange={(e) => setEditRequired(e.target.checked)}
                />
                <label htmlFor="editRequired" style={{ fontSize: 12, fontWeight: 600 }}>Required</label>
              </div>

              <button
                className="btn btn-sm btn-primary"
                onClick={() => void saveFieldEdit()}
                disabled={saving}
                style={{ width: '100%' }}
              >
                Save Changes
              </button>
            </div>
          )}

          {/* Field list */}
          <div style={{ padding: '12px 14px', flex: 1 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              All Fields ({fields.length})
            </p>
            {fields.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af' }}>
                No markers yet. Click a field type above, then click on the PDF to place it.
              </p>
            )}
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pg) => {
              const pgFields = fields.filter((f) => f.page_number === pg);
              if (pgFields.length === 0) return null;
              return (
                <div key={pg} style={{ marginBottom: 10 }}>
                  <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: '#6b7280' }}>Page {pg}</p>
                  {pgFields.map((f) => {
                    const meta = FIELD_TYPE_META[f.field_type];
                    return (
                      <div
                        key={f.id}
                        onClick={() => setSelectedId(f.id === selectedId ? null : f.id)}
                        style={{
                          padding: '5px 8px', borderRadius: 5, marginBottom: 3,
                          cursor: 'pointer', fontSize: 12,
                          border: `1px solid ${f.id === selectedId ? (meta?.border ?? '#2563eb') : '#e2e8f0'}`,
                          background: f.id === selectedId ? (meta?.bg ?? '#eff6ff') : '#fff',
                          color: f.id === selectedId ? (meta?.color ?? '#1d4ed8') : '#374151',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>
                          {f.field_type === 'radio' ? `${f.radio_group} = ${f.radio_value}` : f.field_name}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>[{f.field_type}]</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PDF canvas area ── */}
        <div
          ref={containerRef}
          style={{
            flex: 1, overflowY: 'auto', background: '#525659', padding: '16px 0',
            cursor: isPlacing ? 'crosshair' : 'default',
          }}
        >
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            const ph = pageHeights[pageNum] ?? Math.round(CANVAS_WIDTH * 1.294);
            const pageFields = fields.filter((f) => f.page_number === pageNum);

            return (
              <div key={pageNum} style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
                <div
                  data-page={pageNum}
                  style={{ position: 'relative', width: CANVAS_WIDTH, minHeight: ph, background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.25)' }}
                  onClick={(e) => handleCanvasClick(e, pageNum)}
                >
                  <canvas
                    ref={(el) => { if (el) canvasRefs.current.set(pageNum, el); else canvasRefs.current.delete(pageNum); }}
                    style={{ display: 'block', width: CANVAS_WIDTH, height: ph || 'auto', userSelect: 'none' }}
                  />

                  {/* ── Field marker overlays ── */}
                  {pageHeights[pageNum] != null && pageFields.map((field) => {
                    const meta = FIELD_TYPE_META[field.field_type] ?? FIELD_TYPE_META.text;
                    const x = (field.x_percent / 100) * CANVAS_WIDTH;
                    const y = (field.y_percent / 100) * ph;
                    // Enforce a minimum 24px touch target so tiny markers are always draggable
                    const MIN_PX = 24;
                    const rawW = (field.width_percent / 100) * CANVAS_WIDTH;
                    const rawH = (field.height_percent / 100) * ph;
                    const w = Math.max(MIN_PX, rawW);
                    const h = Math.max(MIN_PX, rawH);
                    const isSelected = field.id === selectedId;

                    return (
                      <Rnd
                        key={field.id}
                        position={{ x, y }}
                        size={{ width: w, height: h }}
                        bounds="parent"
                        onDragStop={(_e, d) => {
                          // Use actual rendered size so position is saved correctly
                          void updateFieldGeometry(field.id, d.x, d.y, w, h, pageNum);
                        }}
                        onResizeStop={(_e, _dir, ref, _delta, pos) => {
                          void updateFieldGeometry(field.id, pos.x, pos.y, ref.offsetWidth, ref.offsetHeight, pageNum);
                        }}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setSelectedId(isSelected ? null : field.id);
                          setPlacingType(null);
                        }}
                        style={{ zIndex: isSelected ? 20 : 10 }}
                        enableResizing={!isPlacing}
                        disableDragging={isPlacing}
                        minWidth={MIN_PX}
                        minHeight={MIN_PX}
                      >
                        <div
                          style={{
                            width: '100%', height: '100%',
                            background: meta.bg,
                            border: `${isSelected ? 2 : 1}px solid ${meta.border}`,
                            borderRadius: field.field_type === 'radio' ? '50%' : 3,
                            boxSizing: 'border-box',
                            display: 'flex', alignItems: 'center',
                            overflow: 'hidden',
                            outline: isSelected ? `2px solid ${meta.border}` : 'none',
                            outlineOffset: 1,
                          }}
                        >
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: meta.color,
                            padding: '0 3px', whiteSpace: 'nowrap', overflow: 'hidden',
                            textOverflow: 'ellipsis', lineHeight: 1.2,
                            display: field.field_type === 'radio' ? 'none' : 'block',
                          }}>
                            {field.field_label || field.field_name}
                          </span>
                        </div>
                      </Rnd>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {numPages === 0 && !loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#ccc', fontSize: 14 }}>
              PDF loading…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
