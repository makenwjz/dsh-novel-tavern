/**
 * Writing-assist tools for the novel workspace: chapter context gathering,
 * manuscript consistency checks, vow-ledger synchronization scans, and the
 * end-to-end chapter writing workflow. All of them read the same durable
 * store through `dsh-novel`; they are pure readers and advisors — the model
 * decides and writes.
 * @module @deepseek-ai/dsh-novel-tools/writing
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { displayStoryTime, parseDisplayStoryTime } from '@deepseek-ai/dsh-novel/src/story-time.ts'
import type { NovelService } from '@deepseek-ai/dsh-novel/src/index.ts'
import type {
  ChapterInfo,
  StoryTime,
} from '@deepseek-ai/dsh-novel/src/types.ts'

/** Resolve the novel service or raise the stable missing-runtime error. */
function requireNovel(ctx: Context, tool: string): NovelService {
  const novel = ctx.get('novel')
  if (novel === undefined) throw new Error(`${tool} requires the novel workspace service (mount the @deepseek-ai/dsh-novel-bundle bundle)`)
  return novel
}

/** Render a story time for model-visible output. */
function timeText(value: StoryTime): string {
  return displayStoryTime(value)
}

/** One chapter's writing context, folded from the durable store. */
interface ChapterContext {
  chapter: { number: number; info: ChapterInfo | null }
  world: { at: string | null; subjects: Array<{ id: string; kind: string; name: string; summary: string; fields: Record<string, string> }> }
  lore: Array<{ title: string; category: string; content: string; omniscient: boolean }>
  pendingVows: Array<{ id: string; title: string; promise: string; status: string; payoffTarget: string; note: string }>
  previousManuscript: { title: string; content: string } | null
  currentManuscript: { title: string; content: string } | null
}

/** Gather one chapter's writing context (world state, canon lore, pending
 *  vows, and the neighboring drafts) from the durable store. */
function gatherChapterContext(novel: NovelService, chapter: number, at?: string): ChapterContext {
  const info = novel.getChapter(chapter) ?? null
  let world
  if (at !== undefined) {
    try {
      world = novel.worldStateAt(parseDisplayStoryTime(at))
    } catch {
      world = novel.worldState()
    }
  } else {
    world = novel.worldState()
  }
  const lore = novel.listLore({}).map(entry => ({
    title: entry.title,
    category: entry.category,
    content: entry.content,
    omniscient: entry.omniscient,
  }))
  const pendingVows = novel.listVows({}).filter(ledger => ledger.vow.status === 'planted' || ledger.vow.status === 'advanced')
  const previous = chapter > 1 ? novel.readManuscript(chapter - 1) ?? null : null
  const current = novel.readManuscript(chapter) ?? null
  return {
    chapter: { number: chapter, info },
    world: {
      at: world.at === null ? null : timeText(world.at),
      subjects: world.subjects.map(subject => ({
        id: subject.subject.id,
        kind: subject.subject.kind,
        name: subject.subject.name,
        summary: subject.subject.summary,
        fields: { ...subject.fields },
      })),
    },
    lore,
    pendingVows: pendingVows.map(ledger => ({
      id: ledger.vow.id,
      title: ledger.vow.title,
      promise: ledger.vow.promise,
      status: ledger.vow.status,
      payoffTarget: ledger.vow.payoffTarget,
      note: ledger.vow.note,
    })),
    previousManuscript: previous === null ? null : { title: previous.title, content: previous.content },
    currentManuscript: current === null ? null : { title: current.title, content: current.content },
  }
}

/** Known subject names, for mechanical name scanning. */
function subjectNames(novel: NovelService): Set<string> {
  return new Set(novel.listSubjects().map(subject => subject.name))
}

/** Every subject name found in a text (a rough mechanical scan). */
function mentionedNames(text: string, known: Set<string>): string[] {
  const found: string[] = []
  for (const name of known) {
    if (name.length > 0 && text.includes(name)) found.push(name)
  }
  return found
}

