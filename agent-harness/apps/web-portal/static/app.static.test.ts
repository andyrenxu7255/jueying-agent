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
};

function loadStaticApp(): StaticAppExports {
  const appPath = join(process.cwd(), 'apps', 'web-portal', 'static', 'app.js');
  const source = readFileSync(appPath, 'utf8');
  const context = createContext({
    module: { exports: {} },
    exports: {},
    window: { __AH_DISABLE_AUTO_INIT__: true },
    document: {
      getElementById: () => null,
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
    },
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
  return (context.module as { exports: StaticAppExports }).exports;
}

describe('web portal static helpers', () => {
  const app = loadStaticApp();

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
});
