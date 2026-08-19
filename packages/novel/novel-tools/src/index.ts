/**
 * The model-facing novel-writing tool surface over the `dsh-novel` workspace
 * service: world engine, plot vow ledger, creative decisions, chapter
 * knowledge control, and manuscript style lint. The service is optional — it
 * arrives with the `dsh-novel-bundle` composition — so each tool resolves it
 * through `ctx.get('novel')` and fails loud when the runtime is missing.
 * Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-novel-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { displayStoryTime, parseDisplayStoryTime, compareStoryTime } from '@deepseek-ai/dsh-novel/src/story-time.ts'
import { exportNeuroBookProject, importNeuroBookProject } from '@deepseek-ai/dsh-novel/src/nb/index.ts'
import type { NovelService } from '@deepseek-ai/dsh-novel/src/index.ts'
import type {
  ChapterInput,
  LoreCategory,
  LoreId,
  LoreInput,
  SceneId,
  SceneInput,
  ScenePatch,
  SceneStatus,
  StoryId,
  SubjectId,
  SubjectKind,
  SubjectState,
  ThreadId,
  VowId,
  VowStatus,
  WorldChangeInput,
} from '@deepseek-ai/dsh-novel/src/types.ts'
import { lintManuscript } from './lint.ts'
import type { LintHit } from './lint.ts'

export const name = 'novel-tools'
export const inject = ['tools']

/** Model-facing tool configuration for the novel workspace tools. */
export interface Config {
  /**
   * Whether to surface the manuscript style-lint tool. The lint rules are
   * advisory; a composition that prefers to keep the tool surface minimal can
   * turn the tool off without losing the workspace store itself.
   */
  includeLintTool: boolean
}

/** Schemastery configuration for the novel tools consumer. */
export const Config: z<Config> = z.object({
  includeLintTool: z.boolean().default(true),
})

const MISSING_RUNTIME =
  'requires the novel workspace service (mount the @deepseek-ai/dsh-novel-bundle bundle)'

/** The four subject kinds, as a runtime list for the schema enum. */
const SUBJECT_KINDS: readonly SubjectKind[] = ['character', 'location', 'faction', 'object']

/** The vow statuses, as a runtime list for the schema enum. */
const VOW_STATUSES: readonly VowStatus[] = ['planted', 'advanced', 'paid_off', 'abandoned']

/** Properties of a vow ledger entry, shared by `vow_plant`'s output and `vow_list`'s ledgers. */
const VOW_FIELD_PROPERTIES = {
  id: { type: 'string', required: true },
  title: { type: 'string', required: true },
  promise: { type: 'string', required: true },
  plantedAt: { type: 'string', required: true },
  status: { type: 'string', required: true },
  payoffTarget: { type: 'string', required: true },
  note: { type: 'string', required: true },
} as const

/** Properties of the id-plus-status write acknowledgements. */
const ID_STATUS_PROPERTIES = {
  id: { type: 'string', required: true },
  status: { type: 'string', required: true },
} as const

/**
 * Resolve the optional novel service from the registrant context.
 * @param ctx - the context the tools were registered on.
 * @returns the novel service, or `undefined` when the bundle is not composed.
 */
function novelService(ctx: Context): NovelService | undefined {
  return ctx.get('novel')
}

/**
 * Resolve the novel service or raise the stable missing-runtime error.
 * @param ctx - the context the tools were registered on.
 * @param tool - the calling tool name, for the error message.
 * @returns the novel service.
 */
function requireNovel(ctx: Context, tool: string): NovelService {
  const novel = novelService(ctx)
  if (novel === undefined) throw new Error(`${tool} ${MISSING_RUNTIME}`)
  return novel
}

/**
 * Parse a display-form story time supplied by the model.
 * @param value - the `±YYYY.MM.DD` string.
 * @returns the parsed story time.
 * @throws when the text is malformed or out of bounds.
 */
function storyTime(value: string) {
  return parseDisplayStoryTime(value)
}

/** Render a story time for model-visible output. */
function timeText(value: { year: number; month: number; day: number }): string {
  return displayStoryTime(value)
}

