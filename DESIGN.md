# Design System: superfer

Character: a cyberpunk terminal that grew up. Dense, monospaced, dark. Opening it should say "everything is under control, here is what's next." Control comes from hierarchy and stillness, not from decoration. Neon is a signal, never a wallpaper.

## Color

Dark only. Near-black with a cold blue-green cast, not pure black: pure black makes every panel edge vanish and reads as "unfinished," a tinted dark reads as a lit screen.

- `--bg` #0A0E12: page background, coldest and darkest layer
- `--surface` #10161C: panes, cards, list rows. One step up from bg so panes read as lit panels on a dark desk
- `--surface-raised` #161E26: hover row, popovers. Elevation is lightness, not shadow
- `--surface-top` #1C2630: command palette and modals. The brightest surface, so the palette pops hard against everything behind it
- `--header` #0E1A2A: the header bar. A deep, desaturated blue so the top edge frames the app in the accent's family without competing with it. Contrast: `--text` 13.3:1, `--accent` 5.3:1, `--text-muted` 5.0:1
- `--header-border` #1A2A40: the header's bottom hairline, `--border` shifted into the header's blue so the edge reads as part of the bar
- `--border` #1F2A33: hairlines between panes and rows. Low contrast on purpose, structure should be felt not seen
- `--text` #D6E2EA: primary text, off-white with the same cold cast. Pure white on dark glows and tires the eye in dense lists
- `--text-muted` #7A8B98: metadata, timestamps, secondary lines. Passes contrast on surface while clearly stepping back
- `--text-dim` #4A5966: disabled, placeholder, seen-thread subjects
- `--accent` #3D8BFF: signature electric blue. Used only for the focus edge, the primary action, and the "next thing" cue. If it appears in more than one place per view, it stops meaning "here". Contrast: 5.8:1 on `--bg`, 5.5 on `--surface`, 5.1 on `--surface-raised`, and `--bg` text on an `--accent` fill is 5.8:1
- `--accent-dim` #1C4480: accent at rest, e.g. bucket badge fill, selected-but-unfocused state, hairlines tied to the accent. Too dark to carry `--accent` text (2.9:1): text on it is `--text` (7.3:1)
- `--info` #4FD1C5: teal for AI suggestions and screener notes. Moved off cyan so it never reads as the blue accent: "the machine suggests" never looks like "you must act". 9.8:1 on `--surface`
- `--warning` #FFB454: amber for snooze deadlines passed, low-confidence classifications, and shortcut conflicts in settings
- `--danger` #FF5C7A: trash, spam, block sender. Semantic only
- `--success` #3D8BFF: same as accent. Sent, synced, done. A second blue would dilute the signal

Account identity uses hue, not a full palette: one hue per account, chosen at setup, shown as an 8px square (see Account square). Default set: `--account-personal` #39FF9E green, `--account-work1` #EDE95C yellow, `--account-work2` #C792EA violet. The set is picked so none reads as `--accent`, `--info`, `--warning` or `--danger` (closest pair: work1 to warning, ΔE 37). The settings picker offers exactly these three. Account hues are never used for anything else, and never as text.

## Typography

- Family: `JetBrains Mono` for everything, UI and content chrome. One family is the TUI heritage, and monospace makes dense columns align without effort. Designed email bodies (own backgrounds, layout tables, responsive CSS) render in the sender's HTML inside the sandboxed iframe, framed by a hairline. Plain and lightly formatted ones (people writing to people) render as native text in the same iframe: no frame, transparent on the pane, `--text` at 13px and prose line height in this family, bold at 600, links `--text` underlined, quotes with a `--border` rule and `--text-muted` text. Only the part above the quoted history decides which.
- Fallback: `ui-monospace, SFMono-Regular, Menlo, monospace`
- Scale: 11 / 12 / 13 / 15 / 20. Body and list rows at 13, which is the densest size still comfortable for an hour of triage. 11 for timestamps and badges. 20 only for the thread subject in the reading pane, the single place the eye should land.
- Weights: 400 regular, 500 for unseen threads and active items, 600 for the reading pane subject. Bold at 700 is never used, it smears in monospace at small sizes.
- Line height: 1.45 for lists, 1.6 for prose.
- Tabular numbers everywhere so counts and times align in columns.
- Case: lowercase everywhere. The one exception is command palette section headers, 11px uppercase, because they are the only labels that sit between rows of lowercase results and must not read as a result.

