import { useSceneStore, type ViewMode } from '../scene/store';

const MODES: { id: ViewMode; label: string }[] = [
  { id: '2d', label: '2D Plan' },
  { id: '3d', label: '3D View' },
  { id: 'split', label: 'Split' },
];

export function ViewModeToggle() {
  const viewMode = useSceneStore((s) => s.viewMode);
  const setViewMode = useSceneStore((s) => s.setViewMode);
  return (
    <div className="inline-flex shrink-0 rounded-md border border-stone-300 bg-white text-sm overflow-hidden">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setViewMode(m.id)}
          className={
            'whitespace-nowrap px-3 py-1.5 transition-colors ' +
            (viewMode === m.id
              ? 'bg-stone-800 text-white'
              : 'text-stone-700 hover:bg-stone-100')
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
