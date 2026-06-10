'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Share2, MessageCircle } from 'lucide-react'

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
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
        <div className="flex justify-center mb-5">
          <div className="w-10 h-10 bg-[#4ecdc4] rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-xl">S</span>
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-1">Choose a Facebook Page</h1>
        <p className="text-sm text-gray-500 mb-6">
          Select which page to connect to this agent. If the page has an Instagram Business Account linked, it will be connected automatically.
        </p>

        <div className="space-y-3 mb-6">
          {pages.map(page => (
            <button
              key={page.id}
              type="button"
              onClick={() => setSelected(page.id)}
              className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                selected === page.id
                  ? 'border-[#4ecdc4] bg-[#4ecdc4]/5'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">{page.name}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-blue-600">
                      <Share2 className="w-3 h-3" /> Facebook
                    </span>
                    {page.instagram && (
                      <span className="flex items-center gap-1 text-xs text-pink-500 min-w-0">
                        <MessageCircle className="w-3 h-3 flex-shrink-0" /> <span className="truncate">@{page.instagram.username}</span>
                      </span>
                    )}
                  </div>
                </div>
                {selected === page.id && (
                  <CheckCircle2 className="w-5 h-5 text-[#4ecdc4] flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.push(`/ai-employees/${agentId}`)}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!selected}
            loading={connecting}
            onClick={handleConnect}
          >
            Connect Page
          </Button>
        </div>
      </div>
    </div>
  )
}
