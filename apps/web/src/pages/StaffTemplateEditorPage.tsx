import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, authHeader } from '../lib/api';
import { PdfFieldMapper } from '../components/PdfFieldMapper';
import { PdfVisualMapper } from '../components/PdfVisualMapper';
import '../styles/pdfVisualMapper.css';
import { EMPTY_FIELD_SCHEMA, type TemplateFieldSchema } from '../lib/fieldSchema';
import { formatTemplateStatus } from '../lib/staffLabels';

type Props = {
  token: string | null;
};

type TemplateField = {
  id: string;
  field_id: string;
  field_name: string;
  field_type: 'text' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'date' | 'signature' | 'radio_option' | 'box_char';
  acro_field_name: string;
  required: boolean;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options_json: string[];
  validation_json: Record<string, unknown>;
  section_key: string;
  display_order: number;
  font_size: number;
  group_id: string | null;
  group_value: string | null;
  parent_field_id: string | null;
};

type FieldGroup = {
  id: string;
  group_type: 'radio' | 'checkbox' | 'boxed_input';
  group_name: string;
  acro_group_name: string;
};

type TemplateDetail = {
  id: string;
  template_key: string;
  version: number;
  name: string;
  status: 'draft' | 'published' | 'archived';
  source_pdf_path: string;
  acroform_pdf_path: string | null;
  fields: TemplateField[];
  groups: FieldGroup[];
  field_schema?: TemplateFieldSchema;
  pdf_overlay_ready?: boolean;
};

