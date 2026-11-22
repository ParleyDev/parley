import { useEffect, useState } from 'react'
import { api } from './api'
import { useT } from './i18n'

/** The operator's documents and contacts (`GET /instance/policies`, public). Empty strings are "not set". */
export interface Policies { terms_url: string; guidelines_url: string; privacy_url: string; safety_contact: string; legal_contact: string }

let cached: Promise<Policies> | null = null
/** Fetched once per page load; `refreshPolicies` after the operator changes them. */
export function loadPolicies(): Promise<Policies> {
  cached ??= api.get<Policies>('/instance/policies').catch(() => { cached = null; return { terms_url: '', guidelines_url: '', privacy_url: '', safety_contact: '', legal_contact: '' } })
  return cached
}
export function refreshPolicies() { cached = null }

export function usePolicies(): Policies | null {
  const [p, setP] = useState<Policies | null>(null)
  useEffect(() => { let live = true; void loadPolicies().then((x) => { if (live) setP(x) }); return () => { live = false } }, [])
  return p
}

/** An email address becomes a mailto link; a web address stays as it is. */
export const contactHref = (c: string) => (c.includes('://') ? c : `mailto:${c}`)

const A = ({ href, children, testid }: { href: string; children: React.ReactNode; testid: string }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline" data-policy-link={testid}>{children}</a>

/** Under the sign-up form: what creating an account agrees to, when the operator has published it. */
export function SignupPolicies() {
  const t = useT()
  const p = usePolicies()
  if (!p || (!p.terms_url && !p.guidelines_url && !p.privacy_url)) return null
  const terms = p.terms_url && <A href={p.terms_url} testid="terms">{t('Terms')}</A>
  const rules = p.guidelines_url && <A href={p.guidelines_url} testid="guidelines">{t('Community Guidelines')}</A>
  const privacy = p.privacy_url && <A href={p.privacy_url} testid="privacy">{t('Privacy Notice')}</A>
  const docs = [terms, rules, privacy].filter(Boolean)
  return (
    <p className="mt-3 text-xs text-text-2" data-signup-policies>
      {t('By creating an account you agree to what this instance publishes:')}{' '}
      {docs.map((d, i) => <span key={i}>{i > 0 && ' · '}{d}</span>)}
    </p>
  )
}

/** In the report dialog and My Account: how to reach the people who run this instance about safety. */
export function SafetyContact({ className = '' }: { className?: string }) {
  const t = useT()
  const p = usePolicies()
  if (!p?.safety_contact && !p?.guidelines_url) return null
  return (
    <p className={`text-xs text-text-2 ${className}`} data-safety-contact>
      {p.safety_contact && <>{t('To reach the people who run this instance about safety:')} <A href={contactHref(p.safety_contact)} testid="safety">{p.safety_contact}</A>. </>}
      {p.guidelines_url && <A href={p.guidelines_url} testid="guidelines">{t('Community Guidelines')}</A>}
    </p>
  )
}
