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
