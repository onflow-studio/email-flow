# Design System: superfer

Character: a cyberpunk terminal that grew up. Dense, monospaced, dark. Opening it should say "everything is under control, here is what's next." Control comes from hierarchy and stillness, not from decoration. Neon is a signal, never a wallpaper.

## Color

Dark only. Near-black with a cold blue-green cast, not pure black: pure black makes every panel edge vanish and reads as "unfinished," a tinted dark reads as a lit screen.

- `--bg` #0A0E12: page background, coldest and darkest layer
- `--surface` #10161C: panes, cards, list rows. One step up from bg so panes read as lit panels on a dark desk
- `--surface-raised` #161E26: hover row, popovers. Elevation is lightness, not shadow
- `--surface-top` #1C2630: command palette and modals. The brightest surface, so the palette pops hard against everything behind it
- `--border` #1F2A33: hairlines between panes and rows. Low contrast on purpose, structure should be felt not seen
- `--text` #D6E2EA: primary text, off-white with the same cold cast. Pure white on dark glows and tires the eye in dense lists
- `--text-muted` #7A8B98: metadata, timestamps, secondary lines. Passes contrast on surface while clearly stepping back
- `--text-dim` #4A5966: disabled, placeholder, seen-thread subjects
- `--accent` #39FF9E: signature phosphor green. Used only for the focused row indicator, primary action, and the "next thing" cue. If it appears in more than one place per view, it stops meaning "here"
- `--accent-dim` #1B5E44: accent at rest, e.g. bucket label tint, selected-but-unfocused state
- `--info` #4FC3F7: cold cyan for AI suggestions and screener notes. Distinct from accent so "the machine suggests" never looks like "you must act"
- `--warning` #FFB454: amber for snooze deadlines passed and low-confidence classifications
- `--danger` #FF5C7A: trash, spam, block sender. Semantic only
- `--success` #39FF9E: same as accent. Sent, synced, done. A second green would dilute the signal

Account identity uses hue, not a full palette: a 2px left bar per thread row, one hue per account, chosen at setup. Default set: #39FF9E personal, #4FC3F7 work1, #C792EA work2. Never used for anything else.

## Typography

- Family: `JetBrains Mono` for everything, UI and content chrome. One family is the TUI heritage, and monospace makes dense columns align without effort. Email bodies render in the sender's HTML inside the sandboxed iframe, untouched.
- Fallback: `ui-monospace, SFMono-Regular, Menlo, monospace`
- Scale: 11 / 12 / 13 / 15 / 20. Body and list rows at 13, which is the densest size still comfortable for an hour of triage. 11 for timestamps and badges. 20 only for the thread subject in the reading pane, the single place the eye should land.
- Weights: 400 regular, 500 for unseen threads and active items, 600 for the reading pane subject. Bold at 700 is never used, it smears in monospace at small sizes.
- Line height: 1.45 for lists, 1.6 for prose.
- Tabular numbers everywhere so counts and times align in columns.

## Spacing

- Base unit 4px; scale 4 / 8 / 12 / 16 / 24 / 32
- Rhythm: dense. List rows are 32px tall on desktop, 44px on touch. Tight within a group (4 or 8), one step wider between groups (16), pane padding 12. Vertical whitespace is spent only where the eye must reset: above the reading pane subject and around the command palette.

## Shape and elevation

- Radii: 2px on rows, badges, inputs. 4px on the command palette and popovers. Nothing larger, rounded corners soften and this interface is sharp.
- Separation language: hairline borders. No shadows. Elevation is a lighter surface plus a border. This is the terminal rule: every region is a box with an edge.
- Gradients are allowed as light, not as fill. Three sanctioned uses, nothing else:
  - Accent glow: the focused row's left bar bleeds a 24px horizontal gradient from `--accent` at 12% to transparent across the row. The row looks lit from the edge, like a phosphor trace.
  - Pane depth: the reading pane background runs a barely visible vertical gradient from `--surface` at top to `--bg` at bottom, so long threads feel like they recede rather than sit on a flat sheet.
  - Status line: a 1px top border that fades from `--accent-dim` at left to transparent, tying the "next action" bar to the accent.
  - Never on buttons, badges, or text. A gradient on a control makes it look like a 2010 app.
- Contrast is the other half of the character: hard edges between dark and lit. Unseen rows sit visibly brighter than seen ones, the reading pane is clearly a different layer from the list, and the palette is the brightest surface in the app when open. Mid-tones are avoided, things are either lit or dark.
- Focus: the focused row has a 2px `--accent` bar on its left edge and a `--surface-raised` background. No outline ring on rows, rings are for form inputs only.

## Motion

- Durations: 80ms for hover and focus changes, 150ms for pane transitions and palette open. Nothing slower, the app should feel like it was already there.
- Easing: `cubic-bezier(0.2, 0, 0, 1)`, fast start and clean stop.
- Undo toasts appear instantly and fade out over 150ms. No slide-ins.
- Reduced motion: honor `prefers-reduced-motion`, drop all transitions to 0ms.

## Layout

- Desktop: three panes. Left rail 200px with buckets and counts. Thread list 360px. Reading pane takes the rest. Rail collapses to icons below 1100px.
- Phone: single pane, list then thread, back via header. Touch targets 44px.
- Command palette: centered, 640px max, top-aligned at 15vh so results grow downward.
- Status line: a 24px bar at the bottom of the window, terminal-style, showing sync state, account, and the active keyboard hint. This is where "what to do next" lives.

## Components

- Button
  - Primary: `--accent` background, `--bg` text, 500 weight. One per view.
  - Secondary: transparent, `--border` border, `--text`. Most actions.
  - Ghost: no border, `--text-muted`, text turns `--text` on hover. Toolbar and inline actions.
  - Destructive: transparent with `--danger` text and border. Fills `--danger` only on hover.
  - All buttons show their keyboard shortcut as a dim suffix, e.g. `Archive  e`.
- Thread row: account bar, sender at 500 if unseen, subject, snippet in `--text-muted`, time right-aligned in tabular 11px. Seen rows drop to 400 and `--text-dim` subject.
- Badge: 11px, 2px radius, `--surface-raised` background, `--text-muted` text. Bucket badges use `--accent-dim` with `--accent` text. AI suggestions use `--info`.
- Inline AI note: a single line above a thread in `--info`, prefixed with `>>`, e.g. `>> new sender, let in by AI. undo?`. Never a card, never a modal.
- Input: `--surface` background, `--border` border, 2px radius, `--accent` border on focus.
- Command palette: `--surface-top`, hairline border, backdrop darkens the app to 60%, results as rows, matched text in `--accent`, action rows show a `--info` preview count when they would touch more than one thread.
- Status line: `--surface`, 11px, `--text-muted`, sync state at left, keyboard hint at right.

## Voice

- Tone: terse operator. Labels are lowercase verbs: `archive`, `snooze`, `let in`, `keep out`. Counts precede nouns: `3 unseen`.
- No exclamation marks, no "Great!", no confirmations of success beyond the status line. Errors say what failed and what to do: `sync failed for work2, retry`.
- Empty states are one line: `inbox clear`. Nothing else.
