// Use case: list the registered templates — the catalog is the source of
// truth (kind drives the provisioning spec; GitHub `is_template` is only the
// generation mechanism, verified by the provisioner).
export const listTemplates = ({ templates }) =>
  async () => templates.list();
