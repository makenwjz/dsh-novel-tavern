import { useEffect, useState, type ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { NovelWorkspaceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { NovelLocaleKey } from './locales.ts'
import css from './NovelWorkspaceTab.module.css'

/** Registration-side Remote face used by every novel workspace surface. */
export interface NovelWorkspaceTabInjected {
  /** Read a current novel workspace snapshot. */
  read: () => Promise<NovelWorkspaceSnapshot>
  /** The tavern API face the interactive panel drives. */
  api: Pick<IApiClient, 'tavern' | 'sessions' | 'workspace'>
}

/** The locale seat the content needs, as bound by each surface's PropsLocale. */
export interface NovelWorkspaceContentProps {
  /** The injected Remote read. */
  read: NovelWorkspaceTabInjected['read']
  /** Bound dictionary lookup for the novel namespace. */
  t: (key: NovelLocaleKey, params?: Record<string, unknown>) => string
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: NovelWorkspaceSnapshot }

type SubjectKind = NovelWorkspaceSnapshot['world']['subjects'][number]['kind']
type VowStatus = NovelWorkspaceSnapshot['vows'][number]['status']
type VowAction = NovelWorkspaceSnapshot['vows'][number]['transitions'][number]['action']
type DecisionStatus = NovelWorkspaceSnapshot['decisions'][number]['status']

const KIND_KEYS = {
  character: 'kindCharacter',
  location: 'kindLocation',
  faction: 'kindFaction',
  object: 'kindObject',
} satisfies Record<SubjectKind, NovelLocaleKey>

const VOW_STATUS_KEYS = {
  planted: 'vowPlanted',
  advanced: 'vowAdvanced',
  paid_off: 'vowPaidOff',
  abandoned: 'vowAbandoned',
} satisfies Record<VowStatus, NovelLocaleKey>

const VOW_ACTION_KEYS = {
  plant: 'vowActionPlant',
  advance: 'vowActionAdvance',
  payoff: 'vowActionPayoff',
  abandon: 'vowActionAbandon',
} satisfies Record<VowAction, NovelLocaleKey>

const DECISION_STATUS_KEYS = {
  open: 'decisionOpen',
  decided: 'decisionDecided',
} satisfies Record<DecisionStatus, NovelLocaleKey>

/** Translate a raw enum value with its known dictionary key, falling back to the raw value. */
function labelOf(
  keys: Readonly<Record<string, NovelLocaleKey>>,
  value: string,
  t: NovelWorkspaceContentProps['t'],
): string {
  const key = keys[value]
  return key === undefined ? value : t(key)
}

/** Render the read-only novel workspace visualization body. */
export function NovelWorkspaceContent({ read, t }: NovelWorkspaceContentProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => read()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [read, request])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  if (state.status === 'loading') {
    return <div className={css.section} aria-busy="true"><p className={css.status}>{t('loading')}</p></div>
  }
  if (state.status === 'error') {
    return (
      <div className={css.section}>
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      </div>
    )
  }

  const snapshot = state.snapshot
  return (
    <div className={css.section}>
      <div className={css.toolbar}>
        <p className={css.root}><span>{t('root')}</span><code>{snapshot.root}</code></p>
        <button type="button" onClick={retry}>{t('refresh')}</button>
      </div>

      <section className={css.block} aria-label={t('world')}>
        <h3 className={css.blockHeading}>
          {t('world')}
          <span>{snapshot.world.at === null ? t('worldAt', { at: '—' }) : t('worldAt', { at: snapshot.world.at })}</span>
        </h3>
        {snapshot.world.subjects.length === 0 ? <p className={css.status}>{t('noSubjects')}</p> : null}
        <ul className={css.subjectGrid}>
          {snapshot.world.subjects.map(subject => (
            <li className={css.subjectCard} key={subject.id} data-novel-subject>
              <header className={css.subjectHeader}>
                <span className={css.kindTag} data-kind={subject.kind}>{labelOf(KIND_KEYS, subject.kind, t)}</span>
                <strong className={css.subjectName}>{subject.name}</strong>
                {subject.updatedAt === null ? null
                  : <span className={css.muted}>{t('subjectUpdatedAt', { at: subject.updatedAt })}</span>}
              </header>
              <p className={css.subjectSummary}>{subject.summary}</p>
              {Object.keys(subject.fields).length === 0 ? null : (
                <div className={css.fieldList}>
                  <span className={css.muted}>{t('fields')}</span>
                  {Object.entries(subject.fields).map(([field, value]) => (
                    <span className={css.fieldChip} key={field}><strong>{field}</strong>{value}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={css.block} aria-label={t('timeline')}>
        <h3 className={css.blockHeading}>{t('timeline')}</h3>
        {snapshot.events.length === 0 ? <p className={css.status}>{t('noEvents')}</p> : null}
        <ol className={css.timeline}>
          {snapshot.events.map(event => (
            <li className={css.timelineItem} key={event.id} data-novel-event>
              <time className={css.time}>{event.storyTime}</time>
              <div className={css.timelineBody}>
                <strong>{event.title}</strong>
                <p>{event.summary}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={css.block} aria-label={t('vows')}>
        <h3 className={css.blockHeading}>{t('vows')}</h3>
        {snapshot.vows.length === 0 ? <p className={css.status}>{t('noVows')}</p> : null}
        <ul className={css.cardList}>
          {snapshot.vows.map(vow => (
            <li className={css.card} key={vow.id} data-novel-vow>
              <header className={css.cardHeader}>
                <strong className={css.cardTitle}>{vow.title}</strong>
                <span className={css.statusChip} data-status={vow.status}>{labelOf(VOW_STATUS_KEYS, vow.status, t)}</span>
              </header>
              <p className={css.vowPromise}>{vow.promise}</p>
              <dl className={css.details}>
                {vow.payoffTarget.length === 0 ? null : (
                  <div><dt>{t('payoffTarget')}</dt><dd>{vow.payoffTarget}</dd></div>
                )}
                {vow.note.length === 0 ? null : (
                  <div><dt>{t('note')}</dt><dd>{vow.note}</dd></div>
                )}
              </dl>
              {vow.transitions.length > 0 ? (
                <ol className={css.transitions}>
                  {vow.transitions.map((transition, index) => (
                    <li key={index} data-novel-vow-transition>
                      <time className={css.time}>{transition.at}</time>
                      <span>{labelOf(VOW_ACTION_KEYS, transition.action, t)}</span>
                      {transition.detail.length === 0 ? null : <p>{transition.detail}</p>}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className={css.block} aria-label={t('decisions')}>
        <h3 className={css.blockHeading}>{t('decisions')}</h3>
        {snapshot.decisions.length === 0 ? <p className={css.status}>{t('noDecisions')}</p> : null}
        <ul className={css.cardList}>
          {snapshot.decisions.map(decision => (
            <li className={css.card} key={decision.id} data-novel-decision>
              <header className={css.cardHeader}>
                <strong className={css.cardTitle}>{decision.context}</strong>
                <span className={css.statusChip} data-status={decision.status}>{labelOf(DECISION_STATUS_KEYS, decision.status, t)}</span>
              </header>
              <ol className={css.optionList}>
                {decision.options.map(option => (
                  <li className={css.option} key={option.label} data-chosen={decision.chosen === option.label ? 'true' : undefined}>
                    <div className={css.optionHeading}>
                      <strong>{option.label}</strong>
                      {decision.chosen === option.label ? <span className={css.chosenTag}>{t('chosen')}</span> : null}
                    </div>
                    <dl className={css.details}>
                      {option.pros.length === 0 ? null : (
                        <div><dt>{t('pros')}</dt><dd>{option.pros}</dd></div>
                      )}
                      {option.cons.length === 0 ? null : (
                        <div><dt>{t('cons')}</dt><dd>{option.cons}</dd></div>
                      )}
                    </dl>
                  </li>
                ))}
              </ol>
              {decision.rationale.length === 0 ? null : <p className={css.rationale}>{decision.rationale}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className={css.block} aria-label={t('chapters')}>
        <h3 className={css.blockHeading}>{t('chapters')}</h3>
        {snapshot.chapters.length === 0 ? <p className={css.status}>{t('noChapters')}</p> : null}
        <ul className={css.cardList}>
          {snapshot.chapters.map(chapter => (
            <li className={css.chapter} key={chapter.number} data-novel-chapter>
              <strong className={css.cardTitle}>{t('chapterNumber', { number: chapter.number })}{chapter.title.length === 0 ? '' : ` · ${chapter.title}`}</strong>
              <dl className={css.details}>
                <div><dt>{t('readerKnows')}</dt><dd>{chapter.readerKnows}</dd></div>
                <div><dt>{t('protagonistKnows')}</dt><dd>{chapter.protagonistKnows}</dd></div>
                <div><dt>{t('mustConceal')}</dt><dd>{chapter.mustConceal}</dd></div>
                <div><dt>{t('mayHint')}</dt><dd>{chapter.mayHint}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