/** Register the writing-assist tools on `ctx.tools`. */
export function registerWritingTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'chapter_context',
    description: 'Gather one chapter\'s full writing context: the chapter knowledge-control ledger, the world state folded at the chapter\'s story time, the canon lorebook, every pending plot vow, and the neighboring chapter drafts. Feed this to the model before writing a chapter so it knows where the story stands, who is present, and which promises are owed.',
    parameters: {
      chapter: { type: 'number', required: true, description: 'The 1-based chapter number to write or continue.' },
      storyTime: { type: 'string', description: 'Optional story time to fold the world at, as `±YYYY.MM.DD` (defaults to the latest recorded event).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapter: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              number: { type: 'number', required: true },
              readerKnows: { type: 'string', required: true },
              protagonistKnows: { type: 'string', required: true },
              mustConceal: { type: 'string', required: true },
              mayHint: { type: 'string', required: true },
            },
          },
          world: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              subjects: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    name: { type: 'string', required: true },
                    summary: { type: 'string', required: true },
                    fields: { type: 'object', required: true, additionalProperties: true },
                  },
                },
              },
            },
          },
          lore: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                category: { type: 'string', required: true },
                content: { type: 'string', required: true },
                omniscient: { type: 'boolean', required: true },
              },
            },
          },
          pendingVows: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                promise: { type: 'string', required: true },
                status: { type: 'string', required: true },
                payoffTarget: { type: 'string', required: true },
                note: { type: 'string', required: true },
              },
            },
          },
          previousManuscript: { required: true, oneOf: [{ type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, content: { type: 'string' } } }, { type: 'null' }] },
          currentManuscript: { required: true, oneOf: [{ type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, content: { type: 'string' } } }, { type: 'null' }] },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Chapter ${value.chapter.number} context: ${value.world.subjects.length} subjects, ${value.lore.length} lore entries, ${value.pendingVows.length} pending vows.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'chapter_context')
      const context = gatherChapterContext(novel, args.chapter, typeof args.storyTime === 'string' ? args.storyTime : undefined)
      const info = context.chapter.info
      return Promise.resolve({
        chapter: {
          number: context.chapter.number,
          readerKnows: info?.readerKnows ?? '',
          protagonistKnows: info?.protagonistKnows ?? '',
          mustConceal: info?.mustConceal ?? '',
          mayHint: info?.mayHint ?? '',
        },
        world: context.world,
        lore: context.lore,
        pendingVows: context.pendingVows,
        previousManuscript: context.previousManuscript,
        currentManuscript: context.currentManuscript,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Gather chapter context', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'manuscript_check',
    description: 'Consistency-check one chapter draft against the durable canon: folds the world at the chapter\'s story time, lists the canon lore, the pending vows, the draft itself, and every known subject name the draft mentions. The model reasons over the returned material to find contradictions with canon, timeline, or character state.',
    parameters: {
      chapter: { type: 'number', required: true, description: 'The 1-based chapter number whose draft to check.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          draft: { type: 'string', required: true },
          mentionedNames: { type: 'array', required: true, items: { type: 'string' } },
          world: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              subjects: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
            },
          },
          lore: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          pendingVows: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Check of chapter draft: ${value.mentionedNames.length} known subject name(s) mentioned.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'manuscript_check')
      const manuscript = novel.readManuscript(args.chapter)
      if (manuscript === undefined) throw new Error(`manuscript_check: no draft exists for chapter ${args.chapter} (write it first)`)
      const context = gatherChapterContext(novel, args.chapter)
      const known = subjectNames(novel)
      const mentioned = mentionedNames(manuscript.content, known)
      return Promise.resolve({
        draft: manuscript.content,
        mentionedNames: mentioned,
        world: context.world,
        lore: context.lore,
        pendingVows: context.pendingVows,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Consistency check', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'manuscript_scan',
    description: 'Scan one chapter draft for plot-vow signals: phrases that promise future developments (candidates to plant as vows), existing pending vows that this chapter should advance or pay off, and subject names mentioned in the text. The result is a synchronized suggestion list the model acts on to keep the vow ledger honest.',
    parameters: {
      chapter: { type: 'number', required: true, description: 'The 1-based chapter number whose draft to scan.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          newVowCandidates: { type: 'array', required: true, items: { type: 'string' } },
          vowsToAdvance: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, title: { type: 'string', required: true }, promise: { type: 'string', required: true } } } },
          mentionedNames: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Scan: ${value.newVowCandidates.length} vow candidate(s), ${value.vowsToAdvance.length} vow(s) to advance, ${value.mentionedNames.length} name(s) mentioned.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'manuscript_scan')
      const manuscript = novel.readManuscript(args.chapter)
      if (manuscript === undefined) throw new Error(`manuscript_scan: no draft exists for chapter ${args.chapter} (write it first)`)
      const text = manuscript.content
      // Promise-like phrases that set up future payoff.
      const signal = /(?:伏笔|线索|预言|承诺|立誓|发誓|总有一天|早晚|必须|将会|秘密|真相|谜团|未解)/g
      const matches = new Set<string>()
      let match: RegExpExecArray | null
      while ((match = signal.exec(text)) !== null) {
        const around = text.slice(Math.max(0, match.index - 30), match.index + 40).replace(/\s+/g, ' ')
        matches.add(`…${around}…`)
      }
      const pending = novel.listVows({}).filter(ledger => ledger.vow.status === 'planted' || ledger.vow.status === 'advanced')
      const target = `第${args.chapter}章`
      const toAdvance = pending
        .filter(ledger => ledger.vow.payoffTarget.includes(String(args.chapter)) || ledger.vow.payoffTarget.includes(target) || text.includes(ledger.vow.title))
        .map(ledger => ({ id: ledger.vow.id, title: ledger.vow.title, promise: ledger.vow.promise }))
      return Promise.resolve({
        newVowCandidates: [...matches].slice(0, 20),
        vowsToAdvance: toAdvance,
        mentionedNames: [...mentionedNames(text, subjectNames(novel))],
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Scan draft for vow signals', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'chapter_workflow',
    description: 'The end-to-end chapter writing workflow: returns the full writing brief (chapter knowledge control, folded world state, canon lore, pending vows, the previous chapter draft) plus the explicit step plan — review the brief, outline the chapter, write the draft, run novel_lint, and revise against manuscript_check. Call this once to start a chapter, then follow the steps.',
    parameters: {
      chapter: { type: 'number', required: true, description: 'The 1-based chapter number to write.' },
      storyTime: { type: 'string', description: 'Optional story time to fold the world at, as `±YYYY.MM.DD`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chapter: { type: 'object', required: true, additionalProperties: false, properties: { number: { type: 'number', required: true }, readerKnows: { type: 'string', required: true }, protagonistKnows: { type: 'string', required: true }, mustConceal: { type: 'string', required: true }, mayHint: { type: 'string', required: true } } },
          world: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              at: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              subjects: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
            },
          },
          lore: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          pendingVows: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          previousManuscript: { required: true, oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
          steps: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Chapter ${value.chapter.number} workflow ready. Steps: ${value.steps.length}.` }],
    },
    execute(args) {
      const novel = requireNovel(ctx, 'chapter_workflow')
      const context = gatherChapterContext(novel, args.chapter, typeof args.storyTime === 'string' ? args.storyTime : undefined)
      const info = context.chapter.info
      return Promise.resolve({
        chapter: {
          number: context.chapter.number,
          readerKnows: info?.readerKnows ?? '',
          protagonistKnows: info?.protagonistKnows ?? '',
          mustConceal: info?.mustConceal ?? '',
          mayHint: info?.mayHint ?? '',
        },
        world: context.world,
        lore: context.lore,
        pendingVows: context.pendingVows,
        previousManuscript: context.previousManuscript,
        steps: [
          '审阅上方简报：本章知识控制、世界折叠状态、canon 设定、待兑现伏笔、上一章正文。',
          `规划本章：出场角色、要推进/兑现的伏笔、与知识控制(必须隐瞒/可以暗示)对齐的开局与收束。`,
          `调用 manuscript_write 写入第 ${args.chapter} 章草稿。`,
          '调用 novel_lint 检查文风，按命中项修订草稿并重新写入。',
          '调用 manuscript_check 核对一致性，修正与 canon/时间线/角色状态的冲突。',
          '调用 manuscript_scan 同步伏笔账本：新伏笔建议埋设，应推进的伏笔调用 vow_advance/vow_payoff。',
        ],
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Chapter writing workflow', kind: 'other', rawInput: args }),
  }))
}
