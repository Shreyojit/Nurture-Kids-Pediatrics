import { z } from 'zod';

const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  value: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const fieldSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    label: z.string(),
    type: z.enum(['text', 'checkbox', 'radio']),
    page: z.number().int().min(0),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    fontSize: z.number().min(4).max(72).optional(),
    options: z.array(optionSchema).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'radio') {
      if (!field.options?.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'radio fields require options' });
      }
      return;
    }
    if (field.x === undefined || field.y === undefined || field.width === undefined || field.height === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text/checkbox fields require x, y, width, height' });
    }
  });

export const templateFieldSchemaZod = z.object({
  fields: z.array(fieldSchema),
});

export type FieldSchemaOption = z.infer<typeof optionSchema>;
export type FieldSchemaField = z.infer<typeof fieldSchema>;
export type TemplateFieldSchema = z.infer<typeof templateFieldSchemaZod>;

export const EMPTY_FIELD_SCHEMA: TemplateFieldSchema = { fields: [] };

export function parseTemplateFieldSchema(raw: string | null | undefined): TemplateFieldSchema {
  if (!raw || !raw.trim()) return { ...EMPTY_FIELD_SCHEMA };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = templateFieldSchemaZod.safeParse(parsed);
    if (result.success) return result.data;
    return { ...EMPTY_FIELD_SCHEMA };
  } catch {
    return { ...EMPTY_FIELD_SCHEMA };
  }
}

export function hasOverlayFields(schema: TemplateFieldSchema): boolean {
  return Array.isArray(schema.fields) && schema.fields.length > 0;
}

export function stringifyTemplateFieldSchema(schema: TemplateFieldSchema): string {
  return JSON.stringify(schema);
}
