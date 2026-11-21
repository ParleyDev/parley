import { describe, expect, it } from 'vitest'
import { findTerms, searchTerms } from './searchHighlight'

describe('what a search marks in its results', () => {
  it('is the words, not the filters', () => {
    expect(searchTerms('budget from:alice has:link in:general')).toEqual(['budget'])
    expect(searchTerms('before:2026-01-31 Release Notes')).toEqual(['release', 'notes'])
  })
  it('keeps a quoted phrase whole', () => {
    expect(searchTerms('"release notes" draft')).toEqual(['release notes', 'draft'])
  })
  it('ignores single letters and repeats', () => {
    expect(searchTerms('a plan plan')).toEqual(['plan'])
    expect(searchTerms('from:bob')).toEqual([])
  })
  it('finds every occurrence, whatever the case', () => {
    expect(findTerms('Plan the plan, then PLAN again', ['plan'])).toEqual([[0, 4], [9, 13], [20, 24]])
  })
  it('prefers the longer term where two overlap', () => {
    expect(findTerms('the release notes are out', ['release', 'release notes'])).toEqual([[4, 17]])
  })
  it('finds nothing in text without the words', () => {
    expect(findTerms('nothing here', ['plan'])).toEqual([])
  })
})
