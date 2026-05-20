import { useRef } from 'react';
import type { FieldGroup, TemplateField } from '../lib/types';

type Props = {
  field: TemplateField;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  // For group-aware field types (radio_option, box_char, checkbox groups)
  allFields?: TemplateField[];
  allGroups?: FieldGroup[];
  allValues?: Record<string, any>;
  onChangeAll?: (updates: Record<string, any>) => void;
};

function BilingualFieldLabel({ en, es, fontSize }: { en: string; es?: string; fontSize?: number }) {
  const fs = fontSize ?? 14;
  const second = typeof es === 'string' ? es.trim() : '';
  if (second) {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: fs }}>
        <span>{en}</span>
        <span style={{ fontStyle: 'italic', color: '#444' }}>{second}</span>
      </span>
    );
  }
  return <span style={{ fontSize: fs }}>{en}</span>;
}

// ─── Boxed Input Group ──────────────────────────────────────────────────────

function BoxedInputGroup({
  fields,
  values,
  onChange,
  fontSize,
}: {
  fields: TemplateField[];
  values: Record<string, any>;
  onChange: (updates: Record<string, any>) => void;
  fontSize: number;
}) {
  const sorted = [...fields].sort((a, b) => Number(a.group_value ?? 0) - Number(b.group_value ?? 0));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {sorted.map((box, i) => (
        <input
          key={box.field_id}
          ref={(el) => { inputRefs.current[i] = el; }}
          id={`box_${box.field_id}`}
          type="text"
          maxLength={1}
          value={String(values[box.field_id] ?? '')}
          style={{
            width: 28,
            height: 34,
            textAlign: 'center',
            fontSize: fontSize,
            border: '1px solid #aaa',
            borderRadius: 3,
            padding: 0,
          }}
          onChange={() => {
            // handled via onKeyDown; onChange kept to suppress React warning
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (values[box.field_id]) {
                onChange({ [box.field_id]: '' });
              } else if (inputRefs.current[i - 1]) {
                inputRefs.current[i - 1]!.focus();
              }
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              onChange({ [box.field_id]: e.key });
              if (inputRefs.current[i + 1]) {
                inputRefs.current[i + 1]!.focus();
              }
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text');
            const updates: Record<string, any> = {};
            sorted.slice(i).forEach((b, j) => {
              if (text[j] !== undefined) updates[b.field_id] = text[j];
            });
            onChange(updates);
            const nextIdx = i + text.length;
            if (inputRefs.current[nextIdx]) {
              inputRefs.current[nextIdx]!.focus();
            } else if (inputRefs.current[sorted.length - 1]) {
              inputRefs.current[sorted.length - 1]!.focus();
            }
          }}
        />
      ))}
    </div>
  );
}

// ─── Radio Option Group ─────────────────────────────────────────────────────