## Spacing

- Base unit 4px; scale 4 / 8 / 12 / 16 / 24 / 32
- Rhythm: dense. List rows are 32px tall on desktop, 44px on touch. Tight within a group (4 or 8), one step wider between groups (16), pane padding 12. Vertical whitespace is spent only where the eye must reset: above the reading pane subject and around the command palette.

## Shape and elevation

- Radii: 2px on rows, badges, inputs. 4px on the command palette and popovers. Nothing larger, rounded corners soften and this interface is sharp.
- Separation language: hairline borders. No shadows. Elevation is a lighter surface plus a border. This is the terminal rule: every region is a box with an edge.
- Gradients are allowed as light, not as fill. Four sanctioned uses, nothing else:
  - Accent glow: the focused row's left bar bleeds a 24px horizontal gradient from `--accent` at 12% to transparent across the row. The row looks lit from the edge, like a phosphor trace.
  - Pane depth: the reading pane background runs a barely visible vertical gradient from `--surface` at top to `--bg` at bottom, so long threads feel like they recede rather than sit on a flat sheet.
  - Status line: a 1px top border that fades from `--accent-dim` at left to transparent, tying the "next action" bar to the accent.
  - Radio live: while the radio plays, its 1px border becomes a gradient that drifts around the square: a linear gradient of `--accent` to transparent to `--accent`, rotating one full turn every 6s (`--duration-drift`), linear, infinite. It is the only looping animation in the app. Under `prefers-reduced-motion` it stops and becomes a static glow: solid 1px `--accent-dim` border plus the focus glow's light, a 12px `--accent` bleed at 12% around the square.
  - Never on buttons, badges, or text. A gradient on a control makes it look like a 2010 app.
- Contrast is the other half of the character: hard edges between dark and lit. Unseen rows sit visibly brighter than seen ones, the reading pane is clearly a different layer from the list, and the palette is the brightest surface in the app when open. Mid-tones are avoided, things are either lit or dark.
- Focus: the focused row has a 2px `--accent` bar on its left edge, a `--surface-raised` background and the accent glow. No outline ring on rows, rings are for form inputs only.
- The left edge belongs only to focus. Nothing else draws on a row's left edge: no account bar, no bucket tint, no unseen marker. Rows reserve the 2px (transparent at rest) so focus never shifts content. Account identity moved to the square before the sender.
- Radii exception: timeline nodes are circles. They are points on a line, not boxes.
- Pane focus (desktop): arrow keys act in one of three panes, rail, thread list, reading pane. The focused pane gets a 1px `--accent-dim` hairline along its top edge, drawn inset so nothing shifts. No ring. The rail's keyboard cursor looks like a focused row: 2px `--accent` bar, `--surface-raised`, accent glow. In the reading pane, the cursor follows the thread timeline rules (see Components). Phone has no pane focus.

## Motion

- Durations: 80ms for hover and focus changes, 150ms for pane transitions and palette open. Nothing slower, the app should feel like it was already there.
- Easing: `cubic-bezier(0.2, 0, 0, 1)`, fast start and clean stop.
- Toasts: a new toast rises from its own height into the front of the stack while fading in, 150ms. A dismissed one fades out over 150ms, drifting away from the stack. The deck expanding into a list on hover, and collapsing back, is a 150ms move of each card. A swipe-dismiss finishes in 150ms. All on `ease-snap`. Undo is `z` or `mod z`. A toast that can be undone stays 10s and counts down the seconds left at its right end, 11px `--text-muted` tabular (`9s`); every other toast stays 4s. Timers and the count hold while the stack is hovered or the tab is hidden. The count changes text once a second, it is not an animation.
- Reduced motion: honor `prefers-reduced-motion`, drop all transitions to 0ms. Toasts then appear, stack, expand and leave in place with no movement.
- One ambient loop: the radio's drifting border while it plays, 6s per turn. Nothing else animates on its own.

## Layout

