import { openExternal } from './native'

/** The user guide (docs/guide in the repo, built to runparley.com/guide). */
export const GUIDE_ORIGIN = 'https://runparley.com'

/**
 * A guide page, optionally at a heading: guideUrl('messages#polls'). Write the topic as a string literal:
 * scripts/guide-build.mjs --check finds these and fails when the page or heading doesn't exist.
 */
export function guideUrl(topic = ''): string {
  const [page, hash] = topic.split('#')
  return `${GUIDE_ORIGIN}/guide/${page ? `${page}/` : ''}${hash ? `#${hash}` : ''}`
}

/** Open the guide outside the app (our own site, so without the "Leaving Parley" check). */
export const openGuide = (topic = '') => openExternal(guideUrl(topic))

/** Marks a string as a guide topic, so scripts/guide-build.mjs --check verifies it (for topics kept in maps). */
export const guideTopic = (topic: string) => topic
