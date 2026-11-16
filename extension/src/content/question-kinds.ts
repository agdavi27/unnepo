import { classifyQuestion } from "@/lib/apply/questions";

/**
 * Which questions on a form need a written answer (Unnepo writes those) rather than a fact from the profile
 * (Autofill puts those in). Shared by "Begin applying" and the outlines on the page.
 */
const QUESTION_WORDS = /\b(why|how|what|describe|tell us|explain|share|walk us|give an example|example of|talk about|discuss|elaborate|in your own words|motivat|interest(s|ed)? you|excit|challenge|proud|accomplish|strength|weakness|goal|hope to|would you|have you ever|a time when|cover letter|additional information|anything else)\b/i;
const BASIC = /\b(first|last|full|preferred|legal|middle) ?name\b|^name\b|e-?mail|phone|mobile|address|city|state|zip|postal|country|linked ?in|github|portfolio|website|\burl\b|salary|compensation|pay\b|start date|date|gpa|school|university|college|degree|major|minor|graduat|year|pronoun|referr(ed|al)|how did you hear|source|sponsor|authori[sz]ed|visa|relocat|citizen|clearance|age\b|18\b/i;

/** A written-answer question: a text box whose label asks something a profile can't answer. */
export function isComplexQuestion(type: string, rawLabel: string) {
  if (type !== "textarea" && type !== "text") return false;
  const label = rawLabel.trim();
  if (label.length < 8 || classifyQuestion(label).sensitive || classifyQuestion(label).field) return false;
  if (type === "textarea") return !BASIC.test(label) || QUESTION_WORDS.test(label);
  // A one-line box counts when it plainly asks for a written answer.
  return label.length >= 30 && QUESTION_WORDS.test(label) && !BASIC.test(label);
}