- Desktop: a 44px header across the top, then three panes. Left rail 200px with buckets and counts. Thread list 360px. Reading pane takes the rest. Rail collapses to icons below 1100px. The status line runs across the bottom.
- Header: see Components. It spans the full window width above the panes, so the panes start 44px down.
- Rail groups: two groups separated by a 16px gap, no headings. `act on`: triage, inbox, snoozed. `later`: news, paper trail. The group names are for this document, not the UI. Pinned threads are not a view: they stay at the top of inbox (see Pin). Trash and settings sit at the bottom of the rail, pushed down by a flexible gap, in `--text-dim` (`--text-muted` on hover, `--text` with the focused-row treatment when the rail cursor is on them): trash first, with no count, settings under it. The rail no longer lists accounts, the header toggles replace that section. The collapsed icon rail keeps the same order and gap with icons only.
- Resizable panes: the rail and the thread list can be dragged wider or narrower on desktop. Rail 160 to 320, list 280 to 640, and the reading pane never drops below 320, so the list gives way first when the window is narrow. Widths are remembered per browser. The collapsed icon rail and the phone layout do not resize.
- Phone: single pane, list then thread, back via a sticky header. The app header is 44px on phone and shows on the list only (see Header). The header carries `back` at left and `delete` in `--danger` at right (the one delete that is red at rest, since touch has no hover) (`restore` in `--text-muted` for a trashed thread). Touch targets 44px. Keyboard hints are hidden, since there is no keyboard; search opens from a `search` button in the list header.
- Home-screen icon: a `>_` prompt in `--accent` on `--bg`, square, with the prompt inside the maskable safe zone.
- Command palette: centered, 640px max, top-aligned at 15vh so results grow downward. Phone: full width with 8px side gaps, top-aligned at 8px.
- Action bar: floats at the bottom of the reading pane, centered in it, 16px above the pane's bottom edge. The reading pane scroll area gets 72px bottom padding (`pb-action`) so the last message can scroll clear of it. It must keep 64px clear of the pane's right edge so it never meets the radio; when it does not fit, secondary actions move into `more` from right to left.
- Status line: a 24px bar at the bottom of the window, terminal-style, showing sync state, account, and the active keyboard hint. This is where "what to do next" lives.
- Compose: a panel docked bottom-right over the reading pane, 640px wide, at most 70vh tall, sitting just above the status line with a 16px right gap. No backdrop, so the thread stays readable above it. Phone: a full-screen sheet.
- Settings: a 44px tab bar across the top, `--surface` with a bottom hairline, `px-3`: at the left edge the path `>_ superfer / settings` (13px 500, `>_` in `--accent`, `superfer` in `--text-muted` and `--text` on hover, a `--text-dim` `/`, `settings` in `--text`) so the page says where you are; `>_ superfer` is a link back to the mail, same place esc goes, the tabs `accounts`, `rules`, `keyboard` centred in the window, and `back [esc]` floating at the right edge, out of the tabs' centring. Below it the section in a `max-w-palette` column with the mail pane padding, then the status line. Each tab has its own route and `/settings` opens accounts. Phone: the same bar with the tabs at the left and `back` at the right, the path hidden (the tabs say it), no separate list screen.
- Radio: a square play button floating bottom-right on every page, 16px from the right edge like compose, 72px from the bottom plus the safe area, so it never touches the status line or the phone action bar. It sits below compose and every overlay, so an open compose simply covers it.
- Toast stack: bottom-right, sharing the radio's 16px right edge, its bottom 8px above the radio: 112px up on desktop (72 + 32 + 8), 124px on touch (72 + 44 + 8), plus the safe area. The radio stays put and the stack grows upward from above it, so the two never meet, and the stack is far above the action bar (which tops out 80px up). Over an open compose the stack draws on top. Phone: the same bottom offset, full width with 8px side gaps.

## Components

