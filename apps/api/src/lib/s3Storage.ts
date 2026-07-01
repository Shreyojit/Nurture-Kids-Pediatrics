import type { Response } from 'express';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

const s3 = new S3Client({ region: config.aws.region });

function isNoSuchKeyError(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

export async function putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.aws.bucket, Key: key }));
  return streamToBuffer(result.Body as Readable);
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.aws.bucket, Key: key }));
    return true;
  } catch (err) {
    if (isNoSuchKeyError(err)) return false;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.aws.bucket, Key: key }));
}

export async function deleteObjectsWithPrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: config.aws.bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    const objects = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: config.aws.bucket, Delete: { Objects: objects } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** Streams an S3 object straight to an Express response. Sends a 404 if the key doesn't exist. */
export async function streamObjectToResponse(
  key: string,
  res: Response,
  opts?: { download?: boolean; filename?: string; contentType?: string },
): Promise<void> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: config.aws.bucket, Key: key }));
    if (opts?.contentType ?? result.ContentType) {
      res.setHeader('Content-Type', opts?.contentType ?? result.ContentType!);
    }
    if (opts?.download) {
      const filename = opts.filename ?? key.split('/').pop() ?? 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    }
    const body = result.Body as Readable;
    body.pipe(res);
    await new Promise<void>((resolve, reject) => {
      body.on('end', resolve);
      body.on('error', reject);
    });
  } catch (err) {
    if (isNoSuchKeyError(err)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      return;
    }
    throw err;
  }
}
