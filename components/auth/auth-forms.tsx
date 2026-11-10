"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { isSchoolEmail } from "@/lib/schools";
import { CONTACT_EMAIL } from "@/lib/config";
import { Logo } from "@/components/brand/logo";

const signupSchema = z.object({
  name: z.string().min(1, "Add your name"),
  email: z.string().email("Enter a valid email").refine(isSchoolEmail, "Use a school email such as name@college.edu. Gmail and Outlook.com are not eligible."),
  password: z.string().min(8, "Use at least 8 characters"),
});

export function SignupForm({ google = false }: { google?: boolean }) {
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
      body: JSON.stringify(values),
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
      {google ? <GoogleButton /> : null}
      <form method="post" action="/api/auth/signup" onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <input className="field" placeholder="Full name" autoComplete="name" suppressHydrationWarning {...form.register("name")} />
        {form.formState.errors.name ? <p className="text-sm text-red-300">{form.formState.errors.name.message}</p> : null}
        <SchoolEmailField value={form.watch("email")} placeholder="School email" autoComplete="email" {...form.register("email")} />
        {form.formState.errors.email ? <p className="text-sm text-red-300">{form.formState.errors.email.message}</p> : null}
        <input className="field" type="password" placeholder="Password (8+ characters)" autoComplete="new-password" suppressHydrationWarning {...form.register("password")} />
        {form.formState.errors.password ? <p className="text-sm text-red-300">{form.formState.errors.password.message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-white font-semibold text-black disabled:opacity-60">{busy ? "Creating account…" : "Create account"}</button>
      </form>
      <p className="mt-4 text-center text-xs text-faint">By creating an account, you agree to the <Link href="/terms" className="underline underline-offset-4 hover:text-white">Terms of Service</Link> and <Link href="/privacy" className="underline underline-offset-4 hover:text-white">Privacy Policy</Link>.</p>
      <p className="mt-4 text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-white">Log in</Link></p>
    </AuthShell>
  );
}

export function LoginForm({ google = false }: { google?: boolean }) {
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
      {google ? <GoogleButton /> : null}
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

/** Sign in, or make an account, with the school Google account. A plain link: the server sends it to Google. */
function GoogleButton() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a server route that redirects to Google */}
      <a href="/api/oauth/google" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-white text-sm font-medium text-black hover:bg-zinc-200">
        <GoogleMark /> Continue with Google
      </a>
      <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-[#26262C]" />or<span className="h-px flex-1 bg-[#26262C]" />
      </div>
    </>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.6-1.9.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.9 10.7A5.4 5.4 0 0 1 3.6 9c0-.6.1-1.2.3-1.7V5H.9A9 9 0 0 0 0 9c0 1.4.3 2.8.9 4l3-2.3Z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15.1 2A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z" />
    </svg>
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
    // Local runs only: no email is sent, so the link is shown here.
    if (data.resetUrl && !data.sent) {
      setResetUrl(data.resetUrl);
      setMessage("Email isn't set up on this computer, so use this link to choose a new password.");
      return;
    }
    // The same answer whether or not there's an account, so nobody can use this to check who's signed up.
    setMessage(`If there's an Unnepo account for ${email.trim()}, a reset link is on its way. Check spam too. Nothing after a few minutes? Email ${CONTACT_EMAIL}.`);
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
        <Logo href="/" className="text-2xl font-semibold" />
        <h1 className="mt-6 text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
