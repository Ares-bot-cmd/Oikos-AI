"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/states";
import { Markdown } from "@/components/markdown";
import { askAction, briefingAction, refreshInsightsAction, type AskResult } from "./actions";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const SUGGESTIONS = [
  "Which campaign generated the most bookings in the last 90 days?",
  "Which sales executive has the highest conversion rate?",
  "Which leads need immediate follow-up?",
  "How much revenue are we forecasting this month?",
  "Which projects have the lowest conversion rate?",
];

export function Assistant({ available }: { available: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setError(null);
    start(async () => {
      const r: AskResult = await askAction(next.map(({ role, content }) => ({ role, content })));
      if (r.error) setError(r.error);
      else setMessages((m) => [...m, { role: "assistant", content: r.answer ?? "", tools: r.tools }]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    });
  };

  if (!available) {
    return <div className="p-4"><Notice tone="warning">The AI assistant needs an Anthropic API key on the server (ANTHROPIC_API_KEY). The rule-based insights on this page work without it.</Notice></div>;
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-[520px] min-h-[220px] space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <p className="text-[13px] text-muted">Ask about your leads, team, campaigns, projects or revenue. Answers are computed from your live data.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:border-emerald/40 hover:text-ink">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-forest px-3 py-2 text-[13.5px] text-ivory">{m.content}</div>
          ) : (
            <div key={i} className="max-w-[95%] rounded-lg border border-line bg-surface px-3 py-2">
              <Markdown text={m.content} />
              {m.tools?.length ? <div className="mt-1.5 text-[11px] text-muted">Data used: {m.tools.map((t) => t.replace(/_/g, " ")).join(", ")}</div> : null}
            </div>
          ),
        )}
        {pending && <div className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" /> Analysing your data…</div>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          maxLength={2000}
          rows={2}
          aria-label="Ask a question about your business"
          placeholder="Ask a question about your business…"
          className="min-h-11 flex-1 resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-sm focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/15"
        />
        <Button type="submit" disabled={pending || !input.trim()} aria-label="Send"><ArrowUp className="size-4" /></Button>
      </form>
    </div>
  );
}

export function BriefingButton({ available }: { available: boolean }) {
  const [result, setResult] = useState<AskResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button variant="accent" disabled={!available || pending} onClick={() => start(async () => setResult(await briefingAction()))} title={!available ? "Requires ANTHROPIC_API_KEY" : undefined}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Generate AI briefing
      </Button>
      {result && (
        <div className="mt-3 rounded-lg border border-emerald/25 bg-emerald-soft/30 p-4">
          {result.error ? <Notice tone="danger">{result.error}</Notice> : <Markdown text={result.answer ?? ""} />}
        </div>
      )}
    </div>
  );
}

export function RefreshInsightsButton() {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(() => refreshInsightsAction())}>
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} /> Refresh insights
    </Button>
  );
}
