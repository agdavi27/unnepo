/** Where an email opens: Gmail, Outlook on the web, or the computer's mail app. */
export type Mailer = "gmail" | "outlook" | "mailto";

/** Links that are cut off past this length (mailto and Outlook): longer emails go on the clipboard instead. */
const MAX_LINK = 2000;

/**
 * The email ready to send, in Gmail, Outlook on the web, or the mail app. `cut`: the body didn't fit in the link.
 * Used by the extension's People card and the website's.
 */
export function composeLink(mailer: Mailer, to: string, subject: string, body: string) {
  const q = (pairs: Record<string, string>) => Object.entries(pairs).filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const build = (text: string) => mailer === "gmail"
    ? `https://mail.google.com/mail/?${q({ view: "cm", fs: "1", to, su: subject, body: text })}`
    : mailer === "outlook"
      ? `https://outlook.office.com/mail/deeplink/compose?${q({ to, subject, body: text })}`
      : `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${q({ subject, body: text })}`;
  const full = build(body);
  return full.length <= MAX_LINK ? { url: full, cut: false } : { url: build(""), cut: true };
}
