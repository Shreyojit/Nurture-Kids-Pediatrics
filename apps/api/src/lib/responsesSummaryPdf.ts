import type { PDFFont, PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';
import { MCHAT_QUESTIONS, type MchatQuestionDef } from './mchatRDefinition.js';

/** Unwrap autosave shape `{ value, updated_at? }` to the stored answer. */
export function unwrapResponseEntry(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

export function formatResponseValue(value: unknown): string {
  const v = unwrapResponseEntry(value);
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function formatMchatAnswerDisplay(raw: unknown): string {
  const v = unwrapResponseEntry(raw);
  if (v === true || v === 'true' || v === 'Yes' || v === 'yes' || v === 'Sí' || v === 'Si') {
    return 'Yes (Sí)';
  }
  if (v === false || v === 'false' || v === 'No' || v === 'no') {
    return 'No';
  }
  return formatResponseValue(raw) || '(no answer)';
}

const MCHAT_BY_FIELD_ID = new Map<string, MchatQuestionDef>(MCHAT_QUESTIONS.map((q) => [q.field_id, q]));

function mchatSortOrder(fieldId: string): number | null {
  const q = MCHAT_BY_FIELD_ID.get(fieldId);
  return q ? q.index : null;
}

/** Helvetica / WinAnsi-safe display (avoids drawText errors on rare code points). */
function sanitizePdfString(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 9 || c === 10 || c === 13) return ch;
      if (c >= 32 && c <= 255) return ch;
      return '?';
    })
    .join('');
}

function wrapLineToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const t = sanitizePdfString(text).trim();
  if (!t) return [''];
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return [t];
  const words = t.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(w, size) <= maxWidth) {
        line = w;
      } else {
        let chunk = '';
        for (const ch of w) {
          const trial = chunk + ch;
          if (font.widthOfTextAtSize(trial, size) <= maxWidth) chunk = trial;
          else {
            if (chunk) lines.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export type ResponsesSummaryPdfInput = {
  title: string;
  subtitleLines?: string[];
  /** Field id → raw response (may be `{ value }` objects). */
  responses: Record<string, unknown>;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const BODY = 10;
const BODY_SMALL = 9;
const ANSWER_SIZE = 11;
const LINE = 14;
const LINE_SMALL = 13;
const PAR_SKIP = 6;

/**
 * Human-readable questionnaire-style PDF. M-CHAT items show full English + Spanish
 * question text from the canonical definition; answers are left-aligned under each item.
 */
export async function generateResponsesSummaryPdf(input: ResponsesSummaryPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const usableBottom = MARGIN + LINE;
  const contentW = PAGE_W - 2 * MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const ensureSpace = (minY: number) => {
    if (minY < usableBottom) newPage();
  };

  const entries = Object.entries(input.responses)
    .filter(([k]) => k.length > 0)
    .sort(([a], [b]) => {
      const oa = mchatSortOrder(a);
      const ob = mchatSortOrder(b);
      if (oa !== null && ob !== null) return oa - ob;
      if (oa !== null) return -1;
      if (ob !== null) return 1;
      return a.localeCompare(b);
    });

  ensureSpace(y - 36);
  page.drawText(sanitizePdfString(input.title), {
    x: MARGIN,
    y: y - 14 + 2,
    size: 14,
    font: fontBold,
    color: rgb(0.12, 0.12, 0.14),
  });
  y -= 20;

  for (const line of input.subtitleLines ?? []) {
    if (!line.trim()) continue;
    ensureSpace(y - LINE_SMALL);
    page.drawText(sanitizePdfString(line), {
      x: MARGIN,
      y: y - 9 + 2,
      size: 9,
      font,
      color: rgb(0.35, 0.35, 0.4),
    });
    y -= 12;
  }
  y -= PAR_SKIP;

  for (const [fieldId, raw] of entries) {
    const mchat = MCHAT_BY_FIELD_ID.get(fieldId);

    if (mchat) {
      const numStr = `${mchat.index}.`;
      const numW = fontBold.widthOfTextAtSize(`${numStr} `, BODY);
      const textStart = MARGIN + numW;
      const qWrapW = PAGE_W - MARGIN - textStart;

      const qEnLines = wrapLineToWidth(mchat.label_en, font, BODY, qWrapW);
      const qEsLines = wrapLineToWidth(mchat.label_es, font, BODY_SMALL, contentW - 12);

      const approxH = LINE * (1 + Math.max(0, qEnLines.length - 1)) + LINE_SMALL * qEsLines.length + LINE + PAR_SKIP * 3;
      ensureSpace(y - approxH);

      page.drawText(sanitizePdfString(numStr), {
        x: MARGIN,
        y: y - BODY + 2,
        size: BODY,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      page.drawText(sanitizePdfString(qEnLines[0] ?? ''), {
        x: textStart,
        y: y - BODY + 2,
        size: BODY,
        font,
        color: rgb(0, 0, 0),
      });
      y -= LINE;

      for (let i = 1; i < qEnLines.length; i++) {
        ensureSpace(y - LINE);
        page.drawText(sanitizePdfString(qEnLines[i]!), {
          x: textStart,
          y: y - BODY + 2,
          size: BODY,
          font,
          color: rgb(0, 0, 0),
        });
        y -= LINE;
      }

      for (const es of qEsLines) {
        ensureSpace(y - LINE_SMALL);
        page.drawText(sanitizePdfString(es), {
          x: MARGIN + 12,
          y: y - BODY_SMALL + 2,
          size: BODY_SMALL,
          font,
          color: rgb(0.22, 0.22, 0.26),
        });
        y -= LINE_SMALL;
      }

      y -= 2;
      const ans = formatMchatAnswerDisplay(raw);
      ensureSpace(y - ANSWER_SIZE - 4);
      page.drawText(sanitizePdfString(`Answer: ${ans}`), {
        x: MARGIN,
        y: y - ANSWER_SIZE + 2,
        size: ANSWER_SIZE,
        font: fontBold,
        color: rgb(0, 0.15, 0.35),
      });
      y -= LINE + PAR_SKIP * 2;
    } else {
      const label = fieldId;
      const valueText = formatResponseValue(raw) || '(empty)';
      const labelLines = wrapLineToWidth(label, fontBold, BODY, contentW);
      const valueLines = wrapLineToWidth(valueText, font, BODY, contentW - 8);

      for (const ln of labelLines) {
        ensureSpace(y - LINE);
        page.drawText(sanitizePdfString(ln), {
          x: MARGIN,
          y: y - BODY + 2,
          size: BODY,
          font: fontBold,
          color: rgb(0.08, 0.08, 0.1),
        });
        y -= LINE;
      }
      for (const ln of valueLines) {
        ensureSpace(y - LINE);
        page.drawText(sanitizePdfString(ln), {
          x: MARGIN + 8,
          y: y - BODY + 2,
          size: BODY,
          font,
          color: rgb(0.15, 0.15, 0.18),
        });
        y -= LINE;
      }
      y -= PAR_SKIP;
    }
  }

  if (entries.length === 0) {
    ensureSpace(y - LINE);
    page.drawText('No responses recorded.', {
      x: MARGIN,
      y: y - BODY + 2,
      size: BODY,
      font,
      color: rgb(0.4, 0.4, 0.45),
    });
  }

  return pdfDoc.save();
}
