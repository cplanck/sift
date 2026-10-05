import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireConfig } from "./env";
import { DomainError } from "@/domain/errors";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export function r2() {
  const config = requireConfig(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]);
  return { bucket: config.R2_BUCKET, client: new S3Client({
    region: "auto", endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { requestTimeout: 15000, connectionTimeout: 5000, throwOnRequestTimeout: true },
  }) };
}

export async function signPhotoUpload(key: string, contentType: string, byteSize: number) {
  const { client, bucket } = r2();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: byteSize }), { expiresIn: 300 });
}
export async function readPhotoObject(key: string) {
  const { client, bucket } = r2();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(20000) });
  if (!result.Body || !result.ContentLength || result.ContentLength > MAX_PHOTO_BYTES) throw new DomainError("INVALID_INPUT", "Photo is missing or too large. Please upload it again.");
  const body = result.Body;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes = await Promise.race([
    body.transformToByteArray(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new DomainError("INVALID_INPUT", "Photo storage took too long to respond. Please try again.");
        if ("destroy" in body && typeof body.destroy === "function") body.destroy(error);
        reject(error);
      }, 20000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new DomainError("INVALID_INPUT", "Choose a photo smaller than 8 MB.");
  return bytes;
}
export async function writePhotoObject(key: string, bytes: Uint8Array) {
  const { client, bucket } = r2();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "image/webp", Body: bytes }), { abortSignal: AbortSignal.timeout(20000) });
}
export async function deletePhotoObject(key: string) {
  const { client, bucket } = r2();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
}
