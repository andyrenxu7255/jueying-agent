const API_BASE = '';
let currentSession = null;
let currentView = 'dashboard';
let currentStatusFilter = 'unconfirmed';
let serviceStatusInterval = null;
let dockerStatsInterval = null;
let containerStatsInterval = null;
let previousServiceStatus = {};

function getSessionId() {
  return localStorage.getItem('ah_session_id') || '';
}

async function api(path, options) {
  options = options || {};
  const sessionId = getSessionId();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sessionId) headers['x-session-id'] = sessionId;
  try {
    const res = await fetch(API_BASE + path, { ...options, headers });
    if (res.status === 401 && path !== '/api/auth/login') {
      localStorage.removeItem('ah_session_id');
      currentSession = null;
      stopAllIntervals();
      renderLogin();
      return { ok: false, status: 401, data: { error: 'session_expired', message: '会话已过期，请重新登录' } };
    }
    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      try { data = JSON.parse(text); } catch { data = { error: 'non_json_response', message: text.substring(0, 200) }; }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: 'network_error', message: e.message } };
  }
}

function showToast(msg, type) {
  type = type ?? 'success';
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  let el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function() { el.remove(); if (container.children.length === 0) container.remove(); }, 3000);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escJsAttr(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/"/g,'&quot;');
}

function statusBadge(status) {
  const map = { running: 'info', completed: 'success', failed: 'danger', paused: 'warning', planned: 'warning', cancelled: 'danger', pending: 'warning', approved: 'success', rejected: 'danger' };
  return '<span class="badge badge-' + (map[status] || 'info') + '">' + escapeHtml(status) + '</span>';
}

function emptyState(icon, title, desc, actionHtml) {
  return '<div class="empty-state"><div class="empty-icon">' + icon + '</div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(desc) + '</p>' + (actionHtml || '') + '</div>';
}

function passwordStrengthHtml(score) {
  const pct = Math.min(score / 6 * 100, 100);
  const color = score < 3 ? 'var(--danger)' : score < 5 ? 'var(--warning)' : 'var(--success)';
  return '<div class="password-strength"><div class="password-strength-bar" style="width:' + pct + '%;background:' + color + '"></div></div>';
}

/**
 * 显示模态对话框
 * WARNING: bodyHtml 参数不会被转义，调用者必须确保传入的是安全的硬编码 HTML
 * 或者使用 escapeHtml() 对用户输入进行转义
 */
function showModal(title, bodyHtml, onClose) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = '<div class="modal"><h3>' + escapeHtml(title) + '</h3>' + bodyHtml + '</div>';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) { closeModal(); if (onClose) onClose(); } });
  const escHandler = function(e) { if (e.key === 'Escape') { closeModal(); if (onClose) onClose(); } };
  document.addEventListener('keydown', escHandler);
  overlay._escHandler = escHandler;
  document.body.appendChild(overlay);
  const firstInput = overlay.querySelector('input,textarea,select');
  if (firstInput) setTimeout(function() { firstInput.focus(); }, 50);
  return overlay;
}

function closeModal() {
  let el = document.getElementById('modal-overlay');
  if (el) {
    if (el._escHandler) document.removeEventListener('keydown', el._escHandler);
    el.remove();
  }
}

async function checkSetup() {
  const r = await api('/api/setup/status');
  return r.ok ? r.data : null;
}

async function checkAuth() {
  const sid = getSessionId();
  if (!sid) return false;
  const r = await api('/api/auth/session');
  if (r.ok && r.data.session) {
    currentSession = r.data.session;
    return true;
  }
  if (r.status === 401) { localStorage.removeItem('ah_session_id'); return false; }
  return false;
}

function renderLogin() {
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card"><h1>JueYing</h1><p>Agent Harness 管理门户</p><div class="form-group"><label>用户名</label><input type="text" id="login-user" placeholder="请输入用户名" autofocus></div><div class="form-group"><label>密码</label><input type="password" id="login-pass" placeholder="请输入密码"></div><button class="btn btn-primary" style="width:100%" onclick="doLogin()">登 录</button></div></div>';
  document.getElementById('login-user').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
  document.getElementById('login-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) { showToast('请输入用户名和密码', 'error'); return; }
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (r.ok && r.data.session_id) {
    localStorage.setItem('ah_session_id', r.data.session_id);
    showToast('登录成功');
    if (r.data.must_change_password) {
      await initApp();
      showChangePasswordModal(true);
    } else {
      await initApp();
    }
  } else {
    showToast((r.data && r.data.message) || (r.data && r.data.error) || '登录失败', 'error');
  }
}

function showChangePasswordModal(isFirstLogin) {
  const title = isFirstLogin ? '首次登录 - 请修改默认密码' : '修改密码';
  const body = '<div class="form-group"><label>旧密码</label><input type="password" id="cp-old" placeholder="请输入旧密码"></div>' +
    '<div class="form-group"><label>新密码</label><input type="password" id="cp-new" placeholder="至少8位，包含大小写字母、数字或特殊字符" oninput="updatePasswordStrength()"></div>' +
    '<div id="cp-strength"></div>' +
    '<div class="form-group"><label>确认新密码</label><input type="password" id="cp-confirm" placeholder="请再次输入新密码"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-primary" onclick="doChangePassword()">确认修改</button>' +
    (isFirstLogin ? '' : '<button class="btn btn-outline" onclick="closeModal()">取消</button>') + '</div>';
  showModal(title, body);
}

function updatePasswordStrength() {
  let el = document.getElementById('cp-new');
  const strengthEl = document.getElementById('cp-strength');
  if (!el || !strengthEl) return;
  const pwd = el.value;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[a-z]/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;
  const msg = score < 3 ? '弱' : score < 5 ? '中' : '强';
  strengthEl.innerHTML = passwordStrengthHtml(score) + '<span class="hint-text">密码强度: ' + msg + '</span>';
}

async function doChangePassword() {
  const oldPwd = document.getElementById('cp-old').value;
  const newPwd = document.getElementById('cp-new').value;
  const confirmPwd = document.getElementById('cp-confirm').value;
  if (!oldPwd || !newPwd) { showToast('请填写完整', 'error'); return; }
  if (newPwd !== confirmPwd) { showToast('两次输入的新密码不一致', 'error'); return; }
  if (newPwd.length < 8) { showToast('新密码长度至少8位', 'error'); return; }
  const r = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }) });
  if (r.ok) { showToast('密码修改成功'); closeModal(); }
  else { showToast((r.data && r.data.message) || '修改失败', 'error'); }
}

function renderSetupWizard(setupStatus) {
  const steps = (setupStatus && setupStatus.steps) || [];
  const allDone = steps.every(function(s) { return s.done; });
  if (allDone) { initApp(); return; }
  const currentStep = steps.findIndex(function(s) { return !s.done; });
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card setup-wizard"><h1>初始化向导</h1><p>首次使用，请完成以下配置</p><div class="step-indicator">' +
    steps.map(function(s, i) { return '<div class="step-dot ' + (s.done ? 'done' : (i === currentStep ? 'active' : '')) + '">' + (s.done ? '✓' : (i + 1)) + '</div>'; }).join('') +
    '</div><div id="setup-content"></div></div></div>';
  renderSetupStep(currentStep, steps);
}

function renderSetupStep(stepIndex, steps) {
  const content = document.getElementById('setup-content');
  if (stepIndex < 0 || stepIndex >= steps.length) return;
  const step = steps[stepIndex];
  let html = '<div class="setup-step"><h3>' + escapeHtml(step.label) + '</h3><p style="color:var(--text2);margin-bottom:16px">' + escapeHtml(step.description || '') + '</p>';
  if (step.key === 'organization') {
    html += '<div class="form-group"><label>组织名称</label><input type="text" id="setup-org-name" value="default" placeholder="请输入组织名称"></div>';
    html += '<div class="form-group"><label>显示名称</label><input type="text" id="setup-org-display" value="Default Organization" placeholder="请输入显示名称"></div>';
  } else if (step.key === 'admin') {
    html += '<div class="form-group"><label>管理员用户名</label><input type="text" id="setup-admin-user" value="admin" placeholder="请输入管理员用户名"></div>';
    html += '<div class="form-group"><label>管理员密码</label><input type="password" id="setup-admin-pass" placeholder="至少8位，包含大小写字母、数字"></div>';
  } else if (step.key === 'channel') {
    html += '<div class="form-group"><label>飞书 App ID</label><input type="text" id="setup-feishu-app-id" placeholder="飞书开放平台获取"></div>';
    html += '<div class="form-group"><label>飞书 App Secret</label><input type="password" id="setup-feishu-app-secret" placeholder="飞书开放平台获取"></div>';
    html += '<p class="hint-text">渠道配置可稍后在系统配置中完成</p>';
  } else if (step.key === 'llm') {
    html += '<div class="form-group"><label>LiteLLM 地址</label><input type="text" id="setup-litellm-url" value="http://localhost:4000" placeholder="LiteLLM Proxy地址"></div>';
    html += '<div class="form-group"><label>默认模型</label><input type="text" id="setup-litellm-model" value="minimax-m2.7" placeholder="模型名称"></div>';
  } else if (step.key === 'embedding') {
    html += '<div class="form-group"><label>Embedding 模式</label><select id="setup-emb-mode"><option value="deterministic">deterministic (无需外部服务)</option><option value="provider">provider (需配置外部服务)</option></select></div>';
    html += '<div class="form-group"><label>Provider URL</label><input type="text" id="setup-emb-url" placeholder="Embedding服务地址"></div>';
  } else {
    html += '<p>此步骤已自动完成或需要手动配置</p>';
  }
  html += '<button class="btn btn-primary" onclick="doSetupStep(' + stepIndex + ')">完成此步骤</button>';
  html += '</div>';
  content.innerHTML = html;
}

async function doSetupStep(stepIndex) {
  const setupStatus = await checkSetup();
  if (!setupStatus) { showToast('无法获取初始化状态', 'error'); return; }
  const step = setupStatus.steps[stepIndex];
  const payload = { step: step.key };
  if (step.key === 'organization') {
    payload.org_name = document.getElementById('setup-org-name').value || 'default';
    payload.display_name = document.getElementById('setup-org-display').value || '';
  } else if (step.key === 'admin') {
    payload.username = document.getElementById('setup-admin-user').value || 'admin';
    payload.password = document.getElementById('setup-admin-pass').value || '';
  } else if (step.key === 'channel') {
    payload.feishu_app_id = document.getElementById('setup-feishu-app-id').value || '';
    payload.feishu_app_secret = document.getElementById('setup-feishu-app-secret').value || '';
  } else if (step.key === 'llm') {
    payload.litellm_url = document.getElementById('setup-litellm-url').value || '';
    payload.litellm_model = document.getElementById('setup-litellm-model').value || '';
  } else if (step.key === 'embedding') {
    payload.embedding_mode = document.getElementById('setup-emb-mode').value || 'deterministic';
    payload.embedding_provider_url = document.getElementById('setup-emb-url').value || '';
  }
  const r = await api('/api/setup/initialize', { method: 'POST', body: JSON.stringify(payload) });
  if (r.ok) {
    showToast('步骤完成');
    const newStatus = await checkSetup();
    if (newStatus && newStatus.steps.every(function(s) { return s.done; })) {
      showToast('初始化完成！请登录');
      renderLogin();
    } else {
      renderSetupWizard(newStatus);
    }
  } else {
    showToast((r.data && r.data.message) || (r.data && r.data.error) || '操作失败', 'error');
  }
}

function renderApp() {
  const navItems = [
    { section: '概览', items: [{ key: 'dashboard', label: '仪表盘', icon: '&#x1F4CA;' }, { key: 'guide', label: '系统指南', icon: '&#x1F4D6;' }] },
    { section: '任务', items: [{ key: 'workflows', label: 'Workflow 控制台', icon: '&#x26A1;' }, { key: 'task-input', label: '任务接入', icon: '&#x1F4DD;' }, { key: 'approvals', label: '审批台', icon: '&#x2705;' }] },
    { section: '管理', items: [{ key: 'config', label: '系统配置', icon: '&#x2699;&#xFE0F;' }, { key: 'users', label: '用户管理', icon: '&#x1F465;' }, { key: 'organizations', label: '组织管理', icon: '&#x1F3E2;' }, { key: 'skills', label: '技能管理', icon: '&#x1F527;' }, { key: 'knowledge', label: '知识导入', icon: '&#x1F4DA;' }] },
    { section: '运维', items: [{ key: 'audit', label: '审计日志', icon: '&#x1F4CB;' }, { key: 'retrieval', label: '检索追踪', icon: '&#x1F50D;' }, { key: 'identities', label: '身份绑定', icon: '&#x1F511;' }, { key: 'db-maint', label: '数据库运维', icon: '&#x1F5C4;&#xFE0F;' }, { key: 'resources', label: '资源监控', icon: '&#x1F4CA;' }, { key: 'knowledge-review', label: '知识审核', icon: '&#x1F4DD;' }] },
  ];
  if (currentSession && currentSession.role === 'admin') {
    navItems.push({ section: '共享', items: [{ key: 'shared-knowledge', label: '共享知识库', icon: '&#x1F4E2;' }] });
    navItems.push({ section: '调度', items: [{ key: 'org-tasks', label: '任务分发', icon: '&#x1F4CB;' }] });
    navItems.push({ section: '梦境模式', items: [
      { key: 'dream-memory', label: '记忆分析', icon: '&#x1F4A4;' },
      { key: 'dream-skills', label: '技能发现', icon: '&#x1F52C;' },
      { key: 'dream-config', label: '梦境配置', icon: '&#x2699;' }
    ]});
  }
  if (currentSession) {
    navItems.push({ section: '我的', items: [{ key: 'my-tasks', label: '我的任务', icon: '&#x270D;&#xFE0F;' }] });
  }

  const sessionData = currentSession || {};
  const username = sessionData.username || localStorage.getItem('ah_username') || '用户';
  const role = sessionData.role || 'user';
  const orgId = sessionData.org_id || '';
  const initial = username.charAt(0).toUpperCase();

  document.getElementById('app').innerHTML = '<div class="app-container"><div class="sidebar"><div class="sidebar-brand">JueYing</div><nav class="sidebar-nav">' +
    navItems.map(function(g) { return '<div class="nav-section">' + g.section + '</div>' + g.items.map(function(i) { return '<a href="#" data-view="' + i.key + '" class="' + (currentView === i.key ? 'active' : '') + '">' + i.icon + ' ' + i.label + '</a>'; }).join(''); }).join('') +
    '</nav><div class="sidebar-footer"><div class="user-info"><div class="user-avatar">' + escapeHtml(initial) + '</div><div class="user-details"><div class="user-name">' + escapeHtml(username) + '</div><div class="user-role">' + escapeHtml(role) + '</div></div><div class="user-menu"><button class="btn btn-sm btn-outline" onclick="toggleUserMenu()">&#x25B2;</button><div class="user-menu-dropdown" id="user-menu-dropdown"><a href="#" onclick="showChangePasswordModal(false);return false;">修改密码</a><a href="#" onclick="doLogout();return false;" style="color:var(--danger)">退出登录</a></div></div></div></div></div><div class="main-content" id="main-content"></div></div>';
  document.querySelectorAll('.sidebar-nav a[data-view]').forEach(function(a) {
    a.addEventListener('click', function(e) { e.preventDefault(); currentView = a.dataset.view; document.querySelectorAll('.sidebar-nav a').forEach(function(x) { x.classList.remove('active'); }); a.classList.add('active'); renderView(); });
  });
  renderView();
}

function toggleUserMenu() {
  const dd = document.getElementById('user-menu-dropdown');
  if (dd) dd.classList.toggle('show');
}

document.addEventListener('click', function(e) {
  const dd = document.getElementById('user-menu-dropdown');
  if (dd && !e.target.closest('.user-menu')) dd.classList.remove('show');
});

function renderView() {
  let el = document.getElementById('main-content');
  stopAllIntervals();
  const renderers = { dashboard: renderDashboard, guide: renderGuide, workflows: renderWorkflows, 'task-input': renderTaskInput, approvals: renderApprovals, config: renderConfig, users: renderUsers, organizations: renderOrganizations, skills: renderSkills, knowledge: renderKnowledge, audit: renderAudit, retrieval: renderRetrieval, identities: renderIdentities, 'db-maint': renderDbMaint, 'shared-knowledge': renderSharedKnowledge, 'org-tasks': renderOrgTasks, 'my-tasks': renderMyTasks, resources: renderResources, 'knowledge-review': renderKnowledgeReview, 'dream-memory': renderDreamMemory, 'dream-skills': renderDreamSkills, 'dream-config': renderDreamConfig };
  const renderer = renderers[currentView];
  if (renderer) renderer(el); else el.innerHTML = '<p>视图未实现</p>';
}

function stopAllIntervals() {
  if (serviceStatusInterval) { clearInterval(serviceStatusInterval); serviceStatusInterval = null; }
  if (dockerStatsInterval) { clearInterval(dockerStatsInterval); dockerStatsInterval = null; }
  if (containerStatsInterval) { clearInterval(containerStatsInterval); containerStatsInterval = null; }
}

let guideTab = 'arch';

