import { useEffect, useRef, useState } from 'react';
import { ViewModeToggle } from './ViewModeToggle';
import { UnitsToggle } from './UnitsToggle';
import { PageMenu } from './PageMenu';

const EDGE = 28; // px width of the fade at a scrollable edge

export function Toolbar() {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Soft-fade whichever edge(s) have more content to scroll toward.
  const mask =
    fade.left && fade.right
      ? `linear-gradient(to right, transparent, #000 ${EDGE}px, #000 calc(100% - ${EDGE}px), transparent)`
      : fade.left
        ? `linear-gradient(to right, transparent, #000 ${EDGE}px)`
        : fade.right
          ? `linear-gradient(to right, #000 calc(100% - ${EDGE}px), transparent)`
          : undefined;

  return (
    <div className="border-b border-stone-300 bg-white">
      <div
        ref={ref}
        onScroll={update}
        className="no-scrollbar flex items-center gap-3 overflow-x-auto whitespace-nowrap px-3 py-2 sm:px-4"
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        <PageMenu />
        <div className="shrink-0 whitespace-nowrap text-sm font-semibold text-stone-900">2D/3D Floor Planner</div>
        <div className="mx-1 h-5 w-px shrink-0 bg-stone-300" />
        <ViewModeToggle />
        <div className="mx-1 h-5 w-px shrink-0 bg-stone-300" />
        <UnitsToggle />
      </div>
    </div>
  );
}
