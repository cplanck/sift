"use client";
import { useId, useState } from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export async function resizePhoto(file: File) {
  // Any image the browser can decode (including iPhone HEIC in Safari) is re-encoded as JPEG.
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a photo.");
  if (file.size > 30 * 1024 * 1024) throw new Error("Choose a photo smaller than 30 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This photo couldn’t be opened. Try another JPEG, PNG, or WebP."); });
  try {
    const ratio = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn’t prepare this photo. Try another browser.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Uploads pass through Sift's server, which accepts up to ~4 MB per request.
    for (const quality of [0.88, 0.78, 0.65, 0.5]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn’t prepare this photo.")), "image/jpeg", quality));
      if (blob.size <= 3.8 * 1024 * 1024) return blob;
    }
    throw new Error("This photo is too detailed to upload. Try a smaller image.");
  } finally { bitmap.close(); }
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
    <div><label htmlFor={inputId} className="text-sm font-medium">{purpose === "import" ? "Recipe photo" : purpose === "cooking" ? "Add cook photos" : "Add recipe photos"}</label><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{purpose === "import" ? "A clear photo of a recipe page or handwritten card. You’ll review the extracted recipe before saving." : purpose === "cooking" ? "Photos stay with this cook, separate from your recipe’s photos." : "Keep photos of the finished dish here. Choose a cover for your Library."} JPEG, PNG, or WebP, up to 30 MB each.</p></div>
    <Input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" multiple={purpose !== "import"} disabled={busy} className="h-auto min-h-11 py-2 file:mr-3 file:text-sm" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setError(""); setStage(""); }} />
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
