import { p, c, ask, kv, mask } from './ui.js';
import * as config from './config.js';
import { PROTOCOLS, defaultPort, testConnection } from './ftp.js';
import { ghStatus, TOKEN_URL, checkRepoAccess } from './github.js';

const NEW = Symbol('new');

function protocolOptions() {
  return Object.entries(PROTOCOLS).map(([value, v]) => ({ value, label: v.label, hint: v.hint }));
}

/** Interactive profile form. Pass an existing profile to edit it. */
export async function profileForm(cfg, existing = null) {
  const taken = new Set(config.profileNames(cfg));
  if (existing) taken.delete(existing.name);

  const name = await ask(
    p.text({
      message: 'Profile name',
      placeholder: 'e.g. timodesk-live, client-server',
      initialValue: existing?.name,
      validate: (v) => {
        if (!v?.trim()) return 'Give it a short name';
        if (!/^[\w.-]+$/.test(v.trim())) return 'Use letters, numbers, dash, dot or underscore';
        if (taken.has(v.trim())) return 'A profile with this name already exists';
      },
    })
  );
  const host = await ask(
    p.text({
      message: 'FTP host',
      placeholder: 'ftp.yourdomain.com or server IP',
      initialValue: existing?.host,
      validate: (v) => (v?.trim() ? undefined : 'Host is required'),
    })
  );
  const username = await ask(
    p.text({
      message: 'FTP username',
      placeholder: 'cpaneluser or deploy@yourdomain.com',
      initialValue: existing?.username,
      validate: (v) => (v?.trim() ? undefined : 'Username is required'),
    })
  );
  let password = await ask(
    p.password({
      message: existing?.password ? 'FTP password (leave empty to keep current)' : 'FTP password',
      validate: (v) => (v || existing?.password ? undefined : 'Password is required'),
    })
  );
  if (!password && existing?.password) password = existing.password;

  const protocol = await ask(
    p.select({ message: 'Protocol', options: protocolOptions(), initialValue: existing?.protocol || 'ftps' })
  );
  const portRaw = await ask(
    p.text({
      message: 'Port',
      initialValue: String(existing?.port || defaultPort(protocol)),
      validate: (v) => (/^\d{1,5}$/.test(v) ? undefined : 'Port must be a number'),
    })
  );

  return {
    name: name.trim(),
    host: host.trim(),
    username: username.trim(),
    password,
    protocol,
    port: Number(portRaw),
    security: existing?.security || 'strict',
  };
}

/**
 * Test a profile and walk the user through fixing it.
 * Returns the (possibly adjusted) profile and the test result.
 */
export async function verifyProfile(cfg, profile) {
  for (;;) {
    const s = p.spinner();
    s.start(`Connecting to ${c.cyan(profile.host)} over ${PROTOCOLS[profile.protocol].label}`);
    const r = await testConnection(profile);
    if (r.ok) {
      s.stop(`Connected in ${r.ms}ms  ${c.dim('login folder ' + r.home)}`);
      return { profile, result: r };
    }
    s.error(`Connection failed: ${c.red(r.error)}`);

    const options = [];
    if (r.certError && profile.protocol !== 'ftp') {
      p.log.warn(
        "The server's SSL certificate could not be verified. Very common on shared cPanel hosting,\n" +
          'where the certificate belongs to the server hostname, not your domain. Use that hostname, or allow it.'
      );
      options.push({ value: 'loose', label: 'Allow this certificate', hint: 'sets security: loose' });
    }
    if (r.authError) p.log.warn('Wrong username or password. FTP sub accounts log in as user@domain.com.');
    if (r.networkError) p.log.warn('Could not reach the server. Check the host and port, or try plain FTP once to compare.');
    options.push(
      { value: 'edit', label: 'Edit the details' },
      { value: 'retry', label: 'Try again' },
      { value: 'skip', label: 'Continue without testing', hint: 'not recommended' }
    );
    const next = await ask(p.select({ message: 'What now?', options }));
    if (next === 'skip') return { profile, result: r };
    if (next === 'loose') profile = { ...profile, security: 'loose' };
    if (next === 'edit') profile = await profileForm(cfg, profile);
  }
}

export async function saveProfileFlow(cfg, profile) {
  const keepPassword = await ask(
    p.confirm({
      message: `Save the password on this computer? ${c.dim('(' + config.displayPath(config.CONFIG_FILE) + ')')}`,
      initialValue: true,
    })
  );
  const stored = keepPassword ? profile : { ...profile, password: undefined };
  config.putProfile(cfg, stored);
  p.log.success(`Profile ${c.bold(profile.name)} saved`);
  return profile;
}

