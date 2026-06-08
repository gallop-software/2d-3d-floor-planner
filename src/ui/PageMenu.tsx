import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Pages of the Vite multi-page app. Add new entries here as more pages appear.
const PAGES = [
  { label: 'Floor Plan', href: '/' },
  { label: 'CAD · Cabinet Cuts', href: '/cad/' },
];

export function PageMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = typeof window !== 'undefined' ? window.location.pathname : '/';

  // Position the dropdown just under the button (fixed → viewport coords).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const isCurrent = (href: string) =>
    href === '/' ? current === '/' : current.startsWith(href.replace(/\/$/, ''));

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Open page menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] min-w-44 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {PAGES.map((p) => (
              <a
                key={p.href}
                href={p.href}
                className={`block px-3 py-2 text-sm hover:bg-stone-100 ${
                  isCurrent(p.href) ? 'font-semibold text-stone-900' : 'text-stone-600'
                }`}
              >
                {p.label}
              </a>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
