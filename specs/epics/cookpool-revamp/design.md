# cookpool-revamp — design

The canvas boards are the reference; this file is the rules they share.

## 1. Tokens (`.cookpool`, globals.css; both themes)

| Token | Light | Dark |
|---|---|---|
| ground | `#FAF7F2` | `#0F1412` |
| card | `#FFFFFF`, with the shadow `0 1px 2px rgba(23,32,27,.06), 0 4px 14px rgba(23,32,27,.06)` | `#1A211D`, no shadow |
| ink / muted | `#17201B` / `#5F6862` | `#F2F5F3` / `#A3ADA7` |
| line (row dividers) | `#F0ECE5` | `#26302A` |
| accent / accent text / tint | `#167A4A` / `#0F5C37` / `#E3F3EA` | `#FACC15` / `#FDE68A` / `#3A3112`; text on the accent `#0F1412` |
| money back | `#1D4ED8` on `#E3EBFD` | `#93C5FD` on `#16264A` |
| money you owe | `#C2410C` | `#F9A8D4` |
| expired | `#B42318` on `#FDECEC` | `#FCA5A5` on `#3A1A1A` |
| cook strip | ink `#17201B`, with a `#D9481F` tile | the accent on its tint |

- **Dark mode:** follows `prefers-color-scheme`.
- **Existing `cp-*` token names:** they keep their names and change their values, so old components move with the new palette.

## 2. Type

- **Outfit** is self-hosted from `@fontsource-variable/outfit` (latin) through `next/font/local`, replacing Plus Jakarta Sans as `--font-cookpool`.
- **Weights:** Regular 400 for body and secondary text; Medium 500 for row titles, buttons, tabs and chips. No 600 or above anywhere in kitchen screens.
- **Sizes:**
  - page titles 26 px
  - section headings 17 px
  - rows 16 px
  - meta text 13 px
  - tab labels 11 px

## 3. Surfaces

- **Cards:** radius 22, no border; rows inside split by a 1 px line.
- **Pills:** buttons are 44 px pills on the tint, or on the accent for the one main action.
- **Tab bar:** floating, 12 px from the sides and 14 px from the bottom, 24 px radius, ink in light mode and card in dark mode. The current tab is filled with the accent.

## 4. Pages (each matches its board)

| Page | Board |
|---|---|
| Home | `HomeRevamp` |
| Pantry | `RvPantry` |
| Item | `RvItem` |
| Cook | `RvCook` |
| Recipe | `RvRecipe` |
| Cook step | `RvCookStep` |
| Cooked | `RvCooked` |
| Money | `RvMoney` |
| Groups | `RvGroups` |
| Group | `RvGroup` |
| You | `RvYou` |
| Community | `RvCommunity` |
| Sign in | `RvSignIn` |

- Content and behaviour stay as built. Only layout, words and look change, unless the design says otherwise.
- The boards' sample data is illustrative.

## 5. Finish without amounts (RV-7)

- **The cook session:** Finish is always enabled.
- **No amounts:** with no amounts, the dish is made with no ingredients. It costs ₹0, takes nothing from any pantry, and still offers Split and Post.
- **The server:** kitchen-worker accepts a cook with no ingredients and no new items, as a ₹0 dish with no stock moves. Today it refuses with "Add at least one ingredient".
