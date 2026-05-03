/**
 * JueYing (绝影) Skills Seed Script
 *
 * Pre-configures the top-rated free office productivity & search skills from
 * the ClawHub domestic mirror site (https://mirror-cn.clawhub.com/).
 *
 * All skills in this seed are free and DO NOT require any API key.
 * Skills that depend on third-party paid APIs (Trello, Slack, Google Workspace
 * etc.) have been intentionally excluded.
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
  // ============================================================
  // 一、办公文档处理（核心生产力）
  // ============================================================
  {
    name: 'Document Pro（文档处理全能）',
    type: 'document',
    scope: 'org',
    description: '赋予 AI 强大的文档处理能力，支持 PDF、Word（doc/docx）、PPT（ppt/pptx）、Excel（xls/xlsx）、CSV、Markdown、纯文本的读取、解析与信息提取。无需任何 API Key。',
    source: 'mirror-cn.clawhub.com://jackeven02/document-pro',
    definition: {
      tools: ['office_parser', 'pdf_reader', 'excel_reader', 'mammoth_docx', 'markdown_parser'],
      prompt: '你是一个专业的办公文档处理助手。支持 PDF/Word/PPT/Excel/CSV/Markdown 全格式文档读取与解析。自动识别文件类型，提取文本、表格、图片描述等结构化信息。',
      capabilities: ['read_pdf', 'read_docx', 'read_xlsx', 'read_pptx', 'read_csv', 'read_markdown', 'extract_text', 'extract_tables', 'extract_images_desc'],
    },
  },
  {
    name: 'Document Generator（文档生成器）',
    type: 'document',
    scope: 'org',
    description: 'AI 驱动的办公文档自动生成：根据描述生成专业 Word 报告、PPT 演示文稿、Excel 报表。输入"生成项目周报"即可自动产出格式化的 docx 文件。无需 API Key。',
    source: 'mirror-cn.clawhub.com://doc-gen',
    definition: {
      tools: ['docx_generator', 'pptx_generator', 'xlsx_generator', 'markdown_to_docx'],
      prompt: '你是一个专业的文档生成助手。根据用户描述自动生成格式化的 Word 报告（.docx）、PPT 演示文稿（.pptx）、Excel 报表（.xlsx）。内置企业模板，支持图表插入和格式美化。',
      capabilities: ['generate_docx', 'generate_pptx', 'generate_xlsx', 'apply_template', 'insert_chart', 'format_document'],
    },
  },
  {
    name: 'PDF Converter（PDF 转换器）',
    type: 'document',
    scope: 'org',
    description: 'PDF 格式互转工具包：PDF ↔ Word、PDF ↔ Excel、PDF ↔ 图片、PDF 合并/拆分/压缩。本地处理无需 API Key。',
    source: 'mirror-cn.clawhub.com://pdf-toolkit',
    definition: {
      tools: ['pdf_lib', 'pdf_to_docx', 'pdf_to_excel', 'pdf_merge', 'pdf_split', 'pdf_compress'],
      prompt: '你是一个 PDF 处理助手。支持 PDF 与各类办公文档格式互转，以及合并、拆分、压缩等本地处理操作。',
      capabilities: ['pdf_to_docx', 'pdf_to_excel', 'docx_to_pdf', 'excel_to_pdf', 'merge_pdfs', 'split_pdf', 'compress_pdf'],
    },
  },
  // ============================================================
  // 二、联网搜索（无需 API Key）
  // ============================================================
  {
    name: 'Multi Search（多引擎聚合搜索）',
    type: 'search',
    scope: 'org',
    description: '集成多个免费搜索引擎并发检索：DuckDuckGo + Bing + SearXNG 公共实例 + 百度 + 搜狗。自动去重、综合排序，返回最优结果。无需任何 API Key。',
    source: 'mirror-cn.clawhub.com://free-web-search',
    definition: {
      tools: ['duckduckgo_search', 'searxng_search', 'bing_scraper', 'baidu_scraper'],
      prompt: '你是一个聚合搜索助手。向 DuckDuckGo、Bing、百度等多个引擎同时查询，综合返回最优结果。中文搜索优先使用百度/搜狗，英文优先 DuckDuckGo/Bing。支持时间过滤和站点过滤。',
      capabilities: ['web_search', 'news_search', 'image_search', 'date_filter', 'site_filter', 'deduplicate', 'language_aware'],
    },
  },
  {
    name: 'Deep Search（深度搜索研究员）',
    type: 'search',
    scope: 'org',
    description: '多轮递进式深度搜索：根据初始查询自动拆分子问题，逐轮搜索并综合答案。适合竞品分析、技术调研、行业研究。无需 API Key。',
    source: 'mirror-cn.clawhub.com://deep-search',
    definition: {
      tools: ['deep_search_agent', 'query_decomposer', 'answer_synthesizer'],
      prompt: '你是一个深度搜索研究员。将用户问题拆解为多个子问题，逐轮搜索并综合所有发现。输出结构化的研究报告，包含信息来源和引用。',
      capabilities: ['decompose_question', 'multi_round_search', 'synthesize_findings', 'cite_sources', 'generate_report'],
    },
  },
  {
    name: '实时资讯（RSS + 热点聚合）',
    type: 'search',
    scope: 'org',
    description: '聚合 RSS 资讯 + 微博/知乎/36Kr 热点，支持关键词订阅和定时推送。无需 API Key 即可追踪行业动态。',
    source: 'mirror-cn.clawhub.com://live-feed',
    definition: {
      tools: ['rss_reader', 'weibo_hot', 'zhihu_hot', 'news_aggregator'],
      prompt: '你是一个实时资讯助手。聚合 RSS 订阅源和中文互联网热点（微博、知乎、36Kr），支持关键词过滤和定时推送最新动态。',
      capabilities: ['fetch_rss', 'monitor_hotspots', 'keyword_filter', 'scheduled_push', 'summarize_news'],
    },
  },
  // ============================================================
  // 三、内容处理
  // ============================================================
  {
    name: 'Summarize（智能内容总结）',
    type: 'content',
    scope: 'org',
    description: '快速总结网页链接、PDF 文档、图片文字、音视频转写内容。支持中文和英文，多格式内容提炼专家。无需 API Key（本地模型）。',
    source: 'mirror-cn.clawhub.com://content-summarizer',
    definition: {
      tools: ['text_summarizer', 'web_extractor', 'pdf_extractor'],
      prompt: '你是一个专业的内容总结助手。接收网页链接、PDF文档、图片或文本，用简洁精炼的中文总结核心要点。保留关键数据和人名。',
      capabilities: ['summarize_web', 'summarize_pdf', 'summarize_text', 'extract_key_points', 'preserve_data'],
    },
  },
  // ============================================================
  // 四、企业微信集成
  // ============================================================
  {
    name: 'WeCom File Bridge（企微文件桥）',
    type: 'communication',
    scope: 'org',
    description: '企业微信文件收发技能，支持通过企微接收和发送 Word (.doc/.docx)、PPT (.ppt/.pptx)、Excel (.xls/.xlsx)、PDF、ZIP 压缩包、图片等文件。自动解析收到的文件并导入知识库，发送时将生成的文件通过企微消息通道下发给用户。',
    source: 'mirror-cn.clawhub.com://wecom-file-transfer',
    definition: {
      tools: ['wecom_media_download', 'wecom_media_upload', 'wecom_file_send'],
      prompt: '你是企业微信文件收发助手。通过企业微信官方 API（qyapi.weixin.qq.com）进行文件/图片/语音/视频的收发。收到文件后自动解析内容（Word→文本、Excel→表格、PPT→文本、PDF→文本），将解析结果存入知识库。生成文件时自动上传并发送给指定用户。\n\n企微文件 API 关键要点：\n- 上传：POST /cgi-bin/media/upload?access_token=TOKEN&type=TYPE，返回 media_id\n- 发送文件消息：POST /cgi-bin/message/send，msgtype 设为 file，传入 media_id\n- 下载：GET /cgi-bin/media/get?access_token=TOKEN&media_id=MEDIA_ID\n- media_id 有效期 3 天\n- 支持类型：file（最大 20MB）、image（最大 10MB）、voice（最大 2MB）、video（最大 10MB）',
      capabilities: ['receive_wecom_file', 'download_wecom_media', 'parse_wecom_file', 'upload_to_wecom', 'send_wecom_file', 'send_wecom_image', 'auto_import_to_knowledge'],
    },
  },
  // ============================================================
  // 五、工具与自动化
  // ============================================================
  {
    name: 'Weather（免费天气查询）',
    type: 'utility',
    scope: 'org',
    description: '通过公开气象数据源免费获取实时天气与七天预报，支持中文城市名查询。无需任何 API Key。',
    source: 'mirror-cn.clawhub.com://weather-free',
    definition: {
      tools: ['open_meteo_api', 'weather_gov_cn'],
      prompt: '你是一个天气查询助手。通过免费公开气象数据查询指定城市的实时天气和未来 7 天天气预报。支持湿度、风速、空气质量等详细信息。',
      capabilities: ['current_weather', 'weekly_forecast', 'air_quality', 'humidity_wind'],
    },
  },
  {
    name: 'Agent Browser（网页自动化）',
    type: 'automation',
    scope: 'org',
    description: '无头浏览器自动化，支持网页操作、数据采集、表单填写、截图保存。适用于网页信息批量抓取和自动化测试。无需 API Key。',
    source: 'mirror-cn.clawhub.com://headless-browser',
    definition: {
      tools: ['playwright_headless', 'web_scraper'],
      prompt: '你是一个网页自动化助手。可以打开网页、填写表单、点击按钮、滚动加载、提取页面内容、截取整页截图。使用 Playwright 无头模式，无需 API Key。',
      capabilities: ['navigate', 'fill_form', 'click_element', 'extract_content', 'full_page_screenshot', 'wait_for_element', 'handle_pagination'],
    },
  },
  // ============================================================
  // 六、知识管理
  // ============================================================
  {
    name: 'Ontology（本体知识图谱）',
    type: 'knowledge',
    scope: 'org',
    description: '从对话和文档中自动提取实体（客户、联系人、项目、公司、产品）及关系，构建结构化本体知识图谱。基于 PostgreSQL + Apache AGE 图数据库持久化存储，支持 Cypher 图查询。自动识别聊天中提到的客户名称、项目编号、员工姓名等关键实体。',
    source: 'mirror-cn.clawhub.com://ontology-graph',
    definition: {
      tools: ['entity_extractor', 'relation_detector', 'graph_query'],
      prompt: '你是一个知识图谱管理助手。从对话内容中自动提取以下实体类型并存入图数据库：\n- Person（人物）：同事、客户、联系人\n- Organization（组织）：公司、部门\n- Project（项目）：项目名称、编号\n- Client（客户）：客户名称、联系人\n- Contact（联系方式）：电话、邮箱、地址\n- Product（产品）：产品名称\n\n同时识别实体间关系：works_for、manages、depends_on、BELONGS_TO、EMPLOYES、INVOLVED_IN、INTERACTS_WITH、REPORTS_TO、PARTNERS_WITH',
      capabilities: ['extract_persons', 'extract_clients', 'extract_projects', 'extract_contacts', 'build_relations', 'query_graph', 'visualize_knowledge'],
    },
  },
  {
    name: 'Memory Compress（记忆压缩归档）',
    type: 'knowledge',
    scope: 'org',
    description: '对话记忆自动对象化存储：将聊天中提到的客户、项目、联系人等关键信息自动提取为结构化对象，存入 PostgreSQL 实体表并通过 Apache AGE 构建对象关系图谱。当记忆积累超过阈值时自动触发压缩，保留结构化提取结果，释放上下文窗口。',
    source: 'mirror-cn.clawhub.com://memory-object-store',
    definition: {
      tools: ['memory_extractor', 'object_mapper', 'graph_builder'],
      prompt: '你是一个记忆归档助手。自动识别对话中的关键对象（人、项目、客户、公司、联系方式、日期、金额），将其转化为结构化实体对象存储到 PostgreSQL 的 entity 表中，并通过 "projection_event" 机制同步到 Apache AGE 图数据库构建关系网络。\n\n存储架构说明：\n- entities 表：canonical_name（实体名）、entity_type（Person/Organization/Client/Project/Contact/Product）\n- entity_attributes 表：attr_key/attr_value（电话、邮箱、地址等属性）\n- relations 表：from_entity_id → relation_type → to_entity_id\n- projectionEvents 表自动同步到 AGE 图数据库',
      capabilities: ['extract_objects_from_chat', 'store_entity', 'store_attributes', 'build_relations', 'trigger_graph_sync', 'compress_old_memories'],
    },
  },
  // ============================================================
  // 七、系统能力
  // ============================================================
  {
    name: 'Skill Vetter（技能安全审查）',
    type: 'security',
    scope: 'org',
    description: '安全优先的技能审查工具，安装任何技能前自动检查权限范围、可疑模式和风险信号。确保所有安装的技能不包含恶意代码或过度权限请求。',
    source: 'mirror-cn.clawhub.com://skill-vetter',
    definition: {
      tools: ['permission_scanner', 'code_auditor'],
      prompt: '你是一个安全审查助手。在安装任何技能前自动对其进行安全检查，评估权限风险，识别可疑行为模式，确保系统安全。',
      capabilities: ['scan_permissions', 'check_reputation', 'identify_risks', 'audit_dependencies', 'approve_or_block'],
    },
  },
];

async function main() {
  console.log('=== JueYing Office Skills Seed ===');
  console.log(`Target: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  console.log(`Skills to seed: ${OFFICE_SKILLS.length}\n`);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

  try {
    await pool.query('SELECT 1');
    console.log('Database connection OK\n');

    let created = 0;
    let skipped = 0;

    for (const skill of OFFICE_SKILLS) {
      const existing = await pool.query(
        "SELECT id FROM skill WHERE skill_name = $1 AND status != 'deleted'",
        [skill.name]
      );

      if (existing.rows.length > 0) {
        console.log(`  SKIP: ${skill.name} (already exists)`);
        skipped++;
        continue;
      }

      const ownerUserId = '00000000-0000-0000-0000-000000000000';
      const orgId = '00000000-0000-0000-0000-000000000000';

      const skillResult = await pool.query(
        `INSERT INTO skill (scope_type, owner_user_id, org_id, skill_name, skill_type, status, description, metadata)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
         RETURNING id`,
        [skill.scope, ownerUserId, orgId, skill.name, skill.type, skill.description,
         JSON.stringify({ source: skill.source, seed_by: 'mirror-cn.clawhub.com' })]
      );

      const skillId = skillResult.rows[0].id;

      const defJson = JSON.stringify(skill.definition);
      const contentHash = crypto.createHash('sha256').update(defJson).digest('hex');
      await pool.query(
        `INSERT INTO skill_version (skill_id, version, definition_json, content_hash, status, metadata)
         VALUES ($1, 1, $2, $3, 'active', '{}'::jsonb)`,
        [skillId, defJson, contentHash]
      );

      console.log(`  CREATED: ${skill.name} (id: ${skillId.slice(0, 8)}...)`);
      created++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`Created: ${created}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total:   ${OFFICE_SKILLS.length}`);

    const count = await pool.query("SELECT COUNT(*) as cnt FROM skill WHERE status = 'active'");
    console.log(`\nActive skills in database: ${count.rows[0].cnt}`);

    // Also verify that the Graph DB (AGE) infrastructure is in place
    try {
      const ageCheck = await pool.query("SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'knowledge_graph'");
      console.log('AGE Graph: knowledge_graph EXISTS');
    } catch {
      console.log('AGE Graph: knowledge_graph not yet created (will be auto-created on first projection sync)');
    }

    console.log('\nSeed complete. Skills installed from mirror-cn.clawhub.com');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
