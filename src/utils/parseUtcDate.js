/**
 * SQLite CURRENT_TIMESTAMP returns UTC as "YYYY-MM-DD HH:MM:SS" with no timezone.
 * Without a Z suffix, JS may treat that as local wall time — wrong vs system clock.
 * Normalize to an ISO instant (UTC) for correct local display.
 */
export function toUtcInstantString(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s))) {
    return s
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/)
  if (m) return `${m[1]}T${m[2]}${m[3] || ''}Z`
  return s
}

export function formatLocalDateTime(value) {
  if (value == null || value === '') return '—'
  const normalized = toUtcInstantString(value) ?? String(value)
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  })
}
