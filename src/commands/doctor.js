import { p, c } from '../ui.js';
import * as config from '../config.js';
import * as git from '../git.js';
import { ghStatus } from '../github.js';

export async function doctor() {
  p.intro(c.bgMagenta(c.white(' Doctor ')));
  const ok = (m) => p.log.success(m);
  const warn = (m) => p.log.warn(m);
  const bad = (m) => p.log.error(m);

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 12)) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node}. Please use Node 20.12 or newer.`);

  if (git.hasGit()) ok('Git installed');
  else bad('Git not found on PATH');

  const gh = ghStatus();
  if (gh.authed) ok('GitHub CLI logged in, secrets upload automatically');
  else if (gh.installed) warn(`GitHub CLI installed but logged out. Run ${c.cyan('gh auth login')}`);
  else warn('GitHub CLI not installed. You can paste a token instead, or install it from https://cli.github.com');

  const root = git.repoRoot();
  if (root) {
    const slug = git.githubSlug(root);
    if (slug) ok(`In repo ${c.bold(slug)}`);
    else warn('In a git repo, but no GitHub remote found');
  } else {
    p.log.info(c.dim('Not inside a git repo (that is fine for this check)'));
  }

  const cfg = config.load();
  const n = config.profileNames(cfg).length;
  p.log.info(`${n} saved cPanel account${n === 1 ? '' : 's'}  ${c.dim(config.CONFIG_FILE)}`);
  p.outro('Checkup finished');
}
