import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getBrief, startAttempt } from "@/lib/exam.functions";

export const Route = createFileRoute("/exam/brief")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Exam Instructions — School CBT Portal" },
      { name: "description", content: "Review your exam details and instructions before you begin." },
      { property: "og:title", content: "Exam Instructions — School CBT Portal" },
      { property: "og:description", content: "Review your exam details and instructions before you begin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamBrief,
});

function ExamBrief() {
  const navigate = useNavigate();
  const brief = useServerFn(getBrief);
  const start = useServerFn(startAttempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["exam-brief"],
    queryFn: () => brief({}),
  });

  async function begin() {
    setBusy(true);
    setError(null);
    const result = await start({});
    if ("error" in result && result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    if (document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        /* fullscreen is optional */
      }
    }
    await navigate({ to: "/exam/take" });
  }

  if (isPending) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!data || "error" in data) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-base px-6">
        <div className="max-w-[42ch] text-center">
          <h1 className="text-2xl font-serif">{(data as { error?: string })?.error ?? "Session expired."}</h1>
          <a href="/" className="mt-6 inline-block rounded-[8px] bg-brand-ink px-6 py-3 text-sm text-brand-base">
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }

  if (data.submitted) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-base px-6">
        <div className="max-w-[42ch] text-center">
          <h1 className="text-2xl font-serif">You have already submitted this exam.</h1>
          <a href="/" className="mt-6 inline-block rounded-[8px] bg-brand-ink px-6 py-3 text-sm text-brand-base">
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-base text-brand-ink">
      <header className="flex h-14 items-center justify-between border-b border-brand-line px-6">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {data.subject}
        </span>
        <span className="text-sm font-medium">{data.examCode}</span>
      </header>

      <main className="mx-auto max-w-[56ch] px-6 py-16">
        <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">
          {data.resuming ? "Resume attempt" : "Before you begin"}
        </span>
        <h1 className="mt-4 text-3xl font-serif leading-tight text-balance">{data.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {data.studentName} · {data.rollNumber}
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-brand-line ring-1 ring-brand-line">
          <div className="bg-card p-5">
            <dt className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Questions
            </dt>
            <dd className="mt-2 font-serif text-3xl">{data.numQuestions}</dd>
          </div>
          <div className="bg-card p-5">
            <dt className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Duration
            </dt>
            <dd className="mt-2 font-serif text-3xl">{data.durationMinutes} min</dd>
          </div>
        </dl>

        <div className="mt-8 space-y-3 border-t border-brand-line pt-8 text-sm leading-relaxed text-muted-foreground">
          {data.instructions ? <p className="text-brand-ink">{data.instructions}</p> : null}
          <p>The countdown runs on the school server. Refreshing or closing the tab does not pause it.</p>
          <p>
            Questions and options are shuffled for you and stay in that order for the whole attempt. You may
            move between questions and flag any for review before submitting.
          </p>
          <p>
            Copy, paste and right-click are disabled on the exam screen, and switching tabs is logged for the
            invigilator. This is a deterrent, not a guarantee of a secure environment.
          </p>
          <p>When time runs out the paper is submitted automatically with whatever you have answered.</p>
        </div>

        {error ? (
          <p className="mt-6 rounded-[8px] bg-destructive/5 p-3 text-sm text-destructive ring-1 ring-destructive/20">
            {error}
          </p>
        ) : null}

        <button
          onClick={begin}
          disabled={busy}
          className="mt-10 w-full rounded-[8px] bg-brand-ink px-6 py-3 text-sm font-medium text-brand-base ring-1 ring-brand-ink disabled:opacity-60"
        >
          {busy ? "Preparing…" : data.resuming ? "Resume exam" : "Start exam"}
        </button>
      </main>
    </div>
  );
}
