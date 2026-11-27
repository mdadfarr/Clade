# Clade redesign v2: design spec

This replaces the earlier glass spec. **No liquid glass anywhere.** No glows. Flat, warm, Anthropic-style.

Source: Figma file "Clade — 3 design directions", frame "E — Ivory" (node 6:2).
Reference window: **1440 × 900**. All px values are at that size.

Two themes, one layout:

- **Ivory** (light). Taken exactly from the Figma frame E. Default.
- **Dark**. Must look exactly like the dark mode of the official Claude app (same layout as Ivory, Claude-app colors).

---

## 1. Tokens

### Ivory (exact, from Figma)

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#F7F6F1` | chat area background |
| `--sidebar-bg` | `#EFEDE6` | sidebar background |
| `--text-1` | `#1F1E1C` | primary text |
| `--text-2` | `#5F5E58` | secondary text, inactive chat rows |
| `--text-3` | `#97958C` | muted: "Recent", "Share", placeholder, model name |
| `--accent` | `#D97757` | "+", send button, avatar |
| `--on-accent` | `#FFFFFF` | text on accent |
| `--row-active` | `#E4E1D6` | active chat row |
| `--row-new` | `#E6E3D9` | "New chat" row |
| `--row-hover` | `#E4E1D6` at 60% | hovered chat row (not in Figma; derived) |
| `--user-bubble` | `#ECE9E0` | user message bubble |
| `--code-bg` | `#EFEDE6` | code block fill |
| `--border` | `#E3E0D6` | code block border, input border |
| `--input-bg` | `#FFFFFF` | input box |
| `--input-shadow` | Figma DROP_SHADOW, soft: use `0 4px 20px rgba(0,0,0,.06)` | input box |

### Dark (Claude app dark mode)

These are close approximations of the Claude app. **Do not trust them blindly.** If the user gives a screenshot of the Claude app in dark mode, sample the real colors from it and use those instead. Keep the same token names.

| Token | Approx. value |
|---|---|
| `--bg` | `#262624` |
| `--sidebar-bg` | `#1F1E1D` |
| `--text-1` | `#FAF9F5` |
| `--text-2` | `#C2C0B6` |
| `--text-3` | `#8F8D85` |
| `--accent` | `#D97757` |
| `--on-accent` | `#FFFFFF` |
| `--row-active` | `#30302E` |
| `--row-new` | `#2B2A28` |
| `--row-hover` | `#30302E` at 60% |
| `--user-bubble` | `#141413` |
| `--code-bg` | `#1F1E1D` |
| `--border` | `rgba(222,220,209,.15)` |
| `--input-bg` | `#30302E` |
| `--input-shadow` | `0 4px 20px rgba(0,0,0,.25)` |

The accent stays user-selectable (the 9 accent presets keep working). `#D97757` is only the default.
Keep one red for Deny buttons and errors. That is the only extra color.

### Fonts (same in both themes)

| Use | Font |
|---|---|
| UI: sidebar, user messages, labels, input, header | Geist 14 (user messages 15) |
| Claude's replies | **Source Serif 4** Regular 17, line-height 165% |
| Logo "Clade" | Source Serif 4 Medium 22, line-height 120% |
| Code | Geist Mono Regular 13 |

Default line-height is 155% unless stated. Only weights 400, 500 and 600 are used.

### Radius

| Element | Radius |
|---|---|
| "New chat" row | 10 |
| Chat row | 8 |
| User bubble | 16 |
| Code block | 10 |
| Input box | 20 |
| Send button | 10 |
| Avatar | full circle (28 px) |

---

## 2. Layout (from Figma)

### Sidebar: width 272, fill `--sidebar-bg`, no border

- Padding: top 20, bottom 20, left/right 16. Item gap 2.
- **Logo**: "Clade", padding-left 8. Then 20px space.
- **New chat row**: height 42, padding 10 / 12, gap 10, fill `--row-new`, radius 10. "+" in `--accent` (Geist Medium 16), "New chat" in `--text-1` (Geist Medium 14). Then 20px space.
- **"Recent"** label: Geist Medium 12, `--text-3`, padding-left 12, padding-bottom 6.
- **Chat rows**: height 38, padding 8 / 12, radius 8, Geist Regular 14, full width.
  - Active chat: fill `--row-active`, text `--text-1`.
  - Hovered chat: fill `--row-hover`, text `--text-1`.
  - Others: no fill, text `--text-2`.
