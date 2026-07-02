import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AvatarConnectOptions, AvatarSession, AvatarState, BusinessBrainAvatarProvider, SpeakHandle, SpeakOptions } from './types'

// ── Ready Player Me 3D avatar provider ──────────────────────────────────────────────
// Renders a real 3D human (Ready Player Me GLB with Oculus visemes + ARKit blendshapes)
// with Three.js and moves the mouth from the live audio level — real lip motion, client-side,
// zero per-briefing cost. The GLB loads once and is cached by the browser. Audio (our cached
// ElevenLabs TTS) is still the only streamed asset.
//
// Self-hosted GLB (same-origin — no CORS / 404 risk). Any Ready Player Me / Avaturn / AvatarSDK
// avatar exported with Oculus visemes + ARKit blendshapes works — to swap the face, just drop a
// new .glb here or point this at a `https://models.readyplayer.me/<id>.glb?morphTargets=Oculus
// Visemes,ARKit` URL. The provider drives jawOpen + visemes + eyeBlink, so any of those work.
export const RPM_AVATAR_URL = '/avatars/coo.glb'

// tuning knobs (adjusted from screenshots — no rebuild of logic needed)
const FRAME = { fov: 26, targetDrop: 0.16, distance: 1.35, exposure: 1.05 }

class RpmSession implements AvatarSession {
  private raf = 0
  private state: AvatarState = 'idle'
  private start = performance.now()
  private nextBlink = performance.now() + 1500
  private blinkStart = 0
  private level = 0
  private paused = false

  // three
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private ro: ResizeObserver
  private morphs = new Map<string, { mesh: THREE.Mesh; index: number }[]>()
  private headBone: THREE.Object3D | null = null
  private headRest = new THREE.Euler()

  // audio
  private audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private time: Uint8Array | null = null
  private synthSpeaking = false

  constructor(private container: HTMLElement, private model: THREE.Group) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    container.style.overflow = 'hidden'
    container.style.background = 'radial-gradient(120% 120% at 50% 18%, #1a2450 0%, #0b1030 55%, #05070f 100%)'

    const { clientWidth: w, clientHeight: h } = container
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(FRAME.fov, Math.max(1, w) / Math.max(1, h), 0.1, 100)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = FRAME.exposure
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
    container.appendChild(this.renderer.domElement)

