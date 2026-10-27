import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  return {
    ok: r.status === 0 && !r.error,
    missing: r.error?.code === 'ENOENT',
    out: (r.stdout || '').trim(),
    err: (r.stderr || r.error?.message || '').trim(),
  };
}

export function hasGit() {
  return run('git', ['--version']).ok;
}

export function repoRoot(cwd = process.cwd()) {
  const r = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  return r.ok ? path.resolve(r.out) : null;
}

export function currentBranch(cwd) {
  const r = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (r.ok && r.out !== 'HEAD') return r.out;
  const s = run('git', ['symbolic-ref', '--short', 'HEAD'], { cwd });
  return s.ok ? s.out : null;
}

export function localBranches(cwd) {
  const r = run('git', ['branch', '--format=%(refname:short)'], { cwd });
  return r.ok ? r.out.split('\n').filter(Boolean) : [];
}

/** Parse owner/repo from any common GitHub remote URL form. */
export function parseGithubSlug(url) {
  if (!url) return null;
  const m = url
    .trim()
    .match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function githubSlug(cwd) {
  const remotes = run('git', ['remote'], { cwd });
  const names = remotes.ok ? remotes.out.split('\n').filter(Boolean) : [];
  const ordered = names.includes('origin') ? ['origin', ...names.filter((n) => n !== 'origin')] : names;
  for (const name of ordered) {
    const u = run('git', ['remote', 'get-url', name], { cwd });
    const slug = parseGithubSlug(u.out);
    if (slug) return slug;
  }
  return null;
}

/** Look at the project to suggest build steps. */
export function detectProject(root) {
  const info = { composer: false, php: null, laravel: false, node: false, buildScript: null, lockfile: false };
  const composerPath = path.join(root, 'composer.json');
  if (fs.existsSync(composerPath)) {
    info.composer = true;
    try {
      const composer = JSON.parse(fs.readFileSync(composerPath, 'utf8'));
      const constraint = composer.require?.php || '';
      const v = constraint.match(/(\d+\.\d+)/);
      if (v) info.php = v[1];
      info.laravel = !!composer.require?.['laravel/framework'];
    } catch {
      /* ignore broken composer.json */
    }
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts?.build) {
        info.node = true;
        info.buildScript = 'build';
      }
    } catch {
      /* ignore */
    }
    info.lockfile = fs.existsSync(path.join(root, 'package-lock.json'));
  }
  return info;
}

export function workflowsDir(root) {
  return path.join(root, '.github', 'workflows');
}
