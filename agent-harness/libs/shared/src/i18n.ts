type LangPack = Record<string, string>

const zh: LangPack = {
  'system.busy': '系统繁忙，请稍后再试',
  'system.unavailable': '系统暂不可用，请稍后重试。',

  'identity.not_bound': '身份尚未绑定，请先完成身份验证后再发送任务消息',
  'identity.before_confirm': '身份尚未绑定，请先完成身份验证后再确认工作流。',
  'identity.before_submit_knowledge': '身份尚未绑定，请先完成身份验证后再提交知识。',
  'identity.before_query': '身份尚未绑定，请先完成身份验证后再进行查询。',
  'identity.before_create_task': '身份尚未绑定，请先完成身份验证后再创建任务。',
  'identity.before_dispatch_task': '身份尚未绑定，请先完成身份验证后再下发任务。',
  'identity.before_import': '身份尚未绑定，请先完成身份验证后再导入文件。',

  'org.quota_exceeded': '您的组织配额度不足，请联系管理员',
  'org.quota.db': '组织今日任务配额已用尽（{current}/{max}），请明日再试或联系管理员。',
  'org.quota.default': '资源配额不足',
  'org.quota.retry': '资源配额不足，请稍后重试或联系管理员。',
  'org.policy.unavailable': '权限策略校验暂不可用，请稍后重试。若持续出现请联系管理员。',

  'knowledge.submitted': '知识已提交至审核池',
  'knowledge.submit_failed': '知识提交失败',
  'knowledge.submit_failed_http': '知识提交失败 (HTTP {status})',
  'knowledge.submit_exception': '知识提交服务异常，已记录重试',
  'knowledge.no_content': '请提供要提交的知识内容',
  'knowledge.service_unavailable': '知识服务暂不可用',
  'knowledge.received': '📝 知识已收到并提交审核！\n知识编号: {factId}\n管理员将在审核后将其正式收录到组织知识库中。',

  'task.received': '✅ 已受理您的任务，正在规划执行中...\n任务编号: {workflowRef}',
  'task.created': '任务已创建：{workflowRef}',
  'task.create_failed': '任务创建失败，请稍后重试',
  'task.dispatch_failed': '任务已创建（{workflowRef}），但派发执行失败。请稍后重试，或联系管理员手动重派。',
  'task.plan_unavailable': '任务受理失败：规划服务暂不可用。请稍后重试，若持续失败请联系管理员并提供时间与账号。',

  'task_dispatch.admin_only': '只有管理员才有权限下发工作任务。如需此权限请联系系统管理员。',
  'task_dispatch.created': '✅ 工作要求已创建并下发！\n📋 任务: {title}\n👥 已分配: {assigned} 人\n📢 已通知: {notified} 人\n任务编号: {taskId}',
  'task_dispatch.failed': '任务下发失败，请稍后重试或通过Web管理门户手动创建。',

  'task.confirm_prompt': '确认工作流 ',
  'task.confirm_success': '✅ 已确认并激活这个 workflow 模板。\n任务编号: {workflowRef}\n模板名称: {skillName}\n下次你提出相似任务时，系统会先尝试匹配这条已确认路径。',
  'task.confirm_not_found': '暂时没有找到任务 {workflowRef} 对应的待确认 workflow。请先等待任务完成，或确认任务编号是否正确。',
  'task.confirm_draft': '已生成工作流草案 ',
  'task.confirm.unavailable': '工作流确认暂不可用：数据库连接不可用，请稍后重试。',
  'task.confirm.failed': '工作流确认失败，已记录异常，请稍后重试。',

  'file.import_success': '文件"{fileName}"已导入知识库 (document_id: {documentId})',
  'file.import_failed': '文件"{fileName}"导入失败: {error}',
  'file.unsupported': '不支持的文件类型',

  'quick_lookup.result': '🔍 查询结果:\n{preview}',
  'quick_lookup.no_result': '未找到相关信息',
  'quick_lookup.timeout': '查询超时，请稍后重试',

  'chat.fallback': '抱歉，我暂时无法处理这个请求，请稍后重试',
  'chat.model_error': 'AI 服务暂时不可用，请稍后重试',
  'chat.model_unavailable': '模型暂不可用，已收到你的消息。',
  'chat.model_empty': '模型返回为空，已记录重试。',

  'policy.blocked': '您的操作已被策略规则阻止',
  'history.unavailable': '（提示：历史上下文暂不可用，本次按当前消息回复）\n',

  'wf.stage.pending': '待执行',
  'wf.stage.running': '执行中',
  'wf.stage.completed': '已完成',
  'wf.stage.failed': '失败',
  'wf.stage.waiting_user': '等待用户',
  'wf.stage.blocked': '阻塞',
  'wf.stage.repairing': '自主修复中',
  'wf.stage.paused': '暂停',
  'wf.stage.default': '阶段',
  'wf.stage.output_prefix': '；产出：',
  'wf.stage.more': '...还有 {count} 个阶段已记录在工作流详情中',
  'wf.result.message': '✅ 任务执行完成\n任务编号: {workflowRef}\n\n执行过程：\n{stageLines}\n{resultPreview}{confirmationLine}',
  'wf.result.error': '❌ 任务执行失败 ({status})\n任务编号: {workflowRef}\n\n已记录过程：\n{stageLines}{resultPreview}',
  'wf.result.summary_label': '结果摘要：',
  'wf.result.truncated': '...(结果已截断)',
  'wf.result.confirmation_prompt': '\n\n如果这条执行路径符合你的工作习惯，回复：确认工作流 {workflowRef}\n确认后它会成为你的私有 workflow 模板，下次同类任务会优先沿用；管理员后续可再审核提升为组织通用模板。',
  'wf.fallback_progress': '暂无阶段记录',
  'wf.progress': '⏳ 任务进行中：{status}\n任务编号: {workflowRef}',
  'wf.polling_timeout': '⏳ 任务仍在执行中，请稍后查看结果。\n任务编号: {workflowRef}',
  'wf.mobile_push_success': '任务执行完成',
  'wf.mobile_push_failure': '任务执行失败',
  'wf.stage.unknown': '未知',

  'admin.validation.required': 'title, task_type, schedule_type 为必填项',

  'error.body_too_large': '请求体超过10MB上限',

  'notify.task_body': '请及时提交您的反馈。',

  'skill.unnamed_goal': '未命名任务',
  'skill.pending_prefix': '[待确认]',
  'skill.extracted_description': '从工作流 {workflowRef} 自动提取，等待用户确认后激活。阶段链: {stageNames}',

  'llm.system_prompt': `你是一个企业级AI智能助手。{personaBlock}{workspaceBlock}

核心行为准则:
- 用中文回复，专业、简洁、准确
- 优先从组织知识库中查找答案，其次依赖你的通用知识
- 若用户问及"你的工作区"或"你能访问什么"，请参考【你的独立工作区信息】如实回答
- 若用户主要提知识片段，鼓励并引导其通过「提交知识」功能录入系统
- 对不确定的信息明确标注"待确认"
- 保护用户隐私，不向其他用户泄露敏感信息
- 涉及价格、合同等敏感内容时提醒用户核实`,

  'llm.context_summary_label': '对话历史摘要:\n',

  'llm.persona_block': `\n\n【你的身份与行为准则 - 此为你的soul/brain配置】\n- 核心性格(soul): {soul}\n- 身份定位(identity): {identity}\n- 语气风格(tone): {tone}\n- 行为边界: {boundary}\n- 技能标签: {tags}`,

  'llm.persona_block_def_soul': '专业、高效、贴心的企业AI助手',
  'llm.persona_block_def_identity': '企业级AI智能助手',
  'llm.persona_block_def_tone': '专业、简洁、准确',
  'llm.persona_block_def_boundary': '保护用户隐私，不泄露敏感信息',
  'llm.persona_block_def_tags': '通用知识问答',

  'llm.workspace_block': `\n\n【你的独立工作区信息】\n- 工作区目录: /workspace/{userId}\n- 知识库访问: PGSQL (事实/文档/记忆) ✅\n- 向量检索: pgvector ✅\n- 图数据库: Apache AGE ✅\n- 已有文档数: {docCount}\n- 已有事实数: {factCount}\n- 已存储记忆条数: {memoryCount}\n- 你可以通过知识检索、记忆召回等功能访问和操作这些数据`,

  'portal.login.empty_credentials': '用户名和密码不能为空',
  'portal.login.wrong_credentials': '用户名或密码错误',
  'portal.login.max_sessions': '会话数已达上限',
  'portal.login.rate_limited': '登录尝试次数过多，请等待 {remaining} 秒后重试',
  'portal.pwd.empty_fields': '请输入旧密码和新密码',
  'portal.pwd.wrong_old': '旧密码不正确',
  'portal.pwd.changed': '密码修改成功',
  'portal.pwd.min_length': '密码长度至少8位',
  'portal.pwd.too_weak': '密码强度不足：需包含大小写字母、数字或特殊字符',
  'portal.pwd.medium': '密码强度中等',
  'portal.pwd.good': '密码强度良好',
  'portal.logout.success': '已退出登录',
  'portal.admin.required': '需要管理员权限',
  'portal.setup.local_only': '仅限本地访问或提供有效 SETUP_TOKEN',
  'portal.setup.db_unavailable': '数据库不可用',
  'portal.setup.already_initialized': '系统已完成初始化',
  'portal.setup.admin_pass_required': '管理员密码不能为空',
  'portal.setup.step.database': '数据库连接',
  'portal.setup.step.organization': '组织创建',
  'portal.setup.step.admin': '管理员创建',
  'portal.setup.step.channel': '消息渠道',
  'portal.setup.step.llm': 'LLM模型',
  'portal.setup.step.embedding': '向量模型',
  'portal.llm.name_required': '模型名称不能为空',
  'portal.skill.not_found': '技能不存在或服务不可用',
  'portal.task.required_fields': 'title, task_type, schedule_type 为必填项',

  'config.label.feishu': '飞书渠道配置',
  'config.label.wecom': '企业微信渠道配置',
  'config.label.llm': 'LLM 模型配置',
  'config.label.embedding': 'Embedding 模型配置',
  'config.label.rerank': 'Rerank 配置',
  'config.label.clawhub': 'ClawHub 管理',
  'config.field.signing_secret': '签名密钥 (Signing Secret)',
  'config.field.signing_secret_hint': '仅飞书 webhook 回调校验需要；飞书长连接模式只需要 App ID 和 App Secret，可留空。',
  'config.field.domain': '域名',
  'config.field.corp_id': '企业ID (Corp ID)',
  'config.field.callback_token': '回调验证 Token',
  'config.field.aes_key': '消息加密 AES Key',
  'config.field.agent_id': '应用ID (Agent ID)',
  'config.field.app_secret': '应用Secret',
  'config.field.litellm_url': 'LiteLLM 地址',
  'config.field.default_model': '默认模型',
  'config.field.fallback_models': '备用模型 (逗号分隔)',
  'config.field.mode': '模式',
  'config.field.dimensions': '向量维度',
  'config.field.dimensions_hint': '可选；若上游支持，测试按钮会显示实际返回维度。',
  'config.field.timeout_ms': '超时时间(ms)',
  'config.field.timeout_ms_hint': '请求上游模型服务的超时时间。',
  'config.field.clawhub_site': 'ClawHub 入口',
  'config.field.clawhub_registry': 'Registry API',
  'config.field.clawhub_admin_token': 'Admin Token',
  'config.field.clawhub_admin_token_hint': '用于管理员上传、下载和升级技能；仅写入本地环境配置，不会在页面明文回显。',
}

