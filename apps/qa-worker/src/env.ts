export interface Env {
  PLATFORM_DB?: Hyperdrive;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  ENVIRONMENT: string;
  /**
   * Starting a try on demand: a GitHub token allowed to dispatch the try
   * workflow of GITHUB_REPOSITORY. Without it a try waits for the runner's next
   * scheduled pass.
   */
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_TRY_WORKFLOW?: string;
}
