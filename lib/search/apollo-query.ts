/**
 * Builds Apollo People API Search requests. Every filter Apollo receives is ANDed, so a search
 * runs as a ladder: the strictest useful filters first, then looser steps until enough people
 * are found. People API Search costs no Apollo credits, so extra steps only add latency.
 */

export type ApolloPeopleQuery = {
  person_titles?: string[];
  person_locations?: string[];
  person_seniorities?: string[];
  q_organization_domains_list?: string[];
  organization_industries?: string[];
  organization_num_employees_ranges?: string[];
  q_keywords?: string;
};

export type LadderStep = { label: string; query: ApolloPeopleQuery };

/** Domains for companies the onboarding suggests. Anything else is looked up in Apollo once and cached. */
export const COMPANY_DOMAINS: Record<string, string[]> = {
  "accenture": ["accenture.com"], "adidas": ["adidas.com"], "adobe": ["adobe.com"], "airbnb": ["airbnb.com"], "allbirds": ["allbirds.com"],
  "amazon": ["amazon.com"], "anthropic": ["anthropic.com"], "apple": ["apple.com"], "arc'teryx": ["arcteryx.com"], "bain & company": ["bain.com"],
  "bank of america": ["bankofamerica.com"], "ben & jerry's": ["benjerry.com"], "blackrock": ["blackrock.com"], "blackstone": ["blackstone.com"],
  "boston consulting group": ["bcg.com"], "bcg": ["bcg.com"], "burton": ["burton.com"], "canada goose": ["canadagoose.com"], "canva": ["canva.com"],
  "cbre": ["cbre.com"], "chobani": ["chobani.com"], "cisco": ["cisco.com"], "citadel": ["citadel.com"], "coca-cola": ["coca-colacompany.com", "coca-cola.com"],
  "columbia sportswear": ["columbia.com"], "compass": ["compass.com"], "cotopaxi": ["cotopaxi.com"], "coursera": ["coursera.org"], "cvs health": ["cvshealth.com"],
  "deloitte": ["deloitte.com"], "disney": ["disney.com", "thewaltdisneycompany.com"], "dropbox": ["dropbox.com"], "duolingo": ["duolingo.com"],
  "electronic arts": ["ea.com"], "epic games": ["epicgames.com"], "espn": ["espn.com"], "ey": ["ey.com"], "fender": ["fender.com"], "fidelity": ["fidelity.com"],
  "figma": ["figma.com"], "gap": ["gapinc.com"], "ge": ["ge.com"], "gibson": ["gibson.com"], "glossier": ["glossier.com"], "goldman sachs": ["gs.com", "goldmansachs.com"],
  "google": ["google.com"], "habitat for humanity": ["habitat.org"], "herman miller": ["hermanmiller.com", "millerknoll.com"], "hoka": ["hoka.com"], "hubspot": ["hubspot.com"],
  "ibm": ["ibm.com"], "ideo": ["ideo.com"], "j.p. morgan": ["jpmorgan.com", "jpmorganchase.com"], "jpmorgan": ["jpmorgan.com", "jpmorganchase.com"], "jll": ["jll.com"],
  "johnson & johnson": ["jnj.com"], "khan academy": ["khanacademy.org"], "kpmg": ["kpmg.com", "kpmg.us"], "l.l.bean": ["llbean.com"], "linkedin": ["linkedin.com"],
  "liquid death": ["liquiddeath.com"], "live nation": ["livenation.com"], "lululemon": ["lululemon.com"], "marmot": ["marmot.com"], "mastercard": ["mastercard.com"],
  "mayo clinic": ["mayoclinic.org"], "mckinsey": ["mckinsey.com"], "meta": ["meta.com", "facebook.com"], "microsoft": ["microsoft.com"], "moderna": ["modernatx.com"],
  "morgan stanley": ["morganstanley.com"], "nasa": ["nasa.gov"], "netflix": ["netflix.com"], "new balance": ["newbalance.com"], "nike": ["nike.com"],
  "nintendo": ["nintendo.com"], "notion": ["notion.so"], "nvidia": ["nvidia.com"], "openai": ["openai.com"], "oracle": ["oracle.com"], "patagonia": ["patagonia.com"],
  "peloton": ["onepeloton.com"], "pepsico": ["pepsico.com"], "pfizer": ["pfizer.com"], "procter & gamble": ["pg.com"], "pwc": ["pwc.com"], "ramp": ["ramp.com"],
  "red bull": ["redbull.com"], "rei": ["rei.com"], "riot games": ["riotgames.com"], "rivian": ["rivian.com"], "roblox": ["roblox.com"], "salesforce": ["salesforce.com"],
  "salomon": ["salomon.com"], "shopify": ["shopify.com"], "slack": ["slack.com"], "smartwool": ["smartwool.com"], "sonos": ["sonos.com"], "soundcloud": ["soundcloud.com"],
  "spacex": ["spacex.com"], "spotify": ["spotify.com"], "starbucks": ["starbucks.com"], "stripe": ["stripe.com"], "sweetgreen": ["sweetgreen.com"], "target": ["target.com"],
  "teach for america": ["teachforamerica.org"], "tesla": ["tesla.com"], "the nature conservancy": ["nature.org"], "the new york times": ["nytimes.com"], "the north face": ["thenorthface.com"],
  "timberland": ["timberland.com"], "uber": ["uber.com"], "under armour": ["underarmour.com"], "unilever": ["unilever.com"], "universal music group": ["umusic.com", "universalmusic.com"],
  "valve": ["valvesoftware.com"], "visa": ["visa.com"], "vuori": ["vuoriclothing.com"], "warby parker": ["warbyparker.com"], "wayfair": ["wayfair.com"], "whole foods": ["wholefoodsmarket.com"],
  "yeti": ["yeti.com"], "zillow": ["zillow.com"], "boeing": ["boeing.com"], "lockheed martin": ["lockheedmartin.com"], "brex": ["brex.com"], "ralph lauren": ["ralphlauren.com"],
  "aritzia": ["aritzia.com"], "condé nast": ["condenast.com"], "vox media": ["voxmedia.com"], "nbcuniversal": ["nbcuniversal.com"], "unitedhealth group": ["unitedhealthgroup.com"],
  "medtronic": ["medtronic.com"], "cushman & wakefield": ["cushmanwakefield.com"], "brookfield": ["brookfield.com"], "chegg": ["chegg.com"], "pearson": ["pearson.com"],
  "activision blizzard": ["activisionblizzard.com"], "beyond meat": ["beyondmeat.com"], "outdoor voices": ["outdoorvoices.com"], "pentagram": ["pentagram.com"],
};

