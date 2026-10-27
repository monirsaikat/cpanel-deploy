import fs from 'node:fs';
import path from 'node:path';
import { p, c, ask, kv, bail } from '../ui.js';
import * as config from '../config.js';
import * as git from '../git.js';
import { connect, listDirs, PROTOCOLS } from '../ftp.js';
import { chooseProfile, githubAuth } from '../shared.js';
import { setSecrets } from '../github.js';
import {
  render,
  prefixFor,
  fileNameFor,
  secretNames,
  withSlash,
  EXCLUDE_PRESETS,
} from '../workflow.js';

/** Walk the server folders over FTP and return a path relative to the login folder. */
async function browseServer(profile) {
  let client;
  try {
    client = await connect(profile);
  } catch (e) {
    p.log.warn(`Could not open the server to browse (${e.message}). Type the folder instead.`);
    return null;
  }
  const home = await client.pwd();
  const segments = [];
  try {
    for (;;) {
      let dirs = [];
      try {
        dirs = await listDirs(client, home, segments);
      } catch (e) {
        p.log.warn(`Could not list this folder: ${e.message}`);
      }
      const here = segments.length ? segments.join('/') + '/' : './';
      const options = [
        { value: { kind: 'pick' }, label: c.green(`✔ Deploy here: ${c.bold(here)}`) },
        ...dirs.map((d) => ({ value: { kind: 'cd', dir: d }, label: `📁 ${d}/` })),
        { value: { kind: 'new' }, label: c.cyan('+ New folder inside here') },
      ];
      if (segments.length) options.splice(1, 0, { value: { kind: 'up' }, label: c.dim('↩ Up one level') });
      options.push({ value: { kind: 'type' }, label: c.dim('⌨ Type a path instead') });

      const pick = await ask(
        p.select({ message: `Server folder  ${c.dim('/' + segments.join('/'))}`, options, maxItems: 12 })
      );
      if (pick.kind === 'pick') return here;
      if (pick.kind === 'up') segments.pop();
      if (pick.kind === 'cd') segments.push(pick.dir);
      if (pick.kind === 'type') return null;
      if (pick.kind === 'new') {
        const name = await ask(
          p.text({
            message: 'New folder name',
            placeholder: 'live',
            validate: (v) => (/^[\w.-]+$/.test(v || '') ? undefined : 'Letters, numbers, dash, dot or underscore'),
          })
        );
        p.log.info(c.dim('The folder will be created on the first deploy.'));
        return [...segments, name].join('/') + '/';
      }
    }
  } finally {
    client.close();
  }
}

