import { H, W, spiderRects } from "@/extension/src/shared/sprite";

const RECTS = spiderRects(0);

/** While a page loads: Unnepo's spider jumping in the middle of the screen. */
export function SpiderLoader({ label, note }: { label: string; note?: string }) {
  return (
    <div role="status" className="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-center gap-2">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="spider-jump" style={{ width: 72, height: Math.round((72 * H) / W) }}>
        <svg viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" className="block h-full w-full rotate-180" dangerouslySetInnerHTML={{ __html: RECTS }} />
      </div>
      <div aria-hidden className="spider-jump-shadow h-1.5 w-14 rounded-full bg-white/10" />
      {note && <p aria-hidden className="m-0 mt-3 px-4 text-center text-[13px] text-[#8B8B94]">{note}</p>}
    </div>
  );
}
