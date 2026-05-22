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
  const headers = { 'Content-Type': 'application/json', 'Accept-Language': LOCALE.lang === 'en' ? 'en' : 'zh-CN', ...(options.headers || {}) };
  if (sessionId) headers['x-session-id'] = sessionId;
  try {
    const res = await fetch(API_BASE + path, { ...options, headers });
    if (res.status === 401 && path !== '/api/auth/login') {
      localStorage.removeItem('ah_session_id');
      currentSession = null;
      stopAllIntervals();
      renderLogin();
      return { ok: false, status: 401, data: { error: 'session_expired', message: t('common.sessionExpired') } };
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
    showToast(t('common.networkError'), 'error');
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
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function escJsAttr(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\\/g,'\\\\')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/'/g,'\\x27')
    .replace(/"/g,'&quot;')
    .replace(/\n/g,'\\n')
    .replace(/\r/g,'\\r')
    .replace(/\u2028/g,'\\u2028')
    .replace(/\u2029/g,'\\u2029');
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

function langSwitchButton() {
  return '<button id="lang-switch" class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px" onclick="event.stopPropagation();setLang(LOCALE.lang===\'en\'?\'zh-CN\':\'en\')">' + (LOCALE.lang === 'en' ? '中文' : 'English') + '</button>';
}

async function refreshLocaleView() {
  closeModal();
  if (currentSession) {
    renderApp();
  } else if (window.__setupStatus) {
    const setup = await checkSetup();
    renderSetupWizard(setup || window.__setupStatus);
  } else {
    renderLogin();
  }
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
  window.__setupStatus = null;
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card"><div style="display:flex;justify-content:flex-end;margin-bottom:8px">'+langSwitchButton()+'</div><h1>JueYing</h1><p>'+t('login.subtitle')+'</p><div class="form-group"><label>'+t('login.username')+'</label><input type="text" id="login-user" value="admin" placeholder="'+t('login.placeholder_user')+'" autofocus></div><div class="form-group"><label>'+t('login.password')+'</label><input type="password" id="login-pass" value="admin" placeholder="'+t('login.placeholder_pass')+'"></div><button class="btn btn-primary" style="width:100%" onclick="doLogin()">'+t('login.btn')+'</button></div></div>';
  document.getElementById('login-user').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });
  document.getElementById('login-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) { showToast(t('login.enterCredentials'), 'error'); return; }
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (r.ok && r.data.session_id) {
    localStorage.setItem('ah_session_id', r.data.session_id);
    showToast(t('login.success'));
    if (r.data.must_change_password) {
      await initApp();
      showChangePasswordModal(true);
    } else {
      await initApp();
    }
  } else {
    showToast((r.data && r.data.message) || (r.data && r.data.error) || t('login.failed'), 'error');
  }
}

function showChangePasswordModal(isFirstLogin) {
  const title = isFirstLogin ? t('chpwd.firstLoginTitle') : t('chpwd.title');
  const body = '<div class="form-group"><label>'+t('chpwd.oldPass')+'</label><input type="password" id="cp-old" placeholder="'+t('chpwd.oldPassPlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('chpwd.newPass')+'</label><input type="password" id="cp-new" placeholder="'+t('chpwd.newPassPlaceholder')+'" oninput="updatePasswordStrength()"></div>' +
    '<div id="cp-strength"></div>' +
    '<div class="form-group"><label>'+t('chpwd.confirmPass')+'</label><input type="password" id="cp-confirm" placeholder="'+t('chpwd.confirmPassPlaceholder')+'"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn btn-primary" onclick="doChangePassword()">'+t('common.confirm')+'</button>' +
    (isFirstLogin ? '' : '<button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>') + '</div>';
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
  const msg = score < 3 ? t('common.weak') : score < 5 ? t('common.medium') : t('common.strong');
  strengthEl.innerHTML = passwordStrengthHtml(score) + '<span class="hint-text">' + t('common.pwdStrength') + msg + '</span>';
}

async function doChangePassword() {
  const oldPwd = document.getElementById('cp-old').value;
  const newPwd = document.getElementById('cp-new').value;
  const confirmPwd = document.getElementById('cp-confirm').value;
  if (!oldPwd || !newPwd) { showToast(t('common.pleaseEnter'), 'error'); return; }
  if (newPwd !== confirmPwd) { showToast(t('common.pwdMismatch'), 'error'); return; }
  if (newPwd.length < 8) { showToast(t('common.pwdTooShort'), 'error'); return; }
  const r = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }) });
  if (r.ok) { showToast(t('common.pwdChanged')); closeModal(); }
  else { showToast((r.data && r.data.message) || t('common.changeFailed'), 'error'); }
}

function renderSetupWizard(setupStatus) {
  window.__setupStatus = setupStatus;
  const steps = (setupStatus && setupStatus.steps) || [];
  const allDone = steps.every(function(s) { return s.done; });
  if (allDone) { initApp(); return; }
  const currentStep = steps.findIndex(function(s) { return !s.done; });
  document.getElementById('app').innerHTML = '<div class="login-container"><div class="login-card setup-wizard"><div style="display:flex;justify-content:flex-end;margin-bottom:8px">'+langSwitchButton()+'</div><h1>'+t('setup.title')+'</h1><p>'+t('setup.subtitle')+'</p><div class="step-indicator">' +
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
    html += '<div class="form-group"><label>'+t('setup.orgName')+'</label><input type="text" id="setup-org-name" value="default" placeholder="'+t('setup.orgPlaceholder')+'"></div>';
    html += '<div class="form-group"><label>'+t('setup.displayName')+'</label><input type="text" id="setup-org-display" value="Default Organization" placeholder="'+t('setup.displayPlaceholder')+'"></div>';
  } else if (step.key === 'admin') {
    html += '<div class="form-group"><label>'+t('setup.adminUser')+'</label><input type="text" id="setup-admin-user" value="admin" placeholder="'+t('setup.adminUserPlaceholder')+'"></div>';
    html += '<div class="form-group"><label>'+t('setup.adminPass')+'</label><input type="password" id="setup-admin-pass" value="admin" placeholder="'+t('setup.adminPassPlaceholder')+'"></div>';
  } else if (step.key === 'channel') {
    html += '<div class="form-group"><label>'+t('setup.feishuAppId')+'</label><input type="text" id="setup-feishu-app-id" placeholder="'+t('setup.feishuAppIdPlaceholder')+'"></div>';
    html += '<div class="form-group"><label>'+t('setup.feishuAppSecret')+'</label><input type="password" id="setup-feishu-app-secret" placeholder="'+t('setup.feishuAppSecretPlaceholder')+'"></div>';
    html += '<p class="hint-text">'+t('setup.channelHint')+'</p>';
  } else if (step.key === 'llm') {
    html += '<div class="form-group"><label>'+t('setup.litellmUrl')+'</label><input type="text" id="setup-litellm-url" value="http://localhost:4000" placeholder="'+t('setup.litellmUrlPlaceholder')+'"></div>';
    html += '<div class="form-group"><label>'+t('setup.defaultModel')+'</label><input type="text" id="setup-litellm-model" value="minimax-m2.7" placeholder="'+t('setup.modelPlaceholder')+'"></div>';
  } else if (step.key === 'embedding') {
    html += '<div class="form-group"><label>'+t('setup.embMode')+'</label><select id="setup-emb-mode"><option value="deterministic">'+t('setup.embDeterministic')+'</option><option value="provider">'+t('setup.embProvider')+'</option></select></div>';
    html += '<div class="form-group"><label>'+t('setup.embUrl')+'</label><input type="text" id="setup-emb-url" placeholder="'+t('setup.embUrlPlaceholder')+'"></div>';
  } else {
    html += '<p>'+t('setup.autoDone')+'</p>';
  }
  html += '<button class="btn btn-primary" onclick="doSetupStep(' + stepIndex + ')">'+t('setup.completeStep')+'</button>';
  html += '</div>';
  content.innerHTML = html;
}

async function doSetupStep(stepIndex) {
  const setupStatus = await checkSetup();
  if (!setupStatus) { showToast(t('setup.cannotGetStatus'), 'error'); return; }
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
    showToast(t('setup.stepDone'));
    const newStatus = await checkSetup();
    if (newStatus && newStatus.steps.every(function(s) { return s.done; })) {
      showToast(t('setup.allDone'));
      renderLogin();
    } else {
      renderSetupWizard(newStatus);
    }
  } else {
    showToast((r.data && r.data.message) || (r.data && r.data.error) || t('setup.stepFailed'), 'error');
  }
}

function renderApp() {
  const navItems = [
    { section: t('nav.section.overview'), items: [{ key: 'dashboard', label: t('nav.dashboard'), icon: '&#x1F4CA;' }, { key: 'guide', label: t('nav.guide'), icon: '&#x1F4D6;' }] },
    { section: t('nav.section.tasks'), items: [{ key: 'workflows', label: t('nav.workflows'), icon: '&#x26A1;' }, { key: 'task-input', label: t('nav.taskInput'), icon: '&#x1F4DD;' }, { key: 'approvals', label: t('nav.approvals'), icon: '&#x2705;' }] },
    { section: t('nav.section.management'), items: [{ key: 'config', label: t('nav.config'), icon: '&#x2699;&#xFE0F;' }, { key: 'users', label: t('nav.users'), icon: '&#x1F465;' }, { key: 'organizations', label: t('nav.organizations'), icon: '&#x1F3E2;' }, { key: 'skills', label: t('nav.skills'), icon: '&#x1F527;' }, { key: 'knowledge', label: t('nav.knowledge'), icon: '&#x1F4DA;' }] },
    { section: t('nav.section.operations'), items: [{ key: 'audit', label: t('nav.audit'), icon: '&#x1F4CB;' }, { key: 'retrieval', label: t('nav.retrieval'), icon: '&#x1F50D;' }, { key: 'identities', label: t('nav.identities'), icon: '&#x1F511;' }, { key: 'db-maint', label: t('nav.dbMaint'), icon: '&#x1F5C4;&#xFE0F;' }, { key: 'resources', label: t('nav.resources'), icon: '&#x1F4CA;' }, { key: 'knowledge-review', label: t('nav.knowledgeReview'), icon: '&#x1F4DD;' }] },
  ];
  if (currentSession && currentSession.role === 'admin') {
    navItems.push({ section: t('nav.section.sharing'), items: [{ key: 'shared-knowledge', label: t('nav.sharedKnowledge'), icon: '&#x1F4E2;' }] });
    navItems.push({ section: t('nav.section.dispatch'), items: [{ key: 'org-tasks', label: t('nav.orgTasks'), icon: '&#x1F4CB;' }] });
    navItems.push({ section: t('nav.section.dream'), items: [
      { key: 'dream-memory', label: t('nav.dreamMemory'), icon: '&#x1F4A4;' },
      { key: 'dream-skills', label: t('nav.dreamSkills'), icon: '&#x1F52C;' },
      { key: 'dream-config', label: t('nav.dreamConfig'), icon: '&#x2699;' }
    ]});
  }
  if (currentSession) {
    navItems.push({ section: t('nav.section.my'), items: [{ key: 'my-tasks', label: t('nav.myTasks'), icon: '&#x270D;&#xFE0F;' }] });
  }

  const sessionData = currentSession || {};
  const username = sessionData.username || localStorage.getItem('ah_username') || 'User';
  const role = sessionData.role || 'user';
  const orgId = sessionData.org_id || '';
  const initial = username.charAt(0).toUpperCase();

  document.getElementById('app').innerHTML = '<div class="app-container"><div class="sidebar"><div class="sidebar-brand" style="display:flex;justify-content:space-between;align-items:center"><span>JueYing</span>'+langSwitchButton()+'</div><nav class="sidebar-nav">' +
    navItems.map(function(g) { return '<div class="nav-section">' + g.section + '</div>' + g.items.map(function(i) { return '<a href="#" data-view="' + i.key + '" class="' + (currentView === i.key ? 'active' : '') + '">' + i.icon + ' ' + i.label + '</a>'; }).join(''); }).join('') +
    '</nav><div class="sidebar-footer"><div class="user-info"><div class="user-avatar">' + escapeHtml(initial) + '</div><div class="user-details"><div class="user-name">' + escapeHtml(username) + '</div><div class="user-role">' + escapeHtml(role) + '</div></div><div class="user-menu"><button class="btn btn-sm btn-outline" onclick="toggleUserMenu()">&#x25B2;</button><div class="user-menu-dropdown" id="user-menu-dropdown"><a href="#" onclick="showChangePasswordModal(false);return false;">' + t('chpwd.menu') + '</a><a href="#" onclick="doLogout();return false;" style="color:var(--danger)">' + t('chpwd.logout') + '</a></div></div></div></div></div><div class="main-content" id="main-content"></div></div>';
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
  if (renderer) renderer(el); else el.innerHTML = '<p>'+t('common.viewNotImplemented')+'</p>';
}

function stopAllIntervals() {
  if (serviceStatusInterval) { clearInterval(serviceStatusInterval); serviceStatusInterval = null; }
  if (dockerStatsInterval) { clearInterval(dockerStatsInterval); dockerStatsInterval = null; }
  if (containerStatsInterval) { clearInterval(containerStatsInterval); containerStatsInterval = null; }
}

let guideTab = 'arch';

