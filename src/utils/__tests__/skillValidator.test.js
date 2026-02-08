import { isValidSkill, filterValidSkills } from '../skillValidator';

describe('skillValidator', () => {
  describe('isValidSkill', () => {
    describe('should reject section headers', () => {
      test('rejects values ending with colon', () => {
        expect(isValidSkill('basic compensation:')).toBe(false);
        expect(isValidSkill('key responsibilities:')).toBe(false);
        expect(isValidSkill('qualifications:')).toBe(false);
      });

      test('rejects common section header terms', () => {
        expect(isValidSkill('basic compensation')).toBe(false);
        expect(isValidSkill('basic qualifications')).toBe(false);
        expect(isValidSkill('key responsibilities')).toBe(false);
        expect(isValidSkill('job requirements')).toBe(false);
        expect(isValidSkill('essential functions')).toBe(false);
      });
    });

    describe('should reject generic career terms', () => {
      test('rejects career-related terms', () => {
        expect(isValidSkill('business career')).toBe(false);
        expect(isValidSkill('career')).toBe(false);
        expect(isValidSkill('career path')).toBe(false);
        expect(isValidSkill('career development')).toBe(false);
      });

      test('rejects generic job posting terms', () => {
        expect(isValidSkill('job')).toBe(false);
        expect(isValidSkill('position')).toBe(false);
        expect(isValidSkill('role')).toBe(false);
        expect(isValidSkill('opportunity')).toBe(false);
      });
    });

    describe('should reject single generic words', () => {
      test('rejects overly generic terms', () => {
        expect(isValidSkill('key')).toBe(false);
        expect(isValidSkill('basic')).toBe(false);
        expect(isValidSkill('essential')).toBe(false);
        expect(isValidSkill('important')).toBe(false);
        expect(isValidSkill('critical')).toBe(false);
      });

      test('rejects generic descriptors', () => {
        expect(isValidSkill('excellent')).toBe(false);
        expect(isValidSkill('good')).toBe(false);
        expect(isValidSkill('strong')).toBe(false);
        expect(isValidSkill('advanced')).toBe(false);
        expect(isValidSkill('intermediate')).toBe(false);
      });
    });

    describe('should accept legitimate skills', () => {
      test('accepts technical skills', () => {
        expect(isValidSkill('JavaScript')).toBe(true);
        expect(isValidSkill('Python')).toBe(true);
        expect(isValidSkill('SQL')).toBe(true);
        expect(isValidSkill('React')).toBe(true);
      });

      test('accepts professional skills', () => {
        expect(isValidSkill('Project Management')).toBe(true);
        expect(isValidSkill('Data Analysis')).toBe(true);
        expect(isValidSkill('Welding')).toBe(true);
        expect(isValidSkill('Electrical Engineering')).toBe(true);
      });

      test('accepts multi-word technical skills', () => {
        expect(isValidSkill('Machine Learning')).toBe(true);
        expect(isValidSkill('Network Administration')).toBe(true);
        expect(isValidSkill('Quality Assurance')).toBe(true);
      });

      test('accepts trade-specific skills', () => {
        expect(isValidSkill('HVAC')).toBe(true);
        expect(isValidSkill('Plumbing')).toBe(true);
        expect(isValidSkill('Carpentry')).toBe(true);
        expect(isValidSkill('Electrical Work')).toBe(true);
      });
    });

    describe('should reject sentences and requirements', () => {
      test('rejects sentences with punctuation', () => {
        expect(isValidSkill('Must have 5 years experience.')).toBe(false);
        expect(isValidSkill('We are looking for candidates!')).toBe(false);
      });

      test('rejects degree requirements', () => {
        expect(isValidSkill('Bachelor degree required')).toBe(false);
        expect(isValidSkill('5 years of experience')).toBe(false);
      });

      test('rejects salary information', () => {
        expect(isValidSkill('$50,000 salary')).toBe(false);
        expect(isValidSkill('100k compensation')).toBe(false);
      });
    });

    describe('should reject task descriptions and requirements', () => {
      test('rejects relative clauses (that/which/who)', () => {
        expect(isValidSkill('Delegate Work That Has Been Organized')).toBe(false);
        expect(isValidSkill('Skills Which Are Required')).toBe(false);
        expect(isValidSkill('Tasks That Must Be Completed')).toBe(false);
        expect(isValidSkill('Experience Who Has Value')).toBe(false);
      });

      test('rejects imperative verbs (commands)', () => {
        expect(isValidSkill('Ensures Accuracy')).toBe(false);
        expect(isValidSkill('Maintains Standards')).toBe(false);
        expect(isValidSkill('Delegate Work')).toBe(false);
        expect(isValidSkill('Perform Tasks')).toBe(false);
        expect(isValidSkill('Demonstrate Skills')).toBe(false);
        expect(isValidSkill('Provide Support')).toBe(false);
      });

      test('rejects vague abstract noun phrases', () => {
        expect(isValidSkill('Thoroughness In All Assignments')).toBe(false);
        expect(isValidSkill('Accuracy In Work')).toBe(false);
        expect(isValidSkill('Precision In Tasks')).toBe(false);
        expect(isValidSkill('Consistency In Performance')).toBe(false);
      });

      test('rejects gerund task descriptions', () => {
        expect(isValidSkill('Managing Projects Daily')).toBe(false);
        expect(isValidSkill('Ensuring Quality Standards')).toBe(false);
        expect(isValidSkill('Delegating Tasks Effectively')).toBe(false);
        expect(isValidSkill('Coordinating Team Activities')).toBe(false);
      });

      test('rejects full title case requirement phrases', () => {
        expect(isValidSkill('Must Complete All Required Tasks')).toBe(false);
        expect(isValidSkill('Ability To Work Under Pressure')).toBe(false);
      });
    });

    describe('should accept legitimate gerund-based skills', () => {
      test('accepts common trade/technical gerund skills', () => {
        expect(isValidSkill('Welding')).toBe(true);
        expect(isValidSkill('Programming')).toBe(true);
        expect(isValidSkill('Engineering')).toBe(true);
        expect(isValidSkill('Accounting')).toBe(true);
        expect(isValidSkill('Nursing')).toBe(true);
        expect(isValidSkill('Teaching')).toBe(true);
        expect(isValidSkill('Marketing')).toBe(true);
        expect(isValidSkill('Troubleshooting')).toBe(true);
        expect(isValidSkill('Networking')).toBe(true);
      });

      test('accepts gerund compound skills', () => {
        expect(isValidSkill('Welding Techniques')).toBe(true);
        expect(isValidSkill('Programming Languages')).toBe(true);
        expect(isValidSkill('Engineering Design')).toBe(true);
      });
    });

    describe('edge cases', () => {
      test('handles null and undefined', () => {
        expect(isValidSkill(null)).toBe(false);
        expect(isValidSkill(undefined)).toBe(false);
      });

      test('handles non-string values', () => {
        expect(isValidSkill(123)).toBe(false);
        expect(isValidSkill({})).toBe(false);
        expect(isValidSkill([])).toBe(false);
      });

      test('handles empty or very short strings', () => {
        expect(isValidSkill('')).toBe(false);
        expect(isValidSkill('a')).toBe(false);
      });

      test('handles very long strings (likely sentences)', () => {
        expect(isValidSkill('This is a very long string that is definitely not a skill but rather a full sentence')).toBe(false);
      });
    });
  });

  describe('filterValidSkills', () => {
    test('filters out invalid skills', () => {
      const input = [
        'JavaScript',
        'basic compensation:',
        'Python',
        'key',
        'business career',
        'Welding',
        'excellent',
        'qualifications'
      ];

      const expected = ['JavaScript', 'Python', 'Welding'];
      expect(filterValidSkills(input)).toEqual(expected);
    });

    test('handles empty array', () => {
      expect(filterValidSkills([])).toEqual([]);
    });

    test('handles non-array input', () => {
      expect(filterValidSkills(null)).toEqual([]);
      expect(filterValidSkills(undefined)).toEqual([]);
      expect(filterValidSkills('not an array')).toEqual([]);
    });

    test('filters mixed valid and invalid skills', () => {
      const input = [
        'Project Management',
        'responsibilities',
        'SQL',
        'key responsibilities:',
        'Data Analysis',
        'career development',
        'HVAC'
      ];

      const expected = ['Project Management', 'SQL', 'Data Analysis', 'HVAC'];
      expect(filterValidSkills(input)).toEqual(expected);
    });
  });
});