function RadioOptionGroup({
  group,
  options,
  allFields,
  allValues,
  onChangeAll,
}: {
  group: FieldGroup;
  options: TemplateField[];
  allFields: TemplateField[];
  allValues: Record<string, any>;
  onChangeAll: (updates: Record<string, any>) => void;
}) {
  // The selected group value is stored under the key __group_<id>
  const groupKey = `__group_${group.id}`;
  const selectedValue = String(allValues[groupKey] ?? '');

  function selectOption(optionField: TemplateField) {
    const updates: Record<string, any> = {
      [groupKey]: optionField.group_value ?? optionField.field_id,
    };
    onChangeAll(updates);
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {options.map((opt) => {
        const isSelected = selectedValue === (opt.group_value ?? opt.field_id);
        // Find reason text child for this option
        const reasonField = allFields.find((f) => f.parent_field_id === opt.field_id);
        return (
          <div key={opt.field_id}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <input
                type="radio"
                name={group.acro_group_name}
                checked={isSelected}
                onChange={() => selectOption(opt)}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize: opt.font_size ?? 14 }}>
                <BilingualFieldLabel en={opt.label} es={opt.label_es} fontSize={opt.font_size ?? 14} />
              </span>
            </label>
            {reasonField && isSelected && (
              <div style={{ marginLeft: 26, marginTop: 4 }}>
                <input
                  type="text"
                  placeholder={
                    reasonField.label_es?.trim()
                      ? `${reasonField.label} / ${reasonField.label_es.trim()}`
                      : reasonField.label
                  }
                  value={String(allValues[reasonField.field_id] ?? '')}
                  style={{ fontSize: reasonField.font_size ?? 13 }}
                  onChange={(e) => onChangeAll({ [reasonField.field_id]: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Checkbox Group ─────────────────────────────────────────────────────────

function CheckboxGroupRenderer({
  group,
  checkboxFields,
  allValues,
  onChangeAll,
}: {
  group: FieldGroup;
  checkboxFields: TemplateField[];
  allValues: Record<string, any>;
  onChangeAll: (updates: Record<string, any>) => void;
}) {
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13, color: '#333' }}>{group.group_name}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {checkboxFields.map((cb) => (
          <label key={cb.field_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(allValues[cb.field_id])}
              onChange={(e) => onChangeAll({ [cb.field_id]: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontSize: cb.font_size ?? 14 }}>
              <BilingualFieldLabel en={cb.label} es={cb.label_es} fontSize={cb.font_size ?? 14} />
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Main TemplateFieldInput ────────────────────────────────────────────────

export function TemplateFieldInput({ field, value, onChange, error, allFields = [], allGroups = [], allValues = {}, onChangeAll }: Props) {
  const inputType = field.input_type;
  const fontSize = field.font_size ?? 14;

  if (inputType === 'boolean_yes_no') {
    const optsEs = (field.validation_rules?.display_options_es as string[] | undefined) ?? ['Sí', 'No'];
    const optsEn = field.options ?? ['Yes', 'No'];
    const selected = value === true || value === false ? value : null;

    return (
      <div className="field">
        <label>
          <BilingualFieldLabel en={field.label} es={field.label_es} fontSize={fontSize} />
          {field.required ? ' *' : ''}
        </label>
        <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <input
                type="radio"
                name={field.field_id}
                checked={selected === true}
                onChange={() => onChange(true)}
                style={{ width: 18, height: 18 }}
              />
              <span>{optsEn[0] ?? 'Yes'} / {optsEs[0] ?? 'Sí'}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <input
                type="radio"
                name={field.field_id}
                checked={selected === false}
                onChange={() => onChange(false)}
                style={{ width: 18, height: 18 }}
              />
              <span>{optsEn[1] ?? 'No'} / {optsEs[1] ?? 'No'}</span>
            </label>
          </div>
        </div>
        {error ? <div className="error">{error}</div> : null}
      </div>
    );
  }

  // ── box_char: rendered as a group from the first box in the sequence ──────
  if (inputType === 'box_char') {
    // Only render from the first box in the group (group_value === "0")
    if (field.group_value !== '0' && field.group_value !== null) return null;
    const groupFields = allFields.filter((f) => f.input_type === 'box_char' && f.group_id === field.group_id);
    if (groupFields.length === 0) return null;
    const group = allGroups.find((g) => g.id === field.group_id);
    const firstWithEs = groupFields.find((f) => f.label_es?.trim());
    const groupTitle = group?.group_name ?? field.label;
    const groupTitleEs = firstWithEs?.label_es;

    return (
      <div className="field">
        <label>
          <BilingualFieldLabel en={groupTitle} es={groupTitleEs} fontSize={fontSize} />
          {field.required ? ' *' : ''}
        </label>
        <BoxedInputGroup
          fields={groupFields}
          values={allValues}
          onChange={(updates) => onChangeAll?.(updates)}
          fontSize={fontSize}
        />
        {error ? <div className="error">{error}</div> : null}
      </div>
    );
  }

  // ── radio_option: rendered as a group from the first option ──────────────
  if (inputType === 'radio_option') {
    const group = allGroups.find((g) => g.id === field.group_id);
    if (!group) {
      // fallback: render as single radio if no group info available
      return (
        <div className="field">
          <label>
            <BilingualFieldLabel en={field.label} es={field.label_es} fontSize={fontSize} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="radio" checked={Boolean(value)} onChange={() => onChange(true)} style={{ width: 18, height: 18 }} />
            <BilingualFieldLabel en={field.label} es={field.label_es} fontSize={fontSize} />
          </label>
          {error ? <div className="error">{error}</div> : null}
        </div>
      );
    }

    // Only render the group from the first option in the group
    const groupOptions = allFields.filter((f) => f.input_type === 'radio_option' && f.group_id === field.group_id);
    const sortedOptions = [...groupOptions].sort((a, b) => String(a.group_value ?? '').localeCompare(String(b.group_value ?? '')));
    if (sortedOptions[0]?.field_id !== field.field_id) return null;

    return (
      <div className="field">
        <label>{group.group_name}{field.required ? ' *' : ''}</label>
        <RadioOptionGroup
          group={group}
          options={sortedOptions}
          allFields={allFields}
          allValues={allValues}
          onChangeAll={(updates) => onChangeAll?.(updates)}
        />
        {error ? <div className="error">{error}</div> : null}
      </div>
    );
  }

  // ── reason text child: rendered inline inside RadioOptionGroup — skip standalone ──
  if (field.parent_field_id) return null;

  // ── checkbox with group: rendered as group from first checkbox in group ───
  if (inputType === 'checkbox' && field.group_id) {
    const group = allGroups.find((g) => g.id === field.group_id);
    if (group) {
      const groupFields = allFields.filter((f) => f.input_type === 'checkbox' && f.group_id === field.group_id);
      if (groupFields[0]?.field_id !== field.field_id) return null;
      return (
        <div className="field">
          <CheckboxGroupRenderer
            group={group}
            checkboxFields={groupFields}
            allValues={allValues}
            onChangeAll={(updates) => onChangeAll?.(updates)}
          />
          {error ? <div className="error">{error}</div> : null}
        </div>
      );
    }
  }

  const renderInput = () => {
    if (inputType === 'radio') {
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {(field.options ?? []).map((option) => (
            <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
              <input
                type="radio"
                name={field.field_id}
                checked={String(value ?? '') === option}
                onChange={() => onChange(option)}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontSize }}>{option}</span>
            </label>
          ))}
        </div>
      );
    }

    if (inputType === 'select') {
      return (
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} style={{ fontSize }}>
          <option value="">Select...</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (inputType === 'textarea' || inputType === 'json' || inputType === 'signature') {
      return (
        <textarea
          style={{ fontSize }}
          value={
            inputType === 'json'
              ? typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : JSON.stringify(value, null, 2)
              : (value ?? '')
          }
          onChange={(event) => {
            if (inputType === 'json') {
              const raw = event.target.value;
              if (!raw.trim()) {
                onChange([]);
                return;
              }
              try {
                const parsed = JSON.parse(raw);
                onChange(parsed);
              } catch {
                onChange(raw);
              }
              return;
            }
            onChange(event.target.value);
          }}
        />
      );
    }

    if (inputType === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          style={{ width: 24, height: 24 }}
        />
      );
    }

    return (
      <input
        type={inputType === 'number' ? 'number' : inputType === 'signature' ? 'text' : inputType}
        style={{ fontSize }}
        value={value ?? ''}
        onChange={(event) => {
          if (inputType === 'number') {
            const num = event.target.value === '' ? '' : Number(event.target.value);
            onChange(num);
            return;
          }
          onChange(event.target.value);
        }}
      />
    );
  };

  return (
    <div className="field">
      <label htmlFor={field.field_id}>
        <BilingualFieldLabel en={field.label} es={field.label_es} fontSize={fontSize} />
        {field.required ? ' *' : ''}
      </label>
      {renderInput()}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
