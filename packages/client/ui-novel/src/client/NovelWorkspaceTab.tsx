import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  NovelWorkspaceContent,
  type NovelWorkspaceTabInjected,
} from './NovelWorkspaceContent.tsx'

export type { NovelWorkspaceTabInjected } from './NovelWorkspaceContent.tsx'

/** Full component props assembled by the Settings slot renderer. */
export type NovelWorkspaceTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.novel'>
  & InjectFace<NovelWorkspaceTabInjected>

/** Render the read-only novel workspace visualization in the Plugins settings section. */
export function NovelWorkspaceTab({ read, t }: NovelWorkspaceTabProps): ReactNode {
  return <NovelWorkspaceContent read={read} t={t} />
}
