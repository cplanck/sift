"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Check, Square } from "lucide-react";
import { cookingStepPresentation } from "@/domain/cooking-step-presentation";
import { Button } from "./ui/button";
import styles from "./cooking-mode.module.css";

type Step = { key: string; text: string; section: string };
type Props = {
  steps: Step[]; current: number; checkedSteps: string[]; disabled: boolean;
  onNavigate: (index: number) => void; actions?: ReactNode;
};

export function CookingTimeline({ steps, current, checkedSteps, disabled, onNavigate, actions }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const completedKeys = new Set(checkedSteps);
  useEffect(() => {
    const container = list.current, selected = container?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!container || !selected) return;
    const align = () => {
      const item = selected.getBoundingClientRect(), box = container.getBoundingClientRect();
      container.scrollTop += item.top - box.top - (container.clientHeight - item.height) / 2;
      container.scrollLeft += item.left - box.left - (container.clientWidth - item.width) / 2;
    };
    align();
    const observer = new ResizeObserver(align); observer.observe(container);
    return () => observer.disconnect();
  }, [current]);

  return <nav aria-label="Cooking steps" className={styles.timeline}>
    <ol ref={list}>{steps.map((step, index) => {
      const done = completedKeys.has(step.key);
      const label = cookingStepPresentation(step.text, step.section).label;
      const duration = step.text.match(/\b\d+(?:\s*[–-]\s*\d+)?\s*(?:minutes?|hours?|seconds?)\b/i)?.[0];
      return <li key={step.key}><button type="button" aria-label={`Go to step ${index + 1}: ${label}${done ? ", completed" : ""}`} title={label} aria-current={index === current ? "step" : undefined} data-complete={done} disabled={disabled} onClick={() => onNavigate(index)}><span className={styles.stepNumber}>{done ? <Check size={16} /> : index + 1}</span><span className={styles.stepLabel}>{label}{duration && <small>{duration}</small>}</span></button></li>;
    })}</ol>
    {actions}
  </nav>;
}

export function CookingStepActions({ checked, last, disabled, canFinish, onToggle, onFinish, onStop }: {
  checked: boolean; last: boolean; disabled: boolean; canFinish: boolean;
  onToggle: () => void; onFinish: () => void; onStop?: () => void;
}) {
  return <div role="group" aria-label="Cooking actions" className={styles.timelineActions}>
      <Button className={styles.complete} aria-label={last && checked ? "Finish cooking" : checked ? "Mark step unfinished" : "Mark step complete"} disabled={last && checked ? !canFinish : disabled} onClick={last && checked ? onFinish : onToggle}><Check className="size-4" />{last && checked ? "Finish cooking" : checked ? "Mark unfinished" : "Mark step complete"}</Button>
      {onStop && <Button type="button" variant="outline" className={styles.stopCook} disabled={!canFinish} onClick={onStop}><Square className="size-3" fill="currentColor" aria-hidden="true" />Stop cooking</Button>}
    </div>;
}
