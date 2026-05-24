import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

type StaticAppExports = {
  escapeHtml: (value: unknown) => string;
  escapeAttr: (value: unknown) => string;
  escJsAttr: (value: unknown) => string;
  statusBadge: (status: string) => string;
  humanBytes: (value: unknown) => string;
  emptyState: (icon: string, title: string, desc: string, actionHtml?: string) => string;
  arrayBufferToBase64: (buffer: ArrayBuffer) => string;
  passwordStrengthHtml: (score: number) => string;
  parseHashView: () => string;
  syncCurrentViewFromHash: (navItems: Array<{ section: string; items: Array<{ key: string }> }>) => Record<string, boolean>;
  setCurrentView: (view: string, updateHash: boolean) => void;
  __getCurrentView: () => string;
  __setCurrentView: (view: string) => void;
};

type LoadedStaticApp = {
  app: StaticAppExports;
  windowMock: { location: { hash: string }; addEventListener: jest.Mock };
  documentMock: {
    getElementById: jest.Mock;
    querySelectorAll: jest.Mock;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
  };
};

function loadStaticApp(): LoadedStaticApp {
  const appPath = join(process.cwd(), 'apps', 'web-portal', 'static', 'app.js');
  const source = readFileSync(appPath, 'utf8');
  const windowMock = {
    __AH_DISABLE_AUTO_INIT__: true,
    location: { hash: '' },
    addEventListener: jest.fn(),
  };
  const documentMock = {
    getElementById: jest.fn(() => null),
    querySelectorAll: jest.fn(() => []),
    createElement: () => ({
      appendChild: jest.fn(),
      remove: jest.fn(),
      addEventListener: jest.fn(),
      querySelector: () => null,
    }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    body: { appendChild: jest.fn() },
    documentElement: {},
  };
  const context = createContext({
    module: { exports: {} },
    exports: {},
    window: windowMock,
    document: documentMock,
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    },
    fetch: jest.fn(),
    setTimeout: jest.fn(),
    clearTimeout: jest.fn(),
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
    Uint8Array,
    ArrayBuffer,
    Number,
    String,
    Math,
    JSON,
    Date,
    console,
    LOCALE: { lang: 'zh-CN' },
    t: (key: string) => key,
  });

  new Script(source, { filename: appPath }).runInContext(context);
  return {
    app: (context.module as { exports: StaticAppExports }).exports,
    windowMock,
    documentMock,
  };
}

describe('web portal static helpers', () => {
  const { app } = loadStaticApp();

  it('escapes HTML text and attributes consistently', () => {
    expect(app.escapeHtml('<script>"x"&\'y</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&lt;/script&gt;');
    expect(app.escapeAttr('a"b<c')).toBe('a&quot;b&lt;c');
  });

  it('escapes inline JavaScript attributes without breaking quoted handlers', () => {
    const escaped = app.escJsAttr("a'b\n<c>&");
    expect(escaped).toContain('\\x27');
    expect(escaped).toContain('\\n');
    expect(escaped).toContain('&lt;c&gt;');
    expect(escaped).toContain('&amp;');
  });

  it('formats bytes and Docker-style size strings into human scale values', () => {
    expect(app.humanBytes(0)).toBe('0 B');
    expect(app.humanBytes(1024)).toBe('1 KB');
    expect(app.humanBytes('1048576')).toBe('1 MB');
    expect(app.humanBytes('1.5GB')).toBe('1.5 GB');
    expect(app.humanBytes('bad-value')).toBe('bad-value');
  });

  it('renders status badges with semantic classes', () => {
    expect(app.statusBadge('completed')).toContain('badge-success');
    expect(app.statusBadge('failed')).toContain('badge-danger');
    expect(app.statusBadge('running')).toContain('badge-info');
  });

  it('renders empty states without injecting user-controlled HTML', () => {
    const html = app.emptyState('!', '<unsafe>', 'desc & more', '<button>ok</button>');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).toContain('desc &amp; more');
    expect(html).toContain('<button>ok</button>');
  });

  it('converts ArrayBuffer to base64 by chunks', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    expect(app.arrayBufferToBase64(bytes.buffer)).toBe('SGVsbG8=');
  });

  it('renders password strength safely for weak and strong scores', () => {
    expect(app.passwordStrengthHtml(1)).toContain('var(--danger)');
    expect(app.passwordStrengthHtml(6)).toContain('width:100%');
    expect(app.passwordStrengthHtml(6)).toContain('var(--success)');
  });

  it('does not expose default password hints on the login screen', () => {
    const localization = readFileSync(join(process.cwd(), 'apps', 'web-portal', 'static', 'localization.js'), 'utf8');

    expect(localization).not.toContain('admin/admin');
    expect(localization).not.toContain('默认用户名/密码');
    expect(localization).not.toContain('Default username/password');
  });
});

describe('web portal hash navigation', () => {
  it('opens a permitted hash view directly after login/render', () => {
    const { app, windowMock } = loadStaticApp();
    windowMock.location.hash = '#proactive';

    const visible = app.syncCurrentViewFromHash([
      { section: 'overview', items: [{ key: 'dashboard' }] },
      { section: 'dispatch', items: [{ key: 'org-tasks' }, { key: 'proactive' }] },
    ]);

    expect(visible.proactive).toBe(true);
    expect(app.__getCurrentView()).toBe('proactive');
  });

  it('falls back to dashboard when hash is not visible to the role', () => {
    const { app, windowMock } = loadStaticApp();
    app.__setCurrentView('proactive');
    windowMock.location.hash = '#dream-config';

    app.syncCurrentViewFromHash([
      { section: 'overview', items: [{ key: 'dashboard' }] },
      { section: 'my', items: [{ key: 'my-tasks' }] },
    ]);

    expect(app.__getCurrentView()).toBe('dashboard');
  });

  it('keeps navigation highlight and address hash in sync on clicks', () => {
    const { app, windowMock, documentMock } = loadStaticApp();
    const proactiveLink = { dataset: { view: 'proactive' }, classList: { toggle: jest.fn() } };
    const dashboardLink = { dataset: { view: 'dashboard' }, classList: { toggle: jest.fn() } };
    const mainContent = { innerHTML: '' };
    documentMock.querySelectorAll.mockReturnValue([proactiveLink, dashboardLink]);
    documentMock.getElementById.mockImplementation((id: string) => (id === 'main-content' ? mainContent : null));

    app.setCurrentView('proactive', true);

    expect(windowMock.location.hash).toBe('proactive');
    expect(proactiveLink.classList.toggle).toHaveBeenCalledWith('active', true);
    expect(dashboardLink.classList.toggle).toHaveBeenCalledWith('active', false);
  });
});
