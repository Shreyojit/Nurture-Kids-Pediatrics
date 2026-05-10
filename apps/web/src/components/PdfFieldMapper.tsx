import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { GlobalWorkerOptions, getDocument, version } from 'pdfjs-dist';
import { authHeader } from '../lib/api';

GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

type FieldLike = {
  id?: string;
  field_id: string;
  field_name: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragMode =
  | 'move'
  | 'resize-n'
  | 'resize-s'
  | 'resize-e'
  | 'resize-w'
  | 'resize-ne'
  | 'resize-nw'
  | 'resize-se'
  | 'resize-sw';

type EditDrag = {
  mode: DragMode;
  fieldDbId: string;
  startClientX: number;
  startClientY: number;
  startField: { x: number; y: number; width: number; height: number };
  scale: number;
};

type Props = {
  templateId: string;
  token: string;
  fields: FieldLike[];
  draftField: {
    field_id: string;
    field_name: string;
    page_number: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  onPositionPick: (payload: { x: number; y: number; width: number; height: number; page_number: number }) => void;
  onPageChange: (pageNumber: number) => void;
  selectedFieldId?: string | null;
  onFieldSelect?: (id: string | null) => void;
  onFieldUpdate?: (fieldDbId: string, pos: { x: number; y: number; width: number; height: number }) => void;
  onFieldDelete?: (fieldDbId: string) => void;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const WORKER_URL = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
GlobalWorkerOptions.workerSrc = WORKER_URL;

const HANDLE_SIZE = 8;
const H = HANDLE_SIZE / 2;

const HANDLES: { mode: DragMode; style: CSSProperties }[] = [
  { mode: 'resize-nw', style: { left: -H, top: -H, cursor: 'nw-resize' } },
  { mode: 'resize-n', style: { left: '50%', transform: 'translateX(-50%)', top: -H, cursor: 'n-resize' } },
  { mode: 'resize-ne', style: { right: -H, top: -H, cursor: 'ne-resize' } },
  { mode: 'resize-e', style: { right: -H, top: '50%', transform: 'translateY(-50%)', cursor: 'e-resize' } },
  { mode: 'resize-se', style: { right: -H, bottom: -H, cursor: 'se-resize' } },
  { mode: 'resize-s', style: { left: '50%', transform: 'translateX(-50%)', bottom: -H, cursor: 's-resize' } },
  { mode: 'resize-sw', style: { left: -H, bottom: -H, cursor: 'sw-resize' } },
  { mode: 'resize-w', style: { left: -H, top: '50%', transform: 'translateY(-50%)', cursor: 'w-resize' } },
];

function applyDrag(drag: EditDrag, clientX: number, clientY: number) {
  const dx = clientX - drag.startClientX;
  const dy = clientY - drag.startClientY;
  const { x, y, width: w, height: h } = drag.startField;
  const s = drag.scale;
  const MIN = 8;
  switch (drag.mode) {
    case 'move':      return { x: x + dx / s, y: y - dy / s, width: w, height: h };
    case 'resize-n':  return { x, y, width: w, height: Math.max(MIN, h - dy / s) };
    case 'resize-s':  return { x, y: y - dy / s, width: w, height: Math.max(MIN, h + dy / s) };
    case 'resize-e':  return { x, y, width: Math.max(MIN, w + dx / s), height: h };
    case 'resize-w':  return { x: x + dx / s, y, width: Math.max(MIN, w - dx / s), height: h };
    case 'resize-ne': return { x, y, width: Math.max(MIN, w + dx / s), height: Math.max(MIN, h - dy / s) };
    case 'resize-nw': return { x: x + dx / s, y, width: Math.max(MIN, w - dx / s), height: Math.max(MIN, h - dy / s) };
    case 'resize-se': return { x, y: y - dy / s, width: Math.max(MIN, w + dx / s), height: Math.max(MIN, h + dy / s) };
    case 'resize-sw': return { x: x + dx / s, y: y - dy / s, width: Math.max(MIN, w - dx / s), height: Math.max(MIN, h + dy / s) };
  }
}

export function PdfFieldMapper({
  templateId, token, fields, draftField,
  onPositionPick, onPageChange,
  selectedFieldId, onFieldSelect, onFieldUpdate, onFieldDelete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editDragRef = useRef<EditDrag | null>(null);
  const onFieldUpdateRef = useRef(onFieldUpdate);
  useEffect(() => { onFieldUpdateRef.current = onFieldUpdate; }, [onFieldUpdate]);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageNumber, setPageNumber] = useState<number>(Math.max(1, draftField.page_number || 1));
  const [pageCount, setPageCount] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [viewport, setViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [liveEditFieldId, setLiveEditFieldId] = useState<string | null>(null);
  const [liveEditPos, setLiveEditPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Global listeners handle edit drag regardless of where the mouse goes
  useEffect(() => {
    function handleGlobalMove(e: globalThis.MouseEvent) {
      const drag = editDragRef.current;
      if (!drag) return;
      setLiveEditPos(applyDrag(drag, e.clientX, e.clientY));
    }

    function handleGlobalUp(e: globalThis.MouseEvent) {
      const drag = editDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        const p = applyDrag(drag, e.clientX, e.clientY);
        onFieldUpdateRef.current?.(drag.fieldDbId, {
          x: Math.round(Math.max(0, p.x)),
          y: Math.round(Math.max(0, p.y)),
          width: Math.round(Math.max(8, p.width)),
          height: Math.round(Math.max(8, p.height)),
        });
      }
      editDragRef.current = null;
      setLiveEditFieldId(null);
      setLiveEditPos(null);
    }

    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, []);

  useEffect(() => {
    setPageNumber(Math.max(1, draftField.page_number || 1));
  }, [draftField.page_number]);

  useEffect(() => {
    let cancelled = false;
    async function loadPdf() {
      setLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`${API_BASE}/api/staff/templates/${templateId}/source`, {
          headers: authHeader(token),
        });

        if (!response.ok) throw new Error('Unable to load source PDF for mapper');

        const bytes = await response.arrayBuffer();
        const task = getDocument({ data: bytes });
        const loaded = await task.promise;

        if (cancelled) return;
        setPdfDoc(loaded);
        setPageCount(loaded.numPages);

        const firstPage = await loaded.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const nextScale = 760 / firstViewport.width;
        setScale(nextScale);
      } catch (error) {
        if (cancelled) return;
        setLoadError((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => { cancelled = true; };
  }, [templateId, token]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!pdfDoc || !canvasRef.current) return;
      const pageIndex = Math.min(Math.max(1, pageNumber), pageCount || 1);
      const page = await pdfDoc.getPage(pageIndex);
      if (cancelled || !canvasRef.current) return;

      const nextViewport = page.getViewport({ scale });
      setViewport({ width: nextViewport.width, height: nextViewport.height });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = nextViewport.width;
      canvas.height = nextViewport.height;

      await page.render({ canvasContext: context, viewport: nextViewport }).promise;
    }

    renderPage();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNumber, pageCount, scale]);

  const pageFields = useMemo(
    () => fields.filter((field) => Number(field.page_number || 1) === Number(pageNumber || 1)),
    [fields, pageNumber],
  );

  const draftOverlay = useMemo(() => {
    if (Number(draftField.page_number || 1) !== Number(pageNumber || 1)) return null;
    return {
      left: Number(draftField.x || 0) * scale,
      top: viewport.height - (Number(draftField.y || 0) + Number(draftField.height || 0)) * scale,
      width: Math.max(10, Number(draftField.width || 0) * scale),
      height: Math.max(10, Number(draftField.height || 0) * scale),
    };
  }, [draftField, pageNumber, scale, viewport.height]);

  const dragOverlay = useMemo(() => {
    if (!dragStart || !dragCurrent) return null;
    const left = Math.min(dragStart.x, dragCurrent.x);
    const top = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    return { left, top, width: Math.max(2, width), height: Math.max(2, height) };
  }, [dragStart, dragCurrent]);

  function toCanvasPoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left + event.currentTarget.scrollLeft;
    const y = event.clientY - rect.top + event.currentTarget.scrollTop;
    return { x, y };
  }

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!viewport.width || !viewport.height) return;
    onFieldSelect?.(null);
    const point = toCanvasPoint(event);
    setDragStart(point);
    setDragCurrent(point);
  }

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!dragStart) return;
    setDragCurrent(toCanvasPoint(event));
  }

  function handleMouseUp(event: MouseEvent<HTMLDivElement>) {
    if (!dragStart || !viewport.width || !viewport.height) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const end = toCanvasPoint(event);
    const leftCanvas = Math.min(dragStart.x, end.x);
    const topCanvas = Math.min(dragStart.y, end.y);
    const rightCanvas = Math.max(dragStart.x, end.x);
    const bottomCanvas = Math.max(dragStart.y, end.y);

    const widthPdf = Math.max(10, (rightCanvas - leftCanvas) / scale);
    const heightPdf = Math.max(10, (bottomCanvas - topCanvas) / scale);
    const xPdf = Math.max(0, leftCanvas / scale);
    const yPdf = Math.max(0, (viewport.height - bottomCanvas) / scale);

    onPositionPick({
      x: Math.round(xPdf),
      y: Math.round(yPdf),
      width: Math.round(widthPdf),
      height: Math.round(heightPdf),
      page_number: pageNumber,
    });

    setDragStart(null);
    setDragCurrent(null);
  }

  return (
    <div className="card" style={{ marginTop: 12, background: '#f7faff' }}>
      <h4 style={{ marginTop: 0 }}>Graphical Field Placement</h4>
      <p style={{ marginTop: 0, marginBottom: 8, fontSize: 13 }}>
        <strong>Draw new field:</strong> click-and-drag on empty canvas.&nbsp;
        <strong>Move/resize existing field:</strong> click to select (orange), then drag body or handles.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field">
          <label>Page</label>
          <select
            value={pageNumber}
            onChange={(event) => {
              const nextPage = Math.min(Math.max(1, Number(event.target.value) || 1), Math.max(1, pageCount));
              setPageNumber(nextPage);
              onPageChange(nextPage);
            }}
          >
            {Array.from({ length: Math.max(1, pageCount) }).map((_, idx) => (
              <option key={idx + 1} value={idx + 1}>
                Page {idx + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Zoom</label>
          <input
            type="range"
            min="0.6"
            max="2.2"
            step="0.1"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          />
        </div>
      </div>

      {loading ? <p>Loading source PDF...</p> : null}
      {loadError ? <div className="error">{loadError}</div> : null}

      {!loading && !loadError ? (
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setDragStart(null);
            setDragCurrent(null);
          }}
          style={{
            position: 'relative',
            width: viewport.width || 'auto',
            maxWidth: '100%',
            border: '1px solid #cfe0ff',
            cursor: 'crosshair',
            overflow: 'auto',
            background: '#fff',
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block' }} />

          {pageFields.map((field) => {
            const dbId = field.id ?? field.field_id;
            const isSelected = selectedFieldId === dbId;
            const isLive = liveEditFieldId === dbId && liveEditPos !== null;

            const rawX = isLive ? liveEditPos!.x : Number(field.x || 0);
            const rawY = isLive ? liveEditPos!.y : Number(field.y || 0);
            const rawW = isLive ? liveEditPos!.width : Number(field.width || 0);
            const rawH = isLive ? liveEditPos!.height : Number(field.height || 0);

            const left = rawX * scale;
            const top = viewport.height - (rawY + rawH) * scale;
            const width = Math.max(10, rawW * scale);
            const height = Math.max(10, rawH * scale);

            function startEditDrag(e: MouseEvent<HTMLDivElement>, mode: DragMode) {
              e.stopPropagation();
              e.preventDefault();
              editDragRef.current = {
                mode,
                fieldDbId: dbId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startField: { x: rawX, y: rawY, width: rawW, height: rawH },
                scale,
              };
              setLiveEditFieldId(dbId);
              setLiveEditPos({ x: rawX, y: rawY, width: rawW, height: rawH });
            }

            return (
              <div
                key={dbId}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!isSelected) {
                    onFieldSelect?.(dbId);
                    return;
                  }
                  startEditDrag(e, 'move');
                }}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width,
                  height,
                  border: isSelected ? '2px solid #e07b00' : '2px solid #2467d6',
                  background: isSelected ? 'rgba(224,123,0,0.10)' : 'rgba(36,103,214,0.08)',
                  pointerEvents: 'auto',
                  boxSizing: 'border-box',
                  cursor: isSelected ? 'move' : 'pointer',
                  userSelect: 'none',
                }}
                title={`${field.field_id}: ${field.field_name}`}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -16,
                    left: 0,
                    fontSize: 10,
                    background: isSelected ? '#e07b00' : '#2467d6',
                    color: '#fff',
                    padding: '1px 4px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}
                >
                  {field.field_id}
                </div>

                {isSelected && onFieldDelete && (
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onFieldSelect?.(null);
                      onFieldDelete(dbId);
                    }}
                    style={{
                      position: 'absolute',
                      top: -20,
                      right: 0,
                      fontSize: 11,
                      background: '#c0392b',
                      color: '#fff',
                      padding: '1px 5px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      userSelect: 'none',
                      pointerEvents: 'auto',
                      lineHeight: '16px',
                    }}
                    title="Delete field"
                  >
                    ✕ delete
                  </div>
                )}

                {isSelected &&
                  HANDLES.map(({ mode: hMode, style: hStyle }) => (
                    <div
                      key={hMode}
                      onMouseDown={(e) => startEditDrag(e, hMode)}
                      style={{
                        position: 'absolute',
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        background: '#e07b00',
                        border: '1px solid #fff',
                        borderRadius: 2,
                        ...hStyle,
                      }}
                    />
                  ))}
              </div>
            );
          })}

          {draftOverlay ? (
            <div
              style={{
                position: 'absolute',
                left: draftOverlay.left,
                top: draftOverlay.top,
                width: draftOverlay.width,
                height: draftOverlay.height,
                border: '2px dashed #15a36a',
                background: 'rgba(21,163,106,0.14)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
              title="Draft field placement"
            />
          ) : null}

          {dragOverlay ? (
            <div
              style={{
                position: 'absolute',
                left: dragOverlay.left,
                top: dragOverlay.top,
                width: dragOverlay.width,
                height: dragOverlay.height,
                border: '2px dotted #0f2235',
                background: 'rgba(15,34,53,0.08)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
