/**
 * IProcessor -- the common shape every cron-driven processor implements.
 * The worker iterates a list of these and registers each with node-cron,
 * wrapping `run()` in tracedCronJob so each invocation gets an OTel span
 * and a duration metric.
 */

export interface IProcessor {
  /** Stable identifier used as the OTel span name and log field. */
  readonly name: string;

  /** node-cron expression (5- or 6-field). Comes from env in worker boot. */
  readonly cron: string;

  /** Body of the processor. Must throw on failure (tracedCronJob records it). */
  run(): Promise<void>;
}