export async function init() {
  p.intro(c.bgMagenta(c.white(' Set up deploys for this repo ')));

  // 1. Repo
  if (!git.hasGit()) bail('Git is not installed or not on PATH.');
  const root = git.repoRoot();
  if (!root) bail('This folder is not a git repository. Run me inside your project folder.');
  let repo = git.githubSlug(root);
  if (repo) {
    p.log.step(`Repository  ${c.bold(repo)}  ${c.dim(root)}`);
  } else {
    repo = await ask(
      p.text({
        message: 'No GitHub remote found. Which GitHub repo is this?',
        placeholder: 'owner/repo',
        validate: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v || '') ? undefined : 'Use the owner/repo format'),
      })
    );
  }
  const project = git.detectProject(root);

  // 2. cPanel account
  const cfg = config.load();
  const profile = await chooseProfile(cfg);

  // 3. Target name (lets one repo deploy to several places)
  const wfDir = git.workflowsDir(root);
  const existing = fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((f) => f.startsWith('cpanel-deploy')) : [];
  let target = '';
  if (existing.length) {
    p.log.info(`This repo already has: ${existing.map((f) => c.cyan(f)).join(', ')}`);
    const mode = await ask(
      p.select({
        message: 'What do you want to do?',
        options: [
          { value: 'new', label: 'Add another deploy target', hint: 'e.g. staging next to live' },
          existing.includes('cpanel-deploy.yml')
            ? { value: 'replace', label: 'Replace cpanel-deploy.yml' }
            : { value: 'replace', label: 'Create the default cpanel-deploy.yml' },
        ],
      })
    );
    if (mode === 'new') {
      target = await ask(
        p.text({
          message: 'Name this target',
          placeholder: 'staging',
          validate: (v) => (v?.trim() ? undefined : 'Give it a name like staging or live'),
        })
      );
    }
  }
  const prefix = prefixFor(target);
  const fileName = fileNameFor(target);

  // 4. Branch
  const current = git.currentBranch(root);
  const branches = git.localBranches(root);
  const branchOpts = [...new Set([current, ...branches].filter(Boolean))].map((b) => ({
    value: b,
    label: b,
    hint: b === current ? 'current' : undefined,
  }));
  branchOpts.push({ value: '__other', label: c.dim('Another branch name') });
  let branch = await ask(p.select({ message: 'Deploy when I push to', options: branchOpts, initialValue: current }));
  if (branch === '__other') {
    branch = await ask(
      p.text({ message: 'Branch name', placeholder: 'cp-live', validate: (v) => (v?.trim() ? undefined : 'Required') })
    );
  }

  // 5. Server folder
  const how = await ask(
    p.select({
      message: 'Where should files go on the server?',
      options: [
        { value: 'browse', label: 'Browse the server folders', hint: 'recommended' },
        { value: 'type', label: 'Type the path' },
      ],
    })
  );
  let serverDir = how === 'browse' ? await browseServer(profile) : null;
  if (!serverDir) {
    serverDir = await ask(
      p.text({
        message: 'Server folder, relative to the FTP login folder',
        placeholder: 'public_html/',
        defaultValue: 'public_html/',
      })
    );
  }
  serverDir = withSlash(serverDir);

  // 6. Local folder
  const localDir = withSlash(
    await ask(
      p.text({
        message: 'Which local folder to upload?',
        placeholder: './  (whole repo)',
        defaultValue: './',
        validate: (v) => {
          const d = (v || './').trim();
          if (path.isAbsolute(d)) return 'Use a path inside the repo';
        },
      })
    )
  );

  // 7. Build steps
  let composer = { enabled: false, php: '8.3' };
  if (project.composer) {
    const on = await ask(
      p.confirm({
        message: `composer.json found${project.laravel ? c.dim(' (Laravel)') : ''}. Run composer install on GitHub before uploading?`,
        initialValue: true,
      })
    );
    if (on) {
      const php = await ask(
        p.text({ message: 'PHP version', initialValue: project.php || '8.3', validate: (v) => (/^\d+\.\d+$/.test(v) ? undefined : 'Like 8.3') })
      );
      composer = { enabled: true, php };
    }
  }
  let node = { enabled: false };
  if (project.node) {
    const on = await ask(
      p.confirm({ message: `package.json has a "${project.buildScript}" script. Build assets before uploading?`, initialValue: true })
    );
    if (on) node = { enabled: true, script: project.buildScript, ci: project.lockfile, version: '22' };
  }

  // 8. Excludes
  const exclude = await ask(
    p.multiselect({
      message: `Skip these when uploading ${c.dim('(space to toggle)')}`,
      options: EXCLUDE_PRESETS.filter((e) => !e.always).map((e) => ({ value: e.value, label: e.label })),
      initialValues: EXCLUDE_PRESETS.filter((e) => e.initial).map((e) => e.value),
      required: false,
    })
  );
  const allExclude = [...EXCLUDE_PRESETS.filter((e) => e.always).map((e) => e.value), ...exclude];

  // 9. Review
  const names = secretNames(prefix);
  const yaml = render({
    target,
    prefix,
    branch,
    localDir,
    serverDir,
    protocol: profile.protocol,
    port: profile.port,
    security: profile.security,
    exclude: allExclude,
    composer,
    node,
  });
  const wfPath = path.join(wfDir, fileName);
  const rel = path.relative(root, wfPath).replace(/\\/g, '/');

  p.note(
    kv([
      ['Repo', c.bold(repo)],
      ['Trigger', `push to ${c.cyan(branch)}  ${c.dim('+ manual run button')}`],
      ['Upload', `${c.cyan(localDir)} → ${c.cyan(profile.host)}:${c.cyan(serverDir)}`],
      ['Protocol', PROTOCOLS[profile.protocol].label],
      ['Build', [composer.enabled && `composer (PHP ${composer.php})`, node.enabled && `npm run ${node.script}`].filter(Boolean).join(', ') || c.dim('none')],
      ['Workflow', rel],
      ['Secrets', Object.values(names).join(', ')],
    ]),
    'Ready'
  );

  const go = await ask(p.confirm({ message: 'Write the workflow and upload the secrets?', initialValue: true }));
  if (!go) bail();

  // 10. Write workflow
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(wfPath, yaml);
  p.log.success(`Wrote ${c.cyan(rel)}`);

  // 11. Secrets
  const auth = await githubAuth(cfg, repo);
  const values = { [names.host]: profile.host, [names.username]: profile.username, [names.password]: profile.password };
  if (auth.method === 'manual') {
    p.note(
      `Open ${c.cyan(`https://github.com/${repo}/settings/secrets/actions`)} and add:\n\n` +
        Object.keys(values).map((n) => `  ${c.bold(n)}`).join('\n') +
        `\n\nOr later run ${c.cyan('npx cpanel-deploy secrets')}`,
      'Add these secrets'
    );
  } else {
    const s = p.spinner();
    s.start('Uploading secrets');
    try {
      await setSecrets(repo, auth, values, (n) => s.message(`Uploading ${n}`));
      s.stop(`Secrets uploaded to ${c.bold(repo)} ${c.dim('(' + Object.keys(values).length + ')')}`);
    } catch (e) {
      s.error(c.red(e.message));
      p.log.warn(`The workflow is written. Fix access and run ${c.cyan('npx cpanel-deploy secrets')}.`);
    }
  }

  // 12. Commit
  const commit = await ask(p.confirm({ message: `Commit ${rel} now?`, initialValue: true }));
  if (commit) {
    git.run('git', ['add', rel], { cwd: root });
    const r = git.run('git', ['commit', '-m', `ci: deploy ${branch} to cPanel`, '--', rel], { cwd: root });
    if (r.ok) p.log.success('Committed');
    else p.log.warn(`Commit failed: ${r.err || r.out}`);
  }

  const onBranch = current === branch;
  p.outro(
    onBranch
      ? `All set. ${c.cyan(`git push origin ${branch}`)} and watch it ship: ${c.underline(`https://github.com/${repo}/actions`)}`
      : `All set. Merge into ${c.cyan(branch)} and push, then watch: ${c.underline(`https://github.com/${repo}/actions`)}`
  );
}
