import pc from 'picocolors';
import * as p from '@clack/prompts';

// Calvin S style glyphs, 3 rows each
const GLYPHS = {
  c: ['┌─┐', '│  ', '└─┘'],
  p: ['┌─┐', '├─┘', '┴  '],
  a: ['┌─┐', '├─┤', '┴ ┴'],
  n: ['┌┐┌', '│││', '┘└┘'],
  e: ['┌─┐', '├┤ ', '└─┘'],
  l: ['┬  ', '│  ', '┴─┘'],
  d: ['┌┬┐', ' ││', '─┴┘'],
  o: ['┌─┐', '│ │', '└─┘'],
  y: ['┬ ┬', '└┬┘', ' ┴ '],
  '-': ['  ', '──', '  '],
};

const STOPS = [
  [255, 108, 44], // cPanel orange
  [255, 72, 132], // pink
  [146, 92, 255], // violet
];

const truecolor =
  pc.isColorSupported &&
  (/truecolor|24bit/i.test(process.env.COLORTERM || '') ||
    !!process.env.WT_SESSION ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM_PROGRAM === 'iTerm.app');

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function colorAt(t) {
  const seg = t * (STOPS.length - 1);
  const i = Math.min(Math.floor(seg), STOPS.length - 2);
  const local = seg - i;
  return STOPS[i].map((c, k) => lerp(c, STOPS[i + 1][k], local));
}

export function gradient(str) {
  if (!pc.isColorSupported) return str;
  if (!truecolor) return pc.magenta(str);
  const chars = [...str];
  const n = Math.max(chars.length - 1, 1);
  return (
    chars
      .map((ch, i) => {
        if (ch === ' ') return ch;
        const [r, g, b] = colorAt(i / n);
        return `\x1b[38;2;${r};${g};${b}m${ch}`;
      })
      .join('') + '\x1b[39m'
  );
}

export function banner(version) {
  const word = 'cpanel-deploy';
  const rows = [0, 1, 2].map((r) => [...word].map((ch) => GLYPHS[ch][r]).join(''));
  console.log('');
  for (const row of rows) console.log('  ' + gradient(row));
  console.log(
    '  ' +
      pc.dim('GitHub Actions to cPanel, without the copy paste') +
      pc.dim('  ·  v' + version)
  );
  console.log('');
}

export function bail(msg = 'Cancelled. Nothing was changed.') {
  p.cancel(msg);
  process.exit(0);
}

/** Await a clack prompt and exit cleanly on Ctrl+C / Esc. */
export async function ask(promise) {
  const v = await promise;
  if (p.isCancel(v)) bail();
  return v;
}

export const c = pc;
export { p };

export function kv(rows) {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${pc.dim(k.padEnd(width))}  ${v}`).join('\n');
}

export function mask(secret) {
  if (!secret) return pc.dim('(not saved)');
  return '•'.repeat(Math.min(secret.length, 10));
}
