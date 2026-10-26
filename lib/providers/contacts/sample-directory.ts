import type { Contact } from "@/lib/db/types";

type Seed = {
  id: string;
  fullName: string;
  title: string;
  company: string;
  domain: string;
  location: string;
  school: string;
  email?: string | null;
  phone?: string | null;
  tags: string[];
  industry: string;
  seniority: string;
  department: string;
  companySize: string;
  interests?: string[];
  previousRoles?: string[];
};

function person(seed: Seed): Contact {
  const [firstName, ...rest] = seed.fullName.split(" ");
  const lastName = rest.join(" ");
  const hasEmail = Boolean(seed.email);
  const hasPhone = Boolean(seed.phone);
  return {
    id: seed.id,
    externalId: seed.id,
    provider: "sample",
    fullName: seed.fullName,
    firstName,
    lastName,
    title: seed.title,
    company: seed.company,
    companyDomain: seed.domain,
    location: seed.location,
    school: seed.school,
    profileUrl: null,
    email: seed.email ?? null,
    emailStatus: hasEmail ? "verified" : "unavailable",
    phone: seed.phone ?? null,
    phoneStatus: hasPhone ? "verified" : "unavailable",
    tags: seed.tags,
    seniority: seed.seniority,
    department: seed.department,
    industry: seed.industry,
    companySize: seed.companySize,
    interests: seed.interests ?? [],
    previousRoles: seed.previousRoles ?? [],
    achievements: [],
    publicPosts: [],
    verifiedMutuals: [],
    shareable: true,
    licenseNote: "Sample directory for local development. Not a live provider result and not licensed contact data.",
    dataSource: "sample",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    costCents: 0,
    costEstimated: true,
  };
}

