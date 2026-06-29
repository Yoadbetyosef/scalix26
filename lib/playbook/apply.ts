import { type OwnerPlaybook, normalizePlaybook } from './types'
import { compilePlaybook, composeSystemPrompt } from './compile'
import type { AgentCtx } from './data'

/**
 * Approve a playbook: compile it and merge it into ai_employees.system_prompt as the
 * managed block. Because every customer channel (voice, SMS, email, social) already reads
 * system_prompt, this makes the playbook live everywhere with NO runtime code changes.
 * Idempotent — re-approving replaces the block, never duplicates it. Fail-safe — if the
 * playbook is empty, the owner's raw instructions are preserved unchanged.
 */
export async function approvePlaybook(ctx: AgentCtx, playbook?: OwnerPlaybook): Promise<{ compiled: string }> {
  const { admin, agent } = ctx
  const pb = normalizePlaybook(playbook ?? agent.playbook)
  const compiled = compilePlaybook(pb)
  const system_prompt = composeSystemPrompt(agent.system_prompt, compiled)

  const { error } = await admin
    .from('ai_employees')
    .update({
      playbook: pb,
      playbook_compiled: compiled,
      playbook_status: 'approved',
      playbook_updated_at: new Date().toISOString(),
      system_prompt,
    })
    .eq('id', agent.id)
  if (error) throw new Error(error.message)

  // keep the in-memory ctx current for any follow-up work in the same request
  agent.playbook = pb
  agent.playbook_compiled = compiled
  agent.playbook_status = 'approved'
  agent.system_prompt = system_prompt
  return { compiled }
}

/** Save an edited/generated playbook as a draft (does NOT touch system_prompt / go live). */
export async function saveDraftPlaybook(ctx: AgentCtx, playbook: OwnerPlaybook): Promise<void> {
  const { admin, agent } = ctx
  const pb = normalizePlaybook(playbook)
  const { error } = await admin
    .from('ai_employees')
    .update({
      playbook: pb,
      playbook_status: agent.playbook_status === 'approved' ? 'approved' : 'draft',
      playbook_updated_at: new Date().toISOString(),
    })
    .eq('id', agent.id)
  if (error) throw new Error(error.message)
  agent.playbook = pb
}
