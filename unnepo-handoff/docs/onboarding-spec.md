# Resume-first onboarding ("getting to know you")

Goal: collect everything a job application asks for, with the least typing. The profile is what the extension fills forms from, what the mapper sends to the model, and what job recommendations score against.

## Flow
1. **Upload resume** (PDF or DOCX; reuse `lib/resume/parse.ts`, `lib/pdf/text.ts`, `mammoth`). One cheap model call (Haiku-class) extracts structured JSON matching the schema below. No resume? Offer "Fill it in myself" and skip to step 3 with an empty profile.
2. **Confirm what we found.** One screen grouped by section (Contact, Education, Experience, Projects, Skills, Links). Every extracted value is pre-filled and editable, with a small "from your resume" tag. Student fixes anything wrong and confirms.
3. **Fill the gaps — only what's missing.** Ask, one short card at a time, only the questions the resume couldn't answer. Order:
   - Work authorization: authorized to work in the US? Need sponsorship now or in future?
   - Graduation date (month/year) if missing; GPA (optional)
   - Phone, location (city/state), willing to relocate
   - Links: LinkedIn, GitHub, portfolio (skip if found)
   - EEO / demographics (gender, race/ethnicity, veteran, disability) — every option includes "Decline to answer", which is the default
   - What you're looking for: role types, industries, locations / remote, start term (e.g. Summer 2027), internship vs full-time — used for "Jobs you may like"
   - Standard answers: "How did you hear about us?", earliest start date, salary expectation (optional), willing to work in person
   - Short essays (optional, can skip): a 2–3 sentence "about me" and "why I'm interested in [field]" — reused as seeds for essay questions and outreach emails
4. **Job-site account email** (for the extension's auto account creation) — default to their email; passwords never go to the server (see decisions.md).
5. **Install the extension** — final screen: "Add to Chrome", then the extension signs in and pulls the profile.

Show a progress bar ("Profile 80% ready"). Everything is editable later on a Profile page with the same sections.

## Profile schema (application profile)
```ts
type ApplicationProfile = {
  contact: { firstName; lastName; preferredName?; email; phone?; city?; state?; country?; zip?; willingToRelocate?: boolean };
  links: { linkedin?; github?; portfolio?; other?: string[] };
  education: { school; degree; major; minor?; gpa?; startDate?; gradDate; coursework?: string[] }[];
  experience: { company; title; location?; startDate; endDate?; current: boolean; bullets: string[] }[];
  projects: { name; role?; url?; bullets: string[]; tech?: string[] }[];
  skills: { technical: string[]; languages?: string[]; certifications?: string[] };
  workAuth: { authorizedUS: boolean | null; needsSponsorship: boolean | null; citizenship?: string };
  eeo: { gender; race; hispanicLatino; veteran; disability }; // each defaults to "decline"
  preferences: { roles: string[]; industries: string[]; locations: string[]; remote: "yes" | "no" | "either"; startTerm?: string; jobType: "internship" | "full_time" | "either" };
  standardAnswers: { heardAbout?; earliestStart?; salaryExpectation?; inPerson?: boolean };
  essays: { aboutMe?; whyField? };
  savedAnswers: { question: string; answer: string; updatedAt: string }[]; // grows as the student answers new questions in the extension
  sources: Record<string, "resume" | "student" | "ai">; // field path -> where the value came from
  resumeFileId?: string;
};
```

## Data
- New Supabase migration `0005_application_profile.sql`: `application_profiles` (user_id PK, profile jsonb, completeness int, updated_at) with RLS so a user only reads/writes their own row. Keep the existing local file-store mode working.
- `savedAnswers` is how the extension "learns": when a student types an answer to a new question during an application, save it, and match similar questions later (fuzzy match on normalized question text, no AI).

## API
- `POST /api/profile/resume` — upload + parse → returns extracted profile + list of missing fields
- `GET/PUT /api/profile` — read/update the application profile
- `GET /api/profile/missing` — ordered list of gap questions still unanswered
- Extension uses `GET /api/profile` with its token.
