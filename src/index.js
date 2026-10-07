// Composition root — the only file that knows how the layers connect:
// env config → output adapters → use cases → REST adapters → app.
import { createRequire } from 'node:module';
import { env, catalogReady, provisioningEnabled } from './config/env.js';
import { githubIdentity } from './infrastructure/adapters/output/githubIdentity.js';
import { githubAdmin } from './infrastructure/adapters/output/githubAdmin.js';
import { supabaseClient } from './infrastructure/adapters/output/supabase/client.js';
import { componentCatalog } from './infrastructure/adapters/output/supabase/componentCatalog.js';
import { platformConfigStore } from './infrastructure/adapters/output/supabase/platformConfigStore.js';
import { resolveSession } from './application/usecases/resolveSession.js';
import { exchangeOAuthCode } from './application/usecases/exchangeOAuthCode.js';
import { listTemplates } from './application/usecases/listTemplates.js';
import { provisionComponent, createComponent, specFor }
  from './application/usecases/provisionComponent.js';
import { createApp } from './app.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const provider = githubIdentity({
  clientId: env.githubClientId,
  clientSecret: env.githubClientSecret,
});
const repoHost = githubAdmin({
  token: env.provisioningToken,
  owner: env.githubOwner,
  manifestRepo: env.manifestRepo,
});
const sb = supabaseClient({ url: env.supabaseUrl, key: env.supabaseServiceKey });
const catalog = componentCatalog({ client: sb });
const store = platformConfigStore({ client: sb });

const usecases = {
  resolveSession: resolveSession({ provider, allowedUsers: env.allowedUsers }),
  exchangeOAuthCode: exchangeOAuthCode({ provider, allowedUsers: env.allowedUsers }),
  listTemplates: listTemplates({ repoHost, specFor }),
  listComponents: catalog.list,
  getComponent: catalog.get,
  provision: provisionComponent({ catalog, store, repoHost }),
};
usecases.createComponent = createComponent({
  catalog, repoHost, templates: usecases.listTemplates, provision: usecases.provision,
});

createApp({ pkg, env, usecases, catalogReady, provisioningEnabled })
  .listen(env.port, () => console.log(`${pkg.name}:${pkg.version} on :${env.port}`));
