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

export function Schools() {
  return (
    <section aria-labelledby="schools-title" className="w-full pb-20">
      <div className="relative border-4 border-[#F7F7F8] shadow-[12px_12px_0_#17171B]">
        <h2
          id="schools-title"
          className="absolute -top-[26px] left-4 m-0 border-4 border-bg bg-[#3D8BFF] px-3.5 pb-2 pt-2.5 font-[family-name:var(--font-pixel)] text-[11px] leading-normal text-white shadow-[0_0_0_4px_#F7F7F8] sm:left-6 sm:text-[13px]"
        >
          PRELAUNCH V1 USED BY STUDENTS FROM
        </h2>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-8 px-3 pb-10 pt-20 sm:pt-14 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] sm:gap-x-6 sm:gap-y-10 sm:px-10 lg:px-14">
          {SCHOOLS.map((school) => (
            <li key={school.name} className={`flex items-center justify-center whitespace-nowrap text-center leading-none text-[#C9C9D0] ${school.style}`}>
              {school.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
