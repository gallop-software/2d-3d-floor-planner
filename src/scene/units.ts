/** Display unit systems for the UI (independent of the scene's stored units). */
export type UnitSystem = 'imperial' | 'inches';

export function formatImperial(inches: number, opts: { precision?: 'inch' | 'eighth' } = {}): string {
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const feet = Math.floor(abs / 12);
  const remIn = abs - feet * 12;

  if (opts.precision === 'eighth') {
    const eighths = Math.round(remIn * 8);
    const whole = Math.floor(eighths / 8);
    const frac = eighths % 8;
    const fracStr =
      frac === 0
        ? ''
        : frac === 4
          ? ' 1/2'
          : frac === 2
            ? ' 1/4'
            : frac === 6
              ? ' 3/4'
              : ` ${frac}/8`;
    return `${sign}${feet}'-${whole}${fracStr}"`;
  }

  const rounded = Math.round(remIn);
  if (rounded === 12) return `${sign}${feet + 1}'-0"`;
  return `${sign}${feet}'-${rounded}"`;
}

// Inches only — no feet. e.g. 265.5 → 265 1/2"
export function formatInches(inches: number): string {
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const eighths = Math.round(abs * 8);
  const whole = Math.floor(eighths / 8);
  const frac = eighths % 8;
  const fracStr =
    frac === 0
      ? ''
      : frac === 4
        ? ' 1/2'
        : frac === 2
          ? ' 1/4'
          : frac === 6
            ? ' 3/4'
            : ` ${frac}/8`;
  return `${sign}${whole}${fracStr}"`;
}

export function formatLength(inches: number, system: UnitSystem): string {
  if (system === 'inches') return formatInches(inches);
  return formatImperial(inches);
}

export function formatArea(sqInches: number, system: UnitSystem): string {
  if (system === 'inches') {
    return `${Math.round(sqInches).toLocaleString()} sq in`;
  }
  return `${(sqInches / 144).toFixed(1)} sq ft`;
}

// Parse strings like "12'-6\"", "12' 6\"", "12'", "6\"", "12.5'", "240"
// Numbers without units are treated as inches.
export function parseImperial(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  const feetMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*'/);
  const inchMatch = s.match(/(-?\d+(?:\.\d+)?)\s*"/);
  const bareNumber = s.match(/^(-?\d+(?:\.\d+)?)$/);

  if (feetMatch || inchMatch) {
    const feet = feetMatch ? parseFloat(feetMatch[1]) : 0;
    const inches = inchMatch ? parseFloat(inchMatch[1]) : 0;
    const sign = feet < 0 || /^-/.test(s) ? (feet < 0 ? 1 : -1) : 1;
    return sign * (Math.abs(feet) * 12 + Math.abs(inches));
  }

  if (bareNumber) {
    return parseFloat(bareNumber[1]);
  }

  return null;
}
