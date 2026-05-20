export type TemplateField = {
  field_id: string;
  label: string;
  /** Spanish / second language line (from validation_json.label_es) */
  label_es?: string;
  input_type: string;
  required?: boolean;
  options?: string[];
  validation_rules?: Record<string, unknown>;
  font_size?: number;
  group_id?: string | null;
  group_value?: string | null;
  parent_field_id?: string | null;
  page_number?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type FieldGroup = {
  id: string;
  group_type: 'radio' | 'checkbox' | 'boxed_input';
  group_name: string;
  acro_group_name: string;
};

export type TemplateStep = {
  step_id: string;
  title: string;
  description?: string;
  fields: TemplateField[];
};

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
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  options?: FieldSchemaOption[];
};

export type TemplateFieldSchema = {
  fields: FieldSchemaField[];
};

export type FormTemplate = {
  submission_id?: string;
  form_id: string;
  version: string;
  title: string;
  steps: TemplateStep[];
  responses?: Record<string, unknown>;
  groups?: FieldGroup[];
  acroform_ready?: boolean;
  pdf_overlay_ready?: boolean;
  field_schema?: TemplateFieldSchema;
  visit_type?: string;
  form_type?: string;
  languages?: string[];
};
