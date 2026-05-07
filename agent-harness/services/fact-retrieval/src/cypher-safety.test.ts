describe('Cypher Query Safety', () => {
  describe('safePattern validation', () => {
    const safePatternRegex = /^[a-zA-Z0-9\u4e00-\u9fff.*+?^${}()|[\]\\!\-_=:]+$/;

    it('accepts alphanumeric-only patterns', () => {
      const pattern = '.*testSearch.*';
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(true);
    });

    it('accepts Chinese character patterns', () => {
      const pattern = '.*查找资料.*';
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(true);
    });

    it('accepts legitimate regex meta-characters', () => {
      const pattern = '.*word1|word2.*';
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(true);
    });

    it('rejects single-quote injection attempt', () => {
      const pattern = `.*test'.*`;
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(false);
    });

    it('rejects semicolon injection attempt', () => {
      const pattern = '.*test; DROP.*';
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(false);
    });

    it('allows legitimate dollar-sign as regex anchor (pre-sanitized by earlier pipeline stage)', () => {
      const pattern = '.*end$.*';
      const stripped = pattern.replace('(?i)', '');
      expect(safePatternRegex.test(stripped)).toBe(true);
    });
  });
});
