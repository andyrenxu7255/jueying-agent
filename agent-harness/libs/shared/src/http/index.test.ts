import { describe, it, expect, jest as vi, beforeEach, afterEach } from '@jest/globals';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

import {
  readJson,
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
  const res = Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    _headers: {} as Record<string, string>,
    _data: '',
    writeHead(code: number, headers: Record<string, string>) {
      this.statusCode = code;
      this._headers = headers;
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
