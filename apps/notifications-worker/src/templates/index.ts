/**
 * Static email templates for the notifications worker.
 *
 * Spec 14 allows V1 templates to be static files as long as template
 * versions remain traceable — these renderers are the V1 "static files"
 * form, keyed by the same `templateKey` strings the calling workers pass
 * to POST /v1/notifications.
 *
 * Every substitution is HTML-escaped before it reaches the html body, so a
 * hostile value in `templateData` (or a recipient-controlled field such as
 * an email hint) can never inject markup. Renderers only read the fields
 * they need; unknown extra fields are ignored, and unknown template keys
 * return null so the provider can fail the send with a bounded reason
 * instead of delivering an empty message.
 *
 * Cookpool's kitchen emails (CP-18) — `kitchen.use_soon`,
 * `kitchen.dish_posted`, `kitchen.logged_for_you`, and from SM-6
 * `kitchen.portion_set` — are enqueued by
 * kitchen-worker with the shapes `@saas/contracts/kitchen` defines: amounts
 * already formatted, links absolute (a link that is not http(s) is left
 * out), the digest's items as numbered keys. They speak plainly and briefly,
 * in the app's voice.
 */

import { KITCHEN_EMAILS, readUseSoonEmail } from "@saas/contracts/kitchen";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateData = Record<string, string | number | boolean | null>;

