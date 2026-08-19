/**
 * Feature flags — flip to reveal work-in-progress functionality.
 *
 * IMPORTANT: setting a flag to `false` HIDES the UI only. Backend endpoints,
 * pydantic models, and server-side stubs remain intact so the integration can
 * be re-enabled by flipping a single boolean here.
 */
export const FEATURES = {
  /** QuickBooks + Square accounting toggles. Hidden while OAuth is mocked. */
  accountingIntegrations: false,
} as const;
