/**
 * Restaurant-tuned Perplexity Sonar query templates.
 * Uses SONAR_CONTEXT_TERMS from india-context.ts to produce
 * richer, more targeted queries per region and month.
 */

import type { SonarQueryScope, SpecializationContext } from '../types.js';
import { SONAR_CONTEXT_TERMS } from './india-context.js';

export function buildSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[] {
  if (scope === 'daily-platform') {
    const festivalTerms = SONAR_CONTEXT_TERMS.festivals.slice(0, 2).join(', ');
    return [
      `What major Indian holidays, sports events, ${festivalTerms} moments, weather events, and trending topics today and tomorrow could a restaurant reference in social media content? Focus on Hyderabad, Mumbai, and Bangalore metro areas.`,
    ];
  }

  const cuisine = ctx.cuisine ?? 'Indian';
  const region = ctx.region ?? 'India';
  const regionKey = region.toLowerCase().replace(/\s+/g, '');

  // Type-safe regional terms lookup (regional values are readonly tuples from `as const`)
  const regionalMap = SONAR_CONTEXT_TERMS.regional as Record<string, readonly string[]>;
  const regionalTerms: readonly string[] = regionalMap[regionKey] ?? [];
  const locationContext = regionalTerms.length
    ? `(focus areas: ${regionalTerms.slice(0, 2).join(', ')})`
    : '';

  return [
    `What are the trending food and dining conversations in ${region} ${locationContext} this week that a ${cuisine} restaurant could tap into on Instagram? Include any festivals, sports events, or cultural moments driving dining decisions.`,
    `What ${cuisine} cuisine moments — dish history, regional traditions, ingredient stories, chef techniques — would resonate with diners in ${region} on social media right now?`,
    `What upcoming festivals, local events, or seasonal food trends in ${region} ${locationContext} should a restaurant plan Instagram content around in the next 7 days? Flag any fasting or mourning periods where non-vegetarian food promotion would be culturally inappropriate.`,
  ];
}