const en: LangPack = {
  'system.busy': 'System is busy, please try again later',
  'system.unavailable': 'System is temporarily unavailable, please try again later.',

  'identity.not_bound': 'Identity not bound. Please complete identity verification before sending task messages',
  'identity.before_confirm': 'Identity not bound. Please complete identity verification before confirming workflows.',
  'identity.before_submit_knowledge': 'Identity not bound. Please complete identity verification before submitting knowledge.',
  'identity.before_query': 'Identity not bound. Please complete identity verification before querying.',
  'identity.before_create_task': 'Identity not bound. Please complete identity verification before creating tasks.',
  'identity.before_dispatch_task': 'Identity not bound. Please complete identity verification before dispatching tasks.',
  'identity.before_import': 'Identity not bound. Please complete identity verification before importing files.',

  'org.quota_exceeded': 'Your organization quota has been exceeded. Please contact the administrator',
  'org.quota.db': 'Your organization\'s daily task quota has been exhausted ({current}/{max}). Please try again tomorrow or contact the administrator.',
  'org.quota.default': 'Insufficient resource quota',
  'org.quota.retry': 'Insufficient resource quota. Please try again later or contact the administrator.',
  'org.policy.unavailable': 'Policy verification is temporarily unavailable. Please try again later. Contact the administrator if this persists.',

  'knowledge.submitted': 'Knowledge submitted to the review pool',
  'knowledge.submit_failed': 'Knowledge submission failed',
  'knowledge.submit_failed_http': 'Knowledge submission failed (HTTP {status})',
  'knowledge.submit_exception': 'Knowledge submission service exception, retry logged',
  'knowledge.no_content': 'Please provide knowledge content to submit',
  'knowledge.service_unavailable': 'Knowledge service is temporarily unavailable',
  'knowledge.received': '📝 Knowledge received and submitted for review!\nKnowledge ID: {factId}\nIt will be added to the organization knowledge base after administrator review.',

  'task.received': '✅ Task accepted, planning execution path...\nTask ID: {workflowRef}',
  'task.created': 'Task created: {workflowRef}',
  'task.create_failed': 'Task creation failed, please try again later',
  'task.dispatch_failed': 'Task created ({workflowRef}), but dispatch failed. Please try again later or contact the administrator to manually retry dispatch.',
  'task.plan_unavailable': 'Task acceptance failed: planning service is temporarily unavailable. Please try again later. If the issue persists, contact the administrator and provide the time and account details.',

  'task_dispatch.admin_only': 'Only administrators have permission to dispatch work tasks. Please contact the system administrator if you need this permission.',
  'task_dispatch.created': '✅ Work task created and dispatched!\n📋 Task: {title}\n👥 Assigned: {assigned} users\n📢 Notified: {notified} users\nTask ID: {taskId}',
  'task_dispatch.failed': 'Task dispatch failed. Please try again later or create manually via the web management portal.',

  'task.confirm_prompt': 'Confirm workflow ',
  'task.confirm_success': '✅ Workflow template confirmed and activated.\nTask ID: {workflowRef}\nTemplate name: {skillName}\nThe next time you make a similar request, the system will try to match this confirmed path first.',
  'task.confirm_not_found': 'No pending workflow found matching task {workflowRef}. Please wait for the task to complete or verify the task ID.',
  'task.confirm_draft': 'Workflow draft generated: ',
  'task.confirm.unavailable': 'Workflow confirmation is temporarily unavailable: database connection failed. Please try again later.',
  'task.confirm.failed': 'Workflow confirmation failed. The error has been logged. Please try again later.',

  'file.import_success': 'File "{fileName}" imported to knowledge base (document_id: {documentId})',
  'file.import_failed': 'File "{fileName}" import failed: {error}',
  'file.unsupported': 'Unsupported file type',

  'quick_lookup.result': '🔍 Query result:\n{preview}',
  'quick_lookup.no_result': 'No relevant information found',
  'quick_lookup.timeout': 'Query timeout, please try again later',

  'chat.fallback': 'Sorry, I cannot process this request right now. Please try again later',
  'chat.model_error': 'AI service temporarily unavailable, please try again later',
  'chat.model_unavailable': 'Model is temporarily unavailable. Your message has been received.',
  'chat.model_empty': 'Model returned an empty response. A retry has been logged.',

  'policy.blocked': 'Your operation has been blocked by policy rules',
  'history.unavailable': '(Note: historical context temporarily unavailable, responding to current message only)\n',

  'wf.stage.pending': 'Pending',
  'wf.stage.running': 'Running',
  'wf.stage.completed': 'Completed',
  'wf.stage.failed': 'Failed',
  'wf.stage.waiting_user': 'Awaiting User',
  'wf.stage.blocked': 'Blocked',
  'wf.stage.repairing': 'Auto-Repairing',
  'wf.stage.paused': 'Paused',
  'wf.stage.default': 'Stage',
  'wf.stage.output_prefix': '; Output: ',
  'wf.stage.more': '... {count} more stages recorded in workflow details',
  'wf.result.message': '✅ Task execution completed\nTask ID: {workflowRef}\n\nExecution process:\n{stageLines}\n{resultPreview}{confirmationLine}',
  'wf.result.error': '❌ Task execution failed ({status})\nTask ID: {workflowRef}\n\nRecorded process:\n{stageLines}{resultPreview}',
  'wf.result.summary_label': 'Result Summary:',
  'wf.result.truncated': '...(output truncated)',
  'wf.result.confirmation_prompt': '\n\nIf this execution path matches your working style, reply: confirm workflow {workflowRef}\nOnce confirmed, it will become your private workflow template, prioritized for similar future tasks. Administrators can later review and promote it to an organization-wide template.',
  'wf.fallback_progress': 'No stage records available',
  'wf.progress': '⏳ Task in progress: {status}\nTask ID: {workflowRef}',
  'wf.polling_timeout': '⏳ Task is still running. Please check the results later.\nTask ID: {workflowRef}',
  'wf.mobile_push_success': 'Task execution completed',
  'wf.mobile_push_failure': 'Task execution failed',
  'wf.stage.unknown': 'Unknown',

  'admin.validation.required': 'title, task_type, schedule_type are required fields',

  'error.body_too_large': 'Request body exceeds 10MB limit',

  'notify.task_body': 'Please submit your feedback promptly.',

  'skill.unnamed_goal': 'Untitled Task',
  'skill.pending_prefix': '[Pending Confirmation]',
  'skill.extracted_description': 'Automatically extracted from workflow {workflowRef}, pending user confirmation for activation. Stage chain: {stageNames}',

  'llm.system_prompt': `You are an enterprise-grade AI assistant.{personaBlock}{workspaceBlock}

Core behavioral guidelines:
- Respond in natural, fluent English, being professional, concise, and accurate
- Prioritize answers from the organization knowledge base, then fall back to your general knowledge
- If the user asks about "your workspace" or "what you can access", answer truthfully based on the workspace info
- If the user mainly shares knowledge snippets, encourage and guide them to submit via the "Submit Knowledge" feature
- Clearly label uncertain information as "to be confirmed"
- Protect user privacy and do not disclose sensitive information to other users
- When sensitive topics (pricing, contracts, etc.) arise, remind users to verify`,

  'llm.context_summary_label': 'Conversation history summary:\n',

  'llm.persona_block': `\n\n[Your Identity & Code of Conduct — soul/brain configuration]\n- Core Personality (soul): {soul}\n- Identity Positioning (identity): {identity}\n- Tone Style (tone): {tone}\n- Behavioral Boundaries: {boundary}\n- Skill Tags: {tags}`,

  'llm.persona_block_def_soul': 'Professional, efficient, and thoughtful enterprise AI assistant',
  'llm.persona_block_def_identity': 'Enterprise-grade AI intelligent assistant',
  'llm.persona_block_def_tone': 'Professional, concise, accurate',
  'llm.persona_block_def_boundary': 'Protect user privacy, do not disclose sensitive information',
  'llm.persona_block_def_tags': 'General knowledge Q&A',

  'llm.workspace_block': `\n\n[Your Independent Workspace Info]\n- Workspace directory: /workspace/{userId}\n- Knowledge base access: PGSQL (facts/documents/memories) ✅\n- Vector retrieval: pgvector ✅\n- Graph database: Apache AGE ✅\n- Existing documents: {docCount}\n- Existing facts: {factCount}\n- Stored memories: {memoryCount}\n- You can access and manipulate this data via knowledge retrieval, memory recall, etc.`,

  'portal.login.empty_credentials': 'Username and password cannot be empty',
  'portal.login.wrong_credentials': 'Invalid username or password',
  'portal.login.max_sessions': 'Maximum session limit reached',
  'portal.login.rate_limited': 'Too many login attempts, please wait {remaining} seconds',
  'portal.pwd.empty_fields': 'Please enter old and new password',
  'portal.pwd.wrong_old': 'Old password is incorrect',
  'portal.pwd.changed': 'Password changed successfully',
  'portal.pwd.min_length': 'Password must be at least 8 characters',
  'portal.pwd.too_weak': 'Password too weak: must contain mixed case letters, numbers, or special characters',
  'portal.pwd.medium': 'Password strength: medium',
  'portal.pwd.good': 'Password strength: good',
  'portal.logout.success': 'Logged out successfully',
  'portal.admin.required': 'Admin access required',
  'portal.setup.local_only': 'Local access only or provide valid SETUP_TOKEN',
  'portal.setup.db_unavailable': 'Database unavailable',
  'portal.setup.already_initialized': 'System already initialized',
  'portal.setup.admin_pass_required': 'Admin password cannot be empty',
  'portal.setup.step.database': 'Database Connection',
  'portal.setup.step.organization': 'Organization Creation',
  'portal.setup.step.admin': 'Admin Creation',
  'portal.setup.step.channel': 'Message Channel',
  'portal.setup.step.llm': 'LLM Model',
  'portal.setup.step.embedding': 'Vector Model',
  'portal.llm.name_required': 'Model name cannot be empty',
  'portal.skill.not_found': 'Skill not found or service unavailable',
  'portal.task.required_fields': 'title, task_type, schedule_type are required fields',

  'config.label.feishu': 'Feishu Channel Config',
  'config.label.wecom': 'WeCom Channel Config',
  'config.label.llm': 'LLM Model Config',
  'config.label.embedding': 'Embedding Model Config',
  'config.label.rerank': 'Rerank Config',
  'config.label.clawhub': 'ClawHub Admin',
  'config.field.signing_secret': 'Signing Secret',
  'config.field.signing_secret_hint': 'Only required for Feishu webhook signature verification. Long-connection mode only needs App ID and App Secret.',
  'config.field.domain': 'Domain',
  'config.field.corp_id': 'Corp ID',
  'config.field.callback_token': 'Callback Token',
  'config.field.aes_key': 'Message Encryption AES Key',
  'config.field.agent_id': 'Agent ID',
  'config.field.app_secret': 'App Secret',
  'config.field.litellm_url': 'LiteLLM URL',
  'config.field.default_model': 'Default Model',
  'config.field.fallback_models': 'Fallback Models (comma-separated)',
  'config.field.mode': 'Mode',
  'config.field.dimensions': 'Dimensions',
  'config.field.dimensions_hint': 'Optional. The test button shows the actual returned dimensions when available.',
  'config.field.timeout_ms': 'Timeout (ms)',
  'config.field.timeout_ms_hint': 'Timeout for upstream model service requests.',
  'config.field.clawhub_site': 'ClawHub Site',
  'config.field.clawhub_registry': 'Registry API',
  'config.field.clawhub_admin_token': 'Admin Token',
  'config.field.clawhub_admin_token_hint': 'Used by admins to upload, download, and upgrade skills. Stored locally and never echoed in plain text.',
}

export function getLangPack(lang: string): LangPack {
  return lang === 'en' ? en : zh
}

export function t(lang: string, key: string): string {
  const pack = lang === 'en' ? en : zh
  return pack[key] || key
}

export function tf(lang: string, key: string, vars: Record<string, string | number> = {}): string {
  let text = t(lang, key)
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}
