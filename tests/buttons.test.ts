import { expect, test } from 'claude-code/testing'

const props = (isWorking: boolean) => ({
  hasSurvey: false,
  isWorking,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

test('Compact conversation runs /compact', async ($, on) => {
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return {}
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    ran.length = 0
    const ui = await $.ui.mount({ plugin: 'manager', surface, component: 'AbovePrompt', props: props(false) })
    await ui.press({ key: 'compact' })
    expect(ran).toEqual(['compact'])
    await ui.unmount()
  }
})

test('Commit & push asks Claude to commit and push', async ($, on) => {
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })

  const ui = await $.ui.mount({ plugin: 'manager', surface: 'terminal', component: 'AbovePrompt', props: props(false) })
  await ui.press({ key: 'commit' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('push')
  await ui.unmount()
})

test('Clear + handoff runs the handoff skill and shows progress', async ($, on) => {
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return {}
  })

  const ui = await $.ui.mount({ plugin: 'manager', surface: 'terminal', component: 'AbovePrompt', props: props(false) })
  await ui.press({ key: 'handoff' })
  expect(ran).toEqual(['mattpocock-skills:handoff'])
  expect(await ui.find({ type: 'Text', text: /Writing handoff/ })).toBeDefined()
  await ui.unmount()
})

test('buttons do nothing while a turn runs', async ($, on) => {
  const ran: string[] = []
  on('command.run', ($, e) => {
    ran.push(e.command)
    return {}
  })
  on('prompt.submit', ($, e) => {
    ran.push(e.text)
    return { text: e.text }
  })

  const ui = await $.ui.mount({ plugin: 'manager', surface: 'terminal', component: 'AbovePrompt', props: props(true) })
  await ui.press({ key: 'compact' })
  await ui.press({ key: 'commit' })
  await ui.press({ key: 'handoff' })
  expect(ran).toEqual([])
  await ui.unmount()
})
