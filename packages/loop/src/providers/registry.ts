import type { LLMProvider, ProviderFactory } from "./types.js";

const providers = new Map<string, ProviderFactory>();

/** Register a provider factory function by ID */
export function registerProvider(id: string, factory: ProviderFactory): void {
  providers.set(id, factory);
}

/** Create a provider instance by ID. Throws if the provider ID is not registered. */
export function createProvider(providerId: string, config?: Record<string, unknown>): LLMProvider {
  const factory = providers.get(providerId);
  if (!factory) {
    const available = getAvailableProviders();
    throw new Error(
      `Unknown provider "${providerId}". Available providers: ${available.length > 0 ? available.join(", ") : "(none)"}`,
    );
  }
  return factory(config);
}

/** Return an array of registered provider IDs */
export function getAvailableProviders(): string[] {
  return [...providers.keys()];
}

/** Clear all registered providers (for testing) */
export function clearProviders(): void {
  providers.clear();
}
