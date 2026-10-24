"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const signupSchema = z.object({
  name: z.string().min(1, "Add your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

export function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState("");
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: params.get("email") || "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof signupSchema>) {
    setError("");
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, referralCode: params.get("ref") }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error);
    if (data.verifyToken) setVerifyToken(data.verifyToken);
    else router.push("/login?check=1");
  }

  async function verify() {
    const response = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: verifyToken }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error);
    router.push("/login?verified=1");
  }

  return (
    <AuthShell title="Create your account" subtitle="Use your school email. You get 25 credits after it's verified, once.">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <input className="field" placeholder="Full name" {...form.register("name")} />
        <input className="field" placeholder="School email" {...form.register("email")} />
        <input className="field" type="password" placeholder="Password" {...form.register("password")} />
        {form.formState.errors.email ? <p className="text-sm text-red-300">{form.formState.errors.email.message}</p> : null}
        {form.formState.errors.password ? <p className="text-sm text-red-300">{form.formState.errors.password.message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button className="h-11 w-full rounded-xl bg-white font-semibold text-black">Create account</button>
      </form>
      {verifyToken ? <button onClick={verify} className="mt-3 h-11 w-full rounded-xl border border-line">Verify school email</button> : null}
      <p className="mt-4 text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-white">Log in</Link></p>
      <div className="mt-4 grid gap-2">
        <a href="/api/oauth/google" className="rounded-xl border border-line py-2 text-center text-sm">Continue with Google</a>
        <a href="/api/oauth/microsoft" className="rounded-xl border border-line py-2 text-center text-sm">Continue with Microsoft</a>
      </div>
    </AuthShell>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error);
    router.push(params.get("next") || "/home");
  }

  return (
    <AuthShell title="Welcome back" subtitle={params.get("verified") ? "Email verified. Your 25 credits are ready." : "Sign in with the school email you verified."}>
      <form onSubmit={submit} className="space-y-3">
        <input className="field" placeholder="School email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="field" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button className="h-11 w-full rounded-xl bg-white font-semibold text-black">Log in</button>
      </form>
      <p className="mt-4 text-center text-sm text-muted"><Link href="/reset" className="text-white">Forgot password</Link> · <Link href="/signup">Create an account</Link></p>
    </AuthShell>
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
        <input className="field" placeholder="School email" value={email} onChange={(event) => setEmail(event.target.value)} />
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
