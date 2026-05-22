import { useMemo, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { Rnd } from 'react-rnd';
import { usePdfFile } from '../hooks/usePdfFile';
import { authHeader } from '../lib/api';
import {
  browserBoxToPdfBox,
  PDF_DISPLAY_SCALE,
  pdfBoxToBrowserBox,
  type Box,
} from '../lib/pdfCoordinates';
import { makeFieldId, type FieldSchemaField, type TemplateFieldSchema } from '../lib/fieldSchema';
import { PDF_PAGE_CANVAS_ONLY } from '../lib/pdfjsSetup';
import '../styles/pdfVisualMapper.css';

function normalizeBox(box: Box): Required<Box> {
  return {
    x: box.x ?? 0,
    y: box.y ?? 0,
    width: box.width ?? 0,
    height: box.height ?? 0,
  };
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

type Props = {
  templateId: string;
  token: string;
  templateName: string;
  schema: TemplateFieldSchema;
  onSchemaChange: (schema: TemplateFieldSchema) => void;
  onSave: () => Promise<void>;
  saving?: boolean;
};

function emptyTextField(pageNumber: number): FieldSchemaField {
  return {
    id: makeFieldId('text'),
    key: 'childName',
    label: 'Patient name',
    type: 'text',
    page: pageNumber - 1,
    x: 80,
    y: 720,
    width: 150,
    height: 24,
    fontSize: 10,
  };
}

function emptyCheckboxField(pageNumber: number): FieldSchemaField {
  return {
    id: makeFieldId('checkbox'),
    key: 'agree',
    label: 'Agree',
    type: 'checkbox',
    page: pageNumber - 1,
    x: 80,
    y: 80,
    width: 18,
    height: 18,
  };
}

function emptyRadioField(pageNumber: number): FieldSchemaField {
  return {
    id: makeFieldId('radio'),
    key: 'q1',
    label: 'Question 1',
    type: 'radio',
    page: pageNumber - 1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    options: [
      {
        id: makeFieldId('radio_yes'),
        label: 'Yes',
        value: 'Yes',
        x: 420,
        y: 680,
        width: 36,
        height: 18,
      },
      {
        id: makeFieldId('radio_no'),
        label: 'No',
        value: 'No',
        x: 470,
        y: 680,
        width: 36,
        height: 18,
      },
    ],
  };
}

export function PdfVisualMapper({
  templateId,
  token,
  templateName,
  schema,
  onSchemaChange,
  onSave,
  saving,
}: Props) {
  const fields = schema.fields;
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const pdfUrl = `${API_BASE}/api/staff/templates/${templateId}/source`;
  const pdfHeaders = useMemo(() => authHeader(token), [token]);
  const { file: pdfFile, loading: pdfLoading, error: pdfError } = usePdfFile(pdfUrl, pdfHeaders);

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  const activePageSize = pageSizes[activePage - 1];
  const activePageWidth = activePageSize
    ? activePageSize.width * PDF_DISPLAY_SCALE
    : 612 * PDF_DISPLAY_SCALE;

  function setFields(next: FieldSchemaField[]) {
    onSchemaChange({ fields: next });
  }

  function updateField(fieldId: string, patch: Partial<FieldSchemaField>) {
    setFields(fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)));
  }

  function updateRadioOption(fieldId: string, optionId: string, patch: Partial<Box>) {
    setFields(
      fields.map((field) => {
        if (field.id !== fieldId || field.type !== 'radio') return field;
        return {
          ...field,
          options: (field.options ?? []).map((option) =>
            option.id === optionId ? { ...option, ...patch } : option,
          ),
        };
      }),
    );
  }

  function removeField(fieldId: string) {
    setFields(fields.filter((field) => field.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }

  async function handleSave() {
    setMessage('');
    try {
      await onSave();
      setMessage('Field mapping saved successfully');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function pageLoaded(
    page: { getViewport: (opts: { scale: number }) => { width: number; height: number } },
    pageNumber: number,
  ) {
    const viewport = page.getViewport({ scale: 1 });
    setPageSizes((prev) => ({
      ...prev,
      [pageNumber - 1]: { width: viewport.width, height: viewport.height },
    }));
  }

  function getBrowserBox(field: Box, pageIndex: number): Required<Box> {
    const pageSize = pageSizes[pageIndex];
    if (!pageSize) return normalizeBox(field);
    return pdfBoxToBrowserBox(field, pageSize.height);
  }

  function getPdfBoxFromBrowser(box: Box, pageIndex: number): Required<Box> {
    const pageSize = pageSizes[pageIndex];
    if (!pageSize) return normalizeBox(box);
    return browserBoxToPdfBox(box, pageSize.height);
  }

  const visibleFieldsForPage = (pageNumber: number) =>
    fields.filter((field) => field.page === pageNumber - 1);

  function renderFieldOverlays(pageNumber: number) {
    return visibleFieldsForPage(pageNumber).map((field) => {
      if (field.type === 'radio') {
        return (field.options ?? []).map((option) => {
          const pageSizeForOption = pageSizes[field.page];
          if (!pageSizeForOption) return null;
          const browserOption = pdfBoxToBrowserBox(option, pageSizeForOption.height);

          return (
            <Rnd
              key={option.id}
              bounds="parent"
              size={{ width: browserOption.width, height: browserOption.height }}
              position={{ x: browserOption.x, y: browserOption.y }}
              onMouseDown={() => setSelectedFieldId(field.id)}
              onDragStop={(_e, d) => {
                const pdfBox = getPdfBoxFromBrowser({ ...browserOption, x: d.x, y: d.y }, field.page);
                updateRadioOption(field.id, option.id, pdfBox);
              }}
              onResizeStop={(_e, _dir, ref, _delta, position) => {
                const pdfBox = getPdfBoxFromBrowser(
                  {
                    x: position.x,
                    y: position.y,
                    width: Number(ref.style.width.replace('px', '')),
                    height: Number(ref.style.height.replace('px', '')),
                  },
                  field.page,
                );
                updateRadioOption(field.id, option.id, pdfBox);
              }}
              className="mappedBox radioBox"
            >
              {field.key}:{option.value}
            </Rnd>
          );
        });
      }

      const browserField = getBrowserBox(field, field.page);

      return (
        <Rnd
          key={field.id}
          bounds="parent"
          size={{ width: browserField.width, height: browserField.height }}
          position={{ x: browserField.x, y: browserField.y }}
          onMouseDown={() => setSelectedFieldId(field.id)}
          onDragStop={(_e, d) => {
            const pdfBox = getPdfBoxFromBrowser({ ...browserField, x: d.x, y: d.y }, field.page);
            updateField(field.id, pdfBox);
          }}
          onResizeStop={(_e, _dir, ref, _delta, position) => {
            const pdfBox = getPdfBoxFromBrowser(
              {
                x: position.x,
                y: position.y,
                width: Number(ref.style.width.replace('px', '')),
                height: Number(ref.style.height.replace('px', '')),
              },
              field.page,
            );
            updateField(field.id, pdfBox);
          }}
          className={`mappedBox ${field.type}`}
        >
          {field.key}
        </Rnd>
      );
    });
  }

  return (
    <section className="pdf-visual-mapper">
      <h3 style={{ marginBottom: 4 }}>Visual PDF Field Mapper</h3>
      <p className="pdf-visual-hint">
        Drag and resize fields on the PDF. Coordinates are stored in PDF space (bottom-left origin).
      </p>

      <div className="gridLayout">
        <aside className="sidePanel">
          <h2>Admin Setup</h2>

          <div className="fieldBlock">
            <label>Form Name</label>
            <input value={templateName} readOnly />
          </div>

          <p className="smallText">
            PDF was uploaded from Templates. To use a different file, upload a new version from the Templates page.
          </p>

          <div className="divider" />

          <h3>Mark Fields</h3>

          <div className="buttonStack">
            <button type="button" onClick={() => setFields([...fields, emptyTextField(activePage)])}>
              Add Text Field
            </button>
            <button type="button" onClick={() => setFields([...fields, emptyCheckboxField(activePage)])}>
              Add Checkbox
            </button>
            <button type="button" onClick={() => setFields([...fields, emptyRadioField(activePage)])}>
              Add Yes/No Radio
            </button>
          </div>

          <div className="fieldBlock">
            <label>Active Page</label>
            <select
              value={activePage}
              onChange={(e) => setActivePage(Number(e.target.value))}
            >
              {Array.from({ length: Math.max(1, numPages) }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Page {i + 1}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="saveMappingBtn" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save Field Mapping'}
          </button>

          {message ? <p className="message">{message}</p> : null}

          {selectedField ? (
            <div className="fieldEditor">
              <h4>Selected Field</h4>
              <div className="fieldBlock">
                <label>Key</label>
                <input
                  value={selectedField.key}
                  onChange={(e) => updateField(selectedField.id, { key: e.target.value })}
                />
              </div>
              <div className="fieldBlock">
                <label>Label</label>
                <input
                  value={selectedField.label}
                  onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                />
              </div>
              {selectedField.type === 'text' ? (
                <div className="fieldBlock">
                  <label>Font Size</label>
                  <input
                    type="number"
                    value={selectedField.fontSize ?? 10}
                    onChange={(e) => updateField(selectedField.id, { fontSize: Number(e.target.value) })}
                  />
                </div>
              ) : null}
              {selectedField.type === 'radio' ? (
                <p className="smallText">Drag each Yes/No circle on the PDF to position it.</p>
              ) : null}
              <button type="button" className="deleteFieldBtn" onClick={() => removeField(selectedField.id)}>
                Delete Field
              </button>
            </div>
          ) : null}
        </aside>

        <main className="pdfArea">
          {pdfLoading ? <div className="pdfLoading">Loading PDF…</div> : null}
          {pdfError ? <div className="pdfError">{pdfError}</div> : null}
          {pdfFile && !pdfLoading && !pdfError ? (
            <Document
              file={pdfFile}
              onLoadSuccess={({ numPages: n }) => {
                setNumPages(n);
                setActivePage((p) => Math.min(Math.max(1, p), n || 1));
              }}
            >
              <div className="pageWrapper">
                <div className="pageTitle">Page {activePage}</div>
                <div className="pageCanvas" style={{ width: activePageWidth }}>
                  <Page
                    key={`page-${activePage}`}
                    pageNumber={activePage}
                    scale={PDF_DISPLAY_SCALE}
                    onLoadSuccess={(page) => pageLoaded(page, activePage)}
                    {...PDF_PAGE_CANVAS_ONLY}
                  />
                  {activePageSize ? renderFieldOverlays(activePage) : null}
                </div>
              </div>
            </Document>
          ) : null}
        </main>
      </div>
    </section>
  );
}
