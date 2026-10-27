import { Client } from 'basic-ftp';
import net from 'node:net';

export const PROTOCOLS = {
  ftps: { label: 'FTPS', hint: 'encrypted, recommended' },
  ftp: { label: 'FTP', hint: 'plain, password sent unencrypted' },
  'ftps-legacy': { label: 'FTPS implicit', hint: 'old servers, usually port 990' },
};

export function defaultPort(protocol) {
  return protocol === 'ftps-legacy' ? 990 : 21;
}

function isCertError(err) {
  const m = `${err?.code || ''} ${err?.message || ''}`;
  return /CERT|SELF_SIGNED|altnames|certificate|UNABLE_TO_VERIFY/i.test(m);
}

export async function connect(profile, timeout = 15000) {
  const client = new Client(timeout);
  client.ftp.verbose = false;
  const secure = profile.protocol === 'ftps' ? true : profile.protocol === 'ftps-legacy' ? 'implicit' : false;
  const secureOptions = { rejectUnauthorized: profile.security !== 'loose' };
  if (!net.isIP(profile.host)) secureOptions.servername = profile.host;
  try {
    await client.access({
      host: profile.host,
      port: Number(profile.port) || defaultPort(profile.protocol),
      user: profile.username,
      password: profile.password,
      secure,
      secureOptions,
    });
  } catch (err) {
    client.close(); // a failed login would otherwise keep the socket (and the CLI) alive
    throw err;
  }
  return client;
}

/** Try to log in. Never throws. */
export async function testConnection(profile) {
  let client;
  const started = Date.now();
  try {
    client = await connect(profile);
    const home = await client.pwd();
    const list = await client.list();
    return {
      ok: true,
      home,
      ms: Date.now() - started,
      hasPublicHtml: list.some((f) => f.isDirectory && f.name === 'public_html'),
    };
  } catch (err) {
    const msg = err?.message || String(err);
    return {
      ok: false,
      error: msg,
      certError: isCertError(err),
      authError: /530|login|authentication/i.test(msg),
      networkError: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|Timeout/i.test(msg),
    };
  } finally {
    client?.close();
  }
}

/** List sub folders of a path relative to the FTP login folder. */
export async function listDirs(client, home, segments) {
  const target = [home.replace(/\/$/, ''), ...segments].join('/') || '/';
  const list = await client.list(target);
  return list
    .filter((f) => f.isDirectory && f.name !== '.' && f.name !== '..')
    .map((f) => f.name)
    .sort((a, b) => {
      if (a === 'public_html') return -1;
      if (b === 'public_html') return 1;
      return a.localeCompare(b);
    });
}
