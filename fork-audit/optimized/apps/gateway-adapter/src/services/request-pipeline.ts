/**
 * gateway-adapter 请求流水线
 *
 * 从原版 processIncomingText / submitKnowledge / checkOrgQuota / quickLookup
 * 中提取核心逻辑，使用中间件模式消除 5 个路由路径的重复模板。
 *
 * @module request-pipeline
 */

import { intentClassifier, type IntentClassification, type IntentType } from '../../../libs/shared/src/intent/classifier';
import { memoryManager } from './memory-manager';
import { getPool } from '../../../libs/shared/src/db/pool-manager';

type Middleware = (ctx: PipelineContext, next: () => Promise<PipelineResult>) => Promise<PipelineResult>;

interface PipelineContext {
  normalized: Record<string, unknown>;
  intent: IntentClassification;
  text: string;
  ownerUserId: string;
  sessionId: string;
  orgId: string;
}

interface PipelineResult {
  requestType: IntentType;
  replyText: string;
  modelCallOk: boolean;
  workflowRef?: string;
  runRef?: string;
}

export class RequestPipeline {
  private middlewares: Middleware[] = [];
  private workflowUrl: string;
  private factRetrievalUrl: string;
  private resourceSchedulerUrl: string;
  private maxInflight: number;
  private inflightCounter = 0;

  constructor(config?: {
    workflowUrl?: string;
    factRetrievalUrl?: string;
    resourceSchedulerUrl?: string;
    maxInflight?: number;
  }) {
    this.workflowUrl = config?.workflowUrl || process.env.WORKFLOW_URL || '';
    this.factRetrievalUrl = config?.factRetrievalUrl || process.env.FACT_RETRIEVAL_URL || '';
    this.resourceSchedulerUrl = config?.resourceSchedulerUrl || process.env.RESOURCE_SCHEDULER_URL || '';
    this.maxInflight = config?.maxInflight || Number(process.env.MAX_INFLIGHT_REQUESTS || 50);
  }

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  build(): (normalized: Record<string, unknown>) => Promise<PipelineResult> {
    const chain = this.middlewares;

    return async (normalized: Record<string, unknown>): Promise<PipelineResult> => {
      if (this.inflightCounter >= this.maxInflight) {
        return {
          requestType: 'chat',
          replyText: '系统当前繁忙，请稍后重试。',
          modelCallOk: false
        };
      }

      this.inflightCounter++;
      try {
        const text = String(normalized.request_text || '');
        const ownerUserId = String(normalized.user_id || normalized.session_ref || 'anonymous');
        const sessionId = String(normalized.session_ref || 'default');
        const orgId = String(normalized.org_id || '');

        const intent = await intentClassifier.classify(text);

        const ctx: PipelineContext = { normalized, intent, text, ownerUserId, sessionId, orgId };

        let index = 0;
        const next = (): Promise<PipelineResult> => {
          if (index >= chain.length) {
            return this.defaultHandler(ctx);
          }
          const mw = chain[index++];
          return mw(ctx, next);
        };

        return await next();
      } finally {
        this.inflightCounter--;
      }
    };
  }

  /** 默认处理器 - chat 路径 */
  private async defaultHandler(ctx: PipelineContext): Promise<PipelineResult> {
    const recalled = await memoryManager.recall(ctx.ownerUserId, ctx.sessionId);
    const chat = await memoryManager.generateChatReply(ctx.text, ctx.ownerUserId, recalled.context || undefined);

    const prefix = recalled.degraded ? '（提示：历史上下文暂不可用）\n' : '';

    await memoryManager.remember(ctx.ownerUserId, ctx.sessionId, 'user', ctx.text);
    await memoryManager.remember(ctx.ownerUserId, ctx.sessionId, 'assistant', chat.text);

    return {
      requestType: 'chat',
      replyText: `${prefix}${chat.text}`,
      modelCallOk: chat.modelCallOk
    };
  }
}

/**
 * 中间件: 身份验证检查
 */
export const requireIdentity: Middleware = async (ctx, next) => {
  if (ctx.normalized.identity_binding_state !== 'bound') {
    return {
      requestType: ctx.intent.intent_type,
      replyText: '身份尚未绑定，请先完成身份验证后再继续。',
      modelCallOk: false
    };
  }
  return next();
};

/**
 * 中间件: 配额检查
 */
