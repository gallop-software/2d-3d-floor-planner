import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Scene } from './schema';
import { Scene as SceneSchema } from './schema';
import { home } from '../design/home';
import type { UnitSystem } from './units';

export type ViewMode = '2d' | '3d' | 'split';
export type Units = UnitSystem;

type SceneState = {
  scene: Scene;
  viewMode: ViewMode;
  units: Units;
  loadScene: (scene: Scene) => void;
  loadSceneFromJson: (json: string) => { ok: true } | { ok: false; error: string };
  setViewMode: (mode: ViewMode) => void;
  setUnits: (u: Units) => void;
};

export const useSceneStore = create<SceneState>()(
  persist(
    (set) => ({
      scene: home,
      viewMode: 'split',
      units: 'inches',
      loadScene: (scene) => set({ scene }),
      loadSceneFromJson: (json) => {
        try {
          const parsed = JSON.parse(json);
          const result = SceneSchema.safeParse(parsed);
          if (!result.success) {
            return { ok: false as const, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') };
          }
          set({ scene: result.data });
          return { ok: true as const };
        } catch (e) {
          return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      },
      setViewMode: (viewMode) => set({ viewMode }),
      setUnits: (units) => set({ units }),
    }),
    {
      name: '2d-3d-floor-planner-ui', // localStorage key
      // Persist only UI prefs — never the scene, so design edits still take effect.
      partialize: (s) => ({ viewMode: s.viewMode, units: s.units }),
    },
  ),
);
