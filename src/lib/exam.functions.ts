import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loginSchema = z.object({
  rollNumber: z.string().trim().min(1).max(64),
  examCode: z.string().trim().min(1).max(64),
});

export const studentLogin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { studentSession } = await import("@/lib/exam.server");

    const { data: student } = await supabaseAdmin
      .from("students")
      .select("id, full_name, class_id, is_suspended")
      .eq("roll_number", data.rollNumber.toUpperCase())
      .maybeSingle();
    if (!student) return { error: "No student found with that roll number." as string };
    if (student.is_suspended) return { error: "Your exam access is currently suspended. Contact the exam office." };

    const { data: exam } = await supabaseAdmin
      .from("exams")
      .select(
        "id, title, class_id, num_questions, duration_minutes, start_time, end_time, is_active, instructions, subject_id",
      )
      .eq("exam_code", data.examCode.toUpperCase())
      .maybeSingle();
    if (!exam || !exam.is_active) return { error: "Invalid or inactive exam code." };
    if (exam.class_id !== student.class_id) return { error: "This exam is not assigned to your class." };

    const now = Date.now();
    if (now < new Date(exam.start_time).getTime())
      return { error: `This exam opens at ${new Date(exam.start_time).toLocaleString()}.` };
    if (now > new Date(exam.end_time).getTime()) return { error: "This exam window has closed." };

    const { data: subject } = await supabaseAdmin
      .from("subjects")
      .select("name")
      .eq("id", exam.subject_id)
      .maybeSingle();

    const { data: attempt } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, submitted_at")
      .eq("exam_id", exam.id)
      .eq("student_id", student.id)
      .maybeSingle();

    if (attempt?.submitted_at) return { error: "You have already submitted this exam." };

    const session = await studentSession();
    await session.clear();
    await session.update(
      attempt
        ? { studentId: student.id, examId: exam.id, attemptId: attempt.id }
        : { studentId: student.id, examId: exam.id },
    );

    return {
      student: { fullName: student.full_name, rollNumber: data.rollNumber.toUpperCase() },
      exam: {
        title: exam.title,
        subject: subject?.name ?? "",
        numQuestions: exam.num_questions,
        durationMinutes: exam.duration_minutes,
        instructions: exam.instructions,
      },
      resuming: Boolean(attempt),
    };
  });

export const startAttempt = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { studentSession, shuffle, LETTERS } = await import("@/lib/exam.server");

  const session = await studentSession();
  const { studentId, examId } = session.data;
  if (!studentId || !examId) return { error: "Session expired. Please log in again." };

  const { data: existing } = await supabaseAdmin
    .from("exam_attempts")
    .select("id, submitted_at")
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (existing?.submitted_at) return { error: "You have already submitted this exam." };
  if (existing) {
    await session.update({ studentId, examId, attemptId: existing.id });
    return { attemptId: existing.id };
  }

  const { data: exam } = await supabaseAdmin
    .from("exams")
    .select("id, subject_id, num_questions, duration_minutes, end_time, is_active")
    .eq("id", examId)
    .maybeSingle();
  if (!exam || !exam.is_active) return { error: "Exam is no longer available." };

  const { data: pool } = await supabaseAdmin
    .from("questions")
    .select("id")
    .eq("subject_id", exam.subject_id);
  if (!pool || pool.length === 0) return { error: "This exam has no questions yet. Contact your teacher." };

  const picked = shuffle(pool.map((q) => q.id)).slice(0, Math.min(exam.num_questions, pool.length));
  const optionOrder: Record<string, string[]> = {};
  for (const id of picked) optionOrder[id] = shuffle([...LETTERS]);

  const startedAt = new Date();
  const hardStop = new Date(exam.end_time).getTime();
  const byDuration = startedAt.getTime() + exam.duration_minutes * 60_000;
  const expiresAt = new Date(Math.min(byDuration, hardStop));

  const { data: created, error } = await supabaseAdmin
    .from("exam_attempts")
    .insert({
      student_id: studentId,
      exam_id: examId,
      question_order: picked,
      option_order: optionOrder,
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    const { data: raced } = await supabaseAdmin
      .from("exam_attempts")
      .select("id")
      .eq("exam_id", examId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (!raced) return { error: "Could not start the exam. Please try again." };
    await session.update({ studentId, examId, attemptId: raced.id });
    return { attemptId: raced.id };
  }

  await session.update({ studentId, examId, attemptId: created.id });
  return { attemptId: created.id };
});

