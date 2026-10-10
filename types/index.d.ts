export type Phase = 'idle' | 'writing-handoff' | 'resuming'

/** The live context window: tokens and percent are absent until the window's first response. */
export type ContextFill = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    manager: { phase: Phase; contextFill: ContextFill | null }
  }
}
