import { formatJobDescription, cleanLocation, isWellFormatted } from '../contentFormatter';

describe('contentFormatter', () => {
  describe('formatJobDescription', () => {
    test('formats basic bullet points', () => {
      const input = `Job Overview

• First responsibility
• Second responsibility
• Third responsibility`;

      const result = formatJobDescription(input);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'paragraph', content: 'Job Overview' });
      expect(result[1]).toEqual({
        type: 'list',
        items: ['First responsibility', 'Second responsibility', 'Third responsibility']
      });
    });

    test('formats section headers', () => {
      const input = `RESPONSIBILITIES:
Do important work

QUALIFICATIONS:
Have important skills`;

      const result = formatJobDescription(input);

      expect(result[0]).toEqual({ type: 'header', content: 'Responsibilities' });
      expect(result[1]).toEqual({ type: 'paragraph', content: 'Do important work' });
      expect(result[2]).toEqual({ type: 'header', content: 'Qualifications' });
      expect(result[3]).toEqual({ type: 'paragraph', content: 'Have important skills' });
    });

    test('handles mixed content', () => {
      const input = `Partner with the best

As a Sr. Sales Manager, you will lead technical support and account management.

RESPONSIBILITIES:
• Manage drilling applications
• Build long-term strategic relationships
• Lead cross-functional teams

QUALIFICATIONS:
• Bachelor's degree in Engineering
• 5+ years of experience`;

      const result = formatJobDescription(input);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(block => block.type === 'header')).toBe(true);
      expect(result.some(block => block.type === 'list')).toBe(true);
      expect(result.some(block => block.type === 'paragraph')).toBe(true);
    });

    test('handles numbered lists', () => {
      const input = `Key Tasks:
1. Complete project planning
2. Execute strategy
3. Report results`;

      const result = formatJobDescription(input);

      expect(result[1]).toEqual({
        type: 'list',
        items: ['Complete project planning', 'Execute strategy', 'Report results']
      });
    });

    test('removes excessive whitespace', () => {
      const input = `First paragraph


Second paragraph`;

      const result = formatJobDescription(input);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('paragraph');
      expect(result[1].type).toBe('paragraph');
    });

    test('handles empty or invalid input', () => {
      expect(formatJobDescription('')).toEqual([]);
      expect(formatJobDescription(null)).toEqual([]);
      expect(formatJobDescription(undefined)).toEqual([]);
    });

    test('formats real Baker Hughes job description', () => {
      const input = `ESSENTIAL RESPONSIBILITIES:
•    Ensure compliance with manage the Job Cycle (MtJC) process
•    Work with the assigned Service Delivery Coordinator/Salesperson
•    Perform offset job analysis

QUALIFICATIONS/REQUIREMENTS:
•    Bachelor's degree in engineering
•    Excellent leadership, strong interpersonal skills
•    Ability to work in a global matrix organization`;

      const result = formatJobDescription(input);

      expect(result.length).toBeGreaterThan(0);

      // Check headers
      const headers = result.filter(block => block.type === 'header');
      expect(headers.length).toBeGreaterThan(0);

      // Check lists
      const lists = result.filter(block => block.type === 'list');
      expect(lists.length).toBeGreaterThan(0);
    });
  });

  describe('cleanLocation', () => {
    test('removes "locations\\n" prefix', () => {
      const input = 'locations\nUS-TX-HOUSTON';
      expect(cleanLocation(input)).toBe('US-TX-HOUSTON');
    });

    test('converts newlines to commas', () => {
      const input = 'US-CA-SAN FRANCISCO\nRemote';
      expect(cleanLocation(input)).toBe('US-CA-SAN FRANCISCO, Remote');
    });

    test('handles clean input', () => {
      expect(cleanLocation('New York, NY')).toBe('New York, NY');
    });

    test('handles empty or invalid input', () => {
      expect(cleanLocation('')).toBe('');
      expect(cleanLocation(null)).toBe('');
      expect(cleanLocation(undefined)).toBe('');
    });

    test('cleans real Baker Hughes location', () => {
      const input = 'locations\nAE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD';
      expect(cleanLocation(input)).toBe('AE-ABU DHABI-AL GHAITH HOLDING TOWER, AIRPORT ROAD');
    });
  });

  describe('isWellFormatted', () => {
    test('identifies well-formatted content', () => {
      const input = `Nice paragraph.

Another paragraph.

A third paragraph.`;
      expect(isWellFormatted(input)).toBe(true);
    });

    test('identifies poorly formatted content', () => {
      const input = `Paragraph one.




Too many blank lines.`;
      expect(isWellFormatted(input)).toBe(false);
    });

    test('handles empty input', () => {
      expect(isWellFormatted('')).toBe(false);
      expect(isWellFormatted(null)).toBe(false);
    });
  });
});
