import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { adminExists, bootstrapAdmin } from "@/lib/staff.functions";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Staff Sign-in — School CBT Portal" },
      {
        name: "description",
        content: "Administrators and teachers sign in to manage question banks, exams and results.",
      },
      { property: "og:title", content: "Staff Sign-in — School CBT Portal" },
      {
        property: "og:description",
        content: "Administrators and teachers sign in to manage question banks, exams and results.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StaffAuth,
});

function StaffAuth() {
  const navigate = useNavigate();
  const checkAdmin = useServerFn(adminExists);
  const createAdmin = useServerFn(bootstrapAdmin);
  const { data: adminState } = useQuery({ queryKey: ["admin-exists"], queryFn: () => checkAdmin({}) });

  const [mode, setMode] = useState<"signin" | "setup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setupAvailable = adminState ? !adminState.exists : false;
  const active = setupAvailable && mode === "setup" ? "setup" : "signin";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (active === "setup") {
        const result = await createAdmin({ data: { fullName, email, password } });
        if ("error" in result && result.error) {
          setError(result.error);
          return;
        }
        setNotice("Administrator created. You can sign in now.");
        setMode("signin");
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      await navigate({ to: "/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-base text-brand-ink">
      <header className="flex h-14 items-center justify-between border-b border-brand-line px-6">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          School CBT Portal · Staff
        </span>
        <Link to="/" className="text-xs font-medium text-muted-foreground hover:text-brand-ink">
          Student sign-in
        </Link>
      </header>

      <main className="mx-auto max-w-[44ch] px-6 py-20">
        <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">
          {active === "setup" ? "First-time setup" : "Staff sign-in"}
        </span>
        <h1 className="mt-4 text-4xl font-serif leading-tight text-balance">
          {active === "setup" ? "Create the school administrator account." : "Sign in to your staff account."}
        </h1>

        <form onSubmit={onSubmit} className="mt-12 space-y-4">
          {active === "setup" ? (
            <Field label="Full name" value={fullName} onChange={setFullName} />
          ) : null}
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          <Field label="Password" type="password" value={password} onChange={setPassword} />

          {error ? (
            <p className="rounded-[8px] bg-destructive/5 p-3 text-sm text-destructive ring-1 ring-destructive/20">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-[8px] bg-brand-accent/5 p-3 text-sm text-brand-accent ring-1 ring-brand-accent/20">
              {notice}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-[8px] bg-brand-ink px-6 py-3 text-sm font-medium text-brand-base ring-1 ring-brand-ink disabled:opacity-60"
          >
            {busy ? "Please wait…" : active === "setup" ? "Create administrator" : "Sign in"}
          </button>
        </form>

        {setupAvailable ? (
          <button
            onClick={() => setMode(active === "setup" ? "signin" : "setup")}
            className="mt-6 text-xs font-medium text-muted-foreground hover:text-brand-ink"
          >
            {active === "setup" ? "I already have an account" : "No administrator yet? Set one up"}
          </button>
        ) : (
          <p className="mt-6 text-[11px] text-muted-foreground">
            Teacher accounts are created by the school administrator.
          </p>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
        <input
          type={type}
          value={value}
          required
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-[8px] bg-card p-4 text-sm normal-case tracking-normal text-brand-ink ring-1 ring-brand-line outline-none focus:ring-brand-accent"
        />
      </label>
    </div>
  );
}
