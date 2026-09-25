/**
 * Factory functions that construct real clients for integration suites.
 * Use dynamic imports inside tests -- not at module level -- so the
 * requireSecrets() call in the test file can throw before the client is created.
 */

export async function makeAnthropicProvider(apiKey: string) {
  const { AnthropicLLMProvider } = await import('../../../apps/content-engine/src/services/content-generator/backends/ai/llm/anthropic-provider.js');
  return new AnthropicLLMProvider({ apiKey });
}

export async function makeReplicateClient(apiKey: string) {
  const { ReplicateClient } = await import('../../../apps/content-engine/src/services/content-generator/backends/ai/media/replicate/replicate-client.js');
  return new ReplicateClient({ apiKey });
}

export async function makeGoogleCalendarClient(apiKey: string) {
  const { GoogleCalendarClient } = await import('../../../apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/google-calendar-client.js');
  return new GoogleCalendarClient({ apiKey });
}

export async function makeSonarClient(apiKey: string) {
  const { SonarClient } = await import('../../../apps/content-engine/src/services/content-generator/backends/ai/current-affairs/clients/sonar-client.js');
  return new SonarClient({ apiKey });
}
