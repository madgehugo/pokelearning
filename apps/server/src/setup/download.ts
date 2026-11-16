/** Download a file with progress, via a .part file so a broken download never looks finished. */
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

export type Progress = (fraction: number | null, detail: string) => void;

export async function download(url: string, dest: string, onProgress: Progress, label: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`couldn't download ${label} (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  const body = Readable.fromWeb(res.body as ReadableStream);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const mb = (received / 1e6).toFixed(0);
    onProgress(total ? received / total : null, `Downloading ${label}: ${mb}${total ? ` of ${(total / 1e6).toFixed(0)}` : ""} MB`);
  });
  await pipeline(body, fs.createWriteStream(`${dest}.part`));
  fs.renameSync(`${dest}.part`, dest);
}
