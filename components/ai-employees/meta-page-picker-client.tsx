'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Share2 } from 'lucide-react'

interface MetaPageData {
  id: string
  name: string
  access_token: string
  instagram: { id: string; name: string; username: string } | null
}

interface Props {
  agentId: string
  pages: MetaPageData[]
}

export function MetaPagePickerClient({ agentId, pages }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<string | null>(
    pages.length === 1 ? pages[0].id : null
  )
  const [connecting, setConnecting] = useState(false)

  const selectedPage = pages.find(p => p.id === selected)

  async function handleConnect() {
    if (!selectedPage) return
    setConnecting(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect_social_oauth',
          pageId: selectedPage.id,
          pageName: selectedPage.name,
          accessToken: selectedPage.access_token,
          instagram: selectedPage.instagram || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to connect')
      toast.success('Connected successfully!')
      router.push(`/ai-employees/${agentId}?meta_connected=true`)
    } catch {
      toast.error('Connection failed. Please try again.')
      setConnecting(false)
    }
  }

  return (
    <div className="v2 v2-embedded" style={{ width: '100%', maxWidth: 460 }}>
      {/* No product monogram at the top. This page is reached mid-flow from Facebook, inside the
          app, with the rail already saying where you are — a logo here was the only place in the
          product that reintroduced itself to a signed-in owner. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Choose a Facebook Page</p><s />
      </div>
      <p className="v2-hint" style={{ marginBottom: 18 }}>
        Which page should this agent answer for? If the page has an Instagram Business Account linked,
        that connects with it automatically.
      </p>

      <div className="v2-list" style={{ marginBottom: 20 }}>
        {pages.map(page => (
          <button
            key={page.id}
            type="button"
            onClick={() => setSelected(page.id)}
            className="v2-row tap-target"
            data-click
            aria-pressed={selected === page.id}
            style={{ ['--chan' as string]: 'var(--v2-t1)', textAlign: 'left', width: '100%', background: selected === page.id ? 'var(--v2-hover)' : undefined }}
          >
            <span className="v2-chip-sq" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><Share2 /></span>
            <div className="v2-m">
              <p><span className="truncate">{page.name}</span></p>
              <span>Facebook{page.instagram ? ` · @${page.instagram.username}` : ''}</span>
            </div>
            {selected === page.id && <CheckCircle2 className="w-5 h-5 flex-none" style={{ color: 'var(--v2-t1)' }} />}
          </button>
        ))}
      </div>

      <div className="v2-bar">
        <button type="button" className="v2-act tap-target" onClick={() => router.push(`/ai-employees/${agentId}`)}>Cancel</button>
        <button type="button" className="v2-act tap-target" data-solid disabled={!selected || connecting} onClick={handleConnect}>
          {connecting ? 'Connecting…' : 'Connect page'}
        </button>
      </div>
    </div>
  )
}
