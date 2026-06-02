'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowRight, Plus, Trash2, Globe, Phone, Star, CheckCircle2, LayoutDashboard } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FAQ {
  q: string
  a: string
}

interface OnboardingData {
  businessName: string
  ownerName: string
  ownerPhone: string
  businessType: string
  websiteUrl: string
  scrapedContent: string
  services: string
  pricing: string
  specialInstructions: string
  googleReviewsLink: string
  greeting: string
  tone: 'friendly' | 'professional' | 'casual'
  aiInstructions: string
  faqs: FAQ[]
}

interface Props {
  tenant: { id: string; business_name: string; industry: string }
  channels: { type: string; twilio_number?: string; status: string }[]
}

const BUSINESS_TYPES = [
  '🔑 Locksmith', '🔧 Plumber', '⚡ Electrician', '❄️ HVAC',
  '🛠️ Handyman', '🏠 Roofer', '🐛 Pest Control', '🌿 Landscaper', '✨ Cleaner', '📋 Other',
]

// ─── Progress Bar ────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const pct = Math.round((step / 4) * 100)
  return (
    <div className="w-full max-w-xl mx-auto mb-8 px-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-500">Step {step} of 4</span>
        <span className="text-sm font-semibold text-[#4ecdc4]">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#4ecdc4] rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Confetti ────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#a8e6cf', '#7ec8e3', '#ffd93d']

function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${(i * 2.5) % 100}%`,
    delay: `${(i * 0.07).toFixed(2)}s`,
    size: i % 3 === 0 ? 10 : i % 3 === 1 ? 7 : 5,
    duration: `${2.5 + (i % 3) * 0.8}s`,
  }))

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-30px) rotate(0deg); opacity: 1; }
          80% { opacity: 0.8; }
          100% { transform: translateY(100vh) rotate(600deg); opacity: 0; }
        }
      `}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-40" aria-hidden>
        {pieces.map(p => (
          <div
            key={p.id}
            className="absolute rounded-sm"
            style={{
              backgroundColor: p.color,
              left: p.left,
              top: -20,
              width: p.size,
              height: p.size,
              animation: `confetti-fall ${p.duration} ${p.delay} ease-in forwards`,
            }}
          />
        ))}
      </div>
    </>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function OnboardingFlow({ tenant, channels }: Props) {
  const router = useRouter()
  const storageKey = `onboarding_${tenant.id}`

  const makeDefault = useCallback((): OnboardingData => ({
    businessName: tenant.business_name || '',
    ownerName: '',
    ownerPhone: '',
    businessType: tenant.industry || '',
    websiteUrl: '',
    scrapedContent: '',
    services: '',
    pricing: '',
    specialInstructions: '',
    googleReviewsLink: '',
    greeting: `Hi! Thanks for calling ${tenant.business_name || 'us'}. I'm the AI assistant — the owner is currently on a job. How can I help you today?`,
    tone: 'friendly',
    aiInstructions: '',
    faqs: [
      { q: 'How fast can you come?', a: 'We typically arrive within 30 minutes.' },
    ],
  }), [tenant.business_name, tenant.industry])

  const [data, setData] = useState<OnboardingData>(() => {
    if (typeof window === 'undefined') return makeDefault()
    try {
      const saved = localStorage.getItem(`onboarding_${tenant.id}`)
      if (saved) return { ...makeDefault(), ...JSON.parse(saved) }
    } catch {}
    return makeDefault()
  })

  const [step, setStep] = useState(1)
  const [scanning, setScanning] = useState(false)
  const [scanMessages, setScanMessages] = useState<{ text: string; ok: boolean }[]>([])
  const [scanDone, setScanDone] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const scanDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Auto-save to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(data))
    }
  }, [data, storageKey])

  // Sync greeting when business name changes (only if still default)
  useEffect(() => {
    setData(d => {
      const isDefaultGreeting = d.greeting.startsWith('Hi! Thanks for calling') && d.greeting.includes("the owner is currently on a job")
      if (!isDefaultGreeting) return d
      const name = d.ownerName ? `— ${d.ownerName}` : ''
      return {
        ...d,
        greeting: `Hi! Thanks for calling ${d.businessName || 'us'}. I'm the AI assistant ${name} the owner is currently on a job. How can I help you today?`.replace('  ', ' '),
      }
    })
  }, [data.businessName, data.ownerName])

  function set<K extends keyof OnboardingData>(key: K, value: OnboardingData[K]) {
    setData(d => ({ ...d, [key]: value }))
    setErrors(e => ({ ...e, [key]: '' }))
  }

  // ── Step 2: Website scan ──────────────────────────────────────────────────

  function onUrlChange(val: string) {
    set('websiteUrl', val)
    setScanMessages([])
    setScanDone(false)
    if (scanDebounce.current) clearTimeout(scanDebounce.current)
    if (val.startsWith('http')) {
      scanDebounce.current = setTimeout(() => startScan(val), 800)
    }
  }

  async function startScan(url?: string) {
    const target = url ?? data.websiteUrl
    if (!target) return
    setScanning(true)
    setScanMessages([{ text: '🔍 Scanning your website...', ok: true }])
    setScanDone(false)

    const t1 = setTimeout(() => setScanMessages(m => [...m, { text: '✅ Found your services', ok: true }]), 1800)
    const t2 = setTimeout(() => setScanMessages(m => [...m, { text: '✅ Found your pricing', ok: true }]), 3200)

    try {
      const res = await fetch('/api/onboarding/scan-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
      })
      clearTimeout(t1); clearTimeout(t2)

      if (res.ok) {
        const scraped = await res.json()
        const content = [
          scraped.description && `About: ${scraped.description}`,
          scraped.services && `Services: ${scraped.services}`,
          scraped.pricing && `Pricing: ${scraped.pricing}`,
          scraped.areas && `Areas served: ${scraped.areas}`,
          scraped.hours && `Hours: ${scraped.hours}`,
        ].filter(Boolean).join('\n')
        set('scrapedContent', content)
        setScanMessages([
          { text: '✅ Scanned your website', ok: true },
          { text: '✅ Found your services', ok: true },
          { text: '✅ Found your pricing', ok: true },
          { text: '✅ AI is learning your business', ok: true },
        ])
        setScanDone(true)
      } else {
        setScanMessages([{ text: "⚠️ Couldn't scan — you can add info manually below", ok: false }])
        setShowManual(true)
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2)
      setScanMessages([{ text: "⚠️ Couldn't reach that website — add your info below", ok: false }])
      setShowManual(true)
    } finally {
      setScanning(false)
    }
  }

  // ── Step validation ───────────────────────────────────────────────────────

  function validateStep1() {
    const e: Record<string, string> = {}
    if (!data.businessName.trim()) e.businessName = 'Oops! Business name is required 😊'
    if (!data.ownerName.trim()) e.ownerName = 'Oops! We need your first name 😊'
    if (!data.businessType) e.businessType = 'Please select your business type 😊'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function goStep2() {
    if (!validateStep1()) return
    setStep(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goStep3() {
    setStep(3)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function goStep4() {
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Save failed')
      }
      if (typeof window !== 'undefined') localStorage.removeItem(storageKey)
      setStep(4)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── FAQ helpers ───────────────────────────────────────────────────────────

  function addFaq() {
    set('faqs', [...data.faqs, { q: '', a: '' }])
  }

  function updateFaq(i: number, field: 'q' | 'a', val: string) {
    const next = [...data.faqs]
    next[i] = { ...next[i], [field]: val }
    set('faqs', next)
  }

  function removeFaq(i: number) {
    set('faqs', data.faqs.filter((_, idx) => idx !== i))
  }

  const phoneNumber = channels.find(c => c.type === 'voice' || c.type === 'sms')?.twilio_number

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f8f9fa] py-8 px-4">
      {/* Logo */}
      <div className="flex justify-center mb-6">
        <div className="w-10 h-10 bg-[#4ecdc4] rounded-xl flex items-center justify-center">
          <span className="text-white font-bold text-xl">S</span>
        </div>
      </div>

      {step < 4 && <ProgressBar step={step} />}

      <div className="max-w-xl mx-auto">

        {/* ═══════════════════════════════════════════════════════ STEP 1 */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-1">Let&apos;s set up your AI assistant</h1>
            <p className="text-gray-500 mb-8">Takes less than 4 minutes. We promise. 🙌</p>

            <div className="space-y-5">
              <div>
                <Label className="text-base font-semibold text-gray-800">Business name</Label>
                <p className="text-sm text-gray-400 mb-2">The name customers see when they call or text</p>
                <Input
                  className="h-12 text-base"
                  placeholder="Smith's Locksmith Services"
                  value={data.businessName}
                  onChange={e => set('businessName', e.target.value)}
                />
                {errors.businessName && <p className="text-red-500 text-sm mt-1">{errors.businessName}</p>}
              </div>

              <div>
                <Label className="text-base font-semibold text-gray-800">Your first name</Label>
                <p className="text-sm text-gray-400 mb-2">So your AI can introduce itself properly</p>
                <Input
                  className="h-12 text-base"
                  placeholder="John"
                  value={data.ownerName}
                  onChange={e => set('ownerName', e.target.value)}
                />
                {errors.ownerName && <p className="text-red-500 text-sm mt-1">{errors.ownerName}</p>}
              </div>

              <div>
                <Label className="text-base font-semibold text-gray-800">Your business phone number <span className="text-gray-400 font-normal">(optional)</span></Label>
                <p className="text-sm text-gray-400 mb-2">We'll forward urgent calls to this number</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg">🇺🇸</span>
                  <Input
                    className="h-12 text-base pl-10"
                    type="tel"
                    placeholder="(555) 123-4567"
                    value={data.ownerPhone}
                    onChange={e => set('ownerPhone', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label className="text-base font-semibold text-gray-800">What type of business?</Label>
                <p className="text-sm text-gray-400 mb-2">Your AI will use this to give better answers</p>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {BUSINESS_TYPES.map(type => {
                    const raw = type.split(' ').slice(1).join(' ')
                    const selected = data.businessType === raw
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => set('businessType', raw)}
                        className={`h-12 px-4 rounded-xl border-2 text-sm font-medium transition-all text-left ${
                          selected
                            ? 'border-[#4ecdc4] bg-[#4ecdc4]/10 text-[#4ecdc4]'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {type}
                      </button>
                    )
                  })}
                </div>
                {errors.businessType && <p className="text-red-500 text-sm mt-1">{errors.businessType}</p>}
              </div>
            </div>

            <Button className="w-full h-14 text-lg mt-8" onClick={goStep2}>
              Let&apos;s Go <ArrowRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ STEP 2 */}
        {step === 2 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-1">Paste your website</h1>
            <p className="text-gray-500 mb-2">Our AI will scan it and automatically learn your services and pricing. No manual typing needed.</p>
            <p className="text-[#4ecdc4] text-sm font-medium mb-8">✨ No website? No problem — scroll down</p>

            <div className="space-y-5">
              <div>
                <Label className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Globe className="w-4 h-4" /> Your website URL
                </Label>
                <div className="relative mt-2">
                  <Input
                    className="h-14 text-base pr-24"
                    type="url"
                    placeholder="https://yourwebsite.com"
                    value={data.websiteUrl}
                    onChange={e => onUrlChange(e.target.value)}
                  />
                  {data.websiteUrl && !scanning && !scanDone && (
                    <button
                      onClick={() => startScan()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#4ecdc4] text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-[#3db8af] transition-colors"
                    >
                      Scan →
                    </button>
                  )}
                </div>
              </div>

              {/* Scan animation */}
              {scanMessages.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  {scanMessages.map((msg, i) => (
                    <p key={i} className={`text-sm font-medium ${msg.ok ? 'text-gray-700' : 'text-amber-600'} ${i === scanMessages.length - 1 && scanning ? 'animate-pulse' : ''}`}>
                      {msg.text}
                    </p>
                  ))}
                  {scanning && (
                    <div className="flex gap-1 mt-2">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-2 h-2 bg-[#4ecdc4] rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {scanDone && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Your AI is trained! 🎉</p>
                    <p className="text-sm text-green-700 mt-0.5">We found your services and pricing. You can still add more info below.</p>
                  </div>
                </div>
              )}

              {/* Manual toggle */}
              {!showManual && (
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="text-sm text-[#4ecdc4] hover:underline font-medium"
                >
                  Don&apos;t have a website? Enter your info manually →
                </button>
              )}

              {showManual && (
                <div className="space-y-4 pt-2 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-600">Tell your AI about your business</p>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Services you offer</Label>
                    <Textarea
                      className="mt-2 text-sm"
                      rows={3}
                      placeholder="Emergency lockouts, key duplication, lock installation, car key programming..."
                      value={data.services}
                      onChange={e => set('services', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Your pricing</Label>
                    <Textarea
                      className="mt-2 text-sm"
                      rows={2}
                      placeholder="Service calls from $75. Lockouts starting at $95. Free estimates for larger jobs."
                      value={data.pricing}
                      onChange={e => set('pricing', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Anything else the AI should know?</Label>
                    <Textarea
                      className="mt-2 text-sm"
                      rows={2}
                      placeholder="We serve Bergen and Passaic counties. Available 24/7 for emergencies."
                      value={data.specialInstructions}
                      onChange={e => set('specialInstructions', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Google Reviews */}
              <div className="pt-2 border-t border-gray-100">
                <Label className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />
                  Google Reviews link <span className="text-gray-400 font-normal text-sm">(optional)</span>
                </Label>
                <p className="text-sm text-gray-400 mt-1 mb-2">After every completed job, your AI will automatically invite customers to leave you a review.</p>
                <Input
                  className="h-12 text-sm"
                  type="url"
                  placeholder="https://g.page/yourbusiness"
                  value={data.googleReviewsLink}
                  onChange={e => set('googleReviewsLink', e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <Button variant="outline" className="h-12 px-6" onClick={() => setStep(1)}>← Back</Button>
              <Button className="flex-1 h-12 text-base" onClick={goStep3}>
                Next <ArrowRight className="w-5 h-5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ STEP 3 */}
        {step === 3 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-1">Customize how your AI talks</h1>
            <p className="text-gray-500 mb-8">Your AI will use this to answer customers. You can always change it later.</p>

            <div className="space-y-6">
              {/* Greeting */}
              <div>
                <Label className="text-base font-semibold text-gray-800">AI Greeting</Label>
                <p className="text-sm text-gray-400 mb-2">What your AI says when a customer first reaches out</p>
                <Textarea
                  className="text-sm"
                  rows={4}
                  value={data.greeting}
                  onChange={e => set('greeting', e.target.value)}
                />
              </div>

              {/* Tone */}
              <div>
                <Label className="text-base font-semibold text-gray-800">Tone of voice</Label>
                <p className="text-sm text-gray-400 mb-3">How should your AI sound?</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { id: 'friendly', label: 'Friendly', emoji: '😊', desc: 'Warm and approachable' },
                    { id: 'professional', label: 'Professional', emoji: '💼', desc: 'Formal and precise' },
                    { id: 'casual', label: 'Casual', emoji: '👋', desc: 'Relaxed and easy-going' },
                  ] as const).map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set('tone', t.id)}
                      className={`p-4 rounded-xl border-2 text-center transition-all ${
                        data.tone === t.id
                          ? 'border-[#4ecdc4] bg-[#4ecdc4]/10'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="text-2xl mb-1">{t.emoji}</div>
                      <div className="text-sm font-semibold text-gray-800">{t.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Special instructions */}
              <div>
                <Label className="text-base font-semibold text-gray-800">
                  Special instructions <span className="text-gray-400 font-normal">(optional)</span>
                </Label>
                <p className="text-sm text-gray-400 mb-2">Anything specific your AI should always say or never say</p>
                <Textarea
                  className="text-sm"
                  rows={3}
                  placeholder={"We don't work on weekends\nAlways offer a free quote\nWe serve zip codes 07001-07099 only"}
                  value={data.aiInstructions}
                  onChange={e => set('aiInstructions', e.target.value)}
                />
              </div>

              {/* FAQs */}
              <div>
                <Label className="text-base font-semibold text-gray-800">
                  Common questions <span className="text-gray-400 font-normal">(optional)</span>
                </Label>
                <p className="text-sm text-gray-400 mb-3">Add questions your customers frequently ask — your AI will answer them automatically</p>

                <div className="space-y-3">
                  {data.faqs.map((faq, i) => (
                    <div key={i} className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-start gap-2 mb-2">
                        <div className="flex-1">
                          <Input
                            className="h-10 text-sm bg-white mb-2"
                            placeholder={i === 0 ? 'How fast can you come?' : 'Customer question...'}
                            value={faq.q}
                            onChange={e => updateFaq(i, 'q', e.target.value)}
                          />
                          <Input
                            className="h-10 text-sm bg-white"
                            placeholder={i === 0 ? 'We typically arrive within 30 minutes.' : 'Your answer...'}
                            value={faq.a}
                            onChange={e => updateFaq(i, 'a', e.target.value)}
                          />
                        </div>
                        {data.faqs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeFaq(i)}
                            className="text-gray-400 hover:text-red-400 transition-colors mt-0.5 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addFaq}
                  className="mt-3 flex items-center gap-2 text-sm text-[#4ecdc4] font-medium hover:underline"
                >
                  <Plus className="w-4 h-4" /> Add Question & Answer
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <Button variant="outline" className="h-12 px-6" onClick={() => setStep(2)}>← Back</Button>
              <Button className="flex-1 h-14 text-base font-semibold" loading={saving} onClick={goStep4}>
                {saving ? 'Setting up your AI...' : 'Almost Done →'}
              </Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ STEP 4 */}
        {step === 4 && (
          <>
            <Confetti />
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🎉</div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">Your AI is ready.</h1>
              <p className="text-lg text-gray-600">
                Welcome, {data.ownerName || 'friend'}! <strong>{data.businessName}</strong> now has a 24/7 AI assistant.
              </p>
            </div>

            <div className="space-y-4">
              {/* Card 1: Test call */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Phone className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Test your AI right now</h3>
                    <p className="text-sm text-gray-500">Give it a call — it&apos;s live!</p>
                  </div>
                </div>
                {phoneNumber ? (
                  <>
                    <div className="bg-gray-50 rounded-xl p-4 text-center mb-4">
                      <p className="text-sm text-gray-500 mb-1">Your AI phone number</p>
                      <p className="text-2xl font-bold text-gray-900 tracking-wider">{phoneNumber}</p>
                    </div>
                    <a href={`tel:${phoneNumber}`}>
                      <Button className="w-full h-12 text-base">
                        📞 Call Now to Test
                      </Button>
                    </a>
                  </>
                ) : (
                  <div className="bg-blue-50 rounded-xl p-4 text-center">
                    <p className="text-sm text-blue-700">Your AI phone number is being set up. Check back in a few minutes — it&apos;s almost ready! 🚀</p>
                  </div>
                )}
              </div>

              {/* Card 2: More channels */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                    <span className="text-xl">📱</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Connect more channels</h3>
                    <p className="text-sm text-gray-500">Reach customers everywhere they are</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'WhatsApp', emoji: '💬', href: '/settings' },
                    { label: 'Instagram', emoji: '📸', href: '/settings' },
                    { label: 'Facebook', emoji: '👍', href: '/settings' },
                    { label: 'SMS', emoji: '📱', href: '/settings' },
                  ].map(ch => (
                    <a key={ch.label} href={ch.href}>
                      <button
                        type="button"
                        className="w-full h-12 flex items-center gap-2 px-4 rounded-xl border-2 border-gray-200 text-sm font-medium text-gray-700 hover:border-[#4ecdc4] hover:text-[#4ecdc4] transition-all"
                      >
                        <span>{ch.emoji}</span> {ch.label}
                      </button>
                    </a>
                  ))}
                </div>
                <p className="text-xs text-gray-400 text-center mt-3">You can connect these anytime from Settings</p>
              </div>

              {/* Card 3: Dashboard */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#4ecdc4]/20 rounded-xl flex items-center justify-center">
                    <LayoutDashboard className="w-5 h-5 text-[#4ecdc4]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Your dashboard is ready</h3>
                    <p className="text-sm text-gray-500">See all your calls, messages, and leads in one place</p>
                  </div>
                </div>
                <Button
                  className="w-full h-12 text-base"
                  onClick={() => router.push('/dashboard')}
                >
                  Go to Dashboard →
                </Button>
              </div>
            </div>

            <p className="text-center text-sm text-gray-400 mt-8">
              Your AI is working 24/7. You&apos;ve got this! 💪
            </p>
          </>
        )}
      </div>
    </div>
  )
}
