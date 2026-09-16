import { markdownState } from './review-completion.mjs';

// Plan checkboxes describe implementation. Verification is one separate result.
// This parses persisted state, not the truth of an agent's evidence claim.
export function parsePlanState(value) {
  const content = typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : '';
  const outside = markdownState(content);
  const workflows = [...outside.tail.matchAll(/^Workflow:[ \t]*(.*)$/gm)];
  if (!workflows.length) return { workflow: 'legacy' };
  const invalid = (error) => ({ workflow: 'slim', error });
  if (workflows.length !== 1 || workflows[0][1].trim() !== 'nectar-slim-v1') {
    return invalid('Plan must declare one supported Workflow.');
  }
  if (outside.unclosedFence) return invalid('Plan contains an unclosed Markdown fence.');

  const tasks = [];
  const ids = new Set();
  for (const line of outside.tail.split('\n')) {
    if (!/^- \[/.test(line)) continue;
    const match = line.match(/^- \[([ xX])\] (T[1-9]\d*):\s*\S/);
    if (!match || ids.has(match[2])) return invalid('Plan tasks require unique T-number IDs and a description.');
    ids.add(match[2]);
    tasks.push({ id: match[2], implemented: match[1].toLowerCase() === 'x' });
  }
  if (!tasks.length) return invalid('Plan must contain at least one task.');
  const checkedTasks = tasks.filter((task) => task.implemented).length;
  const uncheckedTasks = tasks.length - checkedTasks;

  const sections = [...outside.tail.matchAll(/^## Verification[ \t]*$/gm)];
  if (sections.length > 1) return invalid('Plan must have at most one final Verification section.');
  let status = 'pending';
  let evidence = '';
  if (sections.length) {
    const remaining = outside.tail.slice(sections[0].index + sections[0][0].length);
    const nextSection = remaining.search(/^## /m);
    const section = nextSection === -1 ? remaining : remaining.slice(0, nextSection);
    const statuses = [...section.matchAll(/^Status:[ \t]*(.*)$/gm)];
    const observations = [...section.matchAll(/^Evidence:[ \t]*(.*)$/gm)];
    if (statuses.length !== 1 || observations.length > 1) {
      return invalid('Final verification requires one Status and at most one Evidence field.');
    }
    status = statuses[0][1].trim().toLowerCase();
    evidence = observations[0]?.[1].trim() || '';
    if (!['pending', 'passed', 'failed'].includes(status)) {
      return invalid('Verification Status must be pending, passed or failed.');
    }
  }
  if (status === 'passed' && (uncheckedTasks || !evidence)) {
    return invalid('Passed verification requires all tasks implemented and recorded evidence.');
  }
  return { workflow: 'slim', tasks, checkedTasks, uncheckedTasks, verification: { status, evidence } };
}
