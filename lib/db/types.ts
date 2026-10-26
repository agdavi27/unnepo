export type OutreachStatus =
  | "not_contacted"
  | "contacted"
  | "follow_up_needed"
  | "replied"
  | "interested"
  | "interview_scheduled"
  | "closed";

export type OnboardingStep = "profile" | "goals" | "resume" | "mailbox" | "done";

export type User = {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string | null;
  name: string;
  schoolEmailVerifiedAt: string | null;
  authProvider: "password" | "google" | "microsoft";
  createdAt: string;
  referralCode: string;
  referredByUserId: string | null;
  onboardingStep: OnboardingStep;
  role: "student" | "admin";
  deletedAt: string | null;
  demoUser: boolean;
};

export type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

export type VerifyToken = {
  id: string;
  userId: string;
  purpose: "verify_email" | "reset_password";
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

export type Profile = {
  userId: string;
  name: string;
  school: string;
  major: string;
  graduationYear: string;
  bio: string;
  avatarPath: string | null;
  updatedAt: string;
};

export type CareerGoals = {
  userId: string;
  roles: string[];
  industries: string[];
  locations: string[];
  companies: string[];
  updatedAt: string;
};

export type ResumeFactCategory =
  | "education"
  | "experience"
  | "internship"
  | "project"
  | "skill"
  | "leadership"
  | "achievement"
  | "interest"
  | "goal";

export type Resume = {
  id: string;
  userId: string;
  fileName: string;
  mime: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
  text: string;
  createdAt: string;
};

export type ResumeFact = {
  id: string;
  userId: string;
  resumeId: string;
  category: ResumeFactCategory;
  label: string;
  detail: string;
  sourceExcerpt: string;
  edited: boolean;
  createdAt: string;
};

export type CreditAccount = {
  userId: string;
  balance: number;
  reserved: number;
  purchasedBalance: number;
  allowanceBalance: number;
  includedAllowance: number;
  plan: "free" | "grind" | "pack";
  updatedAt: string;
};

export type LedgerEntryType =
  | "signup_grant"
  | "referral_reward"
  | "subscription_grant"
  | "purchase_grant"
  | "unlock_debit"
  | "search_debit"
  | "refund_clawback"
  | "demo_grant"
  | "adjustment";

export type LedgerEntry = {
  id: string;
  userId: string;
  entryType: LedgerEntryType;
  amount: number;
  bucket: "allowance" | "purchased";
  idempotencyKey: string;
  referenceType: string | null;
  referenceId: string | null;
  demo: boolean;
  note: string | null;
  createdAt: string;
};

export type Reservation = {
  id: string;
  userId: string;
  contactId: string;
  amount: number;
  allowancePart: number;
  purchasedPart: number;
  status: "reserved" | "finalized" | "released";
  idempotencyKey: string;
  result: { savedId: string; charged: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactFact = {
  key: string;
  label: string;
  detail: string;
  source: string;
};

export type Contact = {
  id: string;
  externalId: string;
  provider: "sample" | "apollo" | "hunter";
  fullName: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  companyDomain: string | null;
  location: string;
  school: string | null;
  profileUrl: string | null;
  email: string | null;
  emailStatus: "unknown" | "available" | "verified" | "unverified" | "unavailable";
  phone: string | null;
  phoneStatus: "unknown" | "available" | "verified" | "unavailable";
  tags: string[];
  seniority: string | null;
  department: string | null;
  industry: string | null;
  companySize: string | null;
  interests: string[];
  previousRoles: string[];
  achievements: string[];
  publicPosts: ContactFact[];
  verifiedMutuals: string[];
  shareable: boolean;
  licenseNote: string;
  dataSource: "sample" | "provider";
  fetchedAt: string;
  expiresAt: string;
  costCents: number;
  costEstimated: boolean;
};

export type SearchRecord = {
  id: string;
  userId: string;
  filters: Record<string, unknown>;
  resultCount: number;
  provider: string;
  costCents: number;
  createdAt: string;
};

export type SavedContact = {
  id: string;
  userId: string;
  contactId: string;
  status: OutreachStatus;
  notes: string;
  followUpAt: string | null;
  listName: string;
  creditCharged: boolean;
  unlockedAt: string;
  optOut: boolean;
  autoFollowUpAuthorized: boolean;
  updatedAt: string;
};

export type Mailbox = {
  id: string;
  userId: string;
  provider: "gmail" | "outlook" | "demo";
  email: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  expiresAt: string | null;
  connectedAt: string;
};

export type EmailDraft = {
  id: string;
  userId: string;
  savedContactId: string;
  subject: string;
  body: string;
  tone: string;
  purpose: string;
  selectedFactIds: string[];
  attachResume: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmailMessage = {
  id: string;
  userId: string;
  savedContactId: string;
  direction: "outbound" | "inbound";
  provider: "gmail" | "outlook" | "demo";
  providerMessageId: string | null;
  providerThreadId: string | null;
  subject: string;
  body: string;
  status: "draft" | "demo_outbox" | "sent" | "failed" | "replied";
  deliveryConfirmed: boolean;
  idempotencyKey: string;
  classification: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type FollowUp = {
  id: string;
  userId: string;
  savedContactId: string;
  dueAt: string;
  note: string;
  status: "open" | "done" | "cancelled";
  autoSend: boolean;
  createdAt: string;
};

export type AiGeneration = {
  id: string;
  userId: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  estimated: boolean;
  createdAt: string;
};

export type ProviderUsage = {
  id: string;
  userId: string | null;
  provider: string;
  operation: string;
  success: boolean;
  latencyMs: number;
  costCents: number;
  estimated: boolean;
  error: string | null;
  createdAt: string;
};

export type Payment = {
  id: string;
  userId: string;
  stripeEventId: string | null;
  stripeCheckoutId: string | null;
  stripePaymentIntent: string | null;
  amountCents: number;
  currency: string;
  kind: "subscription" | "pack";
  status: "paid" | "refunded" | "demo";
  creditsGranted: number;
  demo: boolean;
  createdAt: string;
};

export type Subscription = {
  id: string;
  userId: string;
  stripeSubscriptionId: string;
  status: "active" | "canceled" | "past_due" | "demo";
  priceCents: number;
  currentPeriodEnd: string | null;
  createdAt: string;
};

export type Referral = {
  id: string;
  referrerId: string;
  referredUserId: string;
  code: string;
  status: "pending" | "rewarded" | "rejected";
  reason: string | null;
  createdAt: string;
  rewardedAt: string | null;
};

export type JobPosting = {
  id: string;
  externalId: string;
  provider: "sample" | "adzuna";
  title: string;
  company: string;
  location: string;
  postedAt: string;
  url: string;
  industry: string | null;
  dataSource: "sample" | "provider";
  description: string;
};

export type SavedJob = {
  id: string;
  userId: string;
  jobId: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  userId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AnalyticsEvent = {
  id: string;
  userId: string | null;
  name: string;
  properties: Record<string, unknown>;
  createdAt: string;
};

export type WebhookEvent = {
  id: string;
  provider: string;
  eventId: string;
  createdAt: string;
};

export type IdempotencyRecord = {
  key: string;
  status: "pending" | "done";
  result: unknown;
  createdAt: string;
};

export type OAuthState = {
  id: string;
  state: string;
  provider: string;
  userId: string | null;
  purpose: "login" | "mailbox";
  redirectOrigin: string;
  createdAt: string;
  expiresAt: string;
};

export type Database = {
  users: User[];
  sessions: Session[];
  tokens: VerifyToken[];
  profiles: Profile[];
  goals: CareerGoals[];
  resumes: Resume[];
  facts: ResumeFact[];
  accounts: CreditAccount[];
  ledger: LedgerEntry[];
  reservations: Reservation[];
  contacts: Contact[];
  searches: SearchRecord[];
  saved: SavedContact[];
  mailboxes: Mailbox[];
  drafts: EmailDraft[];
  messages: EmailMessage[];
  followups: FollowUp[];
  generations: AiGeneration[];
  usage: ProviderUsage[];
  payments: Payment[];
  subscriptions: Subscription[];
  referrals: Referral[];
  jobs: JobPosting[];
  savedJobs: SavedJob[];
  audits: AuditLog[];
  analytics: AnalyticsEvent[];
  webhooks: WebhookEvent[];
  idempotency: IdempotencyRecord[];
  oauthStates: OAuthState[];
};

export function emptyDatabase(): Database {
  return {
    users: [],
    sessions: [],
    tokens: [],
    profiles: [],
    goals: [],
    resumes: [],
    facts: [],
    accounts: [],
    ledger: [],
    reservations: [],
    contacts: [],
    searches: [],
    saved: [],
    mailboxes: [],
    drafts: [],
    messages: [],
    followups: [],
    generations: [],
    usage: [],
    payments: [],
    subscriptions: [],
    referrals: [],
    jobs: [],
    savedJobs: [],
    audits: [],
    analytics: [],
    webhooks: [],
    idempotency: [],
    oauthStates: [],
  };
}
