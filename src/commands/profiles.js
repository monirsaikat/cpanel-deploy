import { p, c, ask } from '../ui.js';
import * as config from '../config.js';
import { profileForm, verifyProfile, saveProfileFlow, profileSummary } from '../shared.js';

export async function profiles() {
  p.intro(c.bgMagenta(c.white(' cPanel accounts ')));
  const cfg = config.load();

  for (;;) {
    const names = config.profileNames(cfg);
    if (!names.length) p.log.info('No saved accounts yet.');
    const choice = await ask(
      p.select({
        message: names.length ? `${names.length} saved account${names.length > 1 ? 's' : ''}` : 'Saved accounts',
        options: [
          ...names.map((n) => ({ value: n, label: n, hint: `${cfg.profiles[n].username} @ ${cfg.profiles[n].host}` })),
          { value: '__add', label: c.green('+ Add an account') },
          { value: '__done', label: c.dim('Done') },
        ],
      })
    );
    if (choice === '__done') break;
    if (choice === '__add') {
      const { profile } = await verifyProfile(cfg, await profileForm(cfg));
      await saveProfileFlow(cfg, profile);
      continue;
    }

    const profile = config.getProfile(cfg, choice);
    p.note(profileSummary(profile), profile.name);
    const action = await ask(
      p.select({
        message: 'Action',
        options: [
          { value: 'test', label: 'Test connection' },
          { value: 'edit', label: 'Edit' },
          { value: 'delete', label: c.red('Delete') },
          { value: 'back', label: c.dim('Back') },
        ],
      })
    );
    if (action === 'test') {
      let prof = profile;
      if (!prof.password) prof = { ...prof, password: await ask(p.password({ message: 'Password' })) };
      const { profile: fixed } = await verifyProfile(cfg, prof);
      if (fixed.security !== profile.security) {
        config.putProfile(cfg, { ...fixed, password: profile.password });
        p.log.success('Saved the certificate setting');
      }
    }
    if (action === 'edit') {
      const updated = await profileForm(cfg, profile);
      const { profile: verified } = await verifyProfile(cfg, updated);
      if (verified.name !== profile.name) config.removeProfile(cfg, profile.name);
      await saveProfileFlow(cfg, verified);
    }
    if (action === 'delete') {
      const sure = await ask(p.confirm({ message: `Delete ${c.bold(profile.name)} from this computer?`, initialValue: false }));
      if (sure) {
        config.removeProfile(cfg, profile.name);
        p.log.success('Deleted. Secrets already on GitHub are not touched.');
      }
    }
  }
  p.outro(c.dim(config.CONFIG_FILE));
}
