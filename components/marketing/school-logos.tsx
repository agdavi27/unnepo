const SCHOOLS = [
  { name: "Colby", mark: "C" },
  { name: "Penn", mark: "P" },
  { name: "Pitt", mark: "Pitt" },
  { name: "Cornell", mark: "C" },
  { name: "Columbia", mark: "C" },
  { name: "NYU", mark: "NYU" },
  { name: "Brown", mark: "B" },
  { name: "Michigan", mark: "M" },
] as const;

export function SchoolLogos() {
  return (
    <section className="border-y border-line/70 py-8">
      <div className="mx-auto max-w-6xl px-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">Used by students from</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          {SCHOOLS.map((school) => (
            <span key={school.name} className="inline-flex items-center gap-2 text-zinc-100">
              <Crest letters={school.mark} />
              <span className={school.name === "Pitt" ? "hand text-3xl text-amber-100" : "font-serif text-xl tracking-wide"}>{school.name}</span>
            </span>
          ))}
          <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold tracking-wide text-muted">100+ more</span>
        </div>
      </div>
    </section>
  );
}

function Crest({ letters }: { letters: string }) {
  return (
    <svg viewBox="0 0 36 40" className="h-8 w-7 text-white" aria-hidden="true">
      <path d="M18 1.5 33 7.2v12.4c0 8.6-6.1 15.4-15 18.9C9.1 35 3 28.2 3 19.6V7.2L18 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <text x="18" y="24" textAnchor="middle" fill="currentColor" fontSize={letters.length > 2 ? 8 : letters.length > 1 ? 9 : 13} fontFamily="Georgia, serif">
        {letters}
      </text>
    </svg>
  );
}
