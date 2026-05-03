/**
 * File Validator — 文件上传安全校验
 *
 * 白名单机制验证: 文件扩展名(80+种) / MIME 类型 / 文件大小(50MB上限) / 文本内容长度。
 * 拦截旧版 Office 格式(.doc/.ppt)和宏文件(.xlsm/.docm/.pptm)。
 * 文件名安全清洗: 移除路径穿越、控制字符、首尾点号。
 *
 * @module file-validator
 */

import { createHash } from 'node:crypto';

const ALLOWED_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm',
  'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'rb',
  'php', 'c', 'cpp', 'h', 'hpp', 'swift', 'kt', 'scala', 'r', 'm',
  'sql', 'sh', 'bash', 'ps1', 'bat', 'log', 'conf', 'ini', 'cfg',
  'toml', 'env', 'properties', 'dockerfile', 'makefile', 'cmake',
  'pdf', 'docx', 'xlsx', 'xls', 'pptx', 'odt', 'odp', 'ods', 'rtf'
]);

const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'text/yaml',
  'application/json',
  'application/x-yaml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  'application/octet-stream'
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MIN_TEXT_LENGTH = 10;
const MAX_TEXT_LENGTH = 10 * 1024 * 1024;

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

export interface SafeFileName {
  original: string;
  sanitized: string;
}

export function sanitizeFileName(raw: string): SafeFileName {
  const normalized = raw.replace(/\\/g, '/');

  const basename = normalized.split('/').pop() || normalized;

  const sanitized = basename
    .replace(/\.\./g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/gu, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 255);

  if (!sanitized || sanitized.length === 0) {
    const fallback = `file_${Date.now()}_${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
    return { original: raw, sanitized: fallback };
  }

  return { original: raw, sanitized };
}

export function validateExtension(fileName: string): FileValidationResult {
  const { sanitized } = sanitizeFileName(fileName);
  const ext = sanitized.split('.').pop()?.toLowerCase() || '';

  if (!ext) {
    const dotParts = sanitized.split('.');
    if (dotParts.length > 1) {
      const lastPart = dotParts[dotParts.length - 1]?.toLowerCase() || '';
      if (lastPart && ALLOWED_EXTENSIONS.has(lastPart)) {
        return { valid: true };
      }
    }
    return { valid: false, reason: `missing_file_extension: ${sanitized.slice(0, 50)}` };
  }

  if (ext === 'doc') {
    return { valid: false, reason: 'legacy_doc_format_blocked_use_docx' };
  }
  if (ext === 'ppt') {
    return { valid: false, reason: 'legacy_ppt_format_blocked_use_pptx' };
  }
  if (ext === 'xlsb' || ext === 'xlsm' || ext === 'docm' || ext === 'pptm') {
    return { valid: false, reason: `macro_enabled_format_blocked: .${ext}` };
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `extension_not_allowed: .${ext}` };
  }

  return { valid: true };
}

export function validateFileSize(buffer: Buffer): FileValidationResult {
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      reason: `file_too_large: ${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB exceeds ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB limit`
    };
  }

  if (buffer.byteLength === 0) {
    return { valid: false, reason: 'empty_file_buffer' };
  }

  return { valid: true };
}

export function validateMimeType(mimeType: string | null): FileValidationResult {
  if (!mimeType) {
    return { valid: true };
  }

  const baseType = mimeType.split(';')[0].trim().toLowerCase();

  if (baseType === 'application/octet-stream') {
    return { valid: true };
  }

  if (ALLOWED_MIME_TYPES.has(baseType)) {
    return { valid: true };
  }

  if (baseType.startsWith('text/')) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `mime_type_not_allowed: ${baseType}`
  };
}

export function validateTextContent(text: string): FileValidationResult {
  if (!text || text.trim().length < MIN_TEXT_LENGTH) {
    return { valid: false, reason: 'insufficient_text_content' };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return {
      valid: false,
      reason: `text_content_too_large: ${text.length} chars exceeds ${MAX_TEXT_LENGTH} limit`
    };
  }

  return { valid: true };
}

export function validateFileForImport(
  buffer: Buffer,
  fileName: string,
  mimeType?: string | null
): FileValidationResult {
  const extResult = validateExtension(fileName);
  if (!extResult.valid) return extResult;

  const sizeResult = validateFileSize(buffer);
  if (!sizeResult.valid) return sizeResult;

  if (mimeType) {
    const mimeResult = validateMimeType(mimeType);
    if (!mimeResult.valid) return mimeResult;
  }

  return { valid: true };
}
