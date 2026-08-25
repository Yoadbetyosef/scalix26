import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
// The header comment on employee-avatar.tsx names voiceAvatar(voice) to say what it replaced, which
// is worth keeping and would otherwise fail the assertion below. Assertions about CODE read code.
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// THE ONE-FACE RULE, at the place the face is configured.
//
// An AI employee's picture used to be the stock headshot of whichever TTS voice was selected, so the
// same employee showed a different person the moment a dropdown changed — and a human portrait sat
// beside the robot the dashboard, the inbox and Ask Amy all show.
describe('the employee avatar is the robot', () => {
  const avatar = code('components/ai-employees/employee-avatar.tsx')

  it('renders RobotAvatar, not a voice headshot', () => {
    expect(avatar).toContain('RobotAvatar')
    expect(avatar).not.toContain('voiceAvatar')
  })

  it('keeps the presence dot, which is the other half of the primitive', () => {
    expect(avatar).toContain('STATUS_META')
    expect(avatar).toMatch(/showStatus/)
  })

  it('has no lookup left in lib/employee for a voice-derived face', () => {
    const employee = code('lib/employee.ts')
    expect(employee).not.toMatch(/export function voiceAvatar/)
    expect(employee).not.toContain('VOICE_AVATAR')
  })

  it('leaves the VOICE PICKER its portraits, which is a different question', () => {
    // Choosing whose voice the employee speaks in is not the same as who the employee is, and the
    // picker showing five faces is correct. lib/voices owns that one.
    const picker = code('components/ai-employees/voice-demo.tsx')
    expect(picker).toMatch(/avatarUrl|voiceHeadshot/)
  })
})
