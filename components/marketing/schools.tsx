/**
 * "Prelaunch v1 used by students from" strip under the hero. Schools are set as type, not their official logos,
 * so nothing here suggests the school itself endorses Unnepo.
 */

const SERIF = "font-[family-name:Georgia,'Times_New_Roman',serif]";

const SCHOOLS: Array<{ name: string; style: string }> = [
  { name: "Colby", style: `${SERIF} text-[34px] tracking-[-1px]` },
  { name: "Penn", style: `${SERIF} text-[34px] tracking-[-0.5px]` },
  { name: "Cornell", style: `${SERIF} text-[28px]` },
  { name: "Columbia", style: `${SERIF} text-[25px]` },
  { name: "NYU", style: "font-sans text-[26px] font-bold tracking-[0.5px]" },
  { name: "Boston College", style: `${SERIF} text-[21px]` },
  { name: "Pitt", style: `${SERIF} text-[32px] font-bold tracking-[-1px]` },
  { name: "Georgetown", style: `${SERIF} text-[27px]` },
  { name: "UCLA", style: "font-sans text-[32px] font-bold italic tracking-[-0.5px]" },
  { name: "Dartmouth", style: `${SERIF} text-[28px]` },
  { name: "UVA", style: `${SERIF} text-[30px] tracking-[1px]` },
  { name: "Northeastern", style: `${SERIF} text-[21px]` },
];

/** A phone shows six short names, so three fit on a line. */
const PHONE_SCHOOLS = new Set(SCHOOLS.filter((school) => school.name.length <= 9).slice(0, 6).map((school) => school.name));

export function Schools() {
  return (
    <section aria-labelledby="schools-title" className="w-full pb-14 sm:pb-20">
      <div className="relative border-4 border-[#F7F7F8] shadow-[8px_8px_0_#17171B] sm:shadow-[12px_12px_0_#17171B]">
        <h2
          id="schools-title"
          className="absolute -top-[22px] left-3 m-0 border-4 border-bg bg-[#3D8BFF] px-2.5 pb-1.5 pt-2 font-[family-name:var(--font-pixel)] text-[8px] leading-normal text-white shadow-[0_0_0_4px_#F7F7F8] sm:-top-[26px] sm:left-6 sm:px-3.5 sm:pb-2 sm:pt-2.5 sm:text-[13px]"
        >
          PRELAUNCH V1 USED BY STUDENTS FROM
        </h2>
        {/* A phone shows six in three columns and counts the rest, so the box stays short. */}
        <ul className="grid grid-cols-3 gap-x-2 gap-y-5 px-2 pb-5 pt-9 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] sm:gap-x-6 sm:gap-y-10 sm:px-10 sm:pb-10 sm:pt-14 lg:px-14">
          {SCHOOLS.map((school) => (
            <li key={school.name} className={`flex items-center justify-center whitespace-nowrap text-center leading-none text-[#C9C9D0] ${school.style} max-sm:text-[19px] ${PHONE_SCHOOLS.has(school.name) ? "" : "max-sm:hidden"}`}>
              {school.name}
            </li>
          ))}
          <li className="col-span-3 text-center text-xs text-[#9A9AA3] sm:hidden">and {SCHOOLS.length - PHONE_SCHOOLS.size} more</li>
        </ul>
      </div>
    </section>
  );
}
