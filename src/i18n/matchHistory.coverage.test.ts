// Every fixed key the page passes to t() must exist in both languages, so no text
// falls back to a key name or to the other language.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './locales/en/matchHistory.json'
import zh from './locales/zh/matchHistory.json'

const root = join(__dirname, '..', 'features', 'match-history')
const PLURAL = /_(zero|one|two|few|many|other)$/

function keys(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>()
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object') keys(child, path).forEach(item => out.add(item))
    else out.add(path.replace(PLURAL, ''))
  }
  return out
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'upstream' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

describe('match history i18n', () => {
  const used = new Set(sources(root).flatMap(file => [...readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)].map(match => match[1])))

  it.each([
    ['zh', zh],
    ['en', en]
  ])('%s has every key the page uses', (_, messages) => {
    const known = keys(messages)
    expect([...used].filter(key => !known.has(key))).toEqual([])
  })

  it('zh and en have the same keys', () => {
    expect([...keys(zh)].filter(key => !keys(en).has(key))).toEqual([])
    expect([...keys(en)].filter(key => !keys(zh).has(key))).toEqual([])
  })
})
