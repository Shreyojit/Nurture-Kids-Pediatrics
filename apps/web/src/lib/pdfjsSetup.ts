import { GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';
import { pdfjs } from 'react-pdf';

let workerReady = false;

/**
 * Configure pdf.js worker to use the same pdfjs-dist build as react-pdf.
 * Must run once before any <Document /> or getDocument() call.
 */
export function ensurePdfjsWorker(): void {
  if (workerReady) return;
  workerReady = true;

  const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  GlobalWorkerOptions.workerSrc = workerSrc;

  if (pdfjs.version !== pdfjsVersion) {
    console.warn(
      `[pdfjs] react-pdf pdfjs ${pdfjs.version} vs pdfjs-dist ${pdfjsVersion} — versions should match`,
    );
  }
}

/** Canvas-only — avoids TextLayer worker races and StrictMode double-mount issues. */
export const PDF_PAGE_CANVAS_ONLY = {
  renderTextLayer: false,
  renderAnnotationLayer: false,
} as const;