/** Onboarding interests as Apollo industry names (exact, lowercase). */
export const INTEREST_INDUSTRIES: Record<string, string[]> = {
  Technology: ["information technology & services", "computer software", "internet"],
  Marketing: ["marketing & advertising"],
  Finance: ["financial services", "investment banking", "banking", "investment management"],
  Consulting: ["management consulting"],
  Entrepreneurship: ["internet", "computer software", "venture capital & private equity"],
  Music: ["music", "entertainment"],
  Sports: ["sports", "sporting goods"],
  "Outdoor & Adventure": ["sporting goods", "apparel & fashion", "recreational facilities & services"],
  Fashion: ["apparel & fashion", "luxury goods & jewelry", "retail"],
  Design: ["design", "graphic design"],
  Healthcare: ["hospital & health care", "pharmaceuticals", "medical devices"],
  Media: ["media production", "online media", "publishing", "broadcast media", "entertainment"],
  Engineering: ["mechanical or industrial engineering", "civil engineering", "aviation & aerospace", "automotive"],
  "Real Estate": ["real estate", "commercial real estate"],
  Education: ["education management", "e-learning", "higher education"],
  Nonprofits: ["nonprofit organization management", "philanthropy"],
  Government: ["government administration", "public policy"],
  "Food & Beverage": ["food & beverages", "food production", "consumer goods"],
  Gaming: ["computer games"],
  Sustainability: ["renewables & environment", "environmental services"],
};

export function industriesFor(interests: string[]) {
  return [...new Set(interests.flatMap((interest) => INTEREST_INDUSTRIES[interest] ?? []))];
}

export const EMPLOYEE_RANGES: Record<string, string[]> = {
  "1-10": ["1,10"],
  "11-50": ["11,50"],
  "51-200": ["51,200"],
  "201-500": ["201,500"],
  "501-1000": ["501,1000"],
  "1001+": ["1001,1000000"],
};
export const SMALL_COMPANY_RANGES = ["1,10", "11,50", "51,200"];

export const RECRUITER_TITLES = ["recruiter", "talent acquisition", "university recruiter", "campus recruiter", "technical recruiter"];
export const HIRING_MANAGER_SENIORITIES = ["manager", "director", "head"];

/** Drops empty filters so Apollo only sees what is set. */
export function cleanQuery(query: ApolloPeopleQuery): ApolloPeopleQuery {
  const out: ApolloPeopleQuery = {};
  for (const [key, value] of Object.entries(query) as Array<[keyof ApolloPeopleQuery, ApolloPeopleQuery[keyof ApolloPeopleQuery]]>) {
    if (Array.isArray(value) ? value.length : typeof value === "string" && value.trim()) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Keeps the first time each distinct query appears and skips steps with no filters at all. */
export function ladder(steps: LadderStep[]) {
  const seen = new Set<string>();
  const out: LadderStep[] = [];
  for (const step of steps) {
    const query = cleanQuery(step.query);
    const key = JSON.stringify(query);
    if (!Object.keys(query).length || seen.has(key)) continue;
    seen.add(key);
    out.push({ label: step.label, query });
  }
  return out;
}
