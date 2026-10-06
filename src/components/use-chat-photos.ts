"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-http";
import { putPhoto, resizePhoto } from "./photo-upload";

export const maxChatPhotos = 4;
export type ChatPhoto = { key: string; preview: string; status: "uploading" | "ready" | "error"; progress: number; id?: string; error?: string };

/** Uploads attached photos as soon as they're picked so sending is instant. */
export function useChatPhotos() {
  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const tasks = useRef(new Map<string, Promise<string>>());
  const latest = useRef(photos);
  useEffect(() => { latest.current = photos; }, [photos]);
  useEffect(() => () => { for (const photo of latest.current) URL.revokeObjectURL(photo.preview); }, []);
  const patch = useCallback((key: string, change: Partial<ChatPhoto>) => setPhotos((current) => current.map((photo) => photo.key === key ? { ...photo, ...change } : photo)), []);

  const add = useCallback((files: File[]) => {
    const room = maxChatPhotos - latest.current.length;
    const accepted = files.filter((file) => !file.type || file.type.startsWith("image/")).slice(0, Math.max(0, room));
    const added = accepted.map((file) => ({ file, photo: { key: crypto.randomUUID(), preview: URL.createObjectURL(file), status: "uploading" as const, progress: 0 } }));
    if (!added.length) return files.length > 0;
    setPhotos((current) => [...current, ...added.map(({ photo }) => photo)]);
    for (const { file, photo } of added) {
      const task = (async () => {
        const blob = await resizePhoto(file);
        const upload = await api<{ id: string; url: string }>("/api/photos/uploads", { body: { purpose: "chat", contentType: blob.type, byteSize: blob.size } });
        await putPhoto(upload.url, blob, (progress) => patch(photo.key, { progress }));
        await api(`/api/photos/${upload.id}/complete`, { method: "POST" });
        patch(photo.key, { status: "ready", id: upload.id, progress: 100 });
        return upload.id;
      })();
      task.catch((error: unknown) => patch(photo.key, { status: "error", error: error instanceof Error ? error.message : "Couldn’t upload this photo." }));
      tasks.current.set(photo.key, task);
    }
    return files.length > accepted.length;
  }, [patch]);

  const remove = useCallback((key: string) => {
    setPhotos((current) => { const photo = current.find((item) => item.key === key); if (photo) URL.revokeObjectURL(photo.preview); return current.filter((item) => item.key !== key); });
    tasks.current.delete(key);
  }, []);
  const clear = useCallback(() => {
    for (const photo of latest.current) URL.revokeObjectURL(photo.preview);
    tasks.current.clear(); setPhotos([]);
  }, []);
  /** Resolves with every attached photo's id once uploads finish; rejects if any failed. */
  const ready = useCallback(() => Promise.all(latest.current.map((photo) => tasks.current.get(photo.key) ?? Promise.reject(new Error("Attach that photo again.")))), []);

  return { photos, add, remove, clear, ready, uploading: photos.some((photo) => photo.status === "uploading"), failed: photos.some((photo) => photo.status === "error") };
}
