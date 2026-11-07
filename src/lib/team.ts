// People who can be assigned. Edit freely; anyone can also type a name or email.
export const TEAM: { name: string; email: string; team: string }[] = [
  { name: 'Rohit Singh', email: 'rohit@wadhwaniaiglobal.com', team: 'Product & Tech' },
  { name: 'Rishi Raj Grandhe', email: 'rishi@wadhwaniaiglobal.com', team: 'Product & Tech' },
  { name: 'Mohammad Usaid', email: 'usaid@wadhwaniaiglobal.com', team: 'Product & Tech' },
  { name: 'Ayush Prusty', email: 'ayush@wadhwaniaiglobal.com', team: 'Product & Tech' },
  { name: 'Chethana Benny', email: 'chethana@wadhwaniaiglobal.com', team: 'Product & Tech' },
  { name: 'Ananya Nandakumar', email: 'ananya-ilp@wadhwaniaiglobal.com', team: 'Growth & Strategy' },
  { name: 'Daksh Bharadwaj', email: 'daksh@wadhwaniaiglobal.com', team: 'Growth & Strategy' },
  { name: 'Vitrishna Vaibhavi', email: 'vitrishna@wadhwaniaiglobal.com', team: 'Programme' },
  { name: 'Sneha Nikam', email: 'c-sneha@wadhwaniaiglobal.com', team: 'Public Health' },
  { name: 'Harsh Singh', email: 'harsh@wadhwaniaiglobal.com', team: 'Growth & Strategy' },
  { name: 'Karan Malik', email: 'karan@wadhwaniaiglobal.com', team: 'Growth & Strategy' },
  { name: 'Ayushree', email: 'Ayushree', team: 'Growth & Strategy' },
];

export const TEAMS = ['Product & Tech', 'Growth & Strategy', 'Programme', 'Public Health', 'Finance', 'Partners'];

export function personName(v?: string | null) {
  if (!v) return 'Unassigned';
  const p = TEAM.find((t) => t.email === v || t.name === v);
  return p ? p.name : v.includes('@') ? v.split('@')[0] : v;
}

export const GRANT_STAGES = [
  { key: 'submission', label: 'Submission' },
  { key: 'review1', label: 'Review 1' },
  { key: 'review2', label: 'Review 2' },
  { key: 'grant', label: 'Grant' },
];
