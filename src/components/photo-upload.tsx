"use client";
import { useId, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Copies a picked photo into memory. Files picked from the macOS Photos library
 * (or iCloud) can stop being readable later, and Chrome reports that only as
 * ERR_ACCESS_DENIED; reading at pick time keeps the bytes and explains failures.
 */
export async function snapshotPhoto(file: File) {
  try { return new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified }); }
  catch {
    throw new Error("Your browser wasn’t allowed to read this photo. If you picked it from the Photos library, drag it to your desktop first and choose it from there, or allow your browser to access Photos in System Settings → Privacy & Security.");
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };
const fromBitmap = (bitmap: ImageBitmap): Decoded => ({ source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() });

/** What the file actually contains, from its first bytes; names and types can lie. */
async function sniffPhoto(file: File) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const text = String.fromCharCode(...head.slice(4, 12));
  if (head[0] === 0xff && head[1] === 0xd8) return "JPEG";
  if (text.startsWith("ftyp") && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text.slice(4))) return "HEIC";
  if (text.startsWith("ftyp")) return text.slice(4).trim().toUpperCase() || "HEIF";
  if (head[0] === 0x89 && text.startsWith("\r\n")) return "PNG";
  return null;
}

/**
 * Opens a photo for resizing. createImageBitmap is fastest; Safari on iPhone can
 * refuse very large camera photos that an <img> opens fine; and Chrome or
 * Firefox can't read HEIC at all (macOS can hand them HEIC named ".jpeg"), so
 * HEIC falls back to a decoder that downloads only when it's needed.
 */
async function decodePhoto(file: File): Promise<Decoded> {
  const format = await sniffPhoto(file).catch(() => null);
  if (typeof createImageBitmap === "function") {
    try { return fromBitmap(await createImageBitmap(file)); } catch { /* Try the fallbacks below. */ }
  }
  if (format === "HEIC") {
    try {
      const { heicTo } = await import("heic-to/next");
      return fromBitmap(await heicTo({ blob: file, type: "bitmap" }));
    } catch { throw new Error("This HEIC photo couldn’t be converted. Try exporting it as a JPEG, or take a screenshot of it."); }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async"; image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty image");
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`This photo${format ? ` (${format})` : ""} couldn’t be opened in this browser. Try taking a screenshot of it, or choose another photo.`);
  }
}

export async function resizePhoto(file: File) {
  // Any image the browser can decode (including iPhone HEIC in Safari) is re-encoded as JPEG.
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a photo.");
  if (file.size > 30 * 1024 * 1024) throw new Error("Choose a photo smaller than 30 MB.");
  const photo = await decodePhoto(await snapshotPhoto(file));
  try {
    const ratio = Math.min(1, 2048 / Math.max(photo.width, photo.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.width * ratio)); canvas.height = Math.max(1, Math.round(photo.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn’t prepare this photo. Try another browser.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
    // Uploads pass through Sift's server, which accepts up to ~4 MB per request.
    for (const quality of [0.88, 0.78, 0.65, 0.5]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn’t prepare this photo.")), "image/jpeg", quality));
      if (blob.size <= 3.8 * 1024 * 1024) return blob;
    }
    throw new Error("This photo is too detailed to upload. Try a smaller image.");
  } finally { photo.release(); }
}

function putPhoto(url: string, blob: Blob, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url); request.setRequestHeader("Content-Type", blob.type); request.timeout = 120_000;
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      let message = "Photo upload failed. Please try again.";
      try { const data = JSON.parse(request.responseText); if (typeof data?.error === "string") message = data.error; } catch { /* Keep the general message. */ }
      reject(new Error(message));
    };
    request.onerror = () => reject(new Error("The photo couldn’t be uploaded. Check your connection and try again."));
    request.ontimeout = () => reject(new Error("Photo upload timed out. Check your connection and try again."));
    request.send(blob);
  });
}

/** Reserves, uploads (through Sift, same origin) and finalizes one prepared photo. */
export async function uploadPhoto(blob: Blob, target: { purpose: "recipe" | "import" | "cooking" | "chat"; recipeId?: string; sessionId?: string }, onProgress: (value: number) => void) {
  const upload = await api<{ id: string }>("/api/photos/uploads", { body: { ...target, contentType: blob.type, byteSize: blob.size } });
  await putPhoto(`/api/photos/${upload.id}/content`, blob, onProgress);
  return upload.id;
}

export function PhotoUpload({ recipeId, sessionId, purpose, onUploaded }: { recipeId?: string; sessionId?: string; purpose: "recipe" | "import" | "cooking"; onUploaded: (id: string) => void | Promise<void> }) {
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [stage, setStage] = useState(""), [progress, setProgress] = useState(0);
  return <div className="space-y-4 rounded-2xl border border-dashed p-5 sm:p-6">
    <div><label htmlFor={inputId} className="text-sm font-medium">{purpose === "import" ? "Recipe photo" : purpose === "cooking" ? "Add cook photos" : "Add recipe photos"}</label><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{purpose === "import" ? "A clear photo of a recipe page or handwritten card. You’ll review the extracted recipe before saving." : purpose === "cooking" ? "Photos stay with this cook, separate from your recipe’s photos." : "Keep photos of the finished dish here. Choose a cover for your Library."} Any photo up to 30 MB.</p></div>
    <Input id={inputId} type="file" accept="image/*" multiple={purpose !== "import"} disabled={busy} className="h-auto min-h-11 py-2 file:mr-3 file:text-sm" onChange={(event) => { const picked = Array.from(event.target.files ?? []); setFiles([]); void Promise.all(picked.map(snapshotPhoto)).then(setFiles, (error: unknown) => setError(error instanceof Error ? error.message : "Couldn’t read this photo.")); setError(""); setStage(""); }} />
    <Button disabled={busy || !files.length} onClick={async () => {
      setBusy(true); setError("");
      const selected = [...files];
      try {
        for (const [index, file] of selected.entries()) {
          const suffix = selected.length > 1 ? ` (${index + 1} of ${selected.length})` : "";
          setStage(`Preparing photo${suffix}`); setProgress(0);
          const blob = await resizePhoto(file);
          setStage(`Uploading photo${suffix}`);
          const id = await uploadPhoto(blob, { purpose, ...(recipeId ? { recipeId } : {}), ...(sessionId ? { sessionId } : {}) }, (value) => { setProgress(value); if (value >= 100) setStage(`Finishing photo${suffix}`); });
          await onUploaded(id);
          setFiles((remaining) => remaining.filter((item) => item !== file));
        }
        setStage(purpose === "import" ? "Photo uploaded." : "Photos added.");
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t upload this photo. Try again."); setStage(""); }
      finally { setBusy(false); }
    }}>{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{purpose === "import" ? "Upload & review" : "Upload photos"}</Button>
    {stage && <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">{stage}{stage.startsWith("Uploading") ? ` · ${progress}%` : ""}</p>{stage.startsWith("Uploading") && <progress aria-label="Upload progress" value={progress} max={100} className="h-1.5 w-full accent-foreground" />}</div>}
    {error && <p role="alert" className="text-sm leading-relaxed text-destructive">{error}</p>}
  </div>;
}
