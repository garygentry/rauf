import { access, constants } from "node:fs/promises";
import { join, isAbsolute, delimiter } from "node:path";

import type { LLMProvider, ProviderFactory, AgentDescriptor, DetectionResult } from "./types.js";

const factories = new Map<string, ProviderFactory>();
const descriptors = new Map<string, AgentDescriptor>();

/**
 * One row of the discovery surface (REQ-DISC-02): a static descriptor flattened with its
 * resolved live availability. Returned by {@link listAgents}; rendered by `rauf agents`.
 * Not persisted; no schema impact.
 */
export interface AgentAvailability {
  /** Stable agent id (registry key). */
  id: string;
  /** Human-readable name (from the descriptor's `displayName`). */
  displayName: string;
  /** Executable probed on PATH, or undefined for binary-less descriptors (e.g. generic-cli). */
  binaryName?: string;
  /** Whether the agent's CLI / credentials are currently available (from `detect`). */
  available: boolean;
  /** Human-readable detail (PATH location, "not found", or credential status). */
  detail?: string;
}

/**
 * Register a provider factory by id (EXISTING surface — unchanged signature).
 *
 * Back-compat behavior added by this feature: in addition to populating the factory map,
 * this synthesizes a default {@link AgentDescriptor} so any provider registered the legacy
 * way remains enumerable (REQ-DISC-01) and probeable (REQ-DET-01) without the caller
 * adopting {@link registerAgent}. The synthesized descriptor uses the id for both
 * `displayName` and `binaryName` and the given factory. An explicit later
 * {@link registerAgent} for the same id OVERWRITES this synthesized descriptor.
 */
export function registerProvider(id: string, factory: ProviderFactory): void {
  factories.set(id, factory);
  if (!descriptors.has(id)) {
    descriptors.set(id, { id, displayName: id, binaryName: id, factory });
  }
}

/**
 * Register an agent via its full descriptor (REQ-ADP-05). Canonical descriptor-aware write path
 * and the descriptor-form sibling of {@link registerProvider}. Populates BOTH the factory map
 * (so {@link createProvider} can construct it) and the descriptor map (so {@link detectAgent},
 * {@link getAgentDescriptors}, and {@link listAgents} can enumerate/probe it). Last write wins.
 */
export function registerAgent(d: AgentDescriptor): void {
  factories.set(d.id, d.factory);
  descriptors.set(d.id, d);
}

/** Create a provider instance by ID. Throws if the provider ID is not registered. */
export function createProvider(providerId: string, config?: Record<string, unknown>): LLMProvider {
  const factory = factories.get(providerId);
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
  return [...factories.keys()];
}

/** Clear all registered providers AND descriptors (for testing) */
export function clearProviders(): void {
  factories.clear();
  descriptors.clear();
}

/**
 * Return the STATIC descriptors for every registered agent (REQ-DISC-01), synchronously and
 * without any PATH/credential I/O. Used by `--agent` help enumeration and selection-error
 * messages. Does NOT include live `available` — for availability use {@link listAgents}.
 */
export function getAgentDescriptors(): AgentDescriptor[] {
  return [...descriptors.values()];
}

/**
 * Default availability probe: resolve `binaryName` on PATH without executing it (REQ-DET-01).
 * which-style stat probe using `fs.access(..., X_OK)`. Never throws, never spawns.
 */
export async function probeBinaryOnPath(binaryName: string): Promise<DetectionResult> {
  if (isAbsolute(binaryName)) {
    try {
      await access(binaryName, constants.X_OK);
      return { available: true, detail: `found at ${binaryName}` };
    } catch {
      return { available: false, detail: `binary "${binaryName}" not found on PATH` };
    }
  }

  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(delimiter).filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, binaryName);
    try {
      await access(candidate, constants.X_OK);
      return { available: true, detail: `found at ${candidate}` };
    } catch {
      // not here / not executable — try next PATH entry
    }
  }
  return { available: false, detail: `binary "${binaryName}" not found on PATH` };
}

/**
 * Probe whether one agent's CLI is available on the current machine (REQ-DET-01). Runs the
 * descriptor's `detect` if present, else the default PATH probe of `binaryName`. NEVER throws
 * and never spawns the agent. An unknown id resolves to `{ available: false, detail: 'Unknown
 * agent "<id>". Supported agents: <ids>.' }` (it does NOT throw — unlike `createProvider`).
 */
export async function detectAgent(id: string): Promise<DetectionResult> {
  const descriptor = descriptors.get(id);
  if (!descriptor) {
    const ids = getAgentDescriptors()
      .map((d) => d.id)
      .join(", ");
    return {
      available: false,
      detail: `Unknown agent "${id}". Supported agents: ${ids || "(none)"}.`,
    };
  }

  if (descriptor.detect) {
    try {
      return await descriptor.detect();
    } catch (e) {
      return { available: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  if (!descriptor.binaryName) {
    return {
      available: false,
      detail: `agent "${id}" has no binaryName and no detect override (registration bug)`,
    };
  }
  return probeBinaryOnPath(descriptor.binaryName);
}

/**
 * Resolve LIVE availability for every registered agent (REQ-DISC-02). Awaits each descriptor's
 * `detect` and flattens the result into a discovery row. Never throws.
 */
export async function listAgents(): Promise<AgentAvailability[]> {
  const out: AgentAvailability[] = [];
  for (const d of descriptors.values()) {
    const result = await detectAgent(d.id);
    out.push({
      id: d.id,
      displayName: d.displayName,
      binaryName: d.binaryName,
      available: result.available,
      detail: result.detail,
    });
  }
  return out;
}
