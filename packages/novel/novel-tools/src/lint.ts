/**
 * Style lint rules for fiction manuscripts: mechanically detectable prose
 * habits worth flagging before the draft goes to the model's rewrite pass.
 * Line-based, pure, and deterministic — the same text always yields the same
 * hits. The rules are advisory (severity `warning`) except for outright
 * punctuation abuse (`error`).
 * @module @deepseek-ai/dsh-novel-tools/lint
 */

/** One matched style rule on one line of the manuscript. */
export interface LintHit {
  /** Stable rule identifier, `zh/*` or `en/*`. */
  readonly rule: string
  /** Short human-readable rule name. */
  readonly name: string
  /** `error` for punctuation abuse, `warning` for advisory style habits. */
  readonly severity: 'error' | 'warning'
  /** 1-based line number of the hit. */
  readonly line: number
  /** A trimmed excerpt of the line around the hit. */
  readonly excerpt: string
}

/** A declarative line-level style rule. */
export interface LintRule {
  /** Stable rule identifier. */
  readonly id: string
  /** Short human-readable rule name. */
  readonly name: string
  /** `error` for punctuation abuse, `warning` for advisory style habits. */
  readonly severity: 'error' | 'warning'
  /** Line-level matcher. */
  readonly match: RegExp
  /** When set, report once per line only once this many hits occur. */
  readonly threshold?: number
  /** Model-facing advice for fixing the hit. */
  readonly note: string
}

/** The advisory style rules, in stable order. */
export const RULES: readonly LintRule[] = [
  {
    id: 'zh/banned-adverbs',
    name: '忌用瞬间副词',
    severity: 'warning',
    match: /突然|忽然|猛然|骤然|瞬间|顿时|立刻|马上|随即/g,
    note: 'These announce a change instead of showing it; replace with a concrete action or sensory detail.',
  },
  {
    id: 'zh/explanatory-phrases',
    name: '解说词',
    severity: 'warning',
    match: /总而言之|值得一提的是|这说明了|换句话说|老实说|说实话|不出所料/g,
    note: 'Explaining the point to the reader; trust the scene and cut the framing.',
  },
  {
    id: 'zh/vague-time',
    name: '空洞时间',
    severity: 'warning',
    match: /一段时间后|过了很久|很久以后|就在这时|不知不觉/g,
    note: 'Vague time jumps; anchor the transition with a concrete beat instead.',
  },
  {
    id: 'zh/exclamation-run',
    name: '惊叹号连用',
    severity: 'error',
    match: /!{2,}/g,
    note: 'Stacked exclamation marks; keep one, or rewrite so the prose carries the emotion.',
  },
  {
    id: 'zh/ellipsis-run',
    name: '省略号堆叠',
    severity: 'error',
    match: /…{3,}|。。{2,}/g,
    note: 'Repeated ellipses or full stops read as hesitation; use at most one ellipsis.',
  },
  {
    id: 'zh/tag-run',
    name: '对话标签密集',
    severity: 'warning',
    match: /说|道|问/g,
    threshold: 3,
    note: 'Three or more dialogue tags in one line; drop the tags once the speakers are clear.',
  },
  {
    id: 'zh/comma-run',
    name: '流水句',
    severity: 'warning',
    match: /，/g,
    threshold: 5,
    note: 'Five or more commas in one line; break it into shorter sentences.',
  },
  {
    id: 'zh/echoing-word',
    name: '词语复读',
    severity: 'warning',
    match: /([\p{Script=Han}]{2,4})[\s，。！？、]*\1/gu,
    note: 'The same word or phrase repeats back to back; find a synonym or restructure.',
  },
  {
    id: 'zh/not-but',
    name: '公式化不是…而是…',
    severity: 'warning',
    match: /不是[^，。！？]{1,10}而是/g,
    note: 'The formulaic "not X but Y" contrast is a common AI tell; rewrite it as a concrete action.',
  },
  {
    id: 'zh/binary-contrast',
    name: '二元对比排比',
    severity: 'warning',
    match: /(一半|一边)[^，。！？]{1,10}(一半|一边)/g,
    note: 'Paired "half… half… / one side… the other…" runs are an AI rhythm tell; give the scene one definite detail.',
  },
  {
    id: 'en/show-dont-tell',
    name: "Show, don't tell",
    severity: 'warning',
    match: /\b(very|really|quite|rather|somewhat|suddenly|literally)\b/g,
    note: 'Intensifiers and announcement words; let the action or sensory detail show the state.',
  },
  {
    id: 'en/repeated-word',
    name: 'Word echo',
    severity: 'warning',
    match: /\b(\w{3,})\s+\1\b/g,
    note: 'The same word repeats back to back; find a synonym or restructure.',
  },
  {
    id: 'en/filler-words',
    name: 'Filler words',
    severity: 'warning',
    match: /\b(actually|basically|literally|absolutely|totally|just|so)\b/g,
    note: 'Conversational filler; cut it or make the statement carry its own weight.',
  },
  {
    id: 'en/feels-tells',
    name: 'Told emotion',
    severity: 'warning',
    match: /\b(she|he|it|they)\s+(felt|knew|realized)\b/g,
    note: 'Naming the feeling instead of showing it; give the reader the evidence.',
  },
  {
    id: 'en/there-was',
    name: 'Existential construction',
    severity: 'warning',
    match: /\bthere\s+(was|were|is|are)\b/g,
    note: 'Existence sentences push the subject late; put the thing doing the action first.',
  },
  {
    id: 'en/passive-voice',
    name: 'Passive voice',
    severity: 'warning',
    match: /\b(was|were)\s+\w+ed\b/g,
    note: 'Passive construction; name the actor and make the action direct.',
  },
  {
    id: 'en/ellipsis-run',
    name: 'Ellipsis run',
    severity: 'error',
    match: /\.{6,}/g,
    note: 'Repeated ellipses read as hesitation; use at most one.',
  },
  {
    id: 'en/cliches',
    name: 'Clichés',
    severity: 'warning',
    match: /\bin the nick of time\b|\bat the end of the day\b|\ball of a sudden\b/g,
    note: 'Worn phrasing; give the moment a specific, concrete texture instead.',
  },
  {
    id: 'en/not-only',
    name: 'Formulaic not-only',
    severity: 'warning',
    match: /\bnot only\b/gi,
    note: 'The "not only … but also" scaffold is an AI sentence tell; say the stronger point plainly.',
  },
  {
    id: 'en/generic-feeling',
    name: 'Vague perception',
    severity: 'warning',
    match: /\b(a sense of|felt like|seemed to)\b/g,
    note: 'Vague perception framing; give the reader the specific evidence instead of the summary.',
  },
]

