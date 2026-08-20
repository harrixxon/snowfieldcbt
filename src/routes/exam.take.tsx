import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getExamState, saveAnswer, submitExam, logTabSwitch } from "@/lib/exam.functions";

export const Route = createFileRoute("/exam/take")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Exam in Progress — School CBT Portal" },
      { name: "description", content: "Answer one question at a time with a server-tracked countdown." },
      { property: "og:title", content: "Exam in Progress — School CBT Portal" },
      { property: "og:description", content: "Answer one question at a time with a server-tracked countdown." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamTake,
});

const LETTERS = ["A", "B", "C", "D"];

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function ExamTake() {
  const navigate = useNavigate();
  const fetchState = useServerFn(getExamState);
  const persistAnswer = useServerFn(saveAnswer);
  const finish = useServerFn(submitExam);
  const reportBlur = useServerFn(logTabSwitch);

  const { data, isPending } = useQuery({ queryKey: ["exam-state"], queryFn: () => fetchState({}) });

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const offsetRef = useRef(0);
  const submittedRef = useRef(false);

  const state = data && !("error" in data) && data.submitted === false ? data : null;

  useEffect(() => {
    if (!state) return;
    setAnswers(
      Object.fromEntries(
        state.questions
          .filter((q) => q.selectedIndex !== null)
          .map((q) => [q.id, q.selectedIndex as number]),
      ),
    );
    offsetRef.current = Date.now() - new Date(state.serverNow).getTime();
    const stored = window.sessionStorage.getItem(`cbt-flags-${state.attemptId}`);
    if (stored) setFlags(JSON.parse(stored) as Record<string, boolean>);
  }, [state]);

  const doSubmit = useCallback(
    async (_auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      await finish({});
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      await navigate({ to: "/exam/done" });
    },
    [finish, navigate],
  );

  useEffect(() => {
    if (!state) return;
    const expiry = new Date(state.expiresAt).getTime();
    const tick = () => {
      const left = expiry - (Date.now() - offsetRef.current);
      setRemaining(left);
      if (left <= 0) void doSubmit(true);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state, doSubmit]);

  useEffect(() => {
    if (!state) return;
    const block = (e: Event) => e.preventDefault();
    const onBlur = () => void reportBlur({});
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("paste", block);
    document.addEventListener("cut", block);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("paste", block);
      document.removeEventListener("cut", block);
      window.removeEventListener("blur", onBlur);
    };
  }, [state, reportBlur]);

  useEffect(() => {
    if (data && !("error" in data) && data.submitted) {
      void navigate({ to: "/exam/done" });
    }
  }, [data, navigate]);

  const current = state?.questions[index];
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  function toggleFlag(questionId: string) {
    setFlags((prev) => {
      const next = { ...prev, [questionId]: !prev[questionId] };
      if (state) window.sessionStorage.setItem(`cbt-flags-${state.attemptId}`, JSON.stringify(next));
      return next;
    });
  }

  async function choose(questionId: string, optionIndex: number) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (optionIndex === -1) delete next[questionId];
      else next[questionId] = optionIndex;
      return next;
    });
    const result = await persistAnswer({ data: { questionId, optionIndex } });
    if (result && "expired" in result && result.expired) void doSubmit(true);
  }

  if (isPending) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading exam…</div>;
  }

  if (!state) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-base px-6">
        <div className="max-w-[42ch] text-center">
          <h1 className="text-2xl font-serif">
            {(data as { error?: string } | undefined)?.error ?? "This attempt is no longer open."}
          </h1>
          <a href="/" className="mt-6 inline-block rounded-[8px] bg-brand-ink px-6 py-3 text-sm text-brand-base">
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }

  const lowTime = remaining !== null && remaining < 5 * 60_000;

  return (
    <div className="min-h-screen select-none bg-brand-base text-brand-ink">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-brand-line bg-brand-base/80 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {state.subject}
          </span>
          <div className="h-4 w-px bg-brand-line" />
          <span className="text-sm font-medium">{state.examCode}</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div
              className={`size-2 rounded-full ${lowTime ? "animate-pulse bg-destructive" : "bg-brand-accent"}`}
            />
            <span className="text-lg font-medium tabular-nums">
              {remaining === null ? "--:--" : formatClock(remaining)}
            </span>
          </div>
          <button
            onClick={() => setConfirming(true)}
            className="rounded-[8px] bg-brand-ink px-4 py-2 text-sm font-medium text-brand-base ring-1 ring-brand-ink"
          >
            Submit Exam
          </button>
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-3.5rem)]">
        <aside className="hidden w-72 overflow-y-auto border-r border-brand-line bg-brand-surface/50 p-6 lg:block">
          <h2 className="mb-6 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Navigator
          </h2>
          <div className="grid grid-cols-5 gap-2">
            {state.questions.map((q, i) => {
              const answered = answers[q.id] !== undefined;
              const flagged = flags[q.id];
              const base = "size-10 flex items-center justify-center rounded-sm text-xs font-medium";
              const cls =
                i === index
                  ? "bg-brand-accent text-brand-base"
                  : flagged
                    ? "bg-flag text-flag-foreground ring-1 ring-flag-foreground/20"
                    : answered
                      ? "bg-brand-accent/20 text-brand-accent ring-1 ring-brand-accent/20"
                      : "border border-brand-line text-muted-foreground";
              return (
                <button key={q.id} onClick={() => setIndex(i)} className={`${base} ${cls}`}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-8 space-y-2 border-t border-brand-line pt-6">
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-sm bg-flag ring-1 ring-flag-foreground/20" />
              <span className="text-[11px] font-medium text-muted-foreground">Flagged for review</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-3 rounded-sm bg-brand-accent/20 ring-1 ring-brand-accent/20" />
              <span className="text-[11px] font-medium text-muted-foreground">Answered</span>
            </div>
            <p className="pt-4 text-[11px] text-muted-foreground">
              {answeredCount} of {state.questions.length} answered
            </p>
          </div>
        </aside>

        <div className="flex flex-1 flex-col items-center px-6 py-12">
          {current ? (
            <div className="w-full max-w-[56ch]">
              <div className="mb-12">
                <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">
                  Question {String(index + 1).padStart(2, "0")} of {state.questions.length}
                </span>
                <h1 className="mt-4 text-3xl font-serif leading-tight text-balance">{current.text}</h1>
              </div>

              <div className="space-y-3">
                {current.options.map((option, optionIndex) => {
                  const selected = answers[current.id] === optionIndex;
                  return (
                    <button
                      key={optionIndex}
                      onClick={() => void choose(current.id, optionIndex)}
                      className={`group flex w-full items-center rounded-[10px] p-4 text-left transition-shadow ${
                        selected
                          ? "bg-brand-accent/5 ring-1 ring-brand-accent"
                          : "bg-card ring-1 ring-brand-line hover:ring-brand-accent/30"
                      }`}
                    >
                      <span
                        className={`mr-4 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                          selected
                            ? "bg-brand-accent text-brand-base"
                            : "border border-brand-line bg-brand-surface group-hover:bg-brand-accent group-hover:text-brand-base"
                        }`}
                      >
                        {LETTERS[optionIndex]}
                      </span>
                      <span className={`text-sm text-pretty ${selected ? "font-medium" : ""}`}>{option}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-12 flex items-center justify-between border-t border-brand-line pt-8">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void choose(current.id, -1)}
                    className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-brand-ink"
                  >
                    Clear selection
                  </button>
                  <button
                    onClick={() => toggleFlag(current.id)}
                    className={`px-4 py-2 text-sm font-medium ${
                      flags[current.id] ? "text-flag-foreground" : "text-muted-foreground hover:text-brand-ink"
                    }`}
                  >
                    {flags[current.id] ? "Unflag" : "Flag for review"}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIndex((i) => Math.max(0, i - 1))}
                    disabled={index === 0}
                    className="rounded-[8px] border border-brand-line px-4 py-2 text-sm font-medium disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setIndex((i) => Math.min(state.questions.length - 1, i + 1))}
                    disabled={index === state.questions.length - 1}
                    className="rounded-[8px] bg-brand-ink px-6 py-2 text-sm font-medium text-brand-base disabled:opacity-40"
                  >
                    Next Question
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {confirming ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-ink/40 px-6">
          <div className="w-full max-w-[42ch] rounded-[12px] bg-card p-6 ring-1 ring-brand-line">
            <h2 className="text-2xl font-serif">Submit your exam?</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              You have answered {answeredCount} of {state.questions.length} questions. Once submitted you
              cannot return to this paper.
            </p>
            <div className="mt-8 flex justify-end gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-[8px] border border-brand-line px-4 py-2 text-sm font-medium"
              >
                Keep working
              </button>
              <button
                onClick={() => void doSubmit(false)}
                disabled={submitting}
                className="rounded-[8px] bg-brand-ink px-6 py-2 text-sm font-medium text-brand-base disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit Exam"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
