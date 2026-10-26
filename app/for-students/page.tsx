import Link from "next/link";

export default function ForStudentsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="text-2xl font-semibold">unnepo.</Link>
      <h1 className="mt-8 text-4xl font-semibold">For students who were not handed a network.</h1>
      <p className="mt-4 text-muted">Unnepo is a career networking workspace for school email addresses. Showing up to 20 people costs one credit. An empty search costs nothing. Unlocking a verified work email or business phone costs one more credit, and only after the lookup succeeds. Writing and sending email does not spend credits. You send from your own Gmail or Outlook account, and Unnepo tracks replies you authorize it to read.</p>
      <p className="mt-4 text-muted">Sample profiles in local development are labeled. They are not live people. Connect Apollo and Hunter before you treat a result as a real professional.</p>
      <Link href="/signup" className="mt-8 inline-flex rounded-full bg-white px-4 py-2 font-semibold text-black">Get 25 free credits</Link>
    </main>
  );
}
