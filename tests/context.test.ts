import { expect, test } from 'claude-code/testing'

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

test('shows the context window fill from session.measure', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 60_600, window: 1_000_000, percent: 6 },
    rateLimits: [],
    changed: ['context'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'manager', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ text: 'Context window' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '60.6k / 1M (6%)' })).toBeDefined()
    await ui.unmount()
  }
})
