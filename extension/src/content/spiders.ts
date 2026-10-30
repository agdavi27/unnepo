import { H, spiderRects, W } from "../shared/sprite";

/**
 * The fill animation: when the student presses Fill, a few little pixel spiders drop down on threads,
 * land, and crawl around the page the whole time Unnepo is running, then scurry off once the
 * application is submitted, something goes wrong, or the student presses Stop. At most five. It never blocks
 * the page (no pointer events), lives in its own shadow root so the site's CSS can't touch it, and is
 * skipped entirely for people who turn on reduced motion. It doesn't slow the fill down.
 */

type Point = [number, number];

const FRAMES = [spiderRects(0), spiderRects(1)];

type Spider = {
  el: HTMLDivElement;
  thread: HTMLDivElement;
  frames: SVGGElement[];
  size: number;
  x: number;
  y: number;
  angle: number;
  phase: "wait" | "drop" | "turn" | "crawl" | "rest" | "leave" | "gone";
  start: number;
  dropTo: number;
  target: Point;
  speed: number;
  restUntil: number;
  frame: number;
  lastStep: number;
};

let host: HTMLDivElement | null = null;
let spiders: Spider[] = [];
let raf = 0;
let leaving = false;
let exitTimer = 0;
let last = 0;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function pickTarget(spider: Spider): Point {
  const m = spider.size;
  return [rand(m, innerWidth - m), rand(m, innerHeight - m)];
}

/** Nearest way off the screen. */
function exitPoint(spider: Spider): Point {
  const options: Point[] = [[-spider.size * 2, spider.y], [innerWidth + spider.size * 2, spider.y], [spider.x, -spider.size * 2], [spider.x, innerHeight + spider.size * 2]];
  return options.sort((a, b) => Math.hypot(a[0] - spider.x, a[1] - spider.y) - Math.hypot(b[0] - spider.x, b[1] - spider.y))[0];
}

function make(root: ShadowRoot, index: number, count: number, now: number, drop: boolean): Spider {
  const size = Math.round(rand(40, 58));
  const el = document.createElement("div");
  el.className = "spider";
  el.style.width = `${size}px`;
  el.style.height = `${Math.round((size * H) / W)}px`;
  const thread = document.createElement("div");
  thread.className = "thread";
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" shape-rendering="crispEdges"><g>${FRAMES[0]}</g><g style="display:none">${FRAMES[1]}</g></svg>`;
  el.innerHTML = svg;
  el.prepend(thread);
  root.appendChild(el);
  // Spread across the top of the screen, a little out of line.
  const lane = (index + 0.5) / count;
  const x = Math.min(innerWidth - size, Math.max(size, innerWidth * lane + rand(-40, 40)));
  const spider: Spider = {
    el, thread, frames: Array.from(el.querySelectorAll("g")) as SVGGElement[], size, x, y: -size, angle: 180, phase: "wait",
    start: now + index * rand(90, 180), dropTo: rand(innerHeight * 0.18, innerHeight * 0.55), target: [0, 0], speed: rand(70, 120),
    restUntil: 0, frame: 0, lastStep: 0,
  };
  if (!drop) {
    // The same spiders carrying on after the page changed: already down and crawling, no new batch dropping in.
    thread.remove();
    spider.y = rand(size, innerHeight - size);
    spider.angle = rand(0, 360);
    spider.phase = "rest";
    spider.restUntil = now + rand(0, 600);
  }
  return spider;
}

function draw(spider: Spider) {
  const h = (spider.size * H) / W;
  spider.el.style.transform = `translate(${spider.x - spider.size / 2}px, ${spider.y - h / 2}px)`;
  const svg = spider.el.querySelector("svg") as SVGSVGElement;
  svg.style.transform = `rotate(${spider.angle}deg)`;
  spider.frames[0].style.display = spider.frame ? "none" : "";
  spider.frames[1].style.display = spider.frame ? "" : "none";
}

