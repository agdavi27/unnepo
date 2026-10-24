export type ReplyClass = "interview_scheduled" | "interested" | "replied" | "closed" | "opt_out";

export function classifyReply(text: string): ReplyClass {
  const value = text.toLowerCase();
  if (/(unsubscribe|remove me|stop emailing|do not contact|opt out)/.test(value)) return "opt_out";
  if (/(not interested|no thank you|please don't|we're all set|position has been filled)/.test(value)) return "closed";
  if (/(interview|on site|onsite|calendar|schedule a|book time|meet next|zoom|phone screen)/.test(value)) return "interview_scheduled";
  if (/(happy to|glad to|open to|would love|let's talk|sounds good|interested)/.test(value)) return "interested";
  return "replied";
}

export function statusForReply(classification: ReplyClass) {
  if (classification === "opt_out" || classification === "closed") return "closed" as const;
  if (classification === "interview_scheduled") return "interview_scheduled" as const;
  if (classification === "interested") return "interested" as const;
  return "replied" as const;
}
