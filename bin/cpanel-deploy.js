#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { banner, p, c, ask } from '../src/ui.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const [cmd] = process.argv.slice(2);

const COMMANDS = {
  init: ['Set up deploys for the current repo', () => import('../src/commands/init.js').then((m) => m.init())],
  profiles: ['Add, edit, test or delete saved cPanel accounts', () => import('../src/commands/profiles.js').then((m) => m.profiles())],
  secrets: ['Re-upload secrets (changed password, new account)', () => import('../src/commands/secrets.js').then((m) => m.secrets())],
  doctor: ['Check Node, Git and GitHub CLI', () => import('../src/commands/doctor.js').then((m) => m.doctor())],
};
const ALIASES = { profile: 'profiles', accounts: 'profiles', setup: 'init', check: 'doctor' };

function help() {
  banner(pkg.version);
  console.log(`  ${c.bold('Usage')}  ${c.cyan('npx cpanel-deploy')} ${c.dim('[command]')}\n`);
  for (const [name, [desc]] of Object.entries(COMMANDS)) {
    console.log(`    ${c.cyan(name.padEnd(10))} ${desc}`);
  }
  console.log(`\n  Run without a command for the interactive menu.`);
  console.log(`  ${c.dim('Docs: https://saikat.polapain.net/cpanel-deploy')}\n`);
}

async function main() {
  if (cmd === '-v' || cmd === '--version') return console.log(pkg.version);
  if (cmd === '-h' || cmd === '--help' || cmd === 'help') return help();

  if (!process.stdin.isTTY) {
    console.error('cpanel-deploy is interactive. Please run it in a terminal.');
    process.exit(1);
  }

  const name = ALIASES[cmd] || cmd;
  banner(pkg.version);

  if (name && COMMANDS[name]) return COMMANDS[name][1]();
  if (name) {
    p.log.error(`Unknown command ${c.bold(cmd)}. Try ${c.cyan('cpanel-deploy --help')}`);
    process.exit(1);
  }

  const picked = await ask(
    p.select({
      message: 'What do you want to do?',
      options: Object.entries(COMMANDS).map(([value, [hint]]) => ({ value, label: value === 'init' ? c.bold('Set up this repo') : value[0].toUpperCase() + value.slice(1), hint })),
    })
  );
  return COMMANDS[picked][1]();
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    p.log.error(c.red(err?.stack || String(err)));
    process.exit(1);
  });
