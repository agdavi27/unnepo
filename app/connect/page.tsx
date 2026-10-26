import Link from "next/link";
import { headers } from "next/headers";
import { oauthReady } from "@/lib/services/oauth";

export default async function Page({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const params = await searchParams;
  const provider = params.provider === "microsoft" ? "microsoft" : "google";
  const headerList = await headers();
  const forwardedHost = headerList.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || headerList.get("host") || "127.0.0.1:43123";
  const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const ready = oauthReady();
  const connected = provider === "google" ? ready.google : ready.microsoft;

  return (
    <div className="min-h-screen bg-bg px-4 py-10 text-ink">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-2xl font-semibold">unnepo.</Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-faint">{provider === "google" ? "Google" : "Microsoft"}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Mailbox sending needs an app you create.</h1>
        <p className="mt-4 text-muted">
          Sign-in is your school email and a password. Google and Microsoft are only for sending from your own inbox, and Unnepo cannot mint those client secrets. Only the account that owns the app can do that.
        </p>
        <Link href="/signup" className="mt-6 inline-flex h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black">Create an account with your school email</Link>

        {connected ? (
          <p className="mt-8 rounded-2xl border border-line bg-card p-4 text-sm">
            {provider === "google" ? "Google" : "Microsoft"} credentials are present. Connect the mailbox from Settings after you log in with your school email.
          </p>
        ) : (
          <ol className="mt-8 space-y-4">
            {(provider === "google" ? googleSteps(origin) : microsoftSteps(origin)).map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-faint">Step {index + 1}</p>
                <h2 className="mt-1 font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm text-muted">{step.body}</p>
                {step.href ? <a href={step.href} className="mt-2 inline-block text-sm text-white underline" target="_blank" rel="noreferrer">{step.hrefLabel}</a> : null}
                {step.code ? <pre className="mt-3 overflow-x-auto rounded-xl bg-black px-3 py-2 text-xs text-cream">{step.code}</pre> : null}
              </li>
            ))}
          </ol>
        )}

        <p className="mt-6 text-sm text-faint">
          {provider === "google" ? <Link href="/connect?provider=microsoft" className="text-white">Microsoft steps</Link> : <Link href="/connect?provider=google" className="text-white">Google steps</Link>}
          {" · "}
          <Link href="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  );
}

function googleSteps(origin: string) {
  return [
    {
      title: "Create an OAuth client",
      body: "In Google Cloud, create a project, open Google Auth Platform, and add yourself as a test user while the app is in testing. Then create an OAuth client ID of type Web application.",
      href: "https://console.cloud.google.com/auth/clients",
      hrefLabel: "Open Google Auth clients",
      code: "",
    },
    {
      title: "Register this redirect URI",
      body: "Paste this URI exactly. Google rejects the connection if it does not match the address in your browser.",
      href: "",
      hrefLabel: "",
      code: `${origin}/api/oauth/gmail/callback`,
    },
    {
      title: "Save the client id and secret on the server",
      body: "Add these two lines to .env.local in the project root. Do not commit that file. The next Google click reads it. No server restart is required.",
      href: "",
      hrefLabel: "",
      code: "GOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=",
    },
  ];
}

function microsoftSteps(origin: string) {
  return [
    {
      title: "Register an application",
      body: "In Microsoft Entra, register an app. Supported account types: accounts in any organizational directory and personal Microsoft accounts. Copy the Application (client) ID.",
      href: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      hrefLabel: "Open Microsoft app registrations",
      code: "",
    },
    {
      title: "Add this redirect URI",
      body: "Under Authentication, add a Web platform and paste this URI exactly.",
      href: "",
      hrefLabel: "",
      code: `${origin}/api/oauth/outlook/callback`,
    },
    {
      title: "Create a client secret and save it",
      body: "Under Certificates & secrets, create a client secret and copy the value immediately. Add both lines to .env.local. Do not commit that file. The next Microsoft click reads it.",
      href: "",
      hrefLabel: "",
      code: "MICROSOFT_CLIENT_ID=\nMICROSOFT_CLIENT_SECRET=",
    },
  ];
}
