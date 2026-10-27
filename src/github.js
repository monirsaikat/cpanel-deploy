import { run } from './git.js';

const API = process.env.CPANEL_DEPLOY_GITHUB_API || 'https://api.github.com';

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** State of the GitHub CLI: missing, installed but logged out, or ready. */
export function ghStatus() {
  const v = run('gh', ['--version']);
  if (!v.ok) return { installed: false, authed: false };
  const a = run('gh', ['auth', 'status', '--hostname', 'github.com']);
  return { installed: true, authed: a.ok };
}

function setWithGh(repo, name, value) {
  // value goes over stdin so it never shows up in the process list
  const r = run('gh', ['secret', 'set', name, '--repo', repo], { input: value });
  if (!r.ok) throw new Error(r.err || `gh could not set ${name}`);
}

async function api(token, method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cpanel-deploy',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message;
    } catch {
      /* no body */
    }
    const hint =
      res.status === 404
        ? ' (repo not found, or the token cannot see it)'
        : res.status === 403
          ? ' (token needs "Secrets: Read and write" on this repo)'
          : res.status === 401
            ? ' (token is invalid or expired)'
            : '';
    throw new Error(`GitHub API ${res.status}: ${detail || res.statusText}${hint}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function makeApiSetter(repo, token) {
  const sodium = (await import('libsodium-wrappers')).default;
  await sodium.ready;
  const key = await api(token, 'GET', `/repos/${repo}/actions/secrets/public-key`);
  const pub = sodium.from_base64(key.key, sodium.base64_variants.ORIGINAL);
  return async (name, value) => {
    const sealed = sodium.crypto_box_seal(sodium.from_string(value), pub);
    await api(token, 'PUT', `/repos/${repo}/actions/secrets/${name}`, {
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id: key.key_id,
    });
  };
}

/**
 * Upload secrets to a repo.
 * @param {{method: 'gh'|'token', token?: string}} auth
 * @param {Record<string,string>} secrets
 * @param {(name:string)=>void} onEach progress callback
 */
export async function setSecrets(repo, auth, secrets, onEach = () => {}) {
  const setter =
    auth.method === 'gh'
      ? async (n, v) => setWithGh(repo, n, v)
      : await makeApiSetter(repo, auth.token);
  for (const [name, value] of Object.entries(secrets)) {
    onEach(name);
    await setter(name, String(value));
  }
}

export async function checkRepoAccess(repo, auth) {
  if (auth.method === 'gh') {
    const r = run('gh', ['repo', 'view', repo, '--json', 'name']);
    if (!r.ok) throw new Error(r.err || `Cannot access ${repo} with gh`);
    return;
  }
  await api(auth.token, 'GET', `/repos/${repo}/actions/secrets/public-key`);
}
