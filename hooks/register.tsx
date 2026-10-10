import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextFill, Phase } from '../types'

const HANDOFF_SKILL = 'mattpocock-skills:handoff'

const CLEAR_QUESTION = 'Are you sure you want to clear the conversation?'

const COMMIT_PROMPT =
  'I pressed the "Commit & push" button: commit all current changes in this repository with a clear commit message describing them, then push the current branch to its remote. If this is not a git repository, or there is nothing to commit, or the branch has no upstream, say so instead of guessing.'

const phase = atom({ plugin: 'manager', key: 'phase' } as const, 'idle' as Phase)
const contextFill = atom({ plugin: 'manager', key: 'contextFill' } as const, null as ContextFill | null)

// Desktop draws each block character wider than a cell, so it gets fewer to keep the bar on one line.
const barChars = (surface: string) => (surface === 'desktop' ? 30 : 40)

// 60600 -> "60.6k", 1000000 -> "1M"
const formatTokens = (n: number) => {
  const [value, unit] = n >= 1e6 ? [n / 1e6, 'M'] : n >= 1e3 ? [n / 1e3, 'k'] : [n, '']
  return `${Number(value.toFixed(1))}${unit}`
}

async function refreshFill($: EngineInterface) {
  const { context } = await $.session.usage()
  await update($, contextFill, () => ({ tokens: context.tokens, window: context.window, percent: context.percent }))
}

export const register: Register = on => {
  // Path of the last file written while the handoff skill ran.
  let handoffPath: string | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshFill($).catch(() => {})
    return result
  })

  on('session.measure', async ($, e, next) => {
    const { tokens, window, percent } = e.context
    await update($, contextFill, () => ({ tokens, window, percent }))
    return next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if ((await read($, phase)) === 'writing-handoff') {
      handoffPath = e.file_path
    }

    return next(e)
  }).catch(($, e, next) => next(e)) // never block a Write on our failure

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId !== undefined || (await read($, phase)) !== 'writing-handoff') {
      return result
    }

    const path = handoffPath
    handoffPath = undefined

    if (e.isAborted || path === undefined) {
      await update($, phase, () => 'idle')
      $.ui.toast(e.isAborted ? 'Handoff interrupted; conversation kept.' : 'No handoff file was written; conversation kept.')

      return result
    }

    await update($, phase, () => 'resuming')

    // Wait for the turn to settle before clearing and resuming.
    $.clock.after(0, async () => {
      try {
        await $.command.run({ command: 'clear' })
        await $.prompt.submit({
          text: `Continue from the handoff document at ${path}. Read it first, then pick up where it leaves off.`,
        })
      } catch (err) {
        $.ui.toast(`Handoff resume failed: ${String(err)}. Handoff file: ${path}`)
      } finally {
        await update($, phase, () => 'idle')
      }
    })

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, phase)

    if (current !== 'idle') {
      return (
        <Box>
          <Text dimColor>
            {current === 'writing-handoff' ? 'Writing handoff…' : 'Clearing and resuming from handoff…'}
          </Text>
        </Box>
      )
    }

    // The buttons act between turns only; while Claude works they show dim and do nothing.
    const isWorking = e.props.isWorking
    const run = async (command: string) => {
      if (isWorking) return
      try {
        await $.command.run({ command })
      } catch (err) {
        $.ui.toast(`/${command} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      await refreshFill($).catch(() => {})
    }

    const fill = await read($, contextFill)
    const percent = fill?.percent ?? 0
    const chars = barChars(e.surface)
    const filled = Math.min(chars, Math.round((percent / 100) * chars))
    const usedLabel =
      fill === null
        ? '…'
        : `${fill.tokens === undefined ? '—' : formatTokens(fill.tokens)} / ${formatTokens(fill.window)} (${fill.percent ?? 0}%)`

    return (
      <Box flexDirection="column">
        {/* One column nested in the band's root, so the buttons stay under the bar on every surface. */}
        <Box key="context" flexDirection="column" alignSelf="flex-start">
          {/* As wide as the bar, so the header's right end lines up with the bar's. */}
          <Box flexDirection="column" alignSelf="flex-start">
            <Box justifyContent="space-between" columnGap={2}>
              <Text dimColor>Context window</Text>
              <Text dimColor>{usedLabel}</Text>
            </Box>
            <Text>
              <Text color={percent >= 80 ? 'warning' : 'suggestion'}>{'█'.repeat(filled)}</Text>
              <Text dimColor>{'░'.repeat(chars - filled)}</Text>
            </Text>
          </Box>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button
              key="compact"
              label="Compact"
              dimColor={isWorking}
              onPress={() => run('compact')}
            />
            <Button
              key="clear"
              label="Clear"
              dimColor={isWorking}
              onPress={async () => {
                if (isWorking) return
                // Anything but "Yes" (No, a typed answer, or closing the dialog) keeps the conversation.
                const answer = await $.ui.ask(CLEAR_QUESTION, { options: ['Yes', 'No'], header: 'Clear' }).catch(() => undefined)
                if (answer === 'Yes') await run('clear')
              }}
            />
            <Button
              key="rewind"
              label="Rewind"
              dimColor={isWorking}
              onPress={() => run('rewind')}
            />
            <Button
              key="commit"
              label="Commit & push"
              dimColor={isWorking}
              onPress={async () => {
                if (!isWorking) await $.prompt.submit({ text: COMMIT_PROMPT })
              }}
            />
            <Button
              key="handoff"
              label="Clear + handoff"
              dimColor={isWorking}
              onPress={async () => {
                if (isWorking) return
                handoffPath = undefined
                await update($, phase, () => 'writing-handoff')
                try {
                  await $.command.run({ command: HANDOFF_SKILL })
                } catch (err) {
                  await update($, phase, () => 'idle')
                  $.ui.toast(`Could not run /${HANDOFF_SKILL}: ${String(err)}`)
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    )
  })
}
