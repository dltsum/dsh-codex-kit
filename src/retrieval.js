const DEFAULTS = Object.freeze({
  limit: 5,
  tokenBudget: 600,
  descriptionMaxChars: 180,
});

/** Normalize text without changing the original skill metadata. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2010-\u2015_./\\:]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Deterministic multilingual lexical tokens. Han unigrams and bigrams allow
 * useful matching without an embedding model or a network call.
 */
export function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  const tokens = [];
  const segments = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? [];
  for (const segment of segments) {
    if (/^\p{Script=Han}+$/u.test(segment)) {
      const chars = [...segment];
      tokens.push(...chars);
      for (let index = 0; index + 1 < chars.length; index += 1) {
        tokens.push(chars[index] + chars[index + 1]);
      }
      continue;
    }
    if (segment.length > 1 || /^\d+$/u.test(segment)) tokens.push(segment);
  }
  return tokens;
}

/** Conservative, tokenizer-independent estimate used only for local budgeting. */
export function estimateTokens(value) {
  const text = String(value ?? '');
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const nonHan = text.replace(/\p{Script=Han}/gu, '').length;
  return han + Math.ceil(nonHan / 4);
}

export function truncateText(value, maxChars) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…'.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function addWeightedTokens(target, value, weight) {
  for (const token of tokenize(value)) {
    target.set(token, (target.get(token) ?? 0) + weight);
  }
}

/** Build an immutable BM25-style lexical index from invocation-safe summaries. */
export function buildSkillIndex(skills) {
  const documents = skills.map((skill) => {
    const frequencies = new Map();
    addWeightedTokens(frequencies, skill.name, 4);
    addWeightedTokens(frequencies, skill.description, 1);
    addWeightedTokens(frequencies, skill.whenToUse, 1.5);
    const length = [...frequencies.values()].reduce((sum, value) => sum + value, 0);
    return Object.freeze({ skill, frequencies, length });
  });

  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of document.frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const averageLength = documents.length === 0
    ? 0
    : documents.reduce((sum, document) => sum + document.length, 0) / documents.length;

  return Object.freeze({
    documents: Object.freeze(documents),
    documentFrequency,
    averageLength,
    size: documents.length,
  });
}

function lexicalCompare(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function scoreDocument(index, document, query, queryTokens) {
  const numberOfDocuments = index.documents.length;
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;

  for (const token of new Set(queryTokens)) {
    const frequency = document.frequencies.get(token) ?? 0;
    if (frequency === 0) continue;
    const df = index.documentFrequency.get(token) ?? 0;
    const idf = Math.log(1 + ((numberOfDocuments - df + 0.5) / (df + 0.5)));
    const normalization = index.averageLength === 0
      ? 1
      : 1 - b + (b * document.length / index.averageLength);
    score += idf * ((frequency * (k1 + 1)) / (frequency + (k1 * normalization)));
  }

  const normalizedName = normalizeText(document.skill.name);
  if (normalizedName === query) score += 100;
  else if (normalizedName.includes(query)) score += 30;
  for (const token of new Set(queryTokens)) {
    if (normalizedName.includes(token)) score += 3;
  }
  return score;
}

function fitDescription(skill, score, remainingBudget, descriptionMaxChars) {
  const base = `${skill.name}\n${skill.provider ?? ''}\n`;
  const baseTokens = estimateTokens(base) + 8;
  if (remainingBudget <= baseTokens) return undefined;

  let description = truncateText(skill.description, descriptionMaxChars);
  let whenToUse = truncateText(skill.whenToUse, Math.floor(descriptionMaxChars / 2));
  let estimatedTokens = baseTokens + estimateTokens(description) + estimateTokens(whenToUse);

  if (estimatedTokens > remainingBudget) {
    whenToUse = '';
    const availableChars = Math.max(16, (remainingBudget - baseTokens) * 3);
    description = truncateText(description, Math.min(descriptionMaxChars, availableChars));
    estimatedTokens = baseTokens + estimateTokens(description);
  }
  if (estimatedTokens > remainingBudget) return undefined;

  return Object.freeze({
    name: skill.name,
    description,
    ...(whenToUse ? { whenToUse } : {}),
    provider: String(skill.provider ?? ''),
    source: String(skill.source ?? ''),
    score: Number(score.toFixed(6)),
    estimatedTokens,
  });
}

/** Retrieve a bounded, stable top-k list. Zero-score rows are never guessed in. */
export function searchSkillIndex(index, rawQuery, options = {}) {
  const query = normalizeText(rawQuery);
  if (!query) throw new TypeError('query must contain non-whitespace text');

  const queryTokens = tokenize(query);
  const limit = Math.max(1, Math.min(Number(options.limit ?? DEFAULTS.limit), 20));
  const tokenBudget = Math.max(64, Math.min(Number(options.tokenBudget ?? DEFAULTS.tokenBudget), 4000));
  const descriptionMaxChars = Math.max(
    32,
    Math.min(Number(options.descriptionMaxChars ?? DEFAULTS.descriptionMaxChars), 1000),
  );

  const ranked = index.documents
    .map((document) => ({ document, score: scoreDocument(index, document, query, queryTokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score
      || lexicalCompare(left.document.skill.name, right.document.skill.name));

  const selected = [];
  let usedTokens = 0;
  for (const entry of ranked) {
    if (selected.length >= limit) break;
    const fitted = fitDescription(
      entry.document.skill,
      entry.score,
      tokenBudget - usedTokens,
      descriptionMaxChars,
    );
    if (!fitted) continue;
    selected.push(fitted);
    usedTokens += fitted.estimatedTokens;
  }

  return Object.freeze({
    query,
    selected: Object.freeze(selected),
    usedTokens,
    tokenBudget,
    totalMatches: ranked.length,
  });
}

/** Approximation of the upstream all-skill catalog footprint for diagnostics. */
export function estimateCatalogTokens(skills) {
  const rendered = skills
    .map((skill) => `${skill.name}: ${skill.description}${skill.whenToUse ? ` ${skill.whenToUse}` : ''}`)
    .join('\n');
  return estimateTokens(rendered);
}
