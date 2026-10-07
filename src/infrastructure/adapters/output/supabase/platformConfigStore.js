// Output adapter: the platform credential store — master copies of the
// values propagated into each generated repo:
//   platform_vars    — plain key/value (VERCEL_ORG_ID, DOCKER_USERNAME…)
//   platform_secrets — view over vault.decrypted_secrets (VERCEL_TOKEN…)
// Values are read per provisioning run; process.env acts as a local
// fallback for entries missing in the store.
// Implements the CredentialStore port (application/ports/output).
export const platformConfigStore = ({ client }) => ({
  async all() {
    const [vars, secrets] = await Promise.all([
      client.rest('platform_vars?select=key,value'),
      client.rest('platform_secrets?select=name,value'),
    ]);
    const cfg = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
    for (const v of vars) cfg[v.key] = v.value;
    return cfg;
  },
});
