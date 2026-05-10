/**
 * gateway-adapter 文件导入器
 *
 * 从原版 extractTextFromFile / downloadAndParseFile 中提取核心逻辑。
 *
 * @module file-importer
 */

import { getPool } from '../../../libs/shared/src/db/pool-manager';
import type { DownloadFileResult } from '../../../libs/shared/src/channel/adapter';

export interface ImportResult {
  success: boolean;
  rawText: string;
  docId?: string;
  error?: string;
}

/**
 * 从文件 buffer 提取文本内容
 */
async function extractText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (lowerName.endsWith('.txt') || lowerMime.includes('text/plain')) {
    return buffer.toString('utf8');
  }

  if (lowerName.endsWith('.json') || lowerMime.includes('application/json')) {
    return buffer.toString('utf8');
  }

  if (lowerName.endsWith('.md') || lowerMime.includes('text/markdown')) {
    return buffer.toString('utf8');
  }

  // PDF
  if (lowerName.endsWith('.pdf') || lowerMime.includes('application/pdf')) {
    try {
      const pdfjs = await import('pdf-parse');
      const data = await pdfjs.default(buffer);
      return data.text || '';
    } catch {
      return '';
    }
  }

  // DOCX
  if (lowerName.endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch {
      return '';
    }
  }

  // DOC/XLS/PPT/XLSX/PPTX - officeparser
  if (['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].some(ext => lowerName.endsWith(ext))) {
    try {
      const parser = await import('officeparser');
      return await parser.parseOfficeAsync(buffer) || '';
    } catch {
      return '';
    }
  }

  // 尝试作为 UTF-8 文本读取
  try {
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * 导入文件到知识库
 */
export async function importFile(
  fileResult: DownloadFileResult,
  ownerUserId: string,
  orgId: string,
  channelType: string
): Promise<ImportResult> {
  try {
    const mimeType = 'application/octet-stream';
    const rawText = await extractText(fileResult.buffer, mimeType, fileResult.fileName);

    if (!rawText || rawText.trim().length < 10) {
      return { success: false, rawText: '', error: '无法提取文件内容或文件内容过短' };
    }

    const pool = await getPool('gateway-adapter');
    if (!pool) {
      return { success: true, rawText, error: undefined };
    }

    const docFileName = fileResult.fileName.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const docResult = await pool.query(
      `INSERT INTO document (owner_user_id, org_id, file_name, source, mime_type, content, meta, status)
       VALUES ($1,$2,$3,'uploaded',$4,$5,jsonb_build_object('channel', $6, 'source','channel_upload'),'imported')
       RETURNING id`,
      [ownerUserId, orgId || null, docFileName, mimeType, rawText, channelType]
    );

    const docId = docResult.rows[0]?.id || 'unknown';

    return { success: true, rawText, docId };
  } catch (err) {
    return { success: false, rawText: '', error: String(err) };
  }
}