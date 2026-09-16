const CLEAN_MARKER = 'Clean pass: zero blocking code defects remain.';

function normalize(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n');
}

function semanticTail(content) {
  const trimmed = content.trimEnd();
  if (!trimmed) return { closingFence: false, tail: '', unclosedFence: false };
  const lines = trimmed.split('\n');
  const outside = [];
  let fence = null;
  let closingFence = false;

  for (const line of lines) {
    const delimiter = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence === null) {
      closingFence = false;
      if (delimiter) {
        fence = { length: delimiter[1].length, marker: delimiter[1][0] };
      } else {
        outside.push(line);
      }
      continue;
    }

    if (delimiter
      && delimiter[1][0] === fence.marker
      && delimiter[1].length >= fence.length
      && !delimiter[2].trim()) {
      fence = null;
      closingFence = true;
    }
  }

  return {
    closingFence,
    tail: outside.join('\n').trimEnd(),
    unclosedFence: fence !== null,
  };
}

function historicalClean(content) {
  if (content.includes(CLEAN_MARKER)) return false;
  return /^## Clean pass\s*$/im.test(content)
    && (/\b(?:No|Zero) CONFIRMED findings remain\.\s*$/im.test(content)
      || /Clean pass confirmed(?:\s+after[^\n]*)?\.\s*$/im.test(content));
}

export function parseReviewCompletion(value) {
  const content = normalize(value);
  const tail = semanticTail(content);
  const blockerCounts = [...tail.tail.matchAll(/^Blocking:\s*(\d+)\s*$/gim)]
    .map((match) => Number.parseInt(match[1], 10));
  const finalBlocking = blockerCounts.length ? blockerCounts.at(-1) : null;
  const tailLine = tail.tail.split('\n').at(-1)?.trim() || '';
  const markerAtTail = !tail.unclosedFence && tailLine === CLEAN_MARKER;

  if (finalBlocking === 0 && markerAtTail) {
    return {
      complete: true,
      closingFence: tail.closingFence,
      finalBlocking,
      reason: 'canonical-clean-tail',
      state: 'done',
    };
  }
  if (historicalClean(tail.tail)) {
    return {
      complete: false,
      closingFence: false,
      finalBlocking,
      reason: 'historical-clean-format',
      state: 'legacy-needing-adjudication',
    };
  }
  return {
    complete: false,
    closingFence: tail.closingFence,
    finalBlocking,
    reason: finalBlocking !== 0
      ? (finalBlocking === null ? 'missing-blocking-summary' : 'final-blocking-nonzero')
      : (tail.tail.includes(CLEAN_MARKER) ? 'clean-marker-not-at-tail' : 'missing-clean-marker'),
    state: 'in review',
  };
}

export { CLEAN_MARKER, semanticTail as markdownState };
