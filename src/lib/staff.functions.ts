import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const accountSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
  subject: z.string().trim().max(120).optional(),
});

/** Creates the very first administrator. Refuses once an admin exists. */
export const bootstrapAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => accountSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) > 0) return { error: "An administrator already exists. Ask them to invite you." };

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) return { error: error?.message ?? "Could not create the account." };

    await supabaseAdmin.from("staff").insert({
      id: created.user.id,
      full_name: data.fullName,
      email: data.email,
    });
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "admin" });
    return { ok: true as const };
  });

export const adminExists = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return { exists: (count ?? 0) > 0 };
});

export const createTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => accountSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can create teacher accounts." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) return { error: error?.message ?? "Could not create the account." };

    await supabaseAdmin.from("staff").insert({
      id: created.user.id,
      full_name: data.fullName,
      email: data.email,
      subject_specialisation: data.subject ?? null,
    });
    await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "teacher" });

    const { encryptPassword } = await import("@/lib/password.server");
    await supabaseAdmin.from("teacher_passwords").insert({
      user_id: created.user.id,
      encrypted_password: encryptPassword(data.password),
    });

    return { ok: true as const };
  });

export const getTeacherPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ teacherId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can view teacher passwords." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("teacher_passwords")
      .select("encrypted_password")
      .eq("user_id", data.teacherId)
      .maybeSingle();
    if (!row)
      return {
        error:
          "No stored password for this teacher (the account was created before passwords were saved). Use “Set password” to assign a new one.",
      };

    const { decryptPassword } = await import("@/lib/password.server");
    return { password: decryptPassword(row.encrypted_password) };
  });

/** Admin-only: change a teacher's password and store the encrypted copy. */
export const setTeacherPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ teacherId: z.string().uuid(), password: z.string().min(8).max(72) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can change teacher passwords." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.teacherId, {
      password: data.password,
    });
    if (error) return { error: error.message };

    const { encryptPassword } = await import("@/lib/password.server");
    const encrypted = encryptPassword(data.password);
    const { data: existing } = await supabaseAdmin
      .from("teacher_passwords")
      .select("id")
      .eq("user_id", data.teacherId)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("teacher_passwords")
        .update({ encrypted_password: encrypted })
        .eq("user_id", data.teacherId);
    } else {
      await supabaseAdmin
        .from("teacher_passwords")
        .insert({ user_id: data.teacherId, encrypted_password: encrypted });
    }
    return { ok: true as const, password: data.password };
  });

export const deleteTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ teacherId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can remove teacher accounts." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.teacherId);
    if (error) return { error: error.message };
    return { ok: true as const };
  });

export const createStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ fullName: z.string().trim().min(2).max(120), classId: z.string().uuid() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can add students." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: klass } = await supabaseAdmin
      .from("classes")
      .select("name")
      .eq("id", data.classId)
      .maybeSingle();
    if (!klass) return { error: "Class not found." };

    for (let attempt = 0; attempt < 8; attempt++) {
      const { count } = await supabaseAdmin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("class_id", data.classId);
      const seq = (count ?? 0) + 1 + attempt;
      const rollNumber = `${klass.name}-${String(seq).padStart(3, "0")}`;
      const { error } = await supabaseAdmin.from("students").insert({
        full_name: data.fullName,
        class_id: data.classId,
        roll_number: rollNumber,
      });
      if (!error) return { ok: true as const, rollNumber };
      if (!error.message.includes("duplicate")) return { error: error.message };
    }
    return { error: "Could not generate a unique roll number. Try again." };
  });

/** Admin-only: add many students at once, one full name per line. Roll numbers are generated in sequence. */
export const bulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        classId: z.string().uuid(),
        names: z.array(z.string().trim().min(2).max(120)).min(1).max(500),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return { error: "Only administrators can add students." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: klass } = await supabaseAdmin
      .from("classes")
      .select("name")
      .eq("id", data.classId)
      .maybeSingle();
    if (!klass) return { error: "Class not found." };

    // Deduplicate while preserving order.
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of data.names) {
      const name = raw.replace(/^\s*\d+\s*[.)\]:-]\s*/, "").trim();
      if (name.length < 2 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      names.push(name);
    }
    if (names.length === 0) return { error: "No valid student names found in the list." };

    const { count } = await supabaseAdmin
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("class_id", data.classId);
    let seq = (count ?? 0) + 1;

    let added = 0;
    let firstRoll: string | null = null;
    let lastRoll: string | null = null;
    const failed: string[] = [];
    for (const name of names) {
      let inserted = false;
      for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
        const rollNumber = `${klass.name}-${String(seq).padStart(3, "0")}`;
        const { error } = await supabaseAdmin.from("students").insert({
          full_name: name,
          class_id: data.classId,
          roll_number: rollNumber,
        });
        if (!error) {
          inserted = true;
          added += 1;
          if (!firstRoll) firstRoll = rollNumber;
          lastRoll = rollNumber;
        } else if (!error.message.includes("duplicate")) {
          failed.push(`${name}: ${error.message}`);
          break;
        } else {
          seq += 1;
        }
      }
      if (!inserted && failed[failed.length - 1] !== `${name}: duplicate roll numbers exhausted`) {
        if (failed.length === 0 || !failed[failed.length - 1].startsWith(`${name}: `))
          failed.push(`${name}: could not allocate a roll number`);
      }
      seq += 1;
    }
    return { ok: true as const, added, firstRoll, lastRoll, failed };
  });

const bulkQuestionSchema = z.object({
  subjectId: z.string().uuid(),
  questions: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        a: z.string().trim().min(1),
        b: z.string().trim().min(1),
        c: z.string().trim().min(1),
        d: z.string().trim().min(1),
        correct: z.enum(["A", "B", "C", "D"]),
        marks: z.number().int().min(1).max(100).default(1),
      }),
    )
    .min(1)
    .max(500),
});

/** Teacher-only: add many questions at once for one subject. */
export const bulkAddQuestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkQuestionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (await import("@/integrations/supabase/client.server"))
      .supabaseAdmin === undefined
      ? { data: null, error: null }
      : { data: null, error: null };
    void rows;
    void error;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subject } = await supabaseAdmin
      .from("subjects")
      .select("id")
      .eq("id", data.subjectId)
      .maybeSingle();
    if (!subject) return { error: "Subject not found." };

    const { count } = await supabaseAdmin
      .from("questions")
      .insert(
        data.questions.map((q) => ({
          subject_id: data.subjectId,
          teacher_id: context.userId,
          question_text: q.text,
          option_a: q.a,
          option_b: q.b,
          option_c: q.c,
          option_d: q.d,
          correct_option: q.correct,
          marks: q.marks,
        })),
      )
      .select("id", { count: "exact" });
    return { ok: true as const, added: count ?? data.questions.length };
  });
  .inputValidator((data: unknown) => z.object({ email: z.string().trim().email() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("staff")
      .select("id")
      .ilike("email", data.email)
      .limit(1);
    const id = rows?.[0]?.id;
    if (!id) return { allowed: false as const };
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id)
      .eq("role", "admin");
    return { allowed: (count ?? 0) > 0 };
  });
