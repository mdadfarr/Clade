# Clade redesign v2: design spec

This replaces the earlier glass spec. **No liquid glass anywhere.** No glows. Flat, neutral, Anthropic-style.

Source: Figma file "Clade — 3 design directions", frame "E — Ivory" (node 6:2).
Reference window: **1440 × 900**. All px values are at that size.

Two themes, one layout:

- **Ivory** (light, default). Layout from the Figma frame E; colors sampled from Claude chat (white and neutral gray).
- **Dark**. The dark mode of the official Claude app, colors sampled from it (same layout as Ivory).

---

## 1. Tokens

Colors sampled from screenshots of Claude chat (converted to sRGB). They replace the first Figma Ivory and
the Dark approximations. Ivory is now white and neutral gray (the theme keeps its name).

### Ivory (light, default) and Dark

| Token | Dark | Ivory | Used for |
|---|---|---|---|
| `--bg` | `#191919` | `#FFFFFF` | chat area background |
| `--sidebar-bg` | `#1F1F1F` | `#FAFAFA` | sidebar background |
| `--input-bg` | `#303030` | `#FFFFFF` | input box; menus and permission cards too |
| `--row-new`, `--row-active` | `#404040` | `#E0E0E0` | "New chat" row, open chat row (sampled from the "New" row) |
| `--row-hover` | `--row-active` at 60% | same | hovered row (derived) |
| `--text-1` | `#F0F0F0` | `#191919` | main text, sidebar items |
| `--text-3` | `#9E9E9E` | `#646464` | muted: section labels, "Share", placeholder |
| `--text-ctl` | `#9C9C9C` | `#666666` | muted: effort label, model name, the other input-box controls |
| `--border` | `#414141` | `#DCDCDC` | input border, code block border, menus |
| `--sidebar-divider` | `#302F2F` | `#E5E5E5` | 1 px line on the sidebar's right edge |
| `--footer-divider` | `#3A3A3A` | `#DCDCDC` | 1 px line above the account at the sidebar bottom |
| `--scrollbar` | `#6D6D6D` | `#B0B0B0` | scrollbar thumb |
| `--accent` | `#D97757` | `#D97757` | logo/spark accent: "+", avatar, jellyfish |
| `--send` | `#C6623F` | `#C6623F` | send button (default accent; other accents use their own fill) |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` | text on accent |
| `--input-shadow` | `0 4px 20px rgba(0,0,0,.25)` | `0 4px 20px rgba(0,0,0,.06)` | input box |

Not sampled (kept, made neutral where the old warm value clashed):

| Token | Dark | Ivory | Note |
|---|---|---|---|
| `--text-2` | `#C0C0C0` | `#5E5E5E` | secondary text; old `#C2C0B6` / `#5F5E58` at the same lightness |
| `--user-bubble` | `#141413` | `#E9E9E9` | Ivory's old `#ECE9E0` at the same lightness |
| `--code-bg` | `#1F1F1F` | `#FAFAFA` | = sidebar, as before |
| `--accent-text` | `#D97757` | `#9D4D2C` | accent as text (unchanged) |

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

### Sidebar: width 272, fill `--sidebar-bg`, 1px `--sidebar-divider` on the right edge (drawn inside, nothing moves)

- Padding: top 20, bottom 20, left/right 16. Item gap 2.
- **Logo**: "Clade", padding-left 8. Then 20px space.
- **New chat row**: height 42, padding 10 / 12, gap 10, fill `--row-new`, radius 10. "+" in `--accent` (Geist Medium 16), "New chat" in `--text-1` (Geist Medium 14). Then 20px space.
- **"Recent"** label: Geist Medium 12, `--text-3`, padding-left 12, padding-bottom 6.
- **Chat rows**: height 38, padding 8 / 12, radius 8, Geist Regular 14, full width.
  - Active chat: fill `--row-active`, text `--text-1`.
  - Hovered chat: fill `--row-hover`, text `--text-1`.
  - Others: no fill, text `--text-1`.
- **Footer** (pinned to bottom): 28px circle `--accent` with initial "M" (Geist Medium 12, white), then name (Geist 14, `--text-1`). Gap 10, padding-left 8. 1px `--footer-divider` above it.

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
  - Row 2: model name left (Geist 13, `--text-ctl`). Send button right: 32 × 32, radius 10, fill `--send`, "↑" Geist SemiBold 16 in `--on-accent`.

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
