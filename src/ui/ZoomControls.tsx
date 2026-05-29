type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
};

/** Bottom-left +/- zoom buttons, shared by the 2D and 3D views. */
export function ZoomControls({ onZoomIn, onZoomOut }: Props) {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-md border border-stone-300 bg-white shadow [@media(pointer:coarse)]:hidden">
      <button
        type="button"
        aria-label="Zoom in"
        onClick={onZoomIn}
        className="flex h-9 w-9 items-center justify-center text-xl leading-none text-stone-700 hover:bg-stone-100"
      >
        +
      </button>
      <div className="h-px bg-stone-300" />
      <button
        type="button"
        aria-label="Zoom out"
        onClick={onZoomOut}
        className="flex h-9 w-9 items-center justify-center text-xl leading-none text-stone-700 hover:bg-stone-100"
      >
        −
      </button>
    </div>
  );
}
