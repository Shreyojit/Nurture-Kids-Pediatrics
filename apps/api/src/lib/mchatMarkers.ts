import { addTemplateField, getTemplateFields, updateTemplateField } from '../db/templateQueries.js';

export type MchatMarkerKind = 'yes' | 'no';

export function mchatMarkerFieldId(questionFieldId: string, marker: MchatMarkerKind): string {
  return `${questionFieldId}__${marker}`;
}

export function upsertMchatPdfMarker(input: {
  templateId: string;
  practiceId: string;
  questionFieldId: string;
  marker: MchatMarkerKind;
  page_number: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}): Record<string, unknown> {
  const fieldId = mchatMarkerFieldId(input.questionFieldId, input.marker);
  const existing = getTemplateFields(input.templateId).find((f) => f.field_id === fieldId);
  const w = input.width ?? 14;
  const h = input.height ?? 14;

  if (existing) {
    return updateTemplateField({
      templateId: input.templateId,
      practiceId: input.practiceId,
      fieldDbId: existing.id,
      patch: {
        field_type: 'pdf_marker',
        page_number: input.page_number,
        x: input.x,
        y: input.y,
        width: w,
        height: h,
        parent_field_id: input.questionFieldId,
        group_value: input.marker,
        required: false,
      },
    });
  }

  return addTemplateField({
    templateId: input.templateId,
    practiceId: input.practiceId,
    field: {
      field_id: fieldId,
      field_name: `${input.questionFieldId} ${input.marker}`,
      field_type: 'pdf_marker',
      acro_field_name: fieldId,
      required: false,
      page_number: input.page_number,
      x: input.x,
      y: input.y,
      width: w,
      height: h,
      options_json: [],
      validation_json: { mchat_marker: input.marker },
      section_key: 'M-CHAT Markers',
      display_order: parseInt(input.questionFieldId.replace(/\D/g, ''), 10) || 0,
      parent_field_id: input.questionFieldId,
      group_value: input.marker,
    },
  });
}
