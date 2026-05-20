export const PDF_DISPLAY_SCALE = 1.25;

export type Box = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

function normalizeBox(box: Box): Required<Box> {
  return {
    x: box.x ?? 0,
    y: box.y ?? 0,
    width: box.width ?? 0,
    height: box.height ?? 0,
  };
}

export function browserBoxToPdfBox(box: Box, pageHeight: number): Required<Box> {
  const b = normalizeBox(box);
  return {
    x: b.x / PDF_DISPLAY_SCALE,
    y: pageHeight - (b.y + b.height) / PDF_DISPLAY_SCALE,
    width: b.width / PDF_DISPLAY_SCALE,
    height: b.height / PDF_DISPLAY_SCALE,
  };
}

export function pdfBoxToBrowserBox(box: Box, pageHeight: number): Required<Box> {
  const b = normalizeBox(box);
  return {
    x: b.x * PDF_DISPLAY_SCALE,
    y: (pageHeight - b.y - b.height) * PDF_DISPLAY_SCALE,
    width: b.width * PDF_DISPLAY_SCALE,
    height: b.height * PDF_DISPLAY_SCALE,
  };
}
