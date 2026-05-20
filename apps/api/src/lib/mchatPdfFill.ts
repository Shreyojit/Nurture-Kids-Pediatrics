import fs from 'node:fs';
import {
  extractMchatPdfMarkers,
  normalizeMchatMarkerGroup,
  resolveMarkerParentFieldId,
  type PdfMarkerField,
} from './mchatTemplate.js';
import { MCHAT_QUESTIONS } from './mchatRDefinition.js';
import {
  presetYesNoTargetsForQuestion,
  resolveMchatPdfLayoutMode,
  type MchatPdfLayoutMode,
} from './mchatPdfLayoutPreset.js';

type Responses = Record<string, { value: unknown; updated_at?: string } | unknown>;

function responseValue(responses: Responses, fieldId: string): unknown {
  const raw = responses[fieldId];
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

/** Normalize parent answer to boolean (true = Yes/Sí). */
export function normalizeMchatAnswer(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 'Yes' || value === 'yes' || value === 'Sí' || value === 'Si') {
    return true;
  }
  if (value === false || value === 'false' || value === 'No' || value === 'no') {
    return false;
  }
  return null;
}

type Slot = { yesTargets: PdfMarkerField[]; noTargets: PdfMarkerField[] };

function markerCenter(marker: PdfMarkerField): { page: number; x: number; y: number } {
  return {
    page: Math.max(1, marker.page_number),
    x: marker.x + marker.width / 2,
    y: marker.y + marker.height / 2,
  };
}

export async function fillMchatPdfWithCheckmarks(input: {
  sourcePdfPath: string;
  dbFields: Array<Record<string, unknown>>;
  responses: Responses;
  /** Template display name; used to detect bilingual PDFs when layout is `auto`. */
  templateName?: string | null;
  mchatPdfLayout?: MchatPdfLayoutMode | 'auto';
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const bytes = fs.readFileSync(input.sourcePdfPath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const layout = resolveMchatPdfLayoutMode({
    explicit: input.mchatPdfLayout ?? 'auto',
    templateName: input.templateName,
    pageCount: pdfDoc.getPages().length,
  });

  const markers = extractMchatPdfMarkers(input.dbFields);
  const markersByQuestion = new Map<string, Slot>();

  for (const marker of markers) {
    const questionId = resolveMarkerParentFieldId(marker, input.dbFields);
    if (!questionId) continue;
    const bucket = normalizeMchatMarkerGroup(marker.group_value);
    if (!bucket) continue;
    const slot = markersByQuestion.get(questionId) ?? { yesTargets: [], noTargets: [] };
    if (bucket === 'yes') slot.yesTargets.push(marker);
    else slot.noTargets.push(marker);
    markersByQuestion.set(questionId, slot);
  }

  for (let qi = 0; qi < MCHAT_QUESTIONS.length; qi++) {
    const q = MCHAT_QUESTIONS[qi]!;
    let slot = markersByQuestion.get(q.field_id) ?? { yesTargets: [], noTargets: [] };
    const presetBundle = presetYesNoTargetsForQuestion(qi, pdfDoc, layout);
    if (slot.yesTargets.length === 0) slot.yesTargets = presetBundle.yesTargets;
    if (slot.noTargets.length === 0) slot.noTargets = presetBundle.noTargets;
    markersByQuestion.set(q.field_id, slot);
  }

  for (const q of MCHAT_QUESTIONS) {
    const answer = normalizeMchatAnswer(responseValue(input.responses, q.field_id));
    if (answer === null) continue;
    const slot = markersByQuestion.get(q.field_id);
    if (!slot) continue;
    const targets = answer ? slot.yesTargets : slot.noTargets;
    if (targets.length === 0) continue;

    const pages = pdfDoc.getPages();

    for (const target of targets) {
      const { page, x, y } = markerCenter(target);
      const pageIndex = page - 1;
      const pdfPage = pages[pageIndex];
      if (!pdfPage) continue;

      const markSize = Math.max(8, Math.min(target.width, target.height, 14));
      pdfPage.drawText('X', {
        x: x - markSize / 3,
        y: y - markSize / 3,
        size: markSize,
        font,
        color: rgb(0, 0, 0.85),
      });
    }
  }

  return pdfDoc.save();
}

export function countMappedMchatMarkers(dbFields: Array<Record<string, unknown>>): number {
  return extractMchatPdfMarkers(dbFields).filter((m) => m.parent_field_id && normalizeMchatMarkerGroup(m.group_value)).length;
}