- **Footer** (pinned to bottom): 28px circle `--accent` with initial "M" (Geist Medium 12, white), then name (Geist 14, `--text-2`). Gap 10, padding-left 8.

### Chat area: 1168 × 900, fill `--bg`

- Padding: top 16, bottom 24.
- **Header**: chat title left (Geist Medium 14, `--text-2`), "Share" right (Geist 13, `--text-3`). Padding left/right 24.
- **Thread**: width 720, centered, padding-top 48, gap 32 between messages.
  - **User message**: right-aligned bubble, fill `--user-bubble`, radius 16, padding 12 / 18, Geist 15, `--text-1`. Width hugs the text.
  - **Claude reply**: left-aligned, full 720 width, `--text-1`, Source Serif 4 17. Gap 16 between parts of one reply.
  - **Code block**: padding 14 / 16, radius 10, fill `--code-bg`, 1px `--border`, Geist Mono 13.
  - **Branch switcher**: `‹  2 / 2  ›`, Geist 13. Arrows `--text-3`, numbers `--text-2`. Gap 12.
- **Input box**: pinned to the bottom, 24 px above the window edge, width 720, centered.
  - Fill `--input-bg`, 1px `--border`, radius 20, `--input-shadow`.
  - Padding: top 18, right 14, bottom 14, left 20. Gap 14 between rows.
  - Row 1: text field, Geist 15, placeholder `--text-3` ("Ask a follow-up…" in a chat, "How can I help?" on the new-chat screen).
  - Row 2: model name left (Geist 13, `--text-3`). Send button right: 32 × 32, radius 10, fill `--accent`, "↑" Geist SemiBold 16 in `--on-accent`.

### Empty new-chat screen

- Heading "What are we working on?" and the input box are centered in the chat area. Gap 32.
- Heading: Source Serif 4 Regular 36, `--text-1`.
- Heading centered at about y 410. Input box from about y 463.
- The jellyfish video plays behind the chat area (section 3).

---

## 3. Jellyfish video (new-chat screen only)

Files (all 2336 × 1800, 17.6 s seamless loop, no audio). `clade-jellyfish-mono.mp4` is the one to use: white jellyfish on pure black. It works for every accent and both themes.

Rules:

- Covers the whole chat area (x 272 to 1440, full height), behind all content. `object-fit: cover`. `autoplay muted loop playsinline`.
- The jellyfish layout is baked in for a 1168 × 900 chat area. Do not scale beyond `cover`.
- Show only on the empty new-chat screen. Fade out (about 400ms) when the first message is sent.
- Wrap video and overlay in one container with `isolation: isolate`, then blend the whole container onto the page background.

**Dark theme:**
1. `<video>` mono, as is (white jellyfish on black).
2. Overlay div on top: `background: var(--accent); mix-blend-mode: multiply`. Result: accent jellyfish on black.
3. Container: `mix-blend-mode: screen`. Black disappears into `--bg`, the jellyfish stay accent-colored.

**Ivory theme:**
1. `<video>` mono with `filter: invert(1)` (black jellyfish on white).
2. Overlay div on top: `background: var(--accent); mix-blend-mode: lighten`. Result: accent jellyfish on white.
3. Container: `mix-blend-mode: multiply`. White disappears into `--bg`, the jellyfish stay accent-colored.

Check both visually. If a blend mode misbehaves in this Electron version, use `clade-jellyfish-clay.mp4` for Ivory with the default accent and say so.

---

## 4. Screens

| File | What it shows |
|---|---|
| `screens/01-ivory-chat.png` | Ivory theme, open chat. The design to match. |

There is no screenshot of the dark theme. Build it from the same layout with the dark tokens, then compare against a real Claude app dark-mode screenshot if the user provides one.
