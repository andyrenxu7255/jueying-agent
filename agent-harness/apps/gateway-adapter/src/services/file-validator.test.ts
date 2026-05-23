import {
  sanitizeFileName,
  validateExtension,
  validateFileForImport,
  validateFileSize,
  validateMimeType,
  validateTextContent,
} from './file-validator';

describe('file-validator', () => {
  it('sanitizes path traversal and unsafe filename characters', () => {
    const result = sanitizeFileName('../unsafe/<name>:"file".txt');
    expect(result.original).toBe('../unsafe/<name>:"file".txt');
    expect(result.sanitized).toBe('_name___file_.txt');
  });

  it('generates a fallback name when sanitization removes everything', () => {
    const result = sanitizeFileName('...');
    expect(result.sanitized).toMatch(/^file_\d+_[0-9a-f]{8}$/);
  });

  it('uses the final non-empty path segment when a path ends with a separator', () => {
    expect(sanitizeFileName('C:\\safe\\notes.txt\\').sanitized).toBe('notes.txt');
    expect(sanitizeFileName('/').sanitized).toMatch(/^file_\d+_[0-9a-f]{8}$/);
  });

  it('allows common import extensions and rejects missing or unsafe extensions', () => {
    expect(validateExtension('notes.txt').valid).toBe(true);
    expect(validateExtension('report.docx').valid).toBe(true);
    expect(validateExtension('Dockerfile').valid).toBe(true);
    expect(validateExtension('.env').valid).toBe(true);
    expect(validateExtension('notes.txt.').valid).toBe(true);
    expect(validateExtension('legacy.doc')).toEqual({ valid: false, reason: 'legacy_doc_format_blocked_use_docx' });
    expect(validateExtension('slides.ppt')).toEqual({ valid: false, reason: 'legacy_ppt_format_blocked_use_pptx' });
    expect(validateExtension('macro.xlsm').reason).toContain('macro_enabled_format_blocked');
    expect(validateExtension('no-extension').reason).toContain('missing_file_extension');
    expect(validateExtension('payload.exe').reason).toContain('extension_not_allowed');
  });

  it('checks size boundaries', () => {
    expect(validateFileSize(Buffer.from('hello')).valid).toBe(true);
    expect(validateFileSize(Buffer.alloc(0))).toEqual({ valid: false, reason: 'empty_file_buffer' });
    expect(validateFileSize(Buffer.alloc(51 * 1024 * 1024)).reason).toContain('file_too_large');
  });

  it('allows safe MIME types and rejects unknown binary types', () => {
    expect(validateMimeType(null).valid).toBe(true);
    expect(validateMimeType('text/plain; charset=utf-8').valid).toBe(true);
    expect(validateMimeType('application/octet-stream').valid).toBe(true);
    expect(validateMimeType('text/x-python').valid).toBe(true);
    expect(validateMimeType('application/x-msdownload').reason).toBe('mime_type_not_allowed: application/x-msdownload');
  });

  it('checks extracted text content length', () => {
    expect(validateTextContent('short')).toEqual({ valid: false, reason: 'insufficient_text_content' });
    expect(validateTextContent('this is enough text').valid).toBe(true);
    expect(validateTextContent('x'.repeat(10 * 1024 * 1024 + 1)).reason).toContain('text_content_too_large');
  });

  it('validates whole file import including magic bytes and MIME type', () => {
    const txt = Buffer.from('this is plain text for import');
    expect(validateFileForImport(txt, 'safe.txt', 'text/plain').valid).toBe(true);
    expect(validateFileForImport(txt, 'safe.txt').valid).toBe(true);
    expect(validateFileForImport(Buffer.alloc(0), 'safe.txt', 'text/plain').reason).toBe('empty_file_buffer');

    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(validateFileForImport(pdf, 'doc.pdf', 'application/pdf').valid).toBe(true);
    expect(validateFileForImport(pdf, 'doc.pdf', 'application/x-msdownload').reason).toContain('mime_type_not_allowed');
    expect(validateFileForImport(Buffer.from([0x01, 0x02, 0x03]), 'tiny.txt', 'text/plain').valid).toBe(true);

    const ole = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0x00]);
    expect(validateFileForImport(ole, 'fake.xlsx', 'application/vnd.ms-excel').reason).toContain('magic_bytes_ole_rejected');
    expect(validateFileForImport(ole, 'legacy.doc', 'application/vnd.ms-excel').reason).toBe('legacy_doc_format_blocked_use_docx');

    const unknownMagic = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(validateFileForImport(unknownMagic, 'data.bin', 'application/x-msdownload').reason).toContain('extension_not_allowed');
  });
});
