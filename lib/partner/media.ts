// Parse a video URL into a provider + embeddable URL + thumbnail. Pure + isomorphic (used by the
// server-rendered public landing page and the client Creative Studio / Landing builder).
export interface ParsedVideo { provider: 'youtube' | 'vimeo' | 'loom' | 'file' | 'other'; embedUrl: string | null; thumb: string | null; raw: string }

export function parseVideo(url: string): ParsedVideo {
  const u = (url || '').trim()
  if (!u) return { provider: 'other', embedUrl: null, thumb: null, raw: u }
  let m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/)
  if (m) return { provider: 'youtube', embedUrl: `https://www.youtube.com/embed/${m[1]}`, thumb: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`, raw: u }
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (m) return { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${m[1]}`, thumb: null, raw: u }
  m = u.match(/loom\.com\/(?:share|embed)\/([\w-]+)/)
  if (m) return { provider: 'loom', embedUrl: `https://www.loom.com/embed/${m[1]}`, thumb: null, raw: u }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return { provider: 'file', embedUrl: u, thumb: null, raw: u }
  return { provider: 'other', embedUrl: null, thumb: null, raw: u }
}