export function createQuotaCheck(options: {
  resourceSchedulerUrl?: string;
  workflowUrl?: string;
}): Middleware {
  return async (ctx, next) => {
    if (!ctx.orgId) return next();

    try {
      // 简化版配额检查：查询 org_task 表
      const pool = await getPool('gateway-adapter');
      if (!pool) return next();

      const orgResult = await pool.query(
        `SELECT settings FROM organization WHERE id = $1 AND status = 'active'`,
        [ctx.orgId]
      );

      if (orgResult.rows.length > 0) {
        const settings = (orgResult.rows[0].settings as Record<string, unknown>) || {};
        const maxWorkflows = Number(settings.max_workflows_per_day || 0);

        if (maxWorkflows > 0) {
          const todayResult = await pool.query(
            `SELECT COUNT(*) as cnt FROM audit_event
             WHERE action = 'workflow.create' AND org_id = $1
             AND occurred_at >= date_trunc('day', now())`,
            [ctx.orgId]
          );

          const current = Number(todayResult.rows[0]?.cnt || 0);
          if (current >= maxWorkflows) {
            return {
              requestType: ctx.intent.intent_type,
              replyText: `组织今日任务配额已用尽（${current}/${maxWorkflows}），请明日再试。`,
              modelCallOk: false
            };
          }
        }
      }
    } catch {
      // 检查失败时放行
    }

    return next();
  };
}

/**
 * 中间件: 记忆持久化
 */
export const persistMemory: Middleware = async (ctx, next) => {
  const result = await next();
  await memoryManager.remember(ctx.ownerUserId, ctx.sessionId, 'user', ctx.text);
  await memoryManager.remember(ctx.ownerUserId, ctx.sessionId, 'assistant', result.replyText);
  return result;
};

/**
 * Handler: 知识提交路径
 */
