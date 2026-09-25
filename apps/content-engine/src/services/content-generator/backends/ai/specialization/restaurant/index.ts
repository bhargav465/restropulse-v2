import type { GeneratedCycle, GeneratedPost } from '../../../../types.js';
import type {
  IDomainSpecialization,
  SpecializationContext,
  SpecializationOperation,
  SpecializationOperationInput,
  SonarQueryScope,
  ImageGenInput,
  ValidationIssue,
  ValidationResult,
} from '../types.js';
import { buildSystemPromptFragment, buildTaskPrompt } from './prompts.js';
import { buildSonarQueries } from './sonar-queries.js';
import { buildImagePromptFragment } from './visual-direction.js';

const FSSAI_VIOLATING_PATTERNS: RegExp[] = [
  /\bcures?\b/i,
  /\bprevents?\s+(disease|cancer|diabetes)/i,
  /\bweight\s*loss\b/i,
  /\bboosts?\s+immunity\b/i,
  /\btreats?\s+(disease|illness)/i,
];

// Practical target ceiling for a caption (see platform-tactics.ts for the
// per-platform target range fed to the LLM prompt). This is a generous
// backstop, not the target itself -- catches a model that ignores the prompt.
const CAPTION_LENGTH_WARNING_THRESHOLD = 500;

function validateGeneratedPost(post: GeneratedPost): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const pattern of FSSAI_VIOLATING_PATTERNS) {
    if (pattern.test(post.caption)) {
      issues.push({
        severity: 'error',
        field: 'caption',
        message: 'Caption contains an FSSAI-restricted health claim. Remove wording about cures, disease prevention, weight loss, or immunity.',
      });
      break;
    }
  }

  // Second-pass: comparative health language — catches phrases that slip through the
  // primary FSSAI regex but are still non-compliant (especially for HEALTH_DIETARY_SIGNAL posts).
  const HEALTH_COMPARATIVE_PATTERNS: RegExp[] = [
    /healthier\s+than/i,
    /better\s+for\s+(your\s+)?(health|body|gut|digestion)/i,
    /good\s+for\s+(diabetics?|heart|cholesterol)/i,
    /helps?\s+(you\s+)?(lose\s+weight|digestion|immunity)/i,
    /improves?\s+(your\s+)?(health|digestion|immunity|energy)/i,
  ];
  for (const pattern of HEALTH_COMPARATIVE_PATTERNS) {
    if (pattern.test(post.caption)) {
      issues.push({
        severity: 'error',
        field: 'caption',
        message: 'Caption contains a comparative health claim. State dietary properties as facts only (e.g. "made with ragi", "100% vegan") — no benefit or comparison claims.',
      });
      break;
    }
  }

  if (post.caption.length > CAPTION_LENGTH_WARNING_THRESHOLD) {
    issues.push({
      severity: 'warning',
      field: 'caption',
      message: `Caption length ${post.caption.length} exceeds the ${CAPTION_LENGTH_WARNING_THRESHOLD} character target.`,
    });
  }

  return issues;
}

export class RestaurantSpecialization implements IDomainSpecialization {
  readonly domain = 'restaurant';
  readonly version = '0.2.0';

  getSystemPromptFragment(ctx: SpecializationContext): string {
    return buildSystemPromptFragment(ctx);
  }

  getTaskPrompt(
    operation: SpecializationOperation,
    input: SpecializationOperationInput,
    ctx: SpecializationContext,
  ): string {
    return buildTaskPrompt(operation, input, ctx);
  }

  getSonarQueries(scope: SonarQueryScope, ctx: SpecializationContext): string[] {
    return buildSonarQueries(scope, ctx);
  }

  getImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string {
    return buildImagePromptFragment(input, ctx);
  }

  validateOutput(
    output: GeneratedPost | GeneratedCycle,
    _ctx: SpecializationContext,
  ): ValidationResult {
    if ('caption' in output) {
      const issues = validateGeneratedPost(output);
      return { ok: issues.every((i) => i.severity !== 'error'), issues };
    }
    return { ok: true, issues: [] };
  }
}
