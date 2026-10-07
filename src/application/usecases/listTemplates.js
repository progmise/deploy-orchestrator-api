// Use case: list the owner's GitHub template repos, tagged by kind.
// `specFor` lives in provisionComponent.js — same SPECS table drives both.
export const listTemplates = ({ repoHost, specFor }) =>
  async () => {
    const repos = await repoHost.api(
      `/users/${repoHost.owner}/repos?per_page=100&type=owner&sort=updated`);
    return repos
      .filter((r) => r.is_template)
      .map((r) => ({
        name: r.name,
        description: r.description,
        kind: specFor(r.name).key,
      }));
  };