function tick(now: number) {
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  for (const spider of spiders) {
    if (spider.phase === "gone") continue;
    const moving = () => {
      if (now - spider.lastStep > 110) { spider.frame = spider.frame ? 0 : 1; spider.lastStep = now; }
    };
    if (spider.phase === "wait" && now >= spider.start) spider.phase = "drop";
    if (spider.phase === "drop") {
      // Ease down the thread with a little bounce at the bottom.
      const t = Math.min(1, (now - spider.start) / 900);
      const ease = t < 1 ? 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.06 : 1;
      spider.y = -spider.size + (spider.dropTo + spider.size) * ease;
      spider.thread.style.height = `${Math.max(0, spider.y + spider.size)}px`;
      if (t >= 1) { spider.phase = "turn"; spider.start = now; spider.target = pickTarget(spider); }
    } else if (spider.phase === "turn") {
      // Let go of the thread and turn to face where it's headed.
      const t = Math.min(1, (now - spider.start) / 320);
      spider.thread.style.opacity = String(1 - t);
      const heading = (Math.atan2(spider.target[0] - spider.x, -(spider.target[1] - spider.y)) * 180) / Math.PI;
      spider.angle = 180 + (((heading - 180 + 540) % 360) - 180) * t;
      if (t >= 1) { spider.thread.remove(); spider.phase = "crawl"; }
    } else if (spider.phase === "crawl" || spider.phase === "leave") {
      const [tx, ty] = spider.target;
      const dx = tx - spider.x, dy = ty - spider.y;
      const distance = Math.hypot(dx, dy);
      const speed = spider.phase === "leave" ? 320 : spider.speed;
      if (distance < 4) {
        if (spider.phase === "leave") { spider.phase = "gone"; spider.el.remove(); continue; }
        spider.phase = "rest";
        spider.restUntil = now + rand(250, 1100);
      } else {
        const stepLength = Math.min(distance, speed * dt);
        spider.x += (dx / distance) * stepLength;
        spider.y += (dy / distance) * stepLength;
        const heading = (Math.atan2(dx, -dy) * 180) / Math.PI;
        // Turn smoothly instead of snapping.
        const diff = ((heading - spider.angle + 540) % 360) - 180;
        spider.angle += diff * Math.min(1, dt * 10);
        moving();
      }
    } else if (spider.phase === "rest" && now >= spider.restUntil) {
      spider.target = pickTarget(spider);
      spider.phase = "crawl";
    }
    draw(spider);
  }
  if (spiders.every((spider) => spider.phase === "gone")) return stop();
  raf = requestAnimationFrame(tick);
}

function stop() {
  cancelAnimationFrame(raf);
  host?.remove();
  host = null;
  spiders = [];
  leaving = false;
  last = 0;
}

/**
 * Spiders drop in, once per run (`drop`). Calling again while they're out just keeps them around; after a
 * new page load the same number come back already crawling, never a fresh batch dropping from the top.
 */
export function startSpiders(drop = true) {
  clearTimeout(exitTimer);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (host) {
    // Called back before they'd left: stop leaving and keep crawling.
    if (leaving) {
      leaving = false;
      for (const spider of spiders) if (spider.phase === "leave") { spider.phase = "crawl"; spider.target = pickTarget(spider); }
    }
    return;
  }
  // Anything left from an earlier copy of this script goes first, so there's only ever one set.
  const stale = document.querySelectorAll("[data-unnepo-spiders]");
  if (stale.length) drop = false;
  stale.forEach((el) => el.remove());
  host = document.createElement("div");
  host.setAttribute("data-unnepo-spiders", "");
  host.setAttribute("aria-hidden", "true");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; overflow: hidden; }
    .spider { position: absolute; left: 0; top: 0; will-change: transform; filter: drop-shadow(2px 3px 0 rgba(0,0,0,.18)); }
    .spider svg { display: block; transform-origin: 50% 50%; }
    .thread { position: absolute; left: calc(50% - 1.5px); bottom: 70%; width: 3px; background: linear-gradient(90deg, #000 0 1px, #EAF6F2 1px 2px, #000 2px); }
  `;
  root.appendChild(style);
  document.documentElement.appendChild(host);
  const count = innerWidth < 700 ? 3 : 5;
  const now = performance.now();
  spiders = Array.from({ length: count }, (_, index) => make(root, index, count, now, drop));
  for (const spider of spiders) draw(spider);
  raf = requestAnimationFrame(tick);
}

/** Every spider scurries off the nearest edge. */
export function stopSpiders(after = 400) {
  clearTimeout(exitTimer);
  exitTimer = window.setTimeout(() => {
    if (!host) return;
    leaving = true;
    for (const spider of spiders) {
      if (spider.phase === "gone") continue;
      spider.thread.remove();
      spider.phase = "leave";
      spider.target = exitPoint(spider);
    }
    // However slowly the page is animating (a background tab), they're gone within a few seconds.
    exitTimer = window.setTimeout(() => { if (leaving) stop(); }, 4000);
  }, after);
}