export interface TemplateRenderOptions {
  /**
   * Product display name used in subjects/footers (e.g. "Cookpool").
   * Falls back to neutral copy when not configured so a misconfigured
   * deployment still produces a sensible email.
   */
  brandName?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stringify a templateData value; null/undefined render as "". */
function str(data: TemplateData, key: string): string {
  const v = data[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Render an ISO timestamp as a human-readable UTC string. Falls back to the
 * raw value when it does not parse — a slightly ugly email beats a failed
 * send.
 */
function formatTimestamp(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toUTCString();
}

/**
 * Shared shell so all transactional emails look consistent. Body fragments
 * passed in MUST already be escaped.
 */
function htmlShell(title: string, bodyHtml: string, footerLine: string): string {
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#f4f4f7;">',
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1a1a2e;">',
    '<div style="background:#ffffff;border-radius:8px;padding:32px;">',
    `<h1 style="margin:0 0 16px;font-size:20px;">${title}</h1>`,
    bodyHtml,
    "</div>",
    `<p style="margin:16px 0 0;font-size:12px;color:#6b6b80;text-align:center;">${footerLine}</p>`,
    "</div></body></html>",
  ].join("");
}

type TemplateRenderer = (data: TemplateData, opts: TemplateRenderOptions) => RenderedEmail;

const renderMagicLink: TemplateRenderer = (data, opts) => {
  const code = str(data, "code");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand ? `Your ${brand} login code` : "Your login code";
  const expiryLineText = expires ? `This code expires at ${expires}.` : "This code expires shortly.";

  const text = [
    "Use this code to finish signing in:",
    "",
    code,
    "",
    expiryLineText,
    "If you did not request this code, you can safely ignore this email.",
  ].join("\n");

  const html = htmlShell(
    "Finish signing in",
    [
      '<p style="margin:0 0 16px;font-size:14px;">Use this code to finish signing in:</p>',
      `<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(code)}</p>`,
      `<p style="margin:0 0 8px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you did not request this code, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated security email."),
  );

  return { subject, html, text };
};

const renderInvitationCreated: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const expires = formatTimestamp(str(data, "expiresAt"));
  const brand = opts.brandName ?? "";
  const subject = brand
    ? `You have been invited to an organization on ${brand}`
    : "You have been invited to an organization";
  const roleLineText = role
    ? `You have been invited to join an organization as ${role}.`
    : "You have been invited to join an organization.";
  const expiryLineText = expires ? `The invitation expires at ${expires}.` : "";

  const text = [
    roleLineText,
    expiryLineText,
    "Sign in with this email address to view and accept the invitation.",
    "If you were not expecting this invitation, you can safely ignore this email.",
  ]
    .filter((line) => line.length > 0)
    .join("\n\n");

  const html = htmlShell(
    "You have been invited",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(roleLineText)}</p>`,
      expiryLineText
        ? `<p style="margin:0 0 16px;font-size:13px;color:#6b6b80;">${escapeHtml(expiryLineText)}</p>`
        : "",
      '<p style="margin:0 0 8px;font-size:14px;">Sign in with this email address to view and accept the invitation.</p>',
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If you were not expecting this invitation, you can safely ignore this email.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

const renderInvitationAccepted: TemplateRenderer = (data, opts) => {
  const role = str(data, "role");
  const brand = opts.brandName ?? "";
  const subject = brand ? `You have joined an organization on ${brand}` : "You have joined an organization";
  const bodyLineText = role
    ? `Your invitation was accepted and you are now a member with the ${role} role.`
    : "Your invitation was accepted and you are now a member of the organization.";

  const text = [
    bodyLineText,
    "If this was not you, contact your organization administrator.",
  ].join("\n\n");

  const html = htmlShell(
    "Welcome aboard",
    [
      `<p style="margin:0 0 16px;font-size:14px;">${escapeHtml(bodyLineText)}</p>`,
      '<p style="margin:0;font-size:13px;color:#6b6b80;">If this was not you, contact your organization administrator.</p>',
    ].join(""),
    escapeHtml(brand ? `Sent by ${brand}` : "This is an automated email."),
  );

  return { subject, html, text };
};

// ── Cookpool's kitchen emails (CP-18) ─────────────────────────

/** A value fit for a subject line: one line, trimmed (no header injection through a name). */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** An http(s) link, or "" — anything else (javascript:, data:, garbage) is never linked. */
function safeUrl(raw: string): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** A button-style link for the html body; the url and label are escaped. */
function buttonHtml(url: string, label: string): string {
  return `<p style="margin:24px 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">${escapeHtml(label)}</a></p>`;
}

function paragraphHtml(text: string, muted = false): string {
  return `<p style="margin:0 0 12px;font-size:${muted ? "13px;color:#6b6b80" : "14px"};">${escapeHtml(text)}</p>`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When to use something by, said from `today` (both YYYY-MM-DD, UTC days):
 * "today", "tomorrow", else "Wed 4 Nov". The raw value when either does not
 * parse.
 */
export function useByPhrase(useBy: string, today: string): string {
  const at = Date.parse(`${useBy}T00:00:00.000Z`);
  if (Number.isNaN(at)) return useBy;
  const from = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isNaN(from)) {
    const days = Math.round((at - from) / 86_400_000);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
  }
  const d = new Date(at);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "1 portion", "½ portion", "2½ portions". */
function portionsPhrase(portions: string): string {
  return portions === "1" || portions === "½" ? `${portions} portion` : `${portions} portions`;
}

function footerFor(brand: string, why: string): string {
  return escapeHtml(brand ? `Sent by ${brand}. ${why}` : why);
}

const renderUseSoon: TemplateRenderer = (data, opts) => {
  const digest = readUseSoonEmail(data);
  const count = digest.count;
  const brand = opts.brandName ?? "";
  const subject = count === 1 ? "1 thing to use soon" : `${count} things to use soon`;
  const greeting = digest.recipientName ? `Hi ${oneLine(digest.recipientName)},` : "Hi,";
  const intro = count === 1 ? "This is close to its use-by date:" : "These are close to their use-by date:";
  const lines = digest.items.map(
    (item) => `${item.name} — ${item.pantry} — use by ${useByPhrase(item.useBy, digest.date)}`,
  );
  const more = count > digest.items.length ? `…and ${count - digest.items.length} more.` : "";
  const home = safeUrl(digest.homeUrl);
  const why = "You get this once a day when something you can use is close to its use-by date.";

  const text = [
    greeting,
    "",
    intro,
    "",
    ...lines.map((line) => `• ${line}`),
    ...(more ? ["", more] : []),
    ...(home ? ["", `Use them before they go: ${home}`] : []),
    "",
    why,
  ].join("\n");

  const html = htmlShell(
    escapeHtml(subject),
    [
      paragraphHtml(greeting),
      paragraphHtml(intro),
      `<ul style="margin:0 0 12px;padding-left:20px;font-size:14px;">${lines
        .map((line) => `<li style="margin:0 0 6px;">${escapeHtml(line)}</li>`)
        .join("")}</ul>`,
      more ? paragraphHtml(more, true) : "",
      home ? buttonHtml(home, "Use them before they go") : "",
    ].join(""),
    footerFor(brand, why),
  );

  return { subject, html, text };
};

const renderDishPosted: TemplateRenderer = (data, opts) => {
  const cook = oneLine(str(data, "cookName")) || "Someone";
  const dish = oneLine(str(data, "dishName")) || "a dish";
  const group = oneLine(str(data, "groupName")) || "your group";
  const portions = str(data, "portions");
  const total = str(data, "total");
  const link = safeUrl(str(data, "dishUrl"));
  const brand = opts.brandName ?? "";
  const subject = `${cook} made ${dish} — claim yours`;
  const what = [portions ? portionsPhrase(portions) : "", total ? `${total} in all` : ""].filter(Boolean).join(", ");
  const lead = what ? `${cook} made ${dish} for ${group}: ${what}.` : `${cook} made ${dish} for ${group}.`;
  const ask = `Claim what you'll have before ${cook} finalizes it — you pay only for your portions.`;
  const why = `You get this when someone in ${group} shares a dish for claims.`;

  const text = [lead, "", ask, ...(link ? ["", `Claim yours: ${link}`] : []), "", why].join("\n");

  const html = htmlShell(
    escapeHtml(`${dish} — claim yours`),
    [paragraphHtml(lead), paragraphHtml(ask), link ? buttonHtml(link, "Claim yours") : ""].join(""),
    footerFor(brand, why),
  );

  return { subject, html, text };
};

const renderLoggedForYou: TemplateRenderer = (data, opts) => {
  const actor = oneLine(str(data, "actorName")) || "Someone";
  const kind = str(data, "kind") === "expense" ? "expense" : "use";
  const what = oneLine(str(data, "what")) || (kind === "expense" ? "an expense" : "something");
  const group = oneLine(str(data, "groupName")) || "your group";
  const total = str(data, "total");
  const share = str(data, "yourShare");
  const paid = str(data, "youPaid");
  const link = safeUrl(str(data, "groupUrl"));
  const brand = opts.brandName ?? "";
  const subject = `${actor} logged ${what} for you`;
  const lead = total ? `In ${group}: ${what}, ${total} in all.` : `In ${group}: ${what}.`;
  const amounts = [share ? `Your share: ${share}.` : "", paid ? `You paid: ${paid}.` : ""].filter(Boolean);
  const check = "Not right? Open it in the group's activity and flag it.";
  const why = `You get this when someone in ${group} logs ${kind === "expense" ? "an expense" : "a use"} that names you.`;

  const text = [
    `${actor} logged this for you.`,
    "",
    lead,
    ...amounts,
    "",
    check,
    ...(link ? [link] : []),
    "",
    why,
  ].join("\n");

  const html = htmlShell(
    escapeHtml(`${actor} logged this for you`),
    [
      paragraphHtml(lead),
      ...amounts.map((line) => paragraphHtml(line)),
      paragraphHtml(check, true),
      link ? buttonHtml(link, `Open ${group}`) : "",
    ].join(""),
    footerFor(brand, why),
  );

  return { subject, html, text };
};

// ── Anyone's portion (SM-6) ───────────────────────────────────

const renderPortionSet: TemplateRenderer = (data, opts) => {
  const actor = oneLine(str(data, "actorName")) || "Someone";
  const dish = oneLine(str(data, "dishName")) || "a dish";
  const group = oneLine(str(data, "groupName")) || "your group";
  const portions = oneLine(str(data, "portions"));
  const share = str(data, "yourShare");
  const link = safeUrl(str(data, "dishUrl"));
  const brand = opts.brandName ?? "";
  const had = portions ? `${portionsPhrase(portions)} of ${dish}` : `some of ${dish}`;
  const subject = `${actor} said you had ${had}`;
  const lead = `In ${group}: ${actor} said you had ${had}.`;
  const amounts = share ? [`Your share: ${share}.`] : [];
  const check = "Not right? Change it on the dish before it is finalized.";
  const why = `You get this once per dish when someone in ${group} sets your portion.`;

  const text = [lead, ...amounts, "", check, ...(link ? [link] : []), "", why].join("\n");

  const html = htmlShell(
    escapeHtml(`${actor} said you had ${had}`),
    [
      paragraphHtml(lead),
      ...amounts.map((line) => paragraphHtml(line)),
      paragraphHtml(check, true),
      link ? buttonHtml(link, "Open the dish") : "",
    ].join(""),
    footerFor(brand, why),
  );

  return { subject, html, text };
};

const TEMPLATES: Record<string, TemplateRenderer> = {
  "auth.magic_link": renderMagicLink,
  "invitation.created": renderInvitationCreated,
  "invitation.accepted": renderInvitationAccepted,
  // Cookpool (CP-18).
  [KITCHEN_EMAILS.USE_SOON]: renderUseSoon,
  [KITCHEN_EMAILS.DISH_POSTED]: renderDishPosted,
  [KITCHEN_EMAILS.LOGGED_FOR_YOU]: renderLoggedForYou,
  // Cookpool (SM-6).
  [KITCHEN_EMAILS.PORTION_SET]: renderPortionSet,
};

/**
 * Render the email for a template key, or null when the key has no
 * registered template. Callers (the provider adapters) MUST treat null as a
 * bounded send failure — never deliver an empty or generic body.
 */
export function renderEmailTemplate(
  templateKey: string,
  templateData: TemplateData,
  opts: TemplateRenderOptions = {},
): RenderedEmail | null {
  const renderer = TEMPLATES[templateKey];
  if (!renderer) return null;
  return renderer(templateData, opts);
}