- Button: a label segment and, when the action has a shortcut, a shortcut segment attached on its right. One box, one 2px radius on the outer corners, one hit area.
  - Label segment: `px-3`, 13px, height `h-row` (32) or `h-touch` (44) on phone.
  - Shortcut segment: full button height, `px-2`, at least `min-w-key` wide, the keys in 11px `--text-muted` centered, its own `--surface-raised` background, split from the label by a 1px `--border` hairline. Multi-key shortcuts sit in one segment: combos (`mod k`) 4px apart, sequences (`g i`) 8px apart. Wider than keycaps because the keys are bare text, with no box edges to tell them apart. The segment is part of the button: hovering or pressing either half affects both.
  - Secondary (default): transparent label, `--border` border, `--text`. Hover: label `--surface-raised`, segment `--surface-top`, segment text `--text`.
  - Ghost: no border at rest, `--text-muted` label, segment as above. Hover: label text `--text`, border `--border`. Toolbar and inline actions.
  - Primary: accent-filled for the one primary action per view. Label `--accent` fill, `--bg` text, 500. Segment `--accent-dim` fill, `--text` keys, hairline `--bg` at 40%. Hover: label brightens to `--accent` mixed 88% with `--text`.
  - Delete: neutral at rest, styled as secondary (or ghost where its neighbours are ghost). Hover and keyboard focus: label text, border and segment keys turn `--danger`. Never filled.
  - Focus-visible: border `--accent` around the whole box, segment included.
  - Disabled: label and keys `--text-dim`, no hover.
  - Phone: no shortcut segment (keyboard hints are hidden below `md`), the label keeps its full width.
  - Anything clickable that has a shortcut uses the attached segment. Non-clickable hints (palette rows, status line, key map, list header hints) keep standalone keycaps.
- Keycap: every shortcut shown anywhere is a keycap or a button's shortcut segment, never plain text. Standalone keycaps are for non-clickable hints. 11px, 2px radius, hairline `--border`, `--surface-raised` background, `--text-muted` text, at least 16px square (`h-key`, `min-w-key`) so single letters are square and words like `enter` grow sideways. Vertically centered with the label it sits next to. Multi-key shortcuts are adjacent keycaps: combos like `mod k` 2px apart, sequences like `g i` 4px apart. Key names are lowercase and short: `mod`, `enter`, `esc`. On the `--accent` fill: transparent background, `--bg` text, `--bg` border at 40%. Hidden below `md` like every keyboard hint.
- Action bar: replaces the inline thread toolbar. A floating strip at the bottom of the reading pane (position in Layout), `--surface-top`, hairline border, 4px radius, 4px padding, buttons 4px apart.
  - Large actions: label 13px, height 32. The first is the view's primary (accent-filled), the others secondary.
  - A 1px `--border` vertical hairline, 16px tall, 4px margin each side, separates large from small.
  - Small actions: label 12px, height 24 (`h-6`), `px-2`, shortcut segment 11px, ghost. `delete [#]` uses the delete style and is always the last small action. A trashed thread shows `restore` in delete's place.
  - `more`: a ghost 24px button with a `…` label, always last. Holds every action of the view not shown on the bar.
  - Per view (large, then small, then `more`). Conditional actions appear only when they apply: `unsubscribe [u]` with a List-Unsubscribe header, `unsnooze` when snoozed, `unpin` instead of `pin [h]` when pinned.
    - inbox: `reply [r]` (primary), `archive [e]`, `snooze [s]` / `pin [h]`, `delete [#]` / `reply all [a]`, `forward [f]`, `unsubscribe [u]`, `mark unread [U]`, `mark spam [!]`.
    - triage: `let in [i]` (primary), `keep out [x]` / `archive [e]`, `unsubscribe [u]`, `delete [#]` / `snooze [s]`, `pin [h]`, `reply [r]`, `reply all [a]`, `forward [f]`, `mark unread [U]`, `mark spam [!]`.
    - news and paper trail: `archive [e]` (primary) / `unsubscribe [u]`, `move to`, `delete [#]` / `reply [r]`, `reply all [a]`, `forward [f]`, `snooze [s]`, `pin [h]`, `mark unread [U]`, `mark spam [!]`. `move to` opens a menu (same styling as `more`) listing the other bucket views, inbox, news, paper trail, triage, minus the current one.
    - snoozed: `reply [r]` (primary), `archive [e]`, `snooze [s]` (reschedule) / `unsnooze`, `delete [#]` / `reply all [a]`, `forward [f]`, `pin [h]`, `unsubscribe [u]`, `mark unread [U]`, `mark spam [!]`.
    - trash: `restore` (primary) / nothing / `reply [r]`, `forward [f]`, `mark spam [!]`.
  - The `more` and `move to` menus open 8px above the bar, right-aligned to their button, styled like the station list (`--surface-top`, hairline, 4px radius, rows 32, focused-row treatment on the row under the mouse or arrow keys), keycaps standalone and right-aligned. Esc or an outside press closes them and returns focus to the button.
  - Every action runs at once with an undo toast, like archive. Toasts always use the stack above the radio (see Layout), never the bar.
  - Phone: the bar docks to the bottom of the thread view, full width, `--surface-top` with a top hairline, no radius, `pb-safe`. Buttons are 44px tall; the large actions keep their place and labels, everything else goes into `more`, which opens as a sheet of 44px rows from the bottom. Delete stays in the sticky header.
