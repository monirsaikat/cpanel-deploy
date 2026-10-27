# cpanel-deploy

Set up GitHub Actions deploys to cPanel in one command.

No more copying the same workflow file into every repo and typing `CPANEL_HOST`, `CPANEL_USERNAME` and `CPANEL_PASSWORD` into GitHub by hand.

```bash
npx cpanel-deploy
```

Website: https://saikat.polapain.net/cpanel-deploy

## What it does

Run it inside your project folder and answer a few questions:

1. **Pick a cPanel account** you saved before, or add one. The FTP login is tested right away.
2. **Pick the branch** that should deploy (a manual "Run workflow" button is added too).
3. **Browse the server folders** over FTP and choose where files go, like `public_html/live/`.
4. **Confirm build steps.** If it finds `composer.json` it offers `composer install`, if `package.json` has a `build` script it offers `npm run build`.
5. **Done.** It writes `.github/workflows/cpanel-deploy.yml`, uploads the three secrets to GitHub and commits the file. Push and it ships.

## Commands

| Command | What it does |
| --- | --- |
| `npx cpanel-deploy` | Interactive menu |
| `npx cpanel-deploy init` | Set up deploys for the current repo. Run again to add another target, like staging. |
| `npx cpanel-deploy profiles` | Add, edit, test or delete saved cPanel accounts |
| `npx cpanel-deploy secrets` | Upload the secrets again (changed password, new host) |
| `npx cpanel-deploy doctor` | Check Node, Git, GitHub CLI and the current repo |

## Requirements

- Node.js 20.12 or newer
- Git
- One of these, so secrets can be uploaded for you:
  - [GitHub CLI](https://cli.github.com) logged in with `gh auth login` (easiest), or
  - a [fine grained token](https://github.com/settings/personal-access-tokens/new) with **Secrets: Read and write** on the repo

Without either, the tool still writes the workflow and tells you which secrets to add.

## Multiple targets

Run `init` again in the same repo and choose "Add another deploy target". A target named `staging` gets its own file `cpanel-deploy-staging.yml` and its own secrets `CPANEL_STAGING_HOST`, `CPANEL_STAGING_USERNAME`, `CPANEL_STAGING_PASSWORD`, so live and staging never mix.

## Security notes

- Saved accounts live in `~/.cpanel-deploy/config.json` on your computer, with permissions limited to your user. You can choose not to save a password and type it each time.
- Prefer a dedicated FTP account in cPanel limited to the deploy folder, instead of your main cPanel login.
- Choose **FTPS** (the default). Plain FTP sends the password unencrypted.
- Shared hosts often present a certificate for the server hostname, not your domain. The tool detects this and can set `security: loose` for that account. Using the server hostname from cPanel as the FTP host avoids it.

## Generated workflow

Uses [SamKirkland/FTP-Deploy-Action](https://github.com/SamKirkland/FTP-Deploy-Action), which only uploads files that changed since the last deploy. Example:

```yaml
name: Deploy to cPanel
on:
  push:
    branches:
      - 'cp-live'
  workflow_dispatch:
concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Deploy via FTP
        uses: SamKirkland/FTP-Deploy-Action@v4.4.0
        with:
          server: ${{ secrets.CPANEL_HOST }}
          username: ${{ secrets.CPANEL_USERNAME }}
          password: ${{ secrets.CPANEL_PASSWORD }}
          protocol: ftps
          local-dir: './'
          server-dir: 'public_html/live/'
```

## Development

```bash
npm install
npm test
node bin/cpanel-deploy.js
```

Environment variables useful while testing:

- `CPANEL_DEPLOY_HOME` changes where accounts are saved
- `CPANEL_DEPLOY_GITHUB_API` points the GitHub API calls at a mock server

## License

MIT © Moniruzzaman Saikat
