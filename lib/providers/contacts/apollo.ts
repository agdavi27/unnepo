/**
 * Shared pieces of Apollo People Search for contact unlocks: the query shape, known company domains,
 * and the titles that mean "recruiter".
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

export const RECRUITER_TITLES = ["recruiter", "talent acquisition", "university recruiter", "campus recruiter", "technical recruiter"];
