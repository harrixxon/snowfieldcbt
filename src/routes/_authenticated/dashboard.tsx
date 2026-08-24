import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createStudent, createTeacher, deleteTeacher } from "@/lib/staff.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Staff Dashboard — School CBT Portal" },
      {
        name: "description",
        content: "Manage classes, students, question banks, exams and results for the school.",
      },
      { property: "og:title", content: "Staff Dashboard — School CBT Portal" },
      {
        property: "og:description",
        content: "Manage classes, students, question banks, exams and results for the school.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type Tab = "overview" | "school" | "people" | "questions" | "exams" | "results";

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? "";
      const [{ data: roles }, { data: profile }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("staff").select("full_name,email").eq("id", uid).maybeSingle(),
      ]);
      return {
        id: uid,
        isAdmin: (roles ?? []).some((r) => r.role === "admin"),
        name: profile?.full_name ?? auth.user?.email ?? "Staff",
      };
    },
  });

  const isAdmin = me?.isAdmin ?? false;

  const classes = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("*").order("name")).data ?? [],
  });
  const subjects = useQuery({
    queryKey: ["subjects"],
    queryFn: async () =>
      (await supabase.from("subjects").select("*, classes(name)").order("name")).data ?? [],
  });
  const students = useQuery({
    queryKey: ["students"],
    queryFn: async () =>
      (await supabase.from("students").select("*, classes(name)").order("roll_number")).data ?? [],
  });
  const teachers = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "teacher");
      const ids = (roles ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      return (await supabase.from("staff").select("*").in("id", ids)).data ?? [];
    },
    enabled: isAdmin,
  });
  const questions = useQuery({
    queryKey: ["questions"],
    queryFn: async () =>
      (
        await supabase
          .from("questions")
          .select("*, subjects(name, class_id, classes(name))")
          .order("created_at", { ascending: false })
      )
        .data ?? [],
  });
  const exams = useQuery({
    queryKey: ["exams"],
    queryFn: async () =>
      (
        await supabase
          .from("exams")
          .select("*, subjects(name), classes(name)")
          .order("start_time", { ascending: false })
      ).data ?? [],
  });

  const invalidate = (key: string) => qc.invalidateQueries({ queryKey: [key] });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }

  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "school", label: "Classes & Subjects", adminOnly: true },
    { id: "people", label: "Students & Teachers", adminOnly: true },
    { id: "questions", label: "Question Bank" },
    { id: "exams", label: "Exams" },
    { id: "results", label: "Results" },
  ];

  return (
    <div className="min-h-screen bg-brand-base text-brand-ink">
      <header className="flex h-14 items-center justify-between border-b border-brand-line px-6">
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            School CBT Portal
          </span>
          <div className="h-4 w-px bg-brand-line" />
          <span className="text-sm font-medium">{me?.name}</span>
          <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-accent">
            {isAdmin ? "Administrator" : "Teacher"}
          </span>
        </div>
        <button onClick={signOut} className="text-xs font-medium text-muted-foreground hover:text-brand-ink">
          Sign out
        </button>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-brand-line px-6">
        {tabs
          .filter((t) => !t.adminOnly || isAdmin)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-xs font-medium whitespace-nowrap ${
                tab === t.id
                  ? "border-brand-accent text-brand-ink"
                  : "border-transparent text-muted-foreground hover:text-brand-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {tab === "overview" ? (
          <section>
            <h1 className="text-3xl font-serif">Good to see you, {me?.name.split(" ")[0]}.</h1>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Classes" value={classes.data?.length ?? 0} />
              <Stat label="Students" value={students.data?.length ?? 0} />
              <Stat label="Questions" value={questions.data?.length ?? 0} />
              <Stat label="Exams" value={exams.data?.length ?? 0} />
            </div>
          </section>
        ) : null}

        {tab === "school" && isAdmin ? (
          <SchoolPanel classes={classes.data ?? []} subjects={subjects.data ?? []} onChange={invalidate} />
        ) : null}

        {tab === "people" && isAdmin ? (
          <PeoplePanel
            classes={classes.data ?? []}
            students={students.data ?? []}
            teachers={teachers.data ?? []}
            onChange={invalidate}
          />
        ) : null}

        {tab === "questions" ? (
          <QuestionsPanel
            subjects={subjects.data ?? []}
            classes={classes.data ?? []}
            questions={questions.data ?? []}
            teacherId={me?.id ?? ""}
            isAdmin={isAdmin}
            onChange={invalidate}
          />
        ) : null}

        {tab === "exams" ? (
          <ExamsPanel
            subjects={subjects.data ?? []}
            classes={classes.data ?? []}
            exams={exams.data ?? []}
            questions={questions.data ?? []}
            teacherId={me?.id ?? ""}
            isAdmin={isAdmin}
            onChange={invalidate}
          />
        ) : null}

        {tab === "results" ? (
          <ResultsPanel exams={exams.data ?? []} classes={classes.data ?? []} subjects={subjects.data ?? []} />
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] bg-card p-6 ring-1 ring-brand-line">
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-3 font-serif text-4xl">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-6 text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const inputClass =
  "w-full rounded-[8px] bg-card p-3 text-sm ring-1 ring-brand-line outline-none focus:ring-brand-accent";
const btnClass = "rounded-[8px] bg-brand-ink px-5 py-3 text-sm font-medium text-brand-base disabled:opacity-60";

type Row = Record<string, unknown>;

function SchoolPanel({
  classes,
  subjects,
  onChange,
}: {
  classes: Row[];
  subjects: Row[];
  onChange: (k: string) => void;
}) {
  const [className, setClassName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectClass, setSubjectClass] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Panel title="Classes">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { error: err } = await supabase.from("classes").insert({ name: className.trim() });
            setError(err?.message ?? null);
            if (!err) {
              setClassName("");
              onChange("classes");
            }
          }}
        >
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="e.g. JSS2A"
            value={className}
            required
            onChange={(e) => setClassName(e.target.value)}
          />
          <button className={btnClass}>Add class</button>
        </form>
        <ul className="mt-6 flex flex-wrap gap-2">
          {classes.map((c) => (
            <li
              key={String(c['id'])}
              className="rounded-full bg-card px-4 py-1.5 text-xs font-medium ring-1 ring-brand-line"
            >
              {String(c['name'])}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Subjects">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const { error: err } = await supabase
              .from("subjects")
              .insert({ name: subjectName.trim(), class_id: subjectClass });
            setError(err?.message ?? null);
            if (!err) {
              setSubjectName("");
              onChange("subjects");
            }
          }}
        >
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="e.g. Mathematics"
            value={subjectName}
            required
            onChange={(e) => setSubjectName(e.target.value)}
          />
          <select
            className={`${inputClass} max-w-xs`}
            value={subjectClass}
            required
            onChange={(e) => setSubjectClass(e.target.value)}
          >
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={String(c['id'])} value={String(c['id'])}>
                {String(c['name'])}
              </option>
            ))}
          </select>
          <button className={btnClass}>Add subject</button>
        </form>
        <div className="mt-6 flex flex-wrap gap-3">
          <select
            className={`${inputClass} max-w-xs`}
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={String(c['id'])} value={String(c['id'])}>
                {String(c['name'])}
              </option>
            ))}
          </select>
        </div>
        <ul className="mt-4 space-y-2">
          {subjects
            .filter((s) => !subjectFilter || String(s['class_id']) === subjectFilter)
            .map((s) => (
              <li
                key={String(s['id'])}
                className="flex items-center justify-between gap-3 rounded-[8px] bg-card px-4 py-3 text-sm ring-1 ring-brand-line"
              >
                <span>
                  {String(s['name'])}{" "}
                  <span className="text-muted-foreground">
                    · {String((s['classes'] as { name?: string } | null)?.name ?? "")}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-destructive"
                  onClick={async () => {
                    if (!confirm(`Delete subject "${String(s['name'])}"? Its questions and exams will be removed too.`))
                      return;
                    const { error: err } = await supabase.from("subjects").delete().eq("id", String(s['id']));
                    setError(err?.message ?? null);
                    if (!err) {
                      onChange("subjects");
                      onChange("questions");
                      onChange("exams");
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
        </ul>
      </Panel>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </>
  );
}

function PeoplePanel({
  classes,
  students,
  teachers,
  onChange,
}: {
  classes: Row[];
  students: Row[];
  teachers: Row[];
  onChange: (k: string) => void;
}) {
  const addStudent = useServerFn(createStudent);
  const addTeacher = useServerFn(createTeacher);
  const removeTeacher = useServerFn(deleteTeacher);
  const [studentName, setStudentName] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [teacher, setTeacher] = useState({ fullName: "", email: "", password: "", subject: "" });
  const [message, setMessage] = useState<string | null>(null);
  const [studentFilter, setStudentFilter] = useState("");
  const visibleStudents = useMemo(
    () => students.filter((s) => !studentFilter || String(s['class_id']) === studentFilter),
    [students, studentFilter],
  );

  const studentMutation = useMutation({
    mutationFn: () => addStudent({ data: { fullName: studentName.trim(), classId: studentClass } }),
    onSuccess: (r) => {
      setMessage("error" in r && r.error ? r.error : `Added. Roll number: ${"rollNumber" in r ? r.rollNumber : ""}`);
      setStudentName("");
      onChange("students");
    },
  });

  const teacherMutation = useMutation({
    mutationFn: () => addTeacher({ data: teacher }),
    onSuccess: (r) => {
      setMessage("error" in r && r.error ? r.error : "Teacher account created.");
      setTeacher({ fullName: "", email: "", password: "", subject: "" });
      onChange("teachers");
    },
  });

  return (
    <>
      <Panel title="Add student">
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            studentMutation.mutate();
          }}
        >
          <input
            className={`${inputClass} max-w-xs`}
            placeholder="Student full name"
            value={studentName}
            required
            onChange={(e) => setStudentName(e.target.value)}
          />
          <select
            className={`${inputClass} max-w-xs`}
            value={studentClass}
            required
            onChange={(e) => setStudentClass(e.target.value)}
          >
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={String(c['id'])} value={String(c['id'])}>
                {String(c['name'])}
              </option>
            ))}
          </select>
          <button className={btnClass} disabled={studentMutation.isPending}>
            Add student
          </button>
        </form>
      </Panel>

      <Panel title={`Students (${visibleStudents.length})`}>
        <select
          className={`${inputClass} mb-4 max-w-xs`}
          value={studentFilter}
          onChange={(e) => setStudentFilter(e.target.value)}
        >
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={String(c['id'])} value={String(c['id'])}>
              {String(c['name'])}
            </option>
          ))}
        </select>
        <div className="max-h-80 overflow-y-auto rounded-[12px] ring-1 ring-brand-line">
          <table className="w-full text-sm">
            <tbody>
              {visibleStudents.map((s) => (
                <tr key={String(s['id'])} className="border-b border-brand-line bg-card last:border-0">
                  <td className="px-4 py-3 font-medium">{String(s['roll_number'])}</td>
                  <td className="px-4 py-3">{String(s['full_name'])}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {String((s['classes'] as { name?: string } | null)?.name ?? "")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-destructive"
                      onClick={async () => {
                        if (!confirm(`Delete ${String(s['full_name'])}? Their exam attempts will be removed too.`))
                          return;
                        const { error: err } = await supabase.from("students").delete().eq("id", String(s['id']));
                        setMessage(err?.message ?? "Student deleted.");
                        if (!err) onChange("students");
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Teacher accounts">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            teacherMutation.mutate();
          }}
        >
          <input
            className={inputClass}
            placeholder="Full name"
            required
            value={teacher.fullName}
            onChange={(e) => setTeacher({ ...teacher, fullName: e.target.value })}
          />
          <input
            className={inputClass}
            type="email"
            placeholder="Email"
            required
            value={teacher.email}
            onChange={(e) => setTeacher({ ...teacher, email: e.target.value })}
          />
          <input
            className={inputClass}
            type="password"
            placeholder="Temporary password (min 8)"
            required
            value={teacher.password}
            onChange={(e) => setTeacher({ ...teacher, password: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Subject specialisation (optional)"
            value={teacher.subject}
            onChange={(e) => setTeacher({ ...teacher, subject: e.target.value })}
          />
          <button className={`${btnClass} sm:col-span-2`} disabled={teacherMutation.isPending}>
            Create teacher account
          </button>
        </form>

        <ul className="mt-6 space-y-2">
          {teachers.map((t) => (
            <li
              key={String(t['id'])}
              className="flex items-center justify-between rounded-[8px] bg-card px-4 py-3 text-sm ring-1 ring-brand-line"
            >
              <span>
                {String(t['full_name'])} <span className="text-muted-foreground">· {String(t['email'])}</span>
              </span>
              <button
                onClick={async () => {
                  await removeTeacher({ data: { teacherId: String(t['id']) } });
                  onChange("teachers");
                }}
                className="text-xs font-medium text-destructive"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </>
  );
}

function QuestionsPanel({
  subjects,
  classes,
  questions,
  teacherId,
  isAdmin,
  onChange,
}: {
  subjects: Row[];
  classes: Row[];
  questions: Row[];
  teacherId: string;
  isAdmin: boolean;
  onChange: (k: string) => void;
}) {
  const empty = { subjectId: "", text: "", a: "", b: "", c: "", d: "", correct: "A", marks: 1 };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const visible = useMemo(
    () =>
      questions.filter((q) => {
        const subj = q['subjects'] as { class_id?: string } | null;
        if (subjectFilter && String(q['subject_id']) !== subjectFilter) return false;
        if (classFilter && String(subj?.class_id ?? "") !== classFilter) return false;
        return true;
      }),
    [questions, classFilter, subjectFilter],
  );

  return (
    <>
      {!isAdmin ? (
        <Panel title="Add question">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const { error: err } = await supabase.from("questions").insert({
                subject_id: form.subjectId,
                teacher_id: teacherId,
                question_text: form.text.trim(),
                option_a: form.a.trim(),
                option_b: form.b.trim(),
                option_c: form.c.trim(),
                option_d: form.d.trim(),
                correct_option: form.correct,
                marks: Number(form.marks) || 1,
              });
              setError(err?.message ?? null);
              if (!err) {
                setForm({ ...empty, subjectId: form.subjectId });
                onChange("questions");
              }
            }}
          >
            <select
              className={inputClass}
              required
              value={form.subjectId}
              onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
            >
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={String(s['id'])} value={String(s['id'])}>
                  {String(s['name'])} · {String((s['classes'] as { name?: string } | null)?.name ?? "")}
                </option>
              ))}
            </select>
            <textarea
              className={inputClass}
              rows={3}
              required
              placeholder="Question text"
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {(["a", "b", "c", "d"] as const).map((k) => (
                <input
                  key={k}
                  className={inputClass}
                  required
                  placeholder={`Option ${k.toUpperCase()}`}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <select
                className={`${inputClass} max-w-[12rem]`}
                value={form.correct}
                onChange={(e) => setForm({ ...form, correct: e.target.value })}
              >
                {["A", "B", "C", "D"].map((l) => (
                  <option key={l} value={l}>
                    Correct: {l}
                  </option>
                ))}
              </select>
              <input
                className={`${inputClass} max-w-[8rem]`}
                type="number"
                min={1}
                value={form.marks}
                onChange={(e) => setForm({ ...form, marks: Number(e.target.value) })}
              />
              <button className={btnClass}>Save question</button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        </Panel>
      ) : null}

      <Panel title={`Question bank (${visible.length})`}>
        <div className="mb-4 flex flex-wrap gap-3">
          <select
            className={`${inputClass} max-w-xs`}
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setSubjectFilter("");
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={String(c['id'])} value={String(c['id'])}>
                {String(c['name'])}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} max-w-xs`}
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
          >
            <option value="">All subjects</option>
            {subjects
              .filter((s) => !classFilter || String(s['class_id']) === classFilter)
              .map((s) => (
                <option key={String(s['id'])} value={String(s['id'])}>
                  {String(s['name'])} · {String((s['classes'] as { name?: string } | null)?.name ?? "")}
                </option>
              ))}
          </select>
        </div>
        <ul className="space-y-2">
          {visible.map((q) => {
            const subj = q['subjects'] as { name?: string; classes?: { name?: string } | null } | null;
            return (
              <li key={String(q['id'])} className="rounded-[8px] bg-card p-4 text-sm ring-1 ring-brand-line">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{String(q['question_text'])}</p>
                  {isAdmin || String(q['teacher_id']) === teacherId ? (
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-destructive"
                      onClick={async () => {
                        if (!confirm("Delete this question?")) return;
                        const { error: err } = await supabase.from("questions").delete().eq("id", String(q['id']));
                        setError(err?.message ?? null);
                        if (!err) onChange("questions");
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {subj?.name ?? ""} · {subj?.classes?.name ?? ""} · Answer {String(q['correct_option'])} ·{" "}
                  {String(q['marks'])} mark(s)
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

function ExamsPanel({
  subjects,
  classes,
  exams,
  questions,
  teacherId,
  isAdmin,
  onChange,
}: {
  subjects: Row[];
  classes: Row[];
  exams: Row[];
  questions: Row[];
  teacherId: string;
  isAdmin: boolean;
  onChange: (k: string) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    subjectId: "",
    classId: "",
    numQuestions: 20,
    duration: 45,
    start: "",
    end: "",
    instructions: "",
    showScore: false,
  });
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(
    () => questions.filter((q) => String(q['subject_id']) === form.subjectId).length,
    [questions, form.subjectId],
  );

  return (
    <>
      {!isAdmin ? (
        <Panel title="Schedule an exam">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const code = `EX-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
              const { error: err } = await supabase.from("exams").insert({
                teacher_id: teacherId,
                subject_id: form.subjectId,
                class_id: form.classId,
                title: form.title.trim(),
                instructions: form.instructions.trim() || null,
                exam_code: code,
                num_questions: Number(form.numQuestions),
                duration_minutes: Number(form.duration),
                start_time: new Date(form.start).toISOString(),
                end_time: new Date(form.end).toISOString(),
                show_score_to_student: form.showScore,
              });
              setError(err?.message ?? null);
              if (!err) onChange("exams");
            }}
          >
            <input
              className={inputClass}
              required
              placeholder="Exam title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className={inputClass}
                required
                value={form.subjectId}
                onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
              >
                <option value="">Select subject</option>
                {subjects.map((s) => (
                  <option key={String(s['id'])} value={String(s['id'])}>
                    {String(s['name'])}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                required
                value={form.classId}
                onChange={(e) => setForm({ ...form, classId: e.target.value })}
              >
                <option value="">Select class</option>
                {classes.map((c) => (
                  <option key={String(c['id'])} value={String(c['id'])}>
                    {String(c['name'])}
                  </option>
                ))}
              </select>
              <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Questions to serve ({available} available)
                <input
                  className={`${inputClass} mt-2 normal-case tracking-normal`}
                  type="number"
                  min={1}
                  value={form.numQuestions}
                  onChange={(e) => setForm({ ...form, numQuestions: Number(e.target.value) })}
                />
              </label>
              <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Duration (minutes)
                <input
                  className={`${inputClass} mt-2 normal-case tracking-normal`}
                  type="number"
                  min={1}
                  value={form.duration}
                  onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}
                />
              </label>
              <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Window opens
                <input
                  className={`${inputClass} mt-2 normal-case tracking-normal`}
                  type="datetime-local"
                  required
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </label>
              <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                Window closes
                <input
                  className={`${inputClass} mt-2 normal-case tracking-normal`}
                  type="datetime-local"
                  required
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </label>
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Instructions shown before the exam (optional)"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.showScore}
                onChange={(e) => setForm({ ...form, showScore: e.target.checked })}
              />
              Show score to students immediately after submission
            </label>
            <button className={btnClass}>Create exam</button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        </Panel>
      ) : null}

      <Panel title={`Exams (${exams.length})`}>
        <ul className="space-y-2">
          {exams.map((x) => (
            <li key={String(x['id'])} className="rounded-[8px] bg-card p-4 text-sm ring-1 ring-brand-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{String(x['title'])}</span>
                <span className="rounded-full bg-brand-accent/10 px-3 py-1 text-xs font-medium text-brand-accent">
                  {String(x['exam_code'])}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {String((x['subjects'] as { name?: string } | null)?.name ?? "")} ·{" "}
                {String((x['classes'] as { name?: string } | null)?.name ?? "")} ·{" "}
                {String(x['num_questions'])} questions · {String(x['duration_minutes'])} min ·{" "}
                {new Date(String(x['start_time'])).toLocaleString()} →{" "}
                {new Date(String(x['end_time'])).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function ResultsPanel({ exams }: { exams: Row[] }) {
  const [examId, setExamId] = useState("");
  const results = useQuery({
    queryKey: ["results", examId],
    enabled: !!examId,
    queryFn: async () =>
      (
        await supabase
          .from("exam_attempts")
          .select("id, score, total_marks, submitted_at, auto_submitted, tab_switch_events, students(full_name, roll_number)")
          .eq("exam_id", examId)
          .order("score", { ascending: false })
      ).data ?? [],
  });

  return (
    <Panel title="Results">
      <select className={`${inputClass} max-w-md`} value={examId} onChange={(e) => setExamId(e.target.value)}>
        <option value="">Select an exam</option>
        {exams.map((x) => (
          <option key={String(x['id'])} value={String(x['id'])}>
            {String(x['title'])} · {String(x['exam_code'])}
          </option>
        ))}
      </select>

      <div className="mt-6 overflow-hidden rounded-[12px] ring-1 ring-brand-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-surface text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3 font-medium">Roll</th>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Tab switches</th>
            </tr>
          </thead>
          <tbody>
            {(results.data ?? []).map((r) => {
              const student = r.students as { full_name?: string; roll_number?: string } | null;
              const events = Array.isArray(r.tab_switch_events) ? r.tab_switch_events.length : 0;
              return (
                <tr key={r.id} className="border-t border-brand-line bg-card">
                  <td className="px-4 py-3 font-medium">{student?.roll_number ?? "—"}</td>
                  <td className="px-4 py-3">{student?.full_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {r.score === null ? "In progress" : `${r.score} / ${r.total_marks ?? "—"}`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}
                    {r.auto_submitted ? " (auto)" : ""}
                  </td>
                  <td className="px-4 py-3">{events}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
