export function timeAgo(iso: string, now = Date.now()) {
  const delta = new Date(iso).getTime() - now;
  if (delta > 45_000) {
    const minutes = Math.round(delta / 60000);
    if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.round(hours / 24);
    if (days < 30) return `in ${days} day${days === 1 ? "" : "s"}`;
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  if (!domain) return "••••";
  return `${user.slice(0, 1)}•••@${domain}`;
}

export function greeting(name: string, hour = new Date().getHours()) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${hello}, ${first}.`;
}

export function dollars(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
