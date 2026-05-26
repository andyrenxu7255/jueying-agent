import { createLogger } from '@agent-harness/shared';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const logger = createLogger('markdown-archiver');

const ARCHIVE_BASE_PATH = process.env.ARCHIVE_PATH || '/app/.runtime/archive';

export interface ArchiveOptions {
  workflow_instance_ref: string;
  user_id: string;
  workflow_type: string;
  goal: string;
  stages: Array<{
    stage_id: string;
    stage_seq?: number;
    stage_type: string;
    purpose: string;
    status: string;
    output?: string;
    started_at?: string;
    completed_at?: string;
  }>;
  started_at: string;
  completed_at?: string;
  status: string;
  progress_percentage?: number;
}

export interface ConversationArchiveOptions {
  conversation_id: string;
  channel_type: string;
  user_id?: string;
  messages: Array<{
    direction: 'inbound' | 'outbound';
    content: string;
    created_at: string;
  }>;
  started_at: string;
}

function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

function formatTimestamp(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
}

async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // Directory already exists or creation failed silently
  }
}

export class MarkdownArchiver {
  async archiveWorkflow(options: ArchiveOptions): Promise<{ path: string; ok: boolean }> {
    const datePath = formatDate(options.started_at);
    const userPath = options.user_id || 'anonymous';
    const baseDir = join(ARCHIVE_BASE_PATH, 'workflows', datePath, userPath);
    
    await ensureDir(baseDir);

    const filename = `${options.workflow_instance_ref}.md`;
    const filePath = join(baseDir, filename);

    const content = this.generateWorkflowMarkdown(options);

    try {
      await writeFile(filePath, content, 'utf-8');
      
      logger.info('archive.workflow.saved', 'Workflow archived to Markdown', {
        workflow_instance_ref: options.workflow_instance_ref,
        path: filePath
      });

      return { path: filePath, ok: true };
    } catch (error) {
      logger.error('archive.workflow.failed', 'Failed to archive workflow', {
        workflow_instance_ref: options.workflow_instance_ref,
        error: String(error)
      });
      return { path: '', ok: false };
    }
  }

  async archiveConversation(options: ConversationArchiveOptions): Promise<{ path: string; ok: boolean }> {
    const datePath = formatDate(options.started_at);
    const channelPath = options.channel_type;
    const baseDir = join(ARCHIVE_BASE_PATH, 'conversations', datePath, channelPath);

    await ensureDir(baseDir);

    const filename = `${options.conversation_id}.md`;
    const filePath = join(baseDir, filename);

    const content = this.generateConversationMarkdown(options);

    try {
      await writeFile(filePath, content, 'utf-8');

      logger.info('archive.conversation.saved', 'Conversation archived to Markdown', {
        conversation_id: options.conversation_id,
        path: filePath
      });

      return { path: filePath, ok: true };
    } catch (error) {
      logger.error('archive.conversation.failed', 'Failed to archive conversation', {
        conversation_id: options.conversation_id,
        error: String(error)
      });
      return { path: '', ok: false };
    }
  }