/** Illustrative directory so the product workflow runs without an Apollo key. */
export const SAMPLE_CONTACTS: Contact[] = [
  person({
    id: "sample_taylor_kim",
    fullName: "Taylor Kim",
    title: "Brand Marketing Manager",
    company: "Patagonia",
    domain: "patagonia.com",
    location: "New York, NY",
    school: "Colby College",
    email: "taylor.kim@patagonia.com",
    phone: "+1 (646) 555-0183",
    tags: ["Marketing", "Sustainability"],
    industry: "Outdoor / Apparel",
    seniority: "Manager",
    department: "Marketing",
    companySize: "1001-5000",
    interests: ["Trail running", "Outdoor gear"],
    previousRoles: ["Brand marketing associate"],
  }),
  person({
    id: "sample_jordan_lee",
    fullName: "Jordan Lee",
    title: "Talent Acquisition",
    company: "REI",
    domain: "rei.com",
    location: "Seattle, WA",
    school: "University of Washington",
    email: "jordan.lee@rei.com",
    phone: "+1 (206) 555-0147",
    tags: ["Recruiting", "Campus"],
    industry: "Outdoor / Apparel",
    seniority: "Senior",
    department: "Talent",
    companySize: "5001-10000",
    interests: ["Campus recruiting", "Hiking"],
  }),
  person({
    id: "sample_morgan_smith",
    fullName: "Morgan Smith",
    title: "University Recruiter",
    company: "The North Face",
    domain: "thenorthface.com",
    location: "Denver, CO",
    school: "Boston College",
    email: "morgan.smith@tnf.com",
    phone: "+1 (720) 555-0192",
    tags: ["Early Career", "Recruiting"],
    industry: "Outdoor / Apparel",
    seniority: "Entry",
    department: "Talent",
    companySize: "1001-5000",
    interests: ["Early career programs"],
  }),
  person({
    id: "sample_alex_rivera",
    fullName: "Alex Rivera",
    title: "Product Marketing",
    company: "Arc'teryx",
    domain: "arcteryx.com",
    location: "New York, NY",
    school: "New York University",
    email: "alex.rivera@arcteryx.com",
    phone: "+1 (646) 555-0116",
    tags: ["Product", "Marketing"],
    industry: "Outdoor / Apparel",
    seniority: "Senior",
    department: "Marketing",
    companySize: "1001-5000",
    interests: ["Product launches", "Climbing"],
  }),
  person({
    id: "sample_casey_nguyen",
    fullName: "Casey Nguyen",
    title: "Brand Partnerships",
    company: "YETI",
    domain: "yeti.com",
    location: "Austin, TX",
    school: "University of Texas at Austin",
    email: "casey.nguyen@yeti.com",
    phone: "+1 (512) 555-0175",
    tags: ["Partnerships", "Brand"],
    industry: "Outdoor / Apparel",
    seniority: "Manager",
    department: "Partnerships",
    companySize: "1001-5000",
    interests: ["Brand partnerships"],
  }),
  person({
    id: "sample_matt_evans",
    fullName: "Matt Evans",
    title: "Growth Marketing",
    company: "Lululemon",
    domain: "lululemon.com",
    location: "New York, NY",
    school: "Colby College",
    email: "matt.evans@lululemon.com",
    phone: "+1 (646) 555-0134",
    tags: ["Growth", "Performance"],
    industry: "Outdoor / Apparel",
    seniority: "Senior",
    department: "Marketing",
    companySize: "5001-10000",
    interests: ["Performance marketing", "Running"],
  }),
  person({
    id: "sample_priya_sharma",
    fullName: "Priya Sharma",
    title: "Ecommerce Marketing",
    company: "Columbia Sportswear",
    domain: "columbia.com",
    location: "Portland, OR",
    school: "Columbia University",
    email: "priya.sharma@columbia.com",
    phone: "+1 (503) 555-0108",
    tags: ["Ecommerce", "Marketing"],
    industry: "Outdoor / Apparel",
    seniority: "Manager",
    department: "Marketing",
    companySize: "5001-10000",
  }),
  person({
    id: "sample_daniel_park",
    fullName: "Daniel Park",
    title: "Brand Marketing",
    company: "Salomon",
    domain: "salomon.com",
    location: "Boulder, CO",
    school: "University of Colorado Boulder",
    email: "daniel.park@salomon.com",
    phone: "+1 (303) 555-0166",
    tags: ["Brand", "Footwear"],
    industry: "Outdoor / Apparel",
    seniority: "Senior",
    department: "Marketing",
    companySize: "1001-5000",
  }),
  person({
    id: "sample_sophia_chen",
    fullName: "Sophia Chen",
    title: "Marketing Coordinator",
    company: "Vuori",
    domain: "vuori.com",
    location: "San Diego, CA",
    school: "University of California, San Diego",
    email: "sophia.chen@vuori.com",
    phone: "+1 (619) 555-0129",
    tags: ["Marketing", "Community"],
    industry: "Outdoor / Apparel",
    seniority: "Entry",
    department: "Marketing",
    companySize: "201-500",
  }),
  person({
    id: "sample_jamie_cole",
    fullName: "Jamie Cole",
    title: "Retail Associate",
    company: "Patagonia",
    domain: "patagonia.com",
    location: "Boston, MA",
    school: "Boston College",
    email: null,
    phone: null,
    tags: ["Retail"],
    industry: "Outdoor / Apparel",
    seniority: "Entry",
    department: "Retail",
    companySize: "1001-5000",
  }),
  person({
    id: "sample_riley_brooks",
    fullName: "Riley Brooks",
    title: "Campus Recruiter",
    company: "Nike",
    domain: "nike.com",
    location: "Portland, OR",
    school: "University of Oregon",
    email: "riley.brooks@nike.com",
    phone: "+1 (503) 555-0188",
    tags: ["Campus", "Recruiting"],
    industry: "Sports",
    seniority: "Manager",
    department: "Talent",
    companySize: "10001+",
  }),
  person({
    id: "sample_avery_nelson",
    fullName: "Avery Nelson",
    title: "Content Marketing Manager",
    company: "Allbirds",
    domain: "allbirds.com",
    location: "San Francisco, CA",
    school: "Stanford University",
    email: "avery.nelson@allbirds.com",
    phone: "+1 (415) 555-0142",
    tags: ["Content", "Sustainability"],
    industry: "Consumer goods",
    seniority: "Manager",
    department: "Marketing",
    companySize: "501-1000",
  }),
  person({
    id: "sample_sam_patel",
    fullName: "Sam Patel",
    title: "Partnerships Manager",
    company: "Cotopaxi",
    domain: "cotopaxi.com",
    location: "Salt Lake City, UT",
    school: "University of Utah",
    email: "sam.patel@cotopaxi.com",
    phone: "+1 (801) 555-0194",
    tags: ["Partnerships", "Impact"],
    industry: "Outdoor / Apparel",
    seniority: "Manager",
    department: "Partnerships",
    companySize: "201-500",
  }),
  person({
    id: "sample_quinn_harris",
    fullName: "Quinn Harris",
    title: "Product Designer",
    company: "On Running",
    domain: "on.com",
    location: "New York, NY",
    school: "Parsons School of Design",
    email: "quinn.harris@on.com",
    phone: "+1 (212) 555-0177",
    tags: ["Design", "Footwear"],
    industry: "Sports",
    seniority: "Senior",
    department: "Design",
    companySize: "1001-5000",
  }),
  person({
    id: "sample_drew_morgan",
    fullName: "Drew Morgan",
    title: "Marketing Intern",
    company: "REI",
    domain: "rei.com",
    location: "New York, NY",
    school: "Colby College",
    email: "drew.morgan@rei.com",
    phone: null,
    tags: ["Internship", "Marketing"],
    industry: "Outdoor / Apparel",
    seniority: "Intern",
    department: "Marketing",
    companySize: "5001-10000",
  }),
  person({
    id: "sample_lena_ortiz",
    fullName: "Lena Ortiz",
    title: "Director of Brand",
    company: "Patagonia",
    domain: "patagonia.com",
    location: "Ventura, CA",
    school: "University of California, Berkeley",
    email: "lena.ortiz@patagonia.com",
    phone: "+1 (805) 555-0102",
    tags: ["Brand", "Leadership"],
    industry: "Outdoor / Apparel",
    seniority: "Director",
    department: "Marketing",
    companySize: "1001-5000",
  }),
  person({
    id: "sample_nina_brooks",
    fullName: "Nina Brooks",
    title: "Partnerships Manager",
    company: "Nike",
    domain: "nike.com",
    location: "Portland, OR",
    school: "University of Michigan",
    email: "nina.brooks@nike.com",
    phone: "+1 (503) 555-0144",
    tags: ["Partnerships", "Sports"],
    industry: "Sports",
    seniority: "Manager",
    department: "Marketing",
    companySize: "10001+",
  }),
  person({
    id: "sample_omar_hassan",
    fullName: "Omar Hassan",
    title: "Software Engineer",
    company: "Stripe",
    domain: "stripe.com",
    location: "New York, NY",
    school: "Columbia University",
    email: "omar.hassan@stripe.com",
    phone: null,
    tags: ["Engineering", "Payments"],
    industry: "Technology",
    seniority: "Senior",
    department: "Engineering",
    companySize: "1001-5000",
  }),
  person({
    id: "sample_priya_nair",
    fullName: "Priya Nair",
    title: "Consultant",
    company: "Deloitte",
    domain: "deloitte.com",
    location: "Chicago, IL",
    school: "New York University",
    email: "priya.nair@deloitte.com",
    phone: "+1 (312) 555-0168",
    tags: ["Consulting", "Strategy"],
    industry: "Consulting",
    seniority: "Senior",
    department: "Consulting",
    companySize: "10001+",
  }),
  person({
    id: "sample_evan_cho",
    fullName: "Evan Cho",
    title: "Investment Banking Analyst",
    company: "Goldman Sachs",
    domain: "goldmansachs.com",
    location: "New York, NY",
    school: "University of Pennsylvania",
    email: "evan.cho@goldmansachs.com",
    phone: "+1 (212) 555-0190",
    tags: ["Finance", "Banking"],
    industry: "Finance",
    seniority: "Analyst",
    department: "Finance",
    companySize: "10001+",
  }),
];

