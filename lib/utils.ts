import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatTime(date: string | Date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateTime(date: string | Date) {
  return `${formatDate(date)} ${formatTime(date)}`
}

export function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatPhone(phone: string) {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function truncate(str: string, length: number) {
  if (str.length <= length) return str
  return `${str.slice(0, length)}...`
}

// Social channels (Facebook/Instagram) store the platform user id in the
// contact's `phone` field — it is NOT a real phone number.
export function isSocialChannel(channel?: string | null): boolean {
  return channel === 'facebook' || channel === 'instagram'
}

// Describes how to display a contact's primary identifier (phone vs social id).
export function contactIdentifier(channel?: string | null, phone?: string | null) {
  if (!phone) return null
  if (isSocialChannel(channel)) {
    return {
      value: phone,
      label: channel === 'facebook' ? 'Facebook user' : 'Instagram user',
      isPhone: false,
    }
  }
  return { value: phone, label: 'Phone', isPhone: true }
}
