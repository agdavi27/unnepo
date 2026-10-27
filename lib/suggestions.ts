import { COMPANIES, JOB_TITLES, LOCATIONS } from "@/lib/catalog";
import { SCHOOLS } from "@/lib/schools";

/** Typeahead options for onboarding. Students can still type anything; these only speed it up. */

function merge(...lists: ReadonlyArray<readonly string[]>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export const COLLEGE_SUGGESTIONS = merge(SCHOOLS, [
  "American University", "Arizona State University", "Auburn University", "Babson College", "Barnard College", "Baylor University",
  "Bentley University", "Binghamton University", "Boston University", "Brandeis University", "Bryant University", "Bucknell University",
  "California Institute of Technology", "California Polytechnic State University", "Carleton College", "Carnegie Mellon University",
  "Case Western Reserve University", "Claremont McKenna College", "Clemson University", "Colgate University", "College of Charleston",
  "College of the Holy Cross", "College of William & Mary", "Colorado College", "Colorado State University", "Connecticut College",
  "Davidson College", "Denison University", "DePaul University", "Drexel University", "Elon University", "Emerson College", "Emory University",
  "Fairfield University", "Florida State University", "Fordham University", "Franklin & Marshall College", "George Washington University",
  "Georgia Institute of Technology", "Gettysburg College", "Grinnell College", "Hamilton College", "Harvey Mudd College", "Haverford College",
  "High Point University", "Indiana University Bloomington", "Iowa State University", "Johns Hopkins University", "Kenyon College",
  "Lafayette College", "Lehigh University", "Loyola Marymount University", "Loyola University Chicago", "Macalester College", "Marist College",
  "Marquette University", "Massachusetts Institute of Technology", "Miami University", "Michigan State University", "Northeastern University",
  "Oberlin College", "Ohio State University", "Oregon State University", "Penn State University", "Pepperdine University", "Pomona College",
  "Providence College", "Purdue University", "Quinnipiac University", "Reed College", "Rensselaer Polytechnic Institute", "Rice University",
  "Rochester Institute of Technology", "Rutgers University", "Santa Clara University", "Sarah Lawrence College", "Skidmore College",
  "Smith College", "Southern Methodist University", "St. Lawrence University", "Stony Brook University", "Swarthmore College",
  "Syracuse University", "Temple University", "Texas A&M University", "Texas Christian University", "Trinity College", "Tufts University",
  "Tulane University", "Union College", "University of Arizona", "University of California, Davis", "University of California, Irvine",
  "University of California, Los Angeles", "University of California, San Diego", "University of California, Santa Barbara",
  "University of Chicago", "University of Colorado Boulder", "University of Connecticut", "University of Delaware", "University of Denver",
  "University of Florida", "University of Georgia", "University of Illinois Urbana-Champaign", "University of Iowa", "University of Maine",
  "University of Maryland", "University of Massachusetts Amherst", "University of Miami", "University of Minnesota", "University of New Hampshire",
  "University of North Carolina at Chapel Hill", "University of Notre Dame", "University of Oregon", "University of Rochester",
  "University of San Diego", "University of South Carolina", "University of Southern California", "University of Tennessee",
  "University of Utah", "University of Vermont", "University of Virginia", "University of Wisconsin-Madison", "Vanderbilt University",
  "Vassar College", "Villanova University", "Virginia Tech", "Wake Forest University", "Washington University in St. Louis",
  "Wellesley College", "Wesleyan University", "Wheaton College", "Worcester Polytechnic Institute",
]);

export const MAJOR_SUGGESTIONS = [
  "Accounting", "African American Studies", "American Studies", "Anthropology", "Applied Mathematics", "Architecture", "Art", "Art History",
  "Astronomy", "Biochemistry", "Biology", "Biomedical Engineering", "Business Administration", "Chemical Engineering", "Chemistry",
  "Civil Engineering", "Classics", "Cognitive Science", "Communications", "Computer Engineering", "Computer Science", "Creative Writing",
  "Data Science", "Economics", "Education", "Electrical Engineering", "English", "Entrepreneurship", "Environmental Science",
  "Environmental Studies", "Film and Media Studies", "Finance", "French", "Gender Studies", "Geology", "Global Studies", "Graphic Design",
  "Health Sciences", "History", "Hospitality Management", "Human Resources", "Industrial Engineering", "Information Systems",
  "International Business", "International Relations", "Journalism", "Kinesiology", "Latin American Studies", "Linguistics", "Management",
  "Marketing", "Mathematics", "Mechanical Engineering", "Music", "Neuroscience", "Nursing", "Philosophy", "Physics", "Political Science",
  "Psychology", "Public Health", "Public Policy", "Real Estate", "Religious Studies", "Sociology", "Spanish", "Sport Management",
  "Statistics", "Studio Art", "Supply Chain Management", "Sustainability", "Theater", "Urban Studies",
];

export const ROLE_SUGGESTIONS = merge(JOB_TITLES, [
  "Account Manager", "Brand Manager", "Brand Strategist", "Business Operations", "Category Manager", "Community Manager",
  "Consultant", "Content Creator", "Copywriter", "Corporate Development", "Creative Strategist", "Data Engineer", "eCommerce",
  "eCommerce Manager", "Equity Research", "Event Marketing", "Influencer Marketing", "Investment Analyst", "Machine Learning Engineer",
  "Management Consultant", "Market Research Analyst", "Merchandising", "Partnerships Manager", "Private Equity", "Product Analyst",
  "Product Operations", "Program Manager", "Research Analyst", "Retail Buyer", "Sales", "Social Impact", "Software Developer",
  "Sports Marketing", "Strategy & Operations", "Sustainability Manager", "Technical Program Manager", "UX Researcher", "Venture Capital",
]);

export const COMPANY_SUGGESTIONS = merge(COMPANIES, [
  "Accenture", "Adidas", "Adobe", "Anthropic", "Apple", "Bain & Company", "Bank of America", "Ben & Jerry's", "BlackRock", "Boston Consulting Group",
  "Burton", "Canada Goose", "Chobani", "Cisco", "Coca-Cola", "Columbia Sportswear", "Disney", "Dropbox", "EY", "ESPN", "Fender", "Gap",
  "Glossier", "Goldman Sachs", "Hoka", "IBM", "J.P. Morgan", "Johnson & Johnson", "KPMG", "L.L.Bean", "LinkedIn", "Marmot", "Mastercard",
  "Morgan Stanley", "Netflix", "New Balance", "Nvidia", "OpenAI", "Oracle", "Outdoor Voices", "PepsiCo", "PwC", "Peloton", "Procter & Gamble",
  "Red Bull", "Salesforce", "Shopify", "Slack", "Smartwool", "Starbucks", "Target", "Tesla", "Timberland", "Uber", "Under Armour",
  "Unilever", "Visa", "Warby Parker", "Wayfair", "Whole Foods",
]);

export const LOCATION_SUGGESTIONS = merge(LOCATIONS, [
  "Anywhere in the US", "Atlanta, GA", "Baltimore, MD", "Burlington, VT", "Charlotte, NC", "Dallas, TX", "Detroit, MI", "Hartford, CT",
  "Houston, TX", "Jackson, WY", "London, UK", "Madison, WI", "Minneapolis, MN", "Nashville, TN", "New Haven, CT", "Philadelphia, PA",
  "Phoenix, AZ", "Pittsburgh, PA", "Portland, ME", "Providence, RI", "Raleigh, NC", "Salt Lake City, UT", "San Diego, CA", "San Jose, CA",
  "Santa Monica, CA", "St. Louis, MO", "Toronto, ON",
]);

export const INTEREST_SUGGESTIONS = [
  "Backpacking", "Baking", "Basketball", "Board games", "Chess", "Climbing", "Coding side projects", "Cooking", "Cycling", "Dance",
  "Debate", "Drawing", "Fishing", "Film", "Fly fishing", "Gaming", "Gardening", "Golf", "Guitar", "Guitar building", "Hiking", "Hockey",
  "Investing", "Lacrosse", "Mountain biking", "Music production", "Painting", "Photography", "Piano", "Podcasts", "Reading", "Rowing",
  "Running", "Sailing", "Skiing", "Snowboarding", "Soccer", "Surfing", "Swimming", "Tennis", "Theater", "Trail running", "Travel",
  "Volunteering", "Writing", "Yoga",
];

/** Best matches first: whole-value prefix, then word prefix, then anywhere. */
export function rankSuggestions(options: readonly string[], query: string, exclude: string[] = [], limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude.map((item) => item.trim().toLowerCase()));
  const scored: Array<[number, string]> = [];
  for (const option of options) {
    const lower = option.toLowerCase();
    if (skip.has(lower) || lower === q) continue;
    let score = -1;
    if (lower.startsWith(q)) score = 0;
    else if (lower.split(/[\s,&/-]+/).some((word) => word.startsWith(q))) score = 1;
    else if (lower.includes(q)) score = 2;
    if (score >= 0) scored.push([score, option]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).slice(0, limit).map(([, option]) => option);
}
