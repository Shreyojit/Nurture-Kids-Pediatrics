---
description: Analyse a PDF and generate templateSeedData.json field entries for it
argument-hint: <path-to-pdf> [template_id] [template_key] [template_name]
---

# PDF Field Mapper

You are helping map interactive fields for a new PDF form into this project's `templateSeedData.json` seed file.

The project renders PDFs in `apps/web/src/pages/PdfFillPage.tsx` using CSS overlays.
Fields are stored in `apps/api/src/seeds/templateSeedData.json` and seeded on every API start.

Coordinate system: **PDF native (bottom-left origin, y increases upward)**.
Page size is typically 612 × 792 pts (US Letter).

---

## Step 1 — Parse arguments

From `$ARGUMENTS` extract:
- `PDF_PATH` — path to the source PDF (required)
- `TEMPLATE_ID` — UUID for this template (generate a new one with `python3 -c "import uuid; print(uuid.uuid4())"` if not given)
- `TEMPLATE_KEY` — short snake_case key, e.g. `asq18mos` (derive from filename if not given)
- `TEMPLATE_NAME` — human name, e.g. `ASQ 18 Months` (derive from filename if not given)

---

## Step 2 — Extract PDF structure with pdfminer

Run this script and carefully study every page's output:

```python
python3 << 'EOF'
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextBox, LTTextLine, LTRect, LTLine, LTCurve
import sys

pdf_path = "PDF_PATH_PLACEHOLDER"
pages = list(extract_pages(pdf_path))
print(f"Total pages: {len(pages)}  |  Page size: {pages[0].bbox}")

for page_num, page in enumerate(pages, 1):
    print(f"\n{'='*60}")
    print(f"PAGE {page_num}")
    print(f"{'='*60}")

    print("\n--- TEXT ELEMENTS (sorted top→bottom) ---")
    texts = []
    for el in page:
        if isinstance(el, LTTextBox):
            for line in el:
                if isinstance(line, LTTextLine):
                    t = line.get_text().strip()
                    if t:
                        x0,y0,x1,y1 = line.bbox
                        texts.append((x0,y0,x1,y1,t))
    for x0,y0,x1,y1,t in sorted(texts, key=lambda e: -e[1]):
        print(f"  x={x0:.1f} y={y0:.1f} w={x1-x0:.1f} h={y1-y0:.1f}  {repr(t)}")

    print("\n--- CIRCLES (LTCurve with square-ish bbox, likely radio bubbles) ---")
    for el in page:
        if isinstance(el, LTCurve):
            x0,y0,x1,y1 = el.bbox
            w,h = x1-x0, y1-y0
            if 4 < w < 20 and 4 < h < 20 and abs(w-h) < 4:
                print(f"  x0={x0:.1f} y0={y0:.1f} x1={x1:.1f} y1={y1:.1f}  (center {(x0+x1)/2:.1f},{(y0+y1)/2:.1f})")

    print("\n--- HORIZONTAL LINES (likely text-field underlines) ---")
    for el in page:
        if isinstance(el, (LTLine, LTCurve)):
            x0,y0,x1,y1 = el.bbox
            if abs(y1-y0) < 2 and (x1-x0) > 10:
                print(f"  x0={x0:.1f} x1={x1:.1f} y={y0:.1f}  (width {x1-x0:.1f})")

    print("\n--- RECTANGLES (likely text-box outlines) ---")
    for el in page:
        if isinstance(el, LTRect):
            x0,y0,x1,y1 = el.bbox
            if (x1-x0) > 20 and (y1-y0) > 8:
                print(f"  x={x0:.1f} y={y0:.1f} w={x1-x0:.1f} h={y1-y0:.1f}")
EOF
```

Replace `PDF_PATH_PLACEHOLDER` with the actual path before running.

---

## Step 3 — Identify field regions

From the pdfminer output, build a mental (or written) map of each page:

### Radio button groups
- Look for clusters of same-size square-ish circles at the same y-coordinate (same row) but different x-coordinates → these are options in a YES / SOMETIMES / NOT YET or similar group.
- The column headers (text above the circles) tell you the group option names (YES=10, SOMETIMES=5, NOT YET=0 for ASQ; or YES/NO for overall questions).
- Each row of circles = one question = one **radio group**.
- Radio field position: `x = circle_x0`, `y = circle_y0`, `w = circle_width`, `h = circle_height`.

