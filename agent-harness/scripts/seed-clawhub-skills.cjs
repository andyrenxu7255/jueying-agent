/**
 * ClawHub Skills Seed Script
 *
 * Pre-configures the top-rated office productivity skills from the ClawHub
 * domestic mirror site (https://cn.clawhub-mirror.com/) for office workers.
 *
 * Usage: node scripts/seed-clawhub-skills.cjs
 * Requires: DATABASE_URL environment variable
 */

const { Pool } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const OFFICE_SKILLS = [
  {
    name: 'Document Pro',
    type: 'document',
    scope: 'private',
    description: '赋予 AI 强大的文档处理能力，支持 PDF、Word、PPT、Excel 的读取、解析与信息提取',
    source: 'clawhub://jackeven02/document-pro',
    definition: {
      tools: ['office_parser', 'pdf_reader', 'excel_reader'],
      prompt: '你是一个专业的办公文档处理助手。你可以读取、解析和提取 PDF、Word、PPT、Excel 等格式的文档信息。帮助用户快速定位文档中的关键内容。',
      capabilities: ['read_pdf', 'read_docx', 'read_xlsx', 'read_pptx', 'extract_text', 'extract_tables'],
    },
  },
  {
    name: 'Gog 工作区集成',
    type: 'productivity',
    scope: 'private',
    description: 'Google Workspace 六合一整合包：Gmail + Calendar + Drive + Docs + Sheets + Contacts，一站式办公协同',
    source: 'clawhub://gog',
    definition: {
      tools: ['gmail_api', 'calendar_api', 'drive_api', 'docs_api', 'sheets_api'],
      prompt: '你是一个办公协同助手，可以管理邮件、日程、文档和联系人。帮助用户高效处理日常工作。',
      capabilities: ['send_email', 'read_email', 'schedule_event', 'manage_files', 'search_docs'],
    },
  },
  {
    name: 'Summarize 内容总结',
    type: 'content',
    scope: 'private',
    description: '快速总结网页、PDF、图片、音频和 YouTube 视频内容，多格式内容提炼专家',
    source: 'clawhub://steipete/summarize',
    definition: {
      tools: ['summarize_cli'],
      prompt: '你是一个专业的内容总结助手。接收网页链接、PDF文档、图片、音频或视频，然后用简洁的中文总结核心要点。',
      capabilities: ['summarize_web', 'summarize_pdf', 'summarize_image', 'summarize_audio', 'summarize_video'],
    },
  },
  {
    name: 'CalDAV 日历同步',
    type: 'productivity',
    scope: 'private',
    description: '同步多平台日历（Google/Apple/Outlook），本地统一管理所有日程安排，告别日程碎片化',
    source: 'clawhub://asleep123/caldav-calendar',
    definition: {
      tools: ['caldav_client'],
      prompt: '你是一个日历管理助手。帮助用户跨平台同步和管理日程，提醒重要会议和截止日期。',
      capabilities: ['sync_calendars', 'create_event', 'list_events', 'set_reminder', 'check_conflicts'],
    },
  },
  {
    name: 'Multi Search 聚合搜索',
    type: 'search',
    scope: 'private',
    description: '集成 17 个搜索引擎（8 国内 + 9 国际），支持高级搜索运算符、时间过滤和隐私搜索',
    source: 'clawhub://gpyangyoujun/multi-search-engine',
    definition: {
      tools: ['multi_search_cli'],
      prompt: '你是一个聚合搜索助手。可以向多个搜索引擎同时查询，综合返回最优结果。优先使用国内引擎进行中文搜索。',
      capabilities: ['web_search', 'news_search', 'image_search', 'date_filter', 'domain_filter'],
    },
  },
  {
    name: 'Weather 天气查询',
    type: 'utility',
    scope: 'private',
    description: '免费获取实时天气与天气预报，无需 API 密钥，出行安排更从容',
    source: 'clawhub://steipete/weather',
    definition: {
      tools: ['weather_cli'],
      prompt: '你是一个天气查询助手。可以查询指定城市的实时天气和未来数天的天气预报。',
      capabilities: ['current_weather', 'forecast', 'air_quality'],
    },
  },
  {
    name: 'Trello 看板管理',
    type: 'productivity',
    scope: 'private',
    description: '通过 Trello REST API 管理看板、列表和卡片，项目管理可视化',
    source: 'clawhub://steipete/trello',
    definition: {
      tools: ['trello_api'],
      prompt: '你是一个项目管理助手。可以帮助用户在 Trello 中创建和管理看板、列表和卡片，跟踪任务进度。',
      capabilities: ['create_board', 'create_list', 'create_card', 'move_card', 'add_comment', 'set_due_date'],
    },
  },
  {
    name: 'Slack 消息协作',
    type: 'communication',
    scope: 'private',
    description: '控制 Slack 频道/私信，支持表情回应、置顶操作，团队沟通一体化',
    source: 'clawhub://steipete/slack',
    definition: {
      tools: ['slack_api'],
      prompt: '你是一个团队沟通助手。可以帮助用户在 Slack 中发送消息、回应表情和管理频道内容。',
      capabilities: ['send_message', 'add_reaction', 'pin_message', 'create_channel', 'search_messages'],
    },
  },
  {
    name: 'Agent Browser 网页自动化',
    type: 'automation',
    scope: 'private',
    description: '无头浏览器自动化，支持网页操作、数据采集、表单填写，解放双手',
    source: 'clawhub://matrixy/agent-browser',
    definition: {
      tools: ['headless_browser'],
      prompt: '你是一个网页自动化助手。可以打开网页、填写表单、点击按钮、提取页面内容，帮助用户完成重复性的网页操作。',
      capabilities: ['navigate', 'fill_form', 'click_element', 'extract_content', 'take_screenshot'],
    },
  },
  {
    name: 'Ontology 知识图谱',
    type: 'knowledge',
    scope: 'private',
    description: '构建结构化本体知识图谱，精准管理实体关系，实现跨技能状态共享和知识沉淀',
    source: 'clawhub://oswalpalash/ontology',
    definition: {
      tools: ['ontology_builder'],
      prompt: '你是一个知识管理助手。帮助用户从对话和工作内容中提取关键实体和关系，构建结构化的知识图谱。',
      capabilities: ['extract_entities', 'build_relations', 'query_graph', 'visualize_knowledge'],
    },
  },
  {
    name: 'Skill Vetter 安全审查',
    type: 'security',
    scope: 'private',
    description: '安全优先的技能审查工具，安装任何技能前检查权限范围、可疑模式和风险信号',
    source: 'clawhub://spclaudehome/skill-vetter',
    definition: {
      tools: ['security_scanner'],
      prompt: '你是一个安全审查助手。可以在安装任何技能前对其进行安全检查，评估权限风险，识别可疑行为模式。',
      capabilities: ['scan_permissions', 'check_reputation', 'identify_risks', 'audit_dependencies'],
    },
  },
  {
    name: 'self-improving-agent',
    type: 'learning',
    scope: 'private',
    description: '记录经验总结、错误信息与修正方案，实现自我持续优化，越用越聪明',
    source: 'clawhub://pskoett/self-improving-agent',
    definition: {
      tools: ['learning_recorder'],
      prompt: '你是一个自我改进助手。记录每次交互中的经验教训和错误修正，持续优化回答质量和任务执行效率。',
      capabilities: ['record_experience', 'log_errors', 'track_corrections', 'performance_analytics'],
    },
  },
  {
    name: 'Proactive Agent 主动助手',
    type: 'assistant',
    scope: 'private',
    description: '将 AI 从被动执行者转变为主动合作伙伴，预判需求、主动提醒、持续自我改进',
    source: 'clawhub://halthelobster/proactive-agent',
    definition: {
      tools: ['proactive_engine'],
      prompt: '你是一个主动型AI助手。不仅要响应用户请求，还要预判用户需求，主动提供建议和提醒。',
      capabilities: ['predict_needs', 'proactive_reminder', 'context_awareness', 'suggest_actions'],
    },
  },
  {
    name: 'Answer Overflow 技术问答',
    type: 'knowledge',
    scope: 'private',
    description: '搜索海外开发者社群历史讨论，找到编程问题解答和技术方案参考',
    source: 'clawhub://rhyssullivan/answer-overflow',
    definition: {
      tools: ['community_search'],
      prompt: '你是一个技术问答助手。可以搜索开发者社区中的历史讨论，帮助用户找到技术问题的解答。',
      capabilities: ['search_communities', 'find_solutions', 'reference_links', 'best_practices'],
    },
  },
  {
    name: 'Mcporter MCP集成',
    type: 'integration',
    scope: 'private',
    description: '使用 mcporter 命令行工具直接列出、配置、认证并调用 MCP 服务器/工具，扩展AI能力边界',
    source: 'clawhub://steipete/mcporter',
    definition: {
      tools: ['mcporter_cli'],
      prompt: '你是一个工具集成助手。可以管理和调用各种 MCP（Model Context Protocol）服务器和工具，扩展AI的能力边界。',
      capabilities: ['list_tools', 'configure_server', 'authenticate', 'call_tool', 'manage_connections'],
    },
  },
];

