import { repo } from "@/lib/db/file-store";
import { ServiceError } from "@/lib/errors";

/**
 * The launch waitlist from the landing page. Name and email are required; a phone number is optional and only
 * kept if it looks like one. Joining twice with the same email updates the first entry.
 */
export async function joinWaitlist(input: { name?: unknown; email?: unknown; phone?: unknown }) {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const email = String(input.email ?? "").trim().toLowerCase().slice(0, 200);
  const phone = String(input.phone ?? "").trim().slice(0, 40);
  if (!name) throw new ServiceError("Add your name.", "invalid_name", 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("That email doesn't look right.", "invalid_email", 400);
  const digits = phone.replace(/\D/g, "");
  if (phone && (digits.length < 7 || digits.length > 15 || /[^\d\s()+.-]/.test(phone))) throw new ServiceError("That phone number doesn't look right. It's optional, so you can leave it blank.", "invalid_phone", 400);
  await repo.joinWaitlist({ name, email, ...(phone ? { phone } : {}) });
  return { ok: true, firstName: name.split(" ")[0] };
}