### Text input fields
- Horizontal underlines → single-line text input. Position the field so its bottom edge sits at the underline y.  Use `w = line_width`, `h = 14`.
- Rectangles with significant area → multiline textarea. Use the rect bbox directly: `x=x0, y=y0, w=x1-x0, h=y1-y0`.

### Checkboxes
- Small square rectangles (w≈h≈12–16 pts) not part of a radio cluster → `field_type = "checkbox"`.

---

## Step 4 — Design the field schema

For each field produce a record matching this shape (all positional values are floats):

```json
{
  "id": "<new uuid>",
  "template_id": "<TEMPLATE_ID>",
  "field_id": "snake_case_unique_name",
  "field_name": "Human Readable Name",
  "field_type": "text | textarea | radio_option | checkbox",
  "acro_field_name": "same_as_field_id",
  "required": 0,
  "page_number": 1,
  "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0,
  "options_json": "[]",
  "validation_json": "{}",
  "section_key": "Section Name or null",
  "display_order": 0,
  "font_size": 10.0,
  "group_id": "<group uuid or null>",
  "group_value": "Yes | Sometimes | Not Yet | null",
  "parent_field_id": null,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

For radio groups, also add a **group record**:

```json
{
  "id": "<group uuid>",
  "template_id": "<TEMPLATE_ID>",
  "group_type": "radio",
  "group_name": "snake_case_group_name",
  "acro_group_name": "snake_case_group_name",
  "created_at": "2026-01-01T00:00:00.000Z"
}
```

**Naming conventions:**
- Questions: `<section>_q<n>_<option>` e.g. `comm_q1_yes`, `comm_q1_som`, `comm_q1_no`
- Totals: `<section>_total`
- Notes/free text: `<section>_notes_<n>` or descriptive name
- Groups: `<section>_q<n>`

---

## Step 5 — Generate the field entries with Python

Write a Python script that:
1. Loads the current `apps/api/src/seeds/templateSeedData.json`
2. Skips if a template with this ID already exists
3. Appends the new template record, fields, and groups
4. Writes the file back

**Template record** shape (needed in `templates` array):
```json
{
  "id": "<TEMPLATE_ID>",
  "template_key": "<TEMPLATE_KEY>",
  "version": 1,
  "name": "<TEMPLATE_NAME>",
  "status": "published",
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

Also update `apps/api/src/db/seedTemplates.ts` → add the PDF file mapping to `PDF_FILES`:
```ts
'<TEMPLATE_ID>': {
  source: '<template_key>_source.pdf',
  acroform: '<template_key>_acroform.pdf',
},
```

And copy both the source and acroform PDFs into `apps/api/src/seeds/pdfs/`.

---

## Step 6 — Verify visually

1. Restart the API: `npm run dev --workspace=apps/api`
2. Log in as staff, create an assignment for the new template
3. Open the fill URL in the browser using Playwright
4. Take screenshots of each page and inspect:
   - Radio buttons must sit directly ON the printed circles
   - Text fields must align with underlines or box outlines
   - No fields should float outside the page area
5. If anything is misaligned, recalculate from pdfminer coordinates and update the JSON

---

## Step 7 — Commit

```bash
git add apps/api/src/seeds/templateSeedData.json \
        apps/api/src/seeds/pdfs/ \
        apps/api/src/db/seedTemplates.ts
git commit -m "Add <TEMPLATE_NAME> PDF fields and seed data"
```

---

## Key formulas to remember

| What you want | Formula |
|---|---|
| Radio field over a circle | `x = circle_x0`, `y = circle_y0`, `w = circle_width`, `h = circle_height` |
| Text field on an underline | `x = line_x0`, `y = line_y` (bottom), `w = line_width`, `h = 14` |
| Textarea inside a rect | `x = rect_x0`, `y = rect_y0`, `w = rect_width`, `h = rect_height` |
| CSS top in PdfFillPage | `pageH - (field.y + field.height) * scale` |
| CSS left | `field.x * scale` |

Scale = `760 / page1_width_in_pts` (760 is TARGET_WIDTH in PdfFillPage.tsx).
