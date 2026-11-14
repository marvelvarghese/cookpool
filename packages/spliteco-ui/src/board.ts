// Money-native MY-18: the measurements of the approved boards (Settle_Money,
// Money_Ocean, Money_People, Person_Dev), in px, as the boards' inline styles
// give them. The pages draw from these and a test pins them, so a page cannot
// drift from its board by a stray number. Colours are not here: they are the
// `look` tokens (look.ts).

/** Plus Jakarta Sans 400/500/600; the console and the Spliteco app both load it. */
export const BOARD_FONT = "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, sans-serif";

export const BOARD = Object.freeze({
  frame: { width: 390, height: 844 },
  page: { padX: 20, padTop: 20, gapGroups: 20, gapPeople: 16, gapPerson: 18 },
  header: { height: 56, titleSize: 24, titleWeight: 500, titleTracking: "-0.02em", poweredSize: 11, poweredGap: 1 },
  bell: { size: 44, icon: 20, stroke: 1.8 },
  addGroup: { height: 44, padLeft: 12, padRight: 16, marginRight: 8, radius: 10, gap: 6, icon: 18, stroke: 2.4, size: 14, weight: 500 },
  switch: { height: 52, pad: 4, gap: 4, radius: 14, tabRadius: 10, foldedWidth: 52, icon: 20, stroke: 2, iconGap: 8, size: 15, weight: 500 },
  net: { gap: 6, padTop: 4, padX: 4, amountSize: 34, amountWeight: 500, wordsSize: 14, personGap: 4 },
  card: { radius: 22, personGroupRadius: 20 },
  groupRow: { height: 66, avatar: 36, avatarSize: 13, gap: 12, padX: 16, nameSize: 15, amountSize: 15, settledSize: 14 },
  addRow: { height: 60, avatar: 36, icon: 18, stroke: 2 },
  search: { height: 48, radius: 16, gap: 10, padX: 14, icon: 18, size: 16 },
  personRow: { height: 72, avatar: 40, avatarSize: 14, gap: 12, padLeft: 16, padRight: 12, subSize: 13, button: 44, buttonRadius: 10 },
  personGroupRow: { height: 52 },
  tabBar: { height: 68, inset: 12, bottom: 14, radius: 26, padX: 6, item: 52, itemRadius: 18, itemGap: 2, label: 11, icon: 22, stroke: 1.9, shadow: "0 8px 28px rgba(0,0,0,.12)" },
  minTap: 44,
} as const);

/** One focus ring for every control on the pages: it draws only on keyboard focus, so no pixel at rest changes. */
export const FOCUS_CSS =
  "[data-look] :where(a,button,input,[role=tab]):focus-visible{outline:2px solid var(--look-primary);outline-offset:2px}" +
  "[data-look] :where(input):focus-visible{outline-offset:-2px}" +
  // The boards' input shows the browser's own placeholder grey; Tailwind's reset would tint it.
  "[data-look] input::placeholder{color:rgb(117,117,117);opacity:1}";
