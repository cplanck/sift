"use client";
import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { api } from "@/lib/client-http";
import type { Conversation } from "./assistant-shell";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";

type ModelOptions = { defaultId: string; options: { id: string; label: string; description: string }[] };
export function ModelSelector({ conversation, disabled, onBusy, onChanged }: { conversation: Conversation; disabled: boolean; onBusy: (value: boolean) => void; onChanged: (conversation: Conversation) => void }) {
  const [models, setModels] = useState<ModelOptions | null>(null), [error, setError] = useState(""), [saving, setSaving] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<ModelOptions>("/api/assistant/models", { signal: controller.signal }).then(setModels).catch(() => { if (!controller.signal.aborted) setError("Couldn’t load the available models."); });
    return () => controller.abort();
  }, [attempt]);
  const effectiveId = conversation.modelId ?? models?.defaultId;
  const label = models?.options.find((model) => model.id === effectiveId)?.label ?? effectiveId ?? "Loading models…";
  async function select(value: string) {
    const modelId = value === "default" ? null : value;
    if (saving || disabled || modelId === conversation.modelId) return;
    setSaving(true); onBusy(true); setError("");
    try {
      onChanged(await api<Conversation>(`/api/conversations/${conversation.id}/model`, { method: "PATCH", body: { modelId, expectedModelId: conversation.modelId } }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn’t change the model.");
      // Reconcile a concurrent selection or approval before another attempt.
      await api<Conversation>(`/api/conversations/${conversation.id}`).then(onChanged).catch(() => {});
    } finally { setSaving(false); onBusy(false); }
  }
  return <div className="mb-2">
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" className="max-w-full gap-2 px-2 text-xs text-muted-foreground" aria-label={`Assistant model: ${label}`} disabled={disabled || saving || !models}>
      {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}<span className="truncate">{label}</span><ChevronDown className="size-3.5" />
    </Button></DropdownMenuTrigger><DropdownMenuContent align="start" side="top" className="w-72 max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel>Model for this conversation</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={conversation.modelId ?? "default"} onValueChange={(value) => { void select(value); }}>
        <DropdownMenuRadioItem value="default" className="min-h-11">App default</DropdownMenuRadioItem><DropdownMenuSeparator />
        {models?.options.map((model) => <DropdownMenuRadioItem key={model.id} value={model.id} className="min-h-14 py-2"><span><span className="block">{model.label}</span><span className="mt-1 block text-xs text-muted-foreground">{model.description}</span></span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent></DropdownMenu>
    {error && <div className="px-2 pb-2"><p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>{!models && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Reload models</Button>}</div>}
  </div>;
}
