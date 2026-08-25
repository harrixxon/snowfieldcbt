import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset Password — School CBT Portal" },
      {
        name: "description",
        content: "Set a new password for the school administrator account of the CBT portal.",
      },
      { property: "og:title", content: "Reset Password — School CBT Portal" },
      {
        property: "og:description",
        content: "Set a new password for the school administrator account of the CBT portal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setNotice("Password updated. Redirecting to your dashboard…");
      setTimeout(() => void navigate({ to: "/dashboard" }), 1200);
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
        <Link to="/auth" className="text-xs font-medium text-muted-foreground hover:text-brand-ink">
          Staff sign-in
        </Link>
      </header>

      <main className="mx-auto max-w-[44ch] px-6 py-20">
        <span className="text-xs font-medium uppercase tracking-widest text-brand-accent">Password reset</span>
        <h1 className="mt-4 text-4xl font-serif leading-tight text-balance">Choose a new password.</h1>

        {!ready ? (
          <p className="mt-8 text-sm text-muted-foreground">
            Open this page from the reset link in your email. If you arrived here directly, request a new link on the
            staff sign-in page.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-12 space-y-4">
            <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              New password
              <input
                type="password"
                value={password}
                required
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-[8px] bg-card p-4 text-sm normal-case tracking-normal text-brand-ink ring-1 ring-brand-line outline-none focus:ring-brand-accent"
              />
            </label>
            <label className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Confirm password
              <input
                type="password"
                value={confirm}
                required
                minLength={8}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-2 w-full rounded-[8px] bg-card p-4 text-sm normal-case tracking-normal text-brand-ink ring-1 ring-brand-line outline-none focus:ring-brand-accent"
              />
            </label>

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
              {busy ? "Please wait…" : "Update password"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
