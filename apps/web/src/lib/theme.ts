export type Theme = "light" | "dark";

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

/** Switch theme: a circle grows out from the control (view transitions), or a quick cross-fade. */
export function setTheme(t: Theme, from?: HTMLElement | null) {
  if (currentTheme() === t) return;
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = t;
    try {
      localStorage.setItem("fevo.theme", t);
    } catch {
      /* private mode: the theme just won't stick */
    }
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (doc.startViewTransition && !reduce && from) {
    const r = from.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    doc
      .startViewTransition(apply)
      .ready.then(() =>
        root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] }, { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" }),
      )
      .catch(() => {});
  } else {
    root.classList.add("theming");
    apply();
    setTimeout(() => root.classList.remove("theming"), 320);
  }
}
