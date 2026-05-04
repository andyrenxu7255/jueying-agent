import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { configManager } from '@agent-harness/shared';

export type ArtifactBackend = 'localfs' | 'minio';

export interface ArtifactWriteResult {
  backend: ArtifactBackend;
  storage_ref: string;
  storage_path: string;
}

export interface ArtifactStorageConfig {
  local_root: string;
  preferred_backend: ArtifactBackend;
  endpoint?: string;
  access_key?: string;
  secret_key?: string;
  bucket?: string;
  region?: string;
  use_ssl?: boolean;
}

const DEFAULT_LOCAL_ROOT = join(process.cwd(), '.runtime', 'artifacts');

function normalizeBackend(value: string | undefined): ArtifactBackend {
  return value === 'minio' ? 'minio' : 'localfs';
}

function normalizeEndpoint(endpoint: string, useSsl: boolean): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${useSsl ? 'https' : 'http'}://${endpoint}`;
}

function sanitizePathComponent(raw: string): string {
  return (raw || '_').replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function streamToUtf8(stream: unknown): Promise<string> {
  if (typeof (stream as { transformToString?: unknown })?.transformToString === 'function') {
    return (stream as { transformToString: (encoding: string) => Promise<string> }).transformToString('utf-8');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array | Buffer | string>) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}

export class ArtifactStorage {
  readonly config: ArtifactStorageConfig;
  private readonly minioClient: S3Client | null;
  private bucketReady = false;

  constructor(config?: Partial<ArtifactStorageConfig>) {
    const cfg = configManager.get();
    const backendFromConfig = normalizeBackend(cfg.storage?.backend);
    const preferredBackend = normalizeBackend(process.env.ARTIFACT_STORAGE_BACKEND || process.env.STORAGE_BACKEND || config?.preferred_backend || backendFromConfig);
    const localRoot = config?.local_root || process.env.ARTIFACT_LOCAL_ROOT || DEFAULT_LOCAL_ROOT;
    const endpoint = process.env.MINIO_ENDPOINT || config?.endpoint || cfg.storage?.endpoint;
    const accessKey = process.env.MINIO_ACCESS_KEY || config?.access_key || cfg.storage?.access_key;
    const secretKey = process.env.MINIO_SECRET_KEY || config?.secret_key || cfg.storage?.secret_key;
    const bucket = process.env.MINIO_BUCKET || config?.bucket || cfg.storage?.bucket;
    const region = process.env.MINIO_REGION || config?.region || cfg.storage?.region || 'us-east-1';
    const useSsl = process.env.MINIO_USE_SSL
      ? process.env.MINIO_USE_SSL === 'true'
      : (config?.use_ssl ?? cfg.storage?.use_ssl ?? false);

    this.config = {
      local_root: localRoot,
      preferred_backend: preferredBackend,
      endpoint,
      access_key: accessKey,
      secret_key: secretKey,
      bucket,
      region,
      use_ssl: useSsl,
    };

    this.minioClient = this.createMinioClient();
  }

  preferredBackend(): ArtifactBackend {
    return this.config.preferred_backend;
  }

  // ── legacy: org-scoped artifact write ──
  async writeText(backend: ArtifactBackend, artifactId: string, contentText: string, orgId?: string): Promise<ArtifactWriteResult> {
    if (backend === 'minio') {
      return this.writeMinio(artifactId, contentText, orgId);
    }
    return this.writeLocal(artifactId, contentText, orgId);
  }

  async readText(backend: string, storageRef: string): Promise<string> {
    if (backend === 'minio') {
      return this.readMinio(storageRef);
    }
    return readFile(storageRef, 'utf8');
  }

  async readBuffer(backend: string, storageRef: string): Promise<Buffer> {
    if (backend === 'minio') {
      return this.readMinioBuffer(storageRef);
    }
    return readFile(storageRef);
  }

  // ── user-scoped: raw file storage (uploads) ──
  async storeUserFile(
    backend: ArtifactBackend,
    userId: string,
    orgId: string | null,
    fileBuffer: Buffer,
    originalName: string,
    monthStr: string
  ): Promise<ArtifactWriteResult> {
    const safeUserId = sanitizePathComponent(userId);
    const safeOrgId = orgId ? sanitizePathComponent(orgId) : '_no_org';
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (backend === 'minio') {
      const key = `users/${safeOrgId}/${safeUserId}/uploads/${monthStr}/${fileId}_${sanitizedName}`;
      return this.writeMinioRaw(key, fileBuffer, 'application/octet-stream');
    }

    const dirPath = join(this.config.local_root, 'users', safeOrgId, safeUserId, 'uploads', monthStr);
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, `${fileId}_${sanitizedName}`);
    await writeFile(filePath, fileBuffer);
    return {
      backend: 'localfs',
      storage_ref: filePath,
      storage_path: `users/${safeOrgId}/${safeUserId}/uploads/${monthStr}/${fileId}_${sanitizedName}`,
    };
  }

  // ── user-scoped: LLM-generated / artifact storage ──
  async storeUserArtifact(
    backend: ArtifactBackend,
    userId: string,
    orgId: string | null,
    artifactId: string,
    contentText: string,
    extension: string = 'txt'
  ): Promise<ArtifactWriteResult> {
    const safeUserId = sanitizePathComponent(userId);
    const safeOrgId = orgId ? sanitizePathComponent(orgId) : '_no_org';

    if (backend === 'minio') {
      const key = `users/${safeOrgId}/${safeUserId}/artifacts/${artifactId}.${extension}`;
      return this.writeMinioRaw(key, Buffer.from(contentText, 'utf8'), 'text/plain; charset=utf-8');
    }

    const dirPath = join(this.config.local_root, 'users', safeOrgId, safeUserId, 'artifacts');
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, `${artifactId}.${extension}`);
    await writeFile(filePath, contentText, 'utf8');
    return {
      backend: 'localfs',
      storage_ref: filePath,
      storage_path: `users/${safeOrgId}/${safeUserId}/artifacts/${artifactId}.${extension}`,
    };
  }

  // ── staging: temp pre-ingestion area ──
  async storeStaging(sessionId: string, fileName: string, buffer: Buffer): Promise<string> {
    const dirPath = join(this.config.local_root, 'staging', sanitizePathComponent(sessionId));
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, sanitizePathComponent(fileName));
    await writeFile(filePath, buffer);
    return filePath;
  }

  async readStaging(sessionId: string, fileName: string): Promise<Buffer> {
    const filePath = join(this.config.local_root, 'staging', sanitizePathComponent(sessionId), sanitizePathComponent(fileName));
    return readFile(filePath);
  }

  async cleanupStaging(sessionId: string): Promise<void> {
    const dirPath = join(this.config.local_root, 'staging', sanitizePathComponent(sessionId));
    try { await rm(dirPath, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ─── private helpers ───

  private createMinioClient(): S3Client | null {
    if (!this.config.endpoint || !this.config.access_key || !this.config.secret_key) {
      return null;
    }

    return new S3Client({
      endpoint: normalizeEndpoint(this.config.endpoint, Boolean(this.config.use_ssl)),
      region: this.config.region || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.access_key,
        secretAccessKey: this.config.secret_key,
      },
    });
  }

  private async writeLocal(artifactId: string, contentText: string, orgId?: string): Promise<ArtifactWriteResult> {
    const orgPrefix = orgId ? sanitizePathComponent(orgId) : '_shared';
    const dirPath = join(this.config.local_root, 'legacy', orgPrefix);
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, `${artifactId}.txt`);
    await writeFile(filePath, contentText, 'utf8');
    return { backend: 'localfs', storage_ref: filePath, storage_path: `legacy/${orgPrefix}/${artifactId}.txt` };
  }

  private async writeMinio(artifactId: string, contentText: string, orgId?: string): Promise<ArtifactWriteResult> {
    const orgPrefix = orgId ? sanitizePathComponent(orgId) : '_shared';
    const key = `legacy/${orgPrefix}/${artifactId}.txt`;
    return this.writeMinioRaw(key, Buffer.from(contentText, 'utf8'), 'text/plain; charset=utf-8');
  }

  private async writeMinioRaw(key: string, body: Buffer, contentType: string): Promise<ArtifactWriteResult> {
    if (!this.minioClient || !this.config.bucket) {
      throw new Error('minio_not_configured');
    }
    await this.ensureMinioBucket();
    await this.minioClient.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return {
      backend: 'minio',
      storage_ref: `minio://${this.config.bucket}/${key}`,
      storage_path: key,
    };
  }

  private async readMinio(storageRef: string): Promise<string> {
    const buf = await this.readMinioBuffer(storageRef);
    return buf.toString('utf8');
  }

  private async readMinioBuffer(storageRef: string): Promise<Buffer> {
    if (!this.minioClient) {
      throw new Error('minio_not_configured');
    }
    const parsed = this.parseMinioStorageRef(storageRef);
    const response = await this.minioClient.send(new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    }));
    return streamToBuffer(response.Body);
  }

  private async ensureMinioBucket(): Promise<void> {
    if (this.bucketReady || !this.minioClient || !this.config.bucket) return;
    try {
      await this.minioClient.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      this.bucketReady = true;
      return;
    } catch { /* create below */ }
    try {
      await this.minioClient.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
      this.bucketReady = true;
    } catch (error) {
      const msg = String(error);
      if (msg.includes('BucketAlreadyOwnedByYou') || msg.includes('BucketAlreadyExists')) {
        this.bucketReady = true;
        return;
      }
      throw error;
    }
  }

  private parseMinioStorageRef(storageRef: string): { bucket: string; key: string } {
    const match = /^minio:\/\/([^/]+)\/(.+)$/.exec(storageRef);
    if (!match) throw new Error('invalid_minio_storage_ref');
    return { bucket: match[1], key: match[2] };
  }
}

export const artifactStorage = new ArtifactStorage();
