// Server-only helpers for the student exam flow. Never imported by client code.
import { useSession } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StudentSessionData = {
  attemptId?: string;
  studentId?: string;
  examId?: string;
};

function sessionConfig() {
  return {
    password: process.env["STUDENT_SESSION_SECRET"]!,
    name: "cbt-student-session",
    maxAge: 60 * 60 * 6,
  };
}

export async function studentSession() {
  return useSession<StudentSessionData>(sessionConfig());
}

export type OptionLetter = "A" | "B" | "C" | "D";
export const LETTERS: OptionLetter[] = ["A", "B", "C", "D"];

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

export type QuestionRow = {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  marks: number;
};

export function originalText(q: QuestionRow, letter: string): string {
  if (letter === "A") return q.option_a;
  if (letter === "B") return q.option_b;
  if (letter === "C") return q.option_c;
  return q.option_d;
}

/** Grades an attempt, writes score + submitted_at, and returns the score. */
export async function finalizeAttempt(attemptId: string, auto: boolean) {
  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("id, exam_id, question_order, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return null;
  if (attempt.submitted_at) return attempt;

  const questionIds = (attempt.question_order as string[]) ?? [];
  const { data: questions } = await supabaseAdmin
    .from("questions")
    .select("id, marks")
    .in("id", questionIds.length ? questionIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: answers } = await supabaseAdmin
    .from("attempt_answers")
    .select("question_id, is_correct")
    .eq("attempt_id", attemptId);

  const marksById = new Map((questions ?? []).map((q) => [q.id, q.marks]));
  let score = 0;
  let total = 0;
  for (const id of questionIds) total += marksById.get(id) ?? 0;
  for (const a of answers ?? []) {
    if (a.is_correct) score += marksById.get(a.question_id) ?? 0;
  }

  const { data: updated } = await supabaseAdmin
    .from("exam_attempts")
    .update({
      submitted_at: new Date().toISOString(),
      auto_submitted: auto,
      score,
      total_marks: total,
    })
    .eq("id", attemptId)
    .is("submitted_at", null)
    .select("id, score, total_marks")
    .maybeSingle();

  return updated ?? attempt;
}

export async function autoSubmitExpiredAttempts() {
  const { data: expired } = await supabaseAdmin
    .from("exam_attempts")
    .select("id")
    .is("submitted_at", null)
    .lt("expires_at", new Date().toISOString())
    .limit(500);

  for (const row of expired ?? []) {
    await finalizeAttempt(row.id, true);
  }
  return expired?.length ?? 0;
}