type EditableField = {
  id?: string;
  field_id: string;
  field_name: string;
  /** Shown to parents as a second line (stored as validation_json.label_es) */
  label_es: string;
  field_type: TemplateField['field_type'];
  acro_field_name: string;
  required: boolean;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options_csv: string;
  validation_text: string;
  section_key: string;
  display_order: number;
  font_size: number;
  group_id: string;
  group_value: string;
  parent_field_id: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

function toEditableField(field: TemplateField): EditableField {
  const { rest, label_es } = splitValidationForEditor(field.validation_json ?? {});
  return {
    id: field.id,
    field_id: field.field_id,
    field_name: field.field_name,
    label_es,
    field_type: field.field_type,
    acro_field_name: field.acro_field_name,
    required: Boolean(field.required),
    page_number: Number(field.page_number ?? 1),
    x: Number(field.x ?? 0),
    y: Number(field.y ?? 0),
    width: Number(field.width ?? 120),
    height: Number(field.height ?? 18),
    options_csv: (field.options_json ?? []).join(', '),
    validation_text: JSON.stringify(rest, null, 2),
    section_key: field.section_key ?? 'General',
    display_order: Number(field.display_order ?? 0),
    font_size: Number(field.font_size ?? 12),
    group_id: field.group_id ?? '',
    group_value: field.group_value ?? '',
    parent_field_id: field.parent_field_id ?? '',
  };
}

function emptyField(): EditableField {
  return {
    field_id: '',
    field_name: '',
    label_es: '',
    field_type: 'text',
    acro_field_name: '',
    required: false,
    page_number: 1,
    x: 60,
    y: 700,
    width: 180,
    height: 18,
    options_csv: '',
    validation_text: '{}',
    section_key: 'General',
    display_order: 0,
    font_size: 12,
    group_id: '',
    group_value: '',
    parent_field_id: '',
  };
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseValidationJson(value: string): Record<string, unknown> {
  const text = value.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new Error('validation_json must be a JSON object');
}

/** Pull label_es out of validation_json so the JSON textarea and the Spanish line input stay in sync. */
function splitValidationForEditor(validation: Record<string, unknown>): { rest: Record<string, unknown>; label_es: string } {
  const rest = { ...validation };
  const raw = rest.label_es;
  delete rest.label_es;
  const label_es = typeof raw === 'string' ? raw : '';
  return { rest, label_es };
}

function ensureFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function toSnakeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildUniqueFieldId(base: string, existingIds: Set<string>): string {
  const normalizedBase = toSnakeId(base) || 'field';
  if (!existingIds.has(normalizedBase)) return normalizedBase;
  let index = 2;
  while (existingIds.has(`${normalizedBase}_${index}`)) {
    index += 1;
  }
  return `${normalizedBase}_${index}`;
}

function buildFieldPayload(draft: EditableField, existingIds: Set<string>, currentFieldId?: string) {
  const generatedFromName = buildUniqueFieldId(
    draft.field_id.trim() || draft.field_name.trim(),
    new Set([...existingIds].filter((id) => id !== (currentFieldId ?? ''))),
  );
  const fieldId = currentFieldId ? draft.field_id.trim() || currentFieldId : generatedFromName;

  const fieldName = draft.field_name.trim() || fieldId;

  const acroFieldName = draft.acro_field_name.trim() || fieldId;
  const validationJson = parseValidationJson(draft.validation_text);
  delete validationJson.label_es;
  const es = draft.label_es.trim();
  if (es) validationJson.label_es = es;

  return {
    field_id: fieldId,
    field_name: fieldName,
    field_type: draft.field_type,
    acro_field_name: acroFieldName,
    required: draft.required,
    page_number: Math.max(1, Math.round(ensureFiniteNumber(Number(draft.page_number), 1))),
    x: Math.max(0, ensureFiniteNumber(Number(draft.x), 0)),
    y: Math.max(0, ensureFiniteNumber(Number(draft.y), 0)),
    width: Math.max(10, ensureFiniteNumber(Number(draft.width), 120)),
    height: Math.max(10, ensureFiniteNumber(Number(draft.height), 18)),
    options_json: parseCsv(draft.options_csv),
    validation_json: validationJson,
    section_key: draft.section_key.trim() || 'General',
    display_order: Math.max(0, Math.round(ensureFiniteNumber(Number(draft.display_order), 0))),
    font_size: Math.max(4, ensureFiniteNumber(Number(draft.font_size), 12)),
    group_id: draft.group_id.trim() || null,
    group_value: draft.group_value.trim() || null,
    parent_field_id: draft.parent_field_id.trim() || null,
  };
}

export function StaffTemplateEditorPage({ token }: Props) {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [newField, setNewField] = useState<EditableField>(() => emptyField());
  const [editing, setEditing] = useState<Record<string, EditableField>>({});
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [selectedMapFieldId, setSelectedMapFieldId] = useState<string | null>(null);
  const [fieldSchema, setFieldSchema] = useState<TemplateFieldSchema>(EMPTY_FIELD_SCHEMA);
  const savedSchemaJsonRef = useRef(JSON.stringify(EMPTY_FIELD_SCHEMA));

  function toggleFieldExpanded(fieldId: string) {
    setExpandedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [acroPreviewUrl, setAcroPreviewUrl] = useState<string | null>(null);

  // Groups state
  const [newGroup, setNewGroup] = useState<{ group_type: FieldGroup['group_type']; group_name: string; acro_group_name: string }>({
    group_type: 'radio',
    group_name: '',
    acro_group_name: '',
  });

  // Boxed input wizard — keep refs in sync so the stable onPositionPick callback never reads stale values
  const [boxedStep, _setBoxedStep] = useState<'idle' | 'awaiting_first' | 'awaiting_last'>('idle');
  const boxedStepRef = useRef<'idle' | 'awaiting_first' | 'awaiting_last'>('idle');
  function setBoxedStep(v: 'idle' | 'awaiting_first' | 'awaiting_last') { boxedStepRef.current = v; _setBoxedStep(v); }

  const [boxedGroupName, _setBoxedGroupName] = useState('');
  const boxedGroupNameRef = useRef('');
  function setBoxedGroupName(v: string) { boxedGroupNameRef.current = v; _setBoxedGroupName(v); }

  const [boxedAcroGroupName, _setBoxedAcroGroupName] = useState('');
  const boxedAcroGroupNameRef = useRef('');
  function setBoxedAcroGroupName(v: string) { boxedAcroGroupNameRef.current = v; _setBoxedAcroGroupName(v); }

  const [boxedFirstPos, _setBoxedFirstPos] = useState<{ x: number; y: number; width: number; height: number; page_number: number } | null>(null);
  const boxedFirstPosRef = useRef<{ x: number; y: number; width: number; height: number; page_number: number } | null>(null);
  function setBoxedFirstPos(v: typeof boxedFirstPosRef.current) { boxedFirstPosRef.current = v; _setBoxedFirstPos(v); }

  async function loadTemplate() {
    if (!token) return;
    setError('');
    try {
      const detail = await api<TemplateDetail>(`/api/staff/templates/${id}`, {
        headers: authHeader(token),
      });
      setTemplate(detail);
      const loadedSchema =
        detail.field_schema && Array.isArray(detail.field_schema.fields)
          ? detail.field_schema
          : EMPTY_FIELD_SCHEMA;
      setFieldSchema(loadedSchema);
      savedSchemaJsonRef.current = JSON.stringify(loadedSchema);
      const mapped: Record<string, EditableField> = {};
      for (const field of detail.fields ?? []) {
        mapped[field.id] = toEditableField(field);
      }
      setEditing(mapped);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!token) {
      navigate('/staff/login');
      return;
    }
    loadTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
      if (acroPreviewUrl) URL.revokeObjectURL(acroPreviewUrl);
    };
  }, [sourcePreviewUrl, acroPreviewUrl]);

  const sortedFields = useMemo(() => {
    return [...(template?.fields ?? [])].sort((a, b) => {
      if ((a.section_key ?? '') !== (b.section_key ?? '')) {
        return (a.section_key ?? '').localeCompare(b.section_key ?? '');
      }
      return Number(a.display_order ?? 0) - Number(b.display_order ?? 0);
    });
  }, [template]);

  const existingFieldIds = useMemo(() => new Set((template?.fields ?? []).map((field) => field.field_id)), [template]);

  const autoDraftFieldId = useMemo(() => {
    return buildUniqueFieldId(newField.field_id.trim() || newField.field_name.trim(), existingFieldIds);
  }, [newField.field_id, newField.field_name, existingFieldIds]);

  async function addField() {
    if (!token || !template) return;
    setError('');

    try {
      const payload = buildFieldPayload(
        {
          ...newField,
          field_id: autoDraftFieldId,
        },
        existingFieldIds,
      );
      setSaving('new-field');
      await api(`/api/staff/templates/${template.id}/fields`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(payload),
      });

      setNewField((prev) => ({
        ...emptyField(),
        page_number: prev.page_number,
        field_type: prev.field_type,
        section_key: prev.section_key,
      }));
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function saveField(fieldDbId: string) {
    if (!token || !template) return;
    const draft = editing[fieldDbId];
    if (!draft) return;

    setError('');
    try {
      const payload = buildFieldPayload(draft, existingFieldIds, fieldDbId ? (template.fields.find((f) => f.id === fieldDbId)?.field_id ?? undefined) : undefined);
      setSaving(`field-${fieldDbId}`);
      await api(`/api/staff/templates/${template.id}/fields/${fieldDbId}`, {
        method: 'PATCH',
        headers: authHeader(token),
        body: JSON.stringify(payload),
      });
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function deleteField(fieldDbId: string) {
    if (!token || !template) return;
    setError('');

    const targetField = template.fields.find((f) => f.id === fieldDbId);
    const groupTypes = ['box_char', 'radio_option'];
    const isGroupField = targetField && groupTypes.includes(targetField.field_type) && targetField.group_id;
    const groupSiblings = isGroupField
      ? template.fields.filter((f) => f.group_id === targetField.group_id)
      : null;

    try {
      setSaving(`delete-${fieldDbId}`);
      if (groupSiblings && groupSiblings.length > 1) {
        await Promise.all(
          groupSiblings.map((f) =>
            api(`/api/staff/templates/${template.id}/fields/${f.id}`, {
              method: 'DELETE',
              headers: authHeader(token),
            }),
          ),
        );
      } else {
        await api(`/api/staff/templates/${template.id}/fields/${fieldDbId}`, {
          method: 'DELETE',
          headers: authHeader(token),
        });
      }
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function generateAcroform() {
    if (!token || !template) return;
    setError('');

    try {
      setSaving('generate');
      await api(`/api/staff/templates/${template.id}/generate-acroform`, {
        method: 'POST',
        headers: authHeader(token),
      });
      await loadTemplate();
      await loadPreview('acroform');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function saveFieldSchemaToServer(schema: TemplateFieldSchema): Promise<boolean> {
    if (!token || !template) return false;
    setError('');
    try {
      setSaving('schema');
      await api(`/api/staff/templates/${template.id}/schema`, {
        method: 'PUT',
        headers: authHeader(token),
        body: JSON.stringify(schema),
      });
      savedSchemaJsonRef.current = JSON.stringify(schema);
      await loadTemplate();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving('');
    }
  }

  async function publishTemplate() {
    if (!token || !template) return;
    setError('');

    const isMchat = /^mchat/i.test(template.template_key);
    if (isMchat && fieldSchema.fields.length === 0) {
      setError('Map at least one field on the PDF before publishing.');
      return;
    }

    try {
      setSaving('publish');
      await api(`/api/staff/templates/${template.id}/publish`, {
        method: 'POST',
        headers: authHeader(token),
        body: isMchat ? JSON.stringify(fieldSchema) : undefined,
      });
      savedSchemaJsonRef.current = JSON.stringify(fieldSchema);
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function loadPreview(kind: 'source' | 'acroform') {
    if (!token || !template) return;
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/staff/templates/${template.id}/${kind}`, {
        headers: authHeader(token),
      });

      if (!response.ok) {
        let message = `Failed to load ${kind} PDF`;
        try {
          const payload = await response.json();
          message = payload?.error?.message ?? message;
        } catch {
          // ignore
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (kind === 'source') {
        if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
        setSourcePreviewUrl(objectUrl);
      } else {
        if (acroPreviewUrl) URL.revokeObjectURL(acroPreviewUrl);
        setAcroPreviewUrl(objectUrl);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createGroup() {
    if (!token || !template) return;
    if (!newGroup.group_name.trim() || !newGroup.acro_group_name.trim()) {
      setError('Group name and acro group name are required.');
      return;
    }
    setError('');
    try {
      setSaving('new-group');
      await api(`/api/staff/templates/${template.id}/groups`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify(newGroup),
      });
      setNewGroup({ group_type: 'radio', group_name: '', acro_group_name: '' });
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function deleteGroup(gid: string) {
    if (!token || !template) return;
    setError('');
    try {
      setSaving(`delete-group-${gid}`);
      await api(`/api/staff/templates/${template.id}/groups/${gid}`, {
        method: 'DELETE',
        headers: authHeader(token),
      });
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  // Use a stable ref so this function can be called from a stale onPositionPick closure
  const templateRef = useRef(template);
  useEffect(() => { templateRef.current = template; }, [template]);

  // Refs kept fresh each render — used by the keydown undo handler (empty-dep effect)
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  const existingFieldIdsRef = useRef(existingFieldIds);
  useEffect(() => { existingFieldIdsRef.current = existingFieldIds; }, [existingFieldIds]);
  const loadTemplateRef = useRef(loadTemplate);
  useEffect(() => { loadTemplateRef.current = loadTemplate; });
  const selectedMapFieldIdRef = useRef(selectedMapFieldId);
  useEffect(() => { selectedMapFieldIdRef.current = selectedMapFieldId; }, [selectedMapFieldId]);
  const deleteFieldRef = useRef(deleteField);
  useEffect(() => { deleteFieldRef.current = deleteField; });

  // History stack for Cmd+Z undo of drag-move/resize operations
  const posHistoryRef = useRef<Array<{ fieldDbId: string; x: number; y: number; width: number; height: number }>>([]);

  useEffect(() => {
    async function doUndo() {
      const entry = posHistoryRef.current.pop();
      if (!entry) return;

      const tk = tokenRef.current;
      const tmpl = templateRef.current;
      const ed = editingRef.current;
      const existingIds = existingFieldIdsRef.current;
      if (!tk || !tmpl) return;

      const draft = ed[entry.fieldDbId];
      if (!draft) return;

      const revertedDraft = { ...draft, x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      setEditing((prev) => ({ ...prev, [entry.fieldDbId]: revertedDraft }));

      try {
        const currentFieldId = tmpl.fields.find((f) => f.id === entry.fieldDbId)?.field_id;
        const payload = buildFieldPayload(revertedDraft, existingIds, currentFieldId);
        setSaving(`field-${entry.fieldDbId}`);
        await api(`/api/staff/templates/${tmpl.id}/fields/${entry.fieldDbId}`, {
          method: 'PATCH',
          headers: authHeader(tk),
          body: JSON.stringify(payload),
        });
        await loadTemplateRef.current();
      } catch (e) {
        setError((e as Error).message);
        posHistoryRef.current.push(entry); // re-push so undo can be retried
      } finally {
        setSaving('');
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        if (posHistoryRef.current.length === 0) return;
        e.preventDefault();
        doUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const fieldId = selectedMapFieldIdRef.current;
        if (!fieldId) return;
        e.preventDefault();
        setSelectedMapFieldId(null);
        deleteFieldRef.current(fieldId);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // empty deps — all values accessed via refs

  async function createBoxedInputBoxes(lastPos: { x: number; y: number; width: number; height: number; page_number: number }) {
    const firstPos = boxedFirstPosRef.current;
    const groupName = boxedGroupNameRef.current;
    const acroName = boxedAcroGroupNameRef.current;
    const tmpl = templateRef.current;

    if (!token || !tmpl || !firstPos) {
      setError('Boxed input wizard lost state — please try again.');
      setBoxedStep('idle');
      return;
    }
    setError('');

    // Find or create a boxed_input group
    let group = (tmpl.groups ?? []).find((g) => g.acro_group_name === acroName);
    if (!group) {
      if (!groupName.trim() || !acroName.trim()) {
        setError('Enter a group name and acro group name before placing boxes.');
        return;
      }
      try {
        setSaving('boxed-group');
        group = await api<FieldGroup>(`/api/staff/templates/${tmpl.id}/groups`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({ group_type: 'boxed_input', group_name: groupName, acro_group_name: acroName }),
        });
      } catch (e) {
        setError((e as Error).message);
        setSaving('');
        return;
      }
    }

    const boxW = firstPos.width;
    const boxH = firstPos.height;
    const gap = 2;
    const totalSpan = lastPos.x + lastPos.width - firstPos.x;
    const count = Math.max(2, Math.round(totalSpan / (boxW + gap)));

    setSaving('boxed-creating');
    try {
      const existingIds = new Set((tmpl.fields ?? []).map((f) => f.field_id));
      for (let i = 0; i < count; i++) {
        const boxX = firstPos.x + i * (boxW + gap);
        const boxFieldId = buildUniqueFieldId(`${acroName}_${i}`, existingIds);
        existingIds.add(boxFieldId);
        await api(`/api/staff/templates/${tmpl.id}/fields`, {
          method: 'POST',
          headers: authHeader(token),
          body: JSON.stringify({
            field_id: boxFieldId,
            field_name: `${groupName} [${i}]`,
            field_type: 'box_char',
            acro_field_name: `${acroName}_${i}`,
            page_number: firstPos.page_number,
            x: boxX,
            y: firstPos.y,
            width: boxW,
            height: boxH,
            group_id: group!.id,
            group_value: String(i),
            font_size: 12,
          }),
        });
      }
      setBoxedStep('idle');
      setBoxedFirstPos(null);
      setBoxedGroupName('');
      setBoxedAcroGroupName('');
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  // Stable ref to createBoxedInputBoxes so PdfFieldMapper's onPositionPick never goes stale
  const createBoxedInputBoxesRef = useRef(createBoxedInputBoxes);
  useEffect(() => { createBoxedInputBoxesRef.current = createBoxedInputBoxes; });

  async function addReasonTextField(radioOptionField: TemplateField) {
    if (!token || !template) return;
    setError('');
    const existingIds = new Set((template.fields ?? []).map((f) => f.field_id));
    const reasonId = buildUniqueFieldId(`${radioOptionField.field_id}_reason`, existingIds);
    try {
      setSaving(`reason-${radioOptionField.id}`);
      await api(`/api/staff/templates/${template.id}/fields`, {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({
          field_id: reasonId,
          field_name: `${radioOptionField.field_name} — Reason`,
          field_type: 'text',
          acro_field_name: reasonId,
          page_number: radioOptionField.page_number,
          x: radioOptionField.x + radioOptionField.width + 4,
          y: radioOptionField.y,
          width: 120,
          height: radioOptionField.height,
          parent_field_id: radioOptionField.id,
          font_size: 10,
        }),
      });
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function handleFieldPositionUpdate(
    fieldDbId: string,
    pos: { x: number; y: number; width: number; height: number },
  ) {
    if (!token || !template) return;
    const draft = editing[fieldDbId];
    if (!draft) return;

    // Save current position to history so Cmd+Z can revert it
    posHistoryRef.current.push({ fieldDbId, x: draft.x, y: draft.y, width: draft.width, height: draft.height });

    const updatedDraft = { ...draft, x: pos.x, y: pos.y, width: pos.width, height: pos.height };
    setEditing((prev) => ({ ...prev, [fieldDbId]: updatedDraft }));

    setError('');
    try {
      const currentFieldId = template.fields.find((f) => f.id === fieldDbId)?.field_id;
      const payload = buildFieldPayload(updatedDraft, existingFieldIds, currentFieldId);
      setSaving(`field-${fieldDbId}`);
      await api(`/api/staff/templates/${template.id}/fields/${fieldDbId}`, {
        method: 'PATCH',
        headers: authHeader(token),
        body: JSON.stringify(payload),
      });
      await loadTemplate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }

  if (!template) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading template editor...</p>
        </div>
      </div>
    );
  }

  const isMchatTemplate = /^mchat/i.test(template.template_key);
  const overlayFieldCount = fieldSchema.fields.length;
  const schemaDirty = JSON.stringify(fieldSchema) !== savedSchemaJsonRef.current;

  async function saveFieldSchema() {
    await saveFieldSchemaToServer(fieldSchema);
  }

  if (isMchatTemplate) {
    return (
      <div className="mchat-editor-wrap">
        <div className="card">
          <Link to="/staff/templates">← Back to your forms</Link>
          <h2>
            {template.name} (v{template.version})
          </h2>
          <p>
            Form ID: <span className="badge">{template.template_key}</span> Status:{' '}
            <span className="badge">{formatTemplateStatus(template.status)}</span>
          </p>
          {error ? <div className="error">{error}</div> : null}
          <div className="mchat-editor-actions">
            <button
              type="button"
              className="secondary"
              style={{ width: 'auto', minWidth: 140 }}
              onClick={() => loadPreview('source')}
            >
              Preview Source PDF
            </button>
            <button
              type="button"
              className="mchat-publish-btn"
              onClick={publishTemplate}
              disabled={saving === 'publish' || saving === 'schema' || overlayFieldCount === 0}
              title={
                overlayFieldCount === 0
                  ? 'Add at least one field on the PDF first'
                  : 'Saves your mapping, then publishes for patient assignments'
              }
            >
              {saving === 'publish' ? 'Publishing…' : schemaDirty ? 'Save & Publish Version' : 'Publish Version'}
            </button>
          </div>
          {schemaDirty ? (
            <p style={{ fontSize: 13, color: '#92400e', marginTop: 8 }}>
              You have unsaved field changes. Publish will save your mapping automatically, or use{' '}
              <strong>Save Field Mapping</strong> first.
            </p>
          ) : null}
          {template.status === 'published' ? (
            <p style={{ fontSize: 13, color: '#555', marginTop: 8 }}>
              After changing the mapping, publish again and create a <strong>new patient assignment</strong> so the fill
              link uses this version.
            </p>
          ) : null}
          <p style={{ fontSize: 13, color: '#1a5f1a', padding: '8px 12px', background: '#ecfdf3', borderRadius: 6 }}>
            <strong>M-CHAT overlay mode:</strong> Map Yes/No and text on the PDF. Parents fill on the PDF — not AcroForm.
          </p>
          {token ? (
            <PdfVisualMapper
              templateId={template.id}
              token={token}
              templateName={template.name}
              schema={fieldSchema}
              onSchemaChange={setFieldSchema}
              onSave={saveFieldSchema}
              saving={saving === 'schema'}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <Link to="/staff/templates">← Back to your forms</Link>
        <h2>
          {template.name} (v{template.version})
        </h2>
        <p>
          Form ID: <span className="badge">{template.template_key}</span> Status: <span className="badge">{formatTemplateStatus(template.status)}</span>
        </p>

        {error ? <div className="error">{error}</div> : null}

        <div className="actions" style={{ gridTemplateColumns: 'repeat(5, minmax(100px, 1fr))' }}>
          <button className="secondary" onClick={() => loadPreview('source')}>
            Preview Source
          </button>
          <button
            className="secondary"
            onClick={() => loadPreview('acroform')}
            disabled={!template.acroform_pdf_path}
            title={!template.acroform_pdf_path ? 'Import fields or generate an AcroForm PDF first' : 'Preview AcroForm PDF'}
          >
            Preview AcroForm
          </button>
          {!isMchatTemplate ? (
          <button
            type="button"
            className="secondary"
            disabled={Boolean(saving)}
            onClick={async () => {
              if (!token || !template) return;
              setError('');
              const hasFields = (template.fields?.length ?? 0) > 0;
              let replace = false;
              if (hasFields) {
                replace = window.confirm(
                  'This template already has field definitions. Replace them with fields imported from the PDF? (Existing manual mappings will be removed.)',
                );
                if (!replace) return;
              }
              try {
                setSaving('import-acro');
                const q = hasFields ? '?replace=1' : '';
                await api(`/api/staff/templates/${template.id}/import-acrofields${q}`, {
                  method: 'POST',
                  headers: authHeader(token),
                });
                await loadTemplate();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving('');
              }
            }}
          >
            {saving === 'import-acro' ? 'Importing…' : 'Import PDF Fields'}
          </button>
          ) : null}
          {!isMchatTemplate ? (
          <button onClick={generateAcroform} disabled={saving === 'generate'}>
            {saving === 'generate' ? 'Generating...' : 'Generate AcroForm'}
          </button>
          ) : null}
          <button
            onClick={publishTemplate}
            disabled={
              saving === 'publish' ||
              (isMchatTemplate
                ? overlayFieldCount === 0
                : !template.acroform_pdf_path)
            }
            title={
              isMchatTemplate
                ? 'Publish when source PDF is uploaded and fields are mapped on the PDF'
                : !template.acroform_pdf_path
                  ? 'Import PDF fields or generate an AcroForm before publishing'
                  : ''
            }
          >
            {saving === 'publish' ? 'Publishing...' : 'Publish Version'}
          </button>
        </div>
        {!template.acroform_pdf_path && (
          <p style={{ fontSize: 13, color: '#888', marginTop: 6 }}>
            No AcroForm yet — if your PDF already has fillable fields, click <strong>Import PDF Fields</strong> (the source file will be used as the AcroForm). Otherwise place fields on the mapper and click{' '}
            <strong>Generate AcroForm</strong>.
          </p>
        )}
        {template.acroform_pdf_path && template.acroform_pdf_path === template.source_pdf_path && (
          <p style={{ fontSize: 13, color: '#1a5f1a', marginTop: 8, padding: '8px 12px', background: '#ecfdf3', borderRadius: 6 }}>
            This version uses the <strong>embedded fillable PDF</strong> as the AcroForm (no separate generated overlay file). Publishing is allowed as soon as fields exist. For flat PDFs you would use <strong>Generate AcroForm</strong> instead.
          </p>
        )}

        {/* ─── Groups Panel ──────────────────────────────────────────── */}
        <>
        <h3 style={{ marginTop: 24 }}>Field Groups</h3>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Create radio groups, checkbox groups, or boxed-input sequences before placing their fields.
        </p>
        {(template.groups ?? []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(template.groups ?? []).map((g) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#eef4ff', border: '1px solid #cfe0ff', borderRadius: 6, padding: '4px 10px', fontSize: 13 }}>
                <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>{g.group_type}</span>
                <strong>{g.group_name}</strong>
                <span style={{ color: '#888' }}>({g.acro_group_name})</span>
                <button
                  className="secondary"
                  style={{ padding: '2px 8px', fontSize: 12 }}
                  disabled={saving === `delete-group-${g.id}`}
                  onClick={() => deleteGroup(g.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ alignItems: 'end' }}>
          <div className="field">
            <label>Group Type</label>
            <select value={newGroup.group_type} onChange={(e) => setNewGroup((prev) => ({ ...prev, group_type: e.target.value as FieldGroup['group_type'] }))}>
              <option value="radio">Radio</option>
              <option value="checkbox">Checkbox</option>
              <option value="boxed_input">Boxed Input</option>
            </select>
          </div>
          <div className="field">
            <label>Group Name (display)</label>
            <input value={newGroup.group_name} onChange={(e) => setNewGroup((prev) => ({ ...prev, group_name: e.target.value }))} placeholder="e.g. Race / Ethnicity" />
          </div>
          <div className="field">
            <label>Acro Group Name (PDF)</label>
            <input value={newGroup.acro_group_name} onChange={(e) => setNewGroup((prev) => ({ ...prev, acro_group_name: e.target.value }))} placeholder="e.g. race_ethnicity" />
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
            <button onClick={createGroup} disabled={saving === 'new-group'} style={{ whiteSpace: 'nowrap' }}>
              {saving === 'new-group' ? 'Creating...' : '+ Create Group'}
            </button>
          </div>
        </div>

        {/* ─── Boxed Input Wizard ─────────────────────────────────────── */}
        <h3 style={{ marginTop: 24 }}>Boxed Input Wizard</h3>
        <p style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
          Auto-generates evenly spaced single-character boxes between a first and last position.
        </p>
        {boxedStep === 'idle' && (
          <div className="row" style={{ alignItems: 'end' }}>
            <div className="field">
              <label>Group Name</label>
              <input value={boxedGroupName} onChange={(e) => setBoxedGroupName(e.target.value)} placeholder="e.g. Date of Birth" />
            </div>
            <div className="field">
              <label>Acro Group Name</label>
              <input value={boxedAcroGroupName} onChange={(e) => setBoxedAcroGroupName(e.target.value)} placeholder="e.g. dob" />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
              <button
                onClick={() => {
                  if (!boxedGroupName.trim() || !boxedAcroGroupName.trim()) {
                    setError('Enter group name and acro group name first.');
                    return;
                  }
                  setError('');
                  setBoxedStep('awaiting_first');
                }}
              >
                Start Boxed Input
              </button>
            </div>
          </div>
        )}
        {boxedStep === 'awaiting_first' && (
          <div style={{ padding: '10px 14px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, marginBottom: 8 }}>
            <strong>Step 1:</strong> Drag to draw the <strong>first (leftmost) box</strong> on the PDF canvas below.
            <button className="secondary" style={{ marginLeft: 12, padding: '2px 10px' }} onClick={() => setBoxedStep('idle')}>Cancel</button>
          </div>
        )}
        {boxedStep === 'awaiting_last' && boxedFirstPos && (
          <div style={{ padding: '10px 14px', background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, marginBottom: 8 }}>
            <strong>Step 2:</strong> Drag to draw the <strong>last (rightmost) box</strong> on the PDF canvas below. First box recorded at x={Math.round(boxedFirstPos.x)}, y={Math.round(boxedFirstPos.y)}, w={Math.round(boxedFirstPos.width)}.
            <button className="secondary" style={{ marginLeft: 12, padding: '2px 10px' }} onClick={() => { setBoxedStep('idle'); setBoxedFirstPos(null); }}>Cancel</button>
          </div>
        )}
        {saving === 'boxed-creating' && <p style={{ color: '#1a6fd4' }}>Creating boxes...</p>}

        <h3 style={{ marginTop: 24 }}>Add Field</h3>
        <PdfFieldMapper
          templateId={template.id}
          token={token!}
          fields={template.fields ?? []}
          draftField={{
            field_id: autoDraftFieldId,
            field_name: newField.field_name,
            page_number: newField.page_number,
            x: newField.x,
            y: newField.y,
            width: newField.width,
            height: newField.height,
          }}
          onPageChange={(pageNumber) => setNewField((prev) => ({ ...prev, page_number: pageNumber }))}
          selectedFieldId={selectedMapFieldId}
          onFieldSelect={setSelectedMapFieldId}
          onFieldUpdate={handleFieldPositionUpdate}
          onFieldDelete={(fieldDbId) => { setSelectedMapFieldId(null); deleteField(fieldDbId); }}
          onPositionPick={({ x, y, width, height, page_number }) => {
            // Read from refs so this inline callback is never stale
            if (boxedStepRef.current === 'awaiting_first') {
              setBoxedFirstPos({ x, y, width, height, page_number });
              setBoxedStep('awaiting_last');
              return;
            }
            if (boxedStepRef.current === 'awaiting_last') {
              createBoxedInputBoxesRef.current({ x, y, width, height, page_number });
              return;
            }
            setNewField((prev) => ({ ...prev, x, y, width, height, page_number }));
          }}
        />

        <div className="row">
          <div className="field">
            <label>Field ID (Auto)</label>
            <input value={autoDraftFieldId} readOnly />
          </div>
          <div className="field">
            <label>Question label (English)</label>
            <input
              value={newField.field_name}
              onChange={(event) => setNewField((prev) => ({ ...prev, field_name: event.target.value }))}
            />
          </div>
          <div className="field">
            <label>Acro Field Name</label>
            <input
              value={newField.acro_field_name}
              onChange={(event) => setNewField((prev) => ({ ...prev, acro_field_name: event.target.value }))}
            />
          </div>
          <div className="field">
            <label>Type</label>
            <select
              value={newField.field_type}
              onChange={(event) => setNewField((prev) => ({ ...prev, field_type: event.target.value as TemplateField['field_type'] }))}
            >
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="checkbox">checkbox</option>
              <option value="radio">radio</option>
              <option value="radio_option">radio_option (placed individually)</option>
              <option value="select">select</option>
              <option value="date">date</option>
              <option value="signature">signature</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: '1 1 320px' }}>
            <label>Spanish label (optional)</label>
            <input
              value={newField.label_es}
              onChange={(event) => setNewField((prev) => ({ ...prev, label_es: event.target.value }))}
              placeholder="Second line on the parent form; PDF / Acro names stay the same"
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Section</label>
            <input value={newField.section_key} onChange={(event) => setNewField((prev) => ({ ...prev, section_key: event.target.value }))} />
          </div>
          <div className="field">
            <label>Display Order</label>
            <input
              type="number"
              value={newField.display_order}
              onChange={(event) => setNewField((prev) => ({ ...prev, display_order: Number(event.target.value) || 0 }))}
            />
          </div>
          <div className="field">
            <label>Page Number</label>
            <input
              type="number"
              value={newField.page_number}
              onChange={(event) => setNewField((prev) => ({ ...prev, page_number: Number(event.target.value) || 1 }))}
            />
          </div>
          <div className="field">
            <label>Font Size</label>
            <input
              type="number"
              value={newField.font_size}
              min={4}
              max={72}
              onChange={(event) => setNewField((prev) => ({ ...prev, font_size: Number(event.target.value) || 12 }))}
            />
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={newField.required}
                onChange={(event) => setNewField((prev) => ({ ...prev, required: event.target.checked }))}
                style={{ width: 18, height: 18 }}
              />
              <span>Required</span>
            </label>
          </div>
          {(newField.field_type === 'radio_option' || newField.field_type === 'checkbox') && (
            <div className="field">
              <label>Group</label>
              <select
                value={newField.group_id}
                onChange={(event) => setNewField((prev) => ({ ...prev, group_id: event.target.value }))}
              >
                <option value="">— none —</option>
                {(template.groups ?? [])
                  .filter((g) => newField.field_type === 'radio_option' ? g.group_type === 'radio' : g.group_type === 'checkbox')
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.group_name} ({g.acro_group_name})</option>
                  ))}
              </select>
            </div>
          )}
          {newField.field_type === 'radio_option' && (
            <div className="field">
              <label>Option Value</label>
              <input
                value={newField.group_value}
                onChange={(event) => setNewField((prev) => ({ ...prev, group_value: event.target.value }))}
                placeholder="e.g. Yes / No / Hispanic"
              />
            </div>
          )}
        </div>

        <div className="row">
          <div className="field">
            <label>X</label>
            <input type="number" value={newField.x} onChange={(event) => setNewField((prev) => ({ ...prev, x: Number(event.target.value) || 0 }))} />
          </div>
          <div className="field">
            <label>Y</label>
            <input type="number" value={newField.y} onChange={(event) => setNewField((prev) => ({ ...prev, y: Number(event.target.value) || 0 }))} />
          </div>
          <div className="field">
            <label>Width</label>
            <input
              type="number"
              value={newField.width}
              onChange={(event) => setNewField((prev) => ({ ...prev, width: Number(event.target.value) || 120 }))}
            />
          </div>
          <div className="field">
            <label>Height</label>
            <input
              type="number"
              value={newField.height}
              onChange={(event) => setNewField((prev) => ({ ...prev, height: Number(event.target.value) || 18 }))}
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Options (comma-separated)</label>
            <input
              value={newField.options_csv}
              onChange={(event) => setNewField((prev) => ({ ...prev, options_csv: event.target.value }))}
              placeholder="Yes, No"
            />
          </div>
          <div className="field">
            <label>Validation JSON (omit <code>label_es</code> — use Spanish label field)</label>
            <textarea
              value={newField.validation_text}
              onChange={(event) => setNewField((prev) => ({ ...prev, validation_text: event.target.value }))}
              style={{ minHeight: 80 }}
            />
          </div>
        </div>

        <button onClick={addField} disabled={saving === 'new-field'}>
          {saving === 'new-field' ? 'Adding...' : 'Add Field'}
        </button>

        <h3 style={{ marginTop: 24 }}>Fields</h3>
        {sortedFields.length === 0 ? <p>No fields yet.</p> : null}

        {sortedFields.map((field) => {
          const draft = editing[field.id] ?? toEditableField(field);
          return (
            <div key={field.id} className="card" style={{ marginBottom: 8, background: '#f9fbff', padding: 0, overflow: 'hidden' }}>
              {/* ── Collapsed header row ── */}
              <div
                onClick={() => toggleFieldExpanded(field.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  cursor: 'pointer', userSelect: 'none',
                  background: expandedFields.has(field.id) ? '#e8f0fe' : '#f9fbff',
                  borderBottom: expandedFields.has(field.id) ? '1px solid #cfe0ff' : 'none',
                }}
              >
                <span style={{ fontSize: 13, color: '#555', minWidth: 16 }}>{expandedFields.has(field.id) ? '▾' : '▸'}</span>
                <span style={{ fontWeight: 600, flex: 1, fontSize: 14 }}>{draft.field_name || draft.field_id}</span>
                <span className="badge" style={{ fontSize: 11 }}>{draft.field_type}</span>
                <span style={{ fontSize: 12, color: '#888' }}>{draft.section_key}</span>
                <span style={{ fontSize: 12, color: '#aaa' }}>pg {draft.page_number}</span>
              </div>

              {expandedFields.has(field.id) && (
              <div style={{ padding: '12px 14px' }}>
              <div className="row">
                <div className="field">
                  <label>Field ID</label>
                  <input value={draft.field_id} readOnly />
                </div>
                <div className="field">
                  <label>Question label (English)</label>
                  <input
                    value={draft.field_name}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, field_name: event.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Acro Name</label>
                  <input
                    value={draft.acro_field_name}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, acro_field_name: event.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select
                    value={draft.field_type}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, field_type: event.target.value as TemplateField['field_type'] },
                      }))
                    }
                  >
                    <option value="text">text</option>
                    <option value="textarea">textarea</option>
                    <option value="checkbox">checkbox</option>
                    <option value="radio">radio</option>
                    <option value="radio_option">radio_option (placed individually)</option>
                    <option value="select">select</option>
                    <option value="date">date</option>
                    <option value="signature">signature</option>
                    <option value="box_char">box_char</option>
                  </select>
                </div>
              </div>

              <div className="row">
                <div className="field" style={{ flex: '1 1 320px' }}>
                  <label>Spanish label (optional)</label>
                  <input
                    value={draft.label_es}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, label_es: event.target.value },
                      }))
                    }
                    placeholder="Second line on the parent form; PDF / Acro names stay the same"
                  />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Section</label>
                  <input
                    value={draft.section_key}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, section_key: event.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Display Order</label>
                  <input
                    type="number"
                    value={draft.display_order}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, display_order: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Page</label>
                  <input
                    type="number"
                    value={draft.page_number}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, page_number: Number(event.target.value) || 1 },
                      }))
                    }
                  />
                </div>
                <div className="field" style={{ display: 'flex', alignItems: 'end' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      checked={draft.required}
                      onChange={(event) =>
                        setEditing((prev) => ({
                          ...prev,
                          [field.id]: { ...draft, required: event.target.checked },
                        }))
                      }
                      style={{ width: 18, height: 18 }}
                    />
                    <span>Required</span>
                  </label>
                </div>
                <div className="field">
                  <label>Font Size</label>
                  <input
                    type="number"
                    value={draft.font_size}
                    min={4}
                    max={72}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, font_size: Number(event.target.value) || 12 },
                      }))
                    }
                  />
                </div>
              </div>

              {(draft.field_type === 'radio_option' || draft.field_type === 'checkbox') && (
                <div className="row">
                  <div className="field">
                    <label>Group</label>
                    <select
                      value={draft.group_id}
                      onChange={(event) =>
                        setEditing((prev) => ({ ...prev, [field.id]: { ...draft, group_id: event.target.value } }))
                      }
                    >
                      <option value="">— none —</option>
                      {(template.groups ?? [])
                        .filter((g) => draft.field_type === 'radio_option' ? g.group_type === 'radio' : g.group_type === 'checkbox')
                        .map((g) => (
                          <option key={g.id} value={g.id}>{g.group_name} ({g.acro_group_name})</option>
                        ))}
                    </select>
                  </div>
                  {draft.field_type === 'radio_option' && (
                    <div className="field">
                      <label>Option Value</label>
                      <input
                        value={draft.group_value}
                        onChange={(event) =>
                          setEditing((prev) => ({ ...prev, [field.id]: { ...draft, group_value: event.target.value } }))
                        }
                        placeholder="e.g. Yes / No / Hispanic"
                      />
                    </div>
                  )}
                </div>
              )}

              {draft.field_type === 'radio_option' && !field.parent_field_id && (
                <div style={{ marginBottom: 8 }}>
                  <button
                    className="secondary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    disabled={saving === `reason-${field.id}`}
                    onClick={() => addReasonTextField(field)}
                  >
                    {saving === `reason-${field.id}` ? 'Adding...' : '+ Add Reason Text Field'}
                  </button>
                  {(template.fields ?? []).some((f) => f.parent_field_id === field.id) && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#1a6fd4' }}>✓ Has reason text field</span>
                  )}
                </div>
              )}

              {field.parent_field_id && (
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  Child of field: {(template.fields ?? []).find((f) => f.id === field.parent_field_id)?.field_name ?? field.parent_field_id}
                </div>
              )}

              <div className="row">
                <div className="field">
                  <label>X</label>
                  <input
                    type="number"
                    value={draft.x}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, x: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Y</label>
                  <input
                    type="number"
                    value={draft.y}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, y: Number(event.target.value) || 0 },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Width</label>
                  <input
                    type="number"
                    value={draft.width}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, width: Number(event.target.value) || 120 },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Height</label>
                  <input
                    type="number"
                    value={draft.height}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, height: Number(event.target.value) || 18 },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Options (comma-separated)</label>
                  <input
                    value={draft.options_csv}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, options_csv: event.target.value },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Validation JSON (omit <code>label_es</code> — use Spanish label field)</label>
                  <textarea
                    value={draft.validation_text}
                    onChange={(event) =>
                      setEditing((prev) => ({
                        ...prev,
                        [field.id]: { ...draft, validation_text: event.target.value },
                      }))
                    }
                    style={{ minHeight: 80 }}
                  />
                </div>
              </div>

              <div className="actions">
                <button onClick={() => saveField(field.id)} disabled={saving === `field-${field.id}`}>
                  {saving === `field-${field.id}` ? 'Saving...' : 'Save Field'}
                </button>
                <button className="secondary" onClick={() => deleteField(field.id)} disabled={saving === `delete-${field.id}`}>
                  {saving === `delete-${field.id}` ? 'Deleting...' : 'Delete Field'}
                </button>
              </div>
              </div>
              )}
            </div>
          );
        })}
        </>

        <h3 style={{ marginTop: 24 }}>PDF Preview</h3>
        <div className="row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <div className="card" style={{ background: '#f9fbff' }}>
            <h4>Source PDF</h4>
            {sourcePreviewUrl ? (
              <iframe src={sourcePreviewUrl} title="Source PDF Preview" style={{ width: '100%', height: 480, border: '1px solid #cfe0ff' }} />
            ) : (
              <p>Click “Preview Source” to view.</p>
            )}
          </div>
          <div className="card" style={{ background: '#f9fbff' }}>
            <h4>AcroForm PDF</h4>
            {acroPreviewUrl ? (
              <iframe src={acroPreviewUrl} title="AcroForm PDF Preview" style={{ width: '100%', height: 480, border: '1px solid #cfe0ff' }} />
            ) : (
              <p>Generate and preview AcroForm to inspect field placement.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
