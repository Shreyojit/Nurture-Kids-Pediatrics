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

type Field = {
  id: string;
  template_id: string;
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
  sort_order: number;
};

type Template = {
  id: string;
  name: string;
  template_type: string;
  original_file_name: string;
  fields: Field[];
};

type DraftMarker = {
  tempId: string;
  field_key: string;
  field_name: string;
  field_type: string;
  group_name: string;
  option_value: string;
  required: boolean;
  page_number: number;
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
};

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'radio', label: 'Radio (circle)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'signature', label: 'Signature' },
];

const MARKER_COLORS: Record<string, string> = {
  text: 'rgba(37, 99, 235, 0.25)',
  textarea: 'rgba(124, 58, 237, 0.25)',
  radio: 'rgba(220, 38, 38, 0.3)',
  checkbox: 'rgba(5, 150, 105, 0.25)',
  signature: 'rgba(217, 119, 6, 0.25)',
};

const MARKER_BORDER: Record<string, string> = {
  text: '#2563eb',
  textarea: '#7c3aed',
  radio: '#dc2626',
  checkbox: '#059669',
  signature: '#d97706',
};

export function ASQTemplateBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = getStaffSession()?.token ?? null;

  const [template, setTemplate] = useState<Template | null>(null);
  const [savedFields, setSavedFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // PDF rendering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTasksRef = useRef<Map<number, any>>(new Map());

  // Current page for placing new markers
  const [activePage, setActivePage] = useState(1);

  // Toolbar defaults for new markers
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<string>('text');
  const [newGroupName, setNewGroupName] = useState('');
  const [newOptionValue, setNewOptionValue] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  // Selected marker for editing
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Draft markers placed but not yet saved
  const [drafts, setDrafts] = useState<DraftMarker[]>([]);

  // Saving state
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) { navigate('/staff/login'); return; }
    if (!id) return;
    void loadTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function loadTemplate() {
    if (!token || !id) return;
    setLoading(true);
    setError('');
    try {
      const tmpl = await api<Template>(`/api/staff/asq/${id}`, { headers: authHeader(token) });
      setTemplate(tmpl);
      setSavedFields(tmpl.fields);

      // Load PDF
      const pdfUrl = `${API_BASE}/api/staff/asq/${id}/pdf`;
      const headers = { Authorization: `Bearer ${token}` };
      const response = await fetch(pdfUrl, { headers });
      const arrBuf = await response.arrayBuffer();
      const loadedDoc = await getDocument({ data: new Uint8Array(arrBuf) }).promise;
      setPdfDoc(loadedDoc);
      setNumPages(loadedDoc.numPages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Render each PDF page onto its canvas
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

  // Click on page div → place new marker
  function handlePageClick(e: React.MouseEvent<HTMLDivElement>, pageNum: number) {
    // Only place if click is directly on the background (not on a marker)
    if ((e.target as HTMLElement).closest('[data-marker]')) return;
    if (!newFieldKey.trim()) {
      setError('Set a Field Key before clicking to place a marker.');
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const ph = pageHeights[pageNum] ?? rect.height;

    const defaultW = newFieldType === 'radio' ? 3.5 : newFieldType === 'checkbox' ? 3.5 : newFieldType === 'textarea' ? 28 : 20;
    const defaultH = newFieldType === 'radio' ? 3.5 : newFieldType === 'checkbox' ? 3.5 : newFieldType === 'textarea' ? 8 : 3;

    setDrafts((prev) => [
      ...prev,
      {
        tempId: `draft_${Date.now()}`,
        field_key: newFieldKey.trim(),
        field_name: newFieldName.trim() || newFieldKey.trim(),
        field_type: newFieldType,
        group_name: newGroupName.trim(),
        option_value: newOptionValue.trim(),
        required: newRequired,
        page_number: pageNum,
        x_percent: (relX / CANVAS_WIDTH) * 100,
        y_percent: (relY / ph) * 100,
        width_percent: defaultW,
        height_percent: defaultH,
      },
    ]);
    setError('');
  }

  function removeDraft(tempId: string) {
    setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
  }

  async function deleteSavedField(fieldId: string) {
    if (!token || !id) return;
    try {
      await api(`/api/staff/asq/${id}/fields/${fieldId}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      setSavedFields((prev) => prev.filter((f) => f.id !== fieldId));
      setMsg('Field deleted.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveAllDrafts() {
    if (!token || !id || drafts.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const saved: Field[] = [];
      for (const d of drafts) {
        const f = await api<Field>(`/api/staff/asq/${id}/fields`, {
          method: 'POST',
          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field_name: d.field_name,
            field_key: d.field_key,
            field_type: d.field_type,
            page_number: d.page_number,
            x_percent: d.x_percent,
            y_percent: d.y_percent,
            width_percent: d.width_percent,
            height_percent: d.height_percent,
            group_name: d.group_name || null,
            option_value: d.option_value || null,
            required: d.required,
            sort_order: savedFields.length + saved.length,
          }),
        });
        saved.push(f);
      }
      setSavedFields((prev) => [...prev, ...saved]);
      setDrafts([]);
      setMsg(`Saved ${saved.length} field(s).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="container">
          <p>Loading template…</p>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="page-shell">
        <div className="container">
          <p style={{ color: 'var(--color-error)' }}>Template not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', overflow: 'hidden' }}>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 300,
          minWidth: 300,
          background: '#fff',
          borderRight: '1px solid var(--color-border)',
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 2px' }}>{template.name}</h2>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
            {template.original_file_name} · {numPages} pages
          </p>
        </div>

        {error && (
          <div className="alert alert-error" style={{ fontSize: 13 }}>
            {error}
          </div>
        )}
        {msg && (
          <div className="alert alert-success" style={{ fontSize: 13 }}>
            {msg}
          </div>
        )}

        {/* ── New marker toolbar ── */}
        <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 8, padding: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
            Place New Marker
          </p>

          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Field Key *</label>
          <input
            className="input"
            style={{ marginBottom: 8, fontSize: 13 }}
            placeholder="e.g. communication_q1"
            value={newFieldKey}
            onChange={(e) => setNewFieldKey(e.target.value)}
          />

          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Field Label</label>
          <input
            className="input"
            style={{ marginBottom: 8, fontSize: 13 }}
            placeholder="Human-readable name"
            value={newFieldName}
            onChange={(e) => setNewFieldName(e.target.value)}
          />

          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Type</label>
          <select
            className="input"
            style={{ marginBottom: 8, fontSize: 13 }}
            value={newFieldType}
            onChange={(e) => setNewFieldType(e.target.value)}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {newFieldType === 'radio' && (
            <>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Group Name</label>
              <input
                className="input"
                style={{ marginBottom: 8, fontSize: 13 }}
                placeholder="e.g. communication_q1"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Option Value</label>
              <input
                className="input"
                style={{ marginBottom: 8, fontSize: 13 }}
                placeholder="yes / sometimes / not_yet"
                value={newOptionValue}
                onChange={(e) => setNewOptionValue(e.target.value)}
              />
            </>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
            Required
          </label>

          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 3 }}>Active Page</label>
          <select
            className="input"
            style={{ marginBottom: 8, fontSize: 13 }}
            value={activePage}
            onChange={(e) => setActivePage(Number(e.target.value))}
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>Page {p}</option>
            ))}
          </select>

          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
            Click anywhere on page {activePage} to place a marker.
          </p>
        </div>

        {/* ── Pending drafts ── */}
        {drafts.length > 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
              Unsaved ({drafts.length})
            </p>
            {drafts.map((d) => (
              <div
                key={d.tempId}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--color-bg)',
                  border: `1px solid ${MARKER_BORDER[d.field_type] ?? '#ccc'}`,
                  marginBottom: 6,
                  fontSize: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  <strong>{d.field_key}</strong>
                  <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
                    [{d.field_type}] p{d.page_number}
                  </span>
                </span>
                <button
                  onClick={() => removeDraft(d.tempId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 14, padding: '0 2px' }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4 }}
              onClick={() => void saveAllDrafts()}
              disabled={saving}
            >
              {saving ? 'Saving…' : `Save ${drafts.length} Marker(s)`}
            </button>
          </div>
        )}

        {/* ── Saved fields list ── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>
            Saved Fields ({savedFields.length})
          </p>
          {savedFields.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No fields yet. Click on the PDF to place markers.</p>
          )}
          {savedFields.map((f) => (
            <div
              key={f.id}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: selectedId === f.id ? 'var(--color-primary-soft)' : 'var(--color-bg)',
                border: `1px solid ${selectedId === f.id ? 'var(--color-primary)' : '#e5e7eb'}`,
                marginBottom: 6,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onClick={() => setSelectedId(f.id === selectedId ? null : f.id)}
            >
              <span>
                <strong>{f.field_key}</strong>
                <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
                  [{f.field_type}] p{f.page_number}
                </span>
                {f.group_name && (
                  <span style={{ color: '#7c3aed', marginLeft: 4 }}>
                    {f.group_name}={f.option_value}
                  </span>
                )}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteSavedField(f.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 14, padding: '0 2px' }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── PDF Canvas Area ── */}
      <main style={{ flex: 1, overflowY: 'auto', background: '#525659', padding: '16px 0' }}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
          // ph is the actual rendered height once available; fallback is only used for minHeight placeholder
          const ph = pageHeights[pageNum] ?? Math.round(CANVAS_WIDTH * 1.294);
          const isActive = pageNum === activePage;
          const pageFields = savedFields.filter((f) => f.page_number === pageNum);
          const pageDrafts = drafts.filter((d) => d.page_number === pageNum);

          return (
            <div key={pageNum} style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  position: 'relative',
                  width: CANVAS_WIDTH,
                  minHeight: ph,
                  cursor: isActive ? 'crosshair' : 'default',
                  background: '#fff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
                }}
                onClick={isActive ? (e) => handlePageClick(e, pageNum) : undefined}
              >
                {/* Page number badge */}
                <div
                  style={{
                    position: 'absolute',
                    top: -22,
                    left: 0,
                    fontSize: 11,
                    color: '#fff',
                    background: isActive ? 'var(--color-primary)' : '#444',
                    padding: '2px 8px',
                    borderRadius: '4px 4px 0 0',
                  }}
                >
                  Page {pageNum} {isActive ? '← active' : ''}
                </div>

                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(pageNum, el);
                    else canvasRefs.current.delete(pageNum);
                  }}
                  style={{ display: 'block', width: CANVAS_WIDTH, height: ph || 'auto' }}
                />

                {/* Saved field overlays */}
                {pageFields.map((f) => {
                  const fx = (f.x_percent / 100) * CANVAS_WIDTH;
                  const fy = (f.y_percent / 100) * ph;
                  const fw = (f.width_percent / 100) * CANVAS_WIDTH;
                  const fh = (f.height_percent / 100) * ph;
                  const isSelected = f.id === selectedId;
                  return (
                    <Rnd
                      key={f.id}
                      data-marker="true"
                      size={{ width: fw, height: fh }}
                      position={{ x: fx, y: fy }}
                      bounds="parent"
                      onDragStop={(_e, d) => {
                        const newX = (d.x / CANVAS_WIDTH) * 100;
                        const newY = (d.y / ph) * 100;
                        if (!token || !id) return;
                        void api(`/api/staff/asq/${id}/fields/${f.id}`, {
                          method: 'PUT',
                          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
                          body: JSON.stringify({ x_percent: newX, y_percent: newY }),
                        }).then(() => {
                          setSavedFields((prev) =>
                            prev.map((ff) => (ff.id === f.id ? { ...ff, x_percent: newX, y_percent: newY } : ff)),
                          );
                        });
                      }}
                      onResizeStop={(_e, _dir, ref, _delta, pos) => {
                        const newW = (ref.offsetWidth / CANVAS_WIDTH) * 100;
                        const newH = (ref.offsetHeight / ph) * 100;
                        const newX = (pos.x / CANVAS_WIDTH) * 100;
                        const newY = (pos.y / ph) * 100;
                        if (!token || !id) return;
                        void api(`/api/staff/asq/${id}/fields/${f.id}`, {
                          method: 'PUT',
                          headers: { ...authHeader(token), 'Content-Type': 'application/json' },
                          body: JSON.stringify({ x_percent: newX, y_percent: newY, width_percent: newW, height_percent: newH }),
                        }).then(() => {
                          setSavedFields((prev) =>
                            prev.map((ff) =>
                              ff.id === f.id
                                ? { ...ff, x_percent: newX, y_percent: newY, width_percent: newW, height_percent: newH }
                                : ff,
                            ),
                          );
                        });
                      }}
                      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(f.id === selectedId ? null : f.id); }}
                      style={{
                        position: 'absolute',
                        background: MARKER_COLORS[f.field_type] ?? 'rgba(0,0,0,0.1)',
                        border: `1.5px ${isSelected ? 'solid' : 'dashed'} ${MARKER_BORDER[f.field_type] ?? '#666'}`,
                        borderRadius: f.field_type === 'radio' ? '50%' : 3,
                        boxSizing: 'border-box',
                        overflow: 'hidden',
                        cursor: 'move',
                        zIndex: isSelected ? 10 : 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          color: MARKER_BORDER[f.field_type] ?? '#333',
                          padding: '1px 2px',
                          display: 'block',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          lineHeight: 1.2,
                        }}
                      >
                        {f.field_key}
                      </span>
                    </Rnd>
                  );
                })}

                {/* Draft overlays */}
                {pageDrafts.map((d) => {
                  const dx = (d.x_percent / 100) * CANVAS_WIDTH;
                  const dy = (d.y_percent / 100) * ph;
                  const dw = (d.width_percent / 100) * CANVAS_WIDTH;
                  const dh = (d.height_percent / 100) * ph;
                  return (
                    <Rnd
                      key={d.tempId}
                      data-marker="true"
                      size={{ width: dw, height: dh }}
                      position={{ x: dx, y: dy }}
                      bounds="parent"
                      onDragStop={(_e, pos) => {
                        setDrafts((prev) =>
                          prev.map((dd) =>
                            dd.tempId === d.tempId
                              ? {
                                  ...dd,
                                  x_percent: (pos.x / CANVAS_WIDTH) * 100,
                                  y_percent: (pos.y / ph) * 100,
                                }
                              : dd,
                          ),
                        );
                      }}
                      onResizeStop={(_e, _dir, ref, _delta, pos) => {
                        setDrafts((prev) =>
                          prev.map((dd) =>
                            dd.tempId === d.tempId
                              ? {
                                  ...dd,
                                  x_percent: (pos.x / CANVAS_WIDTH) * 100,
                                  y_percent: (pos.y / ph) * 100,
                                  width_percent: (ref.offsetWidth / CANVAS_WIDTH) * 100,
                                  height_percent: (ref.offsetHeight / ph) * 100,
                                }
                              : dd,
                          ),
                        );
                      }}
                      style={{
                        position: 'absolute',
                        background: MARKER_COLORS[d.field_type] ?? 'rgba(0,0,0,0.1)',
                        border: `1.5px dashed ${MARKER_BORDER[d.field_type] ?? '#666'}`,
                        borderRadius: d.field_type === 'radio' ? '50%' : 3,
                        boxSizing: 'border-box',
                        cursor: 'move',
                        zIndex: 6,
                        opacity: 0.8,
                      }}
                    >
                      <span style={{ fontSize: 8, fontWeight: 700, color: MARKER_BORDER[d.field_type] ?? '#333', padding: '1px 2px', display: 'block', lineHeight: 1.2, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        ✦ {d.field_key}
                      </span>
                    </Rnd>
                  );
                })}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
