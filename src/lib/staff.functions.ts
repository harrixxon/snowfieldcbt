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

/** Admin-only: bulk add students. Each entry is a full name; an optional className
 * (e.g. "SS3") overrides the default class. Roll numbers are generated per class. */
export const bulkAddStudents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        classId: z.string().uuid().optional(),
        entries: z
          .array(
            z.object({
              name: z.string().trim().min(2).max(120),
              className: z.string().trim().max(40).optional(),
            }),
          )
          .min(1)
          .max(500),
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
    const { data: allClasses } = await supabaseAdmin.from("classes").select("id, name");
    if (!allClasses || allClasses.length === 0) return { error: "No classes found." };
    const byClassName = new Map(allClasses.map((c) => [c.name.toLowerCase(), c]));
    const defaultClass = data.classId
      ? allClasses.find((c) => c.id === data.classId) ?? null
      : null;

    // Resolve each entry to a class, deduplicating per class.
    const perClass = new Map<string, { id: string; name: string; names: string[] }>();
    const skipped: string[] = [];
    for (const entry of data.entries) {
      const name = entry.name.replace(/^\s*\d+\s*[.)\]:-]\s*/, "").trim();
      if (name.length < 2) continue;
      const klass = entry.className
        ? byClassName.get(entry.className.toLowerCase()) ?? null
        : defaultClass;
      if (!klass) {
        skipped.push(
          `${name}: ${entry.className ? `class “${entry.className}” not found` : "no class given"}`,
        );
        continue;
      }
      let bucket = perClass.get(klass.id);
      if (!bucket) {
        bucket = { id: klass.id, name: klass.name, names: [] };
        perClass.set(klass.id, bucket);
      }
      if (!bucket.names.some((n) => n.toLowerCase() === name.toLowerCase()))
        bucket.names.push(name);
    }
    if (perClass.size === 0)
      return { error: "No valid students found — check names and class names.", skipped };

    // Existing roll numbers per class so numbering continues from the last one.
    const classIds = [...perClass.keys()];
    const { count } = await supabaseAdmin
      .from("students")
      .select("id", { count: "exact", head: true })
      .in("class_id", classIds);
    void count;

    let added = 0;
    const firstRolls: string[] = [];
    const lastRolls: string[] = [];
    const failed: string[] = [];
    for (const bucket of perClass.values()) {
      const { count: existing } = await supabaseAdmin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("class_id", bucket.id);
      let seq = (existing ?? 0) + 1;
      for (const name of bucket.names) {
        let inserted = false;
        for (let attempt = 0; attempt < 12 && !inserted; attempt++) {
          const rollNumber = `${bucket.name}-${String(seq).padStart(3, "0")}`;
          const { error } = await supabaseAdmin.from("students").insert({
            full_name: name,
            class_id: bucket.id,
            roll_number: rollNumber,
          });
          if (!error) {
            inserted = true;
            added += 1;
            if (!firstRolls.includes(rollNumber) && firstRolls.length < 3) firstRolls.push(rollNumber);
            if (lastRolls.length >= 3) lastRolls.shift();
            lastRolls.push(rollNumber);
          } else if (error.message.includes("duplicate")) {
            seq += 1;
          } else {
            failed.push(`${name}: ${error.message}`);
            break;
          }
        }
        if (!inserted && failed.every((f) => !f.startsWith(`${name}: `)))
          failed.push(`${name}: could not allocate a roll number`);
        seq += 1;
      }
    }
    return {
      ok: true as const,
      added,
      firstRoll: firstRolls[0] ?? null,
      lastRoll: lastRolls[lastRolls.length - 1] ?? null,
      failed: [...skipped, ...failed],
    };
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
    if (count === null) return { error: "Could not save the questions." };
    return { ok: true as const, added: count };
  });

/** True only when the email belongs to the school administrator account. */
export const isAdminEmail = createServerFn({ method: "POST" })
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