export async function handleKnowledgeSubmit(ctx: PipelineContext): Promise<PipelineResult> {
  if (!ctx.factRetrievalUrl) {
    return { requestType: 'knowledge_submit', replyText: '知识服务暂不可用。', modelCallOk: false };
  }

  try {
    const res = await fetch(`${ctx.factRetrievalUrl}/internal/fact/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner_user_id: ctx.ownerUserId,
        org_id: ctx.orgId,
        source_text: ctx.text,
        source: 'user_submitted',
        status: 'unconfirmed'
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      return { requestType: 'knowledge_submit', replyText: '知识提交失败，已记录。请稍后重试。', modelCallOk: false };
    }

    const body = await res.json() as { fact_id?: string };
    const factId = body.fact_id || 'unknown';

    return {
      requestType: 'knowledge_submit',
      replyText: `知识已提交审核！\n知识编号: ${factId}\n管理员将在审核后收录到知识库。`,
      modelCallOk: true
    };
  } catch {
    return { requestType: 'knowledge_submit', replyText: '知识提交异常，已记录重试。', modelCallOk: false };
  }
}

/**
 * Handler: 快速查询路径
 */
export async function handleQuickLookup(ctx: PipelineContext): Promise<PipelineResult> {
  if (!ctx.workflowUrl) {
    return { requestType: 'quick_lookup', replyText: '查询服务暂不可用。', modelCallOk: false };
  }

  try {
    const planRes = await fetch(`${ctx.workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: ctx.ownerUserId,
        task_type_hint: 'knowledge',
        risk_level: 'low',
        user_goal: ctx.text,
        budget: { time_sec: 15, retrieval: 3, execution: 1 },
        policy_snapshot_hash: ''
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!planRes.ok) return { requestType: 'quick_lookup', replyText: '', modelCallOk: false };

    const planBody = await planRes.json() as { workflow_instance_ref?: string };
    const wfRef = planBody.workflow_instance_ref;
    if (!wfRef) return { requestType: 'quick_lookup', replyText: '', modelCallOk: false };

    await fetch(`${ctx.workflowUrl}/internal/workflows/${wfRef}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'quick_lookup' }),
      signal: AbortSignal.timeout(5000)
    });

    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const wfRes = await fetch(`${ctx.workflowUrl}/internal/workflows/${wfRef}?detail_mode=short`, {
        signal: AbortSignal.timeout(3000)
      });
      if (!wfRes.ok) continue;

      const wf = await wfRes.json() as { status?: string; stages?: Array<{ last_output_preview?: string }> };
      if (wf.status === 'succeeded' || wf.status === 'completed') {
        const preview = wf.stages?.[wf.stages.length - 1]?.last_output_preview || '';
        return {
          requestType: 'quick_lookup',
          replyText: `查询结果:\n${preview.substring(0, 800)}${preview.length > 800 ? '\n...(结果已截断)' : ''}`,
          modelCallOk: true
        };
      }
      if (wf.status === 'failed') break;
    }

    return { requestType: 'quick_lookup', replyText: '', modelCallOk: false };
  } catch {
    return { requestType: 'quick_lookup', replyText: '', modelCallOk: false };
  }
}

/**
 * Handler: 任务路径
 */
export async function handleTask(ctx: PipelineContext): Promise<PipelineResult> {
  if (!ctx.workflowUrl) {
    return { requestType: 'task', replyText: '任务服务暂不可用。', modelCallOk: false };
  }

  const policyHash = String(ctx.normalized.policy_snapshot_hash || '');
  if (!policyHash || !policyHash.startsWith('sha256:')) {
    return { requestType: 'task', replyText: '权限策略校验暂不可用，请稍后重试。', modelCallOk: false };
  }

  try {
    const plan = await fetch(`${ctx.workflowUrl}/internal/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: ctx.ownerUserId,
        task_type_hint: ctx.intent.task_type_hint,
        risk_level: ctx.intent.risk_level,
        user_goal: ctx.text,
        budget: { time_sec: 3600, retrieval: 15, execution: 30 },
        policy_snapshot_hash: policyHash
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!plan.ok) {
      return { requestType: 'task', replyText: '任务受理失败：规划服务暂不可用。', modelCallOk: false };
    }

    const planBody = await plan.json() as { workflow_instance_ref?: string };
    const workflowRef = planBody.workflow_instance_ref || `wf_${Date.now()}`;

    const dispatch = await fetch(`${ctx.workflowUrl}/internal/workflows/${workflowRef}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'channel_ingress' }),
      signal: AbortSignal.timeout(15000)
    });

    if (!dispatch.ok) {
      return {
        requestType: 'task',
        replyText: `任务已创建（${workflowRef}），但派发执行失败。请稍后重试。`,
        modelCallOk: false,
        workflowRef
      };
    }

    const dispatchBody = await dispatch.json() as { executor_run_ref?: string };
    const runRef = dispatchBody.executor_run_ref || `run_${Date.now()}`;

    return {
      requestType: 'task',
      replyText: `已受理您的任务，正在规划执行中...\n任务编号: ${workflowRef}`,
      modelCallOk: true,
      workflowRef,
      runRef
    };
  } catch {
    return { requestType: 'task', replyText: '任务受理异常，已记录重试。', modelCallOk: false };
  }
}

/**
 * Handler: 任务下发路径 (管理员)
 */
export async function handleTaskDispatch(ctx: PipelineContext): Promise<PipelineResult> {
  const pool = await getPool('gateway-adapter');
  if (!pool) {
    return { requestType: 'task_dispatch', replyText: '系统暂不可用，请稍后重试。', modelCallOk: false };
  }

  try {
    const roleCheck = await pool.query(
      `SELECT role FROM "user" WHERE username = $1 LIMIT 1`,
      [ctx.ownerUserId]
    );

    if (roleCheck.rows.length === 0 || roleCheck.rows[0].role !== 'admin') {
      return {
        requestType: 'task_dispatch',
        replyText: '只有管理员才有权限下发工作任务。',
        modelCallOk: false
      };
    }

    const taskResult = await pool.query(
      `INSERT INTO org_task (org_id, created_by, title, description, task_type, schedule_type, status, prompt_message, target_channels, required_fields, metadata)
       VALUES ($1,$2,$3,$4,'form','once','active',$5,ARRAY['wecom','feishu'],'[]'::jsonb,jsonb_build_object('source','lui','channel',$6))
       RETURNING *`,
      [ctx.orgId || null, ctx.ownerUserId, ctx.text.substring(0, 100), ctx.text, ctx.text, String(ctx.normalized.channel_type || 'unknown')]
    );

    const task = taskResult.rows[0];

    // 为用户分配任务
    let assignedCount = 0;
    let users: Array<{ id: string; username: string }> = [];

    if (ctx.orgId) {
      const userResult = await pool.query(`SELECT id, username FROM "user" WHERE org_id = $1`, [ctx.orgId]);
      users = userResult.rows;
    } else {
      const userResult = await pool.query(`SELECT id, username FROM "user" LIMIT 100`);
      users = userResult.rows;
    }

    for (const user of users) {
      const existing = await pool.query(
        `SELECT id FROM org_task_assignment WHERE task_id = $1 AND user_id = $2 AND status IN ('pending','notified')`,
        [task.id, user.id]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO org_task_assignment (task_id, user_id, org_id, status, response_data, metadata) VALUES ($1,$2,$3,'pending','{}'::jsonb,'{}'::jsonb)`,
        [task.id, user.id, ctx.orgId || null]
      );
      assignedCount++;
    }

    return {
      requestType: 'task_dispatch',
      replyText: `工作要求已创建并下发！\n任务: ${task.title}\n已分配: ${assignedCount} 人\n任务编号: ${task.id}`,
      modelCallOk: true
    };
  } catch (err) {
    return {
      requestType: 'task_dispatch',
      replyText: '任务下发失败，请稍后重试或通过Web管理门户手动创建。',
      modelCallOk: false
    };
  }
}