    // studio lighting
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(1.5, 2.2, 2.5); this.scene.add(key)
    const fill = new THREE.DirectionalLight(0x93a4ff, 0.7); fill.position.set(-2, 1, 1.5); this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0xbcd0ff, 0.9); rim.position.set(0, 1.5, -2.5); this.scene.add(rim)

    this.scene.add(model)
    this.indexMorphsAndBones(model)
    this.frameHead(model)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.raf = requestAnimationFrame(this.draw)
  }

  private indexMorphsAndBones(model: THREE.Object3D) {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
          const arr = this.morphs.get(name) || []
          arr.push({ mesh, index }); this.morphs.set(name, arr)
        }
      }
      if ((o as THREE.Bone).isBone && !this.headBone && o.name === 'Head') { this.headBone = o; this.headRest.copy(o.rotation) }
    })
  }

  private setMorph(name: string, value: number) {
    const list = this.morphs.get(name); if (!list) return
    const v = Math.max(0, Math.min(1, value))
    for (const { mesh, index } of list) mesh.morphTargetInfluences![index] = v
  }

  private frameHead(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    const target = new THREE.Vector3(center.x, box.max.y - FRAME.targetDrop, center.z)
    this.camera.position.set(center.x, target.y, box.max.z + FRAME.distance)
    this.camera.lookAt(target)
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  setState(state: AvatarState) { this.state = state }
  getLevel() { return this.level }

  speak(opts: SpeakOptions): SpeakHandle {
    this.stopAudio(); this.paused = false; this.setState('speaking')
    if (opts.audioUrl) {
      const audio = new Audio(); audio.src = opts.audioUrl; audio.crossOrigin = 'anonymous'; this.audio = audio
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctor()
        const src = this.ctx.createMediaElementSource(audio)
        const an = this.ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.7
        src.connect(an); an.connect(this.ctx.destination)
        this.analyser = an; this.time = new Uint8Array(an.fftSize)
      } catch { /* analyser optional */ }
      let idx = -1
      audio.ontimeupdate = () => { if (audio.duration) { const i = Math.min(opts.segments.length - 1, Math.floor((audio.currentTime / audio.duration) * opts.segments.length)); if (i !== idx) { idx = i; opts.onSegment(i) } } }
      audio.onended = () => { this.setState('idle'); opts.onEnd() }
      const play = () => { this.ctx?.resume().catch(() => {}); return audio.play() }
      play().catch(() => opts.onBlocked?.())
      return { pause: () => { this.paused = true; audio.pause() }, resume: () => { this.paused = false; play().catch(() => {}) }, stop: () => this.stopAudio() }
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.synthSpeaking = true; window.speechSynthesis.cancel()
      opts.segments.forEach((seg, i) => {
        const u = new SpeechSynthesisUtterance(seg.text); u.rate = 1; u.pitch = 0.95
        u.onstart = () => opts.onSegment(i)
        if (i === opts.segments.length - 1) u.onend = () => { this.synthSpeaking = false; this.setState('idle'); opts.onEnd() }
        window.speechSynthesis.speak(u)
      })
      return { pause: () => { this.paused = true; window.speechSynthesis.pause() }, resume: () => { this.paused = false; window.speechSynthesis.resume() }, stop: () => this.stopAudio() }
    }
    queueMicrotask(() => { this.setState('idle'); opts.onEnd() })
    return { pause: () => {}, resume: () => {}, stop: () => this.stopAudio() }
  }

  private stopAudio() {
    if (this.audio) { this.audio.pause(); this.audio.onended = null; this.audio.ontimeupdate = null; this.audio = null }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null }
    this.analyser = null; this.time = null
    if (this.synthSpeaking && window.speechSynthesis) window.speechSynthesis.cancel()
    this.synthSpeaking = false; this.level = 0
  }

  private measure(now: number): number {
    if (this.paused) return 0
    if (this.analyser && this.time && this.audio && !this.audio.paused) {
      this.analyser.getByteTimeDomainData(this.time as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < this.time.length; i++) { const v = (this.time[i] - 128) / 128; sum += v * v }
      return Math.min(1, Math.sqrt(sum / this.time.length) * 3.4)
    }
    if (this.synthSpeaking && this.state === 'speaking') {
      const s = now / 1000
      return 0.25 + (Math.sin(s * 13) * 0.5 + 0.5) * (Math.sin(s * 2.3) * 0.5 + 0.5) * 0.6
    }
    return 0
  }

  private draw = () => {
    this.raf = requestAnimationFrame(this.draw)
    const now = performance.now(), t = (now - this.start) / 1000
    this.level += (this.measure(now) - this.level) * 0.4
    const lvl = this.level

    // blink (ARKit eyeBlink)
    if (now > this.nextBlink && this.blinkStart === 0) this.blinkStart = now
    let blink = 0
    if (this.blinkStart) { const p = (now - this.blinkStart) / 140; if (p >= 1) { this.blinkStart = 0; this.nextBlink = now + 2600 + Math.random() * 3800 } else blink = Math.sin(p * Math.PI) }
    this.setMorph('eyeBlinkLeft', blink); this.setMorph('eyeBlinkRight', blink)

    // speaking mouth — jaw + a couple of visemes for shape variety
    const talk = this.state === 'speaking' ? lvl : 0
    this.setMorph('jawOpen', talk * 0.72)
    this.setMorph('viseme_aa', talk * 0.6)
    this.setMorph('viseme_O', talk * 0.25 * (Math.sin(t * 9) * 0.5 + 0.5))
    this.setMorph('viseme_E', talk * 0.2 * (Math.sin(t * 6 + 1) * 0.5 + 0.5))
    this.setMorph('mouthSmileLeft', 0.12); this.setMorph('mouthSmileRight', 0.12)

    // idle life — subtle head sway + speaking nod
    if (this.headBone) {
      this.headBone.rotation.set(
        this.headRest.x + Math.sin(t * 0.7) * 0.02 - talk * 0.03,
        this.headRest.y + Math.sin(t * 0.45) * 0.05,
        this.headRest.z + Math.sin(t * 0.5) * 0.015,
      )
    }

    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.stopAudio()
    this.renderer.domElement.remove()
    this.renderer.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.geometry?.dispose?.(); const mat = m.material; (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose?.()) }
    })
  }
}

export class RpmAvatarProvider implements BusinessBrainAvatarProvider {
  readonly id = 'rpm'
  readonly displayName = 'Ready Player Me 3D'
  readonly isLive = false
  constructor(private url: string = RPM_AVATAR_URL) {}

  async connect(container: HTMLElement, opts: AvatarConnectOptions): Promise<AvatarSession> {
    void opts // portrait poster unused for the 3D avatar
    // Each connect loads its own GLB, so every session owns a fresh scene graph — no cloning
    // (SkinnedMesh.clone doesn't rebind skeletons and would render the avatar distorted).
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      new GLTFLoader().load(this.url, (g) => resolve(g as unknown as { scene: THREE.Group }), undefined, reject)
    })
    return new RpmSession(container, gltf.scene)
  }
}
