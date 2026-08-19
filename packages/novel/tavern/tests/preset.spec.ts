import { describe, expect, it } from 'vitest'
import { parsePromptPreset } from '../src/preset.ts'
import { renderPresetSection } from '../src/section.ts'
import type { CharacterProfile } from '../src/types.ts'

/** A SillyTavern-style Chat Completion Preset with two ordering profiles. */
const PRESET = {
  name: '魔女审判',
  prompts: [
    { identifier: 'p1', name: '开场', role: 'system', content: '你是 {{char}}。', marker: false },
    { identifier: 'p2', name: '世界', role: 'system', content: 'worldInfoBefore', marker: true },
    { identifier: 'p3', name: '角色', role: 'system', content: 'charDescription', marker: true },
    { identifier: 'p4', name: '场景', role: 'system', content: 'scenario', marker: true },
    { identifier: 'p5', name: '对话', role: 'user', content: '{{user}} 开口了。', marker: false },
  ],
  prompt_order: [
    { character_id: 100001, order: [
      { identifier: 'p2', enabled: true },
      { identifier: 'p3', enabled: true },
      { identifier: 'p1', enabled: true },
      { identifier: 'p4', enabled: false },
      { identifier: 'p5', enabled: true },
    ] },
    { character_id: 'legacy', order: [{ identifier: 'p1', enabled: true }] },
  ],
  temperature: 0.8,
}

const PROFILE: CharacterProfile = {
  name: 'Aya', description: '冷面剑修', personality: '寡言', scenario: '黄昏的剑冢',
  firstMes: '', mesExample: 'Aya: 剑不是用来问的。', systemPrompt: '', postHistoryInstructions: '',
  alternateGreetings: [], tags: [], creator: '', characterVersion: '2.0', mvuVariables: {},
}

describe('preset parsing', () => {
  it('selects the 100001 ordering profile and keeps its enabled sections in order', () => {
    const preset = parsePromptPreset(JSON.stringify(PRESET))
    expect(preset.name).toBe('魔女审判')
    expect(preset.sections.map(section => section.id)).toEqual(['p2', 'p3', 'p1', 'p5'])
    expect(preset.sections[0]?.marker).toBe(true)
    expect(preset.sections[1]?.marker).toBe(true)
    expect(preset.sections[2]?.role).toBe('system')
    expect(preset.sections[3]?.role).toBe('user')
  })

  it('keeps generation parameters as inert data and defaults the name', () => {
    const preset = parsePromptPreset(JSON.stringify({ ...PRESET, name: undefined }))
    expect(preset.name).toBe('未命名预设')
    expect(preset.generation.temperature).toBe(0.8)
  })

  it('falls back to the first profile when no 100001 profile exists', () => {
    const source = { ...PRESET, prompt_order: [{ character_id: 'legacy', order: [{ identifier: 'p1', enabled: true }] }] }
    const preset = parsePromptPreset(JSON.stringify(source))
    expect(preset.sections.map(section => section.id)).toEqual(['p1'])
  })

  it('rejects malformed documents', () => {
    expect(() => parsePromptPreset('not json')).toThrow(/valid JSON/)
    expect(() => parsePromptPreset('{}')).toThrow(/prompts and prompt_order/)
  })
})

describe('preset section rendering', () => {
  it('resolves marker entries and substitutes macros in order', () => {
    const preset = parsePromptPreset(JSON.stringify(PRESET))
    const text = renderPresetSection(preset, [PROFILE], '## 已激活的世界书设定\n- 《世界》：青鸾是护山灵兽。\n')
    expect(text.indexOf('青鸾是护山灵兽')).toBeLessThan(text.indexOf('冷面剑修'))
    expect(text).toContain('## 角色介绍')
    expect(text).toContain('冷面剑修')
    expect(text).toContain('你是 Aya。')
    expect(text).toContain('用户 开口了。')
    // The disabled scenario section is absent.
    expect(text).not.toContain('黄昏的剑冢')
  })

  it('resolves scenario and dialogue markers when present', () => {
    const preset = parsePromptPreset(JSON.stringify({
      ...PRESET,
      prompt_order: [{ character_id: 100001, order: [
        { identifier: 'p4', enabled: true },
        { identifier: 'p5', enabled: true },
      ] }],
    }))
    const text = renderPresetSection(preset, [PROFILE], '')
    expect(text).toContain('黄昏的剑冢')
  })
})
