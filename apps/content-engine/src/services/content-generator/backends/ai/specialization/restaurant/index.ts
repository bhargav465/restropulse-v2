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
import { selectRestaurantHashtags } from './hashtag-strategy.js';

const FSSAI_VIOLATING_PATTERNS: RegExp[] = [
  /\bcures?\b/i,
  /\bprevents?\s+(disease|cancer|diabetes)/i,
  /\bweight\s*loss\b/i,
  /\bboosts?\s+immunity\b/i,
  /\btreats?\s+(disease|illness)/i,
];

const INSTAGRAM_TOTAL_CHAR_LIMIT = 2200;
const HASHTAG_MIN = 3;
const HASHTAG_MAX = 15;

function countHashtags(caption: string): number {
  return (caption.match(/#[\w-]+/g) ?? []).length;
}

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

  if (post.caption.length > INSTAGRAM_TOTAL_CHAR_LIMIT) {
    issues.push({
      severity: 'warning',
      field: 'caption',
      message: `Caption length ${post.caption.length} exceeds Instagram total limit of ${INSTAGRAM_TOTAL_CHAR_LIMIT} characters.`,
    });
  }

  const hashtagCount = countHashtags(post.caption);
  if (hashtagCount < HASHTAG_MIN || hashtagCount > HASHTAG_MAX) {
    issues.push({
      severity: 'warning',
      field: 'caption',
      message: `Hashtag count ${hashtagCount} is outside recommended range [${HASHTAG_MIN}, ${HASHTAG_MAX}].`,
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

  selectHashtags(caption: string, ctx: SpecializationContext): string[] {
    return selectRestaurantHashtags(caption, ctx);
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