function renderGuide(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('guide.title')+'</h2></div>' +
    '<div class="guide-tabs">' +
    '<div class="guide-tab active" data-gtab="arch" onclick="switchGuideTab(\'arch\')">'+t('guide.arch')+'</div>' +
    '<div class="guide-tab" data-gtab="capabilities" onclick="switchGuideTab(\'capabilities\')">'+t('guide.capabilities')+'</div>' +
    '<div class="guide-tab" data-gtab="stories" onclick="switchGuideTab(\'stories\')">'+t('guide.stories')+'</div>' +
    '<div class="guide-tab" data-gtab="quickstart" onclick="switchGuideTab(\'quickstart\')">'+t('guide.quickstart')+'</div>' +
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
  return '<div class="card"><h3>'+t('guide.arch.title1')+'</h3>' +
    '<p class="section-desc">'+t('guide.arch.desc1')+'</p></div>' +

    '<div class="card"><h3>'+t('guide.arch.title2')+'</h3>' +
    '<p class="section-desc">'+t('guide.arch.desc2')+'</p>' +

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

    '<div class="card"><h3>'+t('guide.arch.dataFlowTitle')+'</h3>' +
    '<p class="section-desc">'+t('guide.arch.dataFlowDesc')+'</p>' +

    '<div class="story-card"><h4>💬 '+t('guide.arch.chatPath')+'</h4>' +
    '<div class="story-body">'+t('guide.arch.chatDesc')+'</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">身份解析</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(chat)</span><span class="flow-arrow">→</span><span class="flow-step">召回记忆</span><span class="flow-arrow">→</span><span class="flow-step">LLM 生成回复</span><span class="flow-arrow">→</span><span class="flow-step">存储记忆</span><span class="flow-arrow">→</span><span class="flow-step">推送回复</span></div></div>' +

    '<div class="story-card"><h4>⚡ '+t('guide.arch.taskPath')+'</h4>' +
    '<div class="story-body">'+t('guide.arch.taskDesc')+'</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">匹配契约</span><span class="flow-arrow">→</span><span class="flow-step">匹配skill</span><span class="flow-arrow">→</span><span class="flow-step">未命中则规划</span><span class="flow-arrow">→</span><span class="flow-step">派发执行</span><span class="flow-arrow">→</span><span class="flow-step">过程可观测</span><span class="flow-arrow">→</span><span class="flow-step">确认后复用</span></div></div>' +

    '<div class="story-card"><h4>📝 '+t('guide.arch.knowledgePath')+'</h4>' +
    '<div class="story-body">'+t('guide.arch.knowledgeDesc')+'</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(knowledge)</span><span class="flow-arrow">→</span><span class="flow-step">写入待审核池</span><span class="flow-arrow">→</span><span class="flow-step">管理员审核</span><span class="flow-arrow">→</span><span class="flow-step">知识入库</span></div></div>' +

    '<div class="story-card"><h4>🔎 '+t('guide.arch.lookupPath')+'</h4>' +
    '<div class="story-body">'+t('guide.arch.lookupDesc')+'</div>' +
    '<div class="story-flow"><span class="flow-step">消息进入</span><span class="flow-arrow">→</span><span class="flow-step">意图分类(lookup)</span><span class="flow-arrow">→</span><span class="flow-step">轻量工作流</span><span class="flow-arrow">→</span><span class="flow-step">短轮询(15s)</span><span class="flow-arrow">→</span><span class="flow-step">返回结果/降级Chat</span></div></div>' +
    '</div>' +

    '<div class="card"><h3>'+t('guide.arch.smTitle')+'</h3>' +
    '<p class="section-desc">'+t('guide.arch.smDesc')+'</p>' +
    '<div style="text-align:center;padding:12px 0;font-size:14px;line-height:2.2">' +
    '<span class="badge badge-info">draft</span> → <span class="badge badge-info">planned</span> → <span class="badge badge-warning">running</span> → <span class="badge badge-warning">verifying</span> → <span class="badge badge-warning">reporting</span> → <span class="badge badge-success">succeeded</span> → <span class="badge" style="background:var(--surface2);color:var(--text2)">archived</span>' +
    '<br><span style="font-size:13px;color:var(--text2)">分支: running 可进入 <span class="badge badge-warning">waiting_user</span> / <span class="badge badge-danger">blocked</span> / <span class="badge" style="background:var(--surface2)">paused</span>；verifying 可进入 <span class="badge badge-warning">repairing</span>；任意运行态可进入 <span class="badge badge-danger">failed</span> / <span class="badge badge-danger">cancelled</span></span>' +
    '</div></div>';
}

function renderGuideCapabilities() {
  return '<div class="card"><h3>'+t('guide.cap.title')+'</h3>' +
    '<p class="section-desc">'+t('guide.cap.desc')+'</p></div>' +

    '<div class="capability-grid">' +
    '<div class="capability-card"><div class="cap-icon">💬</div><h4>'+t('guide.cap.chat')+'</h4><p>'+t('guide.cap.chatDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">⚡</div><h4>'+t('guide.cap.workflow')+'</h4><p>'+t('guide.cap.workflowDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">📚</div><h4>'+t('guide.cap.knowledge')+'</h4><p>'+t('guide.cap.knowledgeDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🧠</div><h4>'+t('guide.cap.memory')+'</h4><p>'+t('guide.cap.memoryDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🔧</div><h4>'+t('guide.cap.skills')+'</h4><p>'+t('guide.cap.skillsDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🏢</div><h4>'+t('guide.cap.multiTenant')+'</h4><p>'+t('guide.cap.multiTenantDesc')+'</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🌐</div><h4>'+t('guide.cap.multiChannel')+'</h4><p>'+t('guide.cap.multiChannelDesc')+'</p></div>' +
    '</div>' +

    '<div class="card"><h3>'+t('guide.cap.execTitle')+'</h3>' +
    '<table><tr><th>执行器</th><th>适用阶段</th><th>说明</th></tr>' +
    '<tr><td>Generic Executor</td><td>意图澄清、计划生成、决策推理、报告等</td><td>'+t('guide.cap.execGeneric')+'</td></tr>' +
    '<tr><td>Code Executor</td><td>Implementation</td><td>'+t('guide.cap.execCode')+'</td></tr>' +
    '<tr><td>Retrieval-Aware Executor</td><td>EvidenceRetrieval、MemoryRetrieval</td><td>'+t('guide.cap.execRetrieval')+'</td></tr>' +
    '<tr><td>Verification Executor</td><td>Verification</td><td>'+t('guide.cap.execVerify')+'</td></tr>' +
    '<tr><td>Repair Executor</td><td>Repair</td><td>'+t('guide.cap.execRepair')+'</td></tr>' +
    '<tr><td>Approval Executor</td><td>Approval</td><td>'+t('guide.cap.execApproval')+'</td></tr>' +
    '</table></div>';
}

function renderGuideStories() {
  return '<div class="card"><h3>'+t('guide.stories.title')+'</h3>' +
    '<p class="section-desc">'+t('guide.stories.desc')+'</p></div>' +

    '<div class="story-card"><h4>📖 故事二十一：B2B 销售管理日常闭环</h4>' +
    '<div class="story-role">角色：老板 + 销售经理 + 一线销售 + Admin · 每日经营节奏</div>' +
    '<div class="story-body">' +
    '周一上午，老板在飞书里说："本周把华东区回款风险降下来，两个重点客户推进到 closing，并告诉我需要拍板的事项。"绝影先查找已批准 workflow_definition；未命中时再查个人私有、组织和公共 workflow 型 active skill 模板；如果两层都没有命中，就进入首跑模式，自主拆解为客户阶段梳理、拜访证据核对、回款风险识别、经理行动清单和老板决策摘要。' +
    '<br><br>销售经理 9:00 打开晨会清单，看到每个客户的红黄绿状态、阶段停留天数、下一承诺动作和证据缺口；20:30 查看夕会异常，只处理卡单、折扣越线、回款承诺缺证据的项目。一线销售在客户沟通后用自然语言补充进展，系统更新客户阶段、下一步动作和风险提醒，并在卡单时给出诊断路径和话术建议。' +
    '<br><br>执行过程中若某个阶段失败，系统先进行一次自主修复并记录原因；完成后回执必须说明执行过程、异常处理、关键结果和下一步。用户认可后回复<strong>确认工作流 wf_xxx</strong>，该路径沉淀为个人 workflow 型 skill 模板；Admin 审核后可提升为组织模板；召回率、注入效果和业务 outcome 均良好时，再候审固化为 workflow_definition。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">经营目标</span><span class="flow-arrow">→</span><span class="flow-step">匹配既有workflow</span><span class="flow-arrow">→</span><span class="flow-step">首跑规划</span><span class="flow-arrow">→</span><span class="flow-step">异常自修复</span><span class="flow-arrow">→</span><span class="flow-step">过程汇报</span><span class="flow-arrow">→</span><span class="flow-step">确认后复用</span></div></div>' +

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

    '<div class="story-card"><h4>📖 故事十六：工作流确认后复用</h4>' +
    '<div class="story-role">角色：系统自动 + 管理员 · Day 6</div>' +
    '<div class="story-body">' +
    '成功执行的工作流<strong>自动提取为待确认候选</strong>（Skill Candidate）：' +
    '<br><br>• gateway-adapter 调用 <strong>extractWorkflowAsSkillCandidate()</strong>' +
    '<br>• 提取工作流的 stage_chain 和 user_goal' +
    '<br>• 提交到 <strong>skill-library</strong> 的 /internal/skills/create' +
    '<br>• 管理员在 Portal 审核（skill_audit_record）后发布' +
    '<br>• 技能注册到 <strong>org_skill_registry</strong>，全组织可复用' +
    '<br><br>同时支持从 <strong>Mirror 镜像站</strong>搜索和安装公开技能。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">成功工作流</span><span class="flow-arrow">→</span><span class="flow-step">提取候选</span><span class="flow-arrow">→</span><span class="flow-step">用户确认</span><span class="flow-arrow">→</span><span class="flow-step">私有复用</span><span class="flow-arrow">→</span><span class="flow-step">Admin审核为组织模板</span></div></div>' +

    '<div class="story-card"><h4>📖 故事十七：技能公网安装与多路检索</h4>' +
    '<div class="story-role">角色：管理员 (Admin)</div>' +
    '<div class="story-body">' +
    '管理员从 <strong>Skill Mirror</strong>（公网镜像仓库）搜索并安装社区技能：' +
    '<br><br>• Portal 调用 /api/admin/skills/mirror-search 搜索预制技能（Document Pro / Deep Search 等）' +
    '<br>• 点击安装 → 调用 /api/admin/skills/mirror-install' +
    '<br>• 系统从 Mirror 拉取 skill_definition 并创建到 local skill-library' +
    '<br>• 安装后进入本地 skill-library，后续可由管理员审核提升到 <strong>org_skill_registry</strong>' +
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
    '<br>梦境分析发现新的 Workflow Pattern → 提取 Skill Candidate → scene_value_assessment 评估 → skill_audit_record 审核 → org_skill_registry 注册 → skill_usage_stats 追踪使用效果；高召回、高注入、高业务分的 workflow 型 skill 现在会进入 workflow_definition_review，批准后写入 workflow_definition。' +
    '<br><br>形成 <strong>"使用 → 发现 → 提炼 → 注册 → 复用的持续优化"的完整生态系统</strong>。' +
    '</div>' +
    '<div class="story-flow"><span class="flow-step">发现</span><span class="flow-arrow">→</span><span class="flow-step">提炼</span><span class="flow-arrow">→</span><span class="flow-step">评估</span><span class="flow-arrow">→</span><span class="flow-step">注册</span><span class="flow-arrow">→</span><span class="flow-step">复用</span></div></div>';
}

function renderGuideQuickstart() {
  return '<div class="card"><h3>'+t('guide.qs.title')+'</h3>' +
    '<p class="section-desc">'+t('guide.qs.desc')+'</p></div>' +

    '<div class="card"><h3>🔧 '+t('guide.qs.adminTitle')+'</h3>' +
    '<table><tr><th>步骤</th><th>操作</th><th>页面入口</th></tr>' +
    '<tr><td>1</td><td>完成6步设置向导（数据库→组织→管理员→渠道→LLM→向量）</td><td>首次登录自动弹出</td></tr>' +
    '<tr><td>2</td><td>配置飞书/企微渠道，填写 App ID 和 Secret</td><td>系统配置 → 渠道配置</td></tr>' +
    '<tr><td>3</td><td>配置 LLM 模型，设置主模型和备用模型</td><td>系统配置 → LLM 配置</td></tr>' +
    '<tr><td>4</td><td>创建用户并分配到组织</td><td>用户管理 + 组织管理</td></tr>' +
    '<tr><td>5</td><td>导入初始知识库</td><td>知识导入</td></tr>' +
    '<tr><td>6</td><td>从镜像站安装预制技能</td><td>技能管理 → 搜索镜像站</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>👤 '+t('guide.qs.userTitle')+'</h3>' +
    '<table><tr><th>场景</th><th>操作方式</th><th>示例</th></tr>' +
    '<tr><td>日常对话</td><td>在飞书/企微中直接发消息</td><td>"你好，今天天气怎么样？"</td></tr>' +
    '<tr><td>快速查询</td><td>用"查一下"等关键词触发</td><td>"查一下张经理的电话"</td></tr>' +
    '<tr><td>提交长任务</td><td>描述复杂目标，系统先匹配 workflow_definition，再匹配 workflow 型 skill，未命中时自动规划</td><td>"分析本周华东区回款风险，并列出需要老板拍板的事项"</td></tr>' +
    '<tr><td>确认复用</td><td>任务完成后认可执行路径，在 IM 中确认</td><td>"确认工作流 wf_xxx"</td></tr>' +
    '<tr><td>提交知识</td><td>用"记录"/"提交知识"等关键词</td><td>"记录：XX客户下季度采购500套"</td></tr>' +
    '<tr><td>Web任务</td><td>在 Portal 任务接入页面创建</td><td>填写任务目标、类型、执行者</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>📋 '+t('guide.qs.opsTitle')+'</h3>' +
    '<table><tr><th>任务</th><th>页面入口</th><th>频率</th></tr>' +
    '<tr><td>审核知识提交</td><td>审批台 / 知识审核</td><td>每日</td></tr>' +
    '<tr><td>审核技能模板</td><td>技能管理 / 梦境技能审核</td><td>按需</td></tr>' +
    '<tr><td>查看服务状态</td><td>仪表盘</td><td>随时</td></tr>' +
    '<tr><td>监控资源使用</td><td>资源监控</td><td>每周</td></tr>' +
    '<tr><td>查看审计日志</td><td>审计日志</td><td>按需</td></tr>' +
    '<tr><td>管理用户/组织</td><td>用户管理 / 组织管理</td><td>按需</td></tr>' +
    '<tr><td>更新技能库</td><td>技能管理 → 搜索镜像站</td><td>每月</td></tr>' +
    '</table></div>' +

    '<div class="card"><h3>💡 '+t('guide.qs.tipsTitle')+'</h3>' +
    '<div class="capability-grid">' +
    '<div class="capability-card"><div class="cap-icon">🎯</div><h4>明确任务目标</h4><p>描述任务时尽量具体，包含目标、范围和期望输出格式，系统会生成更精准的工作流。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">📝</div><h4>善用知识提交</h4><p>将重要的客户信息、业务规则主动提交给系统，审核后全员可检索，减少重复沟通。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">🔄</div><h4>复用技能模板</h4><p>从镜像站安装预制技能，或将成功工作流保存为技能，避免重复创建相似任务。</p></div>' +
    '<div class="capability-card"><div class="cap-icon">⚡</div><h4>选择合适的任务类型</h4><p>分析任务适合数据处理，调研任务支持LUI对话，执行任务适合自动化操作，创意任务适合内容生成。</p></div>' +
    '</div></div>';
}

async function renderDashboard(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('dashboard.title')+'</h2></div><div class="stat-grid" id="stats-grid"><div class="stat-card"><div class="stat-value">-</div><div class="stat-label">'+t('common.loading')+'</div></div></div><div class="card"><h3>'+t('dashboard.services')+' <span id="svc-refresh-indicator" style="font-size:12px;color:var(--text2)"></span></h3><div id="services-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/system/overview');
  if (r.ok && r.data.overview) {
    const o = r.data.overview;
    const grid = document.getElementById('stats-grid');
    const stats = o.summary || {};
    grid.innerHTML = Object.entries(stats).map(function(_ref) { const k=_ref[0],v=_ref[1]; return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(v)) + '</div><div class="stat-label">' + escapeHtml(k) + '</div></div>'; }).join('');
    const svcList = document.getElementById('services-list');
    if (o.services && o.services.length > 0) {
      svcList.innerHTML = '<table><tr><th>'+t('resources.inspectionReport')+'</th><th>'+t('workflows.status')+'</th><th>ms</th></tr>' + o.services.map(function(s) {
        const dot = s.status === 'healthy' ? 'healthy' : (s.status === 'unreachable' ? 'unreachable' : 'unhealthy');
        return '<tr><td><span class="status-dot ' + dot + '"></span>' + escapeHtml(s.name) + '</td><td>' + statusBadge(s.status) + '</td><td>' + escapeHtml(String(s.latency_ms || '-')) + 'ms</td></tr>';
      }).join('') + '</table>';
    } else {
      svcList.innerHTML = '<p style="color:var(--text2)">'+t('dashboard.noServiceData')+'</p>';
    }
    startServiceStatusPolling();
  } else {
    document.getElementById('stats-grid').innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">'+t('dashboard.unableToLoad')+'</div></div>';
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
          const changeMsg = s.status === 'healthy' ? t('dashboard.servicePrefix') + s.name + t('dashboard.serviceHealthy') : t('dashboard.servicePrefix') + s.name + t('dashboard.serviceChanged') + s.status;
          const changeType = s.status === 'healthy' ? 'success' : 'error';
          showToast(changeMsg, changeType);
        }
        previousServiceStatus[s.name] = s.status;
      });
      svcList.innerHTML = '<table><tr><th>'+t('workflows.service')+'</th><th>'+t('common.status')+'</th><th>'+t('workflows.latency')+'</th></tr>' + o.services.map(function(s) {
        const dot = s.status === 'healthy' ? 'healthy' : (s.status === 'unreachable' ? 'unreachable' : 'unhealthy');
        return '<tr><td><span class="status-dot ' + dot + '"></span>' + escapeHtml(s.name) + '</td><td>' + statusBadge(s.status) + '</td><td>' + escapeHtml(String(s.latency_ms || '-')) + 'ms</td></tr>';
      }).join('') + '</table>';
    }
    if (indicator) indicator.textContent = t('dashboard.updated') + new Date().toLocaleTimeString();
  }, 15000);
}