export type SearchFilters = {
  titles: string[];
  industries: string[];
  locations: string[];
  schools: string[];
  includeSimilarSchools: boolean;
  companies: string[];
  seniorities: string[];
  departments: string[];
  companySizes: string[];
  query?: string;
};

const TITLE_STOP = new Set(["intern", "internship", "manager", "senior", "junior", "associate", "specialist", "coordinator", "director", "analyst", "entry", "full", "time"]);

function words(value: string) {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !TITLE_STOP.has(word));
}

function includesAny(value: string | null | undefined, selected: string[]) {
  if (selected.length === 0) return true;
  const hay = (value ?? "").toLowerCase();
  if (!hay) return false;
  return selected.some((item) => {
    const needle = item.toLowerCase();
    return hay.includes(needle) || (needle.length > 3 && hay.length > 3 && needle.includes(hay));
  });
}

function titleMatches(title: string, selected: string[]) {
  if (selected.length === 0) return true;
  if (includesAny(title, selected)) return true;
  const hayWords = new Set(words(title));
  return selected.some((item) => words(item).some((word) => title.toLowerCase().includes(word) || hayWords.has(word)));
}

export function filterSampleDirectory(filters: SearchFilters, schools: string[]) {
  return SAMPLE_CONTACTS.filter((contact) => {
    if (filters.query) {
      const blob = `${contact.fullName} ${contact.title} ${contact.company} ${contact.location}`.toLowerCase();
      if (!blob.includes(filters.query.toLowerCase())) return false;
    }
    if (!titleMatches(contact.title, filters.titles)) return false;
    if (!includesAny(contact.industry, filters.industries)) return false;
    if (!includesAny(contact.location, filters.locations)) return false;
    if (schools.length && !schools.some((school) => (contact.school ?? "").toLowerCase() === school.toLowerCase())) return false;
    if (!includesAny(contact.company, filters.companies)) return false;
    if (!includesAny(contact.seniority, filters.seniorities)) return false;
    if (!includesAny(contact.department, filters.departments)) return false;
    if (!includesAny(contact.companySize, filters.companySizes)) return false;
    return true;
  }).sort((a, b) => score(b, filters) - score(a, filters) || SAMPLE_CONTACTS.indexOf(a) - SAMPLE_CONTACTS.indexOf(b));
}

function score(contact: Contact, filters: SearchFilters) {
  let value = 0;
  if (titleMatches(contact.title, filters.titles) && filters.titles.length) value += 3;
  if (filters.companies.some((item) => contact.company.toLowerCase().includes(item.toLowerCase()))) value += 2;
  if (filters.schools.some((item) => (contact.school ?? "").toLowerCase() === item.toLowerCase())) value += 2;
  if (filters.locations.some((item) => contact.location.toLowerCase().includes(item.toLowerCase()))) value += 1;
  return value;
}

export function closestSampleContacts(filters: SearchFilters, limit = 12) {
  return [...SAMPLE_CONTACTS].sort((a, b) => score(b, filters) - score(a, filters) || SAMPLE_CONTACTS.indexOf(a) - SAMPLE_CONTACTS.indexOf(b)).slice(0, limit);
}