- Toast: one card per notice in the toast stack (position in Layout). Built on sonner, with our own card.
  - Card: `--surface-top`, hairline `--border`, 4px radius, 360px wide (`--toast-w`, full width less 8px gaps on phone), `px-3 py-2`, 8px between parts. Message 13px `--text`, one line, truncated. No shadow, no close button.
  - Types, told apart by a 12px icon before the message, never by fill: default (no icon), success (check in `--success`), error (cross in `--danger`), warning (triangle in `--warning`). Error: something failed, with what to do (`archive failed, retry`). Warning: nothing broke, but nothing happened either (`nothing to undo`, `no unsubscribe link`). Success: a sent message, a finished undo.
  - Undo toast: the action's result line, then a secondary small `undo` button (`h-6`) and the countdown. Only the newest undo toast, the one `z` undoes, carries the `z` shortcut segment; older ones show the bare button. Undoing (button or key) dismisses that toast at once.
  - Stack: newest in front. Collapsed it is a deck: up to 3 cards, each older one 8px further up and 5% smaller, its content hidden, so only the edges peek. Hovering the stack expands it into a list, cards 8px apart; leaving collapses it. Older than the third fade out of the deck.
  - Phone: full width at the bottom, swipe right or down to dismiss. No keyboard hints.
- Pin: an action, not a view (`pin [h]`, `unpin`). Pinned threads stay at the top of inbox above the time-ordered rows, with a `pinned` badge before the time. There is no pinned rail item or palette view.
- Thread row: 2px reserved left edge (focus only), 8px `--account-*` square, sender at 500 if unseen, subject, snippet in `--text-muted`, time right-aligned in tabular 11px. Seen rows drop to 400 and `--text-dim` subject.
- Account square: 8px (`size-2`), square corners, filled with the account hue, vertically centered, 8px before the text it labels. Used in thread rows (before the sender), the reading pane meta line, the status line, header toggles, palette account rows and settings. Unfocused, unselected rows still show it: it is identity, not state. The one variant: a toggled-off account in the header or palette shows the square hollow, a 1px ring in the hue on transparent.
- Badge: 11px, 2px radius, `--surface-raised` background, `--text-muted` text. Bucket badges use `--accent-dim` fill with `--text` text. AI suggestions use `--info`.
- Inline AI note: right-aligned above a thread's subject in `--info`, prefixed with `>>`, e.g. `>> new sender, let in by AI`. When it asks for a decision, a second 12px line holds the answers as underlined `--info` links 12px apart: `✓ ok` (keeps the AI's call as the user's own, so the note stops showing for that sender) and `undo`. Both go through the undo toast. Never a card, never a modal.
- Input: `--surface` background, `--border` border, 2px radius, `--accent` border on focus.
- Checkbox: 16px square (`size-4`), 2px radius. Off: `--bg` fill with a `--text-muted` border (a `--border` hairline disappears on raised surfaces), `--text` border on hover. On: `--accent` fill and border with a 12px check in `--bg`. Keyboard focus: `--accent` border. The label beside it is `--text-muted` off, `--text` on.
- Command palette: `--surface-top`, hairline border, 4px radius, backdrop darkens the app to 60%.
  - Input row: 44px, `px-3`. A `>` prompt in `--accent` 13px, 8px gap, then the input with no border or background, 13px `--text`, placeholder `--text-dim`. A standalone `esc` keycap right-aligned. A hairline under the row.
  - Sections, empty ones hidden. Empty input: views, actions, accounts, app. With a query: threads first, then the views, actions, accounts and app entries that match. Each section opens with a header row: 11px uppercase `--text-muted`, `px-3`, 12px above and 4px below, the name followed by an 8px gap and a 1px `--border` hairline filling the rest of the row, then the section's result count in 11px `--text-dim` tabular after the hairline.
  - Rows: 32px (44 on phone), `px-3`, label 13px `--text`, matched text in `--accent`. Right side: a count in 11px `--text-muted` tabular where one applies, then standalone keycaps.
  - Views: in rail order, triage, inbox, snoozed, news, paper trail, then trash last in `--text-dim` with no count. Each view row shows its unseen count and its `g` sequence keycaps where it has one (`g i`).
  - Actions: on empty input, the common ones, `compose [c]` and `toggle radio`. With a query, every action that matches. Action rows show an `--info` preview count when they would touch more than one thread.
  - Accounts: one row per account, leading with the account square and the email in `--text-dim`. Choosing a row toggles that account exactly like the header toggle, and the palette stays open. A toggled-off row is dimmed: label `--text-dim`, hollow square. The last account that is on cannot be turned off; its row does nothing.
  - App: `settings`.
  - Focused row: the palette's treatment, 2px `--accent` left bar, `--surface-raised`, accent glow. First result focused on open and after each keystroke.
  - Footer: 32px, top hairline, `px-3`. Left: search operator chips `from:`, `account:`, `before:`, `after:`, 4px apart, each 24px tall, `px-2`, 11px, 2px radius, hairline `--border`, `--text-muted`, hover `--text`. No active state. Clicking a chip inserts its text into the input at the cursor (with a space before it when the cursor follows text), refocuses the input and leaves the caret after the colon. Right: standalone hints `↑↓ move`, `enter open`.
  - Phone: rows and the input row 44px, keycaps and footer hints hidden, chips stay and wrap.
