import { defineTool } from '@deepseek-ai/dsh-tools';
import { isModelInvocable, isSkillName, renderSkillContent } from '@deepseek-ai/dsh-skill';
import { CatalogIndexCache } from './catalog-cache.js';
import {
  estimateCatalogTokens,
  estimateTokens,
  searchSkillIndex,
} from './retrieval.js';

export const name = 'dsh-codex-kit';
export const inject = ['tools', 'skills'];

const DEFAULT_CONFIG = Object.freeze({
  maxResults: 5,
  defaultTokenBudget: 600,
  descriptionMaxChars: 180,
  maxCatalogEntries: 5000,
  cacheMaxEntries: 32,
});

function integerConfig(config, key, minimum, maximum) {
  const value = Number(config[key] ?? DEFAULT_CONFIG[key]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function resolveConfig(config = {}) {
  return Object.freeze({
    maxResults: integerConfig(config, 'maxResults', 1, 20),
    defaultTokenBudget: integerConfig(config, 'defaultTokenBudget', 64, 4000),
    descriptionMaxChars: integerConfig(config, 'descriptionMaxChars', 32, 1000),
    maxCatalogEntries: integerConfig(config, 'maxCatalogEntries', 1, 50000),
    cacheMaxEntries: integerConfig(config, 'cacheMaxEntries', 1, 256),
  });
}

function lookupFromExecution(exec) {
  return {
    cwd: exec.agent?.session.header.cwd,
    signal: exec.signal,
    scope: exec.agent,
  };
}

function renderSearch(value) {
  if (value.selected.length === 0) {
    return `${value.summary}\nNo relevant skill was found. Broaden the query or inspect stats.`;
  }
  const lines = value.selected.map((skill, index) => {
    const when = skill.whenToUse ? `\n   when: ${skill.whenToUse}` : '';
    return `${index + 1}. ${skill.name} — ${skill.description}${when}`;
  });
  return [
    value.summary,
    ...lines,
    'Call skillopt with action="load" and the exact selected name before following that skill.',
  ].join('\n');
}

function renderOutput(value) {
  if (value.action === 'load' && value.loaded) return value.loaded.rendered;
  if (value.action === 'search') return renderSearch(value);
  return [
    value.summary,
    `catalog=${value.metrics.catalogSize}, complete=${value.metrics.catalogComplete}`,
    `estimated all-catalog tokens=${value.metrics.estimatedCatalogTokens}`,
    `cache entries=${value.metrics.cacheEntries}`,
  ].join('\n');
}

export function createSkillOptTool(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig);
  const cache = new CatalogIndexCache(config.cacheMaxEntries);

  return defineTool({
    name: 'skillopt',
    description: 'Progressively search or load DSH skills without injecting the full catalog. Before a nontrivial task may need reusable instructions, search by task, then load the exact chosen name.',
    parameters: {
      action: {
        type: 'string',
        enum: ['search', 'load', 'stats'],
        required: true,
        description: 'search finds compact candidates; load returns one full skill; stats reports footprint.',
      },
      query: {
        type: 'string',
        description: 'Task or capability to match. Required for search.',
      },
      name: {
        type: 'string',
        description: 'Exact skill name. Required for load.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum search results, 1-20.',
      },
      tokenBudget: {
        type: 'integer',
        description: 'Approximate token budget for search metadata, 64-4000.',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderOutput(value) }],
    },
    isConcurrencySafe: (args) => args.action !== 'load',
    async execute(args, exec) {
      const lookup = lookupFromExecution(exec);
      const snapshot = await ctx.skills.snapshot(lookup);
      exec.signal.throwIfAborted();
      const skills = snapshot.skills.filter(isModelInvocable);
      if (skills.length > config.maxCatalogEntries) {
        throw new Error(`skill catalog has ${skills.length} entries; configured safety limit is ${config.maxCatalogEntries}`);
      }

      const commonMetrics = {
        catalogSize: skills.length,
        catalogComplete: snapshot.complete,
        estimatedCatalogTokens: estimateCatalogTokens(skills),
        cacheEntries: cache.size,
      };

      if (args.action === 'stats') {
        return {
          status: snapshot.complete ? 'success' : 'warning',
          action: 'stats',
          summary: snapshot.complete
            ? 'Skill catalog footprint measured.'
            : 'Skill discovery is incomplete; retry before treating counts as authoritative.',
          selected: [],
          nextActions: ['Use action="search" with the current task.'],
          metrics: commonMetrics,
        };
      }

      if (args.action === 'load') {
        const requestedName = String(args.name ?? '');
        if (!isSkillName(requestedName)) throw new Error(`invalid skill name ${JSON.stringify(requestedName)}`);
        const summary = skills.find((skill) => skill.name === requestedName);
        if (!summary) throw new Error(`skill ${JSON.stringify(requestedName)} is unknown or unavailable to the model`);
        const skill = await ctx.skills.get(requestedName, lookup);
        exec.signal.throwIfAborted();
        if (!skill || !isModelInvocable(skill)) {
          throw new Error(`skill ${JSON.stringify(requestedName)} is no longer available to the model`);
        }
        const rendered = renderSkillContent(skill);
        return {
          status: 'success',
          action: 'load',
          summary: `Loaded skill ${skill.name} without rewriting its instructions.`,
          selected: [],
          loaded: {
            name: skill.name,
            provider: skill.provider,
            source: String(skill.source),
            rendered,
            estimatedTokens: estimateTokens(rendered),
          },
          nextActions: ['Follow the loaded skill instructions.'],
          metrics: commonMetrics,
        };
      }

      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('query is required for action="search"');
      const indexed = cache.getOrBuild(skills, { cacheable: snapshot.complete });
      const result = searchSkillIndex(indexed.index, query, {
        limit: args.limit ?? config.maxResults,
        tokenBudget: args.tokenBudget ?? config.defaultTokenBudget,
        descriptionMaxChars: config.descriptionMaxChars,
      });
      return {
        status: snapshot.complete ? 'success' : 'warning',
        action: 'search',
        summary: snapshot.complete
          ? `Selected ${result.selected.length} of ${skills.length} skills within the metadata budget.`
          : `Selected ${result.selected.length} candidates from an incomplete catalog; retry if the expected skill is absent.`,
        selected: result.selected,
        nextActions: result.selected.length > 0
          ? ['Load one exact name before acting.', 'Refine the query if the top result is not relevant.']
          : ['Broaden the query.', 'Use action="stats" to inspect catalog availability.'],
        metrics: {
          ...commonMetrics,
          cacheHit: indexed.cacheHit,
          cacheDigest: indexed.digest,
          resultTokens: result.usedTokens,
          resultTokenBudget: result.tokenBudget,
          totalLexicalMatches: result.totalMatches,
          estimatedCatalogTokensAvoided: Math.max(0, commonMetrics.estimatedCatalogTokens - result.usedTokens),
        },
      };
    },
    timeoutMs: 15000,
  });
}

export function apply(ctx, config = {}) {
  ctx.tools.register(createSkillOptTool(ctx, config));
}
