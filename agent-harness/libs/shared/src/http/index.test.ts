import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

import {
  readJson,
  sendError,
  sendJson,
  postJson,
  extractPathname,
  verifyInternalAuth,
  getInternalAuthHeaders,
  getInternalAuthSecret,
} from './index';

function createMockReq(body?: string): IncomingMessage {
  const stream = new Readable({
    read() {
      if (body) {
        this.push(Buffer.from(body));
      }
      this.push(null);
    },
  });
  return Object.assign(stream, {
    headers: {},
    method: 'GET',
    url: '/',
  }) as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse {
  const emitter = new EventEmitter();
  const internalHeaders: Record<string, string> = {};
  const res = Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    _headers: {} as Record<string, string>,
    _data: '',
    setHeader(name: string, value: string) {
      internalHeaders[name.toLowerCase()] = value;
      return this;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      if (headers) {
        this._headers = { ...internalHeaders, ...headers };
      } else {
        this._headers = { ...internalHeaders };
      }
      this.headersSent = true;
      return this;
    },
    end(data?: string) {
      this._data = data || '';
      this.headersSent = true;
      this.emit('finish');
      return this;
    },
    getHeader(name: string) {
      return this._headers[name.toLowerCase()];
    },
  });
  return res as unknown as ServerResponse;
}

describe('readJson', () => {
  it('should parse valid JSON body', async () => {
    const req = createMockReq('{"foo": "bar"}');
    const result = await readJson(req);
    expect(result).toEqual({ foo: 'bar' });
  });

  it('should return empty object for empty body', async () => {
    const req = createMockReq('');
    const result = await readJson(req);
    expect(result).toEqual({});
  });

  it('should return empty object for whitespace body', async () => {
    const req = createMockReq('   ');
    const result = await readJson(req);
    expect(result).toEqual({});
  });

  it('should throw on body exceeding maxBodySize', async () => {
    const bigBody = JSON.stringify({ data: 'x'.repeat(1000) });
    const req = createMockReq(bigBody);
    await expect(readJson(req, 50)).rejects.toThrow('request_body_too_large');
  });

  it('should throw on invalid JSON', async () => {
    const req = createMockReq('not json');
    await expect(readJson(req)).rejects.toThrow();
  });
});

describe('sendJson', () => {
  it('should send JSON response with correct status code', () => {
    const res = createMockRes();
    sendJson(res, 201, { ok: true });
    expect(res.statusCode).toBe(201);
  });

  it('should set content-type header to application/json', () => {
    const res = createMockRes();
    sendJson(res, 200, { ok: true });
    expect(res._headers['content-type']).toBe('application/json');
  });

  it('should not write if headers already sent', () => {
    const res = createMockRes();
    res.headersSent = true;
    sendJson(res, 200, { ok: true });
    expect(res._data).toBe('');
  });
});

describe('sendError', () => {
  it('wraps errors in the standard response shape', () => {
    const res = createMockRes();
    sendError(res, 418, 'TEAPOT', 'short and stout', { kettle: true });
    expect(res.statusCode).toBe(418);
    expect(JSON.parse(res._data)).toEqual({
      ok: false,
      error: { code: 'TEAPOT', message: 'short and stout', detail: { kettle: true } },
    });
  });

  it('omits detail when no detail object is provided', () => {
    const res = createMockRes();
    sendError(res, 400, 'BAD_REQUEST', 'bad');

    expect(JSON.parse(res._data)).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'bad' },
    });
  });
});

