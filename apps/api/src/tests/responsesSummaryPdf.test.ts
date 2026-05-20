import { describe, expect, it } from 'vitest';
import {
  formatResponseValue,
  generateResponsesSummaryPdf,
  unwrapResponseEntry,
} from '../lib/responsesSummaryPdf.js';

describe('responsesSummaryPdf helpers', () => {
  it('unwraps autosave payload', () => {
    expect(unwrapResponseEntry({ value: true })).toBe(true);
    expect(unwrapResponseEntry(false)).toBe(false);
  });

  it('formats values for display', () => {
    expect(formatResponseValue({ value: true })).toBe('Yes');
    expect(formatResponseValue({ value: false })).toBe('No');
    expect(formatResponseValue({ a: 1 })).toContain('"a"');
  });
});

describe('generateResponsesSummaryPdf', () => {
  it('creates a non-empty PDF without loading a template', async () => {
    const bytes = await generateResponsesSummaryPdf({
      title: 'Test',
      subtitleLines: ['Line 1'],
      responses: {
        mchat_q01: { value: true },
        notes: 'hello',
      },
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(bytes[0]!)).toBe('%');
  });
});
