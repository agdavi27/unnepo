import { userAgent } from "next/server";

/**
 * What /get shows, decided on the server from the User-Agent so there's no flash of the wrong version:
 * "chrome" (a desktop browser that can add Chrome Web Store extensions: Chrome, Edge, Brave, Arc, Opera, all Blink)
 * gets the Add to Chrome button; "email" (a phone, a tablet, Instagram's in-app browser, Safari or Firefox on a
 * computer) gets the email form.
 */
export type InstallView = "chrome" | "email";

export function installView(ua: string | null | undefined, override?: string | null): InstallView {
  if (override === "chrome" || override === "desktop") return "chrome";
  if (override === "email" || override === "mobile") return "email";
  const parsed = userAgent({ headers: new Headers({ "user-agent": ua ?? "" }) });
  const type = parsed.device.type;
  if (type && type !== "embedded") return "email";
  if (/\b(Android|iPhone|iPad|iPod|Mobile)\b/i.test(ua ?? "")) return "email";
  return parsed.engine.name === "Blink" ? "chrome" : "email";
}