describe('postJson', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts JSON and parses JSON responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '{"ok":true}',
    } as Response);

    await expect(postJson('http://service/path', { hello: 'world' }, 100, { 'x-test': '1' })).resolves.toEqual({
      ok: true,
      status: 201,
      body: { ok: true },
    });
    expect(global.fetch).toHaveBeenCalledWith('http://service/path', expect.objectContaining({
      method: 'POST',
      body: '{"hello":"world"}',
    }));
  });

  it('uses the default timeout when none is provided', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    } as Response);

    await expect(postJson('http://service/path', {})).resolves.toMatchObject({
      ok: true,
      status: 200,
    });
  });

  it('returns null body for non-JSON responses', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    } as Response);

    await expect(postJson('http://service/path', {}, 100)).resolves.toEqual({
      ok: false,
      status: 502,
      body: null,
    });
  });

  it('retries transient fetch failures when requested', async () => {
    jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '{}',
      } as Response);

    await expect(postJson('http://service/path', {}, 100, undefined, 1)).resolves.toEqual({
      ok: true,
      status: 200,
      body: {},
    });
  });

  it('returns status 0 for aborted requests', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    jest.spyOn(global, 'fetch').mockRejectedValue(abort);

    await expect(postJson('http://service/path', {}, 1)).resolves.toEqual({
      ok: false,
      status: 0,
      body: null,
    });
  });

  it('returns status 0 for fetch failures after retries are exhausted', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));

    await expect(postJson('http://service/path', {}, 100)).resolves.toEqual({
      ok: false,
      status: 0,
      body: null,
    });
  });
});

describe('extractPathname', () => {
  it('should extract pathname from URL', () => {
    expect(extractPathname('/foo/bar')).toBe('/foo/bar');
  });

  it('should handle full URL', () => {
    expect(extractPathname('http://localhost:3000/api/test')).toBe('/api/test');
  });

  it('should return / for undefined', () => {
    expect(extractPathname(undefined)).toBe('/');
  });

  it('should return / for empty string', () => {
    expect(extractPathname('')).toBe('/');
  });
});

describe('verifyInternalAuth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return true when INTERNAL_AUTH_SECRET is not set', () => {
    delete (process.env as Record<string, string>).INTERNAL_AUTH_SECRET;
    const req = createMockReq();
    expect(verifyInternalAuth(req)).toBe(true);
  });

  it('should reject missing secret in production', () => {
    delete (process.env as Record<string, string>).INTERNAL_AUTH_SECRET;
    process.env.NODE_ENV = 'production';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const req = createMockReq();
    expect(verifyInternalAuth(req)).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('[SECURITY] INTERNAL_AUTH_SECRET not set in production - rejecting internal request');
  });

  it('should return false when header is missing but secret is set', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const req = createMockReq();
    req.headers = {};
    expect(verifyInternalAuth(req)).toBe(false);
  });

  it('should return false for malformed header', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const req = createMockReq();
    req.headers = { 'x-internal-auth': 'bad' };
    expect(verifyInternalAuth(req)).toBe(false);
  });

  it('should return false for invalid timestamp and signature length mismatch', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const req = createMockReq();
    req.headers = { 'x-internal-auth': 'not-a-number:nonce:sig' };
    expect(verifyInternalAuth(req)).toBe(false);

    req.headers = { 'x-internal-auth': `${Date.now()}:nonce:short` };
    expect(verifyInternalAuth(req)).toBe(false);
  });

  it('should return false for expired timestamp', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const req = createMockReq();
    const oldTs = String(Date.now() - 10 * 60 * 1000);
    req.headers = { 'x-internal-auth': `${oldTs}:abc:def` };
    expect(verifyInternalAuth(req)).toBe(false);
  });

  it('should return true for valid auth header', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const headers = getInternalAuthHeaders();
    const req = createMockReq();
    req.headers = { 'x-internal-auth': headers['x-internal-auth'] };
    expect(verifyInternalAuth(req)).toBe(true);
  });
});

describe('getInternalAuthHeaders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return empty object when secret is not set', () => {
    delete (process.env as Record<string, string>).INTERNAL_AUTH_SECRET;
    expect(getInternalAuthHeaders()).toEqual({});
  });

  it('should return valid auth header when secret is set', () => {
    process.env.INTERNAL_AUTH_SECRET = 'test-secret';
    const headers = getInternalAuthHeaders();
    const authValue = headers['x-internal-auth'];
    expect(authValue).toBeDefined();
    const parts = authValue.split(':');
    expect(parts).toHaveLength(3);
    expect(Number.isFinite(Number(parts[0]))).toBe(true);
  });
});

describe('getInternalAuthSecret', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return empty string when not set', () => {
    delete (process.env as Record<string, string>).INTERNAL_AUTH_SECRET;
    expect(getInternalAuthSecret()).toBe('');
  });

  it('should return the configured secret', () => {
    process.env.INTERNAL_AUTH_SECRET = 'my-secret';
    expect(getInternalAuthSecret()).toBe('my-secret');
  });
});
