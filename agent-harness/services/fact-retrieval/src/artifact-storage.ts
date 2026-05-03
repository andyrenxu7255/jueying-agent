import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { configManager } from '@agent-harness/shared';

export type ArtifactBackend = 'localfs' | 'minio';

export interface ArtifactWriteResult {
  backend: ArtifactBackend;
  storage_ref: string;
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

export class ArtifactStorage {
  private readonly config: ArtifactStorageConfig;
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
    const orgPrefix = orgId ? orgId.replace(/[^a-zA-Z0-9_-]/g, '_') : '_shared';
    const dirPath = join(this.config.local_root, orgPrefix);
    await mkdir(dirPath, { recursive: true });
    const filePath = join(dirPath, `${artifactId}.txt`);
    await writeFile(filePath, contentText, 'utf8');
    return {
      backend: 'localfs',
      storage_ref: filePath,
    };
  }

  private async writeMinio(artifactId: string, contentText: string, orgId?: string): Promise<ArtifactWriteResult> {
    if (!this.minioClient || !this.config.bucket) {
      throw new Error('minio_not_configured');
    }

    await this.ensureMinioBucket();

    const orgPrefix = orgId ? orgId.replace(/[^a-zA-Z0-9_-]/g, '_') : '_shared';
    const key = `artifacts/${orgPrefix}/${artifactId}.txt`;
    await this.minioClient.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: contentText,
      ContentType: 'text/plain; charset=utf-8',
    }));

    return {
      backend: 'minio',
      storage_ref: `minio://${this.config.bucket}/${key}`,
    };
  }

  private async readMinio(storageRef: string): Promise<string> {
    if (!this.minioClient) {
      throw new Error('minio_not_configured');
    }

    const parsed = this.parseMinioStorageRef(storageRef);
    const response = await this.minioClient.send(new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
    }));

    return streamToUtf8(response.Body);
  }

  private async ensureMinioBucket(): Promise<void> {
    if (this.bucketReady || !this.minioClient || !this.config.bucket) {
      return;
    }

    try {
      await this.minioClient.send(new HeadBucketCommand({
        Bucket: this.config.bucket,
      }));
      this.bucketReady = true;
      return;
    } catch {
      // fall through to create the bucket on first write
    }

    try {
      await this.minioClient.send(new CreateBucketCommand({
        Bucket: this.config.bucket,
      }));
      this.bucketReady = true;
    } catch (error) {
      const message = String(error);
      if (message.includes('BucketAlreadyOwnedByYou') || message.includes('BucketAlreadyExists')) {
        this.bucketReady = true;
        return;
      }
      throw error;
    }
  }

  private parseMinioStorageRef(storageRef: string): { bucket: string; key: string } {
    const match = /^minio:\/\/([^/]+)\/(.+)$/.exec(storageRef);
    if (!match) {
      throw new Error('invalid_minio_storage_ref');
    }
    return { bucket: match[1], key: match[2] };
  }
}

export const artifactStorage = new ArtifactStorage();
