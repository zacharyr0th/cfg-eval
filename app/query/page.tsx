"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RotateCcw, Send, X } from "lucide-react";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SchemaReference } from "@/components/query/schema-reference";
import { HistorySheet } from "@/components/query/history-sheet";
import { HistoryPanel } from "@/components/query/history-panel";
import { ChatTurn, Avatar } from "@/components/query/chat-turn";
import { TracePanel, type TraceTarget } from "@/components/query/trace-panel";
import { HeroBackdrop } from "@/components/hero-backdrop";
import { useQueryHistory } from "@/lib/use-query-history";
import { queryResultSchema, type QueryResultObject } from "@/lib/query-schema";

const SAMPLE_QUESTIONS = [
  "How many trips happened on 2015-08-15?",
  "Top 5 pickup neighborhoods by average tip amount in August 2015",
  "Hourly trip count on 2015-08-15",
  "Total fares collected by payment type for the whole dataset",
  "How many trips had a tip larger than the fare itself?",
];

/** A settled exchange frozen into the transcript. */
interface Turn {
  id: string;
  kind: "nl" | "sql";
  /** The NL question, or the SQL text for an edited re-run. */
  question: string;
  /** Terminal snapshot — a successful result or a streamed/HTTP error. */
  result: QueryResultObject;
}

