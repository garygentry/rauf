import { EventEmitter } from "node:events";
import type { LoopEvent } from "@rauf/core";

/** Extract the set of valid LoopEvent type discriminator values */
type LoopEventType = LoopEvent["type"];

/** Extract the specific event payload for a given type discriminator */
type LoopEventPayload<T extends LoopEventType> = Extract<LoopEvent, { type: T }>;

/** Listener callback for a specific event type */
type LoopEventListener<T extends LoopEventType> = (event: LoopEventPayload<T>) => void;

/**
 * A typed wrapper around Node's EventEmitter that emits LoopEvent objects
 * with type-safe on/emit/off methods constrained to valid LoopEvent type values.
 */
export class TypedEventEmitter extends EventEmitter {
  emit<T extends LoopEventType>(type: T, event: LoopEventPayload<T>): boolean {
    return super.emit(type, event);
  }

  on<T extends LoopEventType>(type: T, listener: LoopEventListener<T>): this {
    return super.on(type, listener);
  }

  off<T extends LoopEventType>(type: T, listener: LoopEventListener<T>): this {
    return super.off(type, listener);
  }

  once<T extends LoopEventType>(type: T, listener: LoopEventListener<T>): this {
    return super.once(type, listener);
  }
}
