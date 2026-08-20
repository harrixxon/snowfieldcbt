import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { studentLogin } from "@/lib/exam.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Student Exam Sign-in — School CBT Portal" },
      {
        name: "description",
        content:
          "Sign in with your roll number and exam code to take your computer-based test. Timed, one question at a time.",
      },
      { property: "og:title", content: "Student Exam Sign-in — School CBT Portal" },
      {
        property: "og:description",
        content: "Sign in with your roll number and exam code to take your computer-based test.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudentSignIn,
});

function StudentSignIn() {
  const navigate = useNavigate();
  const login = useServerFn(studentLogin);
  const [rollNumber, setRollNumber] = useState("");
  const [examCode, setExamCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login({ data: { rollNumber, examCode } });
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      await navigate({ to: "/exam/brief" });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-base text-brand-ink">
      <header className="flex h-14 items-center justify-between border-b border-brand-line px-6">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          School CBT Portal
        </span>
        <Link to="/auth" className="text-xs font-medium text-muted-foreground hover:text-brand-ink">
          Staff sign-in
        </Link>
      </header>

      <main className="mx-auto flex max-w-[46ch] flex-col px-6 py-20">
        <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">
          Candidate sign-in
        </span>
        <h1 className="mt-4 text-4xl font-serif leading-tight text-balance">
          Enter your roll number and the exam code given by your invigilator.
        </h1>

        <form onSubmit={onSubmit} className="mt-12 space-y-4">
          <div>
            <label
              htmlFor="roll"
              className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
            >
              Roll number
            </label>
            <input
              id="roll"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              required
              autoComplete="off"
              placeholder="SS3-014"
              className="mt-2 w-full rounded-[8px] bg-card p-4 text-sm uppercase ring-1 ring-brand-line outline-none focus:ring-brand-accent"
            />
          </div>
          <div>
            <label
              htmlFor="code"
              className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground"
            >
              Exam code
            </label>
            <input
              id="code"
              value={examCode}
              onChange={(e) => setExamCode(e.target.value)}
              required
              autoComplete="off"
              placeholder="MATH-901"
              className="mt-2 w-full rounded-[8px] bg-card p-4 text-sm uppercase ring-1 ring-brand-line outline-none focus:ring-brand-accent"
            />
          </div>

          {error ? (
            <p className="rounded-[8px] bg-destructive/5 p-3 text-sm text-destructive ring-1 ring-destructive/20">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-[8px] bg-brand-ink px-6 py-3 text-sm font-medium text-brand-base ring-1 ring-brand-ink disabled:opacity-60"
          >
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>

        <p className="mt-8 border-t border-brand-line pt-6 text-[11px] leading-relaxed text-muted-foreground">
          Your attempt is timed on the school server. Closing the tab does not stop the clock, and
          re-opening the exam resumes the same paper.
        </p>
      </main>
    </div>
  );
}