export default function QueryPage() {
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  // The scroll viewport + the latest turn, so a new question can be pinned to the
  // top of the viewport (ChatGPT-style) instead of the transcript sticking to the
  // bottom. `viewportH` lets the last turn reserve a full screen of height so it
  // can actually scroll up to the top even when its answer is short.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTurnRef = useRef<HTMLDivElement>(null);
  const prevActiveId = useRef<string | null>(null);
  const [viewportH, setViewportH] = useState(0);

  // Monotonic ids for turns (avoids Date.now()/random; stable across renders).
  const idRef = useRef(0);
  const nextId = () => String(++idRef.current);

  // Frozen transcript + the single in-flight turn (NL stream or SQL fetch).
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeNl, setActiveNl] = useState<{ id: string; question: string } | null>(null);
  const [activeSql, setActiveSql] = useState<{ id: string; question: string; result: QueryResultObject } | null>(null);
  const [sqlBusy, setSqlBusy] = useState(false);

  // The in-flight NL turn, mirrored into a ref so the stream's completion
  // callback can always freeze it into the transcript — even if a later action
  // (new chat, edited-SQL run) cleared the React state first. This is what makes
  // a finished answer impossible to silently drop.
  const activeNlRef = useRef<{ id: string; question: string } | null>(null);

  const { entries, add, remove, clear: clearHistory } = useQueryHistory();

  // Move the in-flight NL turn into the frozen transcript exactly once, and
  // record it to history. Every terminal outcome lands — result, refusal, or
  // failure — so the panel is a faithful local log of what was asked, exactly
  // like the chat itself. Shared by onFinish/onError so both paths agree.
  const freezeNlTurn = useCallback(
    (active: { id: string; question: string }, terminal: QueryResultObject) => {
      if (activeNlRef.current?.id !== active.id) return; // already frozen / superseded
      setTurns((ts) => [...ts, { id: active.id, kind: "nl", question: active.question, result: terminal }]);
      const failed = Boolean(terminal.error);
      add({
        question: active.question,
        sql: terminal.sql ?? "",
        rowCount: !failed && Array.isArray(terminal.rows) ? terminal.rows.length : undefined,
        generationMs: terminal.generationMs,
        executionMs: failed ? undefined : terminal.executionMs,
        totalTokens: terminal.usage?.totalTokens,
        cached: terminal.cached,
        edited: false,
        outOfScope: terminal.outOfScope || undefined,
        error: terminal.error,
        errorKind: failed ? terminal.errorKind : undefined,
      });
      activeNlRef.current = null;
      setActiveNl(null);
    },
    [add],
  );

  // The Vercel AI SDK streams the route's growing JSON document and re-parses it
  // on every chunk, so `object` fills in stage by stage: SQL + token usage land
  // first (GPT-5's grammar-constrained decode), then columns/rows once ClickHouse
  // has executed. Every field is optional during the stream — see lib/query-schema.
  const {
    object,
    submit,
    isLoading,
    stop,
    clear,
  } = useObject({
    api: "/api/query",
    schema: queryResultSchema,
    // Freeze the finished turn here, deterministically, from the final object the
    // SDK hands us — not from a loading-edge effect that could read a stale value
    // or skip the freeze if state changed mid-stream. Guard on the ref: a null
    // ref means the turn was superseded (new chat / edited run), so a late
    // completion is correctly discarded instead of resurrected.
    onFinish: ({ object: finalObject, error }) => {
      const active = activeNlRef.current;
      if (!active) return;
      const o = finalObject as QueryResultObject | undefined;
      const terminal: QueryResultObject =
        o && (o.sql || o.error || o.outOfScope)
          ? o
          : {
              error: error?.message ?? "The request failed before any SQL was generated.",
              errorKind: "request_failed",
              eventId: o?.eventId,
            };
      freezeNlTurn(active, terminal);
    },
    // The route returns in-body errors as HTTP 200 (so those arrive via onFinish);
    // this fires only on a transport/network failure. Freeze an error turn so the
    // question is never left hanging. A null ref = aborted by new chat / a
    // superseded run — stay silent, it's already handled.
    onError: (e) => {
      const active = activeNlRef.current;
      if (!active) return;
      toast.error(e.message || "Query failed");
      freezeNlTurn(active, {
        error: e.message || "The request failed before any SQL was generated.",
        errorKind: "request_failed",
      });
    },
  });

  const busy = isLoading || sqlBusy;
  const empty = turns.length === 0 && !activeNl && !activeSql;

  // The turn the Trace sidebar reflects: the in-flight one (so it animates with
  // the stream), else the last frozen turn. Null until the first question runs.
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const traceTarget: TraceTarget | null = activeNl
    ? { question: activeNl.question, kind: "nl", src: object as QueryResultObject | undefined, loading: isLoading }
    : activeSql
      ? { question: activeSql.question, kind: "sql", src: activeSql.result, loading: sqlBusy }
      : lastTurn
        ? { question: lastTurn.question, kind: lastTurn.kind, src: lastTurn.result, loading: false }
        : null;

  const ask = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || busy) return;
      setInput("");
      setActiveSql(null);
      const id = nextId();
      activeNlRef.current = { id, question: trimmed };
      setActiveNl({ id, question: trimmed });
      clear();
      submit({ question: trimmed });
    },
    [busy, clear, submit],
  );

  const runSql = useCallback(
    async (rawSql: string) => {
      const sql = rawSql.trim();
      if (!sql || busy) return;
      stop();
      activeNlRef.current = null;
      setActiveNl(null);
      const id = nextId();
      setActiveSql({ id, question: sql, result: { sql } }); // optimistic: keep the SQL on screen while it runs
      setSqlBusy(true);
      try {
        const res = await fetch("/api/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql }),
        });
        const body = await res.json();
        const result: QueryResultObject = res.ok
          ? {
              sql: body.sql,
              columns: body.columns,
              rows: body.rows,
              executionMs: body.executionMs,
              eventId: body.eventId,
            }
          : { sql: body.sql ?? sql, error: body.message, errorKind: body.error, eventId: body.eventId };
        if (res.ok) {
          add({
            question: "",
            sql: body.sql,
            rowCount: Array.isArray(body.rows) ? body.rows.length : 0,
            executionMs: body.executionMs,
            edited: true,
          });
        } else {
          // Failed runs are history too — the log should match what was attempted.
          add({
            question: "",
            sql: body.sql ?? sql,
            edited: true,
            error: body.message ?? "Query failed",
            errorKind: body.error,
          });
          toast.error(body.message ?? "Query failed");
        }
        setTurns((ts) => [...ts, { id, kind: "sql", question: sql, result }]);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Network error";
        add({ question: "", sql, edited: true, error: message, errorKind: "network" });
        toast.error(message);
        setTurns((ts) => [...ts, { id, kind: "sql", question: sql, result: { sql, error: message, errorKind: "network" } }]);
      } finally {
        setActiveSql(null);
        setSqlBusy(false);
      }
    },
    [busy, stop, add],
  );

  function newChat() {
    const snapshot = turns;
    if (isLoading) stop();
    activeNlRef.current = null;
    setActiveNl(null);
    setActiveSql(null);
    setSqlBusy(false);
    setTurns([]);
    clear();
    if (snapshot.length > 0) {
      toast("Chat cleared", { action: { label: "Undo", onClick: () => setTurns(snapshot) } });
    }
  }

  function retryTurn(t: Turn) {
    if (t.kind === "nl") ask(t.question);
    else runSql(t.question);
  }

  function dismissTurn(id: string) {
    setTurns((ts) => ts.filter((t) => t.id !== id));
  }

  // Auto-grow the composer with its content, up to a max height (then it scrolls).
  // When empty, collapse to the CSS one-line min instead of measuring scrollHeight:
  // measuring an empty field during the initial (pre-layout) paint can over-report
  // and lock the box open at the max height.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (input) el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Track the scroll viewport's height so the latest turn can reserve a full
  // screen below it — that reserved space is what lets a short answer still
  // scroll its question up to the top of the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ChatGPT-style anchoring: when a *new* turn is submitted, scroll its question
  // to the top of the viewport, then leave the scroll alone so the answer streams
  // in below it (no yanking to the bottom on every chunk). Guard on a changed,
  // non-null active id so freezing a finished turn doesn't trigger a jump.
  // Instant jump (not smooth, no rAF): the new turn's reserved min-height is
  // already in this commit so layout is final; an instant scrollTop set lands the
  // question at the top and can't be cancelled by the answer streaming in below.
  // (Smooth scrolling and rAF are animation-frame driven and stall while the tab
  // is backgrounded — overflow-anchor:none on the container keeps the reflow from
  // undoing this.)
  useEffect(() => {
    const activeId = activeSql?.id ?? activeNl?.id ?? null;
    if (activeId && activeId !== prevActiveId.current) {
      const cont = scrollRef.current;
      const el = lastTurnRef.current;
      if (cont && el) {
        cont.scrollTop += el.getBoundingClientRect().top - cont.getBoundingClientRect().top - 16;
      }
    }
    prevActiveId.current = activeId;
  }, [activeNl?.id, activeSql?.id]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  }

  // The last turn shown (in-flight one if any, else the most recent frozen turn).
  // It gets the scroll anchor and reserves ~a viewport of height below it so its
  // question can be pinned to the top of the screen even when the answer is short.
  const lastId = activeSql?.id ?? activeNl?.id ?? (turns.length ? turns[turns.length - 1].id : null);
  const tail = (id: string, node: React.ReactNode) => {
    const isLast = id === lastId;
    return (
      <div
        key={id}
        ref={isLast ? lastTurnRef : undefined}
        className={isLast ? "scroll-mt-4" : undefined}
        style={isLast && viewportH ? { minHeight: viewportH - 24 } : undefined}
      >
        {node}
      </div>
    );
  };

  return (
    <div className="relative isolate flex min-h-0 w-full flex-1">
      <HeroBackdrop contentScrim />
      {/* Left sidebar (lg+): history */}
      <aside
        aria-label="Query history"
        className="hidden w-80 shrink-0 flex-col border-r border-border/50 bg-background/40 backdrop-blur-sm lg:flex"
      >
        <HistoryPanel
          entries={entries}
          onRunQuestion={ask}
          onRunSql={runSql}
          onRemove={remove}
          onClear={clearHistory}
        />
      </aside>

      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat controls — an in-flow header row above the transcript, so the
            cluster sits in the column's own layout at every breakpoint instead
            of a fixed pill hovering over the conversation. */}
        <div className="flex h-12 shrink-0 items-center justify-end gap-1 border-b border-border/50 px-4 md:px-6">
          <div className="lg:hidden">
            <HistorySheet
              entries={entries}
              onRunQuestion={ask}
              onRunSql={runSql}
              onRemove={remove}
              onClear={clearHistory}
            />
          </div>
          <SchemaReference />
          {!empty && (
            <Button
              variant="ghost"
              size="sm"
              title="New chat"
              onClick={newChat}
              disabled={busy && empty}
            >
              <RotateCcw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> New chat
            </Button>
          )}
        </div>

        {/* Transcript — overflow-anchor:none so the browser doesn't fight our
            pin-to-top scroll as the answer streams in below the question. */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto [overflow-anchor:none]">
          <div
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={busy}
            className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6"
          >
            {empty && (
              <div className="flex flex-col items-center px-4 pt-8 text-center md:pt-14">
                <Avatar className="h-12 w-12" iconClassName="h-6 w-6" />
                <h2 className="mt-4 text-title">Ask the NYC Taxi dataset</h2>
                <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
                  Type a question in plain English. GPT-5 writes a grammar-constrained SQL query — a strict
                  whitelist of allowed SQL, so it can&apos;t produce anything invalid — then we run it against
                  ClickHouse Cloud and show the table.
                </p>
                <p className="mt-2 max-w-md text-xs text-muted-foreground/80">
                  New here?{" "}
                  <Link
                    href="/about"
                    className="font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground"
                  >
                    How this works
                  </Link>{" "}
                  explains the grammar and the vocabulary.
                </p>
                <div role="group" aria-label="Sample questions" className="mt-5 flex flex-wrap justify-center gap-2">
                  {SAMPLE_QUESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => ask(s)}
                      className="rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-ring disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t) => {
              const isError = Boolean(t.result.error);
              return tail(
                t.id,
                <ChatTurn
                  question={t.question}
                  kind={t.kind}
                  src={t.result}
                  loading={false}
                  onRerun={runSql}
                  onRetry={isError ? () => retryTurn(t) : undefined}
                  onDismiss={isError ? () => dismissTurn(t.id) : undefined}
                />,
              );
            })}

            {activeNl &&
              tail(
                activeNl.id,
                <ChatTurn
                  question={activeNl.question}
                  kind="nl"
                  src={object as QueryResultObject | undefined}
                  loading={isLoading}
                  onRerun={runSql}
                />,
              )}

            {activeSql &&
              tail(
                activeSql.id,
                <ChatTurn
                  question={activeSql.question}
                  kind="sql"
                  src={activeSql.result}
                  loading={sqlBusy}
                  onRerun={runSql}
                />,
              )}
          </div>
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6"
        >
          <div className="mx-auto w-full max-w-3xl">
            <div className="flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 shadow-[var(--shadow-sm)] transition-shadow focus-within:border-primary/40 focus-within:shadow-[var(--shadow-md)]">
              <Textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="e.g. Top 10 neighborhoods by trip count"
                aria-label="Natural-language question"
                enterKeyHint="send"
                disabled={busy}
                autoFocus
                className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-5 shadow-none focus-visible:ring-0"
              />
              {input.trim() && !busy && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Clear message"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={() => {
                    setInput("");
                    taRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={busy || !input.trim()}
              >
                {busy ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* Right sidebar (xl+): the backend trace + setup behind the latest answer. */}
      <aside
        aria-label="Backend trace"
        className="hidden w-80 shrink-0 flex-col border-l border-border/50 bg-background/40 backdrop-blur-sm xl:flex"
      >
        <TracePanel target={traceTarget} />
      </aside>
    </div>
  );
}