  private generateWorkflowMarkdown(options: ArchiveOptions): string {
    const lines = [
      `# Workflow: ${options.workflow_instance_ref}`,
      '',
      `**Type:** ${options.workflow_type}`,
      `**Status:** ${options.status}`,
      `**Owner:** ${options.user_id}`,
      `**Started:** ${formatTimestamp(options.started_at)}`,
      options.completed_at ? `**Completed:** ${formatTimestamp(options.completed_at)}` : '',
      options.progress_percentage ? `**Progress:** ${options.progress_percentage}%` : '',
      '',
      '## Goal',
      '',
      options.goal,
      '',
      '## Stages',
      ''
    ];

    for (const stage of options.stages) {
      lines.push(`### Stage ${stage.stage_seq || 0}: ${stage.stage_type}`);
      lines.push('');
      lines.push(`**ID:** ${stage.stage_id}`);
      lines.push(`**Purpose:** ${stage.purpose}`);
      lines.push(`**Status:** ${stage.status}`);
      if (stage.started_at) lines.push(`**Started:** ${formatTimestamp(stage.started_at)}`);
      if (stage.completed_at) lines.push(`**Completed:** ${formatTimestamp(stage.completed_at)}`);
      lines.push('');
      if (stage.output) {
        lines.push('**Output:**');
        lines.push('');
        lines.push('```');
        lines.push(stage.output.slice(0, 500));
        if (stage.output.length > 500) lines.push('... (truncated)');
        lines.push('```');
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    lines.push('');
    lines.push(`*Archived at ${formatTimestamp(new Date())}*`);

    return lines.join('\n');
  }

  private generateConversationMarkdown(options: ConversationArchiveOptions): string {
    const lines = [
      `# Conversation: ${options.conversation_id}`,
      '',
      `**Channel:** ${options.channel_type}`,
      options.user_id ? `**User:** ${options.user_id}` : '',
      `**Started:** ${formatTimestamp(options.started_at)}`,
      '',
      '## Messages',
      ''
    ];

    for (const msg of options.messages) {
      const prefix = msg.direction === 'inbound' ? '**User:**' : '**System:**';
      lines.push(`${prefix} ${formatTimestamp(msg.created_at)}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    lines.push('');
    lines.push(`*Archived at ${formatTimestamp(new Date())}*`);

    return lines.join('\n');
  }
}

export const markdownArchiver = new MarkdownArchiver();

export interface ParsedMarkdownTask {
  title: string;
  goal: string;
  task_type_hint?: 'development' | 'analysis' | 'knowledge' | 'sales' | 'implementation';
  risk_level?: 'low' | 'medium' | 'high';
  steps: Array<{
    name: string;
    description: string;
    executor?: string;
  }>;
  metadata: Record<string, string>;
}

export function parseMarkdownTask(markdown: string): ParsedMarkdownTask {
  const lines = markdown.split('\n');
  let title = '';
  let goal = '';
  let taskTypeHint: ParsedMarkdownTask['task_type_hint'];
  let riskLevel: ParsedMarkdownTask['risk_level'];
  const steps: ParsedMarkdownTask['steps'] = [];
  const metadata: Record<string, string> = {};

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match && !title) {
      title = h1Match[1].trim();
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      const sectionName = h2Match[1].trim().toLowerCase();
      if (['goal', '目标', 'objective'].some(k => sectionName.includes(k))) {
        goal = extractSectionContent(lines, lines.indexOf(line));
      }
      if (['steps', '步骤', 'procedure', '流程'].some(k => sectionName.includes(k))) {
        const stepLines = extractSectionContent(lines, lines.indexOf(line));
        parseStepsFromSection(stepLines, steps);
      }
      continue;
    }

    const metaMatch = line.match(/^[-*]\s+\*\*(.+?)\*\*:\s*(.+)$/);
    if (metaMatch) {
      const key = metaMatch[1].trim().toLowerCase();
      const value = metaMatch[2].trim();
      if (key === 'type' || key === 'task_type' || key === '类型') {
        if (['development', 'analysis', 'knowledge', 'sales', 'implementation'].includes(value)) {
          taskTypeHint = value as ParsedMarkdownTask['task_type_hint'];
        }
      }
      if (key === 'risk' || key === 'risk_level' || key === '风险') {
        if (['low', 'medium', 'high'].includes(value)) {
          riskLevel = value as ParsedMarkdownTask['risk_level'];
        }
      }
      metadata[key] = value;
    }

    const checkboxMatch = line.match(/^[-*]\s+\[[ x]\]\s+(.+)$/);
    if (checkboxMatch) {
      steps.push({
        name: checkboxMatch[1].trim(),
        description: checkboxMatch[1].trim()
      });
    }

    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      steps.push({
        name: numberedMatch[1].trim(),
        description: numberedMatch[1].trim()
      });
    }
  }

  if (!goal && title) {
    goal = title;
  }

  if (steps.length === 0) {
    steps.push({ name: 'Execute Task', description: goal || title });
  }

  return {
    title,
    goal,
    task_type_hint: taskTypeHint,
    risk_level: riskLevel,
    steps,
    metadata
  };
}

function extractSectionContent(lines: string[], startIdx: number): string {
  const content: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^#{1,2}\s+/)) break;
    content.push(lines[i]);
  }
  return content.join('\n').trim();
}

function parseStepsFromSection(sectionContent: string, steps: ParsedMarkdownTask['steps']): void {
  const stepLines = sectionContent.split('\n');
  for (const line of stepLines) {
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      steps.push({ name: h3Match[1].trim(), description: h3Match[1].trim() });
      continue;
    }
    const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      steps.push({ name: numberedMatch[1].trim(), description: numberedMatch[1].trim() });
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch && !bulletMatch[1].startsWith('**')) {
      steps.push({ name: bulletMatch[1].trim(), description: bulletMatch[1].trim() });
    }
  }
}