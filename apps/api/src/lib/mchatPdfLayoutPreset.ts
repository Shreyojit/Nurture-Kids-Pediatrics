import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { PdfMarkerField } from './mchatTemplate.js';
import { MCHAT_QUESTIONS } from './mchatRDefinition.js';

/** Calibrated for common US-Letter M-CHAT-R™ layout (two pages: 14 + 6 rows). Tunable if your PDF differs. */
const YES_X_FRAC = 0.815;
const NO_X_FRAC = 0.91;
const BOX_PTS = 14;
const PAGE1_FIRST_ROW_Y_FRAC = 0.62;
const PAGE1_ROW_STEP_FRAC = 0.0318;
const PAGE2_FIRST_ROW_Y_FRAC = 0.74;
const PAGE2_ROW_STEP_FRAC = 0.048;
const FIRST_PAGE_ROWS = 14;

/** Same row, English + Spanish answer columns (four boxes per question). */
const BILING_EN_YES_FRAC = 0.69;
const BILING_EN_NO_FRAC = 0.76;
const BILING_ES_YES_FRAC = 0.845;
const BILING_ES_NO_FRAC = 0.915;

export type MchatPdfLayoutMode = 'single_column' | 'bilingual_columns' | 'bilingual_sections';

export type MchatPdfLayoutResolveInput = {
  /** When set (not `auto`), used as-is. */
  explicit?: MchatPdfLayoutMode | 'auto';
  templateName?: string | null;
  pageCount: number;
};

/**
 * - `bilingual_*` is chosen when the template name suggests a bilingual PDF.
 * - 4+ pages: assume English block then Spanish block (duplicate ticks in each section).
 * - 1–3 pages: assume Yes/No pairs side-by-side for both languages on the same rows.
 */