async function main() {
  console.log('=== ClawHub Office Skills Seed ===');
  console.log(`Target: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  console.log(`Total skills to seed: ${OFFICE_SKILLS.length}\n`);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

  try {
    await pool.query('SELECT 1');

    let created = 0;
    let skipped = 0;

    for (const skill of OFFICE_SKILLS) {
      const existing = await pool.query(
        `SELECT id FROM skill WHERE skill_name = $1 AND status != 'deleted'`,
        [skill.name]
      );

      if (existing.rows.length > 0) {
        console.log(`  SKIP: ${skill.name} (already exists)`);
        skipped++;
        continue;
      }

      const skillResult = await pool.query(
        `INSERT INTO skill (scope_type, owner_user_id, org_id, skill_name, skill_type, status, description, metadata)
         VALUES ('org', $1, $2, $3, $4, 'active', $5, $6)
         ON CONFLICT (skill_name) WHERE (status != 'deleted')
         DO UPDATE SET description = $5, metadata = $6
         RETURNING id`,
        [
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000000',
          skill.name,
          skill.type,
          skill.description,
          JSON.stringify({ source: skill.source, seed_by: 'clawhub-mirror-script' }),
        ]
      );

      const skillId = skillResult.rows[0].id;

      const existingVersion = await pool.query(
        `SELECT version FROM skill_version WHERE skill_id = $1 ORDER BY version DESC LIMIT 1`,
        [skillId]
      );

      const nextVersion = existingVersion.rows.length > 0
        ? existingVersion.rows[0].version + 1
        : 1;

      const defJson = JSON.stringify(skill.definition);
      const contentHash = crypto.createHash('sha256').update(defJson).digest('hex');
      await pool.query(
        `INSERT INTO skill_version (skill_id, version, definition_json, content_hash, status, metadata)
         VALUES ($1, $2, $3, $4, 'active', '{}'::jsonb)`,
        [skillId, nextVersion, defJson, contentHash]
      );

      console.log(`  CREATED: ${skill.name} (v${nextVersion}, id: ${skillId})`);
      created++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`Created: ${created}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total:   ${OFFICE_SKILLS.length}`);

    const count = await pool.query(`SELECT COUNT(*) as cnt FROM skill WHERE status = 'active'`);
    console.log(`\nActive skills in database: ${count.rows[0].cnt}`);
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
