import type { FieldGroupInput, TemplateFieldInput } from '../db/templateQueries.js';
import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} from 'pdf-lib';
export type AcroImportGroupSpec = Omit<FieldGroupInput, 'templateId'>;

export type AcroImportFieldSpec = TemplateFieldInput & {
  /** Index into `groups` array for `radio_option` rows; otherwise null. */
  group_index: number | null;
};

export type AcroFormFieldImportResult = {
  groups: AcroImportGroupSpec[];
  fields: AcroImportFieldSpec[];
};

function toSnakeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildUniqueId(base: string, existing: Set<string>): string {
  const normalizedBase = toSnakeId(base) || 'field';
  if (!existing.has(normalizedBase)) return normalizedBase;
  let index = 2;
  while (existing.has(`${normalizedBase}_${index}`)) {
    index += 1;
  }
  return `${normalizedBase}_${index}`;
}

function pageNumberForWidget(doc: PDFDocument, widget: { P(): import('pdf-lib').PDFRef | undefined }): number {
  const pref = widget.P();
  if (!pref) return 1;
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i].ref === pref) return i + 1;
  }
  return 1;
}

function parseFontSizeFromDa(da: string | undefined): number | null {
  if (!da) return null;
  const m = da.match(/([\d.]+)\s+Tf\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.min(72, Math.max(4, n)) : null;
}

/** Trailing segments Acrobat uses as matrix/widget indices — commonly `0` / `1` chains. */
function isPdfIndexSegment(s: string): boolean {
  return s === '0' || s === '1' || /^option_\d+$/i.test(s);
}

function splitFqNameParts(fqName: string): string[] {
  return fqName
    .trim()
    .split('.')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Base label from AcroForm fully-qualified name, without trailing index segments
 * (avoids showing "0" / "1" as the field title).
 */
export function humanPdfFieldBaseName(fqName: string): string {
  const parts = splitFqNameParts(fqName);
  if (parts.length === 0) return fqName.trim() || 'Field';
  let core = [...parts];
  while (core.length > 1 && isPdfIndexSegment(core[core.length - 1]!)) {
    core.pop();
  }
  if (core.length === 1 && isPdfIndexSegment(core[0]!)) {
    return parts.join(' ').replace(/\./g, ' ').trim() || 'Field';
  }
  return core.join(' — ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || fqName.trim();
}

/** Checkbox / button "on" export value shown in PDF readers (often 0/1 or Yes/No). */
function decodeWidgetOnName(widget: { getOnValue(): import('pdf-lib').PDFName | undefined }): string {
  const on = widget.getOnValue();
  if (!on || !('decodeText' in on) || typeof (on as { decodeText(): string }).decodeText !== 'function') return '';
  return (on as { decodeText(): string }).decodeText().trim();
}

/** Friendlier label for binary screening PDFs that use 0/1 as on-states. */
function friendlyExportCaption(exportName: string): string {
  const s = exportName.trim();
  if (s === '0') return 'No';
  if (s === '1') return 'Yes';
  return s;
}

/**
 * All imported AcroForm fields share one patient step bucket; `mapTemplateForPatient`
 * renames a lone "Imported" step to the template display name.
 */
const IMPORT_SECTION_KEY = 'Imported';

/** Trim PDF choice strings so responses match after import (handles stray spaces around Sí / No / Yes). */
function trimOptions(options: string[]): string[] {
  return options.map((o) => String(o).trim()).filter((o) => o.length > 0);
}

/**
 * Read embedded AcroForm fields from a PDF and map them to `pdf_template_fields` /
 * `field_groups` definitions compatible with the PediForm overlay + fill pipeline.
 */
export async function importEmbeddedAcroFieldsFromPdfBytes(pdfBytes: Uint8Array): Promise<AcroFormFieldImportResult> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const rawFields = form.getFields();

  const groups: AcroImportGroupSpec[] = [];
  const fields: AcroImportFieldSpec[] = [];
  const usedFieldIds = new Set<string>();
  const usedAcroSynthetic = new Set<string>();
  let displayOrder = 0;

  const allocSyntheticAcro = (prefix: string): string => {
    let n = 0;
    let candidate = prefix;
    while (usedAcroSynthetic.has(candidate)) {
      n += 1;
      candidate = `${prefix}_${n}`;
    }
    usedAcroSynthetic.add(candidate);
    return candidate;
  };

  for (const field of rawFields) {
    const fqName = field.getName();
    if (!fqName) continue;

    const widgets = field.acroField.getWidgets();
    if (!widgets.length) continue;

    const section = IMPORT_SECTION_KEY;
    const baseLabel = humanPdfFieldBaseName(fqName);
    const r0 = widgets[0]!.getRectangle();
    const rect = {
      x: r0.x,
      y: r0.y,
      width: Math.max(10, r0.width),
      height: Math.max(10, r0.height),
    };
    const page = Math.max(1, pageNumberForWidget(pdfDoc, widgets[0]!));
    const required = field.isRequired();
    const fontFromDa =
      field instanceof PDFTextField
        ? parseFontSizeFromDa(field.acroField.getDefaultAppearance())
        : null;

    if (field instanceof PDFButton || field instanceof PDFSignature) {
      continue;
    }

    if (field instanceof PDFTextField) {
      const fieldId = buildUniqueId(fqName, usedFieldIds);
      usedFieldIds.add(fieldId);
      const multiline = field.isMultiline();
      fields.push({
        field_id: fieldId,
        field_name: baseLabel,
        field_type: multiline ? 'textarea' : 'text',
        acro_field_name: fqName,
        required,
        page_number: page,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: multiline ? Math.max(rect.height, 48) : rect.height,
        options_json: [],
        validation_json: {},
        section_key: section,
        display_order: displayOrder++,
        font_size: fontFromDa ?? 12,
        group_id: null,
        group_value: null,
        parent_field_id: null,
        group_index: null,
      });
      continue;
    }

    if (field instanceof PDFCheckBox) {
      const fieldId = buildUniqueId(fqName, usedFieldIds);
      usedFieldIds.add(fieldId);
      const onDec = decodeWidgetOnName(widgets[0]!);
      const caption = onDec ? friendlyExportCaption(onDec) : '';
      const checkboxDisplayName = caption ? `${baseLabel} (${caption})` : baseLabel;
      fields.push({
        field_id: fieldId,
        field_name: checkboxDisplayName,
        field_type: 'checkbox',
        acro_field_name: fqName,
        required,
        page_number: page,
        x: rect.x,
        y: rect.y,
        width: Math.min(rect.width, rect.height),
        height: Math.min(rect.width, rect.height),
        options_json: [],
        validation_json: {},
        section_key: section,
        display_order: displayOrder++,
        font_size: 12,
        group_id: null,
        group_value: null,
        parent_field_id: null,
        group_index: null,
      });
      continue;
    }

    if (field instanceof PDFDropdown) {
      const fieldId = buildUniqueId(fqName, usedFieldIds);
      usedFieldIds.add(fieldId);
      let options: string[] = [];
      try {
        options = trimOptions(field.getOptions().map((o) => String(o)));
      } catch {
        options = [];
      }
      fields.push({
        field_id: fieldId,
        field_name: baseLabel,
        field_type: 'select',
        acro_field_name: fqName,
        required,
        page_number: page,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        options_json: options,
        validation_json: {},
        section_key: section,
        display_order: displayOrder++,
        font_size: fontFromDa ?? 12,
        group_id: null,
        group_value: null,
        parent_field_id: null,
        group_index: null,
      });
      continue;
    }

    if (field instanceof PDFOptionList) {
      const fieldId = buildUniqueId(fqName, usedFieldIds);
      usedFieldIds.add(fieldId);
      let options: string[] = [];
      try {
        options = trimOptions(field.getOptions().map((o) => String(o)));
      } catch {
        options = [];
      }
      fields.push({
        field_id: fieldId,
        field_name: baseLabel,
        field_type: 'select',
        acro_field_name: fqName,
        required,
        page_number: page,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: Math.max(rect.height, 72),
        options_json: options,
        validation_json: { native_field: 'option_list' },
        section_key: section,
        display_order: displayOrder++,
        font_size: fontFromDa ?? 12,
        group_id: null,
        group_value: null,
        parent_field_id: null,
        group_index: null,
      });
      continue;
    }

    if (field instanceof PDFRadioGroup) {
      const groupIndex = groups.length;
      groups.push({
        group_type: 'radio',
        group_name: baseLabel,
        acro_group_name: fqName,
      });

      let options: string[] = [];
      try {
        options = trimOptions(field.getOptions().map((o) => String(o)));
      } catch {
        options = [];
      }

      const widgets = field.acroField.getWidgets();
      for (let wi = 0; wi < widgets.length; wi += 1) {
        const widget = widgets[wi]!;
        const r = widget.getRectangle();
        const pg = Math.max(1, pageNumberForWidget(pdfDoc, widget));

        let groupValue: string;
        if (options.length === widgets.length && options[wi]) {
          groupValue = options[wi]!;
        } else {
          const on = widget.getOnValue();
          const decodedRaw =
            on && 'decodeText' in on && typeof (on as { decodeText(): string }).decodeText === 'function'
              ? (on as { decodeText(): string }).decodeText()
              : '';
          const decoded = decodedRaw.trim();
          if (decoded && options.includes(decoded)) {
            groupValue = decoded;
          } else if (decoded) {
            groupValue = decoded;
          } else if (options[wi]) {
            groupValue = options[wi]!;
          } else {
            groupValue = `option_${wi}`;
          }
        }

        const baseId = `${fqName}__${toSnakeId(groupValue) || `opt_${wi}`}`;
        const fieldId = buildUniqueId(baseId, usedFieldIds);
        usedFieldIds.add(fieldId);

        const acroSynthetic = allocSyntheticAcro(`import__${toSnakeId(fqName)}__w${wi}`);

        fields.push({
          field_id: fieldId,
          field_name: `${baseLabel}: ${friendlyExportCaption(groupValue)}`,
          field_type: 'radio_option',
          acro_field_name: acroSynthetic,
          required: false,
          page_number: pg,
          x: r.x,
          y: r.y,
          width: Math.max(10, Math.min(r.width, r.height)),
          height: Math.max(10, Math.min(r.width, r.height)),
          // Duplicate PDF export labels on each option so staff can see bilingual / non-English values in the editor.
          options_json: options.length > 0 ? [...options] : [groupValue],
          validation_json: { pdf_export_values: options },
          section_key: section,
          display_order: displayOrder++,
          font_size: 12,
          group_id: null,
          group_value: groupValue,
          parent_field_id: null,
          group_index: groupIndex,
        });
      }
    }
  }

  return { groups, fields };
}
