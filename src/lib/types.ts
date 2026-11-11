export type ID = string;

export interface Grant {
  id: ID;
  title: string;
  funder: string;
  summary: string;
  amount_text?: string;
  amount_usd?: number | null;
  deadline?: string | null; // ISO date
  open_date?: string | null;
  eligibility?: string;
  requirements?: string;
  countries: string[]; // ISO3, or ["GLOBAL"]
  regions?: string[];
  themes?: string[];
  url: string;
  source_id: string;
  source_name: string;
  fetched_at: string;
  score?: number | null; // 0-100 suitability
  strengths?: string[];
  weaknesses?: string[];
  score_reason?: string;
  // Team pipeline fields
  curated?: boolean;
  deadline_text?: string | null;
  sector?: string | null;
  fit?: string | null;
  eligible_as?: string | null;
  geography?: string | null;
  notes?: string | null;
  added_by?: string | null;
  updated_at?: string | null;
}

export interface GrantTracking {
  grant_id: ID;
  assignee?: string | null; // email or name
  status: 'watching' | 'pursuing' | 'submitted' | 'won' | 'lost' | 'dropped';
  updated_at?: string;
}

export interface Comment {
  id: ID;
  entity_type: string;
  entity_id: ID;
  body: string;
  author: string;
  created_at: string;
}

export interface Attachment {
  id: ID;
  entity_type: string;
  entity_id: ID;
  title: string;
  url: string;
  kind: 'link' | 'file' | 'dashboard' | 'document';
  author: string;
  created_at: string;
}

export interface Insight {
  id: ID;
  title: string;
  summary: string;
  url: string;
  published_at: string;
  source_id: string;
  source_name: string;
  kind: 'news' | 'outbreak' | 'research' | 'social' | 'tender' | 'report';
  countries: string[];
  diseases?: string[];
}

export interface Source {
  id: string;
  name: string;
  category: 'grants' | 'insights' | 'datasets';
  type: string; // rss | grantsgov | json | pubmed | gemini_search | who_don | gho | opendengue
  url: string;
  enabled: boolean;
  notes?: string;
  kind?: string | null;
  unit?: string | null;
  display_name?: string | null;
  last_run?: string | null;
  last_status?: 'ok' | 'error' | 'skipped' | null;
  last_message?: string | null;
  item_count?: number | null;
}

export interface HealthIndicator {
  key: string;
  name: string;
  unit: string;
  source_name: string;
  source_url: string;
  years: number[];
  values: Record<string, Record<string, number>>; // ISO3 -> year -> value
}

export interface HealthData {
  updated_at: string | null;
  indicators: HealthIndicator[];
  names?: Record<string, string>;
}

export interface TemplateSection {
  key: string;
  title: string;
}

/** One step in a milestone's status flow; `kind` drives colour, progress and the "lost" warning. */
export interface FlowStatus {
  key: string;
  label: string;
  kind: 'todo' | 'active' | 'blocked' | 'done' | 'lost';
}

/** Template checkpoint: a title and an optional list of tasks. */
export interface TemplateCheckpoint {
  title: string;
  tasks: string[];
}

export interface TemplateMilestone {
  key: string;
  name: string;
  description?: string;
  statuses?: FlowStatus[];
  checkpoints?: TemplateCheckpoint[];
  sections?: TemplateSection[]; // older templates only
}

export interface CheckpointTask {
  id: string;
  title: string;
  done: boolean;
}

/** Fields shared by milestone_checkpoints and grant_checkpoints. */
export interface CheckpointBase {
  id: ID;
  position: number;
  title: string;
  target_date?: string | null;
  completed_on?: string | null;
  owner?: string | null;
  notes?: string | null;
  tasks: CheckpointTask[];
  updated_at?: string;
}

/** A row in milestone_checkpoints. */
export interface Checkpoint extends CheckpointBase {
  milestone_id: ID;
  project_id: ID;
}

/** A row in grant_checkpoints. */
export interface GrantCheckpoint extends CheckpointBase {
  grant_id: ID;
}

export interface MilestoneTemplate {
  id: ID;
  name: string;
  description?: string;
  milestones: TemplateMilestone[];
}

export interface Project {
  id: ID;
  slug: string;
  name: string;
  summary: string;
  countries: string[];
  diseases: string[];
  funder?: string;
  status: 'idea' | 'applying' | 'active' | 'scaling' | 'closed';
  lead?: string;
  start_date?: string | null;
  end_date?: string | null;
  template_id?: ID;
  links: { title: string; url: string; kind: 'dashboard' | 'document' | 'repo' | 'link' }[];
  grant_amount?: number | null;
  contracted_amount?: number | null;
  currency?: string | null;
  created_at?: string;
}

export interface ProjectMilestone {
  id: ID;
  project_id: ID;
  key: string;
  name: string;
  order: number;
  status: string; // a key from `flow`
  start_date?: string | null;
  target_date?: string | null;
  owner?: string;
  team?: string;
  progress: number; // 0-100
  flow?: FlowStatus[] | null;
}

export interface Page {
  id: ID;
  project_id: ID;
  milestone_id: ID;
  title: string;
  content_md: string;
  content_json?: any[] | null;
  updated_at: string;
  updated_by?: string;
}

export interface OrgContext {
  content_md: string;
  updated_at: string;
}

export interface Country {
  iso3: string;
  name: string;
  region: string; // continent / subregion group
  subregion?: string;
  lng: number;
  lat: number;
}
