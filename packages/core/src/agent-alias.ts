// Pre-validation `agent`→`provider` input-alias folds applied at the @rauf/core
// load boundaries (04-agent-selection.md §3.3). These mirror @rauf/loop's
// `normalizeAgentAlias` but live in core because the load sites are core loaders
// and core must not import from loop (CLAUDE.md architecture rule 1). Additive
// and non-breaking: the persisted/canonical key stays `provider`
// (`defaultProvider` for the global config); the alias is dropped after folding.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Fold a `<aliasKey>` input-alias onto the canonical `<canonicalKey>` on a raw
 * object, before Zod validation. If both keys are present the canonical key
 * wins and the alias is discarded; otherwise the alias value is moved onto the
 * canonical key. Non-objects and objects without the alias pass through.
 */
function foldAlias(raw: unknown, canonicalKey: string, aliasKey: string): unknown {
  if (!isPlainObject(raw) || !(aliasKey in raw)) {
    return raw;
  }
  const { [aliasKey]: alias, ...rest } = raw;
  if (canonicalKey in rest && rest[canonicalKey] !== undefined) {
    return rest; // canonical key wins; alias discarded.
  }
  return { ...rest, [canonicalKey]: alias };
}

/** Fold each backlog item's `agent` alias onto `provider` (BacklogItem.provider). */
export function foldBacklogProviderAlias(data: unknown): unknown {
  if (!isPlainObject(data) || !Array.isArray(data.items)) {
    return data;
  }
  return {
    ...data,
    items: data.items.map((item) => foldAlias(item, "provider", "agent")),
  };
}

/** Fold a marker file's `options.agent` alias onto `options.provider`. */
export function foldMarkerProviderAlias(data: unknown): unknown {
  if (!isPlainObject(data) || !isPlainObject(data.options)) {
    return data;
  }
  return { ...data, options: foldAlias(data.options, "provider", "agent") };
}

/** Fold the global tool config's `defaultAgent` alias onto `defaultProvider`. */
export function foldToolConfigProviderAlias(data: unknown): unknown {
  return foldAlias(data, "defaultProvider", "defaultAgent");
}
