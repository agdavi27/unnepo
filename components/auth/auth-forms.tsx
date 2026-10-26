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
    <AuthShell title="Welcome back" subtitle={params.get("verified") ? "Email verified. Your 25 credits are ready." : "Sign in with the school email you used to sign up."}>
      <form onSubmit={submit} className="space-y-3">
        <SchoolEmailField placeholder="School email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} suppressHydrationWarning />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Working…" : "Log in"}</button>
      </form>
      {unverified ? <button type="button" onClick={verifyAndLogin} disabled={busy} className="mt-3 h-11 w-full rounded-xl border border-line">Verify school email and continue</button> : null}
      <p className="mt-4 text-center text-sm text-muted"><Link href="/reset" className="text-white">Forgot password</Link> · <Link href="/signup">Create an account</Link></p>
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(params.get("token") || "");
  const [message, setMessage] = useState("");

  async function request(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const data = await response.json();
    if (data.devToken) setToken(data.devToken);
    setMessage(data.devToken ? "Local mode: use the reset button below. In production this link is emailed." : "If that school email exists, a reset link is on the way.");
  }

  async function reset(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const data = await response.json();
    setMessage(response.ok ? "Password updated. You can log in." : data.error);
  }

  return (
    <AuthShell title="Reset password" subtitle="We'll only email school addresses that already have an account.">
      <form onSubmit={request} className="space-y-3">
        <SchoolEmailField placeholder="School email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button className="h-11 w-full rounded-xl bg-white font-semibold text-black">Send reset link</button>
      </form>
      <form onSubmit={reset} className="mt-4 space-y-3">
        <input className="field" placeholder="Reset token" value={token} onChange={(event) => setToken(event.target.value)} />
        <input className="field" type="password" placeholder="New password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button className="h-11 w-full rounded-xl border border-line">Update password</button>
      </form>
      {message ? <p className="mt-3 text-sm text-cream">{message}</p> : null}
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
