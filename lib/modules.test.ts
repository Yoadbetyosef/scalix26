import { describe, it, expect } from 'vitest'
import { enabledModulesOf, moduleForPath, moduleForNav, EXPLICIT_OPT_IN_MODULES, ALL_MODULES } from './modules'

describe('commerce module gating (off by default)', () => {
  it('commerce is an opt-in module', () => {
    expect(EXPLICIT_OPT_IN_MODULES).toContain('commerce')
    expect(ALL_MODULES).toContain('commerce')
  })

  it('a legacy tenant (null enabled_modules) does NOT get commerce, but keeps every other module', () => {
    const mods = enabledModulesOf({ enabled_modules: null })
    expect(mods).not.toContain('commerce')
    expect(mods).toContain('inbox')
    expect(mods).toContain('orders')
    // exactly the existing modules, minus the opt-in ones
    expect(mods.length).toBe(ALL_MODULES.length - EXPLICIT_OPT_IN_MODULES.length)
  })

  it('commerce appears only when explicitly enabled', () => {
    expect(enabledModulesOf({ enabled_modules: ['commerce', 'inbox'] })).toContain('commerce')
    expect(enabledModulesOf({ enabled_modules: ['inbox'] })).not.toContain('commerce')
    expect(enabledModulesOf({ enabled_modules: [] })).not.toContain('commerce')
  })

  it('maps /commerce routes to the commerce module', () => {
    expect(moduleForPath('/commerce/catalog')).toBe('commerce')
    expect(moduleForPath('/commerce/catalog/abc')).toBe('commerce')
    expect(moduleForNav('/commerce/catalog')).toBe('commerce')
  })
})