/** Characters of context shown on each side of a hit. */
const EXCERPT_RADIUS = 24

/** Maximum length of a reported excerpt. */
const EXCERPT_MAX = 96

/**
 * Run every style rule over one manuscript and return the hits in line order.
 * The manuscript is split on newlines and each line is matched against every
 * rule. Rules without a threshold report every hit; rules with a threshold
 * report once per line, at the first hit, once the line reaches the threshold.
 * @param text - the manuscript to lint.
 * @returns the collected hits, ordered by line then rule.
 */
export function lintManuscript(text: string): LintHit[] {
  const hits: LintHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    for (const rule of RULES) {
      const matcher = new RegExp(rule.match.source, rule.match.flags)
      const matches = [...line.matchAll(matcher)]
      if (matches.length === 0) continue
      const report = rule.threshold === undefined ? matches : (matches.length >= rule.threshold ? matches.slice(0, 1) : [])
      for (const match of report) {
        const index = match.index
        const start = Math.max(0, index - EXCERPT_RADIUS)
        const end = Math.min(line.length, index + match[0].length + EXCERPT_RADIUS)
        let excerpt = line.slice(start, end).trim()
        if (excerpt.length > EXCERPT_MAX) excerpt = `${excerpt.slice(0, EXCERPT_MAX)}…`
        hits.push({
          rule: rule.id,
          name: rule.name,
          severity: rule.severity,
          line: i + 1,
          excerpt,
        })
      }
    }
  }
  return hits
}