async function renderWorkflows(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('workflows.title')+'</h2><div><button class="btn btn-outline btn-sm" onclick="currentView=\'task-input\';renderView()">'+t('workflows.create')+'</button> <button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div></div><div class="card"><div id="wf-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/workflows');
  if (r.ok && r.data) {
    const wfs = r.data.workflows || [];
    if (wfs.length === 0) {
      document.getElementById('wf-list').innerHTML = emptyState('📋', t('workflows.emptyTitle'), t('workflows.emptyDesc'), '<button class="btn btn-primary" onclick="currentView=\'task-input\';renderView()">'+t('workflows.create')+'</button>');
    } else {
      document.getElementById('wf-list').innerHTML = '<table><tr><th>'+t('common.reference')+'</th><th>'+t('common.goal')+'</th><th>'+t('common.status')+'</th><th>'+t('common.createdAt')+'</th><th>'+t('common.action')+'</th></tr>' + wfs.map(function(w) { return '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td>' + statusBadge(w.status) + '</td><td>' + escapeHtml(w.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="viewWorkflow(\'' + escJsAttr(w.ref || w.id) + '\')">'+t('common.detail')+'</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    const errMsg = (r.data && r.data.error) || t('common.unknownError');
    const isNetwork = r.status === 0;
    document.getElementById('wf-list').innerHTML = emptyState('⚠️', isNetwork ? t('workflows.cannotConnect') : t('workflows.loadFailed'), isNetwork ? t('workflows.checkService') : t('common.errorPrefix') + escapeHtml(errMsg), '<button class="btn btn-primary" onclick="renderView()">'+t('common.retry')+'</button>');
  }
}

async function viewWorkflow(ref) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref));
  let el = document.getElementById('main-content');
  if (r.ok && r.data.workflow) {
    const w = r.data.workflow;
    el.innerHTML = '<div class="page-header"><h2>'+t('workflows.detail')+'' + escapeHtml(ref) + '</h2><button class="btn btn-outline" onclick="renderView()">'+t('common.back')+'</button></div><div class="card"><h3>'+t('workflows.basicInfo')+'</h3><p>'+t('workflows.goal')+'' + escapeHtml(w.goal || '-') + '</p><p>'+t('workflows.status')+'' + statusBadge(w.status) + '</p><p>'+t('workflows.created')+'' + escapeHtml(w.created_at || '-') + '</p></div><div class="card"><h3>'+t('workflows.stages')+'</h3><div id="wf-stages">'+t('common.loading')+'</div></div>';
    if (w.stages && w.stages.length > 0) {
      document.getElementById('wf-stages').innerHTML = '<table><tr><th>'+t('common.index')+'</th><th>'+t('workflows.stageName')+'</th><th>'+t('workflows.stageType')+'</th><th>'+t('common.status')+'</th></tr>' + w.stages.map(function(s, i) { return '<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(s.name || '-') + '</td><td>' + escapeHtml(s.stage_type || '-') + '</td><td>' + statusBadge(s.status) + '</td></tr>'; }).join('') + '</table>';
    } else {
      document.getElementById('wf-stages').innerHTML = '<p style="color:var(--text2)">'+t('workflows.noStages')+'</p>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('workflows.cannotLoad'), t('workflows.checkStatus'), '<button class="btn btn-primary" onclick="renderView()">'+t('common.back')+'</button>');
  }
}

function renderTaskInput(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('task.title')+'</h2></div>' +
    '<div class="card"><p class="section-desc">'+t('task.desc')+'</p></div>' +
    '<div class="card"><h3>'+t('task.createTitle')+'</h3>' +
    '<div class="form-group"><label>'+t('task.goalLabel')+'</label><textarea id="task-goal" placeholder="'+t('task.goalPlaceholder')+'"></textarea></div>' +
    '<div class="form-group"><label>'+t('task.typeLabel')+'</label><select id="task-type"><option value="analysis">'+t('task.typeAnalysis')+'</option><option value="research">'+t('task.typeResearch')+'</option><option value="execution">'+t('task.typeExecution')+'</option><option value="creative">'+t('task.typeCreative')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('task.executorLabel')+'</label><select id="task-executor"><option value="">'+t('task.autoAssign')+'</option></select><p class="hint-text">'+t('task.executorHint')+'</p></div>' +
    '<div class="form-group"><label>'+t('task.riskLabel')+'</label><select id="task-risk"><option value="low">'+t('task.riskLow')+'</option><option value="medium">'+t('task.riskMed')+'</option><option value="high">'+t('task.riskHigh')+'</option></select></div>' +
    '<button class="btn btn-primary" onclick="submitTask()">'+t('task.submit')+'</button></div>' +
    '<div class="card"><h3>'+t('task.luiTitle')+'</h3><p class="section-desc">'+t('task.luiDesc')+'</p>' +
    '<div class="form-group"><textarea id="lui-input" placeholder="'+t('task.luiPlaceholder')+'" style="min-height:80px"></textarea></div>' +
    '<button class="btn btn-outline" onclick="submitLUITask()">'+t('task.luiSend')+'</button>' +
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
  if (!goal) { showToast(t('task.enterGoal'), 'error'); return; }
  const taskType = document.getElementById('task-type').value || 'analysis';
  const riskLevel = document.getElementById('task-risk').value || 'low';
  const executor = document.getElementById('task-executor').value || '';
  const body = { goal, task_type: taskType, risk_level: riskLevel };
  if (executor) body.target_executor = executor;
  const r = await api('/api/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) { showToast(t('task.created')); currentView = 'workflows'; renderView(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || t('common.createFailed'), 'error'); }
}

async function submitLUITask() {
  const input = document.getElementById('lui-input').value.trim();
  if (!input) { showToast(t('task.enterQuestion'), 'error'); return; }
  const respEl = document.getElementById('lui-response');
  respEl.innerHTML = '<p style="color:var(--text2)">'+t('task.searching')+'</p>';
  const body = { goal: input, task_type: 'research', risk_level: 'low' };
  const r = await api('/api/workflows/create-from-markdown', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    respEl.innerHTML = '<p style="color:var(--success)">'+t('task.submitted')+'</p><button class="btn btn-sm btn-outline" onclick="currentView=\'workflows\';renderView()">'+t('task.viewWorkflow')+'</button>';
  } else {
    respEl.innerHTML = '<p style="color:var(--danger)">'+t('task.submitFailed') + escapeHtml((r.data && r.data.error) || t('common.unknownError')) + '</p>';
  }
}

async function renderApprovals(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('approvals.title')+'</h2><button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div><div class="card"><p class="section-desc">'+t('approvals.desc')+'</p><div id="approval-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/workflows?status=pending_approval');
  if (r.ok && r.data) {
    const wfs = r.data.workflows || [];
    if (wfs.length === 0) {
      document.getElementById('approval-list').innerHTML = emptyState('✅', t('approvals.emptyTitle'), t('approvals.emptyDesc'));
    } else {
      document.getElementById('approval-list').innerHTML = '<table><tr><th>'+t('common.reference')+'</th><th>'+t('common.goal')+'</th><th>'+t('common.action')+'</th></tr>' + wfs.map(function(w) { return '<tr><td>' + escapeHtml(w.ref || w.id) + '</td><td>' + escapeHtml(w.goal || '-') + '</td><td><button class="btn btn-sm btn-success" onclick="handleApproval(\'' + escJsAttr(w.ref) + '\',\'approve\')">'+t('common.approve')+'</button> <button class="btn btn-sm btn-danger" onclick="handleApproval(\'' + escJsAttr(w.ref) + '\',\'reject\')">'+t('common.reject')+'</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    const isNetwork = r.status === 0;
    document.getElementById('approval-list').innerHTML = emptyState('⚠️', isNetwork ? t('approvals.cannotConnect') : t('approvals.loadFailed'), isNetwork ? t('workflows.checkService') : t('approvals.retryLater'), '<button class="btn btn-primary" onclick="renderView()">'+t('common.retry')+'</button>');
  }
}

async function handleApproval(ref, action) {
  const r = await api('/api/workflows/' + encodeURIComponent(ref) + '/approval', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) { showToast(t('common.success')); renderView(); } else { showToast((r.data && r.data.error) || t('common.failed'), 'error'); }
}

async function renderConfig(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('config.title')+'</h2></div><div class="tabs" id="config-tabs"></div><div id="config-content"></div>';
  const r = await api('/api/admin/config');
  const config = r.ok ? (r.data.config || {}) : {};
  const tabs = document.getElementById('config-tabs');

  function makeTabs(sections) {
    tabs.innerHTML = sections.map(function(s, i) { return '<div class="tab ' + (i === 0 ? 'active' : '') + '" data-section="' + escapeAttr(s.key) + '">' + escapeHtml(s.label) + '</div>'; }).join('');
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
      document.getElementById('config-content').innerHTML = '<p style="color:var(--text2)">'+t('config.cannotLoad')+'</p>';
    }
  }
}

function renderConfigSection(sectionKey, sections, config) {
  const section = sections.find(function(s) { return s.key === sectionKey; });
  if (!section) return;
  const content = document.getElementById('config-content');
  const descMap = {
    feishu: t('config.desc.feishu'),
    wecom: t('config.desc.wecom'),
    llm: t('config.desc.llm'),
    embedding: t('config.desc.embedding'),
    rerank: t('config.desc.rerank')
  };

  if (sectionKey === 'llm') {
    renderLLMConfigSection(content, section, config, descMap.llm);
    return;
  }

  let html = '<div class="card"><h3>' + escapeHtml(section.label) + '</h3>';
  if (descMap[sectionKey]) html += '<p class="section-desc">' + descMap[sectionKey] + '</p>';
  section.fields.forEach(function(f) {
    const val = config[f.key] || f.default || '';
    const displayVal = f.sensitive ? '****' : escapeAttr(val);
    if (f.type === 'select') {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><select id="cfg-' + escapeAttr(f.key) + '">' + (f.options || []).map(function(o) { return '<option value="' + escapeAttr(o) + '" ' + (val === o ? 'selected' : '') + '>' + escapeHtml(o) + '</option>'; }).join('') + '</select></div>';
    } else {
      html += '<div class="form-group"><label>' + escapeHtml(f.label) + '</label><input type="' + escapeAttr(f.type) + '" id="cfg-' + escapeAttr(f.key) + '" value="' + displayVal + '" ' + (f.sensitive ? 'placeholder="'+escapeAttr(t('common.leaveBlank'))+'"' : '') + '></div>';
    }
  });
  html += '<button class="btn btn-primary" onclick="saveConfigSection(\'' + escJsAttr(sectionKey) + '\')">'+t('config.save')+'</button></div>';
  content.innerHTML = html;
}

async function renderLLMConfigSection(content, section, config, desc) {
  let html = '<div class="card"><h3>'+t('config.llm.title')+'</h3>';
  html += '<p class="section-desc">' + desc + '</p>';
  html += '<div class="form-group"><label>'+t('config.llm.litellmUrl')+'</label><input type="text" id="cfg-LITELLM_URL" value="' + escapeAttr(config.LITELLM_URL || 'http://localhost:4000') + '" placeholder="'+escapeAttr(t('config.llm.litellmPlaceholder'))+'"></div>';
  html += '<div class="form-group"><label>'+t('config.llm.masterKey')+'</label><input type="password" id="cfg-LITELLM_MASTER_KEY" value="' + (config.LITELLM_MASTER_KEY ? '****' : '') + '" placeholder="'+t('config.llm.leaveBlank')+'"></div>';
  html += '<button class="btn btn-primary" onclick="saveConfigSection(\'llm\')">'+t('config.llm.saveBase')+'</button></div>';

  html += '<div class="card"><h3>'+t('config.llm.modelList')+'</h3>';
  html += '<p class="section-desc">'+t('config.llm.modelListDesc')+'</p>';
  html += '<div id="llm-models-list">'+t('common.loading')+'</div>';
  html += '<div style="margin-top:16px"><button class="btn btn-primary" onclick="showAddLLMModel()">'+t('config.llm.addModel')+'</button></div></div>';

  content.innerHTML = html;
  await loadLLMModels();
}

async function loadLLMModels() {
  let el = document.getElementById('llm-models-list');
  if (!el) return;
  const r = await api('/api/admin/llm-models');
  if (!r.ok || !r.data.models) {
    el.innerHTML = '<p style="color:var(--text2)">'+t('common.loadFailed')+'</p>';
    return;
  }
  const models = r.data.models;
  if (models.length === 0) {
    el.innerHTML = emptyState('🤖', t('config.llm.noModels'), t('config.llm.addFirst'), '<button class="btn btn-primary" onclick="showAddLLMModel()">'+t('config.llm.addModel')+'</button>');
    return;
  }
  let html = '<table><tr><th>'+t('common.priority')+'</th><th>'+t('config.llm.modelNameLabel')+'</th><th>'+t('common.type')+'</th><th>'+t('common.address')+'</th><th>'+t('common.action')+'</th></tr>';
  models.forEach(function(m, i) {
    const typeLabel = i === 0 ? '<span class="badge badge-success">'+t('config.llm.primary')+'</span>' : '<span class="badge badge-warning">'+t('config.llm.backup')+'' + i + '</span>';
    html += '<tr><td>' +
      (i > 0 ? '<button class="btn btn-sm btn-outline" onclick="moveLLMModelUp(\'' + escJsAttr(m.id) + '\')" title="'+t('common.priority')+'">▲</button> ' : '') +
      (i < models.length - 1 ? '<button class="btn btn-sm btn-outline" onclick="moveLLMModelDown(\'' + escJsAttr(m.id) + '\')" title="'+t('common.priority')+'">▼</button>' : '') +
      '</td><td><strong>' + escapeHtml(m.name) + '</strong></td><td>' + typeLabel + '</td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(m.url || '-') + '</td><td>' +
      (i > 0 ? '<button class="btn btn-sm btn-danger" onclick="deleteLLMModel(\'' + escJsAttr(m.id) + '\',\'' + escJsAttr(m.name) + '\')">'+t('common.delete')+'</button>' : '<span class="hint-text">'+t('config.llm.cannotDeletePrimary')+'</span>') +
      '</td></tr>';
  });
  html += '</table>';
  el.innerHTML = html;
}

function showAddLLMModel() {
  const body = '<div class="form-group"><label>'+t('config.llm.modelNameLabel')+'</label><input type="text" id="new-llm-model-name" placeholder="'+t('config.llm.modelNamePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('config.llm.apiUrl')+'</label><input type="text" id="new-llm-model-url" placeholder="'+t('config.llm.apiUrlPlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('config.llm.apiKey')+'</label><input type="password" id="new-llm-model-key" placeholder="'+t('config.llm.apiKeyPlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('config.llm.maxTokens')+'</label><input type="number" id="new-llm-model-max-tokens" placeholder="'+t('config.llm.maxTokensPlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('config.llm.temperature')+'</label><input type="number" id="new-llm-model-temp" step="0.1" min="0" max="2" placeholder="'+t('config.llm.tempPlaceholder')+'"></div>' +
    '<button class="btn btn-primary" onclick="doAddLLMModel()">'+t('config.llm.add')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>';
  showModal(t('config.llm.addModelTitle'), body);
}

async function doAddLLMModel() {
  const name = document.getElementById('new-llm-model-name').value.trim();
  if (!name) { showToast(t('config.llm.enterModelName'), 'error'); return; }
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
  if (r.ok) { showToast(t('config.llm.modelAdded')); closeModal(); await loadLLMModels(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || t('config.llm.addFailed'), 'error'); }
}

async function deleteLLMModel(modelId, modelName) {
  if (!confirm(t('config.llm.deleteConfirm') + modelName + t('config.llm.deleteConfirmSuffix'))) return;
  const r = await api('/api/admin/llm-models/' + encodeURIComponent(modelId), { method: 'DELETE' });
  if (r.ok) { showToast(t('config.llm.modelDeleted')); await loadLLMModels(); }
  else { showToast((r.data && r.data.error) || t('config.llm.deleteFailed'), 'error'); }
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
  if (reorderR.ok) { showToast(t('config.llm.priorityAdjusted')); await loadLLMModels(); }
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
  if (reorderR.ok) { showToast(t('config.llm.priorityAdjusted')); await loadLLMModels(); }
}

async function saveConfigSection(sectionKey) {
  const r = await api('/api/admin/config-meta');
  if (!r.ok) { showToast(t('config.cannotLoad'), 'error'); return; }
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
  if (res.ok) showToast(t('common.saveAndRestart')); else showToast((res.data && res.data.error) || t('common.saveFailed'), 'error');
}

async function renderUsers(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('users.title')+'</h2><button class="btn btn-primary" onclick="showAddUser()">'+t('users.addUser')+'</button></div><div class="card"><div id="user-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/users');
  if (r.ok && r.data.users) {
    document.getElementById('user-list').innerHTML = '<table><tr><th>'+t('login.username')+'</th><th>'+t('common.role')+'</th><th>'+t('common.status')+'</th><th>'+t('common.organization')+'</th><th>'+t('common.action')+'</th></tr>' + r.data.users.map(function(u) { return '<tr><td>' + escapeHtml(u.username) + '</td><td>' + escapeHtml(u.role) + '</td><td>' + statusBadge(u.status) + '</td><td>' + escapeHtml(u.org_id || '-') + '</td><td><button class="btn btn-sm btn-outline" onclick="showAssignOrg(\'' + escJsAttr(u.username) + '\',\'' + escJsAttr(String(u.org_id || '')) + '\')">'+t('users.assignOrg')+'</button></td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('user-list').innerHTML = emptyState('⚠️', t('users.loadFailed'), t('users.checkService'), '<button class="btn btn-primary" onclick="renderView()">'+t('common.retry')+'</button>');
  }
}

async function showAssignOrg(username, currentOrgId) {
  const r = await api('/api/admin/organizations');
  const orgs = (r.ok && r.data.organizations) ? r.data.organizations : [];
  const body = '<div class="form-group"><label>'+t('users.userLabel')+'' + escapeHtml(username) + '</label></div>' +
    '<div class="form-group"><label>'+t('users.selectOrg')+'</label><select id="assign-org-id"><option value="">'+t('users.noOrg')+'</option>' +
    orgs.map(function(o) { return '<option value="' + escapeAttr(o.id) + '"' + (String(o.id) === currentOrgId ? ' selected' : '') + '>' + escapeHtml(o.display_name || o.org_name) + '</option>'; }).join('') +
    '</select></div><button class="btn btn-primary" onclick="doAssignOrg(\'' + escJsAttr(username) + '\')">'+t('users.confirmAssign')+'</button>';
  showModal(t('users.assignOrg'), body);
}

async function doAssignOrg(username) {
  const orgId = document.getElementById('assign-org-id').value;
  const r = await api('/api/admin/users-orgs', { method: 'PUT', body: JSON.stringify({ user_id: username, org_id: orgId }) });
  if (r.ok) { showToast(t('users.assigned')); closeModal(); renderView(); }
  else { showToast((r.data && r.data.error) || t('users.assignFailed'), 'error'); }
}

function showAddUser() {
  const body = '<div class="form-group"><label>'+t('login.username')+'</label><input type="text" id="new-user-name" placeholder="'+t('login.placeholder_user')+'"></div>' +
    '<div class="form-group"><label>'+t('login.password')+'</label><input type="password" id="new-user-pass" placeholder="'+t('users.pwdPlaceholder')+'" oninput="updateNewUserPwdStrength()"></div>' +
    '<div id="new-user-pwd-strength"></div>' +
    '<div class="form-group"><label>'+t('users.roleLabel')+'</label><select id="new-user-role"><option value="user">user</option><option value="admin">admin</option></select></div>' +
    '<button class="btn btn-primary" onclick="doAddUser()">'+t('common.create')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>';
  showModal(t('users.addUserTitle'), body);
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
  const msg = score < 3 ? t('common.weak') : score < 5 ? t('common.medium') : t('common.strong');
  strengthEl.innerHTML = passwordStrengthHtml(score) + '<span class="hint-text">' + t('common.pwdStrength') + msg + '</span>';
}

async function doAddUser() {
  const username = document.getElementById('new-user-name').value.trim();
  const password = document.getElementById('new-user-pass').value;
  const role = document.getElementById('new-user-role').value || 'user';
  if (!username || !password) { showToast(t('users.fillAll'), 'error'); return; }
  if (password.length < 8) { showToast(t('users.pwdMinLength'), 'error'); return; }
  const r = await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  if (r.ok) { showToast(t('users.created')); closeModal(); renderView(); } else showToast((r.data && r.data.error) || (r.data && r.data.message) || t('common.createFailed'), 'error');
}

async function renderOrganizations(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('orgs.title')+'</h2><button class="btn btn-primary" onclick="showAddOrg()">'+t('orgs.createOrg')+'</button></div><div class="card"><div id="org-list">'+t('common.loading')+'</div></div><div id="org-editor" class="hidden"></div>';
  const r = await api('/api/admin/organizations');
  if (r.ok && r.data.organizations) {
    document.getElementById('org-list').innerHTML = '<table><tr><th>'+t('common.name')+'</th><th>'+t('common.displayName')+'</th><th>'+t('common.status')+'</th><th>'+t('common.quota')+'</th><th>'+t('common.createdAt')+'</th><th>'+t('common.action')+'</th></tr>' + r.data.organizations.map(function(o) {
      const settings = o.settings || {};
      const quotaInfo = '' + (settings.max_users || '-') + ' / ' + (settings.max_workflows_per_day || '-');
      const statusClass = o.status === 'active' ? 'badge-success' : o.status === 'suspended' ? 'badge-warning' : 'badge-danger';
      return '<tr><td>' + escapeHtml(o.org_name) + '</td><td>' + escapeHtml(o.display_name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(o.status) + '</span></td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(quotaInfo) + '</td><td>' + escapeHtml(o.created_at || '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="showEditOrg(\'' + escJsAttr(String(o.id)) + '\')">'+t('common.edit')+'</button> <button class="btn btn-sm btn-danger" onclick="deleteOrg(\'' + escJsAttr(String(o.id)) + '\',\'' + escJsAttr(o.org_name) + '\')">'+t('common.delete')+'</button></td></tr>';
    }).join('') + '</table>';
  } else {
    document.getElementById('org-list').innerHTML = emptyState('🏢', t('orgs.emptyTitle'), t('orgs.emptyDesc'), '<button class="btn btn-primary" onclick="showAddOrg()">'+t('orgs.createOrg')+'</button>');
  }
}

function showAddOrg() {
  const body = '<div class="form-group"><label>'+t('orgs.orgNameLabel')+'</label><input type="text" id="new-org-name" placeholder="'+t('orgs.orgNamePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('orgs.displayNameLabel')+'</label><input type="text" id="new-org-display" placeholder="'+t('orgs.displayNamePlaceholder')+'"></div>' +
    '<button class="btn btn-primary" onclick="doAddOrg()">'+t('common.create')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>';
  showModal(t('orgs.createTitle'), body);
}

async function doAddOrg() {
  const org_name = document.getElementById('new-org-name').value.trim();
  const display_name = document.getElementById('new-org-display').value.trim();
  if (!org_name) { showToast(t('orgs.enterName'), 'error'); return; }
  const r = await api('/api/admin/organizations', { method: 'POST', body: JSON.stringify({ org_name, display_name }) });
  if (r.ok) { showToast(t('orgs.created')); closeModal(); renderView(); } else showToast((r.data && r.data.error) || t('common.createFailed'), 'error');
}

async function showEditOrg(orgId) {
  const r = await api('/api/admin/organizations/' + encodeURIComponent(orgId));
  if (!r.ok) { showToast(t('orgs.cannotLoad'), 'error'); return; }
  const org = r.data.organization;
  const settings = org.settings || {};
  const body = '<div class="form-group"><label>'+t('orgs.displayNameLabel')+'</label><input type="text" id="edit-org-display" value="' + escapeAttr(org.display_name || '') + '"></div>' +
    '<div class="form-group"><label>'+t('orgs.statusLabel')+'</label><select id="edit-org-status"><option value="active"' + (org.status === 'active' ? ' selected' : '') + '>active</option><option value="suspended"' + (org.status === 'suspended' ? ' selected' : '') + '>suspended</option><option value="deleted"' + (org.status === 'deleted' ? ' selected' : '') + '>deleted</option></select></div>' +
    '<h4 style="margin-top:16px;margin-bottom:8px;color:var(--text2);font-size:14px">'+t('orgs.quotaTitle')+'</h4>' +
    '<div class="form-group"><label>'+t('orgs.userLimit')+'</label><input type="number" id="edit-org-max-users" value="' + escapeAttr(settings.max_users || 100) + '" min="1"></div>' +
    '<div class="form-group"><label>'+t('orgs.wfLimit')+'</label><input type="number" id="edit-org-max-wf" value="' + escapeAttr(settings.max_workflows_per_day || 500) + '" min="0"></div>' +
    '<button class="btn btn-primary" onclick="doEditOrg(\'' + escJsAttr(String(orgId)) + '\')">'+t('orgs.saveChanges')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>';
  showModal(t('orgs.editTitle') + org.org_name, body);
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
  const r = await api('/api/admin/organizations/' + encodeURIComponent(orgId), { method: 'PUT', body: JSON.stringify(body) });
  if (r.ok) { showToast(t('orgs.updated')); closeModal(); renderView(); }
  else showToast((r.data && r.data.error) || t('orgs.updateFailed'), 'error');
}

async function deleteOrg(orgId, orgName) {
  if (!confirm(t('orgs.deleteConfirm') + orgName + t('orgs.deleteConfirmSuffix'))) return;
  const r = await api('/api/admin/organizations/' + encodeURIComponent(orgId), { method: 'DELETE' });
  if (r.ok) { showToast(t('orgs.deleted')); renderView(); }
  else showToast((r.data && r.data.error) || t('config.llm.deleteFailed'), 'error');
}

async function renderSharedKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('shared.title')+'</h2><span style="color:var(--text2);font-size:14px">'+t('shared.subtitle')+'</span></div>' +
    '<div class="card"><h3>'+t('shared.uploadTitle')+'</h3>' +
    '<div class="form-group"><label>'+t('shared.titleLabel')+'</label><input type="text" id="shared-title" placeholder="'+t('shared.titlePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('shared.contentLabel')+'</label><textarea id="shared-content" style="min-height:160px" placeholder="'+t('shared.contentPlaceholder')+'"></textarea></div>' +
    '<div class="form-group"><label>'+t('shared.sourceLabel')+'</label><select id="shared-source"><option value="manual">'+t('shared.sourceManual')+'</option><option value="template">'+t('shared.sourceTemplate')+'</option><option value="guide">'+t('shared.sourceGuide')+'</option><option value="reference">'+t('shared.sourceReference')+'</option></select></div>' +
    '<button class="btn btn-primary" onclick="doUploadShared()">'+t('shared.uploadBtn')+'</button></div>' +
    '<div class="card"><h3>'+t('shared.listTitle')+'</h3><div id="shared-list">'+t('common.loading')+'</div></div>';
  await loadSharedDocs();
}

async function loadSharedDocs() {
  let el = document.getElementById('shared-list');
  if (!el) return;
  const r = await api('/api/admin/shared-knowledge');
  if (r.ok && r.data.documents) {
    if (r.data.documents.length === 0) {
      el.innerHTML = emptyState('📚', t('shared.empty'), t('shared.emptyDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('shared.titleLabel')+'</th><th>'+t('common.type')+'</th><th>'+t('common.createdAt')+'</th><th>'+t('common.action')+'</th></tr>' +
        r.data.documents.map(function(d) { return '<tr><td>' + escapeHtml(d.title) + '</td><td>' + escapeHtml(d.source_kind || '-') + '</td><td>' + escapeHtml(d.created_at || '-') + '</td><td><button class="btn btn-sm btn-danger" onclick="deleteSharedDoc(\'' + escJsAttr(String(d.id)) + '\')">'+t('shared.remove')+'</button></td></tr>'; }).join('') + '</table>';
    }
  } else {
    el.innerHTML = '<p style="color:var(--text2)">'+t('shared.cannotLoad')+'</p>';
  }
}

async function doUploadShared() {
  const title = document.getElementById('shared-title').value.trim();
  const content = document.getElementById('shared-content').value.trim();
  const sourceKind = document.getElementById('shared-source').value || 'manual';
  if (!content) { showToast(t('shared.enterContent'), 'error'); return; }
  const r = await api('/api/admin/shared-knowledge', { method: 'POST', body: JSON.stringify({ title: title || 'Shared Doc', content, source_kind: sourceKind }) });
  if (r.ok) {
    showToast(t('shared.uploaded'));
    document.getElementById('shared-title').value = '';
    document.getElementById('shared-content').value = '';
    await loadSharedDocs();
  } else {
    showToast((r.data && r.data.error) || t('shared.uploadFailed'), 'error');
  }
}

async function deleteSharedDoc(docId) {
  if (!confirm(t('shared.removeConfirm'))) return;
  const r = await api('/api/admin/shared-knowledge/' + encodeURIComponent(docId), { method: 'DELETE' });
  if (r.ok) { showToast(t('shared.removed')); await loadSharedDocs(); }
  else showToast((r.data && r.data.error) || t('shared.removeFailed'), 'error');
}

async function renderOrgTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('tasks.title')+'</h2><button class="btn btn-primary" onclick="showAddOrgTask()">'+t('tasks.create')+'</button></div>' +
    '<div class="card" id="org-task-create" style="display:none"><h3>'+t('tasks.createTitle')+'</h3>' +
    '<div class="form-group"><label>'+t('tasks.titleLabel')+'</label><input type="text" id="ot-title" placeholder="'+t('tasks.titlePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('tasks.descLabel')+'</label><textarea id="ot-desc" placeholder="'+t('tasks.descPlaceholder')+'"></textarea></div>' +
    '<div class="form-group"><label>'+t('tasks.typeLabel')+'</label><select id="ot-type"><option value="form">'+t('tasks.typeForm')+'</option><option value="workflow">'+t('tasks.typeWorkflow')+'</option><option value="heartbeat">'+t('tasks.typeHeartbeat')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('tasks.scheduleLabel')+'</label><select id="ot-schedule" onchange="document.getElementById(\'ot-cron-row\').style.display=this.value===\'cron\'?\'block\':\'none\'"><option value="daily">'+t('tasks.scheduleDaily')+'</option><option value="weekly">'+t('tasks.scheduleWeekly')+'</option><option value="once">'+t('tasks.scheduleOnce')+'</option><option value="cron">'+t('tasks.scheduleCron')+'</option></select></div>' +
    '<div class="form-group" id="ot-cron-row" style="display:none"><label>'+t('tasks.scheduleCron')+'</label><input type="text" id="ot-cron" value="0 20 * * *" placeholder="'+t('tasks.cronPlaceholder')+'"><span class="hint-text">'+t('tasks.cronHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('tasks.promptLabel')+'</label><textarea id="ot-prompt" placeholder="'+t('tasks.promptPlaceholder')+'">'+t('tasks.promptDefault')+'</textarea></div>' +
    '<div class="form-group"><label>'+t('tasks.targetLabel')+'</label><select id="ot-org"><option value="">'+t('tasks.targetAll')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('tasks.channelLabel')+'</label><div style="display:flex;gap:8px"><label><input type="checkbox" id="ot-ch-wecom" checked> '+t('tasks.channelWecom')+'</label></div></div>' +
    '<button class="btn btn-primary" onclick="doCreateOrgTask()">'+t('tasks.dispatch')+'</button> <button class="btn btn-outline" onclick="document.getElementById(\'org-task-create\').style.display=\'none\'">'+t('common.cancel')+'</button></div>' +
    '<div class="card"><h3>'+t('tasks.existingTitle')+'</h3><div id="org-task-list">'+t('common.loading')+'</div></div>';
  await loadOrgListForTask();
  await loadOrgTasks();
}

async function loadOrgListForTask() {
  const r = await api('/api/admin/organizations');
  const sel = document.getElementById('ot-org');
  if (!sel || !r.ok) return;
  const orgs = r.data.organizations || [];
  sel.innerHTML = '<option value="">'+t('common.allOrgs')+'</option>' + orgs.map(function(o) { return '<option value="' + escapeAttr(o.id) + '">' + escapeHtml(o.display_name || o.org_name) + '</option>'; }).join('');
}

async function loadOrgTasks() {
  let el = document.getElementById('org-task-list');
  if (!el) return;
  const r = await api('/api/admin/tasks');
  if (r.ok && r.data.tasks) {
    const tasks = r.data.tasks;
    if (tasks.length === 0) {
      el.innerHTML = emptyState('📋', t('tasks.empty'), t('tasks.emptyDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('shared.titleLabel')+'</th><th>'+t('common.type')+'</th><th>'+t('common.schedule')+'</th><th>'+t('common.status')+'</th><th>'+t('common.createdAt')+'</th><th>'+t('common.action')+'</th></tr>' +
        tasks.map(function(t) {
          const stats = t.assignment_stats || [];
          const completed = stats.filter(function(s) { return s.status === 'completed'; }).length;
          const total = stats.length;
          return '<tr><td><strong>' + escapeHtml(t.title) + '</strong></td><td>' + escapeHtml(t.task_type) + '</td><td>' + escapeHtml(t.schedule_type) + (t.cron_expression ? ' (' + escapeHtml(t.cron_expression) + ')' : '') + '</td><td>' + escapeHtml(t.status) + (total > 0 ? ' <span style="font-size:12px;color:var(--text2)">(' + completed + '/' + total + ' '+t('myTasks.completed')+')</span>' : '') + '</td><td>' + escapeHtml((t.created_at && t.created_at.slice(0, 10)) || '-') + '</td><td>' +
            '<button class="btn btn-sm btn-primary" onclick="triggerOrgTask(\'' + escJsAttr(String(t.id)) + '\')">'+t('tasks.dispatchNow')+'</button> ' +
            (t.status === 'active' ? '<button class="btn btn-sm btn-warning" onclick="pauseOrgTask(\'' + escJsAttr(String(t.id)) + '\')">'+t('tasks.pause')+'</button>' : '') +
            ' <button class="btn btn-sm btn-danger" onclick="archiveOrgTask(\'' + escJsAttr(String(t.id)) + '\')">'+t('tasks.archive')+'</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('tasks.loadFailed'), t('users.checkService'));
  }
}

function showAddOrgTask() { document.getElementById('org-task-create').style.display = 'block'; }

async function doCreateOrgTask() {
  const title = document.getElementById('ot-title').value.trim();
  if (!title) { showToast(t('tasks.enterTitle'), 'error'); return; }
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
    showToast(t('task.created'));
    document.getElementById('org-task-create').style.display = 'none';
    document.getElementById('ot-title').value = '';
    await loadOrgTasks();
  } else showToast((r.data && r.data.error) || t('common.createFailed'), 'error');
}

async function triggerOrgTask(taskId) {
  if (!confirm(t('tasks.dispatchConfirm'))) return;
  const r1 = await api('/internal/tasks/assign', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  const r2 = await api('/internal/tasks/notify', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
  if (!r1.ok && !r2.ok) { showToast(t('tasks.dispatchFailed'), 'error'); return; }
  showToast(t('tasks.dispatched') + ((r1.data && r1.data.assigned) || 0) + t('tasks.notified') + ((r2.data && r2.data.notified) || 0) + t('tasks.people'));
  await loadOrgTasks();
}

async function pauseOrgTask(taskId) {
  const r = await api('/api/admin/tasks/' + encodeURIComponent(taskId), { method: 'PUT', body: JSON.stringify({ status: 'paused' }) });
  if (r.ok) { showToast(t('tasks.paused')); } else { showToast((r.data && r.data.error) || t('tasks.pauseFailed'), 'error'); }
  await loadOrgTasks();
}

async function archiveOrgTask(taskId) {
  if (!confirm(t('tasks.archiveConfirm'))) return;
  const r = await api('/api/admin/tasks/' + encodeURIComponent(taskId), { method: 'DELETE' });
  if (r.ok) { showToast(t('tasks.archived')); } else { showToast((r.data && r.data.error) || t('tasks.archiveFailed'), 'error'); }
  await loadOrgTasks();
}

async function renderMyTasks(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('myTasks.title')+'</h2></div><div class="card"><div id="my-task-list">'+t('common.loading')+'</div></div>';
  await loadMyTasks();
}

async function loadMyTasks() {
  let el = document.getElementById('my-task-list');
  if (!el) return;
  const r = await api('/api/tasks');
  if (r.ok && r.data.assignments) {
    const items = r.data.assignments;
    if (items.length === 0) {
      el.innerHTML = emptyState('📝', t('myTasks.empty'), t('myTasks.emptyDesc'));
    } else {
      el.innerHTML = items.map(function(a) {
        const completed = a.status === 'completed';
        const statusLabel = completed ? '✅ '+t('myTasks.completed') : a.status === 'notified' ? '🔔 '+t('myTasks.pending') : '⏳ '+t('myTasks.waiting');
        return '<div class="card" style="margin-bottom:12px"><h4>' + escapeHtml(a.title) + ' <span style="font-size:13px;color:var(--text2)">' + statusLabel + '</span></h4>' +
          '<p style="color:var(--text2);margin:4px 0">' + escapeHtml(a.prompt_message || '') + '</p>' +
          (completed
            ? '<p style="color:var(--success);font-size:13px">'+t('myTasks.submittedAt') + escapeHtml((a.completed_at && a.completed_at.slice(0, 16)) || '') + t('myTasks.submittedSuffix')+'</p>'
            : '<div class="form-group"><textarea id="task-resp-' + escapeAttr(a.id) + '" style="min-height:80px" placeholder="'+escapeAttr(t('myTasks.placeholder'))+'"></textarea></div>' +
              '<button class="btn btn-primary btn-sm" onclick="submitTaskResponse(\'' + escJsAttr(String(a.id)) + '\')">'+t('myTasks.submit')+'</button>') +
          '</div>';
      }).join('');
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('tasks.loadFailed'), t('users.checkService'));
  }
}

async function submitTaskResponse(assignmentId) {
  const textarea = document.getElementById('task-resp-' + assignmentId);
  const summary = textarea.value.trim();
  if (!summary) { showToast(t('shared.enterContent'), 'error'); return; }
  const r = await api('/api/tasks/' + encodeURIComponent(assignmentId) + '/submit', { method: 'POST', body: JSON.stringify({ summary }) });
  if (r.ok) { showToast(t('myTasks.submitted')); await renderView(); }
  else showToast((r.data && r.data.error) || t('myTasks.submitFailed'), 'error');
}

async function renderSkills(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('skills.title')+'</h2><div><button class="btn btn-outline btn-sm" onclick="showSearchSkill()">'+t('skills.searchMirror')+'</button> <button class="btn btn-primary btn-sm" onclick="showAddSkill()">'+t('skills.create')+'</button></div></div><div class="card"><p class="section-desc">'+t('skills.desc')+'</p><div id="skill-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/admin/skills');
  if (r.ok && r.data.skills) {
    const skills = r.data.skills;
    if (skills.length === 0) {
      document.getElementById('skill-list').innerHTML = emptyState('🔧', t('skills.emptyTitle'), t('skills.emptyDesc'), '<button class="btn btn-primary" onclick="showSearchSkill()">'+t('skills.searchMirror')+'</button> <button class="btn btn-outline" onclick="showAddSkill()">'+t('skills.manualCreate')+'</button>');
    } else {
      document.getElementById('skill-list').innerHTML = '<table><tr><th>'+t('common.name')+'</th><th>'+t('common.type')+'</th><th>'+t('common.version')+'</th><th>'+t('common.status')+'</th><th>'+t('common.source')+'</th><th>'+t('common.action')+'</th></tr>' + skills.map(function(s) {
        const meta = s.metadata || {};
        const source = meta.installed_from ? '<span class="badge badge-info">'+t('skills.mirror')+'</span>' : '<span class="badge badge-warning">'+t('skills.manual')+'</span>';
        return '<tr><td>' + escapeHtml(s.skill_name) + '</td><td>' + escapeHtml(s.skill_type || '-') + '</td><td>v' + escapeHtml(String(s.version || 1)) + '</td><td>' + statusBadge(s.status || 'active') + '</td><td>' + source + '</td><td><button class="btn btn-sm btn-outline" onclick="showSkillVersions(\'' + escJsAttr(String(s.id)) + '\')">'+t('skills.version')+'</button> <button class="btn btn-sm btn-danger" onclick="archiveSkill(\'' + escJsAttr(String(s.id)) + '\',\'' + escJsAttr(s.skill_name) + '\')">'+t('common.archive')+'</button></td></tr>';
      }).join('') + '</table>';
    }
  } else {
    document.getElementById('skill-list').innerHTML = emptyState('⚠️', t('skills.loadFailed'), t('skills.loadFailed'));
  }
}

async function archiveSkill(skillId, skillName) {
  if (!confirm(t('skills.archiveConfirm') + skillName + t('config.llm.deleteConfirmSuffix'))) return;
  const r = await api('/api/admin/skills/' + encodeURIComponent(skillId), { method: 'PUT', body: JSON.stringify({ status: 'archived' }) });
  if (r.ok) { showToast(t('skills.archived')); renderView(); }
  else { showToast((r.data && r.data.error) || t('tasks.archiveFailed'), 'error'); }
}

function showSearchSkill() {
  const body = '<div class="form-group"><label>'+t('common.search')+'</label><input type="text" id="skill-search-query" placeholder="'+t('skills.searchPlaceholder')+'"></div>' +
    '<button class="btn btn-primary" onclick="doSearchSkillMirror()">'+t('skills.searchMirror')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>' +
    '<div id="skill-search-results" style="margin-top:16px"></div>';
  showModal(t('skills.searchTitle'), body);
}

async function doSearchSkillMirror() {
  const query = document.getElementById('skill-search-query').value.trim();
  if (!query) { showToast(t('skills.enterSearch'), 'error'); return; }
  let el = document.getElementById('skill-search-results');
  el.innerHTML = '<p style="color:var(--text2)">'+t('skills.searching')+'</p>';
  const r = await api('/api/admin/skills/mirror-search?query=' + encodeURIComponent(query));
  if (!r.ok || !r.data.skills) {
    el.innerHTML = '<p style="color:var(--text2)">'+t('skills.searchFailed')+'</p>';
    return;
  }
  const results = r.data.skills;
  if (results.length === 0) {
    el.innerHTML = '<p style="color:var(--text2)">'+t('skills.noResults')+'</p>';
    return;
  }
  el.innerHTML = '<table><tr><th>'+t('common.name')+'</th><th>'+t('common.type')+'</th><th>'+t('common.description')+'</th><th>'+t('common.action')+'</th></tr>' + results.map(function(s) {
    return '<tr><td>' + escapeHtml(s.skill_name) + '</td><td>' + escapeHtml(s.skill_type || '-') + '</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml((s.description || '').substring(0, 80)) + '</td><td><button class="btn btn-sm btn-primary" onclick="doInstallSkill(\'' + escJsAttr(String(s.id)) + '\',\'' + escJsAttr(s.skill_name) + '\')">'+t('common.install')+'</button></td></tr>';
  }).join('') + '</table>';
}

async function doInstallSkill(skillId, skillName) {
  if (!confirm(t('skills.installConfirm') + skillName + t('config.llm.deleteConfirmSuffix'))) return;
  showToast(t('common.installing'));
  const r = await api('/api/admin/skills/mirror-install', { method: 'POST', body: JSON.stringify({ skill_id: skillId }) });
  if (r.ok) { showToast(t('skills.installed')); closeModal(); renderView(); }
  else { showToast((r.data && r.data.message) || (r.data && r.data.error) || t('skills.installFailed'), 'error'); }
}

async function showSkillVersions(skillId) {
  const r = await api('/api/admin/skills/' + encodeURIComponent(skillId));
  if (!r.ok || !r.data.skill) { showToast(t('skills.loadFailed'), 'error'); return; }
  const skill = r.data.skill;
  const body = '<p>'+t('skills.skillLabel') + escapeHtml(skill.skill_name) + '</p><p>'+t('skills.currentVersion')+': v' + (skill.version || 1) + '</p><p>'+t('common.status')+': ' + statusBadge(skill.status || 'active') + '</p>' +
    '<div style="margin-top:12px"><button class="btn btn-outline" onclick="closeModal()">'+t('common.close')+'</button></div>';
  showModal(t('skills.versionTitle') + ' - ' + skill.skill_name, body);
}

function showAddSkill() {
  const body = '<div class="form-group"><label>'+t('skills.nameLabel')+'</label><input type="text" id="new-skill-name" placeholder="'+t('skills.namePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('skills.typeLabel')+'</label><input type="text" id="new-skill-type" placeholder="'+t('skills.typePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('skills.descLabel')+'</label><textarea id="new-skill-desc" placeholder="'+t('skills.descPlaceholder')+'"></textarea></div>' +
    '<div class="form-group"><label>'+t('skills.defLabel')+'</label><textarea id="new-skill-def">{}</textarea></div>' +
    '<button class="btn btn-primary" onclick="doAddSkill()">'+t('common.create')+'</button> <button class="btn btn-outline" onclick="closeModal()">'+t('common.cancel')+'</button>';
  showModal(t('skills.createTitle'), body);
}

async function doAddSkill() {
  const name = document.getElementById('new-skill-name').value.trim();
  const type = document.getElementById('new-skill-type').value.trim();
  const description = document.getElementById('new-skill-desc').value.trim();
  const definition = document.getElementById('new-skill-def').value.trim();
  if (!name) { showToast(t('skills.enterName'), 'error'); return; }
  let parsedDef = {};
  try { parsedDef = JSON.parse(definition || '{}'); } catch { showToast(t('common.saveFailed'), 'error'); return; }
  const r = await api('/api/admin/skills', { method: 'POST', body: JSON.stringify({ name, type, description, definition: parsedDef }) });
  if (r.ok) { showToast(t('skills.created')); closeModal(); renderView(); } else showToast((r.data && r.data.error) || t('common.createFailed'), 'error');
}

function renderKnowledge(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('knowledge.title')+'</h2></div>' +
    '<div class="card"><p class="section-desc">'+t('knowledge.desc')+'</p></div>' +
    '<div class="card"><h3>'+t('knowledge.manualTitle')+'</h3>' +
    '<div class="form-group"><label>'+t('knowledge.titleLabel')+'</label><input type="text" id="kb-title" placeholder="'+t('knowledge.titlePlaceholder')+'"></div>' +
    '<div class="form-group"><label>'+t('knowledge.contentLabel')+'</label><textarea id="kb-content" style="min-height:200px" placeholder="'+t('knowledge.contentPlaceholder')+'"></textarea></div>' +
    '<div class="form-group"><label>'+t('knowledge.sourceLabel')+'</label><select id="kb-source-type"><option value="manual">'+t('knowledge.sourceManual')+'</option><option value="document">'+t('knowledge.sourceDoc')+'</option><option value="conversation">'+t('knowledge.sourceConv')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('knowledge.scopeLabel')+'</label><select id="kb-scope"><option value="private">'+t('knowledge.scopePrivate')+'</option><option value="public">'+t('knowledge.scopePublic')+'</option></select></div>' +
    '<div class="form-group"><label><input type="checkbox" id="kb-extract" checked> '+t('knowledge.autoExtract')+'</label></div>' +
    '<button class="btn btn-primary" onclick="doImportKnowledge()">'+t('knowledge.importBtn')+'</button></div>' +
    '<div class="card"><h3>'+t('knowledge.fileTitle')+'</h3>' +
    '<div class="form-group"><label>'+t('knowledge.fileLabel')+'</label><input type="file" id="kb-file" accept=".txt,.md,.pdf,.docx,.xlsx,.csv,.json" style="padding:8px"></div>' +
    '<p class="hint-text">'+t('knowledge.fileHint')+'</p>' +
    '<button class="btn btn-outline" onclick="doUploadKnowledgeFile()">'+t('knowledge.uploadBtn')+'</button></div>';
}

async function doImportKnowledge() {
  const title = document.getElementById('kb-title').value.trim();
  const content = document.getElementById('kb-content').value.trim();
  if (!content) { showToast(t('shared.enterContent'), 'error'); return; }
  const r = await api('/api/knowledge/import', { method: 'POST', body: JSON.stringify({ title, content, source_type: document.getElementById('kb-source-type').value || 'manual', scope: document.getElementById('kb-scope').value || 'private', auto_extract: document.getElementById('kb-extract').checked }) });
  if (r.ok) { showToast(t('knowledge.imported')); document.getElementById('kb-title').value = ''; document.getElementById('kb-content').value = ''; } else showToast((r.data && r.data.error) || t('common.importFailed'), 'error');
}

async function doUploadKnowledgeFile() {
  const fileInput = document.getElementById('kb-file');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) { showToast(t('knowledge.selectFile'), 'error'); return; }
  const file = fileInput.files[0];
  const maxSize = 2 * 1024 * 1024;
  if (file.size > maxSize) { showToast(t('common.fileSizeLimit'), 'error'); return; }
  const reader = new FileReader();
  reader.onload = async function(e) {
    const content = e.target.result;
    const title = file.name.replace(/\.[^.]+$/, '');
    const r = await api('/api/knowledge/import', { method: 'POST', body: JSON.stringify({ title, content, source_type: 'document', scope: 'private', auto_extract: true }) });
    if (r.ok) { showToast(t('knowledge.imported')); fileInput.value = ''; }
    else showToast((r.data && r.data.error) || t('common.importFailed'), 'error');
  };
  reader.onerror = function() { showToast(t('common.fileReadFailed'), 'error'); };
  reader.readAsText(file);
}

async function renderAudit(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('audit.title')+'</h2><button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div><div class="card"><div id="audit-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/admin/audit');
  if (r.ok && r.data.events) {
    document.getElementById('audit-list').innerHTML = '<table><tr><th>'+t('common.time')+'</th><th>'+t('common.action')+'</th><th>'+t('common.user')+'</th><th>'+t('common.details')+'</th></tr>' + r.data.events.map(function(e) { return '<tr><td>' + escapeHtml(e.occurred_at || '-') + '</td><td>' + escapeHtml(e.action) + '</td><td>' + escapeHtml(e.user_id || '-') + '</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(JSON.stringify(e.detail_json || {}).substring(0, 100)) + '</td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('audit-list').innerHTML = emptyState('📋', t('audit.empty'), t('audit.emptyDesc'));
  }
}

async function renderRetrieval(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('retrieval.title')+'</h2><button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div><div class="card"><div id="retrieval-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/admin/retrieval-traces');
  if (r.ok && r.data.traces) {
    document.getElementById('retrieval-list').innerHTML = '<table><tr><th>'+t('common.time')+'</th><th>'+t('common.search')+'</th><th>'+t('common.result')+'</th><th>Degraded</th></tr>' + r.data.traces.map(function(item) { return '<tr><td>' + escapeHtml(item.created_at || '-') + '</td><td>' + escapeHtml((item.query_text || '').substring(0, 50)) + '</td><td>' + escapeHtml(String(item.items_count || 0)) + '</td><td>' + (item.degraded ? '<span class="badge badge-warning">'+t('retrieval.yes')+'</span>' : '<span class="badge badge-success">'+t('retrieval.no')+'</span>') + '</td></tr>'; }).join('') + '</table>';
  } else {
    document.getElementById('retrieval-list').innerHTML = emptyState('🔍', t('retrieval.empty'), t('retrieval.emptyDesc'));
  }
}

async function renderIdentities(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('identities.title')+'</h2><button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div>' +
    '<div class="card"><p class="section-desc">'+t('identities.desc')+'</p></div>' +
    '<div class="card"><h3>'+t('identities.listTitle')+'</h3><div id="identity-list">'+t('common.loading')+'</div></div>';
  const r = await api('/api/channels/identity');
  if (r.ok && r.data.identities) {
    const identities = r.data.identities;
    if (identities.length === 0) {
      document.getElementById('identity-list').innerHTML = emptyState('🔑', t('identities.empty'), t('identities.emptyDesc'));
    } else {
      document.getElementById('identity-list').innerHTML = '<table><tr><th>'+t('common.channel')+'</th><th>'+t('common.externalId')+'</th><th>'+t('common.status')+'</th><th>'+t('common.action')+'</th></tr>' + identities.map(function(i) { return '<tr><td>' + escapeHtml(i.channel_type) + '</td><td>' + escapeHtml(i.external_identity || '-') + '</td><td>' + statusBadge(i.binding_status) + '</td><td>' + (i.binding_status === 'pending' || i.binding_status === 'conflicted' ? '<button class="btn btn-sm btn-primary" onclick="rebindIdentity(\'' + escJsAttr(i.id) + '\')">'+t('identities.bind')+'</button>' : '-') + '</td></tr>'; }).join('') + '</table>';
    }
  } else {
    document.getElementById('identity-list').innerHTML = emptyState('⚠️', t('identities.loadFailed'), t('identities.checkGateway'));
  }
}

async function rebindIdentity(id) {
  const r = await api('/api/channels/identity/' + encodeURIComponent(id) + '/rebind', { method: 'POST' });
  if (r.ok) showToast(t('identities.bindSuccess')); else showToast((r.data && r.data.error) || t('identities.bindFailed'), 'error');
  renderView();
}

async function renderDbMaint(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('db.title')+'</h2></div><div class="card"><h3>'+t('db.stats')+'</h3><div id="db-stats">'+t('common.loading')+'</div></div><div class="card"><h3>'+t('db.maintenance')+'</h3><button class="btn btn-primary" onclick="dbMaintain(\'analyze\')" style="margin-right:8px">ANALYZE</button><button class="btn btn-outline" onclick="dbMaintain(\'checkpoint\')">CHECKPOINT</button></div>';
  const r = await api('/api/admin/db/stats');
  if (r.ok && r.data.stats) {
    const s = r.data.stats;
    document.getElementById('db-stats').innerHTML = '<p>'+t('resources.dbConnections')+': ' + escapeHtml(String(s.connections || '-')) + '</p><p>'+t('resources.dbSize')+': ' + escapeHtml(s.db_size || '-') + '</p><p>'+t('resources.quotaConfig')+': ' + escapeHtml(String(s.table_count || '-')) + '</p>';
  } else {
    document.getElementById('db-stats').innerHTML = '<p style="color:var(--text2)">'+t('db.cannotLoad')+'</p>';
  }
}

async function dbMaintain(action) {
  const r = await api('/api/admin/db/maintenance', { method: 'POST', body: JSON.stringify({ action }) });
  if (r.ok) showToast(t('db.opComplete')); else showToast((r.data && r.data.error) || t('common.failed'), 'error');
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
  el.innerHTML = '<div class="page-header"><h2>'+t('review.title')+'</h2>' +
    '<div style="display:flex;gap:8px;">' +
    '<select id="status-filter" onchange="currentStatusFilter=this.value;renderView()"><option value="unconfirmed"' + (statusFilter === 'unconfirmed' ? ' selected' : '') + '>'+t('review.statusUnconfirmed')+'</option><option value="active"' + (statusFilter === 'active' ? ' selected' : '') + '>'+t('review.statusActive')+'</option><option value="rejected"' + (statusFilter === 'rejected' ? ' selected' : '') + '>'+t('review.statusRejected')+'</option></select>' +
    '<button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button></div></div>' +
    '<div class="card"><div id="review-item-list">'+t('common.loading')+'</div></div>';

  await loadReviewItems(statusFilter);
}

async function loadReviewItems(status) {
  const list = document.getElementById('review-item-list');
  if (!list) return;
  const statusLabel = status === 'unconfirmed' ? t('review.statusUnconfirmed') : status === 'active' ? t('review.statusActive') : t('review.statusRejected');

  try {
    const orgId = currentSession ? (currentSession.org_id || '') : '';
    const r = await api('/api/knowledge/review?org_id=' + encodeURIComponent(orgId) + '&status=' + encodeURIComponent(status) + '&limit=50');
    if (!r.ok || !r.data || !r.data.items) {
      list.innerHTML = emptyState('📚', t('review.emptyPrefix') + statusLabel + t('review.emptySuffix'), '');
      return;
    }

    const items = r.data.items;
    if (items.length === 0) {
      list.innerHTML = emptyState('📚', t('review.emptyPrefix') + statusLabel + t('review.emptySuffix'), '');
      return;
    }

    list.innerHTML = '<table><tr><th>'+t('review.id')+'</th><th>'+t('review.summary')+'</th><th>'+t('common.source')+'</th><th>'+t('common.submittedAt')+'</th><th>'+t('common.action')+'</th></tr>' +
      items.map(function(item) {
        let preview = (item.object_value || '').substring(0, 80) + ((item.object_value || '').length > 80 ? '...' : '');
        const sourceLabel = item.source === 'user_submitted' ? t('review.userSubmitted') : (item.source || t('review.system'));
        return '<tr><td>' + escapeHtml(String(item.fact_id || '').substring(0, 12)) + '</td>' +
          '<td>' + escapeHtml(preview) + '</td>' +
          '<td><span class="badge badge-info">' + escapeHtml(sourceLabel) + '</span></td>' +
          '<td style="font-size:13px">' + escapeHtml(String(item.created_at || '')) + '</td>' +
          '<td>' + (status === 'unconfirmed'
            ? '<button class="btn btn-sm btn-success" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'approve\')">'+t('common.approve')+'</button> ' +
              '<button class="btn btn-sm btn-primary" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'approve_shared\')">'+t('review.approveShared')+'</button> ' +
              '<button class="btn btn-sm btn-warning" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'return\')">'+t('review.return')+'</button> ' +
              '<button class="btn btn-sm btn-danger" onclick="reviewAction(\'' + escJsAttr(String(item.fact_id)) + '\',\'reject\')">'+t('common.reject')+'</button>'
            : '<span class="badge ' + (status === 'active' ? 'badge-success' : 'badge-danger') + '">' + status + '</span>') +
          '</td></tr>';
      }).join('') + '</table>';

    if (r.data.total > 50) {
      list.innerHTML += '<p class="hint-text">' + t('review.totalPrefix') + r.data.total + t('review.totalSuffix') + '</p>';
    }
  } catch {
    list.innerHTML = emptyState('⚠️', t('review.loadFailed'), t('review.checkService'));
  }
}

async function reviewAction(factId, action) {
  const actions = {
    approve: t('review.confirmApprove'),
    approve_shared: t('review.confirmShared'),
    return: t('review.confirmReturn'),
    reject: t('review.confirmReject')
  };
  if (!confirm(actions[action] || t('common.confirm'))) return;

  const r = await api('/api/knowledge/review', {
    method: 'POST',
    body: JSON.stringify({ fact_id: factId, action })
  });
  if (r.ok) {
    showToast(t('common.success'));
    renderView();
  } else {
    showToast((r.data && r.data.error) || t('common.failed'), 'error');
  }
}

async function renderResources(el) {
  el.innerHTML = '<div class="page-header"><h2>'+t('resources.title')+'</h2><div><button class="btn btn-outline btn-sm" onclick="renderView()">'+t('common.refresh')+'</button> <button class="btn btn-primary btn-sm" onclick="triggerInspection()">'+t('resources.triggerInspect')+'</button></div></div>' +
    '<div class="stat-grid" id="quota-stats-grid"></div>' +
    '<div class="card"><h3>'+t('resources.dockerMonitor')+' <span id="container-stats-time" style="font-size:12px;color:var(--text2)"></span></h3><div id="container-stats">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('resources.systemResources')+' <span id="docker-stats-time" style="font-size:12px;color:var(--text2)"></span></h3><div id="docker-stats">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('resources.inspectionReport')+'</h3><div id="inspection-report">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('resources.quotaConfig')+'</h3><div id="quota-config">'+t('common.loading')+'</div></div>';

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
    el.innerHTML = '<table><tr><th>'+t('resources.containerName')+'</th><th>'+t('resources.image')+'</th><th>'+t('common.status')+'</th><th>CPU</th><th>'+t('resources.memory')+'</th><th>'+t('resources.memoryUsage')+'</th><th>'+t('resources.networkIo')+'</th><th>'+t('resources.diskIo')+'</th></tr>' +
      containers.map(function(c) {
        const statusClass = c.status && c.status.includes('Up') ? 'badge-success' : 'badge-danger';
        return '<tr><td>' + escapeHtml(c.name) + '</td><td style="font-size:13px;color:var(--text2)">' + escapeHtml(c.image || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(c.status || '-') + '</span></td><td>' + escapeHtml(c.cpu_percent) + '</td><td>' + escapeHtml(c.memory_percent) + '</td><td style="font-size:13px">' + escapeHtml(c.memory_usage) + '</td><td style="font-size:13px">' + escapeHtml(c.net_io) + '</td><td style="font-size:13px">' + escapeHtml(c.block_io) + '</td></tr>';
      }).join('') + '</table>';
    if (timeEl) timeEl.textContent = t('resources.updated') + new Date().toLocaleTimeString();
  } else if (r.ok && !r.data.docker_available) {
    el.innerHTML = '<p style="color:var(--text2)">'+t('resources.noDocker')+'</p>';
  } else {
    el.innerHTML = '<p style="color:var(--text2)">'+t('resources.noContainerData')+'</p>';
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
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.active_workflows || 0)) + '</div><div class="stat-label">'+t('resources.activeWorkflows')+'</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.active_users || 0)) + '</div><div class="stat-label">'+t('resources.activeUsers')+'</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.total_documents || 0)) + '</div><div class="stat-label">'+t('resources.totalDocs')+'</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.total_skills || 0)) + '</div><div class="stat-label">'+t('resources.totalSkills')+'</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(s.db_size || '-') + '</div><div class="stat-label">'+t('resources.dbSize')+'</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(s.db_connections || 0)) + '</div><div class="stat-label">'+t('resources.dbConnections')+'</div></div>' +
      '</div>';
    if (timeEl) timeEl.textContent = t('resources.updated') + new Date().toLocaleTimeString();
  } else {
    el.innerHTML = '<p style="color:var(--text2)">'+t('resources.noDockerData')+'</p>';
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
  grid.innerHTML = '<div class="stat-card"><div class="stat-value">-</div><div class="stat-label">'+t('common.loading')+'</div></div>';

  const r = await api('/api/admin/quotas');
  if (!r.ok || !r.data) {
    grid.innerHTML = '<div class="stat-card"><div class="stat-value">⚠</div><div class="stat-label">'+t('resources.noQuota')+'</div></div>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  const labelMap = {
    concurrent_workflows: t('quota.concurrent'),
    daily_api_calls: t('quota.apiCalls'),
    retrieval_queries: t('quota.retrieval'),
    execution_seconds: t('quota.exec'),
    storage_bytes: t('quota.storage'),
    llm_tokens: 'LLM Tokens'
  };
  grid.innerHTML = Object.entries(quotas).map(function(_ref) { const k=_ref[0],v=_ref[1]; const q=v||{}; const limit=q.limit||q.max||'-'; const used=q.used||q.current||0; return '<div class="stat-card"><div class="stat-value">' + escapeHtml(String(used)) + ' / ' + escapeHtml(String(limit)) + '</div><div class="stat-label">' + escapeHtml(labelMap[k]||k) + '</div></div>'; }).join('');
}

async function loadInspectionReport() {
  const report = document.getElementById('inspection-report');
  if (!report) return;

  const r = await api('/api/admin/quotas/report');
  if (!r.ok || !r.data || !r.data.report) {
    report.innerHTML = '<p style="color:var(--text2)">'+t('resources.noInspection')+'</p>';
    return;
  }
  const data = r.data.report;
  const results = data.results || data.services || [];
  const inspectedAt = data.inspected_at || data.timestamp || data.finished_at || data.started_at || '';
  if (results.length === 0) {
    report.innerHTML = '<p style="color:var(--text2)">'+t('resources.noInspectionData')+'</p>';
    return;
  }
  report.innerHTML = '<p class="hint-text" style="margin-bottom:8px">'+t('resources.inspectionTime') + escapeHtml(String(inspectedAt)) + '</p>' +
    '<table><tr><th>'+t('workflows.service')+'</th><th>'+t('resources.health')+'</th><th>'+t('resources.latencyMs')+'</th><th>'+t('common.details')+'</th></tr>' +
    results.map(function(s) {
      const statusClass = s.healthy || s.status === 'healthy' ? 'badge-success' : 'badge-danger';
      const statusText = s.healthy || s.status === 'healthy' ? 'healthy' : (s.status || 'unhealthy');
      return '<tr><td>' + escapeHtml(s.service || s.service_name || s.name || '-') + '</td><td><span class="badge ' + statusClass + '">' + escapeHtml(statusText) + '</span></td><td>' + escapeHtml(String(s.latency_ms || s.latency || '-')) + '</td><td style="font-size:13px">' + escapeHtml(String(s.error || s.detail || '-')) + '</td></tr>';
    }).join('') + '</table>';
}

async function loadQuotaConfig() {
  const config = document.getElementById('quota-config');
  if (!config) return;

  const r = await api('/api/admin/quotas');
  if (!r.ok) {
    config.innerHTML = '<p style="color:var(--text2)">'+t('resources.loadFailed')+'</p>';
    return;
  }
  const quotas = r.data.quotas || r.data || {};
  const dimensions = [
    { key: 'concurrent_workflows', label: t('quota.concurrentLimit') },
    { key: 'daily_api_calls', label: t('quota.apiCallsLimit') },
    { key: 'retrieval_queries', label: t('quota.retrievalLimit') },
    { key: 'execution_seconds', label: t('quota.execLimit') },
    { key: 'storage_bytes', label: t('quota.storageLimit') },
    { key: 'llm_tokens', label: t('quota.tokensLimit') }
  ];
  config.innerHTML = dimensions.map(function(d) {
    const q = quotas[d.key] || {};
    const val = q.limit || q.max || '';
    return '<div class="form-group"><label>' + escapeHtml(d.label) + '</label><input type="number" id="quota-' + escapeAttr(d.key) + '" value="' + escapeAttr(String(val)) + '" placeholder="'+escapeAttr(t('common.noneLimit'))+'"></div>';
  }).join('') + '<button class="btn btn-primary" onclick="saveQuotaConfig()">'+t('config.save')+'</button>';
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
  if (r.ok) showToast(t('resources.quotaSaved')); else showToast((r.data && r.data.error) || t('common.saveFailed'), 'error');
}

async function triggerInspection() {
  const r = await api('/api/admin/quotas/inspect', { method: 'POST' });
  if (r.ok) {
    showToast(t('resources.inspectionTriggered'));
    setTimeout(function() { renderView(); }, 3000);
  } else {
    showToast((r.data && r.data.error) || t('resources.triggerFailed'), 'error');
  }
}

// ============================================================
// 梦境模式 UI 页面 (Dream Mode)
// ============================================================

async function renderDreamMemory(el) {
  el.innerHTML = '<div class="page-header"><h2>💤 '+t('dream.memoryTitle')+'</h2></div>' +
    '<div class="card"><h3>'+t('dream.attributionTitle')+'</h3><div id="dream-attribution-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.runsTitle')+'</h3><div id="dream-runs-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.summaryTitle')+' <span style="font-size:12px;color:var(--text2)">'+t('dream.adminOnly')+'</span></h3><div id="dream-summary-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.compressionTitle')+'</h3><div id="dream-compression-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.accessTitle')+'</h3><div id="dream-access-list">'+t('common.loading')+'</div></div>';
  await loadDreamAttribution();
  await loadDreamRuns();
  await loadDreamSummaries();
  await loadDreamCompressions();
  await loadDreamAccessLog();
}

async function loadDreamAttribution() {
  let el = document.getElementById('dream-attribution-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/attribution?org_id=' + encodeURIComponent(orgId) + '&days=30');
  if (r.ok) {
    const skills = r.data.skills || [];
    const knowledge = r.data.knowledge || [];
    const outcomes = r.data.outcomes || [];
    const outcomeSummary = outcomes.length === 0 ? t('dream.noOutcome') : outcomes.map(function(o) {
      return escapeHtml(o.outcome_status || '-') + ': ' + (o.count || 0) + ' / ' + t('dream.avgScore') + (o.avg_business_score || '-');
    }).join('　');
    const skillHtml = skills.length === 0 ? emptyState('🔧', t('dream.noAttributionSkill'), t('dream.noAttributionSkillDesc')) :
      '<table><tr><th>'+t('dream.skill')+'</th><th>'+t('dream.recall')+'</th><th>'+t('dream.injected')+'</th><th>'+t('dream.success')+'</th><th>'+t('dream.businessAvg')+'</th></tr>' +
      skills.slice(0, 8).map(function(s) {
        return '<tr><td><strong>' + escapeHtml(s.skill_name || s.skill_id || '') + '</strong></td><td>' + (s.recall_count || 0) + '</td><td>' + (s.injected_count || 0) + '</td><td>' + (s.succeeded_count || 0) + '</td><td>' + (s.avg_business_score || '-') + '</td></tr>';
      }).join('') + '</table>';
    const knowledgeHtml = knowledge.length === 0 ? emptyState('🧠', t('dream.noAttributionKnowledge'), t('dream.noAttributionKnowledgeDesc')) :
      '<table><tr><th>'+t('dream.knowledgeSource')+'</th><th>'+t('dream.item')+'</th><th>'+t('dream.recall')+'</th><th>'+t('dream.injected')+'</th><th>'+t('dream.success')+'</th><th>'+t('dream.businessAvg')+'</th></tr>' +
      knowledge.slice(0, 8).map(function(k) {
        return '<tr><td>' + escapeHtml(k.recall_source || '') + '</td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(k.item_ref || '') + '</td><td>' + (k.recall_count || 0) + '</td><td>' + (k.injected_count || 0) + '</td><td>' + (k.succeeded_count || 0) + '</td><td>' + (k.avg_business_score || '-') + '</td></tr>';
      }).join('') + '</table>';
    el.innerHTML = '<p class="section-desc">' + outcomeSummary + '</p><h4>'+t('dream.skillEffect')+'</h4>' + skillHtml + '<h4 style="margin-top:16px">'+t('dream.knowledgeEffect')+'</h4>' + knowledgeHtml;
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadAttribution'), t('dream.cannotLoadAttributionDesc'));
  }
}

async function loadDreamRuns() {
  let el = document.getElementById('dream-runs-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/runs?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.runs) {
    const runs = r.data.runs;
    if (runs.length === 0) {
      el.innerHTML = emptyState('💤', t('dream.noRuns'), t('dream.noRunsDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('common.time')+'</th><th>'+t('common.type')+'</th><th>'+t('common.status')+'</th><th>'+t('dream.scannedItems')+'</th><th>'+t('dream.compressedItems')+'</th><th>'+t('dream.factsGenerated')+'</th></tr>' +
        runs.map(function(run) {
          return '<tr><td>' + escapeHtml((run.created_at || '').slice(0, 16)) + '</td><td>' + statusBadge(run.run_type) + '</td><td>' + statusBadge(run.status) + '</td><td>' + (run.items_scanned || 0) + '</td><td>' + (run.items_compressed || 0) + '</td><td>' + (run.facts_generated || 0) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadRuns'), t('dream.cannotLoadRunsDesc'));
  }
}

async function loadDreamSummaries() {
  let el = document.getElementById('dream-summary-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/summary?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.summaries) {
    const summaries = r.data.summaries;
    if (summaries.length === 0) {
      el.innerHTML = emptyState('📝', t('dream.noSummaries'), t('dream.noSummariesDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('shared.titleLabel')+'</th><th>'+t('dream.category')+'</th><th>'+t('common.content')+'</th><th>'+t('common.status')+'</th></tr>' +
        summaries.map(function(s) {
          return '<tr><td><strong>' + escapeHtml(s.title || '') + '</strong></td><td>' + statusBadge(s.category) + '</td><td style="max-width:400px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml((s.content_text || '').substring(0, 150)) + '</td><td>' + statusBadge(s.status) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadSummaries'), t('dream.cannotLoadRunsDesc'));
  }
}

async function loadDreamCompressions() {
  let el = document.getElementById('dream-compression-list');
  const r = await api('/api/admin/dream/compressions');
  if (r.ok && r.data.logs) {
    const logs = r.data.logs;
    if (logs.length === 0) {
      el.innerHTML = emptyState('📦', t('dream.noCompressions'), t('dream.noCompressionsDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('common.time')+'</th><th>'+t('dream.originalChars')+'</th><th>'+t('dream.compressedChars')+'</th><th>'+t('dream.compressionRatio')+'</th><th>'+t('dream.method')+'</th></tr>' +
        logs.map(function(l) {
          const ratio = l.original_char_count > 0 ? Math.round((1 - l.compressed_char_count / l.original_char_count) * 100) : 0;
          return '<tr><td>' + escapeHtml((l.created_at || '').slice(0, 16)) + '</td><td>' + (l.original_char_count || 0) + '</td><td>' + (l.compressed_char_count || 0) + '</td><td>' + ratio + '%</td><td>' + escapeHtml(l.compression_method || '') + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadCompressions'), t('dream.cannotLoadRunsDesc'));
  }
}

async function loadDreamAccessLog() {
  let el = document.getElementById('dream-access-list');
  const r = await api('/api/admin/dream/access-log');
  if (r.ok && r.data.logs) {
    const logs = r.data.logs;
    if (logs.length === 0) {
      el.innerHTML = emptyState('🔒', t('dream.noAccessLog'), t('dream.noAccessLogDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('common.time')+'</th><th>'+t('common.type')+'</th><th>'+t('dream.access')+'</th><th>'+t('common.result')+'</th></tr>' +
        logs.map(function(l) {
          return '<tr><td>' + escapeHtml((l.created_at || '').slice(0, 16)) + '</td><td>' + escapeHtml(l.target_type || '') + '</td><td>' + escapeHtml(l.access_type || '') + '</td><td>' + (l.access_result === 'granted' ? '<span class="badge badge-success">'+t('dream.accessGranted')+'</span>' : '<span class="badge badge-danger">'+t('dream.accessDenied')+'</span>') + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadAccessLog'), t('dream.cannotLoadRunsDesc'));
  }
}

async function renderDreamSkills(el) {
  el.innerHTML = '<div class="page-header"><h2>🔬 '+t('dream.skillsTitle')+'</h2></div>' +
    '<div class="card"><h3>'+t('dream.wfReviewTitle')+'</h3><div style="margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="nominateWorkflowDefinitions()">'+t('dream.nominate')+'</button> <button class="btn btn-outline btn-sm" onclick="loadWorkflowDefinitionReviews()">'+t('common.refresh')+'</button></div><div id="workflow-definition-review-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.orgSkillsTitle')+'</h3><div id="org-skills-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.skillAuditTitle')+'</h3><div id="skill-audit-list">'+t('common.loading')+'</div></div>' +
    '<div class="card"><h3>'+t('dream.sceneTitle')+'</h3><div id="scene-assessment-list">'+t('common.loading')+'</div></div>';
  await loadWorkflowDefinitionReviews();
  await loadOrgSkills();
  await loadSkillAuditRecords();
  await loadSceneAssessments();
}

async function nominateWorkflowDefinitions() {
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/workflow-definition-reviews/nominate', {
    method: 'POST',
    body: JSON.stringify({ org_id: orgId, limit: 100 })
  });
  if (r.ok) {
    showToast(t('dream.nominated') + (r.data.nominated || 0) + t('dream.nominatedSuffix'));
    loadWorkflowDefinitionReviews();
  } else {
    showToast((r.data && r.data.error) || t('dream.nominateFailed'), 'error');
  }
}

async function loadWorkflowDefinitionReviews() {
  let el = document.getElementById('workflow-definition-review-list');
  if (!el) return;
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/workflow-definition-reviews?status=pending&org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.reviews) {
    const reviews = r.data.reviews;
    if (reviews.length === 0) {
      el.innerHTML = emptyState('⚙', t('dream.noReview'), t('dream.noReviewDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('common.name')+'</th><th>'+t('dream.sourceSkill')+'</th><th>'+t('dream.recall')+'</th><th>'+t('dream.success')+'</th><th>'+t('dream.businessAvg')+'</th><th>'+t('dream.auditScore')+'</th><th>'+t('common.status')+'</th><th>'+t('common.action')+'</th></tr>' +
        reviews.map(function(rw) {
          return '<tr><td><strong>' + escapeHtml(rw.name || '') + '</strong><br><span class="hint-text">' + escapeHtml(rw.workflow_type || '') + ' / ' + escapeHtml(rw.risk_level || '') + '</span></td>' +
            '<td>' + escapeHtml(rw.skill_name || rw.source_skill_id || '') + '</td>' +
            '<td>' + escapeHtml(String(rw.skill_recall_count || 0)) + '</td>' +
            '<td>' + escapeHtml(String(rw.skill_succeeded_count || 0)) + '</td>' +
            '<td>' + escapeHtml(Number(rw.avg_business_score || 0).toFixed(1)) + '</td>' +
            '<td>' + escapeHtml(Number(rw.audit_overall_score || 0).toFixed(1)) + '</td>' +
            '<td>' + statusBadge(rw.review_status || 'pending') + '</td>' +
            '<td><button class="btn btn-sm btn-success" onclick="decideWorkflowDefinitionReview(\'' + escJsAttr(rw.id) + '\',\'approve\')">'+t('common.approve')+'</button> <button class="btn btn-sm btn-danger" onclick="decideWorkflowDefinitionReview(\'' + escJsAttr(rw.id) + '\',\'reject\')">'+t('common.reject')+'</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadReview'), t('dream.cannotLoadReviewDesc'));
  }
}

async function decideWorkflowDefinitionReview(reviewId, action) {
  const notes = action === 'reject' ? (prompt(t('common.reject')) || '') : '';
  const r = await api('/api/admin/dream/workflow-definition-reviews/' + encodeURIComponent(reviewId) + '/decision', {
    method: 'POST',
    body: JSON.stringify({ action: action, notes: notes })
  });
  if (r.ok) {
    const suffix = r.data.workflow_definition_id ? ' (' + String(r.data.workflow_definition_id) + ')' : '';
    showToast(t('dream.decisionComplete') + suffix);
    loadWorkflowDefinitionReviews();
  } else {
    showToast((r.data && r.data.error) || t('dream.decisionFailed'), 'error');
  }
}

async function loadOrgSkills() {
  let el = document.getElementById('org-skills-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/org-skills?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.skills) {
    const skills = r.data.skills;
    if (skills.length === 0) {
      el.innerHTML = emptyState('🔧', t('dream.noOrgSkills'), t('dream.noOrgSkillsDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('skills.nameLabel')+'</th><th>'+t('common.type')+'</th><th>'+t('dream.category')+'</th><th>'+t('dream.installCount')+'</th><th>'+t('dream.rating')+'</th><th>'+t('common.action')+'</th></tr>' +
        skills.map(function(s) {
          return '<tr><td><strong>' + escapeHtml(s.skill_name || '') + '</strong></td><td>' + escapeHtml(s.skill_type || '') + '</td><td>' + escapeHtml(s.category || '') + '</td><td>' + (s.install_count || 0) + '</td><td>' + (s.rating_avg ? Number(s.rating_avg).toFixed(1) + ' (' + s.rating_count + ')' : '-') + '</td><td><button class="btn btn-sm btn-primary" onclick="showSkillUsage(\'' + escJsAttr(s.skill_id) + '\')">'+t('common.detail')+'</button></td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadOrgSkills'), t('dream.cannotLoadReviewDesc'));
  }
}

async function showSkillUsage(skillId) {
  const r = await api('/api/admin/dream/skill-usage?skill_id=' + encodeURIComponent(skillId) + '&days=30');
  if (r.ok && r.data.aggregate) {
    const agg = r.data.aggregate;
    const msg = t('dream.skillUsage') + '\n' + t('dream.skillUsageCalls') + (agg.total_invocations || 0) + '\n' + t('dream.skillUsageSuccess') + (agg.total_success || 0) + '\n' + t('dream.skillUsageFailure') + (agg.total_failure || 0) + '\n' + t('dream.skillUsageMaxUsers') + (agg.max_users || 0);
    showToast(msg);
  } else {
    showToast(t('common.loadFailed'), 'error');
  }
}

async function loadSkillAuditRecords() {
  let el = document.getElementById('skill-audit-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/skill-audit-records?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.records) {
    const records = r.data.records;
    if (records.length === 0) {
      el.innerHTML = emptyState('📋', t('dream.noAuditRecords'), t('dream.noAuditRecordsDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('dream.skill')+'</th><th>'+t('common.type')+'</th><th>'+t('dream.functionality')+'</th><th>'+t('dream.security')+'</th><th>'+t('dream.performance')+'</th><th>'+t('dream.orgFit')+'</th><th>'+t('dream.overall')+'</th><th>'+t('common.result')+'</th></tr>' +
        records.map(function(rec) {
          return '<tr><td>' + escapeHtml(rec.skill_name || rec.skill_id || '') + '</td><td>' + escapeHtml(rec.audit_type || '') + '</td><td>' + (rec.functionality_score || 0) + '</td><td>' + (rec.security_score || 0) + '</td><td>' + (rec.performance_score || 0) + '</td><td>' + (rec.org_fit_score || 0) + '</td><td><strong>' + (rec.overall_score || 0) + '</strong></td><td>' + statusBadge(rec.audit_result) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadAudit'), t('dream.cannotLoadReviewDesc'));
  }
}

async function loadSceneAssessments() {
  let el = document.getElementById('scene-assessment-list');
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/scenes?org_id=' + encodeURIComponent(orgId));
  if (r.ok && r.data.assessments) {
    const assessments = r.data.assessments;
    if (assessments.length === 0) {
      el.innerHTML = emptyState('🎯', t('dream.noScenes'), t('dream.noScenesDesc'));
    } else {
      el.innerHTML = '<table><tr><th>'+t('dream.scene')+'</th><th>'+t('dream.usage')+'</th><th>'+t('dream.success')+'</th><th>'+t('dream.valueScore')+'</th><th>'+t('common.status')+'</th></tr>' +
        assessments.map(function(a) {
          return '<tr><td><strong>' + escapeHtml(a.scene_name || '') + '</strong></td><td>' + (a.usage_count || 0) + '</td><td>' + (a.success_count || 0) + '</td><td><strong>' + (a.value_score || 0) + '</strong></td><td>' + statusBadge(a.status) + '</td></tr>';
        }).join('') + '</table>';
    }
  } else {
    el.innerHTML = emptyState('⚠️', t('dream.cannotLoadScenes'), t('dream.cannotLoadReviewDesc'));
  }
}

async function renderDreamConfig(el) {
  el.innerHTML = '<div class="page-header"><h2>⚙ '+t('dream.configTitle')+'</h2></div>' +
    '<div class="card"><h3>'+t('dream.scheduleConfig')+'</h3><div id="dream-config-form">'+t('common.loading')+'</div></div>';
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  const r = await api('/api/admin/dream/config?org_id=' + encodeURIComponent(orgId));
  const config = (r.ok && r.data.config) ? r.data.config : {};

  document.getElementById('dream-config-form').innerHTML =
    '<div class="form-group"><label>'+t('dream.enabled')+'</label><select id="dc-enabled"><option value="true"' + (config.enabled !== false ? ' selected' : '') + '>'+t('common.enabled')+'</option><option value="false"' + (config.enabled === false ? ' selected' : '') + '>'+t('common.disabled')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('dream.trigger')+'</label><select id="dc-trigger"><option value="auto"' + (config.dream_user_trigger === 'auto' ? ' selected' : '') + '>'+t('dream.triggerAuto')+'</option><option value="scheduled"' + (config.dream_user_trigger === 'scheduled' ? ' selected' : '') + '>'+t('dream.triggerScheduled')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('dream.hour')+'</label><input type="number" id="dc-hour" value="' + escapeAttr(config.dream_scheduled_hour || 3) + '" min="0" max="23"><span class="hint-text">'+t('dream.hourHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('dream.cooling')+'</label><input type="number" id="dc-cooling" value="' + escapeAttr(config.cooling_window_minutes || 120) + '" min="30"><span class="hint-text">'+t('dream.coolingHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('dream.threshold')+'</label><input type="number" id="dc-threshold" value="' + escapeAttr(config.compression_threshold_chars || 4000) + '" min="500"><span class="hint-text">'+t('dream.thresholdHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('dream.maxCompress')+'</label><input type="number" id="dc-max-compress" value="' + escapeAttr(config.max_compressions_per_run || 100) + '" min="1" max="500"></div>' +
    '<hr>' +
    '<div class="form-group"><label>'+t('dream.auditEnabled')+'</label><select id="dc-audit-enabled"><option value="true"' + (config.skill_audit_enabled !== false ? ' selected' : '') + '>'+t('common.enabled')+'</option><option value="false"' + (config.skill_audit_enabled === false ? ' selected' : '') + '>'+t('common.disabled')+'</option></select></div>' +
    '<div class="form-group"><label>'+t('dream.auditHour')+'</label><input type="number" id="dc-audit-hour" value="' + escapeAttr(config.skill_audit_scheduled_hour || 5) + '" min="0" max="23"><span class="hint-text">'+t('dream.auditHourHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('dream.autoPromote')+'</label><input type="number" id="dc-auto-promote" value="' + escapeAttr(config.auto_promote_threshold || 80) + '" min="0" max="100"><span class="hint-text">'+t('dream.autoPromoteHint')+'</span></div>' +
    '<div class="form-group"><label>'+t('dream.minUsage')+'</label><input type="number" id="dc-min-usage" value="' + escapeAttr(config.min_usage_for_scene_detection || 3) + '" min="1" max="100"><span class="hint-text">'+t('dream.minUsageHint')+'</span></div>' +
    '<button class="btn btn-primary" onclick="saveDreamConfig()">'+t('dream.saveConfig')+'</button> ' +
    '<button class="btn btn-primary" onclick="triggerDreamManually()">'+t('dream.triggerManually')+'</button>';
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
  if (r.ok) showToast(t('dream.configSaved')); else showToast(t('common.saveFailed'), 'error');
}

async function triggerDreamManually() {
  if (!confirm(t('dream.triggerConfirm'))) return;
  const orgId = currentSession && currentSession.org_id ? currentSession.org_id : '';
  showToast(t('dream.running'));
  const r = await api('/api/admin/dream/analyze-org', { method: 'POST', body: JSON.stringify({ org_id: orgId }) });
  if (r.ok) { showToast(t('dream.analysisComplete') + (r.data.merged_to_org || 0) + t('dream.analysisCompleteSuffix')); } else { showToast(t('dream.analysisFailed') + ((r.data && r.data.error) || t('common.unknownError')), 'error'); }
}

async function initApp() {
  initLang();
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
    document.getElementById('app').innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><h3>'+t('app.loadFailed')+'</h3><p>'+t('app.loadFailedDesc')+'</p><button class="btn btn-primary" onclick="location.reload()">'+t('app.refresh')+'</button></div>';
  }
}

initApp();
