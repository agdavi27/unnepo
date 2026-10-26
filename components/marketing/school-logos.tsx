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

const ROW_ONE = SCHOOLS.filter((_, index) => index % 2 === 0);
const ROW_TWO = SCHOOLS.filter((_, index) => index % 2 === 1);

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
  const loop = [...schools, ...schools];
  return (
    <div className="school-marquee">
      <div className={reverse ? "school-track school-track-reverse" : "school-track"}>
        {loop.map((school, index) => (
          <figure key={`${school.name}-${index}`} className="flex h-16 shrink-0 items-center rounded-xl bg-white px-5 py-2" aria-hidden={index >= schools.length}>
            <img src={school.src} alt={index < schools.length ? school.name : ""} className="h-10 w-auto max-w-36 object-contain" />
          </figure>
        ))}
      </div>
    </div>
  );
}
