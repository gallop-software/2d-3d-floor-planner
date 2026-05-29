import { useSceneStore } from './scene/store';
import { Plan2D } from './views/Plan2D';
import { Scene3D } from './views/Scene3D';
import { Toolbar } from './ui/Toolbar';

export default function App() {
  const viewMode = useSceneStore((s) => s.viewMode);

  return (
    <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-stone-100 text-stone-900">
      <Toolbar />
      <div className="flex flex-1 min-w-0 min-h-0">
        {viewMode === '2d' && <Plan2D />}
        {viewMode === '3d' && <Scene3D />}
        {viewMode === 'split' && (
          <div className="grid h-full w-full grid-rows-2 grid-cols-1 gap-px bg-stone-300 md:grid-rows-1 md:grid-cols-2">
            <div className="min-h-0 min-w-0 bg-stone-50">
              <Plan2D />
            </div>
            <div className="min-h-0 min-w-0 bg-stone-100">
              <Scene3D />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
