/** The kind of work a job or role is, from its words: the colored dot and filter on the Jobs page. */

export type JobCategory = { name: string; color: string; test: RegExp; museCategory?: string };

export const JOB_CATEGORIES: JobCategory[] = [
  { name: "eCommerce", color: "#4ADE80", test: /e-?commerce|merchandis/i, museCategory: "Retail" },
  { name: "Marketing", color: "#3D8BFF", test: /market|brand|seo\b|content|social media|communications|public relations|\bpr\b|copywrit/i, museCategory: "Advertising and Marketing" },
  { name: "Sales", color: "#F5A524", test: /sales|account executive|account manager|business development|\bbdr?\b|\bsdr\b|partnership/i, museCategory: "Sales" },
  { name: "Support", color: "#FF5C9A", test: /support|customer|client service|client success/i, museCategory: "Customer Service" },
  { name: "Finance", color: "#FACC15", test: /financ|account(ing|ant)|invest|banking|audit|tax\b|treasury|equity/i, museCategory: "Accounting and Finance" },
  { name: "Design", color: "#F472B6", test: /design|\bux\b|\bui\b|creative|illustrat/i },
  { name: "Product", color: "#60A5FA", test: /product manag|\bapm\b|product intern|product owner/i, museCategory: "Product Management" },
  { name: "Data", color: "#34D399", test: /\bdata\b|analytics|machine learning|statistic|business intelligence/i, museCategory: "Data and Analytics" },
  { name: "Engineering", color: "#22D3EE", test: /engineer|developer|software|programmer|devops|\bqa\b|full[- ]stack|front[- ]?end|back[- ]?end/i, museCategory: "Software Engineering" },
  { name: "Consulting", color: "#C084FC", test: /consult|strategy|advisory/i, museCategory: "Business Operations" },
  { name: "People", color: "#FB923C", test: /recruit|talent|human resources|\bhr\b|people (ops|operations|partner)/i, museCategory: "Human Resources and Recruitment" },
  { name: "Research", color: "#2DD4BF", test: /research|laborator|\blab\b|scientist/i, museCategory: "Science and Engineering" },
  { name: "Operations", color: "#A78BFA", test: /operations|\bops\b|logistic|supply chain|project (manag|coord)|program (manag|coord)|\brisk\b/i, museCategory: "Business Operations" },
];

export const OTHER_CATEGORY: Pick<JobCategory, "name" | "color" | "museCategory"> = { name: "Other", color: "#8B8B94" };

export function categoryOf(text: string) {
  return JOB_CATEGORIES.find((item) => item.test.test(text)) ?? OTHER_CATEGORY;
}

export const categoryColor = (name: string) => JOB_CATEGORIES.find((item) => item.name === name)?.color ?? OTHER_CATEGORY.color;