function renderGuide(el) {
  el.innerHTML = '<div class="page-header"><h2>系统指南</h2></div>' +
    '<div class="guide-tabs">' +
    '<div class="guide-tab active" data-gtab="arch" onclick="switchGuideTab(\'arch\')">架构总览</div>' +
    '<div class="guide-tab" data-gtab="capabilities" onclick="switchGuideTab(\'capabilities\')">核心能力</div>' +
    '<div class="guide-tab" data-gtab="stories" onclick="switchGuideTab(\'stories\')">场景故事</div>' +
    '<div class="guide-tab" data-gtab="quickstart" onclick="switchGuideTab(\'quickstart\')">快速上手</div>' +
    '</div>' +
    '<div id="guide-content"></div>';
  renderGuideContent();
}

function switchGuideTab(tab) {
  guideTab = tab;
  document.querySelectorAll('.guide-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.gtab === tab); });
  renderGuideContent();
}

function renderGuideContent() {
  let el = document.getElementById('guide-content');
  if (!el) return;
  if (guideTab === 'arch') el.innerHTML = renderGuideArch();
  else if (guideTab === 'capabilities') el.innerHTML = renderGuideCapabilities();
  else if (guideTab === 'stories') el.innerHTML = renderGuideStories();
  else if (guideTab === 'quickstart') el.innerHTML = renderGuideQuickstart();
}

function renderGuideArch() {
  return '<div class="card"><h3>绝影 (JueYing) — AI Agent 编排与执行平台</h3>' +
    '<p class="section-desc">绝影是一个企业级 AI Agent 编排与执行平台。用户通过飞书/企微等 IM 渠道与系统交互，系统使用 LLM 将用户意图规划为多阶段工作流，自动调度执行器完成各阶段任务，最终汇报结果。系统支持多租户、用户隔离、策略控制与记忆管理。</p></div>' +

    '<div class="card"><h3>系统架构图</h3>' +
    '<p class="section-desc">以下架构图展示了系统的分层设计：从用户入口到基础设施，共分为6层。</p>' +

    '<div class="arch-layer"><span class="arch-layer-title">用户入口层</span><div class="arch-nodes">' +
    '<div class="arch-node primary"><div class="node-icon">💬</div><div class="node-name">飞书 App</div><div class="node-desc">长连接 WebSocket</div></div>' +
    '<div class="arch-node primary"><div class="node-icon">💼</div><div class="node-name">企业微信</div><div class="node-desc">Webhook 回调</div></div>' +
    '<div class="arch-node primary"><div class="node-icon">🌐</div><div class="node-name">Web Portal</div><div class="node-desc">浏览器管理后台</div></div>' +
    '</div></div>' +

    '<div class="arch-arrow">▼</div>' +

    '<div class="arch-layer"><span class="arch-layer-title">网关层 — 消息适配 · 身份解析 · 意图路由</span><div class="arch-nodes">' +
    '<div class="arch-node success"><div class="node-icon">🚪</div><div class="node-name">Gateway Adapter</div><div class="node-desc">5路意图分类 + 身份绑定</div></div>' +
    '</div></div>' +

    '<div class="arch-arrow">▼</div>' +

    '<div class="arch-layer"><span class="arch-layer-title">编排层 — 工作流规划 · 状态机 · 监督</span><div class="arch-nodes">' +
    '<div class="arch-node warning"><div class="node-icon">⚡</div><div class="node-name">Workflow Service</div><div class="node-desc">13状态状态机 + 16阶段类型</div></div>' +
    '</div></div>' +

    '<div class="arch-arrow">▼</div>' +

    '<div class="arch-layer"><span class="arch-layer-title">执行层 — 多种执行器调度</span><div class="arch-nodes">' +
    '<div class="arch-node info"><div class="node-icon">🔧</div><div class="node-name">Executor Gateway</div><div class="node-desc">6种执行器调度</div></div>' +
    '<div class="arch-node"><div class="node-icon">📝</div><div class="node-name">Generic Exec.</div><div class="node-desc">通用任务</div></div>' +
    '<div class="arch-node"><div class="node-icon">💻</div><div class="node-name">Code Exec.</div><div class="node-desc">代码执行</div></div>' +
    '<div class="arch-node"><div class="node-icon">🔍</div><div class="node-name">Retrieval Exec.</div><div class="node-desc">知识检索</div></div>' +
    '<div class="arch-node"><div class="node-icon">✅</div><div class="node-name">Verification</div><div class="node-desc">结果验证</div></div>' +
    '<div class="arch-node"><div class="node-icon">🛠️</div><div class="node-name">Repair</div><div class="node-desc">故障修复</div></div>' +
    '</div></div>' +

    '<div class="arch-arrow">▼</div>' +

    '<div class="arch-layer"><span class="arch-layer-title">支撑服务层</span><div class="arch-nodes">' +
    '<div class="arch-node"><div class="node-icon">🧠</div><div class="node-name">Hermes Adapter</div><div class="node-desc">会话记忆 · 上下文召回</div></div>' +
    '<div class="arch-node"><div class="node-icon">📚</div><div class="node-name">Fact Retrieval</div><div class="node-desc">向量检索 · 知识审核</div></div>' +
    '<div class="arch-node"><div class="node-icon">🤖</div><div class="node-name">LiteLLM Proxy</div><div class="node-desc">LLM 统一代理</div></div>' +
    '<div class="arch-node"><div class="node-icon">🔧</div><div class="node-name">Skill Library</div><div class="node-desc">技能库管理</div></div>' +
    '<div class="arch-node"><div class="node-icon">📊</div><div class="node-name">Resource Scheduler</div><div class="node-desc">配额 · 巡检</div></div>' +
    '<div class="arch-node"><div class="node-icon">📱</div><div class="node-name">Mobile App</div><div class="node-desc">推送服务</div></div>' +
    '</div></div>' +

    '<div class="arch-arrow">▼</div>' +

    '<div class="arch-layer"><span class="arch-layer-title">基础设施层</span><div class="arch-nodes">' +
    '<div class="arch-node"><div class="node-icon">🐘</div><div class="node-name">PostgreSQL</div><div class="node-desc">pgvector + AGE 图</div></div>' +
    '<div class="arch-node"><div class="node-icon">⚡</div><div class="node-name">Redis</div><div class="node-desc">缓存 · 会话</div></div>' +
    '<div class="arch-node"><div class="node-icon">📦</div><div class="node-name">MinIO</div><div class="node-desc">对象存储</div></div>' +
    '<div class="arch-node"><div class="node-icon">🔭</div><div class="node-name">SigNoz</div><div class="node-desc">OTel · 可观测性</div></div>' +
    '</div></div>' +
    '</div>' +

    '<div class="card"><h3>核心数据流：4条消息路径</h3>' +
    '<p class="section-desc">用户消息进入 Gateway 后，系统通过 LLM 意图分类将消息路由到4条不同的处理路径：</p>' +

    '<div class="story-card"><h4>💬 Chat 路径 — 普通对话</h4>' +
    '<div class="story-body">用户发送日常消息，系统<strong>召回历史记忆</strong>，调用 LLM 生成回复，并将对话存入记忆系统。适合闲聊、简单问答等场景。</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">身份解析</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(chat)</span><span class="flow-arrow">→</span><span class="flow-step">召回记忆</span><span class="flow-arrow">→</span><span class="flow-step">LLM 生成回复</span><span class="flow-arrow">→</span><span class="flow-step">存储记忆</span><span class="flow-arrow">→</span><span class="flow-step">推送回复</span></div></div>' +

    '<div class="story-card"><h4>⚡ Task 路径 — 长任务工作流</h4>' +
    '<div class="story-body">用户提交复杂任务，系统<strong>自动规划多阶段工作流</strong>，调度执行器逐步完成，完成后推送结果。适合数据分析、报告生成、代码开发等场景。</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(task)</span><span class="flow-arrow">→</span><span class="flow-step">配额检查</span><span class="flow-arrow">→</span><span class="flow-step">工作流规划</span><span class="flow-arrow">→</span><span class="flow-step">派发执行</span><span class="flow-arrow">→</span><span class="flow-step">轮询进度</span><span class="flow-arrow">→</span><span class="flow-step">推送结果</span></div></div>' +

    '<div class="story-card"><h4>📝 Knowledge Submit 路径 — 知识提交</h4>' +
    '<div class="story-body">用户提交知识内容，系统写入<strong>待审核知识池</strong>，管理员在审批台审核后正式入库。适合员工分享客户信息、业务知识等场景。</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(knowledge)</span><span class="flow-arrow">→</span><span class="flow-step">写入待审核池</span><span class="flow-arrow">→</span><span class="flow-step">管理员审核</span><span class="flow-arrow">→</span><span class="flow-step">知识入库</span></div></div>' +

    '<div class="story-card"><h4>🔎 Quick Lookup 路径 — 快速查询</h4>' +
    '<div class="story-body">用户发起快速查询，系统创建<strong>轻量级单阶段工作流</strong>，短轮询获取结果，超时则降级到 Chat 路径。适合查询电话、地址等简单信息检索。</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(lookup)</span><span class="flow-arrow">→</span><span class="flow-step">轻量工作流</span><span class="flow-arrow">→</span><span class="flow-step">短轮询(15s)</span><span class="flow-arrow">→</span><span class="flow-step">返回结果/降级Chat</span></div></div>' +
    '</div>' +

    '<div class="card"><h3>工作流状态机</h3>' +
    '<p class="section-desc">工作流从创建到完成经历以下状态流转，支持暂停、恢复、修复等操作：</p>' +
    '<div style="text-align:center;padding:12px 0;font-size:14px;line-height:2.2">' +
    '<span class="badge badge-info">draft</span> → <span class="badge badge-info">planned</span> → <span class="badge badge-warning">running</span> → <span class="badge badge-warning">verifying</span> → <span class="badge badge-warning">reporting</span> → <span class="badge badge-success">succeeded</span> → <span class="badge" style="background:var(--surface2);color:var(--text2)">archived</span>' +
    '<br><span style="font-size:13px;color:var(--text2)">分支: running 可进入 <span class="badge badge-warning">waiting_user</span> / <span class="badge badge-danger">blocked</span> / <span class="badge" style="background:var(--surface2)">paused</span>；verifying 可进入 <span class="badge badge-warning">repairing</span>；任意运行态可进入 <span class="badge badge-danger">failed</span> / <span class="badge badge-danger">cancelled</span></span>' +
    '</div></div>';
}

function renderGuideCapabilities() {
  return '<div class="card"><h3>核心能力矩阵</h3>' +
    '<p class="section-desc">绝影平台提供7大核心能力，覆盖从对话交互到知识沉淀的完整链路。</p></div>' +

    '<div class="capability-grid">' +
    '<div class="capability-card"><div class="cap-icon">💬</div><h4>智能对话</h4><p>基于 LLM 的多轮对话，支持上下文记忆、历史压缩、意图自动分类。用户无需学习，直接在飞书/企微中对话即可。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">⚡</div><h4>长任务工作流</h4><p>复杂任务自动拆解为多阶段工作流：意图澄清 → 证据检索 → 决策推理 → 结果报告。支持16种阶段类型和6种执行器。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">📚</div><h4>知识管理</h4><p>支持知识提交、审核、提取、向量检索和图查询。个人知识与组织知识库隔离，支持知识从对话中自动抽取。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🧠</div><h4>记忆系统</h4><p>会话记忆存储与召回，支持上下文压缩摘要。每日"梦境"机制自动总结和归档记忆，保持对话连贯性。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🔧</div><h4>技能系统</h4><p>14项预制技能（Document Pro、Deep Search、Ontology等），支持从镜像站搜索安装。成功工作流可自动归档为技能复用。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🏢</div><h4>多租户管理</h4><p>组织隔离、角色权限(RBAC)、邀请管理、策略控制、审计日志。确保企业级数据安全和合规。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🌐</div><h4>多渠道统一</h4><p>飞书长连接、企业微信 Webhook、Web Portal 三端统一接入，身份自动绑定，消息无缝流转。</p></div>' +
    '</div>' +

    '<div class="card"><h3>执行器类型</h3>' +
    '<table><tr><th>执行器</th><th>适用阶段</th><th>说明</th></tr>' +
    '<tr><td>Generic Executor</td><td>意图澄清、计划生成、决策推理、报告等</td><td>通用 LLM 驱动任务执行</td></tr>' +
    '<tr><td>Code Executor</td><td>Implementation</td><td>编写和执行代码，沙箱隔离运行</td></tr>' +
    '<tr><td>Retrieval-Aware Executor</td><td>EvidenceRetrieval、MemoryRetrieval</td><td>结合知识检索的智能执行</td></tr>' +
    '<tr><td>Verification Executor</td><td>Verification</td><td>验证执行结果的正确性</td></tr>' +
    '<tr><td>Repair Executor</td><td>Repair</td><td>自动修复发现的问题</td></tr>' +
    '<tr><td>Approval Executor</td><td>Approval</td><td>等待人工审批后继续</td></tr>' +
    '</table></div>';
}

function renderGuideStories() {
  return '<div class="card"><h3>场景故事线（共 20 条）</h3>' +
    '<p class="section-desc">以下故事线展示了不同角色在绝影平台上的典型使用场景，帮助您理解系统的实际应用方式。</p></div>' +

    '<div class="story-card"><h4>📖 故事一：平台初始化配置</h4>' +
    '<div class="story-role">角色：管理员 (Admin) · Day 1</div>' +
    '<div class="story-body">' +
    'IT 管理员首次部署绝影平台，通过 <strong>6 步设置向导</strong>完成初始化：' +
    '<br><br><strong>Step 1</strong> 数据库初始化 → <strong>Step 2</strong> 创建组织 → <strong>Step 3</strong> 创建管理员账号 → <strong>Step 4</strong> 配置飞书/企微渠道 → <strong>Step 5</strong> 配置 LLM 模型 → <strong>Step 6</strong> 配置向量模型' +
    '<br><br>完成后，员工即可在飞书/企微中直接与绝影对话。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">docker compose up</span><span class="flow-arrow">→</span><span class="flow-step">设置向导</span><span class="flow-arrow">→</span><span class="flow-step">组织创建</span><span class="flow-arrow">→</span><span class="flow-step">渠道配置</span><span class="flow-arrow">→</span><span class="flow-step">模型激活</span></div></div>' +

    '<div class="story-card"><h4>📖 故事二：组织与用户开通</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '管理员在 Web Portal 中创建公司/部门组织架构，批量创建子用户并分配角色（user/admin）。' +
    '<br><br>系统自动为每个组织创建 <strong>Policy Snapshot</strong>（权限策略快照），控制数据访问范围和组织隔离。' +
    '<br>飞书/企微用户首次对话时自动绑定 <strong>channel_identity</strong>，建立渠道身份映射。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">创建组织</span><span class="flow-arrow">→</span><span class="flow-step">批量建用户</span><span class="flow-arrow">→</span><span class="flow-step">角色分配</span><span class="flow-arrow">→</span><span class="flow-step">Policy Snapshot</span><span class="flow-arrow">→</span><span class="flow-step">渠道绑定</span></div></div>' +

    '<div class="story-card"><h4>📖 故事三：配置 LLM 模型</h4>' +
    '<div class="story-role">角色：管理员 (Admin) · 配置页</div>' +
    '<div class="story-body">' +
    '管理员在 <strong>LiteLLM Proxy</strong> 中配置大语言模型（GPT-4o / Claude / DeepSeek / 本地 Ollama 等）。' +
    '<br><br>通过 Web Portal 的 <strong>LLM 模型管理页</strong>激活模型、调整顺序、切换默认 Provider。' +
    '<br>支持多模型 <strong>降级策略</strong>（主模型不可用时自动切换备用模型）。' +
    '<br>系统使用 LiteLLM 统一代理，各服务（Planner / Executor / Chat）无需关心底层 Provider。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">配置 Provider</span><span class="flow-arrow">→</span><span class="flow-step">激活模型</span><span class="flow-arrow">→</span><span class="flow-step">排序优先级</span><span class="flow-arrow">→</span><span class="flow-step">降级策略</span></div></div>' +

    '<div class="story-card"><h4>📖 故事四：配置向量模型 (Embedding)</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '管理员配置向量嵌入模型：<strong>OpenAI text-embedding-3-small</strong> 或 <strong>Ollama nomic-embed-text</strong>。' +
    '<br><br>该模型用于：' +
    '<br>• 知识文档的分块向量化存储到 <strong>pgvector 索引</strong>' +
    '<br>• 检索时计算用户查询与文档向量的余弦相似度' +
    '<br>• 记忆系统（memory_item）的语义 embedding' +
    '<br><br>配置完成后，所有知识检索和语义匹配即开始工作。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">选择模型</span><span class="flow-arrow">→</span><span class="flow-step">生成向量</span><span class="flow-arrow">→</span><span class="flow-step">pgvector 索引</span><span class="flow-arrow">→</span><span class="flow-step">语义检索</span></div></div>' +

    '<div class="story-card"><h4>📖 故事五：配置 Rerank 模型</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '配置 Rerank 重排序模型（Cohere / Jina Reranker），对向量检索的 top-k 结果进行 <strong>精排</strong>。' +
    '<br><br>工作流程：' +
    '<br><strong>向量粗排</strong>（pgvector 余弦相似度 top-50）→ <strong>Rerank 精排</strong>（交叉编码器打分 top-5）→ 返回给 LLM' +
    '<br><br>Rerank 模型显著提升了检索结果的<strong>精准度和相关性</strong>，是可选的增强配置。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">向量粗排</span><span class="flow-arrow">→</span><span class="flow-step">Rerank 精排</span><span class="flow-arrow">→</span><span class="flow-step">Top-5</span><span class="flow-arrow">→</span><span class="flow-step">LLM 整合</span></div></div>' +

    '<div class="story-card"><h4>📖 故事六：统一知识管理</h4>' +
    '<div class="story-role">角色：管理员 + 普通用户</div>' +
    '<div class="story-body">' +
    '管理员批量导入企业知识文档（Markdown / PDF / Word / TXT）：' +
    '<br><br>• 系统自动 <strong>chunk 分块</strong>（document_chunk 表）' +
    '<br>• 生成 <strong>向量 embedding</strong>（1536 维 pgvector）' +
    '<br>• 创建 <strong>全文搜索索引</strong>（pg_trgm + tsvector）' +
    '<br>• 进入<strong>待审核池</strong>，管理员在审批台审核通过后入库' +
    '<br><br>支持<strong>共享知识库</strong>模式，跨组织的文档可被授权组织检索。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">导入文档</span><span class="flow-arrow">→</span><span class="flow-step">分块+向量化</span><span class="flow-arrow">→</span><span class="flow-step">审核</span><span class="flow-arrow">→</span><span class="flow-step">入库</span><span class="flow-arrow">→</span><span class="flow-step">检索可用</span></div></div>' +

    '<div class="story-card"><h4>📖 故事七：子用户日常对话</h4>' +
    '<div class="story-role">角色：普通用户 (User) · Day 2</div>' +
    '<div class="story-body">' +
    '小王是刚入职的销售，需要了解公司产品信息。他在<strong>飞书中直接对话绝影</strong>：' +
    '<br><br>"帮我查一下 A 产品的最新定价方案"' +
    '<br>→ 系统识别为 <strong>Chat</strong>，检索组织知识 + 对话记忆，即时回复。' +
    '<br><br>系统自动加载用户画像和上下文：身份信息、隶属组织、历史对话摘要、权限范围。' +
    '<br>小王无需学习任何操作，<strong>像聊天一样完成工作</strong>。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">IM 对话</span><span class="flow-arrow">→</span><span class="flow-step">身份解析</span><span class="flow-arrow">→</span><span class="flow-step">记忆召回</span><span class="flow-arrow">→</span><span class="flow-step">LLM 回复</span></div></div>' +

    '<div class="story-card"><h4>📖 故事八：长任务工作流生成与执行</h4>' +
    '<div class="story-role">角色：普通用户 (User) · Day 3</div>' +
    '<div class="story-body">' +
    '小王发起复杂任务："帮我分析 Q3 华东区销售数据，生成对比报告和优化建议"' +
    '<br><br>系统识别为 <strong>Task</strong>，自动执行：' +
    '<br><strong>① Planner 规划</strong> — LLM 拆解为 4~6 个阶段（数据检索 → 清洗分析 → 报告生成 → 验证 → 归档）' +
    '<br><strong>② Stage 调度</strong> — Workflow Machine 按序执行每个阶段' +
    '<br><strong>③ Executor 执行</strong> — 各阶段分派不同执行器（通用/代码/检索感知）' +
    '<br><strong>④ 轮询推送</strong> — 每 10 秒检查进度，最多 12 分钟，完成后推送到飞书' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">Task 意图</span><span class="flow-arrow">→</span><span class="flow-step">Planner 规划</span><span class="flow-arrow">→</span><span class="flow-step">Stage 调度</span><span class="flow-arrow">→</span><span class="flow-step">Executor 执行</span><span class="flow-arrow">→</span><span class="flow-step">推送结果</span></div></div>' +

    '<div class="story-card"><h4>📖 故事九：工作流执行与汇报</h4>' +
    '<div class="story-role">角色：系统自动</div>' +
    '<div class="story-body">' +
    '工作流的每个 Stage 由 <strong>7 种专用 Executor</strong> 之一执行：' +
    '<br><br><strong>generic-executor</strong> — LLM 通用文本生成/分析' +
    '<br><strong>code-executor</strong> — 沙箱代码运行（Python/JS）' +
    '<br><strong>retrieval-aware-executor</strong> — 先检索再生成（RAG 模式）' +
    '<br><strong>verification-executor</strong> — 结果验证（规则校验/测试判断）' +
    '<br><strong>repair-executor</strong> — 失败修复（分析失败原因 + 生成修补方案）' +
    '<br><strong>approval-executor</strong> — 人工审批节点（等待用户确认）' +
    '<br><br>每阶段完成后通过 <strong>Checkpoint</strong> 留痕，支持断点续传。Artifact 附件（报告/图表）存入 MinIO。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">Schedule Stage</span><span class="flow-arrow">→</span><span class="flow-step">Execute</span><span class="flow-arrow">→</span><span class="flow-step">Checkpoint</span><span class="flow-arrow">→</span><span class="flow-step">Next Stage</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十：管理员下发工作要求</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '部门经理在 Web Portal <strong>任务分发</strong>页面创建工作要求（task_dispatch）：' +
    '<br><br>"请各位销售本周五前提交月度客户拜访报告"' +
    '<br>→ 系统将任务 <strong>推送到每位销售</strong>的飞书/企微。' +
    '<br>→ 销售在 IM 中直接回复，系统自动收集归档。' +
    '<br>→ 经理在 Portal 中实时查看 <strong>完成进度统计</strong>。' +
    '<br><br>支持指定 <strong>截止日期</strong>和 <strong>分配角色</strong>，未完成自动提醒。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">创建任务</span><span class="flow-arrow">→</span><span class="flow-step">推送成员</span><span class="flow-arrow">→</span><span class="flow-step">IM 提交</span><span class="flow-arrow">→</span><span class="flow-step">进度统计</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十一：审计与监控</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '系统对所有关键操作进行 <strong>全量审计</strong>：' +
    '<br><br><strong>audit_event</strong> 表记录每次 API 调用、知识访问、工作流变更、权限操作。' +
    '<br><strong>retrieval_trace</strong> 表追踪每次知识检索的向量匹配和 Rerank 过程。' +
    '<br><strong>SigNoz + OpenTelemetry</strong> 分布式追踪全链路调用耗时。' +
    '<br><strong>service_status_event</strong> 记录所有服务健康状态变化历史。' +
    '<br><br>管理员在 Portal 审计日志页面按用户/操作/时间/组织筛选查询。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">操作触发</span><span class="flow-arrow">→</span><span class="flow-step">audit_event</span><span class="flow-arrow">→</span><span class="flow-step">OTel 追踪</span><span class="flow-arrow">→</span><span class="flow-step">日志查询</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十二：PG 全量存储与组织隔离</h4>' +
    '<div class="story-role">角色：系统架构 · Day 4</div>' +
    '<div class="story-body">' +
    '系统使用 <strong>47 张 PostgreSQL 表</strong>承载全部业务数据，分类如下：' +
    '<br><br><strong>业务表</strong> — 用户/组织/工作流/策略/技能（12 张）' +
    '<br><strong>检索表</strong> — 实体/关系/事实/文档/向量/记忆（18 张）' +
    '<br><strong>图投影</strong> — AGE vertex/edge + projection_event（1+ 张）' +
    '<br><strong>治理表</strong> — 审计/配额/技能评估/梦境（14 张）' +
    '<br><br>所有表均含 <strong>org_id 字段</strong>，通过 Row-Level Security 和 Policy Snapshot 实现组织级数据隔离。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">PG Schema</span><span class="flow-arrow">→</span><span class="flow-step">org_id 隔离</span><span class="flow-arrow">→</span><span class="flow-step">pgvector</span><span class="flow-arrow">→</span><span class="flow-step">AGE Graph</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十三：定时知识抽取与审核</h4>' +
    '<div class="story-role">角色：系统自动 + 管理员</div>' +
    '<div class="story-body">' +
    'web-portal 内置 <strong>cron 定时任务</strong>：' +
    '<br><br>• 每日从工作流执行记录中抽取 <strong>结构化知识点</strong>' +
    '<br>• 从对话记忆（hermes_memory）中提取可归档的内容' +
    '<br>• 提交到 <strong>knowledge_review</strong> 审核池' +
    '<br>• 管理员审核后正式入库检索索引' +
    '<br><br>抽取的知识包括：实体（客户/产品/人员）、关系（负责/包含/属于）、事实（报价/日期/决策）。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">定时触发</span><span class="flow-arrow">→</span><span class="flow-step">知识抽取</span><span class="flow-arrow">→</span><span class="flow-step">审核池</span><span class="flow-arrow">→</span><span class="flow-step">管理员审核</span><span class="flow-arrow">→</span><span class="flow-step">正式入库</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十四：AGE 图查询与企业关系网络</h4>' +
    '<div class="story-role">角色：系统 · Day 5</div>' +
    '<div class="story-body">' +
    'Apache AGE（PostgreSQL 图扩展）构建<strong>企业知识图谱</strong>：' +
    '<br><br>• <strong>实体（Vertex）</strong> — 客户、产品、员工、项目、组织' +
    '<br>• <strong>关系（Edge）</strong> — 负责、包含、属于、采购、汇报' +
    '<br>• <strong>查询（Cypher）</strong> — "查找与项目 X 相关的所有供应商和联系人"' +
    '<br>• <strong>AGE → PG 投影</strong> — projection_event 将图关系同步到 relation 表供 LLM 使用' +
    '<br><br>图查询结果与向量检索结果合并重排序，提供<strong>深度关联分析</strong>能力。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">AGE Vertex</span><span class="flow-arrow">→</span><span class="flow-step">Edge 关系</span><span class="flow-arrow">→</span><span class="flow-step">Cypher 查询</span><span class="flow-arrow">→</span><span class="flow-step">投影到 PG</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十五：短任务与长任务智能分流</h4>' +
    '<div class="story-role">角色：Gateway 自动</div>' +
    '<div class="story-body">' +
    '网关适配器通过 <strong>5 路意图分类</strong>分流所有入站消息：' +
    '<br><br><strong>① Chat</strong> — 普通对话，即时 LLM 回复' +
    '<br><strong>② Task</strong> — 长任务，Planner 规划 + 多阶段执行 + 轮询推送（10s × 72 = 12min 超时）' +
    '<br><strong>③ Quick Lookup</strong> — 快速查询，3 轮 × 5s 短超时检索 → 失败降级 Chat' +
    '<br><strong>④ Knowledge Submit</strong> — 知识提交，写入待审核池' +
    '<br><strong>⑤ Task Dispatch</strong> — 管理员下发任务，推送到子用户' +
    '<br><br>分类使用 LiteLLM + 结构化输出，<strong><100ms 延迟</strong>。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">消息入站</span><span class="flow-arrow">→</span><span class="flow-step">5 路分类</span><span class="flow-arrow">→</span><span class="flow-step">路由分发</span><span class="flow-arrow">→</span><span class="flow-step">对应处理链</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十六：工作流归档为 Skill</h4>' +
    '<div class="story-role">角色：系统自动 + 管理员 · Day 6</div>' +
    '<div class="story-body">' +
    '成功执行的工作流<strong>自动提取为技能候选</strong>（Skill Candidate）：' +
    '<br><br>• gateway-adapter 调用 <strong>extractWorkflowAsSkillCandidate()</strong>' +
    '<br>• 提取工作流的 stage_chain 和 user_goal' +
    '<br>• 提交到 <strong>skill-library</strong> 的 /internal/skills/create' +
    '<br>• 管理员在 Portal 审核（skill_audit_record）后发布' +
    '<br>• 技能注册到 <strong>org_skill_registry</strong>，全组织可复用' +
    '<br><br>同时支持从 <strong>Mirror 镜像站</strong>搜索和安装公开技能。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">成功工作流</span><span class="flow-arrow">→</span><span class="flow-step">提取 Skill</span><span class="flow-arrow">→</span><span class="flow-step">审核发布</span><span class="flow-arrow">→</span><span class="flow-step">组织技能库</span><span class="flow-arrow">→</span><span class="flow-step">全员复用</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十七：技能公网安装与多路检索</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '管理员从 <strong>Skill Mirror</strong>（公网镜像仓库）搜索并安装社区技能：' +
    '<br><br>• Portal 调用 /api/admin/skills/mirror-search 搜索预制技能（Document Pro / Deep Search 等）' +
    '<br>• 点击安装 → 调用 /api/admin/skills/mirror-install' +
    '<br>• 系统从 Mirror 拉取 skill_definition 并创建到 local skill-library' +
    '<br>• 自动注册到 <strong>org_skill_registry</strong>' +
    '<br><br>多路检索 LLM 决策：同时走向量检索 + AGE 图查询 + 全文搜索 + Skill 检索，LLM 综合排序返回。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">Mirror Search</span><span class="flow-arrow">→</span><span class="flow-step">Install</span><span class="flow-arrow">→</span><span class="flow-step">Local Import</span><span class="flow-arrow">→</span><span class="flow-step">Registry</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十八：智能体人设与用户画像</h4>' +
    '<div class="story-role">角色：管理员 + 系统自动 · Day 7</div>' +
    '<div class="story-body">' +
    '管理员为组织配置 <strong>System Prompt</strong>（智能体人设），定义绝影在不同场景下的角色和行为准则。' +
    '<br><br>同时，<strong>Hermes 记忆系统</strong>持续积累用户画像：' +
    '<br>• 每次对话的记忆（hermes_memory）自动归档到 long-term memory_item' +
    '<br>• 每日梦境自动分析形成 <strong>org_memory_summary</strong>' +
    '<br>• 访问日志（memory_access_log）+ 压缩日志（memory_compression_log）追踪记忆使用' +
    '<br><br>用户画像包含：常用术语、关注领域、决策偏好、历史上下文。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">System Prompt</span><span class="flow-arrow">→</span><span class="flow-step">对话记忆</span><span class="flow-arrow">→</span><span class="flow-step">画像积累</span><span class="flow-arrow">→</span><span class="flow-step">个性化回复</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十九：梦境 · 每日记忆总结</h4>' +
    '<div class="story-role">角色：系统自动 (Dream Mode)</div>' +
    '<div class="story-body">' +
    '每天夜间，绝影自动执行<strong>"梦境"流程</strong>：' +
    '<br><br><strong>① Collect</strong> — 汇总当日所有用户对话记忆（hermes_memory）' +
    '<br><strong>② Compress</strong> — LLM 将冗长对话压缩为精炼摘要（memory_compression_log）' +
    '<br><strong>③ Summarize</strong> — 生成组织级记忆摘要（org_memory_summary）' +
    '<br><strong>④ Extract</strong> — 从摘要中提取结构化知识（实体/关系/事实）' +
    '<br><strong>⑤ Archive</strong> — 冷数据冻结归档，释放热存储空间' +
    '<br><br>管理员可配置 <strong>cron 表达式</strong>自定义梦境执行时间。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">收集记忆</span><span class="flow-arrow">→</span><span class="flow-step">LLM 压缩</span><span class="flow-arrow">→</span><span class="flow-step">生成摘要</span><span class="flow-arrow">→</span><span class="flow-step">知识抽取</span><span class="flow-arrow">→</span><span class="flow-step">归档冻结</span></div></div>' +

    '<div class="story-card"><h4>📖 故事二十：记忆分层管理 + 技能发现生态</h4>' +
    '<div class="story-role">角色：系统自动 (Dream Mode+)</div>' +
    '<div class="story-body">' +
    '梦境模式的进阶功能——<strong>记忆分层 + 技能发现闭环</strong>：' +
    '<br><br><strong>记忆三层架构</strong>：' +
    '<br><strong>• 最新层</strong> — hermes_memory（热存储，即时访问）' +
    '<br><strong>• 缓存层</strong> — memory_item + embedding（温存储，语义检索）' +
    '<br><strong>• 休眠层</strong> — org_memory_summary（冷存储，压缩归档）' +
    '<br><br><strong>技能发现闭环</strong>：' +
    '<br>梦境分析发现新的 Workflow Pattern → 提取 Skill Candidate → scene_value_assessment 评估 → skill_audit_record 审核 → org_skill_registry 注册 → skill_usage_stats 追踪使用效果。' +
    '<br><br>形成 <strong>"使用 → 发现 → 提炼 → 注册 → 复用的持续优化"的完整生态系统</strong>。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">发现</span><span class="flow-arrow">→</span><span class="flow-step">提炼</span><span class="flow-arrow">→</span><span class="flow-step">评估</span><span class="flow-arrow">→</span><span class="flow-step">注册</span><span class="flow-arrow">→</span><span class="flow-step">复用</span></div></div>';
}

function renderGuideQuickstart() {
  return '<div class="card"><h3>快速上手指南</h3>' +
    '<p class="section-desc">按照以下步骤，快速开始使用绝影平台。</p></div>' +

    '<div class="card"><h3>🔧 管理员：首次部署</h3>' +
    '<table><tr><th>步骤</th><th>操作</th><th>页面入口</th></tr>' +
    '<tr><td>1</td><td>完成6步设置向导（数据库→组织→管理员→渠道→LLM→向量）</td><td>首次登录自动弹出</td></tr>' +
    '<tr><td>2</td><td>配置飞书/企微渠道，填写 App ID 和 Secret</td><td>系统配置 → 渠道配置</td></tr>' +
    '<tr><td>3</td><td>配置 LLM 模型，设置主模型和备用模型</td><td>系统配置 → LLM 配置</td></tr>' +
    '<tr><td>4</td><td>创建用户并分配到组织</td><td>用户管理 + 组织管理</td></tr>' +
    '<tr><td>5</td><td>导入初始知识库</td><td>知识导入</td></tr>' +
    '<tr><td>6</td><td>从镜像站安装预制技能</td><td>技能管理 → 搜索镜像站</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>👤 用户：日常使用</h3>' +
    '<table><tr><th>场景</th><th>操作方式</th><th>示例</th></tr>' +
    '<tr><td>日常对话</td><td>在飞书/企微中直接发消息</td><td>"你好，今天天气怎么样？"</td></tr>' +
    '<tr><td>快速查询</td><td>用"查一下"等关键词触发</td><td>"查一下张经理的电话"</td></tr>' +
    '<tr><td>提交长任务</td><td>描述复杂目标，系统自动规划</td><td>"帮我分析Q3销售数据并生成报告"</td></tr>' +
    '<tr><td>提交知识</td><td>用"记录"/"提交知识"等关键词</td><td>"记录：XX客户下季度采购500套"</td></tr>' +
    '<tr><td>Web任务</td><td>在 Portal 任务接入页面创建</td><td>填写任务目标、类型、执行者</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>📋 管理员：日常运维</h3>' +
    '<table><tr><th>任务</th><th>页面入口</th><th>频率</th></tr>' +
    '<tr><td>审核知识提交</td><td>审批台 / 知识审核</td><td>每日</td></tr>' +
    '<tr><td>审核工作流</td><td>审批台</td><td>按需</td></tr>' +
    '<tr><td>查看服务状态</td><td>仪表盘</td><td>随时</td></tr>' +
    '<tr><td>监控资源使用</td><td>资源监控</td><td>每周</td></tr>' +
    '<tr><td>查看审计日志</td><td>审计日志</td><td>按需</td></tr>' +
    '<tr><td>管理用户/组织</td><td>用户管理 / 组织管理</td><td>按需</td></tr>' +
    '<tr><td>更新技能库</td><td>技能管理 → 搜索镜像站</td><td>每月</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>💡 使用技巧</h3>' +
    '<div class="capability-grid">' +
    '<div class="capability-card"><div class="cap-icon">🎯</div><h4>明确任务目标</h4><p>描述任务时尽量具体，包含目标、范围和期望输出格式，系统会生成更精准的工作流。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">📝</div><h4>善用知识提交</h4><p>将重要的客户信息、业务规则主动提交给系统，审核后全员可检索，减少重复沟通。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🔄</div><h4>复用技能模板</h4><p>从镜像站安装预制技能，或将成功工作流保存为技能，避免重复创建相似任务。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">⚡</div><h4>选择合适的任务类型</h4><p>分析任务适合数据处理，调研任务支持LUI对话，执行任务适合自动化操作，创意任务适合内容生成。</p></div>' +
    '</div></div>';
}

async function renderDashboard(el) {
  el.innerHTML = '<div class="page-header"><h2>系统总览</h2></div><div class="stat-grid" id="stats-grid"><div class="stat-card"><div class="stat-value">-</div><div class="stat-label">加载中...</div></div></div><div class="card"><h3>服务状态 <span id="svc-refresh-indicator" style="font-size:12px;color:var(--text2)"></span></h3><div id="services-list">加载中...</div></div>';
  const r = await api('/api/system/overview');
  if (r.ok && r.data.overview) {
    const o = r.data.overview;
    const grid = document.getElementById('stats-grid');
    const stats = o.summary || {};
    grid.innerHTML = Object.entries(stats).map(function(_ref) { const k=_ref[0],v=_ref[1]; return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(v)) + '</div><div class="stat-label">' + escapeHtml(k) + '</div></div>'; }).join('');
    const svcList = document.getElementById('services-list');
    if (o.services && o.services.length > 0) {
      svcList.innerHTML = '<table><tr><th>服务</th><th>状态</th><th>延迟</th></tr>' + o.services.map(function(s) {
        const dot = s.status === 'healthy' ? 'healthy' : (s.status === 'unreachable' ? 'unreachable' : 'unhealthy');
        return '<tr><td><span class="status-dot ' + dot + '"></span>' + escapeHtml(s.name) + '</td><td>' + statusBadge(s.status) + '</td><td>' + escapeHtml(String(s.latency_ms || '-')) + 'ms</td></tr>';
      }).join('') + '</table>';
    } else {
      svcList.innerHTML = '<p style="color:var(--text2)">暂无服务状态信息</p>';
    }
    startServiceStatusPolling();
  } else {
    document.getElementById('stats-grid').innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">无法加载概览数据</div></div>';
  }
}

