import { createHash, createHmac } from "node:crypto";

const R2_REGION = "auto";
const S3_SERVICE = "s3";

export interface R2ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
}

export interface PutR2ObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export function getR2NettableDumpConfig(): R2ObjectStorageConfig | null {
  const bucket = firstEnv("R2_NETTABLE_DUMPS_BUCKET", "R2_BUCKET");
  const accessKeyId = firstEnv(
    "R2_NETTABLE_DUMPS_ACCESS_KEY_ID",
    "R2_ACCESS_KEY_ID",
    "AWS_ACCESS_KEY_ID"
  );
  const secretAccessKey = firstEnv(
    "R2_NETTABLE_DUMPS_SECRET_ACCESS_KEY",
    "R2_SECRET_ACCESS_KEY",
    "AWS_SECRET_ACCESS_KEY"
  );
  const accountId = firstEnv("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID");
  const endpoint =
    firstEnv("R2_NETTABLE_DUMPS_ENDPOINT", "R2_ENDPOINT") ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    keyPrefix: trimSlashes(process.env.R2_NETTABLE_DUMPS_PREFIX ?? ""),
  };
}

export function r2ObjectPath(config: R2ObjectStorageConfig, key: string): string {
  return `r2://${config.bucket}/${withPrefix(config.keyPrefix, key)}`;
}

export async function putR2Object(
  config: R2ObjectStorageConfig,
  input: PutR2ObjectInput
): Promise<void> {
  const endpoint = new URL(config.endpoint);
  const payloadHash = sha256Hex(input.body);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const key = withPrefix(config.keyPrefix, input.key);
  const canonicalUri = [
    trimSlashes(endpoint.pathname),
    encodePathSegment(config.bucket),
    encodeKeyPath(key),
  ]
    .filter(Boolean)
    .join("/");
  const requestPath = `/${canonicalUri}`;
  const requestUrl = `${endpoint.protocol}//${endpoint.host}${requestPath}`;

  const headers: Record<string, string> = {
    "content-type": input.contentType,
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");
  const credentialScope = `${dateStamp}/${R2_REGION}/${S3_SERVICE}/aws4_request`;
  const canonicalRequest = [
    "PUT",
    requestPath,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(signingKey(config.secretAccessKey, dateStamp), stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(requestUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
      Authorization: authorization,
    },
    body: Uint8Array.from(input.body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail.trim()
        ? `R2 returned HTTP ${response.status}: ${detail}`
        : `R2 returned HTTP ${response.status}`
    );
  }
}

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function withPrefix(prefix: string, key: string): string {
  const cleanKey = trimSlashes(key);
  return prefix ? `${prefix}/${cleanKey}` : cleanKey;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function encodeKeyPath(key: string): string {
  return key.split("/").map(encodePathSegment).join("/");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, R2_REGION);
  const serviceKey = hmac(regionKey, S3_SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
