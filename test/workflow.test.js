import test from 'node:test';
import assert from 'node:assert/strict';
import { render, prefixFor, fileNameFor, withSlash } from '../src/workflow.js';
import { parseGithubSlug } from '../src/git.js';

test('parses GitHub remotes', () => {
  assert.equal(parseGithubSlug('https://github.com/saikat/dash-timodesk.git'), 'saikat/dash-timodesk');
  assert.equal(parseGithubSlug('git@github.com:saikat/dash-timodesk.git'), 'saikat/dash-timodesk');
  assert.equal(parseGithubSlug('ssh://git@github.com/saikat/repo'), 'saikat/repo');
  assert.equal(parseGithubSlug('https://gitlab.com/a/b.git'), null);
});

test('prefix and file names', () => {
  assert.equal(prefixFor(''), 'CPANEL_');
  assert.equal(prefixFor('Staging Server'), 'CPANEL_STAGING_SERVER_');
  assert.equal(fileNameFor(''), 'cpanel-deploy.yml');
  assert.equal(fileNameFor('Staging Server'), 'cpanel-deploy-staging-server.yml');
  assert.equal(withSlash('public_html/live'), 'public_html/live/');
  assert.equal(withSlash('.'), './');
});

test('renders a workflow with secrets and build steps', () => {
  const y = render({ target: '', prefix: 'CPANEL_', branch: 'cp-live', localDir: './', serverDir: 'public_html/live', protocol: 'ftps', port: 21, security: 'loose', exclude: ['**/.git*'], composer: { enabled: true, php: '8.3' }, node: { enabled: true, script: 'build', ci: true, version: '22' } });
  assert.match(y, /\$\{\{ secrets\.CPANEL_HOST \}\}/);
  assert.match(y, /server-dir: 'public_html\/live\/'/);
  assert.match(y, /security: loose/);
  assert.match(y, /composer install/);
  assert.match(y, /npm ci/);
  assert.doesNotMatch(y, /port:/);
});
