import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('ui-novel locale pairs', () => {
  it('covers every Chinese key with an English translation', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps the product-language tab copy and the English label distinct', () => {
    expect(zh.tab).toBe('小说工作区')
    expect(en.tab).toBe('Novel workspace')
    expect(zh.tab).not.toBe(en.tab)
  })
})
