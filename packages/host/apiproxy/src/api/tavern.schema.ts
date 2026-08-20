/**
 * tavern domain zod schemas (names derived from map keys:
 * tavernListWorldBooksRequestSchema / tavernBindingRequestSchema / ...).
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './index.ts'

/** One lorebook row on the wire. */
const worldBookViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  entryCount: z.number().int().min(0),
})

/** One character card row on the wire. */
const characterViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.union([z.literal('json'), z.literal('png')]),
})

/** The per-session binding on the wire. */
const bindingWireSchema = z.object({
  mode: z.union([z.literal('novel'), z.literal('tavern')]),
  worldbookIds: z.array(z.string()),
  characterId: z.string().nullable(),
  characterIds: z.array(z.string()).optional(),
  stage: z.number().int().min(0).optional(),
  disabledEntryNames: z.array(z.string()).optional(),
  mvuVariables: z.record(z.string(), z.string()).optional(),
  presetId: z.string().optional(),
  persona: z.string().optional(),
})

/** tavern.listWorldBooks request payload (none). */
export const tavernListWorldBooksRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.listWorldBooks'>>>

/** tavern.importPromptPreset request payload. */
export const tavernImportPromptPresetRequestSchema = z.object({
  content: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.importPromptPreset'>>>

/** tavern.importPromptPreset response value. */
export const tavernImportPromptPresetValueSchema = z.object({
  preset: z.object({
    id: z.string(),
    name: z.string(),
    promptCount: z.number().int().min(0),
    enabledCount: z.number().int().min(0),
  }),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.importPromptPreset'>>>

/** tavern.listPromptPresets request payload (none). */
export const tavernListPromptPresetsRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.listPromptPresets'>>>

/** tavern.listPromptPresets response value. */
export const tavernListPromptPresetsValueSchema = z.object({
  presets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    promptCount: z.number().int().min(0),
    enabledCount: z.number().int().min(0),
  })),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.listPromptPresets'>>>

/** tavern.deletePromptPreset request payload. */
export const tavernDeletePromptPresetRequestSchema = z.object({
  id: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.deletePromptPreset'>>>

/** tavern.deletePromptPreset response value. */
export const tavernDeletePromptPresetValueSchema = z.object({
  deleted: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.deletePromptPreset'>>>

/** tavern.listWorldBooks response value. */
export const tavernListWorldBooksValueSchema = z.object({
  worldbooks: z.array(worldBookViewSchema),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.listWorldBooks'>>>

/** tavern.importWorldBook request payload. */
export const tavernImportWorldBookRequestSchema = z.object({
  content: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.importWorldBook'>>>

/** tavern.importWorldBook response value. */
export const tavernImportWorldBookValueSchema = z.object({
  worldbook: worldBookViewSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.importWorldBook'>>>

/** tavern.deleteWorldBook request payload. */
export const tavernDeleteWorldBookRequestSchema = z.object({
  id: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.deleteWorldBook'>>>

/** tavern.deleteWorldBook response value. */
export const tavernDeleteWorldBookValueSchema = z.object({
  deleted: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.deleteWorldBook'>>>

/** tavern.setWorldBookEntryEnabled request payload. */
export const tavernSetWorldBookEntryEnabledRequestSchema = z.object({
  id: z.string(),
  entryName: z.string(),
  enabled: z.boolean(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setWorldBookEntryEnabled'>>>

/** tavern.setWorldBookEntryEnabled response value. */
export const tavernSetWorldBookEntryEnabledValueSchema = z.object({
  updated: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setWorldBookEntryEnabled'>>>

/** tavern.listCharacters request payload (none). */
export const tavernListCharactersRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.listCharacters'>>>

/** tavern.listCharacters response value. */
export const tavernListCharactersValueSchema = z.object({
  characters: z.array(characterViewSchema),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.listCharacters'>>>

/** tavern.importCharacter request payload. */
export const tavernImportCharacterRequestSchema = z.object({
  fileName: z.string(),
  bytesB64: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.importCharacter'>>>

/** tavern.importCharacter response value. */
export const tavernImportCharacterValueSchema = z.object({
  character: characterViewSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.importCharacter'>>>

/** tavern.deleteCharacter request payload. */
export const tavernDeleteCharacterRequestSchema = z.object({
  id: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.deleteCharacter'>>>

/** tavern.deleteCharacter response value. */
export const tavernDeleteCharacterValueSchema = z.object({
  deleted: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.deleteCharacter'>>>

/** tavern.binding request payload. */
export const tavernBindingRequestSchema = z.object({
  sessionId: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.binding'>>>

/** tavern.binding response value. */
export const tavernBindingValueSchema = z.object({
  binding: bindingWireSchema.nullable(),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.binding'>>>

/** tavern.setBinding request payload. */
export const tavernSetBindingRequestSchema = z.object({
  sessionId: z.string(),
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setBinding'>>>

/** tavern.setBinding response value. */
export const tavernSetBindingValueSchema = z.object({
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setBinding'>>>

/** tavern.startRoleplay request payload. */
export const tavernStartRoleplayRequestSchema = z.object({
  sessionId: z.string(),
  characterId: z.string().optional(),
  characterIds: z.array(z.string()).optional(),
  worldbookIds: z.array(z.string()),
  presetId: z.string().optional(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.startRoleplay'>>>

/** tavern.startRoleplay response value. */
export const tavernStartRoleplayValueSchema = z.object({
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.startRoleplay'>>>

/** tavern.stopRoleplay request payload. */
export const tavernStopRoleplayRequestSchema = z.object({
  sessionId: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.stopRoleplay'>>>

/** tavern.stopRoleplay response value. */
export const tavernStopRoleplayValueSchema = z.object({
  binding: bindingWireSchema.nullable(),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.stopRoleplay'>>>

/** tavern.lean request payload (none). */
export const tavernLeanRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.lean'>>>

/** tavern.lean response value. */
export const tavernLeanValueSchema = z.object({
  lean: z.boolean(),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.lean'>>>

/** tavern.setLean request payload. */
export const tavernSetLeanRequestSchema = z.object({
  lean: z.boolean(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setLean'>>>

/** tavern.setLean response value. */
export const tavernSetLeanValueSchema = z.object({
  lean: z.boolean(),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setLean'>>>

/** tavern.advanceStage request payload. */
export const tavernAdvanceStageRequestSchema = z.object({
  sessionId: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.advanceStage'>>>

/** tavern.advanceStage response value. */
export const tavernAdvanceStageValueSchema = z.object({
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.advanceStage'>>>

/** tavern.setGreeting request payload. */
export const tavernSetGreetingRequestSchema = z.object({
  sessionId: z.string(),
  greeting: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setGreeting'>>>

/** tavern.setGreeting response value. */
export const tavernSetGreetingValueSchema = z.object({
  appended: z.literal(true),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setGreeting'>>>

/** tavern.setMvu request payload. */
export const tavernSetMvuRequestSchema = z.object({
  sessionId: z.string(),
  variables: z.record(z.string(), z.string()),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setMvu'>>>

/** tavern.setMvu response value. */
export const tavernSetMvuValueSchema = z.object({
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setMvu'>>>

/** tavern.setPersona request payload. */
export const tavernSetPersonaRequestSchema = z.object({
  sessionId: z.string(),
  persona: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.setPersona'>>>

/** tavern.setPersona response value. */
export const tavernSetPersonaValueSchema = z.object({
  binding: bindingWireSchema,
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.setPersona'>>>

/** tavern.importChat request payload. */
export const tavernImportChatRequestSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.importChat'>>>

/** tavern.importChat response value. */
export const tavernImportChatValueSchema = z.object({
  imported: z.number().int().min(0),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.importChat'>>>

/** tavern.scoreCharacter request payload. */
export const tavernScoreCharacterRequestSchema = z.object({
  id: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.scoreCharacter'>>>

/** tavern.scoreCharacter response value. */
export const tavernScoreCharacterValueSchema = z.object({
  score: z.object({
    overall: z.number(),
    clarity: z.number(),
    consistency: z.number(),
    tokenEfficiency: z.number(),
    note: z.string(),
  }),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.scoreCharacter'>>>

/** One worldbook entry in the project explorer tree. */
const worldBookEntryViewSchema = z.object({
  name: z.string(),
  keys: z.array(z.string()),
  content: z.string(),
  comment: z.string(),
  enabled: z.boolean(),
})

/** tavern.projectTree request payload (none). */
export const tavernProjectTreeRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.projectTree'>>>

/** tavern.projectTree response value. */
export const tavernProjectTreeValueSchema = z.object({
  worldbooks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    entries: z.array(worldBookEntryViewSchema),
  })),
  characters: z.array(z.object({
    id: z.string(),
    name: z.string(),
    format: z.union([z.literal('json'), z.literal('png')]),
    extensions: z.record(z.string(), z.unknown()),
    hasAvatar: z.boolean(),
    greetings: z.array(z.string()),
  })),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.projectTree'>>>

/** tavern.characterImage request payload. */
export const tavernCharacterImageRequestSchema = z.object({
  id: z.string(),
}) as unknown as z.ZodType<Wire<RequestPayload<'tavern.characterImage'>>>

/** tavern.characterImage response value. */
export const tavernCharacterImageValueSchema = z.object({
  bytesB64: z.string(),
}) as unknown as z.ZodType<Wire<ResponseValue<'tavern.characterImage'>>>