function startServiceStatusPolling() {
  if (serviceStatusInterval) clearInterval(serviceStatusInterval);
  serviceStatusInterval = setInterval(async function() {
    const r = await api('/api/system/overview');
    if (!r.ok || !r.data.overview) return;
    const o = r.data.overview;
    const svcList = document.getElementById('services-list');
    const indicator = document.getElementById('svc-refresh-indicator');
    if (!svcList) { clearInterval(serviceStatusInterval); return; }
    if (o.services && o.services.length > 0) {
      o.services.forEach(function(s) {
        const prev = previousServiceStatus[s.name];
        if (prev && prev !== s.status) {
          const changeMsg = s.status === 'healthy' ? '服务 ' + s.name + ' 已恢复正常' : '服务 ' + s.name + ' 状态变更: ' + s.status;
          const changeType = s.status === 'healthy' ? 'success' : 'error';
          showToast(changeMsg, changeType);
        }
        previousServiceStatus[s.name] = s.status;
      });
      svcList.innerHTML = '<table><tr><th>服务</th><th>状态</th><th>延迟</th></tr>' + o.services.map(function(s) {
        const dot = s.status === 'healthy' ? 'healthy' : (s.status === 'unreachable' ? 'unreachable' : 'unhealthy');
        return '<tr><td><span class="status-dot ' + dot + '"></span>' + escapeHtml(s.name) + '</td><td>' + statusBadge(s.status) + '</td><td>' + escapeHtml(String(s.latency_ms || '-')) + 'ms</td></tr>';
      }).join('') + '</table>';
    }
    if (indicator) indicator.textContent = '更新于 ' + new Date().toLocaleTimeString();
  }, 15000);
}

