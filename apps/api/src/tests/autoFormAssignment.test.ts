import { describe, expect, it } from 'vitest';
import {
  AGE_GROUP_FORMS,
  ageInMonths,
  getAgeGroup,
  isWellVisit,
} from '../lib/autoFormAssignment.js';

describe('isWellVisit', () => {
  it('recognizes preventive visit phrases from schedule imports', () => {
    expect(isWellVisit('Well Check')).toBe(true);
    expect(isWellVisit('Well Visit')).toBe(true);
    expect(isWellVisit('Annual Checkup')).toBe(true);
    expect(isWellVisit('well_child')).toBe(true);
    expect(isWellVisit('Preventive visit')).toBe(true);
  });

  it('does not treat sick visits as well', () => {
    expect(isWellVisit('Sick visit')).toBe(false);
    expect(isWellVisit('Follow-up')).toBe(false);
    expect(isWellVisit('')).toBe(false);
  });
});

describe('getAgeGroup', () => {
  const asOf = new Date('2026-05-24T12:00:00Z');

  it('maps newborn and milestone ages', () => {
    expect(getAgeGroup('2026-05-20', asOf)).toBe('newborn');
    expect(getAgeGroup('2026-03-24', asOf)).toBe('2_month');
    expect(getAgeGroup('2025-11-24', asOf)).toBe('6_month');
    expect(getAgeGroup('2024-05-24', asOf)).toBe('24_month');
  });

  it('returns expected form lists per age group', () => {
    expect(AGE_GROUP_FORMS['4_month']).toEqual([]);
    expect(AGE_GROUP_FORMS['18_month']).toContain('MCHAT');
    expect(AGE_GROUP_FORMS['12_18_year']).toContain('PHQ-9');
  });
});

describe('ageInMonths', () => {
  it('calculates whole months from DOB', () => {
    const asOf = new Date('2026-05-24T12:00:00Z');
    expect(ageInMonths('2026-03-24', asOf)).toBe(2);
  });
});
