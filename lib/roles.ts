import type { ResumeFact } from "@/lib/db/types";

const FAMILIES: Array<{ test: RegExp; roles: string[] }> = [
  { test: /market|brand|seo|content|social|communicat|pr\b|public relation/i, roles: ["Marketing Intern", "Marketing Specialist", "Brand Marketing", "Content Marketing", "Growth Marketing", "Product Marketing", "Digital Marketing Intern"] },
  { test: /financ|account|econ|invest|banking|fp&a|valuat/i, roles: ["Finance Intern", "Financial Analyst", "Investment Banking Analyst", "Corporate Finance Intern", "Accounting Intern"] },
  { test: /software|engineer|developer|python|java|react|typescript|frontend|backend/i, roles: ["Software Engineer Intern", "Software Engineer", "Frontend Engineer", "Backend Engineer", "Product Engineer"] },
  { test: /data|sql|statistic|analytics|tableau|excel/i, roles: ["Data Analyst", "Data Analyst Intern", "Business Analyst", "Product Analyst"] },
  { test: /consult|strategy|case/i, roles: ["Consulting Intern", "Business Analyst", "Strategy Intern", "Associate Consultant"] },
  { test: /design|ux|ui\b|figma|graphic/i, roles: ["Product Designer", "UX Design Intern", "Graphic Designer", "Brand Designer"] },
  { test: /sales|account executive|business development|\bbd\b/i, roles: ["Sales Development Intern", "Account Executive", "Business Development"] },
  { test: /product manag|\bapm\b|\bpm\b/i, roles: ["Product Manager", "Associate Product Manager", "Product Intern"] },
  { test: /recruit|talent|human resource|\bhr\b|people ops/i, roles: ["Talent Acquisition", "University Recruiter", "People Operations Intern", "HR Intern"] },
  { test: /research|laborator|biolog|chemist|psych/i, roles: ["Research Assistant", "Lab Intern", "Research Associate"] },
  { test: /operat|supply|logistic|project coord/i, roles: ["Operations Intern", "Project Coordinator", "Supply Chain Analyst"] },
];

const ROLE_WORD = /\b(intern|analyst|associate|manager|coordinator|engineer|designer|recruiter|consultant|specialist|director)\b/i;

const STARTER = ["Marketing Intern", "Finance Intern", "Software Engineer Intern", "Data Analyst", "Consulting Intern", "Product Manager"];

export function suggestRoles(facts: ResumeFact[], resumeText = ""): string[] {
  const blob = [resumeText, ...facts.map((fact) => `${fact.label} ${fact.detail}`)].join("\n");
  const found: string[] = [];
  for (const fact of facts) {
    if (fact.category !== "experience" && fact.category !== "internship" && fact.category !== "goal") continue;
    const line = fact.label.trim();
    if (ROLE_WORD.test(line) && line.length < 60) found.push(cleanRole(line));
  }
  for (const family of FAMILIES) {
    if (family.test.test(blob)) found.push(...family.roles);
  }
  const unique = [...new Set(found.map((role) => role.trim()).filter(Boolean))];
  return (unique.length ? unique : STARTER).slice(0, 12);
}

function cleanRole(value: string) {
  return value.replace(/\s+[|–-]\s+.*$/, "").replace(/\s{2,}/g, " ").trim();
}
