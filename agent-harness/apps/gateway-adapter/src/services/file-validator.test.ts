import {
  sanitizeFileName,
  validateExtension,
  validateFileSize,
  validateMimeType,
  validateTextContent,
  validateFileForImport
} from './file-validator'

describe('file-validator', () => {
  describe('sanitizeFileName', () => {
    it('should return original name for valid filename', () => {
      const result = sanitizeFileName('report.pdf')
      expect(result.original).toBe('report.pdf')
      expect(result.sanitized).toBe('report.pdf')
    })

    it('should strip path separators and keep basename', () => {
      const result = sanitizeFileName('../../../etc/passwd')
      expect(result.sanitized).toBe('passwd')
    })

    it('should replace Windows backslash paths', () => {
      const result = sanitizeFileName('C:\\Users\\test.txt')
      expect(result.sanitized).toBe('test.txt')
    })

    it('should strip double dots', () => {
      const result = sanitizeFileName('evil..txt')
      expect(result.sanitized).toBe('eviltxt')
    })

    it('should replace angle brackets and control chars', () => {
      const result = sanitizeFileName('file<name>.txt')
      expect(result.sanitized).toBe('file_name_.txt')
    })

    it('should remove leading dots', () => {
      const result = sanitizeFileName('.hidden_file')
      expect(result.sanitized).toBe('hidden_file')
    })

    it('should remove trailing dots', () => {
      const result = sanitizeFileName('file.')
      expect(result.sanitized).toBe('file')
    })

    it('should trim outer whitespace', () => {
      const result = sanitizeFileName('  spaces  .pdf  ')
      expect(result.sanitized).toBe('spaces  .pdf')
    })

    it('should truncate to 255 chars', () => {
      const longName = 'x'.repeat(300)
      const result = sanitizeFileName(longName)
      expect(result.sanitized.length).toBeLessThanOrEqual(255)
    })

    it('should generate fallback for empty sanitized name', () => {
      const result = sanitizeFileName('......')
      expect(result.sanitized).toContain('file_')
    })
  })

  describe('validateExtension', () => {
    it('should accept pdf extension', () => {
      const result = validateExtension('document.pdf')
      expect(result.valid).toBe(true)
    })

    it('should accept docx extension', () => {
      const result = validateExtension('document.docx')
      expect(result.valid).toBe(true)
    })

    it('should accept txt extension', () => {
      const result = validateExtension('notes.txt')
      expect(result.valid).toBe(true)
    })

    it('should accept md extension', () => {
      const result = validateExtension('readme.md')
      expect(result.valid).toBe(true)
    })

    it('should accept csv extension', () => {
      const result = validateExtension('data.csv')
      expect(result.valid).toBe(true)
    })

    it('should reject .doc legacy format', () => {
      const result = validateExtension('document.doc')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('legacy_doc_format')
    })

    it('should reject .ppt legacy format', () => {
      const result = validateExtension('slides.ppt')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('legacy_ppt_format')
    })

    it('should reject macro-enabled .xlsm format', () => {
      const result = validateExtension('spreadsheet.xlsm')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('macro_enabled_format_blocked')
    })

    it('should reject .docm format', () => {
      const result = validateExtension('document.docm')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('macro_enabled_format_blocked')
    })

    it('should reject .pptm format', () => {
      const result = validateExtension('slides.pptm')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('macro_enabled_format_blocked')
    })

    it('should reject .xlsb format', () => {
      const result = validateExtension('workbook.xlsb')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('macro_enabled_format_blocked')
    })

    it('should reject unknown extension', () => {
      const result = validateExtension('program.exe')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('extension_not_allowed')
    })

    it('should reject unknown filename as extension_not_allowed', () => {
      const result = validateExtension('noextension')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('extension_not_allowed')
    })

    it('should accept xlsx extension', () => {
      const result = validateExtension('spreadsheet.xlsx')
      expect(result.valid).toBe(true)
    })

    it('should accept pptx extension', () => {
      const result = validateExtension('slides.pptx')
      expect(result.valid).toBe(true)
    })

    it('should accept json extension', () => {
      const result = validateExtension('config.json')
      expect(result.valid).toBe(true)
    })

    it('should accept yaml extension', () => {
      const result = validateExtension('config.yaml')
      expect(result.valid).toBe(true)
    })

    it('should accept ts extension', () => {
      const result = validateExtension('app.ts')
      expect(result.valid).toBe(true)
    })
  })

  describe('validateFileSize', () => {
    it('should accept file within size limit', () => {
      const buf = Buffer.alloc(1024, 'a')
      const result = validateFileSize(buf)
      expect(result.valid).toBe(true)
    })

    it('should reject empty buffer', () => {
      const buf = Buffer.alloc(0)
      const result = validateFileSize(buf)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('empty_file_buffer')
    })

    it('should reject file exceeding 50MB limit', () => {
      const buf = Buffer.alloc(51 * 1024 * 1024, 'a')
      const result = validateFileSize(buf)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('file_too_large')
    })

    it('should accept file at exactly 50MB', () => {
      const buf = Buffer.alloc(50 * 1024 * 1024, 'a')
      const result = validateFileSize(buf)
      expect(result.valid).toBe(true)
    })
  })

  describe('validateMimeType', () => {
    it('should accept null mime type', () => {
      const result = validateMimeType(null)
      expect(result.valid).toBe(true)
    })

    it('should accept text/plain', () => {
      const result = validateMimeType('text/plain')
      expect(result.valid).toBe(true)
    })

    it('should accept application/pdf', () => {
      const result = validateMimeType('application/pdf')
      expect(result.valid).toBe(true)
    })

    it('should accept application/octet-stream', () => {
      const result = validateMimeType('application/octet-stream')
      expect(result.valid).toBe(true)
    })

    it('should accept any text/* mime type', () => {
      const result = validateMimeType('text/custom-format')
      expect(result.valid).toBe(true)
    })

    it('should strip charset and accept mime type', () => {
      const result = validateMimeType('text/plain; charset=utf-8')
      expect(result.valid).toBe(true)
    })

    it('should reject image/png', () => {
      const result = validateMimeType('image/png')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('mime_type_not_allowed')
    })

    it('should reject application/x-msdownload', () => {
      const result = validateMimeType('application/x-msdownload')
      expect(result.valid).toBe(false)
    })
  })

  describe('validateTextContent', () => {
    it('should accept valid text content', () => {
      const result = validateTextContent('This is some text content for testing.')
      expect(result.valid).toBe(true)
    })

    it('should reject empty string', () => {
      const result = validateTextContent('')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('insufficient_text_content')
    })

    it('should reject whitespace-only text', () => {
      const result = validateTextContent('   \n  \t  ')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('insufficient_text_content')
    })

    it('should reject text shorter than minimum length', () => {
      const result = validateTextContent('short')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('insufficient_text_content')
    })

    it('should reject text exceeding maximum length', () => {
      const longText = 'x'.repeat(11 * 1024 * 1024)
      const result = validateTextContent(longText)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('text_content_too_large')
    })

    it('should accept text at exactly minimum length', () => {
      const result = validateTextContent('x'.repeat(10))
      expect(result.valid).toBe(true)
    })
  })

  describe('validateFileForImport', () => {
    it('should validate a valid PDF file', () => {
      const buf = Buffer.alloc(2048, 'a')
      buf[0] = 0x25
      buf[1] = 0x50
      buf[2] = 0x44
      buf[3] = 0x46
      const result = validateFileForImport(buf, 'document.pdf', 'application/pdf')
      expect(result.valid).toBe(true)
    })

    it('should reject file with disallowed extension', () => {
      const buf = Buffer.alloc(1024, 'a')
      const result = validateFileForImport(buf, 'program.exe')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('extension_not_allowed')
    })

    it('should reject empty file', () => {
      const buf = Buffer.alloc(0)
      const result = validateFileForImport(buf, 'empty.txt')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('empty_file_buffer')
    })

    it('should reject file with disallowed MIME type', () => {
      const buf = Buffer.alloc(2048, 'a')
      const result = validateFileForImport(buf, 'data.txt', 'application/x-msdownload')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('mime_type_not_allowed')
    })

    it('should validate without mime type parameter', () => {
      const buf = Buffer.alloc(2048, 'a')
      const result = validateFileForImport(buf, 'data.txt')
      expect(result.valid).toBe(true)
    })

    it('should reject OLE magic bytes for non-doc files', () => {
      const buf = Buffer.alloc(2048)
      buf[0] = 0xD0
      buf[1] = 0xCF
      buf[2] = 0x11
      buf[3] = 0xE0
      const result = validateFileForImport(buf, 'file.xlsx')
      expect(result.valid).toBe(false)
      expect(result.reason).toContain('magic_bytes_ole_rejected')
    })
  })
})