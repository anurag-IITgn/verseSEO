/**
 * Deterministic content-structure template used when the AI provider is
 * unavailable or returns an unusable brief for a seed. Honest, rule-based
 * output — never presented as AI-generated content (callers flag
 * aiEnhanced: false).
 */
export function fallbackStructure(intent: string, topic: string): string[] {
  const normalized = intent.toLowerCase();
  if (normalized.includes('commercial')) {
    return [
      'Introduction',
      `Why ${topic} matters`,
      'Comparison of options',
      'Recommendations',
      'Summary and next steps',
    ];
  }
  if (normalized.includes('transactional')) {
    return [
      'Introduction',
      `Features of ${topic}`,
      'Pricing and options',
      'Frequently asked questions',
      'Get started',
    ];
  }
  if (normalized.includes('on-page')) {
    return [
      `Overview of ${topic}`,
      'Key points to communicate',
      'Suggested heading structure',
      'Meta description and title rewrite',
    ];
  }
  return [
    'Introduction',
    `What is ${topic}`,
    `Common questions about ${topic}`,
    `How to use ${topic} effectively`,
    'Summary and next steps',
  ];
}