/** Pick an existing profile or create a new one. Always returns a profile with a password. */
export async function chooseProfile(cfg, message = 'Which cPanel account?') {
  const names = config.profileNames(cfg);
  let choice = NEW;
  if (names.length) {
    choice = await ask(
      p.select({
        message,
        options: [
          ...names.map((n) => ({
            value: n,
            label: n,
            hint: `${cfg.profiles[n].username} @ ${cfg.profiles[n].host}`,
          })),
          { value: NEW, label: c.green('+ Add a new cPanel account') },
        ],
      })
    );
  } else {
    p.log.info("No saved cPanel accounts yet, let's add your first one.");
  }

  if (choice === NEW) {
    const draft = await profileForm(cfg);
    const { profile } = await verifyProfile(cfg, draft);
    await saveProfileFlow(cfg, profile);
    return profile;
  }

  let profile = config.getProfile(cfg, choice);
  if (!profile.password) {
    profile.password = await ask(
      p.password({ message: `Password for ${profile.username}`, validate: (v) => (v ? undefined : 'Required') })
    );
  }
  return profile;
}

/** Decide how to talk to GitHub: gh CLI if logged in, otherwise a token. */
export async function githubAuth(cfg, repo) {
  const gh = ghStatus();
  if (gh.authed) {
    try {
      await checkRepoAccess(repo, { method: 'gh' });
      return { method: 'gh' };
    } catch (e) {
      p.log.warn(`GitHub CLI is logged in but cannot open ${repo}: ${e.message}`);
    }
  }

  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const saved = cfg.github?.token;
  const options = [];
  if (saved) options.push({ value: 'saved', label: 'Use my saved GitHub token' });
  if (envToken) options.push({ value: 'env', label: 'Use the token from GH_TOKEN / GITHUB_TOKEN' });
  options.push({ value: 'paste', label: 'Paste a GitHub token', hint: 'fine grained, Secrets: read and write' });
  if (!gh.installed) options.push({ value: 'gh-help', label: 'I will install the GitHub CLI instead' });
  else if (!gh.authed) options.push({ value: 'gh-help', label: 'I will log in to the GitHub CLI instead' });
  options.push({ value: 'manual', label: 'Skip, I will add the secrets myself' });

  p.log.info(
    gh.installed
      ? `GitHub CLI found but not logged in. Run ${c.cyan('gh auth login')} to make this automatic.`
      : `Tip: with the GitHub CLI (${c.cyan('https://cli.github.com')}) logged in, this step is automatic.`
  );

  for (;;) {
    const how = await ask(p.select({ message: 'How should I upload the secrets to GitHub?', options }));
    if (how === 'manual') return { method: 'manual' };
    if (how === 'gh-help') {
      p.note(
        gh.installed
          ? `${c.cyan('gh auth login')}\nthen run ${c.cyan('npx cpanel-deploy secrets')}`
          : `Install: ${c.cyan('winget install GitHub.cli')}  ${c.dim('or')}  ${c.cyan('brew install gh')}\nThen: ${c.cyan('gh auth login')}\nThen: ${c.cyan('npx cpanel-deploy secrets')}`,
        'GitHub CLI'
      );
      return { method: 'manual' };
    }
    let token = how === 'saved' ? saved : how === 'env' ? envToken : null;
    if (how === 'paste') {
      p.note(
        `1. Open ${c.cyan(TOKEN_URL)}\n` +
          `2. Repository access: pick ${c.bold(repo)} (or all repositories)\n` +
          `3. Permissions: ${c.bold('Secrets')} → Read and write\n` +
          '4. Generate, copy, paste below',
        'Create a token'
      );
      token = await ask(p.password({ message: 'GitHub token', validate: (v) => (v?.trim() ? undefined : 'Required') }));
      token = token.trim();
    }
    const s = p.spinner();
    s.start(`Checking access to ${repo}`);
    try {
      await checkRepoAccess(repo, { method: 'token', token });
      s.stop(`Token can manage secrets on ${c.bold(repo)}`);
    } catch (e) {
      s.error(c.red(e.message));
      continue;
    }
    if (how === 'paste') {
      const keep = await ask(p.confirm({ message: 'Save this token for next time?', initialValue: true }));
      if (keep) {
        cfg.github = { ...cfg.github, token };
        config.save(cfg);
      }
    }
    return { method: 'token', token };
  }
}

export function profileSummary(profile) {
  return kv([
    ['Host', `${profile.host}:${profile.port}`],
    ['User', profile.username],
    ['Password', mask(profile.password)],
    ['Protocol', PROTOCOLS[profile.protocol]?.label + (profile.security === 'loose' ? c.yellow(' (cert check off)') : '')],
  ]);
}
