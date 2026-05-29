import { useSceneStore, type Units } from '../scene/store';

const UNITS: { id: Units; label: string }[] = [
  { id: 'imperial', label: 'ft / in' },
  { id: 'inches', label: 'in' },
];

export function UnitsToggle() {
  const units = useSceneStore((s) => s.units);
  const setUnits = useSceneStore((s) => s.setUnits);
  return (
    <div className="inline-flex shrink-0 rounded-md border border-stone-300 bg-white text-sm overflow-hidden">
      {UNITS.map((u) => (
        <button
          key={u.id}
          type="button"
          onClick={() => setUnits(u.id)}
          className={
            'whitespace-nowrap px-3 py-1.5 transition-colors font-mono ' +
            (units === u.id
              ? 'bg-stone-800 text-white'
              : 'text-stone-700 hover:bg-stone-100')
          }
        >
          {u.label}
        </button>
      ))}
    </div>
  );
}
