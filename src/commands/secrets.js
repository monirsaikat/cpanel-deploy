import fs from 'node:fs';
import { p, c, ask, bail } from '../ui.js';
import * as config from '../config.js';
import * as git from '../git.js';
import { chooseProfile, githubAuth } from '../shared.js';
import { setSecrets } from '../github.js';
import { secretNames } from '../workflow.js';

/** Find secret prefixes used by existing cpanel-deploy workflows in this repo. */
function prefixesInRepo(root) {
  const dir = git.workflowsDir(root);
  if (!fs.existsSync(dir)) return [];
  const found = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const text = fs.readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/secrets\.([A-Z0-9_]*?)HOST\b/g)) found.add(m[1]);
  }
  return [...found];
}

export async function secrets() {
  p.intro(c.bgMagenta(c.white(' Update GitHub secrets ')));
  const root = git.repoRoot();
  if (!root) bail('Run this inside a git repository.');
  let repo = git.githubSlug(root);
  if (!repo) {
    repo = await ask(p.text({ message: 'GitHub repo', placeholder: 'owner/repo', validate: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v || '') ? undefined : 'owner/repo') }));
  }
  p.log.step(`Repository  ${c.bold(repo)}`);

  const prefixes = prefixesInRepo(root);
  let prefix = 'CPANEL_';
  if (prefixes.length > 1) {
    prefix = await ask(p.select({ message: 'Which deploy target?', options: prefixes.map((x) => ({ value: x, label: `${x}HOST / USERNAME / PASSWORD` })) }));
  } else if (prefixes.length === 1) {
    prefix = prefixes[0];
  }

  const cfg = config.load();
  const profile = await chooseProfile(cfg, 'Upload which account?');
  const auth = await githubAuth(cfg, repo);
  if (auth.method === 'manual') bail('No GitHub access, nothing uploaded.');

  const n = secretNames(prefix);
  const s = p.spinner();
  s.start('Uploading');
  try {
    await setSecrets(repo, auth, { [n.host]: profile.host, [n.username]: profile.username, [n.password]: profile.password }, (x) => s.message(`Uploading ${x}`));
    s.stop(`Updated ${Object.values(n).join(', ')}`);
  } catch (e) {
    s.error(c.red(e.message));
    process.exitCode = 1;
  }
  p.outro('Done. The next deploy uses the new values.');
}
