// Business Opportunity Engine — Detector Registry (Sprint 4.3)
//
// A stable, IMMUTABLE catalog of detectors. `register`/`registerAll` exist only on a
// construction-time builder; once `createDetectorRegistry` returns, the registry is a
// frozen, read-only catalog (get / has / list / listEnabled / size) with no runtime
// mutation API. Immutability keeps replay, debugging, and determinism simple.
//
// Enable/disable is NOT a registry concern — it is expressed via detector `status`,
// external config, and filtering in the future engine layer. `listEnabled()` exposes
// the default-active set (status === 'active').
//
// This module is an island: it registers NO detectors and nothing in production imports
// it. It performs no I/O, no DB access, and no writes. Registration-time validation may
// throw on misconfiguration (a load-time config error) — distinct from the rule that
// detectors never throw at runtime.

import type { Detector } from './detector'

/** Construction-time only: collects detectors before the catalog is sealed. */
export interface DetectorRegistryBuilder {
  register(detector: Detector): DetectorRegistryBuilder
  registerAll(detectors: Detector[]): DetectorRegistryBuilder
}

/** The sealed, read-only catalog. No mutation methods exist after construction. */
export interface DetectorRegistry {
  get(id: string): Detector | undefined
  has(id: string): boolean
  /** All detectors, deterministically ordered by id. */
  list(): readonly Detector[]
  /** Default-active detectors (status === 'active'), deterministically ordered by id. */
  listEnabled(): readonly Detector[]
  readonly size: number
}

const VALID_STATUS: ReadonlyArray<Detector['status']> = ['active', 'experimental', 'deprecated']

// Construction-time validation. Throws (fail-fast) on misconfiguration so bad catalogs
// are caught at load, never silently shipped.
function validate(detector: Detector, existing: Map<string, Detector>): void {
  if (!detector || typeof detector.id !== 'string' || detector.id.trim() === '') {
    throw new Error('[DetectorRegistry] detector must have a non-empty string id')
  }
  if (existing.has(detector.id)) {
    throw new Error(`[DetectorRegistry] duplicate detector id: ${detector.id}`)
  }
  if (typeof detector.version !== 'number' || !Number.isFinite(detector.version)) {
    throw new Error(`[DetectorRegistry] detector "${detector.id}" must have a numeric version`)
  }
  if (!VALID_STATUS.includes(detector.status)) {
    throw new Error(`[DetectorRegistry] detector "${detector.id}" has invalid status: ${String(detector.status)}`)
  }
  if (typeof detector.detect !== 'function') {
    throw new Error(`[DetectorRegistry] detector "${detector.id}" must implement detect()`)
  }
}

function byId(a: Detector, b: Detector): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Build an immutable detector registry. Detectors are registered ONLY inside the
 * optional `build` callback; the returned registry is a frozen read-only catalog.
 *
 *   const registry = createDetectorRegistry((r) => {
 *     r.register(someDetector)
 *     r.registerAll([a, b])
 *   })
 */
export function createDetectorRegistry(
  build?: (builder: DetectorRegistryBuilder) => void,
): DetectorRegistry {
  const collected = new Map<string, Detector>()

  const builder: DetectorRegistryBuilder = {
    register(detector) {
      validate(detector, collected)
      collected.set(detector.id, detector)
      return builder
    },
    registerAll(detectors) {
      for (const detector of detectors) {
        validate(detector, collected)
        collected.set(detector.id, detector)
      }
      return builder
    },
  }

  if (build) build(builder)

  // Seal: deterministic, id-sorted, frozen snapshots. The source Map is never exposed,
  // so the catalog cannot be mutated after construction.
  const all: readonly Detector[] = Object.freeze([...collected.values()].sort(byId))
  const enabled: readonly Detector[] = Object.freeze(all.filter((d) => d.status === 'active'))
  const lookup = new Map<string, Detector>(all.map((d) => [d.id, d]))

  return Object.freeze({
    get: (id: string) => lookup.get(id),
    has: (id: string) => lookup.has(id),
    list: () => all,
    listEnabled: () => enabled,
    get size() {
      return all.length
    },
  })
}
