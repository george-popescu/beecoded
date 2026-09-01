import assert from 'node:assert/strict';
import test from 'node:test';

import { CLEAN_MARKER, parseReviewCompletion } from './review-completion.mjs';

function review(...lines) {
  return `${lines.join('\n')}\n`;
}

test('accepts only the final zero-blocking summary and canonical semantic tail', () => {
  const result = parseReviewCompletion(review(
    '# Review',
    'Blocking: 2',
    'Blocking: 0',
    'Deferred: 3',
    CLEAN_MARKER,
    '',
  ));

  assert.deepEqual(result, {
    complete: true,
    closingFence: false,
    finalBlocking: 0,
    reason: 'canonical-clean-tail',
    state: 'done',
  });
});

test('rejects canonical summaries inside every Markdown fence', () => {
  for (const [opening, closing] of [
    ['```text', '```'],
    ['````text', '````'],
    ['~~~text', '~~~'],
    ['~~~~text', '~~~~'],
  ]) {
    const result = parseReviewCompletion(review(
      '# Review notes',
      'The following is only an example:',
      opening,
      'Blocking: 0',
      CLEAN_MARKER,
      closing,
    ));

    assert.equal(result.complete, false, opening);
    assert.equal(result.state, 'in review', opening);
  }
});

test('requires both canonical summary lines outside fences', () => {
  for (const content of [
    review('Blocking: 0', '```text', CLEAN_MARKER, '```'),
    review('```text', 'Blocking: 0', '```', CLEAN_MARKER),
  ]) {
    assert.equal(parseReviewCompletion(content).complete, false);
  }
});

test('accepts CRLF and a closed non-summary fence after an unfenced summary', () => {
  const result = parseReviewCompletion([
    '# Review',
    'Blocking: 0',
    CLEAN_MARKER,
    '~~~text',
    'Non-summary diagnostic appendix.',
    '~~~',
    '',
  ].join('\r\n'));

  assert.equal(result.complete, true);
  assert.equal(result.closingFence, true);
});

test('rejects an unclosed trailing fence after an unfenced summary', () => {
  const result = parseReviewCompletion(review(
    'Blocking: 0',
    CLEAN_MARKER,
    '```text',
    'unfinished appendix',
  ));

  assert.equal(result.complete, false);
});

test('rejects later blockers, trailing prose, stray fences, and embedded markers', () => {
  const cases = [
    review('Blocking: 0', CLEAN_MARKER, 'Blocking: 1'),
    review('Blocking: 0', CLEAN_MARKER, 'later prose'),
    review('Blocking: 0', CLEAN_MARKER, '```'),
    review('Blocking: 0', `Prefix ${CLEAN_MARKER}`),
    review(CLEAN_MARKER),
  ];

  for (const content of cases) assert.equal(parseReviewCompletion(content).complete, false);
});

test('labels recognized historical clean formats without accepting them', () => {
  for (const content of [
    review('# Review', '## Clean pass', 'No CONFIRMED findings remain.'),
    review('# Review', '## Clean pass', 'Clean pass confirmed after the final fix.'),
  ]) {
    const result = parseReviewCompletion(content);
    assert.equal(result.complete, false);
    assert.equal(result.state, 'legacy-needing-adjudication');
    assert.equal(result.reason, 'historical-clean-format');
  }
});

test('does not downgrade a canonical marker with later content to legacy status', () => {
  const result = parseReviewCompletion(review(
    '## Clean pass',
    'Blocking: 0',
    CLEAN_MARKER,
    'later content',
  ));

  assert.equal(result.state, 'in review');
  assert.equal(result.reason, 'clean-marker-not-at-tail');
});