export const getExamState = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { studentSession, originalText, finalizeAttempt } = await import("@/lib/exam.server");

  const session = await studentSession();
  const { attemptId } = session.data;
  if (!attemptId) return { error: "No active attempt. Please log in again." };

  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("id, exam_id, student_id, question_order, option_order, expires_at, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return { error: "Attempt not found." };

  if (!attempt.submitted_at && new Date(attempt.expires_at).getTime() <= Date.now()) {
    await finalizeAttempt(attempt.id, true);
    return { submitted: true as const, autoSubmitted: true };
  }
  if (attempt.submitted_at) return { submitted: true as const, autoSubmitted: false };

  const order = (attempt.question_order as string[]) ?? [];
  const optionOrder = (attempt.option_order as Record<string, string[]>) ?? {};

  const [{ data: exam }, { data: questions }, { data: answers }, { data: student }] = await Promise.all([
    supabaseAdmin.from("exams").select("title, subject_id, exam_code").eq("id", attempt.exam_id).maybeSingle(),
    supabaseAdmin
      .from("questions")
      .select("id, question_text, option_a, option_b, option_c, option_d, correct_option, marks")
      .in("id", order.length ? order : ["00000000-0000-0000-0000-000000000000"]),
    supabaseAdmin.from("attempt_answers").select("question_id, selected_option").eq("attempt_id", attempt.id),
    supabaseAdmin.from("students").select("full_name, roll_number").eq("id", attempt.student_id).maybeSingle(),
  ]);

  const { data: subject } = await supabaseAdmin
    .from("subjects")
    .select("name")
    .eq("id", exam?.subject_id ?? "")
    .maybeSingle();

  const byId = new Map((questions ?? []).map((q) => [q.id, q]));
  const answerMap = new Map((answers ?? []).map((a) => [a.question_id, a.selected_option]));

  const items = order
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => {
      const letters = optionOrder[q.id] ?? ["A", "B", "C", "D"];
      const saved = answerMap.get(q.id);
      const savedIndex = saved ? letters.indexOf(saved) : -1;
      return {
        id: q.id,
        text: q.question_text,
        marks: q.marks,
        options: letters.map((letter) => originalText(q, letter)),
        selectedIndex: savedIndex >= 0 ? savedIndex : null,
      };
    });

  return {
    submitted: false as const,
    attemptId: attempt.id,
    examTitle: exam?.title ?? "Exam",
    examCode: exam?.exam_code ?? "",
    subject: subject?.name ?? "",
    studentName: student?.full_name ?? "",
    rollNumber: student?.roll_number ?? "",
    expiresAt: attempt.expires_at,
    serverNow: new Date().toISOString(),
    questions: items,
  };
});

export const saveAnswer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ questionId: z.string().uuid(), optionIndex: z.number().int().min(-1).max(3) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { studentSession } = await import("@/lib/exam.server");

    const session = await studentSession();
    const { attemptId } = session.data;
    if (!attemptId) return { error: "Session expired." };

    const { data: attempt } = await supabaseAdmin
      .from("exam_attempts")
      .select("id, question_order, option_order, expires_at, submitted_at")
      .eq("id", attemptId)
      .maybeSingle();
    if (!attempt) return { error: "Attempt not found." };
    if (attempt.submitted_at) return { error: "This exam has already been submitted." };
    if (new Date(attempt.expires_at).getTime() <= Date.now()) return { expired: true as const };

    const order = (attempt.question_order as string[]) ?? [];
    if (!order.includes(data.questionId)) return { error: "Question is not part of this attempt." };

    if (data.optionIndex === -1) {
      await supabaseAdmin
        .from("attempt_answers")
        .delete()
        .eq("attempt_id", attempt.id)
        .eq("question_id", data.questionId);
      return { ok: true as const };
    }

    const letters = (attempt.option_order as Record<string, string[]>)[data.questionId] ?? ["A", "B", "C", "D"];
    const originalLetter = letters[data.optionIndex]!;

    const { data: question } = await supabaseAdmin
      .from("questions")
      .select("correct_option")
      .eq("id", data.questionId)
      .maybeSingle();

    await supabaseAdmin.from("attempt_answers").upsert(
      {
        attempt_id: attempt.id,
        question_id: data.questionId,
        selected_option: originalLetter,
        is_correct: question?.correct_option === originalLetter,
        answered_at: new Date().toISOString(),
      },
      { onConflict: "attempt_id,question_id" },
    );

    return { ok: true as const };
  });

export const logTabSwitch = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { studentSession } = await import("@/lib/exam.server");

  const session = await studentSession();
  const { attemptId } = session.data;
  if (!attemptId) return { ok: false };

  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("tab_switch_events, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt || attempt.submitted_at) return { ok: false };

  const events = ((attempt.tab_switch_events as string[]) ?? []).slice(-99);
  events.push(new Date().toISOString());
  await supabaseAdmin.from("exam_attempts").update({ tab_switch_events: events }).eq("id", attemptId);
  return { ok: true };
});

export const submitExam = createServerFn({ method: "POST" }).handler(async () => {
  const { studentSession, finalizeAttempt } = await import("@/lib/exam.server");
  const session = await studentSession();
  const { attemptId } = session.data;
  if (!attemptId) return { error: "Session expired." };
  await finalizeAttempt(attemptId, false);
  return { submitted: true as const };
});

export const getSubmissionSummary = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { studentSession } = await import("@/lib/exam.server");
  const session = await studentSession();
  const { attemptId } = session.data;
  if (!attemptId) return { error: "No submission found." };

  const { data: attempt } = await supabaseAdmin
    .from("exam_attempts")
    .select("submitted_at, auto_submitted, score, total_marks, exam_id, student_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt?.submitted_at) return { error: "No submission found." };

  const [{ data: exam }, { data: student }] = await Promise.all([
    supabaseAdmin
      .from("exams")
      .select("title, show_score_to_student")
      .eq("id", attempt.exam_id)
      .maybeSingle(),
    supabaseAdmin.from("students").select("full_name, roll_number").eq("id", attempt.student_id).maybeSingle(),
  ]);

  return {
    examTitle: exam?.title ?? "Exam",
    studentName: student?.full_name ?? "",
    rollNumber: student?.roll_number ?? "",
    submittedAt: attempt.submitted_at,
    autoSubmitted: attempt.auto_submitted,
    ...(exam?.show_score_to_student
      ? { score: attempt.score, totalMarks: attempt.total_marks }
      : {}),
  };
});

export const studentLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { studentSession } = await import("@/lib/exam.server");
  const session = await studentSession();
  await session.clear();
  return { ok: true };
});
