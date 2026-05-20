export type FieldSchemaOption = {
  id: string;
  label: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FieldSchemaField = {
  id: string;
  key: string;
  label: string;
  type: 'text' | 'checkbox' | 'radio';
  page: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  options?: FieldSchemaOption[];
};

export type TemplateFieldSchema = {
  fields: FieldSchemaField[];
};

export const EMPTY_FIELD_SCHEMA: TemplateFieldSchema = { fields: [] };

export function makeFieldId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