- Status line: `--surface`, 11px, `--text-muted`, sync state at left, the accounts that are on (`all accounts` when all are), keyboard hint at right.
- Pane handle: the hairline border between two panes is the handle. An invisible 8px hit area centered on it, `col-resize` cursor. The hairline turns `--accent-dim` on hover and keyboard focus, `--accent` while dragging, over 80ms. Double-click resets the pane to its default width. Focusable as a separator: left and right arrows resize by 8px, 32px with shift, home and end jump to the limits.
- Header: 44px (`h-header`) bar, `--header` fill, bottom hairline in `--header-border`, `px-3`, two zones on one row, vertically centred, pushed to the edges.
  - Left: the logo, `>_` in `--accent` then `superfer` in `--text`, 13px 500, 8px apart. Links to inbox.
  - Right: account toggles, one per account, multi-select. 12px, 8px apart, each 24px tall with `px-2`, the account square then the label. All accounts are on by default. On: label `--text`, filled square. Off: label `--text-dim`, hollow square. Hover: label `--text-muted` when off, `--text` stays when on. Clicking toggles that account on or off independently; the last account that is on cannot be turned off (the click does nothing). There is no `all` toggle: all on is all. The state persists across reloads. A toggled-off account's threads are hidden from every view, list, count and palette result, as if it were not connected. Hidden when only one account exists.
  - Phone: 44px, list screen only (the thread screen keeps its sticky back header). Left the `>_` mark alone, right a `search` ghost button (the phone's way into the palette) then one 44px toggle per account showing only its square, filled when on, hollow when off. The list header's own search button goes away.
- Thread timeline: the reading pane layout for threads with two or more messages.
  - Column: a 24px (`w-timeline`) gutter on the left of the message stack. A 1px `--border` line runs down its centre from the first node to the last.
  - Nodes: one per message, centered on the line and on its row's first text line. Collapsed: 7px circle, 1px `--text-dim` ring, `--bg` fill. Under the keyboard cursor or hover: ring `--text-muted`. Open: 11px circle, 1px `--accent` ring, 5px `--accent` dot inside, the accent glow's light as a 12px bleed at 12% around it.
  - Accent on the line: only the segment beside the open message, from its node to the bottom of its card, is `--accent`. Everything else on the line is `--border`.
  - Collapsed message: a flat one-line row, no fill, no border, `h-row` (44 on phone), `px-3`. Sender in `--text`, 400, `w-sender`, truncated. Snippet in `--text-muted`, flex, truncated. Time right-aligned, 11px `--text-muted` tabular. Hover `--surface-raised`. Clicking or `enter` on the cursor row opens it.
  - Open message: the only raised surface in the pane, `--surface-raised` fill, no border, 2px radius, 16px padding, 8px above and below. Header line: sender name in `--text` 500, address in `--text-muted` 12px, date right-aligned 12px `--text-muted` tabular. Recipient line under it, 11px `--text-muted` (`to …, cc …`). Then the body frame. Exactly one message is open: opening another collapses the previous one. The newest message is open by default, or the oldest unseen one.
  - Earlier fold: when more than two collapsed messages sit above the open one, the two directly above it stay and all older ones fold into one row, `N earlier messages`, in 12px `--text-muted`, same height, padding and hover as a collapsed row, with a collapsed node on the line. Clicking it or `enter` on it expands the folded messages in place as collapsed rows.
  - Quoted text: folded into one line under the body, `h-6`, full width of the body, hairline `--border`, 2px radius, 12px `--text-muted` centered, e.g. `··· quoted text from beatriz gámez, 09:45`. Hover `--text`. Click expands it in place; the line then reads `hide quoted text`.
  - The keyboard cursor in the reading pane moves over messages (collapsed and open alike); the cursor row gets `--surface-raised` and its node the cursor ring. No accent on the cursor.
  - Single message: no timeline. No gutter, line or node, and no raised card: header line, recipients and body sit directly on the pane, aligned with the subject.
  - Phone: gutter 16px (`w-4`), collapsed rows 44px, time stays, the address in the header line is hidden.
- Radio: 32px square (44 on touch), `--surface-raised`, hairline border, 2px radius, `--text-muted` icon, `--text` on hover and while playing. The icon is never accent. While playing, the border becomes the radio live gradient (see Shape); paused or stopped it returns to the hairline at once. Buffering pulses the icon to `--text-dim`, a failed load shows the retry icon in `--danger`. Nothing loads from YouTube until the first play. The player is a 200px iframe (YouTube's smallest playable size) clipped inside a 1px invisible box, never `display: none`, which stops playback.
- Station list: hovering the radio, focusing it from the keyboard, or tapping it on touch opens a list of stations 8px above the button, right-aligned to it. Palette styling: `--surface-top`, hairline border, 4px radius, rows 32px (44 on touch) with the palette's focused-row treatment (2px `--accent` bar, `--surface-raised`, accent glow) under the mouse or arrow keys. The tuned station reads in `--text` with a trailing 11px `tuned` in `--text-muted`, the rest in `--text-muted`. The 8px gap is padding inside the hover area and closing waits 150ms, so crossing from button to list never closes it. Esc, an outside press, or tabbing away closes it. On touch the first tap opens the list and the next plays or pauses.
- Settings tabs: 13px labels, `px-3`, full bar height, a 2px bottom edge reserved so nothing shifts. Inactive: `--text-muted`, `--text` on hover. The open tab: `--text` with a 2px `--accent-dim` bottom edge and 500 weight; while the tabs have keyboard focus the open tab's edge turns `--accent`. Left and right switch tab at once, down moves into the section, up from the section's first control returns to the tabs, esc leaves settings.
- Shortcut rows (settings, keyboard): grouped like the key map, each group headed 11px `--text-dim` lowercase with 16px between groups. A row is `h-row` with the rail's row treatment: label in `--text`, then, when changed, `default` in 11px `--text-dim` and the default keycaps (`none` when there was none), then the current keycaps right-aligned, alternatives split by a `--text-dim` `/`, `none` in 11px `--text-dim` when unbound. A `reset` ghost small button follows changed rows; unchanged rows keep its space empty so keycaps align. Fixed keys (esc, enter, arrows, `mod enter`, `mod z`) show as keycaps with a trailing 11px `fixed` in `--text-dim`, and a row made only of fixed keys is not clickable. Keyboard focus and hover use the focused-row treatment.
  - Recording: clicking a row or `enter` on it records. The row keeps the focused-row treatment, the current keycaps are replaced by what has been typed so far and a trailing 11px `recording` in `--accent`, the one accent in the section. A 12px `--text-muted` line under the row shows hints `esc cancel`, `backspace clear`. A second key within 1s makes a sequence; otherwise the single key is kept.
  - Conflict: a line under the row, 12px, `--warning` text naming the key and the action holding it (`y is taken by archive`), then `swap` secondary small and `cancel` ghost small, 4px apart. Swapping gives the other action this row's previous keys. When several actions hold it, or the key is reserved (`enter is reserved`), only the message shows, in `--warning`, until the next key.
  - Header: the section title with `reset all` ghost small at right, disabled when nothing is changed.
- Compose: `--surface-top`, hairline border, 4px radius. Header row names the mode and account (`reply  work1`), fields are label-left rows (`to`, `cc`, `subject`) on hairlines, the toolbar is ghost buttons in 11px, the body is 13px at prose line height and at least 160px tall. Signature and quoted text show as one dim line each, never inline. Footer: primary `send  mod+enter`, ghost `discard`, errors in `--danger` on the same row. Body headings: h1 20, h2 15, h3 13, all 600. Links in the body are `--text` underlined, not accent.

## Voice

- Tone: terse operator. Labels are lowercase verbs: `archive`, `snooze`, `let in`, `keep out`. Counts precede nouns: `3 unseen`.
- No exclamation marks, no "Great!", no confirmations of success beyond the status line. Errors say what failed and what to do: `sync failed for work2, retry`.
- Empty states are one line: `inbox clear`. Nothing else.

## In code

Tokens live in `app/globals.css`: raw values as CSS variables on `:root` with the names above, exposed to Tailwind under `@theme`. Tailwind's default palette, type scale, radii, shadows, and easings are reset, so only these utilities exist:

- Account hues: `--account-personal`, `--account-work1`, `--account-work2` hold the defaults; rows read the stored per-account hex from the database, which settings keeps to this set.
- Color: `bg-bg`, `bg-surface`, `bg-surface-raised`, `bg-surface-top`, `bg-header`, `border-border`, `border-header-border`, `text-text`, `text-text-muted`, `text-text-dim`, `*-accent`, `*-accent-dim`, `*-accent-hover` (primary button hover, `--accent` mixed 88% with `--text`), `*-info`, `*-warning`, `*-danger`, `*-success`. shadcn names (`primary`, `muted`, `popover`, `destructive`, `ring`) alias these; `accent` keeps its meaning here.
- Type: `text-11` `text-12` `text-13` `text-15` `text-20`, `font-normal` `font-medium` `font-semibold`, `leading-list` `leading-prose`. One family, `font-mono`.
- Space: the default 4px scale (`p-1` 4, `p-2` 8, `p-3` 12, `p-4` 16, `p-6` 24, `p-8` 32). Layout sizes: `h-row` 32, `h-touch` 44, `h-status` 24, `h-key` / `min-w-key` 16 (keycaps), `w-rail` 200, `w-list` 360 (both follow the dragged width, clamped: `--rail-w` 160 to 320, `--list-w` 280 to 640), `min-w-list-min` 280, `min-w-reading` 320, `max-w-palette` 640, `pt-palette-top` 15vh (palette and other overlays), `w-compose` 640, `max-h-compose-h` 70vh, `w-rail-icons` 48 (rail below 1100), `w-sender` 112 (sender column in rows), `w-label` 56 (label column in forms), `w-field` 160 (short inputs), `min-h-editor` 160 (compose body), `bottom-radio` 72 plus the safe area (radio button), `h-header` 44 (header), `w-timeline` 24 (timeline gutter), `pb-action` 72 (reading pane clearance for the action bar), `--toast-w` 360 (toast card), `--toast-bottom` 112 and `--toast-bottom-touch` 124 plus the safe area (toast stack).
- Layers: `z-30` radio, `z-40` compose and the toast stack (drawn after compose, so on top of it), `z-50` palette and modals.
- Toasts: `components/ui/toast.tsx` holds the card and the sonner `Toaster`; sonner's own sheet is overridden in `app/globals.css` for position, width, font and motion.
- Shape: `rounded-sm` 2px, `rounded-md` 4px.
- Motion: `duration-80`, `duration-150`, `ease-snap`, and `--duration-drift` 6s for the radio loop only. Reduced motion zeroes all durations globally.
- Gradients: `glow-focus`, `pane-depth`, `status-rule`, `radio-live`. The only four. `radio-live` uses `--duration-drift`. `glow-bleed` is the focus glow's light around a point, the 12px `--accent` bleed at 12% (open timeline node, the radio's reduced-motion glow); it is light, not a shadow.
- Pane focus: `pane-focus`, the inset top hairline, applied with `md:`.
- Breakpoints: `md` 768, `rail` 1100. Below `md`, interactive rows and buttons are `h-touch`, and keyboard hints are hidden.
- Safe area: `pb-safe` (with `box-content`) on bottom bars, so the installed app clears the phone's home indicator.

Merge classes with `cn` from `lib/utils`, which knows this scale.
