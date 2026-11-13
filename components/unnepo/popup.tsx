"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Open popups, newest last: Escape closes only the one on top (a person's popup over a job's). */
const stack: Array<object> = [];

/** A popup over the blurred page. Escape or a click outside closes it. */
export function Popup({ label, onClose, children, width = "max-w-lg", bare = false }: { label: string; onClose: () => void; children: ReactNode; width?: string; bare?: boolean }) {
  const me = useRef({});
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const self = me.current;
    stack.push(self);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && stack[stack.length - 1] === self) close.current(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      const at = stack.indexOf(self);
      if (at >= 0) stack.splice(at, 1);
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-md sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`relative max-h-[90vh] w-full ${width} overflow-y-auto border border-line bg-[#0C0C0E] text-[#F7F7F8] shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] ${bare ? "rounded-3xl" : "rounded-2xl p-5 sm:p-6"}`}>
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg text-lg leading-none text-[#8B8B94] hover:bg-white/5 hover:text-white">×</button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