export function resolveMchatPdfLayoutMode(input: MchatPdfLayoutResolveInput): MchatPdfLayoutMode {
  const ex = input.explicit;
  if (ex && ex !== 'auto') return ex;

  const bilingual = /bilingual|bilingüe|bilingue/i.test(input.templateName ?? '');
  if (!bilingual) return 'single_column';

  if (input.pageCount >= 4) return 'bilingual_sections';
  return 'bilingual_columns';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function syntheticMarker(input: {
  pageNumber1Based: number;
  centerX: number;
  centerY: number;
  group: 'yes' | 'no';
  questionFieldId: string;
}): PdfMarkerField {
  const half = BOX_PTS / 2;
  return {
    field_id: `preset__${input.questionFieldId}__${input.group}_${input.pageNumber1Based}_${Math.round(input.centerX)}`,
    field_type: 'pdf_marker',
    parent_field_id: input.questionFieldId,
    group_value: input.group,
    page_number: input.pageNumber1Based,
    x: input.centerX - half,
    y: input.centerY - half,
    width: BOX_PTS,
    height: BOX_PTS,
  };
}

/**
 * Row geometry for one question within a slice of pages (section), with absolute page indices.
 * `absolutePageIndexStart0` is the PDF page index (0-based) of `slice[0]`.
 */
export function presetYesNoMarkersForSlice(
  questionIndex0: number,
  slice: PDFPage[],
  absolutePageIndexStart0: number,
): { yes: PdfMarkerField; no: PdfMarkerField } {
  const qid = MCHAT_QUESTIONS[questionIndex0]!.field_id;
  const pageCount = slice.length;

  if (pageCount === 0) {
    const fallback = syntheticMarker({
      pageNumber1Based: 1,
      centerX: 400,
      centerY: 400,
      group: 'yes',
      questionFieldId: qid,
    });
    return {
      yes: fallback,
      no: { ...fallback, field_id: `${fallback.field_id}_no`, group_value: 'no' },
    };
  }

  if (pageCount === 1) {
    const p0 = slice[0]!;
    const { width: W, height: H } = p0.getSize();
    const usableTop = H * (1 - 0.14);
    const usableBottom = H * 0.11;
    const usable = usableTop - usableBottom;
    const step = usable / 21;
    const row = questionIndex0;
    const yCenter = usableTop - step * (row + 0.5);
    const xYes = W * YES_X_FRAC;
    const xNo = W * NO_X_FRAC;
    const pageOne = absolutePageIndexStart0 + 1;
    return {
      yes: syntheticMarker({
        pageNumber1Based: pageOne,
        centerX: xYes,
        centerY: yCenter,
        group: 'yes',
        questionFieldId: qid,
      }),
      no: syntheticMarker({
        pageNumber1Based: pageOne,
        centerX: xNo,
        centerY: yCenter,
        group: 'no',
        questionFieldId: qid,
      }),
    };
  }

  let pageIndex0 = questionIndex0 < FIRST_PAGE_ROWS ? 0 : 1;
  pageIndex0 = clamp(pageIndex0, 0, pageCount - 1);
  const localRow = questionIndex0 < FIRST_PAGE_ROWS ? questionIndex0 : questionIndex0 - FIRST_PAGE_ROWS;
  const page = slice[pageIndex0]!;
  const { width, height } = page.getSize();

  let yCenter: number;
  if (pageIndex0 === 0) {
    yCenter = height * PAGE1_FIRST_ROW_Y_FRAC - localRow * height * PAGE1_ROW_STEP_FRAC;
  } else {
    yCenter = height * PAGE2_FIRST_ROW_Y_FRAC - localRow * height * PAGE2_ROW_STEP_FRAC;
  }

  yCenter = clamp(yCenter, BOX_PTS, height - BOX_PTS);

  const xYes = width * YES_X_FRAC;
  const xNo = width * NO_X_FRAC;
  const absPage1 = absolutePageIndexStart0 + pageIndex0 + 1;

  return {
    yes: syntheticMarker({
      pageNumber1Based: absPage1,
      centerX: xYes,
      centerY: yCenter,
      group: 'yes',
      questionFieldId: qid,
    }),
    no: syntheticMarker({
      pageNumber1Based: absPage1,
      centerX: xNo,
      centerY: yCenter,
      group: 'no',
      questionFieldId: qid,
    }),
  };
}

/**
 * Computes Yes/No tick areas for one question using page dimensions.
 * Falls back to a single stacked page if the PDF only has one page.
 */
export function presetYesNoMarkersForQuestion(
  questionIndex0: number,
  pdfDoc: PDFDocument,
): { yes: PdfMarkerField; no: PdfMarkerField } {
  const pages = pdfDoc.getPages();
  return presetYesNoMarkersForSlice(questionIndex0, pages, 0);
}

/** For bilingual_columns: "yes" answer ticks English Yes + Spanish Sí; "no" ticks English No + Spanish No. */
export function presetYesNoTargetsForQuestion(
  questionIndex0: number,
  pdfDoc: PDFDocument,
  layout: MchatPdfLayoutMode,
): { yesTargets: PdfMarkerField[]; noTargets: PdfMarkerField[] } {
  const qid = MCHAT_QUESTIONS[questionIndex0]!.field_id;

  if (layout === 'single_column') {
    const p = presetYesNoMarkersForQuestion(questionIndex0, pdfDoc);
    return { yesTargets: [p.yes], noTargets: [p.no] };
  }

  if (layout === 'bilingual_columns') {
    const row = presetYesNoMarkersForQuestion(questionIndex0, pdfDoc);
    const pages = pdfDoc.getPages();
    const page = pages[row.yes.page_number - 1]!;
    const { width } = page.getSize();
    const yCenter = row.yes.y + row.yes.height / 2;
    const page1 = row.yes.page_number;
    return {
      yesTargets: [
        syntheticMarker({
          pageNumber1Based: page1,
          centerX: width * BILING_EN_YES_FRAC,
          centerY: yCenter,
          group: 'yes',
          questionFieldId: qid,
        }),
        syntheticMarker({
          pageNumber1Based: page1,
          centerX: width * BILING_ES_YES_FRAC,
          centerY: yCenter,
          group: 'yes',
          questionFieldId: qid,
        }),
      ],
      noTargets: [
        syntheticMarker({
          pageNumber1Based: page1,
          centerX: width * BILING_EN_NO_FRAC,
          centerY: yCenter,
          group: 'no',
          questionFieldId: qid,
        }),
        syntheticMarker({
          pageNumber1Based: page1,
          centerX: width * BILING_ES_NO_FRAC,
          centerY: yCenter,
          group: 'no',
          questionFieldId: qid,
        }),
      ],
    };
  }

  // bilingual_sections
  const pages = pdfDoc.getPages();
  const n = pages.length;
  const half = Math.max(1, Math.floor(n / 2));
  const enSlice = pages.slice(0, half);
  const esSlice = pages.slice(half);
  const en = presetYesNoMarkersForSlice(questionIndex0, enSlice, 0);
  const es = presetYesNoMarkersForSlice(questionIndex0, esSlice, half);
  return {
    yesTargets: [en.yes, es.yes],
    noTargets: [en.no, es.no],
  };
}
