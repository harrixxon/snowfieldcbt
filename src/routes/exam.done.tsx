import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getSubmissionSummary, studentLogout } from "@/lib/exam.functions";

export const Route = createFileRoute("/exam/done")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Exam Submitted — School CBT Portal" },
      { name: "description", content: "Your exam paper has been received by the school server." },
      { property: "og:title", content: "Exam Submitted — School CBT Portal" },
      { property: "og:description", content: "Your exam paper has been received by the school server." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExamDone,
});

function ExamDone() {
  const summary = useServerFn(getSubmissionSummary);
  const logout = useServerFn(studentLogout);
  const { data } = useQuery({ queryKey: ["exam-summary"], queryFn: () => summary({}) });

  useEffect(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const info = data && !("error" in data) ? data : null;

  return (
    <div className="grid min-h-screen place-items-center bg-brand-base px-6 text-brand-ink">
      <div className="w-full max-w-[46ch] text-center">
        <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">Submitted</span>
        <h1 className="mt-4 text-3xl font-serif leading-tight text-balance">
          Your paper has been received.
        </h1>
        {info ? (
          <div className="mt-8 space-y-2 rounded-[12px] bg-card p-6 text-left ring-1 ring-brand-line">
            <p className="text-sm font-medium">{info.examTitle}</p>
            <p className="text-sm text-muted-foreground">
              {info.studentName} · {info.rollNumber}
            </p>
            <p className="text-sm text-muted-foreground">
              Submitted {new Date(info.submittedAt).toLocaleString()}
              {info.autoSubmitted ? " (time expired)" : ""}
            </p>
            {"score" in info && info.score !== null && info.score !== undefined ? (
              <p className="pt-2 font-serif text-3xl">
                {info.score} / {info.totalMarks}
              </p>
            ) : (
              <p className="pt-2 text-sm text-muted-foreground">
                Your score will be released by your teacher.
              </p>
            )}
          </div>
        ) : null}
        <button
          onClick={async () => {
            await logout({});
            window.location.href = "/";
          }}
          className="mt-8 rounded-[8px] bg-brand-ink px-6 py-3 text-sm font-medium text-brand-base"
        >
          Finish and sign out
        </button>
      </div>
    </div>
  );
}
