const SCHOOLS = [
  { name: "Harvard", src: "/schools/harvard.png" },
  { name: "Yale", src: "/schools/yale.png" },
  { name: "Princeton", src: "/schools/princeton.png" },
  { name: "Columbia", src: "/schools/columbia.png" },
  { name: "Cornell", src: "/schools/cornell.png" },
  { name: "Penn", src: "/schools/penn.png" },
  { name: "MIT", src: "/schools/mit.png" },
  { name: "Stanford", src: "/schools/stanford.png" },
  { name: "Brown", src: "/schools/brown.png" },
  { name: "NYU", src: "/schools/nyu.png" },
  { name: "Michigan", src: "/schools/michigan.png" },
  { name: "Pitt", src: "/schools/pitt.png" },
  { name: "Colby", src: "/schools/colby.png" },
  { name: "Duke", src: "/schools/duke.png" },
  { name: "Berkeley", src: "/schools/berkeley.png" },
  { name: "UCLA", src: "/schools/ucla.png" },
  { name: "Northwestern", src: "/schools/northwestern.png" },
  { name: "Georgetown", src: "/schools/georgetown.png" },
] as const;

const ROW_ONE = SCHOOLS;
const ROW_TWO = [...SCHOOLS].reverse();

export function SchoolLogos() {
  return (
    <section className="border-y border-line/70 py-8">
      <p className="px-5 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-faint">Used by students from</p>
      <div className="mt-5 space-y-3">
        <LogoRow schools={ROW_ONE} />
        <LogoRow schools={ROW_TWO} reverse />
      </div>
      <p className="mt-4 text-center text-xs font-semibold tracking-wide text-muted">and 100+ more campuses</p>
    </section>
  );
}

function LogoRow({ schools, reverse = false }: { schools: readonly { name: string; src: string }[]; reverse?: boolean }) {
  return (
    <div className="overflow-hidden">
      <div className={`flex w-max ${reverse ? "school-track school-track-reverse" : "school-track"}`}>
        {[0, 1, 2].map((copy) => (
          <div key={copy} className="flex shrink-0 flex-nowrap gap-3 pr-3">
            {schools.map((school) => (
              <figure key={`${school.name}-${copy}`} className="flex h-16 w-40 shrink-0 items-center justify-center rounded-xl bg-white px-4 py-2" aria-hidden={copy > 0}>
                <img src={school.src} alt={copy === 0 ? school.name : ""} className="h-10 w-auto max-w-32 object-contain" loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
