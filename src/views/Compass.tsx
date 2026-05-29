/**
 * Cardinal compass rose, fixed to the bottom-right of a canvas.
 *
 * `rotationDeg` rotates the whole rose clockwise (screen space). In the 2D plan
 * north is always up (rotationDeg = 0); in 3D the dial tracks the camera so the
 * needle keeps pointing at world-north as you orbit.
 */
export function Compass({ rotationDeg = 0 }: { rotationDeg?: number }) {
  return (
    <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
      <svg
        width={68}
        height={68}
        viewBox="-34 -34 68 68"
        className="drop-shadow"
        aria-label="Compass"
      >
        <circle r={31} fill="white" fillOpacity={0.9} stroke="#d6d3d1" strokeWidth={1} />
        <g transform={`rotate(${rotationDeg})`}>
          {/* Needle: north half red, south half slate */}
          <polygon points="0,-15 4,0 -4,0" fill="#dc2626" />
          <polygon points="0,15 4,0 -4,0" fill="#57534e" />
          <circle r={2.2} fill="white" stroke="#57534e" strokeWidth={1} />

          {/* Cardinal labels */}
          <text x={0} y={-23} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fontFamily="ui-sans-serif, system-ui" fill="#dc2626">N</text>
          <text x={23} y={0} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={600} fontFamily="ui-sans-serif, system-ui" fill="#44403c">E</text>
          <text x={0} y={23} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={600} fontFamily="ui-sans-serif, system-ui" fill="#44403c">S</text>
          <text x={-23} y={0} textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={600} fontFamily="ui-sans-serif, system-ui" fill="#44403c">W</text>
        </g>
      </svg>
    </div>
  );
}
