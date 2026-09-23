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
- Resizable panes: the rail and the thread list can be dragged wider or narrower on desktop. Rail 160 to 320, list 280 to 640, and the reading pane never drops below 320, so the list gives way first when the window is narrow. Widths are remembered per browser. The collapsed icon rail and the phone layout do not resize.
- Phone: single pane, list then thread, back via a sticky header. Touch targets 44px. Keyboard hints are hidden, since there is no keyboard; search opens from a `search` button in the list header.
- Home-screen icon: a `>_` prompt in `--accent` on `--bg`, square, with the prompt inside the maskable safe zone.
- Command palette: centered, 640px max, top-aligned at 15vh so results grow downward.
- Status line: a 24px bar at the bottom of the window, terminal-style, showing sync state, account, and the active keyboard hint. This is where "what to do next" lives.
- Compose: a panel docked bottom-right over the reading pane, 640px wide, at most 70vh tall, sitting just above the status line with a 16px right gap. No backdrop, so the thread stays readable above it. Phone: a full-screen sheet.

## Components

- Button
  - Primary: `--accent` background, `--bg` text, 500 weight. One per view.
  - Secondary: transparent, `--border` border, `--text`. Most actions.
  - Ghost: no border, `--text-muted`, text turns `--text` on hover. Toolbar and inline actions.
  - Destructive: transparent with `--danger` text and border. Fills `--danger` only on hover.
  - All buttons show their keyboard shortcut as a keycap after the label, e.g. `archive [e]`. On the primary button the keycap flips to the accent variant so it keeps contrast on the fill.
- Keycap: every shortcut shown anywhere (buttons, list header, palette rows, key map, status line) is a keycap, never plain text. 11px, 2px radius, hairline `--border`, `--surface-raised` background, `--text-muted` text, at least 16px square (`h-key`, `min-w-key`) so single letters are square and words like `enter` grow sideways. Vertically centered with the label it sits next to. Multi-key shortcuts are adjacent keycaps: combos like `mod k` 2px apart, sequences like `g i` 4px apart. Key names are lowercase and short: `mod`, `enter`, `esc`. On the `--accent` fill: transparent background, `--bg` text, `--bg` border at 40%. Hidden below `md` like every keyboard hint.
- Thread row: account bar, sender at 500 if unseen, subject, snippet in `--text-muted`, time right-aligned in tabular 11px. Seen rows drop to 400 and `--text-dim` subject.
- Badge: 11px, 2px radius, `--surface-raised` background, `--text-muted` text. Bucket badges use `--accent-dim` with `--accent` text. AI suggestions use `--info`.
- Inline AI note: a single line above a thread in `--info`, prefixed with `>>`, e.g. `>> new sender, let in by AI. undo?`. Never a card, never a modal.
- Input: `--surface` background, `--border` border, 2px radius, `--accent` border on focus.
- Command palette: `--surface-top`, hairline border, backdrop darkens the app to 60%, results as rows, matched text in `--accent`, action rows show a `--info` preview count when they would touch more than one thread.
- Status line: `--surface`, 11px, `--text-muted`, sync state at left, keyboard hint at right.
- Pane handle: the hairline border between two panes is the handle. An invisible 8px hit area centered on it, `col-resize` cursor. The hairline turns `--accent-dim` on hover and keyboard focus, `--accent` while dragging, over 80ms. Double-click resets the pane to its default width. Focusable as a separator: left and right arrows resize by 8px, 32px with shift, home and end jump to the limits.
- Compose: `--surface-top`, hairline border, 4px radius. Header row names the mode and account (`reply  work1`), fields are label-left rows (`to`, `cc`, `subject`) on hairlines, the toolbar is ghost buttons in 11px, the body is 13px at prose line height and at least 160px tall. Signature and quoted text show as one dim line each, never inline. Footer: primary `send  mod+enter`, ghost `discard`, errors in `--danger` on the same row. Body headings: h1 20, h2 15, h3 13, all 600. Links in the body are `--text` underlined, not accent.

## Voice

- Tone: terse operator. Labels are lowercase verbs: `archive`, `snooze`, `let in`, `keep out`. Counts precede nouns: `3 unseen`.
- No exclamation marks, no "Great!", no confirmations of success beyond the status line. Errors say what failed and what to do: `sync failed for work2, retry`.
- Empty states are one line: `inbox clear`. Nothing else.

## In code

Tokens live in `app/globals.css`: raw values as CSS variables on `:root` with the names above, exposed to Tailwind under `@theme`. Tailwind's default palette, type scale, radii, shadows, and easings are reset, so only these utilities exist:

- Color: `bg-bg`, `bg-surface`, `bg-surface-raised`, `bg-surface-top`, `border-border`, `text-text`, `text-text-muted`, `text-text-dim`, `*-accent`, `*-accent-dim`, `*-info`, `*-warning`, `*-danger`, `*-success`. shadcn names (`primary`, `muted`, `popover`, `destructive`, `ring`) alias these; `accent` keeps its meaning here.
- Type: `text-11` `text-12` `text-13` `text-15` `text-20`, `font-normal` `font-medium` `font-semibold`, `leading-list` `leading-prose`. One family, `font-mono`.
- Space: the default 4px scale (`p-1` 4, `p-2` 8, `p-3` 12, `p-4` 16, `p-6` 24, `p-8` 32). Layout sizes: `h-row` 32, `h-touch` 44, `h-status` 24, `h-key` / `min-w-key` 16 (keycaps), `w-rail` 200, `w-list` 360 (both follow the dragged width, clamped: `--rail-w` 160 to 320, `--list-w` 280 to 640), `min-w-list-min` 280, `min-w-reading` 320, `max-w-palette` 640, `pt-palette-top` 15vh (palette and other overlays), `w-compose` 640, `max-h-compose-h` 70vh, `w-rail-icons` 48 (rail below 1100), `w-sender` 112 (sender column in rows), `w-label` 56 (label column in forms), `w-field` 160 (short inputs), `min-h-editor` 160 (compose body).
- Shape: `rounded-sm` 2px, `rounded-md` 4px.
- Motion: `duration-80`, `duration-150`, `ease-snap`. Reduced motion zeroes all durations globally.
- Gradients: `glow-focus`, `pane-depth`, `status-rule`. The only three.
- Breakpoints: `md` 768, `rail` 1100. Below `md`, interactive rows and buttons are `h-touch`, and keyboard hints are hidden.
- Safe area: `pb-safe` (with `box-content`) on bottom bars, so the installed app clears the phone's home indicator.

Merge classes with `cn` from `lib/utils`, which knows this scale.