async function renderWorkflows(el) {
  el.innerHTML = '<div class="page-header"><h2>Workflow 控制台</h2><div><button class="btn btn-outline btn-sm" onclick="currentView=\'task-input\';renderView()">创建工作流</button> <button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div></div><div class="card"><div id="wf-list">加载中...</div></div>';
  const r = await api('/api/workflows');
  if (r.ok && r.data) {
    const wfs = r.data.workflows || [];
    if (wfs.length === 0) {
      document.getElementById('wf-list').innerHTML = emptyState('📋', '暂无工作流', '您可以通过任务接入创建新的工作流', '<button class="btn btn-primary" onclick="currentView=\'task-input\';renderView()">创建工作流</button>');
    } else {
      document.getElementById('wf-list').innerHTML = '<table><tr><th>引用</th><th>目标</th><th>状态</th><th>创建时间</th><th>操作</th></tr>' + wfs.map(function(w) { return '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td>' + statusBadge(w.status) + '</td><td>' + escapeHtml(w.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="viewWorkflow(\'' + escJsAttr(w.ref || w.id) + '\')">详情</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    const errMsg = (r.data && r.data.error) || '未知错误';
    const isNetwork = r.status === 0;
    document.getElementById('wf-list').innerHTML = emptyState('⚠️', isNetwork ? '无法连接工作流服务' : '加载工作流列表失败', isNetwork ? '请检查工作流服务是否正常运行' : '错误: ' + escapeHtml(errMsg), '<button class="btn btn-primary" onclick="renderView()">重试</button>');
  }
}

async function viewWorkflow(ref) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref));
  let el = document.getElementById('main-content');
  if (r.ok && r.data.workflow) {
    const w = r.data.workflow;
    el.innerHTML = '<div class="page-header"><h2>Workflow: ' + escapeHtml(ref) + '</h2><button class="btn btn-outline" onclick="renderView()">返回</button></div><div class="card"><h3>基本信息</h3><p>目标: ' + escapeHtml(w.goal || '-') + '</p><p>状态: ' + statusBadge(w.status) + '</p><p>创建: ' + escapeHtml(w.created_at || '-') + '</p></div><div class="card"><h3>阶段</h3><div id="wf-stages">加载中...</div></div>';
    if (w.stages && w.stages.length > 0) {
      document.getElementById('wf-stages').innerHTML = '<table><tr><th>序号</th><th>名称</th><th>类型</th><th>状态</th></tr>' + w.stages.map(function(s, i) { return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(s.name || '-') + '</td><td>' + escapeHtml(s.stage_type || '-') + '</td><td>' + statusBadge(s.status) + '</td></tr>'; }).join('') + '</table>';
    } else {
      document.getElementById('wf-stages').innerHTML = '<p style="color:var(--text2)">暂无阶段信息</p>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载工作流详情', '请检查工作流服务状态', '<button class="btn btn-primary" onclick="renderView()">返回</button>');
  }
}

function renderTaskInput(el) {
  el.innerHTML = '<div class="page-header"><h2>任务接入</h2></div>' +
    '<div class="card"><p class="section-desc">任务接入模块用于创建并提交新的工作流任务。系统将根据任务类型自动规划执行路径，支持分析、调研、执行和创意四种任务类型。</p></div>' +
    '<div class="card"><h3>创建任务</h3>' +
    '<div class="form-group"><label>任务目标</label><textarea id="task-goal" placeholder="描述您要完成的任务目标，例如：分析Q1销售数据并生成报告"></textarea></div>' +
    '<div class="form-group"><label>任务类型</label><select id="task-type"><option value="analysis">分析任务 - 数据分析与报告</option><option value="research">调研任务 - 信息收集与对话</option><option value="execution">执行任务 - 自动化操作</option><option value="creative">创意任务 - 内容生成</option></select></div>' +
    '<div class="form-group"><label>目标执行者 (可选)</label><select id="task-executor"><option value="">系统自动分配</option></select><p class="hint-text">选择指定用户的Agent执行此任务，留空则由系统自动分配</p></div>' +
    '<div class="form-group"><label>风险等级</label><select id="task-risk"><option value="low">低 - 仅读取操作</option><option value="medium">中 - 涉及数据修改</option><option value="high">高 - 涉及关键系统变更</option></select></div>' +
    '<button class="btn btn-primary" onclick="submitTask()">提交任务</button></div>' +
    '<div class="card"><h3>LUI 对话模式</h3><p class="section-desc">调研类任务支持LUI对话模式，您可以直接与Agent进行自然语言交互，获取实时调研结果。</p>' +
    '<div class="form-group"><textarea id="lui-input" placeholder="输入您的问题，例如：帮我调研一下竞品A的最新动态..." style="min-height:80px"></textarea></div>' +
    '<button class="btn btn-outline" onclick="submitLUITask()">发送 (调研模式)</button>' +
    '<div id="lui-response" style="margin-top:12px"></div></div>';
  loadExecutorOptions();
}

async function loadExecutorOptions() {
  const r = await api('/api/users');
  const sel = document.getElementById('task-executor');
  if (!sel || !r.ok || !r.data.users) return;
  while (sel.options.length > 1) sel.remove(1);
  r.data.users.forEach(function(u) {
    const opt = document.createElement('option');
    opt.value = u.username;
    opt.textContent = u.username + ' (' + u.role + ')';
    sel.appendChild(opt);
  });
}

async function submitTask() {
  const goal = document.getElementById('task-goal').value.trim();
  if (!goal) { showToast('请输入任务目标', 'error'); return; }
  const taskType = document.getElementById('task-type').value || 'analysis';
  const riskLevel = document.getElementById('task-risk').value || 'low';
  const executor = document.getElementById('task-executor').value || '';
  const body = { goal, task_type: taskType, risk_level: riskLevel };
  if (executor) body.target_executor = executor;
  const r = await api('/api/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) { showToast('任务已创建'); currentView = 'workflows'; renderView(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || '创建失败', 'error'); }
}

async function submitLUITask() {
  const input = document.getElementById('lui-input').value.trim();
  if (!input) { showToast('请输入问题', 'error'); return; }
  const respEl = document.getElementById('lui-response');
  respEl.innerHTML = '<p style="color:var(--text2)">正在调研中...</p>';
  const body = { goal: input, task_type: 'research', risk_level: 'low' };
  const r = await api('/api/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    respEl.innerHTML = '<p style="color:var(--success)">调研任务已提交，请前往Workflow控制台查看结果</p><button class="btn btn-sm btn-outline" onclick="currentView=\'workflows\';renderView()">查看工作流</button>';
  } else {
    respEl.innerHTML = '<p style="color:var(--danger)">提交失败: ' + escapeHtml((r.data && r.data.error) || '未知错误') + '</p>';
  }
}

async function renderApprovals(el) {
  el.innerHTML = '<div class="page-header"><h2>审批台</h2><button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div><div class="card"><p class="section-desc">审批台展示所有待审批的工作流任务。您可以批准或驳回待审批项，批准后任务将继续执行。</p><div id="approval-list">加载中...</div></div>';
  const r = await api('/api/workflows?status=pending_approval');
  if (r.ok && r.data) {
    const wfs = r.data.workflows || [];
    if (wfs.length === 0) {
      document.getElementById('approval-list').innerHTML = emptyState('✅', '暂无待审批项', '当前没有需要审批的工作流任务');
    } else {
      document.getElementById('approval-list').innerHTML = '<table><tr><th>引用</th><th>目标</th><th>操作</th></tr>' + wfs.map(function(w) { return '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td><button class="btn btn-sm btn-success" onclick="handleApproval(\'' + escJsAttr(w.ref) + '\',\'approve\')">批准</button> <button class="btn btn-sm btn-danger" onclick="handleApproval(\'' + escJsAttr(w.ref) + '\',\'reject\')">驳回</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    const isNetwork = r.status === 0;
    document.getElementById('approval-list').innerHTML = emptyState('⚠️', isNetwork ? '无法连接审批服务' : '加载审批列表失败', isNetwork ? '请检查工作流服务是否正常运行' : '请稍后重试', '<button class="btn btn-primary" onclick="renderView()">重试</button>');
  }
}

async function handleApproval(ref, action) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref) + '/approval', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) { showToast('操作成功'); renderView(); } else { showToast((r.data && r.data.error) || '操作失败', 'error'); }
}

async function renderConfig(el) {
  el.innerHTML = '<div class="page-header"><h2>系统配置</h2></div><div class="tabs" id="config-tabs"></div><div id="config-content"></div>';
  const r = await api('/api/admin/config');
  const config = r.ok ? (r.data.config || {}) : {};
  const tabs = document.getElementById('config-tabs');

  function makeTabs(sections) {
    tabs.innerHTML = sections.map(function(s, i) { return '<div class="tab ' + (i === 0 ? 'active' : '') + '" data-section="' + s.key + '">' + s.label + '</div>'; }).join('');
    tabs.querySelectorAll('.tab').forEach(function(t) {
      t.addEventListener('click', function() {
        tabs.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
        t.classList.add('active');
        renderConfigSection(t.dataset.section, sections, config);
      });
    });
    renderConfigSection(sections[0].key, sections, config);
  }

  if (window.CONFIG_SECTIONS) {
    makeTabs(window.CONFIG_SECTIONS);
  } else {
    const meta = await api('/api/admin/config-meta');
    if (meta.ok && meta.data.sections) {
      window.CONFIG_SECTIONS = meta.data.sections;
      makeTabs(meta.data.sections);
    } else {
      document.getElementById('config-content').innerHTML = '<p style="color:var(--text2)">无法加载配置</p>';
    }
  }
}

function renderConfigSection(sectionKey, sections, config) {
  const section = sections.find(function(s) { return s.key === sectionKey; });
  if (!section) return;
  const content = document.getElementById('config-content');
  const descMap = {
    feishu: '配置飞书应用凭证以启用飞书渠道消息收发。仅需填写App ID和App Secret，长连接将自动配置。',
    wecom: '配置企业微信应用凭证。仅需填写企业ID、应用ID和Secret，消息回调将自动配置。',
    llm: '配置LiteLLM代理地址和模型。支持配置多个模型并设置优先级，当主模型不可用时自动切换到备用模型。',
    embedding: '配置向量嵌入模型。deterministic模式无需外部服务，provider模式需配置外部嵌入服务。',
    rerank: '配置Rerank重排序模型。deterministic模式使用向量相似度排序，provider模式使用专业Rerank服务。'
  };

  if (sectionKey === 'llm') {
    renderLLMConfigSection(content, section, config, descMap.llm);
    return;
  }

  let html = '<div class="card"><h3>' + escapeHtml(section.label) + '</h3>';
  if (descMap[sectionKey]) html += '<p class="section-desc">' + descMap[sectionKey] + '</p>';
  section.fields.forEach(function(f) {
    const val = config[f.key] || f.default || '';
    const displayVal = f.sensitive ? '****' : escapeHtml(val);
    if (f.type === 'select') {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><select id="cfg-' + f.key + '">' + (f.options || []).map(function(o) { return '<option value="' + o + '" ' + (val === o ? 'selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div>';
    } else {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><input type="' + f.type + '" id="cfg-' + f.key + '" value="' + displayVal + '" ' + (f.sensitive ? 'placeholder="留空则不修改"' : '') + '></div>';
    }
  });
  html += '<button class="btn btn-primary" onclick="saveConfigSection(\'' + sectionKey + '\')">保存配置</button></div>';
  content.innerHTML = html;
}

async function renderLLMConfigSection(content, section, config, desc) {
  let html = '<div class="card"><h3>LLM 模型配置</h3>';
  html += '<p class="section-desc">' + desc + '</p>';
  html += '<div class="form-group"><label>LiteLLM 代理地址</label><input type="text" id="cfg-LITELLM_URL" value="' + escapeHtml(config.LITELLM_URL || 'http://localhost:4000') + '" placeholder="LiteLLM代理地址"></div>';
  html += '<div class="form-group"><label>Master Key</label><input type="password" id="cfg-LITELLM_MASTER_KEY" value="' + (config.LITELLM_MASTER_KEY ? '****' : '') + '" placeholder="留空则不修改"></div>';
  html += '<button class="btn btn-primary" onclick="saveConfigSection(\'llm\')">保存基础配置</button></div>';

  html += '<div class="card"><h3>模型列表与优先级</h3>';
  html += '<p class="section-desc">排列在第一位的模型为主模型，其余为备用模型。当主模型不可用时，系统将按优先级顺序自动切换到备用模型。</p>';
  html += '<div id="llm-models-list">加载中...</div>';
  html += '<div style="margin-top:16px"><button class="btn btn-primary" onclick="showAddLLMModel()">添加模型</button></div></div>';

  content.innerHTML = html;
  await loadLLMModels();
}

async function loadLLMModels() {
  let el = document.getElementById('llm-models-list');
  if (!el) return;
  const r = await api('/api/admin/llm-models');
  if (!r.ok || !r.data.models) {
    el.innerHTML = '<p style="color:var(--text2)">无法加载模型列表</p>';
    return;
  }
  const models = r.data.models;
  if (models.length === 0) {
    el.innerHTML = emptyState('🤖', '暂无模型配置', '添加第一个LLM模型', '<button class="btn btn-primary" onclick="showAddLLMModel()">添加模型</button>');
    return;
  }
  let html = '<table><tr><th>优先级</th><th>模型名称</th><th>类型</th><th>地址</th><th>操作</th></tr>';
  models.forEach(function(m, i) {
    const typeLabel = i === 0 ? '<span class="badge badge-success">主模型</span>' : '<span class="badge badge-warning">备用 #' + i + '</span>';
    html += '<tr><td>' +
      (i > 0 ? '<button class="btn btn-sm btn-outline" onclick="moveLLMModelUp(\'' + escJsAttr(m.id) + '\')" title="上移优先级">▲</button> ' : '') +
      (i < models.length - 1 ? '<button class="btn btn-sm btn-outline" onclick="moveLLMModelDown(\'' + escJsAttr(m.id) + '\')" title="下移优先级">▼</button>' : '') +
      '</td><td><strong>' + escapeHtml(m.name) + '</strong></td><td>' + typeLabel + '</td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(m.url || '-') + '</td><td>' +
      (i > 0 ? '<button class="btn btn-sm btn-danger" onclick="deleteLLMModel(\'' + escJsAttr(m.id) + '\',\'' + escJsAttr(m.name) + '\')">删除</button>' : '<span class="hint-text">主模型不可删除</span>') +
      '</td></tr>';
  });
  html += '</table>';
  el.innerHTML = html;
}

function showAddLLMModel() {
  const body = '<div class="form-group"><label>模型名称 *</label><input type="text" id="new-llm-model-name" placeholder="例如: gpt-4o, claude-3.5-sonnet, qwen-max"></div>' +
    '<div class="form-group"><label>API 地址</label><input type="text" id="new-llm-model-url" placeholder="留空则使用上方配置的LiteLLM地址"></div>' +
    '<div class="form-group"><label>API Key</label><input type="password" id="new-llm-model-key" placeholder="留空则使用上方配置的Master Key"></div>' +
    '<div class="form-group"><label>Max Tokens</label><input type="number" id="new-llm-model-max-tokens" placeholder="例如: 4096 (可选)"></div>' +
    '<div class="form-group"><label>Temperature</label><input type="number" id="new-llm-model-temp" step="0.1" min="0" max="2" placeholder="例如: 0.7 (可选)"></div>' +
    '<button class="btn btn-primary" onclick="doAddLLMModel()">添加</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>';
  showModal('添加LLM模型', body);
}

async function doAddLLMModel() {
  const name = document.getElementById('new-llm-model-name').value.trim();
  if (!name) { showToast('请输入模型名称', 'error'); return; }
  const body = { name: name };
  const url = document.getElementById('new-llm-model-url').value.trim();
  if (url) body.url = url;
  const key = document.getElementById('new-llm-model-key').value.trim();
  if (key) body.api_key = key;
  const maxTokens = document.getElementById('new-llm-model-max-tokens').value.trim();
  if (maxTokens) body.max_tokens = parseInt(maxTokens, 10);
  const temp = document.getElementById('new-llm-model-temp').value.trim();
  if (temp) body.temperature = parseFloat(temp);
  const r = await api('/api/admin/llm-models', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) { showToast('模型已添加'); closeModal(); await loadLLMModels(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || '添加失败', 'error'); }
}

async function deleteLLMModel(modelId, modelName) {
  if (!confirm('确定要删除模型 "' + modelName + '" 吗？')) return;
  const r = await api('/api/admin/llm-models/' + modelId, { method: 'DELETE' });
  if (r.ok) { showToast('模型已删除'); await loadLLMModels(); }
  else { showToast((r.data && r.data.error) || '删除失败', 'error'); }
}

async function moveLLMModelUp(modelId) {
  const r = await api('/api/admin/llm-models');
  if (!r.ok || !r.data.models) return;
  const models = r.data.models;
  const idx = models.findIndex(function(m) { return m.id === modelId; });
  if (idx <= 0) return;
  const order = models.map(function(m) { return m.id; });
  order.splice(idx - 1, 2, order[idx], order[idx - 1]);
  const reorderR = await api('/api/admin/llm-models/reorder', { method: 'POST', body: JSON.stringify({ order: order }) });
  if (reorderR.ok) { showToast('优先级已调整'); await loadLLMModels(); }
}

async function moveLLMModelDown(modelId) {
  const r = await api('/api/admin/llm-models');
  if (!r.ok || !r.data.models) return;
  const models = r.data.models;
  const idx = models.findIndex(function(m) { return m.id === modelId; });
  if (idx < 0 || idx >= models.length - 1) return;
  const order = models.map(function(m) { return m.id; });
  order.splice(idx, 2, order[idx + 1], order[idx]);
  const reorderR = await api('/api/admin/llm-models/reorder', { method: 'POST', body: JSON.stringify({ order: order }) });
  if (reorderR.ok) { showToast('优先级已调整'); await loadLLMModels(); }
}

async function saveConfigSection(sectionKey) {
  const r = await api('/api/admin/config-meta');
  if (!r.ok) { showToast('无法获取配置元数据', 'error'); return; }
  const sections = r.data.sections || [];
  const section = sections.find(function(s) { return s.key === sectionKey; });
  if (!section) return;
  const updates = {};
  section.fields.forEach(function(f) {
    let el = document.getElementById('cfg-' + f.key);
    if (el) {
      let val = el.value.trim();
      if (f.sensitive && val === '****') return;
      if (val) updates[f.key] = val;
    }
  });
  const res = await api('/api/admin/config', { method: 'POST', body: JSON.stringify(updates) });
  if (res.ok) showToast('配置已保存，部分配置需重启生效'); else showToast((res.data && res.data.error) || '保存失败', 'error');
}

async function renderUsers(el) {
  el.innerHTML = '<div class="page-header"><h2>用户管理</h2><button class="btn btn-primary" onclick="showAddUser()">新增用户</button></div><div class="card"><div id="user-list">加载中...</div></div>';
  const r = await api('/api/users');
  if (r.ok && r.data.users) {
    document.getElementById('user-list').innerHTML = '<table><tr><th>用户名</th><th>角色</th><th>状态</th><th>组织</th><th>操作</th></tr>' + r.data.users.map(function(u) { return '<tr><td>' + escapeHtml(u.username) + '</td><td>' + escapeHtml(u.role) + '</td><td>' + statusBadge(u.status) + '</td><td>' + escapeHtml(u.org_id || '-') + '</td><td><button class="btn btn-sm btn-outline" onclick="showAssignOrg(\'' + escJsAttr(u.username) + '\',\'' + escJsAttr(String(u.org_id || '')) + '\')">分配组织</button></td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('user-list').innerHTML = emptyState('⚠️', '无法加载用户列表', '请检查服务状态', '<button class="btn btn-primary" onclick="renderView()">重试</button>');
  }
}

async function showAssignOrg(username, currentOrgId) {
  const r = await api('/api/admin/organizations');
  const orgs = (r.ok && r.data.organizations) ? r.data.organizations : [];
  const body = '<div class="form-group"><label>用户: ' + escapeHtml(username) + '</label></div>' +
    '<div class="form-group"><label>选择组织</label><select id="assign-org-id"><option value="">无组织</option>' +
    orgs.map(function(o) { return '<option value="' + escapeHtml(o.id) + '"' + (String(o.id) === currentOrgId ? ' selected' : '') + '>' + escapeHtml(o.display_name || o.org_name) + '</option>'; }).join('') +
    '</select></div><button class="btn btn-primary" onclick="doAssignOrg(\'' + escJsAttr(username) + '\')">确认分配</button>';
  showModal('分配组织', body);
}

async function doAssignOrg(username) {
  const orgId = document.getElementById('assign-org-id').value;
  const r = await api('/api/admin/users-orgs', { method: 'PUT', body: JSON.stringify({ user_id: username, org_id: orgId }) });
  if (r.ok) { showToast('组织分配成功'); closeModal(); renderView(); }
  else { showToast((r.data && r.data.error) || '分配失败', 'error'); }
}

function showAddUser() {
  const body = '<div class="form-group"><label>用户名</label><input type="text" id="new-user-name" placeholder="请输入用户名"></div>' +
    '<div class="form-group"><label>密码</label><input type="password" id="new-user-pass" placeholder="至少8位，包含大小写字母、数字" oninput="updateNewUserPwdStrength()"></div>' +
    '<div id="new-user-pwd-strength"></div>' +
    '<div class="form-group"><label>角色</label><select id="new-user-role"><option value="user">user</option><option value="admin">admin</option></select></div>' +
    '<button class="btn btn-primary" onclick="doAddUser()">创建</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>';
  showModal('新增用户', body);
}

function updateNewUserPwdStrength() {
  let el = document.getElementById('new-user-pass');
  const strengthEl = document.getElementById('new-user-pwd-strength');
  if (!el || !strengthEl) return;
  const pwd = el.value;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[a-z]/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;
  const msg = score < 3 ? '弱' : score < 5 ? '中' : '强';
  strengthEl.innerHTML = passwordStrengthHtml(score) + '<span class="hint-text">密码强度: ' + msg + '</span>';
}

async function doAddUser() {
  const username = document.getElementById('new-user-name').value.trim();
  const password = document.getElementById('new-user-pass').value;
  const role = document.getElementById('new-user-role').value || 'user';
  if (!username || !password) { showToast('请填写完整信息', 'error'); return; }
  if (password.length < 8) { showToast('密码长度至少8位', 'error'); return; }
  const r = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  if (r.ok) { showToast('用户已创建'); closeModal(); renderView(); } else showToast((r.data && r.data.error) || (r.data && r.data.message) || '创建失败', 'error');
}

async function renderOrganizations(el) {
  el.innerHTML = '<div class="page-header"><h2>组织管理</h2><button class="btn btn-primary" onclick="showAddOrg()">创建组织</button></div><div class="card"><div id="org-list">加载中...</div></div><div id="org-editor" class="hidden"></div>';
  const r = await api('/api/admin/organizations');
  if (r.ok && r.data.organizations) {
    document.getElementById('org-list').innerHTML = '<table><tr><th>名称</th><th>显示名称</th><th>状态</th><th>配额</th><th>创建时间</th><th>操作</th></tr>' + r.data.organizations.map(function(o) {
      const settings = o.settings || {};
      const quotaInfo = '用户上限: ' + (settings.max_users || '-') + ' / Workflow/天: ' + (settings.max_workflows_per_day || '-');
      const statusClass = o.status === 'active' ? 'badge-success' : o.status === 'suspended' ? 'badge-warning' : 'badge-danger';
      return '<tr><td>' + escapeHtml(o.org_name) + '</td><td>' + escapeHtml(o.display_name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(o.status) + '</span></td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(quotaInfo) + '</td><td>' + escapeHtml(o.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="showEditOrg(\'' + escJsAttr(String(o.id)) + '\')">编辑</button> <button class="btn btn-sm btn-danger" onclick="deleteOrg(\'' + escJsAttr(String(o.id)) + '\',\'' + escJsAttr(o.org_name) + '\')">删除</button></td></tr>';
    }).join('') + '</table>';
  } else {
    document.getElementById('org-list').innerHTML = emptyState('🏢', '暂无组织', '创建第一个组织开始使用系统', '<button class="btn btn-primary" onclick="showAddOrg()">创建组织</button>');
  }
}

function showAddOrg() {
  const body = '<div class="form-group"><label>组织名称</label><input type="text" id="new-org-name" placeholder="请输入组织名称"></div>' +
    '<div class="form-group"><label>显示名称</label><input type="text" id="new-org-display" placeholder="请输入显示名称"></div>' +
    '<button class="btn btn-primary" onclick="doAddOrg()">创建</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>';
  showModal('创建组织', body);
}

async function doAddOrg() {
  const org_name = document.getElementById('new-org-name').value.trim();
  const display_name = document.getElementById('new-org-display').value.trim();
  if (!org_name) { showToast('请输入组织名称', 'error'); return; }
  const r = await api('/api/admin/organizations', { method: 'POST', body: JSON.stringify({ org_name, display_name }) });
  if (r.ok) { showToast('组织已创建'); closeModal(); renderView(); } else showToast((r.data && r.data.error) || '创建失败', 'error');
}

async function showEditOrg(orgId) {
  const r = await api('/api/admin/organizations/' + orgId);
  if (!r.ok) { showToast('无法加载组织信息', 'error'); return; }
  const org = r.data.organization;
  const settings = org.settings || {};
  const body = '<div class="form-group"><label>显示名称</label><input type="text" id="edit-org-display" value="' + escapeHtml(org.display_name || '') + '"></div>' +
    '<div class="form-group"><label>状态</label><select id="edit-org-status"><option value="active"' + (org.status === 'active' ? ' selected' : '') + '>active</option><option value="suspended"' + (org.status === 'suspended' ? ' selected' : '') + '>suspended</option><option value="deleted"' + (org.status === 'deleted' ? ' selected' : '') + '>deleted</option></select></div>' +
    '<h4 style="margin-top:16px;margin-bottom:8px;color:var(--text2);font-size:14px">资源配额</h4>' +
    '<div class="form-group"><label>用户上限</label><input type="number" id="edit-org-max-users" value="' + (settings.max_users || 100) + '" min="1"></div>' +
    '<div class="form-group"><label>每日 Workflow 上限</label><input type="number" id="edit-org-max-wf" value="' + (settings.max_workflows_per_day || 500) + '" min="0"></div>' +
    '<button class="btn btn-primary" onclick="doEditOrg(\'' + escJsAttr(String(orgId)) + '\')">保存修改</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>';
  showModal('编辑组织: ' + org.org_name, body);
}

async function doEditOrg(orgId) {
  const displayName = document.getElementById('edit-org-display').value.trim();
  const status = document.getElementById('edit-org-status').value;
  const maxUsers = parseInt(document.getElementById('edit-org-max-users').value || '0', 10);
  const maxWf = parseInt(document.getElementById('edit-org-max-wf').value || '0', 10);
  const settings = { max_users: maxUsers, max_workflows_per_day: maxWf };
  const body = {};
  if (displayName !== undefined) body.display_name = displayName;
  if (status) body.status = status;
  body.settings = settings;
  const r = await api('/api/admin/organizations/' + orgId, { method: 'PUT', body: JSON.stringify(body) });
  if (r.ok) { showToast('组织已更新'); closeModal(); renderView(); }
  else showToast((r.data && r.data.error) || '更新失败', 'error');
}

async function deleteOrg(orgId, orgName) {
  if (!confirm('确定要删除组织 "' + orgName + '" 吗？此操作将软删除该组织，所有关联用户将无法登录。')) return;
  const r = await api('/api/admin/organizations/' + orgId, { method: 'DELETE' });
  if (r.ok) { showToast('组织已删除'); renderView(); }
  else showToast((r.data && r.data.error) || '删除失败', 'error');
}

async function renderSharedKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>共享知识库</h2><span style="color:var(--text2);font-size:14px">此文件夹中的内容默认对所有租户开放</span></div>' +
    '<div class="card"><h3>上传共享文档</h3>' +
    '<div class="form-group"><label>标题</label><input type="text" id="shared-title" placeholder="文档标题"></div>' +
    '<div class="form-group"><label>内容</label><textarea id="shared-content" style="min-height:160px" placeholder="文档内容..."></textarea></div>' +
    '<div class="form-group"><label>来源类型</label><select id="shared-source"><option value="manual">手动输入</option><option value="template">配置模板</option><option value="guide">操作指南</option><option value="reference">参考文档</option></select></div>' +
    '<button class="btn btn-primary" onclick="doUploadShared()">上传到共享库</button></div>' +
    '<div class="card"><h3>已共享文档列表</h3><div id="shared-list">加载中...</div></div>';
  await loadSharedDocs();
}

async function loadSharedDocs() {
  let el = document.getElementById('shared-list');
  if (!el) return;
  const r = await api('/api/admin/shared-knowledge');
  if (r.ok && r.data.documents) {
    if (r.data.documents.length === 0) {
      el.innerHTML = emptyState('📚', '暂无共享文档', '上传第一个共享文档');
    } else {
      el.innerHTML = '<table><tr><th>标题</th><th>类型</th><th>创建时间</th><th>操作</th></tr>' +
        r.data.documents.map(function(d) { return '<tr><td>' + escapeHtml(d.title) + '</td><td>' + escapeHtml(d.source_kind || '-') + '</td><td>' + escapeHtml(d.created_at || '-') + '</td><td><button class="btn btn-sm btn-danger" onclick="deleteSharedDoc(\'' + escJsAttr(String(d.id)) + '\')">移除</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法加载共享文档</p>';
  }
}

async function doUploadShared() {
  const title = document.getElementById('shared-title').value.trim();
  const content = document.getElementById('shared-content').value.trim();
  const sourceKind = document.getElementById('shared-source').value || 'manual';
  if (!content) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/admin/shared-knowledge', { method: 'POST', body: JSON.stringify({ title: title || 'Shared Doc', content, source_kind: sourceKind }) });
  if (r.ok) {
    showToast('共享文档已上传');
    document.getElementById('shared-title').value = '';
    document.getElementById('shared-content').value = '';
    await loadSharedDocs();
  } else {
    showToast((r.data && r.data.error) || '上传失败', 'error');
  }
}

async function deleteSharedDoc(docId) {
  if (!confirm('确定要移除该共享文档吗？')) return;
  const r = await api('/api/admin/shared-knowledge/' + docId, { method: 'DELETE' });
  if (r.ok) { showToast('已移除'); await loadSharedDocs(); }
  else showToast((r.data && r.data.error) || '移除失败', 'error');
}

async function renderOrgTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>任务分发</h2><button class="btn btn-primary" onclick="showAddOrgTask()">创建新任务</button></div>' +
    '<div class="card" id="org-task-create" style="display:none"><h3>创建组织任务</h3>' +
    '<div class="form-group"><label>任务标题 *</label><input type="text" id="ot-title" placeholder="例如: 每日拜访总结"></div>' +
    '<div class="form-group"><label>描述</label><textarea id="ot-desc" placeholder="任务说明..."></textarea></div>' +
    '<div class="form-group"><label>任务类型</label><select id="ot-type"><option value="form">表单收集</option><option value="workflow">工作流</option><option value="heartbeat">心跳检测</option></select></div>' +
    '<div class="form-group"><label>调度方式</label><select id="ot-schedule" onchange="document.getElementById(\'ot-cron-row\').style.display=this.value===\'cron\'?\'block\':\'none\'"><option value="daily">每日</option><option value="weekly">每周</option><option value="once">单次</option><option value="cron">Cron表达式</option></select></div>' +
    '<div class="form-group" id="ot-cron-row" style="display:none"><label>Cron表达式</label><input type="text" id="ot-cron" value="0 20 * * *" placeholder="0 20 * * * (=每天20:00)"><span class="hint-text">例: 0 20 * * * = 每天8PM</span></div>' +
    '<div class="form-group"><label>提醒消息</label><textarea id="ot-prompt" placeholder="发送给用户的提示文字...">请提交您的每日拜访工作总结:</textarea></div>' +
    '<div class="form-group"><label>目标范围</label><select id="ot-org"><option value="">全部组织</option></select></div>' +
    '<div class="form-group"><label>通知渠道</label><div style="display:flex;gap:8px"><label><input type="checkbox" id="ot-ch-wecom" checked> 企业微信</label></div></div>' +
    '<button class="btn btn-primary" onclick="doCreateOrgTask()">创建并分发</button> <button class="btn btn-outline" onclick="document.getElementById(\'org-task-create\').style.display=\'none\'">取消</button></div>' +
    '<div class="card"><h3>已有任务</h3><div id="org-task-list">加载中...</div></div>';
  await loadOrgListForTask();
  await loadOrgTasks();
}

async function loadOrgListForTask() {
  const r = await api('/api/admin/organizations');
  const sel = document.getElementById('ot-org');
  if (!sel || !r.ok) return;
  const orgs = r.data.organizations || [];
  sel.innerHTML = '<option value="">全部组织</option>' + orgs.map(function(o) { return '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.display_name || o.org_name) + '</option>'; }).join('');
}

async function loadOrgTasks() {
  let el = document.getElementById('org-task-list');
  if (!el) return;
  const r = await api('/api/admin/tasks');
  if (r.ok && r.data.tasks) {
    const tasks = r.data.tasks;
    if (tasks.length === 0) {
      el.innerHTML = emptyState('📋', '暂无任务', '创建第一个组织任务');
    } else {
      el.innerHTML = '<table><tr><th>标题</th><th>类型</th><th>调度</th><th>状态</th><th>创建时间</th><th>操作</th></tr>' +
        tasks.map(function(t) {
          const stats = t.assignment_stats || [];
          const completed = stats.filter(function(s) { return s.status === 'completed'; }).length;
          const total = stats.length;
          return '<tr><td><strong>' + escapeHtml(t.title) + '</strong></td><td>' + escapeHtml(t.task_type) + '</td><td>' + escapeHtml(t.schedule_type) + (t.cron_expression ? ' (' + escapeHtml(t.cron_expression) + ')' : '') + '</td><td>' + escapeHtml(t.status) + (total > 0 ? ' <span style="font-size:12px;color:var(--text2)">(' + completed + '/' + total + ' 完成)</span>' : '') + '</td><td>' + escapeHtml((t.created_at && t.created_at.slice(0, 10)) || '-') + '</td><td>' +
            '<button class="btn btn-sm btn-primary" onclick="triggerOrgTask(\'' + escJsAttr(String(t.id)) + '\')">立即分发</button> ' +
            (t.status === 'active' ? '<button class="btn btn-sm btn-warning" onclick="pauseOrgTask(\'' + escJsAttr(String(t.id)) + '\')">暂停</button>' : '') +
            ' <button class="btn btn-sm btn-danger" onclick="archiveOrgTask(\'' + escJsAttr(String(t.id)) + '\')">归档</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载任务', '请检查服务状态');
  }
}

function showAddOrgTask() { document.getElementById('org-task-create').style.display = 'block'; }

async function doCreateOrgTask() {
  const title = document.getElementById('ot-title').value.trim();
  if (!title) { showToast('请输入标题', 'error'); return; }
  const body = {
    title,
    description: document.getElementById('ot-desc').value || '',
    task_type: document.getElementById('ot-type').value || 'form',
    schedule_type: document.getElementById('ot-schedule').value || 'daily',
    prompt_message: document.getElementById('ot-prompt').value || '',
    required_fields: ['summary'],
    target_channels: ['wecom'],
    org_id: document.getElementById('ot-org').value || null,
    cron_expression: document.getElementById('ot-cron').value || '0 20 * * *',
  };
  const r = await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    showToast('任务已创建');
    document.getElementById('org-task-create').style.display = 'none';
    document.getElementById('ot-title').value = '';
    await loadOrgTasks();
  } else showToast((r.data && r.data.error) || '创建失败', 'error');
}

async function triggerOrgTask(taskId) {
  if (!confirm('确定立即分发此任务到所有用户吗？')) return;
  const r1 = await api('/internal/tasks/assign', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  const r2 = await api('/internal/tasks/notify', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  if (!r1.ok && !r2.ok) { showToast('分发失败', 'error'); return; }
  showToast('已分发 ' + ((r1.data && r1.data.assigned) || 0) + ' 人, 已通知 ' + ((r2.data && r2.data.notified) || 0) + ' 人');
  await loadOrgTasks();
}

async function pauseOrgTask(taskId) {
  const r = await api('/api/admin/tasks/' + taskId, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) });
  if (r.ok) { showToast('已暂停'); } else { showToast((r.data && r.data.error) || '暂停失败', 'error'); }
  await loadOrgTasks();
}

async function archiveOrgTask(taskId) {
  if (!confirm('确定归档此任务吗？')) return;
  const r = await api('/api/admin/tasks/' + taskId, { method: 'DELETE' });
  if (r.ok) { showToast('已归档'); } else { showToast((r.data && r.data.error) || '归档失败', 'error'); }
  await loadOrgTasks();
}

async function renderMyTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>我的任务</h2></div><div class="card"><div id="my-task-list">加载中...</div></div>';
  await loadMyTasks();
}

async function loadMyTasks() {
  let el = document.getElementById('my-task-list');
  if (!el) return;
  const r = await api('/api/tasks');
  if (r.ok && r.data.assignments) {
    const items = r.data.assignments;
    if (items.length === 0) {
      el.innerHTML = emptyState('📝', '暂无任务', '当前没有分配给您的任务');
    } else {
      el.innerHTML = items.map(function(a) {
        const completed = a.status === 'completed';
        const statusLabel = completed ? '✅ 已完成' : a.status === 'notified' ? '🔔 待反馈' : '⏳ 待通知';
        return '<div class="card" style="margin-bottom:12px"><h4>' + escapeHtml(a.title) + ' <span style="font-size:13px;color:var(--text2)">' + statusLabel + '</span></h4>' +
          '<p style="color:var(--text2);margin:4px 0">' + escapeHtml(a.prompt_message || '') + '</p>' +
          (completed
            ? '<p style="color:var(--success);font-size:13px">已于 ' + escapeHtml((a.completed_at && a.completed_at.slice(0, 16)) || '') + ' 提交</p>'
            : '<div class="form-group"><textarea id="task-resp-' + a.id + '" style="min-height:80px" placeholder="请输入您的总结..."></textarea></div>' +
              '<button class="btn btn-primary btn-sm" onclick="submitTaskResponse(\'' + escJsAttr(String(a.id)) + '\')">提交反馈</button>') +
          '</div>';
      }).join('');
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载任务', '请检查服务状态');
  }
}

async function submitTaskResponse(assignmentId) {
  const textarea = document.getElementById('task-resp-' + assignmentId);
  const summary = textarea.value.trim();
  if (!summary) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/tasks/' + assignmentId + '/submit', { method: 'POST', body: JSON.stringify({ summary }) });
  if (r.ok) { showToast('反馈已提交'); await renderView(); }
  else showToast((r.data && r.data.error) || '提交失败', 'error');
}

async function renderSkills(el) {
  el.innerHTML = '<div class="page-header"><h2>技能管理</h2><div><button class="btn btn-outline btn-sm" onclick="showSearchSkill()">搜索镜像站</button> <button class="btn btn-primary btn-sm" onclick="showAddSkill()">创建技能</button></div></div><div class="card"><p class="section-desc">技能管理用于创建、搜索和安装可复用的工作流模板。您可以从镜像站搜索并安装技能，也可以手动创建自定义技能。已安装的技能支持版本管理和更新。</p><div id="skill-list">加载中...</div></div>';
  const r = await api('/api/admin/skills');
  if (r.ok && r.data.skills) {
    const skills = r.data.skills;
    if (skills.length === 0) {
      document.getElementById('skill-list').innerHTML = emptyState('🔧', '暂无技能', '从镜像站搜索安装或手动创建技能', '<button class="btn btn-primary" onclick="showSearchSkill()">搜索镜像站</button> <button class="btn btn-outline" onclick="showAddSkill()">手动创建</button>');
    } else {
      document.getElementById('skill-list').innerHTML = '<table><tr><th>名称</th><th>类型</th><th>版本</th><th>状态</th><th>来源</th><th>操作</th></tr>' + skills.map(function(s) {
        const meta = s.metadata || {};
        const source = meta.installed_from ? '<span class="badge badge-info">镜像站</span>' : '<span class="badge badge-warning">手动创建</span>';
        return '<tr><td>' + escapeHtml(s.skill_name) + '</td><td>' + escapeHtml(s.skill_type || '-') + '</td><td>v' + escapeHtml(String(s.version || 1)) + '</td><td>' + statusBadge(s.status || 'active') + '</td><td>' + source + '</td><td><button class="btn btn-sm btn-outline" onclick="showSkillVersions(\'' + escJsAttr(String(s.id)) + '\')">版本</button> <button class="btn btn-sm btn-danger" onclick="archiveSkill(\'' + escJsAttr(String(s.id)) + '\',\'' + escJsAttr(s.skill_name) + '\')">归档</button></td></tr>';
      }).join('') + '</table>';
    }
  } else {
    document.getElementById('skill-list').innerHTML = emptyState('⚠️', '无法加载技能列表', '请检查技能库服务状态');
  }
}

async function archiveSkill(skillId, skillName) {
  if (!confirm('确定要归档技能 "' + skillName + '" 吗？')) return;
  const r = await api('/api/admin/skills/' + skillId, { method: 'PUT', body: JSON.stringify({ status: 'archived' }) });
  if (r.ok) { showToast('技能已归档'); renderView(); }
  else { showToast((r.data && r.data.error) || '归档失败', 'error'); }
}

function showSearchSkill() {
  const body = '<div class="form-group"><label>搜索关键词</label><input type="text" id="skill-search-query" placeholder="输入技能名称或关键词搜索镜像站"></div>' +
    '<button class="btn btn-primary" onclick="doSearchSkillMirror()">搜索镜像站</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>' +
    '<div id="skill-search-results" style="margin-top:16px"></div>';
  showModal('搜索镜像站', body);
}

async function doSearchSkillMirror() {
  const query = document.getElementById('skill-search-query').value.trim();
  if (!query) { showToast('请输入搜索关键词', 'error'); return; }
  let el = document.getElementById('skill-search-results');
  el.innerHTML = '<p style="color:var(--text2)">正在搜索镜像站...</p>';
  const r = await api('/api/admin/skills/mirror-search?query=' + encodeURIComponent(query));
  if (!r.ok || !r.data.skills) {
    el.innerHTML = '<p style="color:var(--text2)">搜索失败，请检查技能库服务状态</p>';
    return;
  }
  const results = r.data.skills;
  if (results.length === 0) {
    el.innerHTML = '<p style="color:var(--text2)">未找到匹配的技能，请尝试其他关键词</p>';
    return;
  }
  el.innerHTML = '<table><tr><th>名称</th><th>类型</th><th>描述</th><th>操作</th></tr>' + results.map(function(s) {
    return '<tr><td>' + escapeHtml(s.skill_name) + '</td><td>' + escapeHtml(s.skill_type || '-') + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml((s.description || '').substring(0, 80)) + '</td><td><button class="btn btn-sm btn-primary" onclick="doInstallSkill(\'' + escJsAttr(String(s.id)) + '\',\'' + escJsAttr(s.skill_name) + '\')">安装</button></td></tr>';
  }).join('') + '</table>';
}

async function doInstallSkill(skillId, skillName) {
  if (!confirm('确定要安装技能 "' + skillName + '" 吗？')) return;
  showToast('正在安装技能...');
  const r = await api('/api/admin/skills/mirror-install', { method: 'POST', body: JSON.stringify({ skill_id: skillId }) });
  if (r.ok) { showToast('技能 "' + skillName + '" 安装成功'); closeModal(); renderView(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || '安装失败', 'error'); }
}

async function showSkillVersions(skillId) {
  const r = await api('/api/admin/skills/' + encodeURIComponent(skillId));
  if (!r.ok || !r.data.skill) { showToast('无法获取技能信息', 'error'); return; }
  const skill = r.data.skill;
  const body = '<p>技能: ' + escapeHtml(skill.skill_name) + '</p><p>当前版本: v' + (skill.version || 1) + '</p><p>状态: ' + statusBadge(skill.status || 'active') + '</p>' +
    '<div style="margin-top:12px"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
  showModal('技能版本 - ' + skill.skill_name, body);
}

function showAddSkill() {
  const body = '<div class="form-group"><label>技能名称</label><input type="text" id="new-skill-name" placeholder="请输入技能名称"></div>' +
    '<div class="form-group"><label>类型</label><input type="text" id="new-skill-type" placeholder="例如: prompt, workflow"></div>' +
    '<div class="form-group"><label>描述</label><textarea id="new-skill-desc" placeholder="技能描述..."></textarea></div>' +
    '<div class="form-group"><label>定义 (JSON)</label><textarea id="new-skill-def">{}</textarea></div>' +
    '<button class="btn btn-primary" onclick="doAddSkill()">创建</button> <button class="btn btn-outline" onclick="closeModal()">取消</button>';
  showModal('创建技能', body);
}

async function doAddSkill() {
  const name = document.getElementById('new-skill-name').value.trim();
  const type = document.getElementById('new-skill-type').value.trim();
  const description = document.getElementById('new-skill-desc').value.trim();
  const definition = document.getElementById('new-skill-def').value.trim();
  if (!name) { showToast('请输入技能名称', 'error'); return; }
  let parsedDef = {};
  try { parsedDef = JSON.parse(definition || '{}'); } catch { showToast('定义JSON格式错误', 'error'); return; }
  const r = await api('/api/admin/skills', { method: 'POST', body: JSON.stringify({ name, type, description, definition: parsedDef }) });
  if (r.ok) { showToast('技能已创建'); closeModal(); renderView(); } else showToast((r.data && r.data.error) || '创建失败', 'error');
}

function renderKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>知识导入</h2></div>' +
    '<div class="card"><p class="section-desc">知识导入模块支持手动输入和文件上传两种方式。导入的知识将进入审核流程，管理员审核后正式收录。</p></div>' +
    '<div class="card"><h3>手动输入</h3>' +
    '<div class="form-group"><label>标题</label><input type="text" id="kb-title" placeholder="知识条目标题"></div>' +
    '<div class="form-group"><label>内容</label><textarea id="kb-content" style="min-height:200px" placeholder="输入知识内容，支持自然语言描述"></textarea></div>' +
    '<div class="form-group"><label>来源类型</label><select id="kb-source-type"><option value="manual">手动输入</option><option value="document">文档</option><option value="conversation">对话</option></select></div>' +
    '<div class="form-group"><label>可见范围</label><select id="kb-scope"><option value="private">私有 - 仅自己可见</option><option value="public">公开 - 组织内可见</option></select></div>' +
    '<div class="form-group"><label><input type="checkbox" id="kb-extract" checked> 自动抽取实体和关系</label></div>' +
    '<button class="btn btn-primary" onclick="doImportKnowledge()">导入</button></div>' +
    '<div class="card"><h3>文件上传</h3>' +
    '<div class="form-group"><label>选择文件</label><input type="file" id="kb-file" accept=".txt,.md,.pdf,.docx,.xlsx,.csv,.json" style="padding:8px"></div>' +
    '<p class="hint-text">支持 TXT、Markdown、PDF、Word、Excel、CSV、JSON 格式</p>' +
    '<button class="btn btn-outline" onclick="doUploadKnowledgeFile()">上传并导入</button></div>';
}

async function doImportKnowledge() {
  const title = document.getElementById('kb-title').value.trim();
  const content = document.getElementById('kb-content').value.trim();
  if (!content) { showToast('请输入内容', 'error'); return; }
  const r = await api('/api/knowledge/import', { method: 'POST', body: JSON.stringify({ title, content, source_type: document.getElementById('kb-source-type').value || 'manual', scope: document.getElementById('kb-scope').value || 'private', auto_extract: document.getElementById('kb-extract').checked }) });
  if (r.ok) { showToast('知识已导入，等待审核'); document.getElementById('kb-title').value = ''; document.getElementById('kb-content').value = ''; } else showToast((r.data && r.data.error) || '导入失败', 'error');
}

async function doUploadKnowledgeFile() {
  const fileInput = document.getElementById('kb-file');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) { showToast('请选择文件', 'error'); return; }
  const file = fileInput.files[0];
  const maxSize = 2 * 1024 * 1024;
  if (file.size > maxSize) { showToast('文件大小不能超过2MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = async function(e) {
    const content = e.target.result;
    const title = file.name.replace(/\.[^.]+$/, '');
    const r = await api('/api/knowledge/import', { method: 'POST', body: JSON.stringify({ title, content, source_type: 'document', scope: 'private', auto_extract: true }) });
    if (r.ok) { showToast('文件已导入，等待审核'); fileInput.value = ''; }
    else showToast((r.data && r.data.error) || '导入失败', 'error');
  };
  reader.onerror = function() { showToast('文件读取失败', 'error'); };
  reader.readAsText(file);
}

async function renderAudit(el) {
  el.innerHTML = '<div class="page-header"><h2>审计日志</h2><button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div><div class="card"><div id="audit-list">加载中...</div></div>';
  const r = await api('/api/admin/audit');
  if (r.ok && r.data.events) {
    document.getElementById('audit-list').innerHTML = '<table><tr><th>时间</th><th>操作</th><th>用户</th><th>详情</th></tr>' + r.data.events.map(function(e) { return '<tr><td>' + escapeHtml(e.occurred_at || '-') + '</td><td>' + escapeHtml(e.action) + '</td><td>' + escapeHtml(e.user_id || '-') + '</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(JSON.stringify(e.detail_json || {}).substring(0, 100)) + '</td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('audit-list').innerHTML = emptyState('📋', '暂无审计日志', '系统操作将自动记录在此');
  }
}

async function renderRetrieval(el) {
  el.innerHTML = '<div class="page-header"><h2>检索追踪</h2><button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div><div class="card"><div id="retrieval-list">加载中...</div></div>';
  const r = await api('/api/admin/retrieval-traces');
  if (r.ok && r.data.traces) {
    document.getElementById('retrieval-list').innerHTML = '<table><tr><th>时间</th><th>查询</th><th>结果数</th><th>降级</th></tr>' + r.data.traces.map(function(t) { return '<tr><td>' + escapeHtml(t.created_at || '-') + '</td><td>' + escapeHtml((t.query_text || '').substring(0, 50)) + '</td><td>' + escapeHtml(String(t.items_count || 0)) + '</td><td>' + (t.degraded ? '<span class="badge badge-warning">是</span>' : '<span class="badge badge-success">否</span>') + '</td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('retrieval-list').innerHTML = emptyState('🔍', '暂无检索追踪', '检索操作将自动记录在此');
  }
}

async function renderIdentities(el) {
  el.innerHTML = '<div class="page-header"><h2>身份绑定管理</h2><button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div>' +
    '<div class="card"><p class="section-desc">身份绑定用于将外部渠道（飞书、企业微信等）的用户身份与系统用户关联。绑定后，用户通过渠道发送的消息将自动识别并关联到系统账户。</p></div>' +
    '<div class="card"><h3>绑定列表</h3><div id="identity-list">加载中...</div></div>';
  const r = await api('/api/channels/identity');
  if (r.ok && r.data.identities) {
    const identities = r.data.identities;
    if (identities.length === 0) {
      document.getElementById('identity-list').innerHTML = emptyState('🔑', '暂无身份绑定', '用户通过渠道首次交互时将自动创建绑定记录');
    } else {
      document.getElementById('identity-list').innerHTML = '<table><tr><th>渠道</th><th>外部ID</th><th>状态</th><th>操作</th></tr>' + identities.map(function(i) { return '<tr><td>' + escapeHtml(i.channel_type) + '</td><td>' + escapeHtml(i.external_identity || '-') + '</td><td>' + statusBadge(i.binding_status) + '</td><td>' + (i.binding_status === 'pending' || i.binding_status === 'conflicted' ? '<button class="btn btn-sm btn-primary" onclick="rebindIdentity(\'' + escJsAttr(i.id) + '\')">绑定</button>' : '-') + '</td></tr>'; }).join('') + '</table>';
    }
  } else {
    document.getElementById('identity-list').innerHTML = emptyState('⚠️', '无法加载身份列表', '请检查网关服务状态');
  }
}

async function rebindIdentity(id) {
  const r = await api('/api/channels/identity/' + id + '/rebind', { method: 'POST' });
  if (r.ok) showToast('绑定成功'); else showToast((r.data && r.data.error) || '绑定失败', 'error');
  renderView();
}

async function renderDbMaint(el) {
  el.innerHTML = '<div class="page-header"><h2>数据库运维</h2></div><div class="card"><h3>数据库统计</h3><div id="db-stats">加载中...</div></div><div class="card"><h3>维护操作</h3><button class="btn btn-primary" onclick="dbMaintain(\'analyze\')" style="margin-right:8px">ANALYZE</button><button class="btn btn-outline" onclick="dbMaintain(\'checkpoint\')">CHECKPOINT</button></div>';
  const r = await api('/api/admin/db/stats');
  if (r.ok && r.data.stats) {
    const s = r.data.stats;
    document.getElementById('db-stats').innerHTML = '<p>连接数: ' + escapeHtml(String(s.connections || '-')) + '</p><p>数据库大小: ' + escapeHtml(s.db_size || '-') + '</p><p>表数量: ' + escapeHtml(String(s.table_count || '-')) + '</p>';
  } else {
    document.getElementById('db-stats').innerHTML = '<p style="color:var(--text2)">无法获取数据库统计</p>';
  }
}

async function dbMaintain(action) {
  const r = await api('/api/admin/db/maintenance', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) showToast('操作完成'); else showToast((r.data && r.data.error) || '操作失败', 'error');
}

async function doLogout() {
  const sid = localStorage.getItem('ah_session_id');
  if (sid) {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* best-effort */ }
  }
  localStorage.removeItem('ah_session_id');
  localStorage.removeItem('ah_username');
  currentSession = null;
  stopAllIntervals();
  renderLogin();
}

async function renderKnowledgeReview(el) {
  const statusFilter = currentStatusFilter || 'unconfirmed';
  el.innerHTML = '<div class="page-header"><h2>知识审核台</h2>' +
    '<div style="display:flex;gap:8px;">' +
    '<select id="status-filter" onchange="currentStatusFilter=this.value;renderView()"><option value="unconfirmed"' + (statusFilter === 'unconfirmed' ? ' selected' : '') + '>待审核</option><option value="active"' + (statusFilter === 'active' ? ' selected' : '') + '>已批准</option><option value="rejected"' + (statusFilter === 'rejected' ? ' selected' : '') + '>已拒绝</option></select>' +
    '<button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button></div></div>' +
    '<div class="card"><div id="review-item-list">加载中...</div></div>';

  await loadReviewItems(statusFilter);
}

async function loadReviewItems(status) {
  const list = document.getElementById('review-item-list');
  if (!list) return;

  try {
    const orgId = currentSession ? (currentSession.org_id || '') : '';
    const r = await api('/api/knowledge/review?org_id=' + encodeURIComponent(orgId) + '&status=' + encodeURIComponent(status) + '&limit=50');
    if (!r.ok || !r.data || !r.data.items) {
      list.innerHTML = emptyState('📚', '暂无' + (status === 'unconfirmed' ? '待审核' : status === 'active' ? '已批准' : '已拒绝') + '的知识条目', '');
      return;
    }

    const items = r.data.items;
    if (items.length === 0) {
      list.innerHTML = emptyState('📚', '暂无' + (status === 'unconfirmed' ? '待审核' : status === 'active' ? '已批准' : '已拒绝') + '的知识条目', '');
      return;
    }

    list.innerHTML = '<table><tr><th>编号</th><th>内容摘要</th><th>来源</th><th>提交时间</th><th>操作</th></tr>' +
      items.map(function(item) {
        let preview = (item.object_value || '').substring(0, 80) + ((item.object_value || '').length > 80 ? '...' : '');
        const sourceLabel = item.source === 'user_submitted' ? '用户提交' : (item.source || '系统');
        return '<tr><td>' + escapeHtml(String(item.fact_id || '').substring(0, 12)) + '</td>' +
          '<td>' + escapeHtml(preview) + '</td>' +
          '<td><span class="badge badge-info">' + escapeHtml(sourceLabel) + '</span></td>' +
          '<td style="font-size:13px">' + escapeHtml(String(item.created_at || '')) + '</td>' +
          '<td>' + (status === 'unconfirmed'
            ? '<button class="btn btn-sm btn-success" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'approve\')">批准</button> ' +
              '<button class="btn btn-sm btn-primary" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'approve_shared\')">共享</button> ' +
              '<button class="btn btn-sm btn-warning" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'return\')">退回</button> ' +
              '<button class="btn btn-sm btn-danger" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'reject\')">拒绝</button>'
            : '<span class="badge ' + (status === 'active' ? 'badge-success' : 'badge-danger') + '">' + status + '</span>') +
          '</td></tr>';
      }).join('') + '</table>';

    if (r.data.total > 50) {
      list.innerHTML += '<p class="hint-text">共 ' + r.data.total + ' 条，显示前 50 条</p>';
    }
  } catch {
    list.innerHTML = emptyState('⚠️', '加载失败', '请检查知识检索服务状态');
  }
}

async function reviewAction(factId, action) {
  const actions = {
    approve: '确认批准该知识条目为私有知识？',
    approve_shared: '确认批准并共享给全组织的用户？',
    return: '确认退回该条目，用户可重新编辑提交？',
    reject: '确认拒绝该知识条目？'
  };
  if (!confirm(actions[action] || '确认执行此操作？')) return;

  const r = await api('/api/knowledge/review', {
    method: 'POST',
    body: JSON.stringify({ fact_id: factId, action })
  });
  if (r.ok) {
    showToast('操作成功');
    renderView();
  } else {
    showToast((r.data && r.data.error) || '操作失败', 'error');
  }
}

async function renderResources(el) {
  el.innerHTML = '<div class="page-header"><h2>资源监控</h2><div><button class="btn btn-outline btn-sm" onclick="renderView()">刷新</button> <button class="btn btn-primary btn-sm" onclick="triggerInspection()">触发巡检</button></div></div>' +
    '<div class="stat-grid" id="quota-stats-grid"></div>' +
    '<div class="card"><h3>Docker 容器监控 <span id="container-stats-time" style="font-size:12px;color:var(--text2)"></span></h3><div id="container-stats">加载中...</div></div>' +
    '<div class="card"><h3>系统资源 <span id="docker-stats-time" style="font-size:12px;color:var(--text2)"></span></h3><div id="docker-stats">加载中...</div></div>' +
    '<div class="card"><h3>服务巡检报告</h3><div id="inspection-report">加载中...</div></div>' +
    '<div class="card"><h3>配额配置</h3><div id="quota-config">加载中...</div></div>';

  await loadQuotaStats();
  await loadDockerStats();
  await loadContainerStats();
  await loadInspectionReport();
  await loadQuotaConfig();
  startDockerStatsPolling();
  startContainerStatsPolling();
}

async function loadContainerStats() {
  let el = document.getElementById('container-stats');
  const timeEl = document.getElementById('container-stats-time');
  if (!el) return;
  const r = await api('/api/admin/container-stats');
  if (r.ok && r.data.docker_available && r.data.containers && r.data.containers.length > 0) {
    const containers = r.data.containers;
    el.innerHTML = '<table><tr><th>容器名</th><th>镜像</th><th>状态</th><th>CPU</th><th>内存</th><th>内存用量</th><th>网络I/O</th><th>磁盘I/O</th></tr>' +
      containers.map(function(c) {
        const statusClass = c.status && c.status.includes('Up') ? 'badge-success' : 'badge-danger';
        return '<tr><td>' + escapeHtml(c.name) + '</td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(c.image || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(c.status || '-') + '</span></td><td>' + escapeHtml(c.cpu_percent) + '</td><td>' + escapeHtml(c.memory_percent) + '</td><td style="font-size:13px">' + escapeHtml(c.memory_usage) + '</td><td style="font-size:13px">' + escapeHtml(c.net_io) + '</td><td style="font-size:13px">' + escapeHtml(c.block_io) + '</td></tr>';
      }).join('') + '</table>';
    if (timeEl) timeEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
  } else if (r.ok && !r.data.docker_available) {
    el.innerHTML = '<p style="color:var(--text2)">Docker 不可用或未检测到运行中的容器。请确保Docker服务正常运行且当前用户有Docker访问权限。</p>';
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法获取容器监控数据</p>';
  }
}

function startContainerStatsPolling() {
  if (containerStatsInterval) clearInterval(containerStatsInterval);
  containerStatsInterval = setInterval(async function() {
    let el = document.getElementById('container-stats');
    if (!el) { clearInterval(containerStatsInterval); return; }
    await loadContainerStats();
  }, 15000);
}

async function loadDockerStats() {
  let el = document.getElementById('docker-stats');
  const timeEl = document.getElementById('docker-stats-time');
  if (!el) return;
  const r = await api('/api/admin/docker-stats');
  if (r.ok && r.data.stats) {
    const s = r.data.stats;
    el.innerHTML = '<div class="stat-grid">' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.active_workflows || 0)) + '</div><div class="stat-label">活跃工作流</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.active_users || 0)) + '</div><div class="stat-label">活跃用户</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.total_documents || 0)) + '</div><div class="stat-label">文档总数</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.total_skills || 0)) + '</div><div class="stat-label">技能总数</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(s.db_size || '-') + '</div><div class="stat-label">数据库大小</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.db_connections || 0)) + '</div><div class="stat-label">数据库连接数</div></div>' +
      '</div>';
    if (timeEl) timeEl.textContent = '更新于 ' + new Date().toLocaleTimeString();
  } else {
    el.innerHTML = '<p style="color:var(--text2)">无法获取Docker资源数据，请确保数据库服务正常运行</p>';
  }
}

function startDockerStatsPolling() {
  if (dockerStatsInterval) clearInterval(dockerStatsInterval);
  dockerStatsInterval = setInterval(async function() {
    let el = document.getElementById('docker-stats');
    if (!el) { clearInterval(dockerStatsInterval); return; }
    await loadDockerStats();
  }, 15000);
}

async function loadQuotaStats() {
  const grid = document.getElementById('quota-stats-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="stat-card"><div class="stat-value">-</div><div class="stat-label">加载中...</div></div>';

  const r = await api('/api/admin/quotas');
  if (!r.ok || !r.data) {
    grid.innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">无法加载配额数据</div></div>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  const labelMap = {
    concurrent_workflows: '并发工作流',
    daily_api_calls: '每日API调用',
    retrieval_queries: '检索查询数',
    execution_seconds: '执行秒数',
    storage_bytes: '存储量(MB)',
    llm_tokens: 'LLM Tokens'
  };
  grid.innerHTML = Object.entries(quotas).map(function(_ref) { const k=_ref[0],v=_ref[1]; const q=v||{}; const limit=q.limit||q.max||'-'; const used=q.used||q.current||0; return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(used)) + ' / ' + escapeHtml(String(limit)) + '</div><div class="stat-label">' + escapeHtml(labelMap[k]||k) + '</div></div>'; }).join('');
}

async function loadInspectionReport() {
  const report = document.getElementById('inspection-report');
  if (!report) return;

  const r = await api('/api/admin/quotas/report');
  if (!r.ok || !r.data || !r.data.report) {
    report.innerHTML = '<p style="color:var(--text2)">暂无巡检报告，点击"触发巡检"生成</p>';
    return;
  }
  const data = r.data.report;
  const results = data.results || data.services || [];
  const inspectedAt = data.inspected_at || data.timestamp || '';
  if (results.length === 0) {
    report.innerHTML = '<p style="color:var(--text2)">暂无巡检数据</p>';
    return;
  }
  report.innerHTML = '<p class="hint-text" style="margin-bottom:8px">巡检时间: ' + escapeHtml(String(inspectedAt)) + '</p>' +
    '<table><tr><th>服务</th><th>健康状态</th><th>延迟(ms)</th><th>详情</th></tr>' +
    results.map(function(s) {
      const statusClass = s.healthy || s.status === 'healthy' ? 'badge-success' : 'badge-danger';
      const statusText = s.healthy || s.status === 'healthy' ? 'healthy' : (s.status || 'unhealthy');
      return '<tr><td>' + escapeHtml(s.service || s.name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(statusText) + '</span></td><td>' + escapeHtml(String(s.latency_ms || s.latency || '-')) + '</td><td style="font-size:13px">' + escapeHtml(String(s.error || s.detail || '-')) + '</td></tr>';
    }).join('') + '</table>';
}

async function loadQuotaConfig() {
  const config = document.getElementById('quota-config');
  if (!config) return;

  const r = await api('/api/admin/quotas');
  if (!r.ok) {
    config.innerHTML = '<p style="color:var(--text2)">无法加载配额配置</p>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  const dimensions = [
    { key: 'concurrent_workflows', label: '并发工作流上限' },
    { key: 'daily_api_calls', label: '每日API调用上限' },
    { key: 'retrieval_queries', label: '检索查询上限' },
    { key: 'execution_seconds', label: '执行时长上限(秒)' },
    { key: 'storage_bytes', label: '存储上限(字节)' },
    { key: 'llm_tokens', label: 'LLM Token上限' }
  ];
  config.innerHTML = dimensions.map(function(d) {
    const q = quotas[d.key] || {};
    const val = q.limit || q.max || '';
    return '<div class="form-group"><label>' + d.label + '</label><input type="number" id="quota-' + d.key + '" value="' + escapeHtml(String(val)) + '" placeholder="留空则不限制"></div>';
  }).join('') + '<button class="btn btn-primary" onclick="saveQuotaConfig()">保存配额配置</button>';
}

async function saveQuotaConfig() {
  const dimensions = ['concurrent_workflows', 'daily_api_calls', 'retrieval_queries', 'execution_seconds', 'storage_bytes', 'llm_tokens'];
  const quotas = {};
  dimensions.forEach(function(key) {
    let el = document.getElementById('quota-' + key);
    if (el && el.value) {
      quotas[key] = parseInt(el.value, 10);
    }
  });
  const r = await api('/api/admin/quotas', { method: 'POST', body: JSON.stringify({ quotas }) });
  if (r.ok) showToast('配额配置已保存'); else showToast((r.data && r.data.error) || '保存失败', 'error');
}

async function triggerInspection() {
  const r = await api('/api/admin/quotas/inspect', { method: 'POST' });
  if (r.ok) {
    showToast('巡检已触发，正在收集数据...');
    setTimeout(function() { renderView(); }, 3000);
  } else {
    showToast((r.data && r.data.error) || '触发失败', 'error');
  }
}

// ============================================================
// 梦境模式 UI 页面 (Dream Mode)
// ============================================================

async function renderDreamMemory(el) {
  el.innerHTML = '<div class="page-header"><h2>💤 记忆分析 - 梦境模式</h2></div>' +
    '<div class="card"><h3>记忆分析运行记录</h3><div id="dream-runs-list">加载中...</div></div>' +
    '<div class="card"><h3>组织级记忆汇总 <span style="font-size:12px;color:var(--text2)">(管理员可见)</span></h3><div id="dream-summary-list">加载中...</div></div>' +
    '<div class="card"><h3>记忆压缩日志</h3><div id="dream-compression-list">加载中...</div></div>' +
    '<div class="card"><h3>记忆访问日志</h3><div id="dream-access-list">加载中...</div></div>';
  await loadDreamRuns();
  await loadDreamSummaries();
  await loadDreamCompressions();
  await loadDreamAccessLog();
}

async function loadDreamRuns() {
  let el = document.getElementById('dream-runs-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/runs?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.runs) {
    const runs = r.data.runs;
    if (runs.length === 0) {
      el.innerHTML = emptyState('💤', '暂无梦境分析记录', '系统将在配置的时间自动运行梦境分析');
    } else {
      el.innerHTML = '<table><tr><th>时间</th><th>类型</th><th>状态</th><th>扫描项</th><th>压缩项</th><th>提取事实</th></tr>' +
        runs.map(function(run) {
          return '<tr><td>' + escapeHtml((run.created_at || '').slice(0, 16)) + '</td><td>' + statusBadge(run.run_type) + '</td><td>' + statusBadge(run.status) + '</td><td>' + (run.items_scanned || 0) + '</td><td>' + (run.items_compressed || 0) + '</td><td>' + (run.facts_generated || 0) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载分析记录', '请检查 hermes-adapter 服务状态');
  }
}

async function loadDreamSummaries() {
  let el = document.getElementById('dream-summary-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/summary?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.summaries) {
    const summaries = r.data.summaries;
    if (summaries.length === 0) {
      el.innerHTML = emptyState('📝', '暂无组织级整合记忆', '梦境分析运行后，提取的组织级知识将出现在此');
    } else {
      el.innerHTML = '<table><tr><th>标题</th><th>分类</th><th>内容</th><th>状态</th></tr>' +
        summaries.map(function(s) {
          return '<tr><td><strong>' + escapeHtml(s.title || '') + '</strong></td><td>' + statusBadge(s.category) + '</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml((s.content_text || '').substring(0, 150)) + '</td><td>' + statusBadge(s.status) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载记忆汇总', '请检查 hermes-adapter 服务状态');
  }
}

async function loadDreamCompressions() {
  let el = document.getElementById('dream-compression-list');
  const r = await api('/api/admin/dream/compressions');
  if (r.ok && r.data.logs) {
    const logs = r.data.logs;
    if (logs.length === 0) {
      el.innerHTML = emptyState('📦', '暂无记忆压缩记录', '当记忆条目超过字符阈值时将自动压缩');
    } else {
      el.innerHTML = '<table><tr><th>时间</th><th>原文字符</th><th>压缩后字符</th><th>压缩率</th><th>方法</th></tr>' +
        logs.map(function(l) {
          const ratio = l.original_char_count > 0 ? Math.round((1 - l.compressed_char_count / l.original_char_count) * 100) : 0;
          return '<tr><td>' + escapeHtml((l.created_at || '').slice(0, 16)) + '</td><td>' + (l.original_char_count || 0) + '</td><td>' + (l.compressed_char_count || 0) + '</td><td>' + ratio + '%</td><td>' + escapeHtml(l.compression_method || '') + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载压缩日志', '请检查 hermes-adapter 服务状态');
  }
}

async function loadDreamAccessLog() {
  let el = document.getElementById('dream-access-list');
  const r = await api('/api/admin/dream/access-log');
  if (r.ok && r.data.logs) {
    const logs = r.data.logs;
    if (logs.length === 0) {
      el.innerHTML = emptyState('🔒', '暂无记忆访问记录', '系统将自动记录所有记忆访问操作');
    } else {
      el.innerHTML = '<table><tr><th>时间</th><th>类型</th><th>访问</th><th>结果</th></tr>' +
        logs.map(function(l) {
          return '<tr><td>' + escapeHtml((l.created_at || '').slice(0, 16)) + '</td><td>' + escapeHtml(l.target_type || '') + '</td><td>' + escapeHtml(l.access_type || '') + '</td><td>' + (l.access_result === 'granted' ? '<span class="badge badge-success">允许</span>' : '<span class="badge badge-danger">拒绝</span>') + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载访问日志', '请检查 hermes-adapter 服务状态');
  }
}

async function renderDreamSkills(el) {
  el.innerHTML = '<div class="page-header"><h2>🔬 技能发现与管理</h2></div>' +
    '<div class="card"><h3>组织技能库</h3><div id="org-skills-list">加载中...</div></div>' +
    '<div class="card"><h3>技能审核记录</h3><div id="skill-audit-list">加载中...</div></div>' +
    '<div class="card"><h3>高价值场景识别</h3><div id="scene-assessment-list">加载中...</div></div>';
  await loadOrgSkills();
  await loadSkillAuditRecords();
  await loadSceneAssessments();
}

async function loadOrgSkills() {
  let el = document.getElementById('org-skills-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/org-skills?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.skills) {
    const skills = r.data.skills;
    if (skills.length === 0) {
      el.innerHTML = emptyState('🔧', '暂无组织级技能', '用户技能经审核后将自动升级为组织技能');
    } else {
      el.innerHTML = '<table><tr><th>技能名</th><th>类型</th><th>分类</th><th>安装数</th><th>评分</th><th>操作</th></tr>' +
        skills.map(function(s) {
          return '<tr><td><strong>' + escapeHtml(s.skill_name || '') + '</strong></td><td>' + escapeHtml(s.skill_type || '') + '</td><td>' + escapeHtml(s.category || '') + '</td><td>' + (s.install_count || 0) + '</td><td>' + (s.rating_avg ? Number(s.rating_avg).toFixed(1) + ' (' + s.rating_count + ')' : '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="showSkillUsage(\'' + escJsAttr(s.skill_id) + '\')">统计</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载组织技能', '请检查 skill-library 服务状态');
  }
}

async function showSkillUsage(skillId) {
  const r = await api('/api/admin/dream/skill-usage?skill_id=' + encodeURIComponent(skillId) + '&days=30');
  if (r.ok && r.data.aggregate) {
    const agg = r.data.aggregate;
    const msg = '近30天使用统计：\n调用次数: ' + (agg.total_invocations || 0) + '\n成功: ' + (agg.total_success || 0) + '\n失败: ' + (agg.total_failure || 0) + '\n最大日活: ' + (agg.max_users || 0);
    showToast(msg);
  } else {
    showToast('无法获取统计数据', 'error');
  }
}

async function loadSkillAuditRecords() {
  let el = document.getElementById('skill-audit-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/skill-audit-records?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.records) {
    const records = r.data.records;
    if (records.length === 0) {
      el.innerHTML = emptyState('📋', '暂无审核记录', '技能审核将在配置的时间自动运行');
    } else {
      el.innerHTML = '<table><tr><th>技能</th><th>类型</th><th>功能</th><th>安全</th><th>性能</th><th>适配</th><th>综合</th><th>结果</th></tr>' +
        records.map(function(rec) {
          return '<tr><td>' + escapeHtml(rec.skill_name || rec.skill_id || '') + '</td><td>' + escapeHtml(rec.audit_type || '') + '</td><td>' + (rec.functionality_score || 0) + '</td><td>' + (rec.security_score || 0) + '</td><td>' + (rec.performance_score || 0) + '</td><td>' + (rec.org_fit_score || 0) + '</td><td><strong>' + (rec.overall_score || 0) + '</strong></td><td>' + statusBadge(rec.audit_result) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载审核记录', '请检查 skill-library 服务状态');
  }
}

async function loadSceneAssessments() {
  let el = document.getElementById('scene-assessment-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/scenes?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.assessments) {
    const assessments = r.data.assessments;
    if (assessments.length === 0) {
      el.innerHTML = emptyState('🎯', '暂无场景识别记录', '系统将基于用户交互模式自动识别高价值场景');
    } else {
      el.innerHTML = '<table><tr><th>场景</th><th>使用</th><th>成功</th><th>价值分</th><th>状态</th></tr>' +
        assessments.map(function(a) {
          return '<tr><td><strong>' + escapeHtml(a.scene_name || '') + '</strong></td><td>' + (a.usage_count || 0) + '</td><td>' + (a.success_count || 0) + '</td><td><strong>' + (a.value_score || 0) + '</strong></td><td>' + statusBadge(a.status) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', '无法加载场景评估', '请检查 skill-library 服务状态');
  }
}

async function renderDreamConfig(el) {
  el.innerHTML = '<div class="page-header"><h2>⚙ 梦境模式配置</h2></div>' +
    '<div class="card"><h3>梦境调度配置</h3><div id="dream-config-form">加载中...</div></div>';
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/config?org_id=' + encodeURIComponent(orgId));
  const config = (r.ok && r.data.config) ? r.data.config : {};

  document.getElementById('dream-config-form').innerHTML =
    '<div class="form-group"><label>启用梦境模式</label><select id="dc-enabled"><option value="true"' + (config.enabled !== false ? ' selected' : '') + '>启用</option><option value="false"' + (config.enabled === false ? ' selected' : '') + '>禁用</option></select></div>' +
    '<div class="form-group"><label>触发方式</label><select id="dc-trigger"><option value="auto"' + (config.dream_user_trigger === 'auto' ? ' selected' : '') + '>自动（用户无活动2小时后）</option><option value="scheduled"' + (config.dream_user_trigger === 'scheduled' ? ' selected' : '') + '>定时（固定时间）</option></select></div>' +
    '<div class="form-group"><label>梦境分析时间（小时，0-23）</label><input type="number" id="dc-hour" value="' + (config.dream_scheduled_hour || 3) + '" min="0" max="23"><span class="hint-text">默认凌晨3点，建议避开业务高峰</span></div>' +
    '<div class="form-group"><label>冷却窗口（分钟）</label><input type="number" id="dc-cooling" value="' + (config.cooling_window_minutes || 120) + '" min="30"><span class="hint-text">用户最后一条消息后等待多久触发梦境</span></div>' +
    '<div class="form-group"><label>压缩字符阈值</label><input type="number" id="dc-threshold" value="' + (config.compression_threshold_chars || 4000) + '" min="500"><span class="hint-text">超过此字符数的记忆条目将被压缩</span></div>' +
    '<div class="form-group"><label>单次最大压缩数</label><input type="number" id="dc-max-compress" value="' + (config.max_compressions_per_run || 100) + '" min="1" max="500"></div>' +
    '<hr>' +
    '<div class="form-group"><label>启用技能审核</label><select id="dc-audit-enabled"><option value="true"' + (config.skill_audit_enabled !== false ? ' selected' : '') + '>启用</option><option value="false"' + (config.skill_audit_enabled === false ? ' selected' : '') + '>禁用</option></select></div>' +
    '<div class="form-group"><label>技能审核时间（小时）</label><input type="number" id="dc-audit-hour" value="' + (config.skill_audit_scheduled_hour || 5) + '" min="0" max="23"><span class="hint-text">建议在梦境分析之后，默认凌晨5点</span></div>' +
    '<div class="form-group"><label>自动提升阈值（分）</label><input type="number" id="dc-auto-promote" value="' + (config.auto_promote_threshold || 80) + '" min="0" max="100"><span class="hint-text">达到此分数的用户技能将自动提升为组织级</span></div>' +
    '<div class="form-group"><label>场景检测最低使用次数</label><input type="number" id="dc-min-usage" value="' + (config.min_usage_for_scene_detection || 3) + '" min="1" max="100"><span class="hint-text">场景被使用多少次后才纳入价值评估</span></div>' +
    '<button class="btn btn-primary" onclick="saveDreamConfig()">保存配置</button> ' +
    '<button class="btn btn-primary" onclick="triggerDreamManually()">手动触发梦境</button>';
}

async function saveDreamConfig() {
  const body = {
    enabled: document.getElementById('dc-enabled').value === 'true',
    dream_user_trigger: document.getElementById('dc-trigger').value,
    dream_scheduled_hour: Number(document.getElementById('dc-hour').value),
    cooling_window_minutes: Number(document.getElementById('dc-cooling').value),
    compression_threshold_chars: Number(document.getElementById('dc-threshold').value),
    max_compressions_per_run: Number(document.getElementById('dc-max-compress').value),
    skill_audit_enabled: document.getElementById('dc-audit-enabled').value === 'true',
    skill_audit_scheduled_hour: Number(document.getElementById('dc-audit-hour').value),
    auto_promote_threshold: Number(document.getElementById('dc-auto-promote').value),
    min_usage_for_scene_detection: Number(document.getElementById('dc-min-usage').value),
  };
  const r = await api('/api/admin/dream/config', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) showToast('梦境配置已保存'); else showToast('保存失败', 'error');
}

async function triggerDreamManually() {
  if (!confirm('确定立即为组织内活跃用户运行梦境分析吗？这将扫描所有用户今日的记忆条目并执行压缩与知识提取。')) return;
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  showToast('正在运行梦境分析...');
  const r = await api('/api/admin/dream/analyze-org', { method: 'POST', body: JSON.stringify({ org_id: orgId }) });
  if (r.ok) { showToast('组织级记忆分析完成！合并了 ' + (r.data.merged_to_org || 0) + ' 条组织知识'); } else { showToast('分析失败: ' + ((r.data && r.data.error) || '未知错误'), 'error'); }
}

async function initApp() {
  try {
    const isAuth = await checkAuth();
    if (!isAuth) {
      const setup = await checkSetup();
      if (setup && !setup.initialized) {
        renderSetupWizard(setup);
      } else {
        renderLogin();
      }
    } else {
      if (currentSession && currentSession.username) {
        localStorage.setItem('ah_username', currentSession.username);
      }
      renderApp();
    }
  } catch (e) {
    document.getElementById('app').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>应用加载失败</h3><p>请刷新页面重试</p><button class="btn btn-primary" onclick="location.reload()">刷新页面</button></div>';
  }
}

initApp();
