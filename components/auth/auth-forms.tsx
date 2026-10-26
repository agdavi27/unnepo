"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { isSchoolEmail } from "@/lib/schools";

const signupSchema = z.object({
  name: z.string().min(1, "Add your name"),
  email: z.string().email("Enter a valid email").refine(isSchoolEmail, "Use a school email such as name@college.edu. Gmail and Outlook.com are not eligible."),
  password: z.string().min(8, "Use at least 8 characters"),
});

export function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState(params.get("error") || "");
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: params.get("email") || "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signupSchema>) {
    setError("");
    setBusy(true);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, referralCode: params.get("ref") || undefined }),
    });
    const data = await response.json();
    if (!response.ok) {
      setBusy(false);
      if (data.code === "duplicate") {
        setError("An account with this email already exists. Log in, and verify the email if you have not yet.");
        return;
      }
      setError(data.error || "Could not create the account.");
      return;
    }
    if (data.verifyToken) {
      const verified = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: data.verifyToken }) });
      const verifiedData = await verified.json();
      if (!verified.ok) {
        setBusy(false);
        setError(verifiedData.error || "Account created, but verification failed. Use Log in to finish.");
        return;
      }
      const loggedIn = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: values.email, password: values.password }),
      });
      const loggedInData = await loggedIn.json();
      setBusy(false);
      if (!loggedIn.ok) {
        setError(loggedInData.error || "Account created. Log in with the same password.");
        return;
      }
      router.push("/onboarding");
      return;
    }
    setBusy(false);
    router.push("/login?check=1");
  }

  return (
    <AuthShell title="Create your account" subtitle="Use a school email such as name@college.edu. Personal addresses like Gmail are not eligible.">
      <form method="post" action="/api/auth/signup" onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <input type="hidden" name="referralCode" value={params.get("ref") || ""} suppressHydrationWarning />
        <input className="field" placeholder="Full name" autoComplete="name" suppressHydrationWarning {...form.register("name")} />
        {form.formState.errors.name ? <p className="text-sm text-red-300">{form.formState.errors.name.message}</p> : null}
        <SchoolEmailField value={form.watch("email")} placeholder="School email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? <p className="text-sm text-red-300">{form.formState.errors.email.message}</p> : null}
        <input className="field" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" suppressHydrationWarning {...form.register("password")} />
        {form.formState.errors.password ? <p className="text-sm text-red-300">{form.formState.errors.password.message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-white">Log in</Link></p>
    </AuthShell>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState(params.get("error") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setUnverified(false);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Could not log in.");
      if (data.code === "unverified") setUnverified(true);
      return;
    }
    router.push(params.get("next") || "/home");
  }

  async function verifyAndLogin() {
    setBusy(true);
    setError("");
    const resent = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const resentData = await resent.json();
    if (!resentData.devToken) {
      setBusy(false);
      setError("Check the school inbox for the verification link, then log in.");
      return;
    }
    const verified = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resentData.devToken }) });
    const verifiedData = await verified.json();
    if (!verified.ok) {
      setBusy(false);
      setError(verifiedData.error || "Verification failed.");
      return;
    }
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setError(data.error || "Verified. Try logging in again.");
    router.push(params.get("next") || "/home");
  }

  return (
    <AuthShell title="Welcome back" subtitle={params.get("verified") ? "Email verified. Your monthly credits are ready." : params.get("reset") ? "Password updated. Sign in with the new password." : "Sign in with the school email you used to sign up."}>
      <form onSubmit={submit} className="space-y-3">
        <SchoolEmailField placeholder="School email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} suppressHydrationWarning />
        <div className="flex justify-end">
          <Link href="/reset" className="text-sm text-white hover:underline">Forgot password?</Link>
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Working…" : "Log in"}</button>
      </form>
      {unverified ? <button type="button" onClick={verifyAndLogin} disabled={busy} className="mt-3 h-11 w-full rounded-xl border border-line">Verify school email and continue</button> : null}
      <p className="mt-4 text-center text-sm text-muted">Need an account? <Link href="/signup" className="text-white">Create one</Link></p>
    </AuthShell>
  );
}

function SchoolEmailField({ value, ref, ...props }: { value: string; ref?: React.Ref<HTMLInputElement> } & React.InputHTMLAttributes<HTMLInputElement>) {
  const recognized = isSchoolEmail(value || "");
  return (
    <div className="relative">
      <input {...props} ref={ref} value={value} className="field pr-10" suppressHydrationWarning />
      {recognized ? <Check className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-emerald-400" aria-hidden={false} aria-label="School email looks right" /> : null}
    </div>
  );
}

export function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function request(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setResetUrl("");
    const response = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "Could not send a reset link.");
      return;
    }
    if (data.sent) {
      setMessage("Check that school inbox for the reset link. It can land in spam.");
      return;
    }
    if (data.resetUrl) {
      setResetUrl(data.resetUrl);
      setMessage("Email sending is not connected yet, so use this link to choose a new password.");
      return;
    }
    setError("No account exists for that school email.");
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || "This reset link is invalid or expired.");
      return;
    }
    router.push("/login?reset=1");
  }

  if (token) {
    return (
      <AuthShell title="Choose a new password" subtitle="This link works once and expires after 24 hours.">
        <form onSubmit={reset} className="space-y-3">
          <input className="field" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} suppressHydrationWarning />
          <input className="field" type="password" placeholder="Confirm new password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} suppressHydrationWarning />
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Updating…" : "Update password"}</button>
        </form>
        <p className="mt-4 text-center text-sm text-muted"><Link href="/login" className="text-white">Back to log in</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="Enter the school email on the account. We send a reset link only if that address already exists.">
      <form onSubmit={request} className="space-y-3">
        <SchoolEmailField placeholder="School email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {message ? <p className="text-sm text-cream">{message}</p> : null}
        {resetUrl ? (
          <Link href={resetUrl} className="flex h-11 items-center justify-center rounded-xl bg-white font-semibold text-black">
            Open reset link
          </Link>
        ) : (
          <button type="submit" disabled={busy || !email} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Sending…" : "Email me a reset link"}</button>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-muted"><Link href="/login" className="text-white">Back to log in</Link></p>
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md rounded-3xl border border-line bg-card p-6">
        <Link href="/" className="text-2xl font-semibold">unnepo.</Link>
        <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
