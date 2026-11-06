import type { MilestoneTemplate } from './types';

const s = (title: string) => ({ key: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title });

export const DEFAULT_TEMPLATES: MilestoneTemplate[] = [
  {
    id: 'tpl_health_ai',
    name: 'Health AI programme (grant to scale)',
    description: 'From grant application through requirements, budget, build, adoption and QA. Rename, reorder or drop milestones per project.',
    milestones: [
      {
        key: 'grant-application',
        name: 'Grant Application',
        description: 'Win the funding. Track the call, the proposal and each review round.',
        stages: [
          { key: 'submission', label: 'Submission' },
          { key: 'review1', label: 'Review 1' },
          { key: 'review2', label: 'Review 2' },
          { key: 'grant', label: 'Grant' },
        ],
        sections: [s('Call summary'), s('Eligibility and fit'), s('Proposal and attachments'), s('Submission checklist'), s('Reviewer feedback')],
      },
      {
        key: 'requirement-context',
        name: 'Requirement Context',
        description: 'Everything the solution must answer to: ground reality, evidence, funder, organisation, contract and regulation.',
        sections: [
          s('Ground Insights'),
          s('Research, Literature and Evidence'),
          s('Funding Requirements'),
          s('Organisation Requirements'),
          s('Fund Contract Requirements'),
          s('Similar Solutions and Interventions Globally'),
          s('Regulatory Limitations and Acceptance Criteria'),
        ],
      },
      {
        key: 'budget-financials',
        name: 'Budget & Financials',
        description: 'Expected vs actual: fund budget → WAIG contracted → WAIG spend → ground partners.',
        sections: [s('Funds flow'), s('Budget by line'), s('Expected vs actual'), s('P&L for this contract'), s('Balance sheet: Capex, Opex, Investments'), s('Disbursements to partners')],
      },
      {
        key: 'technical-implementation',
        name: 'Technical Implementation',
        description: 'Design and build. Paragraphs plus Mermaid diagrams.',
        sections: [
          s('Intro'),
          s('Datasets & Database'),
          s('Data Annotation Plan'),
          s('System Architecture'),
          s('Model Architecture'),
          s('Sequence Diagram'),
          s('API Contracts'),
          s('Field Product / Interface'),
          s('Validation Product'),
          s('Risks'),
          s('Front-end Tasks: Scope & Timeline'),
          s('Back-end Tasks: Scope & Timeline'),
          s('Integration Testing'),
          s('Rollout Plan'),
        ],
      },
      {
        key: 'adoption-mechanism',
        name: 'Adoption Mechanism',
        description: 'How the programme runs on the ground and reaches scale.',
        sections: [s('Program Delivery Design On-Ground'), s('User Personas and Ground Realities'), s('Funding Milestones + Technical Rollout Plan'), s('Scale-up Plan')],
      },
      {
        key: 'testing-qa',
        name: 'Testing & QA',
        description: 'Prove it works for users and is safe to deploy.',
        sections: [s('UAT'), s('UXT'), s('Validation / QA Workflow')],
      },
    ],
  },
  {
    id: 'tpl_grant_only',
    name: 'Grant pursuit only',
    description: 'For a call we are applying to before a project exists.',
    milestones: [
      {
        key: 'grant-application',
        name: 'Grant Application',
        stages: [
          { key: 'submission', label: 'Submission' },
          { key: 'review1', label: 'Review 1' },
          { key: 'review2', label: 'Review 2' },
          { key: 'grant', label: 'Grant' },
        ],
        sections: [s('Call summary'), s('Eligibility and fit'), s('Partners'), s('Budget outline'), s('Submission checklist')],
      },
    ],
  },
];

export const DEFAULT_ORG_CONTEXT = `# Wadhwani AI Global: context for grant scoring

Gemini reads this page when it scores each grant for suitability. Keep it short, factual and current.

## Who we are
Wadhwani AI Global (WAIG) builds and deploys AI for public health and education in low- and middle-income countries, working with governments and implementing partners. It builds on Wadhwani AI's programmes in India.

## Past and current work
- **Cough Against TB (India, Wadhwani AI):** cough + symptom AI for TB triage, deployed with India's Central TB Division across 10+ states and 150+ facilities; AUROC about 0.80.
- **Ghana TB HeAR cough screening (Google.org via Aurum Institute):** Google HeAR embeddings + Ghana-tuned classifier; CoughCare data-collection app and QA dashboard live at 31 facilities in 4 regions.
- **Kenya cough collection (with Kuza):** same protocol, planned.
- **Oral reading fluency (ORF):** speech AI for early-grade reading assessment (Rwanda).

## Strengths
- Health acoustic AI (cough), foundation-model fine-tuning (Google HeAR), on-device and offline-first Android apps.
- Data collection at scale with field partners; automated data-quality dashboards.
- Government partnerships, ethics approvals, data-sharing agreements.

## Weaknesses / gaps
- Small team; no in-house clinical trial unit.
- No regulatory (SaMD) clearance yet for any product.
- Limited presence in Latin America and francophone Africa.

## Where we work or want to work
India, Ghana, Kenya, Rwanda, Nigeria, Mozambique, South Africa, and other countries in Sub-Saharan Africa and South Asia.

## Priority themes
TB, malaria, dengue and other infectious-disease surveillance; maternal and child health; AI for frontline health workers; education (reading assessment).

## Typical grant size
USD 100k to 5M; we can be prime or technical sub-grantee.
`;
