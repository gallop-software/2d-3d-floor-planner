import { z } from 'zod';

export const Vec2 = z.object({
  x: z.number(),
  y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2>;

export const Vec3 = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vec3 = z.infer<typeof Vec3>;

// Walls are zero-thickness planes (centerline geometry) — no thickness field.
export const Wall = z.object({
  id: z.string(),
  start: Vec2,
  end: Vec2,
  height: z.number().default(96),
});
export type Wall = z.infer<typeof Wall>;

export const Opening = z.object({
  id: z.string(),
  wallId: z.string(),
  type: z.enum(['door', 'window', 'opening']),
  position: z.number(),
  width: z.number(),
  height: z.number(),
  sillHeight: z.number().optional(),
});
export type Opening = z.infer<typeof Opening>;

export const Room = z.object({
  id: z.string(),
  name: z.string(),
  polygon: z.array(Vec2).min(3),
  ceilingHeight: z.number().optional(),
  floorColor: z.string().optional(),
});
export type Room = z.infer<typeof Room>;

export const Fixture = z.object({
  id: z.string(),
  type: z.enum(['box', 'cylinder', 'prism']),
  label: z.string(),
  position: Vec3,
  rotation: z.number().default(0),
  size: Vec3,
  // For type 'prism': an extruded polygon footprint (absolute scene XY points).
  // The prism rises `size.z` tall, vertically centered on `position.z`
  // (size.x/y and rotation are ignored). One shape = one fixture.
  footprint: z.array(Vec2).min(3).optional(),
  color: z.string().optional(),
});
export type Fixture = z.infer<typeof Fixture>;

export const Level = z.object({
  name: z.string().default('Ground floor'),
  ceilingHeight: z.number().default(96),
  walls: z.array(Wall),
  openings: z.array(Opening),
  rooms: z.array(Room),
  fixtures: z.array(Fixture),
});
export type Level = z.infer<typeof Level>;

export const Scene = z.object({
  units: z.enum(['imperial', 'metric']).default('imperial'),
  level: Level,
});
export type Scene = z.infer<typeof Scene>;
