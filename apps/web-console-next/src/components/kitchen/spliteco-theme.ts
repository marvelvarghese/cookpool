/**
 * Cookpool's look for the shared money screens (cookpool-spliteco SE3,
 * `packages/spliteco-ui`): every slot is the revamp's tokens and kit (RV-2) —
 * cards with no border and the soft shadow, rows split by `cp-line`, Outfit at
 * 400 and 500, the money colours (`cp-owed` back, `cp-owe` you owe), pills on
 * the tint and the accent for the one main action — and amounts print with
 * the engine's formatter, as everywhere else in Cookpool. No raw colours.
 */

import { BARE_SLOTS, type SplitecoUiTheme } from "@saas/spliteco-ui/theme";
import { formatMinor } from "./money";
import { K_BUTTON, K_BUTTON_QUIET, K_CARD, K_INPUT, K_ROWS, K_SECTION } from "./kit";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAIN = `inline-flex w-full items-center justify-center gap-2 bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
const PILL = `inline-flex items-center justify-center gap-2 transition-colors disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;

export const COOKPOOL_SPLITECO_THEME: SplitecoUiTheme = {
  money: (minor, currency, opts) => (opts?.sign && minor > 0 ? `+${formatMinor(minor, currency)}` : formatMinor(minor, currency)),
  slots: {
    ...BARE_SLOTS,
    // The balance card (CookpoolMoney's Balances card, in the revamp's look).
    card: `${K_CARD} flex flex-col gap-3 p-4`,
    cardHead: "flex min-h-6 items-center justify-between gap-3",
    cardTitle: "text-[13px] font-medium text-muted-foreground",
    cardBadge: "inline-flex items-center gap-1.5 text-[13px] font-normal text-muted-foreground",
    balanceRows: "flex flex-col gap-2.5",
    balanceRow: "flex min-h-6 items-center justify-between gap-3 text-[15px] font-normal",
    balanceText: "min-w-0 flex-1 truncate",
    amount: "shrink-0 font-medium tabular-nums",
    owe: "text-cp-owe",
    owed: "text-cp-owed",
    settled: "text-muted-foreground",
    cardAction: `${K_BUTTON_QUIET} ${PILL} w-full`,
    // The "why" list: one line per row.
    why: "space-y-2.5",
    whyTitle: K_SECTION,
    whySection: "space-y-1.5",
    whySectionTitle: "px-1 text-[13px] font-normal text-muted-foreground",
    whyRows: K_ROWS,
    whyRow: "flex min-h-[52px] items-center gap-3 px-4 py-2.5 text-[15px]",
    whyMain: "min-w-0 flex-1 truncate",
    whyRowTitle: "font-medium",
    whyRowDetail: "font-normal text-muted-foreground",
    whyMore: `${K_BUTTON_QUIET} ${PILL} w-full`,
    empty: `${K_CARD} flex min-h-14 items-center px-4 text-sm font-normal text-muted-foreground`,
    // Forms.
    form: "flex flex-col gap-4",
    field: "flex flex-col gap-1.5 border-0 p-0",
    label: "text-sm font-medium",
    input: `${K_INPUT} flex w-full border border-input bg-background px-3 py-1 placeholder:text-muted-foreground ${FOCUS}`,
    select: `${K_INPUT} flex w-full border border-input bg-background px-3 ${FOCUS}`,
    chips: "flex flex-wrap gap-2",
    chip: `${PILL} h-11 rounded-full border border-cp-line bg-card px-4 text-[15px] font-medium aria-checked:border-transparent aria-checked:bg-cp-accent-tint aria-checked:text-cp-accent-text`,
    hint: "text-[13px] font-normal text-muted-foreground",
    error: "text-[13px] font-normal text-destructive",
    button: `${MAIN} h-auto min-h-[54px] rounded-2xl text-[17px] font-medium`,
    buttonQuiet: `${K_BUTTON_QUIET} ${PILL}`,
    // Settle up (CookpoolSettle, in the revamp's look).
    payHeader: "flex flex-col items-center gap-1.5 py-2 text-center",
    payWho: "text-sm font-normal text-muted-foreground",
    payAmount: "text-[46px] font-medium leading-none tracking-[-0.03em] tabular-nums",
    methods: "flex flex-col gap-2",
    method: `${K_CARD} flex min-h-[62px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-60 aria-checked:bg-cp-accent-tint ${FOCUS}`,
    methodOn: "ring-2 ring-primary",
    badge: "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-cp-accent-tint text-[12px] font-medium text-cp-accent-text",
    methodMain: "flex min-w-0 flex-1 flex-col gap-0.5",
    methodTitle: "text-[15px] font-medium",
    methodNote: "text-[13px] font-normal text-muted-foreground",
    radio: "h-5 w-5 shrink-0 rounded-full border-2 border-cp-line",
    radioOn: "border-[6px] border-primary",
    confirm: `${K_CARD} flex flex-col gap-2.5 p-4`,
    confirmTitle: "text-base font-medium",
    confirmNote: "text-[13px] font-normal text-muted-foreground",
    confirmActions: "flex gap-2",
    confirmButton: `${MAIN} ${K_BUTTON} flex-1`,
    confirmQuiet: `${K_BUTTON_QUIET} ${PILL} flex-1`,
    link: "text-center text-[13px] font-medium text-cp-accent-text",
    done: "flex flex-col items-center gap-3 py-6 text-center",
    doneTitle: "text-[22px] font-medium",
    doneNote: "text-sm font-normal text-muted-foreground",
    footer: "flex flex-col gap-2.5 pt-2",
  },
};