/**
 * Register the novel workspace tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - whether to surface the style-lint tool.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'world_subject',
    description: 'Register one subject (character, location, faction, or object) in the novel\'s world engine, or update its baseline summary.',
    parameters: {
      kind: { type: 'string', required: true, enum: [...SUBJECT_KINDS], description: 'What kind of subject this is.' },
      name: { type: 'string', required: true, description: 'Display name; trimmed to a non-empty string.' },
      summary: { type: 'string', description: 'Baseline summary describing the subject as of the story\'s start.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          name: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Registered ${value.kind} ${value.name} as ${value.id}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'world_subject')
      const subject = novel.createSubject({
        kind: args.kind,
        name: args.name,
        summary: typeof args.summary === 'string' ? args.summary : '',
      })
      return Promise.resolve(subject)
    },
    presentCall: args => ({ card: 'generic', title: 'Register world subject', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'world_event',
    description: 'Record one event on the story timeline, with the field overwrites it applies to subjects. The event\'s story time becomes the world state\'s fold point.',
    parameters: {
      storyTime: { type: 'string', required: true, description: 'Position on the story timeline, as `±YYYY.MM.DD` (for example `1200.01.01`; year 0 is the story\'s epoch).' },
      title: { type: 'string', required: true, description: 'Short event title; trimmed to a non-empty string.' },
      summary: { type: 'string', description: 'Free-form description of what happens.' },
      changes: {
        type: 'array',
        description: 'Field overwrites applied to subjects at this event; each (subject, field) pair may appear once.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subjectId: { type: 'string', required: true, description: 'A subject id returned by `world_subject`.' },
            field: { type: 'string', required: true, description: 'The state field being overwritten (for example `summary`, `alive`, `location`).' },
            value: { type: 'string', required: true, description: 'The new value, as plain text.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          storyTime: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded ${value.title} at ${value.storyTime} as ${value.id}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'world_event')
      const at = storyTime(args.storyTime)
      const input: {
        storyTime: ReturnType<typeof storyTime>
        title: string
        summary: string
        changes?: WorldChangeInput[]
      } = {
        storyTime: at,
        title: args.title,
        summary: typeof args.summary === 'string' ? args.summary : '',
      }
      if (args.changes !== undefined) {
        input.changes = (args.changes as WorldChangeInput[]).map(change => ({
          subjectId: change.subjectId,
          field: change.field,
          value: change.value,
        }))
      }
      const event = novel.recordWorldEvent(input)
      return Promise.resolve({
        id: event.id,
        storyTime: timeText(event.storyTime),
        title: event.title,
        summary: event.summary,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Record world event', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'world_state',
    description: 'Read the whole world: every subject\'s folded state (last write per field wins) as of the latest recorded event, or at a given story time. Returns null before any event.',
    parameters: {
      at: { type: 'string', description: 'Optional story time to fold at, as `±YYYY.MM.DD`; events strictly after it are ignored. Defaults to the latest recorded event.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          subjects: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                subject: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    summary: { type: 'string', required: true },
                  },
                },
                fields: { type: 'json', required: true },
                updatedAt: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `World state at ${value.at ?? 'the beginning of the story'}: ${value.subjects.length} subject(s).`,
      }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'world_state')
      const state = args.at === undefined ? novel.worldState() : novel.worldStateAt(storyTime(args.at))
      return Promise.resolve({
        at: state.at === null ? null : timeText(state.at),
        subjects: state.subjects.map((entry: SubjectState) => ({
          subject: entry.subject,
          fields: entry.fields,
          updatedAt: entry.updatedAt === null ? null : timeText(entry.updatedAt),
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read world state', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'world_history',
    description: 'Read the story event log: every recorded world event with the subject field changes it applied, in story order, optionally filtered to one subject.',
    parameters: {
      subjectId: { type: 'string', description: 'Optional subject id; only events that changed this subject are returned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          events: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                storyTime: { type: 'string', required: true },
                title: { type: 'string', required: true },
                summary: { type: 'string', required: true },
                changes: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      subjectId: { type: 'string', required: true },
                      field: { type: 'string', required: true },
                      value: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `World history: ${value.events.length} event(s).`,
      }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'world_history')
      const subjectId = args.subjectId as SubjectId | undefined
      return Promise.resolve({
        events: novel.listWorldHistory(subjectId).map(event => ({
          id: event.id,
          storyTime: timeText(event.storyTime),
          title: event.title,
          summary: event.summary,
          changes: event.changes.map(change => ({
            subjectId: change.subjectId,
            field: change.field,
            value: change.value,
          })),
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read world history', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'plot_story',
    description: 'Create one plot story: the causal spine that plot threads belong to.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short display name of the story; trimmed to a non-empty string.' },
      summary: { type: 'string', description: 'Free-form summary of the story.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Story "${value.title}" registered as ${value.id}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'plot_story')
      const story = novel.createStory({
        title: args.title,
        ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
      })
      return Promise.resolve({ id: story.id, title: story.title, summary: story.summary })
    },
    presentCall: () => ({ card: 'generic', title: 'Create plot story', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'plot_thread',
    description: 'Create one plot thread inside a story: a line of causality made of scenes.',
    parameters: {
      storyId: { type: 'string', required: true, description: 'A story id returned by `plot_story`.' },
      title: { type: 'string', required: true, description: 'Short display name of the thread; trimmed to a non-empty string.' },
      summary: { type: 'string', description: 'Free-form summary of the thread.' },
      position: { type: 'number', description: 'Ordering position within the story; lower first. Defaults to 0.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          storyId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          position: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Thread "${value.title}" registered as ${value.id}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'plot_thread')
      const thread = novel.createThread({
        storyId: args.storyId as StoryId,
        title: args.title,
        ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
        ...(typeof args.position === 'number' ? { position: args.position } : {}),
      })
      return Promise.resolve({
        id: thread.id, storyId: thread.storyId, title: thread.title, summary: thread.summary, position: thread.position,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Create plot thread', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'plot_scene',
    description: 'Create or update one plot scene inside a thread. A scene is the smallest story unit; anchor it to a story time, location, and the subjects present, and attach the vows it should advance or pay off. Omit `id` to create a scene (requires `threadId`); provide `id` to update the existing scene.',
    parameters: {
      id: { type: 'string', description: 'Existing scene id to update; omit to create a new scene.' },
      threadId: { type: 'string', description: 'The owning thread id returned by `plot_thread` (required when creating).' },
      title: { type: 'string', description: 'Display name of the scene; trimmed to a non-empty string. Required when creating.' },
      summary: { type: 'string', description: 'Free-form summary of what happens in the scene.' },
      at: { type: 'string', description: 'Optional story-time anchor, as `±YYYY.MM.DD`; the world state is queryable at it.' },
      location: { type: 'string', description: 'Optional location tag.' },
      subjectIds: { type: 'array', description: 'Subjects present in the scene, as ids returned by `world_subject`.', items: { type: 'string' } },
      vowIds: { type: 'array', description: 'Vows this scene is expected to advance or pay off, as ids returned by `vow_plant`.', items: { type: 'string' } },
      position: { type: 'number', description: 'Ordering position within the thread; lower first.' },
      status: { type: 'string', description: 'Writing state: `planned`, `writing`, or `written`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          threadId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
          at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          location: { type: 'string', required: true },
          subjectIds: { type: 'array', required: true, items: { type: 'string' } },
          vowIds: { type: 'array', required: true, items: { type: 'string' } },
          position: { type: 'number', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Scene "${value.title}" saved as ${value.id} (${value.status}).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'plot_scene')
      const status = args.status as SceneStatus | undefined
      let scene
      if (args.id === undefined) {
        if (typeof args.title !== 'string') {
          throw new Error('plot_scene: title is required when creating a scene')
        }
        const input: SceneInput = {
          threadId: args.threadId as ThreadId,
          title: args.title,
          ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
          ...(typeof args.at === 'string' ? { at: storyTime(args.at) } : {}),
          ...(typeof args.location === 'string' ? { location: args.location } : {}),
          ...(args.subjectIds !== undefined ? { subjectIds: (args.subjectIds as string[]).map(id => id as SubjectId) } : {}),
          ...(args.vowIds !== undefined ? { vowIds: (args.vowIds as string[]).map(id => id as VowId) } : {}),
          ...(typeof args.position === 'number' ? { position: args.position } : {}),
          ...(status !== undefined ? { status } : {}),
        }
        scene = novel.createScene(input)
      } else {
        const patch: ScenePatch = {
          ...(typeof args.title === 'string' ? { title: args.title } : {}),
          ...(typeof args.summary === 'string' ? { summary: args.summary } : {}),
          ...(typeof args.at === 'string' ? { at: storyTime(args.at) } : {}),
          ...(typeof args.location === 'string' ? { location: args.location } : {}),
          ...(args.subjectIds !== undefined ? { subjectIds: (args.subjectIds as string[]).map(id => id as SubjectId) } : {}),
          ...(args.vowIds !== undefined ? { vowIds: (args.vowIds as string[]).map(id => id as VowId) } : {}),
          ...(typeof args.position === 'number' ? { position: args.position } : {}),
          ...(status !== undefined ? { status } : {}),
        }
        scene = novel.updateScene(args.id as SceneId, patch)
      }
      return Promise.resolve({
        id: scene.id,
        threadId: scene.threadId,
        title: scene.title,
        summary: scene.summary,
        at: scene.at === null ? null : timeText(scene.at),
        location: scene.location,
        subjectIds: [...scene.subjectIds],
        vowIds: [...scene.vowIds],
        position: scene.position,
        status: scene.status,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Save plot scene', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'plot_list',
    description: 'Read the whole plot tree: stories, their threads, and every scene with its anchored story time, location, status, subjects, and the vows attached to it (each with its current status and an `overdue` hint when a not-yet-settled vow was planted before the scene\'s story time).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                summary: { type: 'string', required: true },
                threads: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      title: { type: 'string', required: true },
                      summary: { type: 'string', required: true },
                      position: { type: 'number', required: true },
                      scenes: {
                        type: 'array',
                        required: true,
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            id: { type: 'string', required: true },
                            title: { type: 'string', required: true },
                            summary: { type: 'string', required: true },
                            at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                            location: { type: 'string', required: true },
                            status: { type: 'string', required: true },
                            subjectIds: { type: 'array', required: true, items: { type: 'string' } },
                            vows: {
                              type: 'array',
                              required: true,
                              items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                  vowId: { type: 'string', required: true },
                                  title: { type: 'string', required: true },
                                  status: { type: 'string', required: true },
                                  overdue: { type: 'boolean', required: true },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Plot tree: ${value.stories.length} story/stories.` }],
    },
    execute() {
      const novel = requireNovel(ctx, 'plot_list')
      const tree = novel.listPlot()
      const vows = new Map(novel.listVows().map(ledger => [ledger.vow.id, ledger.vow]))
      return Promise.resolve({
        stories: tree.stories.map(entry => ({
          id: entry.story.id,
          title: entry.story.title,
          summary: entry.story.summary,
          threads: entry.threads.map(thread => ({
            id: thread.thread.id,
            title: thread.thread.title,
            summary: thread.thread.summary,
            position: thread.thread.position,
            scenes: thread.scenes.map(scene => ({
              id: scene.id,
              title: scene.title,
              summary: scene.summary,
              at: scene.at === null ? null : timeText(scene.at),
              location: scene.location,
              status: scene.status,
              subjectIds: [...scene.subjectIds],
              vows: scene.vowIds.map((vowId) => {
                const vow = vows.get(vowId)
                return {
                  vowId,
                  title: vow?.title ?? '(missing)',
                  status: vow?.status ?? 'unknown',
                  overdue: vow !== undefined && vow.status !== 'paid_off' && vow.status !== 'abandoned'
                    && scene.at !== null && compareStoryTime(scene.at, vow.plantedAt) > 0,
                }
              }),
            })),
          })),
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read plot tree', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'lore_register',
    description: 'Register or update one canon lorebook entry (the story bible). Omniscient entries are canon known to everyone and must never be contradicted; character-scoped entries (omniscient false) are known only to the given subject. Omit `id` to create; provide it to update.',
    parameters: {
      id: { type: 'string', description: 'Existing entry id to update; omit to create.' },
      category: { type: 'string', required: true, description: 'Entry category: world, character, location, faction, item, event, system, instruction, or note.' },
      title: { type: 'string', required: true, description: 'Display name of the entry; trimmed to a non-empty string.' },
      content: { type: 'string', required: true, description: 'The canon text; trimmed to a non-empty string.' },
      omniscient: { type: 'boolean', description: 'Whether this is omniscient canon (default true). Set false to scope the entry to `subjectId`.' },
      subjectId: { type: 'string', description: 'The subject that knows this entry; required when `omniscient` is false.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          category: { type: 'string', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          omniscient: { type: 'boolean', required: true },
          subjectId: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Lore "${value.title}" saved as ${value.id} (${value.category}).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'lore_register')
      const input: LoreInput = {
        ...(typeof args.id === 'string' ? { id: args.id as LoreId } : {}),
        category: args.category as LoreCategory,
        title: args.title,
        content: args.content,
        ...(typeof args.omniscient === 'boolean' ? { omniscient: args.omniscient } : {}),
        ...(typeof args.subjectId === 'string' ? { subjectId: args.subjectId as SubjectId } : {}),
      }
      const entry = novel.registerLore(input)
      return Promise.resolve({
        id: entry.id,
        category: entry.category,
        title: entry.title,
        content: entry.content,
        omniscient: entry.omniscient,
        subjectId: entry.subjectId,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Register lore', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'lore_list',
    description: 'List the canon lorebook entries, optionally filtered by category, subject, or knowledge layer, in id order.',
    parameters: {
      category: { type: 'string', description: 'Optional category filter: world, character, location, faction, item, event, system, instruction, or note.' },
      subjectId: { type: 'string', description: 'Optional subject filter; returns entries scoped to that subject.' },
      omniscient: { type: 'boolean', description: 'Optional layer filter: true for omniscient canon, false for character-scoped entries.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                category: { type: 'string', required: true },
                title: { type: 'string', required: true },
                content: { type: 'string', required: true },
                omniscient: { type: 'boolean', required: true },
                subjectId: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Lorebook: ${value.entries.length} entr(y/ies).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'lore_list')
      const entries = novel.listLore({
        ...(typeof args.category === 'string' ? { category: args.category as LoreCategory } : {}),
        ...(typeof args.subjectId === 'string' ? { subjectId: args.subjectId as SubjectId } : {}),
        ...(typeof args.omniscient === 'boolean' ? { omniscient: args.omniscient } : {}),
      })
      return Promise.resolve({
        entries: entries.map(entry => ({
          id: entry.id,
          category: entry.category,
          title: entry.title,
          content: entry.content,
          omniscient: entry.omniscient,
          subjectId: entry.subjectId,
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'List lore', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'lore_context',
    description: 'Read the knowledge layer of one subject: the omniscient canon (known to everyone, never to be contradicted) plus the entries scoped to that subject. With no subject, only the omniscient canon is returned — the author\'s bible view.',
    parameters: {
      subjectId: { type: 'string', description: 'Optional subject whose knowledge is exposed, as an id returned by `world_subject`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subject: {
            required: true,
            oneOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  kind: { type: 'string', required: true },
                },
              },
            ],
          },
          omniscient: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true },
            category: { type: 'string', required: true },
            title: { type: 'string', required: true },
            content: { type: 'string', required: true },
            omniscient: { type: 'boolean', required: true },
            subjectId: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          } } },
          scoped: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true },
            category: { type: 'string', required: true },
            title: { type: 'string', required: true },
            content: { type: 'string', required: true },
            omniscient: { type: 'boolean', required: true },
            subjectId: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          } } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Lore context: ${value.omniscient.length} omniscient + ${value.scoped.length} scoped entr(y/ies).`,
      }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'lore_context')
      const subjectId = typeof args.subjectId === 'string' ? args.subjectId as SubjectId : undefined
      const context = novel.loreContext(subjectId)
      const entry = (entry: { id: LoreId; category: LoreCategory; title: string; content: string; omniscient: boolean; subjectId: SubjectId | null }) => ({
        id: entry.id,
        category: entry.category,
        title: entry.title,
        content: entry.content,
        omniscient: entry.omniscient,
        subjectId: entry.subjectId,
      })
      return Promise.resolve({
        subject: context.subject === null
          ? null
          : { id: context.subject.id, name: context.subject.name, kind: context.subject.kind },
        omniscient: context.omniscient.map(entry),
        scoped: context.scoped.map(entry),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read lore context', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'nb_import',
    description: 'Import one neuro-book project into the novel workspace: `lorebook/` markdown becomes omniscient canon lore, and the project SQLite World Engine tables (WorldSubject / WorldSlice / WorldPatch) become subjects and story-timed world events. The import is additive; re-importing into the same workspace duplicates entries.',
    parameters: {
      root: { type: 'string', required: true, description: 'Absolute path of the neuro-book project root (the directory holding `lorebook/` and `.nbook/`).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loreImported: { type: 'number', required: true },
          subjectsImported: { type: 'number', required: true },
          eventsImported: { type: 'number', required: true },
          patchesSkipped: { type: 'number', required: true },
          unknownSubjects: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Imported ${value.loreImported} lore, ${value.subjectsImported} subjects, ${value.eventsImported} events (${value.patchesSkipped} patches skipped).`,
      }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'nb_import')
      const report = importNeuroBookProject(novel, args.root)
      return Promise.resolve({
        loreImported: report.loreImported,
        subjectsImported: report.subjectsImported,
        eventsImported: report.eventsImported,
        patchesSkipped: report.patchesSkipped,
        unknownSubjects: report.unknownSubjects,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Import neuro-book project', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'nb_export',
    description: 'Export the novel workspace into one neuro-book-shaped project: canon lore becomes `lorebook/<category>/` markdown, character-scoped lore is archived under `reference/dsh-scoped-lore/`, and the world engine becomes WorldSubject / WorldSlice / WorldPatch rows in `.nbook/project.sqlite` plus a portable JSONL mirror.',
    parameters: {
      root: { type: 'string', required: true, description: 'Absolute path of the target project root; it may be empty. Exporting into a project that already holds World rows at the same instants fails loud.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          loreWritten: { type: 'number', required: true },
          scopedLoreWritten: { type: 'number', required: true },
          subjectsExported: { type: 'number', required: true },
          slicesExported: { type: 'number', required: true },
          patchesExported: { type: 'number', required: true },
          sqlitePath: { type: 'string', required: true },
          jsonlPath: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exported ${value.loreWritten} lore, ${value.subjectsExported} subjects, ${value.slicesExported} slices to ${value.sqlitePath}.`,
      }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'nb_export')
      const report = exportNeuroBookProject(novel, args.root)
      return Promise.resolve({
        loreWritten: report.loreWritten,
        scopedLoreWritten: report.scopedLoreWritten,
        subjectsExported: report.subjectsExported,
        slicesExported: report.slicesExported,
        patchesExported: report.patchesExported,
        sqlitePath: report.sqlitePath,
        jsonlPath: report.jsonlPath,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Export neuro-book project', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'manuscript_write',
    description: 'Upsert one chapter\'s prose draft in the manuscript ledger. The chapter number is the stable key; omitted content keeps the previous draft. Chapter knowledge control lives in `chapter_info`.',
    parameters: {
      number: { type: 'number', required: true, description: '1-based chapter number.' },
      title: { type: 'string', required: true, description: 'Non-empty chapter title.' },
      content: { type: 'string', description: 'The chapter\'s prose.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'number', required: true },
          title: { type: 'string', required: true },
          content: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Chapter ${value.number} saved (${value.content.length} chars).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'manuscript_write')
      const entry = novel.writeManuscript({
        number: args.number,
        title: args.title,
        ...(typeof args.content === 'string' ? { content: args.content } : {}),
      })
      return Promise.resolve({
        number: entry.number, title: entry.title, content: entry.content, updatedAt: entry.updatedAt,
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Write manuscript chapter', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'manuscript_read',
    description: 'Read one chapter\'s prose draft, or list every draft in chapter order when no number is given.',
    parameters: {
      number: { type: 'number', description: 'Optional 1-based chapter number to read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'number', required: true },
                title: { type: 'string', required: true },
                content: { type: 'string', required: true },
                updatedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Manuscript: ${value.entries.length} chapter(s).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'manuscript_read')
      const entries = args.number === undefined
        ? novel.listManuscript()
        : (() => {
          const entry = novel.readManuscript(args.number as number)
          return entry === undefined ? [] : [entry]
        })()
      return Promise.resolve({
        entries: entries.map(entry => ({
          number: entry.number, title: entry.title, content: entry.content, updatedAt: entry.updatedAt,
        })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read manuscript', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'vow_plant',
    description: 'Plant a plot vow: a promise the story makes to the reader, expected to be paid off later.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short display name of the vow.' },
      promise: { type: 'string', required: true, description: 'What the story promised, in reader-visible terms.' },
      at: { type: 'string', required: true, description: 'Story time of the planting, as `±YYYY.MM.DD`.' },
      payoffTarget: { type: 'string', description: 'Where the vow is expected to resolve (a chapter, an arc, a beat).' },
      note: { type: 'string', description: 'Free-form keeper notes for later continuity.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: VOW_FIELD_PROPERTIES,
      },
      render: (_args, value) => [{ type: 'text', text: `Planted vow ${value.title} (${value.id}) at ${value.plantedAt}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'vow_plant')
      const vow = novel.plantVow({
        title: args.title,
        promise: args.promise,
        at: storyTime(args.at),
        payoffTarget: typeof args.payoffTarget === 'string' ? args.payoffTarget : '',
        note: typeof args.note === 'string' ? args.note : '',
      })
      return Promise.resolve({
        id: vow.id,
        title: vow.title,
        promise: vow.promise,
        plantedAt: timeText(vow.plantedAt),
        status: vow.status,
        payoffTarget: vow.payoffTarget,
        note: vow.note,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Plant plot vow', kind: 'other', rawInput: args }),
  }))

  const vowTransition = (action: 'advance' | 'payoff' | 'abandon'): ToolDefinition => defineTool({
    name: `vow_${action}`,
    description: action === 'advance'
      ? 'Advance a planted or advanced plot vow: record one more step toward its payoff.'
      : action === 'payoff'
        ? 'Pay off a plot vow: resolve the promise it made to the reader.'
        : 'Abandon a plot vow: record that the promise will not be paid off.',
    parameters: {
      vowId: { type: 'string', required: true, description: 'The vow id returned by `vow_plant`.' },
      at: { type: 'string', required: true, description: 'Story time of the action, as `±YYYY.MM.DD`.' },
      detail: { type: 'string', required: true, description: 'What happens at this step; trimmed to a non-empty string.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: ID_STATUS_PROPERTIES,
      },
      render: (_args, value) => [{ type: 'text', text: `Vow ${value.id} is now ${value.status}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, `vow_${action}`)
      const at = storyTime(args.at)
      const vow = action === 'advance'
        ? novel.advanceVow(args.vowId as VowId, { at, detail: args.detail })
        : action === 'payoff'
          ? novel.payOffVow(args.vowId as VowId, { at, detail: args.detail })
          : novel.abandonVow(args.vowId as VowId, { at, detail: args.detail })
      return Promise.resolve({ id: vow.id, status: vow.status })
    },
    presentCall: (args: { vowId: string; at: string; detail: string }) => ({ card: 'generic', title: `${action.slice(0, 1).toUpperCase()}${action.slice(1)} vow`, kind: 'other', rawInput: args }),
  })

  for (const action of ['advance', 'payoff', 'abandon'] as const) {
    ctx.tools.register(vowTransition(action))
  }

  ctx.tools.register(defineTool({
    name: 'vow_list',
    description: 'List every plot vow with its full action history, oldest first, optionally filtered by status.',
    parameters: {
      status: { type: 'string', enum: [...VOW_STATUSES], description: 'Only list vows in this status.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ledgers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                vow: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: VOW_FIELD_PROPERTIES,
                },
                transitions: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      action: { type: 'string', required: true },
                      at: { type: 'string', required: true },
                      detail: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ledgers.length} vow(s) listed.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'vow_list')
      const ledgers = novel.listVows(typeof args.status === 'string' ? { status: args.status } : {})
      return Promise.resolve({
        ledgers: ledgers.map(ledger => ({
          vow: {
            id: ledger.vow.id,
            title: ledger.vow.title,
            promise: ledger.vow.promise,
            plantedAt: timeText(ledger.vow.plantedAt),
            status: ledger.vow.status,
            payoffTarget: ledger.vow.payoffTarget,
            note: ledger.vow.note,
          },
          transitions: ledger.transitions.map(transition => ({
            action: transition.action,
            at: timeText(transition.at),
            detail: transition.detail,
          })),
        })),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'List plot vows', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'decision_record',
    description: 'Record a creative decision: the context, the options weighed (with pros and cons), and its open or decided status.',
    parameters: {
      context: { type: 'string', required: true, description: 'What prompted the decision, in story terms.' },
      options: {
        type: 'array',
        required: true,
        description: 'The options weighed; labels must be unique and non-empty.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', required: true, description: 'The option itself, in one short phrase.' },
            pros: { type: 'string', description: 'Arguments for the option.' },
            cons: { type: 'string', description: 'Arguments against the option.' },
          },
        },
      },
      chosen: { type: 'string', description: 'The chosen option label, when the decision is already made.' },
      rationale: { type: 'string', description: 'The rationale for the choice, when the decision is already made.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: ID_STATUS_PROPERTIES,
      },
      render: (_args, value) => [{ type: 'text', text: `Recorded decision ${value.id} (${value.status}).` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'decision_record')
      const options = (args.options as { label: string; pros?: string; cons?: string }[]).map(option => ({
        label: option.label,
        pros: option.pros ?? '',
        cons: option.cons ?? '',
      }))
      const decision = novel.recordDecision({
        context: args.context,
        options,
      })
      const latest = typeof args.chosen === 'string'
        ? novel.decide(decision.id, {
          chosen: args.chosen,
          rationale: typeof args.rationale === 'string' ? args.rationale : '',
        })
        : decision
      return Promise.resolve({ id: latest.id, status: latest.status })
    },
    presentCall: args => ({ card: 'generic', title: 'Record creative decision', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'decision_list',
    description: 'List recorded creative decisions, newest first, with options, choice, and rationale.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decisions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                createdAt: { type: 'string', required: true },
                context: { type: 'string', required: true },
                status: { type: 'string', required: true },
                chosen: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                rationale: { type: 'string', required: true },
                options: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string', required: true },
                      pros: { type: 'string', required: true },
                      cons: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.decisions.length} decision(s) recorded.` }],
    },
    execute() {
      const novel = requireNovel(ctx, 'decision_list')
      return Promise.resolve({
        decisions: novel.listDecisions().map(decision => ({ ...decision, options: [...decision.options] })),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'List creative decisions', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'chapter_info',
    description: 'Insert or update the knowledge-control ledger for one chapter: what the reader learns, what the protagonist learns, and what the draft must conceal or may hint at. Omitted knowledge fields keep their previous values.',
    parameters: {
      number: { type: 'integer', required: true, description: '1-based chapter number.' },
      title: { type: 'string', required: true, description: 'Chapter title; trimmed to a non-empty string.' },
      readerKnows: { type: 'string', description: 'What the reader learns in this chapter.' },
      protagonistKnows: { type: 'string', description: 'What the protagonist learns in this chapter.' },
      mustConceal: { type: 'string', description: 'What this chapter must keep concealed.' },
      mayHint: { type: 'string', description: 'What this chapter may hint at without revealing.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          number: { type: 'integer', required: true },
          title: { type: 'string', required: true },
          readerKnows: { type: 'string', required: true },
          protagonistKnows: { type: 'string', required: true },
          mustConceal: { type: 'string', required: true },
          mayHint: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Chapter ${value.number} (${value.title}) knowledge ledger updated.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'chapter_info')
      const input: ChapterInput = {
        number: args.number,
        title: args.title,
        ...(typeof args.readerKnows === 'string' ? { readerKnows: args.readerKnows } : {}),
        ...(typeof args.protagonistKnows === 'string' ? { protagonistKnows: args.protagonistKnows } : {}),
        ...(typeof args.mustConceal === 'string' ? { mustConceal: args.mustConceal } : {}),
        ...(typeof args.mayHint === 'string' ? { mayHint: args.mayHint } : {}),
      }
      return Promise.resolve(novel.upsertChapter(input))
    },
    presentCall: args => ({ card: 'generic', title: 'Update chapter knowledge control', kind: 'other', rawInput: args }),
  }))

  if (config.includeLintTool) {
    ctx.tools.register(defineTool({
      name: 'novel_lint',
      description: 'Run the style linter over a manuscript excerpt: mechanically detectable prose habits (banned adverbs, stacked punctuation, told emotion, clichés, and similar) reported per line. Run this on a draft before or after revising.',
      parameters: {
        text: { type: 'string', required: true, description: 'The manuscript text to lint.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            total: { type: 'integer', required: true },
            hits: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  rule: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                  severity: { type: 'string', required: true },
                  line: { type: 'integer', required: true },
                  excerpt: { type: 'string', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.total} lint hit(s) found.` }],
      },
      execute(args: { text: string }) {
        const hits: LintHit[] = lintManuscript(args.text)
        return Promise.resolve({ total: hits.length, hits })
      },
      presentCall: args => ({ card: 'generic', title: 'Lint manuscript', kind: 'other', rawInput: args }),
    }))
  }
}
