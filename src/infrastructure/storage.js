/**
 * Edikit — Object Storage Abstraction
 *
 * Provides S3-compatible file storage.
 * Supports:
 *   1. MinIO (local S3-compatible)
 *   2. AWS S3
 *   3. Local filesystem fallback (for development)
 *
 * Usage:
 *   import storage from './storage.js';
 *   await storage.put('bucket/key', buffer);
 *   const file = await storage.get('bucket/key');
 *   await storage.delete('bucket/key');
 */

import CONFIG from '../config/env.js';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// ── Storage type ──
const STORAGE_TYPE = CONFIG.STORAGE_TYPE || 'local'; // 'local' | 's3'

// ── Local storage directory ──
const LOCAL_DIR = resolve(ROOT, 'data', 'uploads');

// ── S3 client (lazy) ──
let _s3Client = null;

// ── Local filesystem helpers ──
async function localPut(key, buffer, contentType) {
  const fs = await import('fs');
  const path = await import('path');

  const filePath = path.resolve(LOCAL_DIR, key);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, buffer);
  return { key, size: buffer.length, contentType };
}

async function localGet(key) {
  const fs = await import('fs');
  const path = await import('path');

  const filePath = path.resolve(LOCAL_DIR, key);
  if (!fs.existsSync(filePath)) return null;

  const buffer = fs.readFileSync(filePath);
  return { key, data: buffer, contentType: null };
}

async function localDelete(key) {
  const fs = await import('fs');
  const path = await import('path');

  const filePath = path.resolve(LOCAL_DIR, key);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

async function localList(prefix) {
  const fs = await import('fs');
  const path = await import('path');

  const dirPath = path.resolve(LOCAL_DIR, prefix || '');
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => ({
      key: prefix ? `${prefix}/${e.name}` : e.name,
      size: fs.statSync(path.resolve(dirPath, e.name)).size,
    }));
}

// ── S3 helpers (lazy init) ──
async function getS3Client() {
  if (_s3Client) return _s3Client;

  if (!CONFIG.S3_ENDPOINT || !CONFIG.S3_REGION) {
    throw new Error('S3 not configured (S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY)');
  }

  // Dynamic import to avoid hard dependency
  const { S3Client } = await import('@aws-sdk/client-s3');
  _s3Client = new S3Client({
    endpoint: CONFIG.S3_ENDPOINT,
    region: CONFIG.S3_REGION,
    credentials: CONFIG.S3_ACCESS_KEY ? {
      accessKeyId: CONFIG.S3_ACCESS_KEY,
      secretAccessKey: CONFIG.S3_SECRET_KEY || '',
    } : undefined,
    forcePathStyle: true, // Required for MinIO
  });

  return _s3Client;
}

async function s3Put(key, buffer, contentType) {
  const client = await getS3Client();
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');

  await client.send(new PutObjectCommand({
    Bucket: CONFIG.S3_BUCKET || 'edikit',
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));

  return { key, size: buffer.length, contentType };
}

async function s3Get(key) {
  const client = await getS3Client();
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');

  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: CONFIG.S3_BUCKET || 'edikit',
      Key: key,
    }));
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return {
      key,
      data: Buffer.concat(chunks),
      contentType: response.ContentType,
    };
  } catch (err) {
    if (err.name === 'NoSuchKey') return null;
    throw err;
  }
}

async function s3Delete(key) {
  const client = await getS3Client();
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

  await client.send(new DeleteObjectCommand({
    Bucket: CONFIG.S3_BUCKET || 'edikit',
    Key: key,
  }));
  return true;
}

async function s3List(prefix) {
  const client = await getS3Client();
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

  const response = await client.send(new ListObjectsV2Command({
    Bucket: CONFIG.S3_BUCKET || 'edikit',
    Prefix: prefix || '',
  }));

  return (response.Contents || []).map((obj) => ({
    key: obj.Key,
    size: obj.Size,
  }));
}

// ── Unified storage API ──

const storage = {
  /**
   * Upload a file.
   * @param {string} key - Storage key/path (e.g., "uploads/avatar.png")
   * @param {Buffer} buffer - File contents
   * @param {string} [contentType] - MIME type
   * @returns {Promise<{key: string, size: number, contentType?: string}>}
   */
  async put(key, buffer, contentType) {
    if (STORAGE_TYPE === 's3') {
      return s3Put(key, buffer, contentType);
    }
    return localPut(key, buffer, contentType);
  },

  /**
   * Download a file.
   * @param {string} key - Storage key/path
   * @returns {Promise<{key: string, data: Buffer, contentType?: string}|null>}
   */
  async get(key) {
    if (STORAGE_TYPE === 's3') {
      return s3Get(key);
    }
    return localGet(key);
  },

  /**
   * Delete a file.
   * @param {string} key - Storage key/path
   * @returns {Promise<boolean>}
   */
  async delete(key) {
    if (STORAGE_TYPE === 's3') {
      return s3Delete(key);
    }
    return localDelete(key);
  },

  /**
   * List files with a prefix.
   * @param {string} [prefix] - Optional path prefix
   * @returns {Promise<Array<{key: string, size: number}>>}
   */
  async list(prefix) {
    if (STORAGE_TYPE === 's3') {
      return s3List(prefix);
    }
    return localList(prefix);
  },

  /**
   * Get storage type info.
   */
  getInfo() {
    return {
      type: STORAGE_TYPE,
      localDir: STORAGE_TYPE === 'local' ? LOCAL_DIR : undefined,
      s3Endpoint: STORAGE_TYPE === 's3' ? CONFIG.S3_ENDPOINT : undefined,
      s3Bucket: STORAGE_TYPE === 's3' ? (CONFIG.S3_BUCKET || 'edikit') : undefined,
    };
  },
};

export default storage;
