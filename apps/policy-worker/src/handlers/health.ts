import type { Env } from "../env.js";
import { ORGANIZATION_ACTIONS, POLICY_VERSION } from "@saas/contracts/policy";

export function handleHealth(env: Env, requestId: string): Response {
  return Response.json(
    {
      status: "ok",
      service: "policy-worker",
      environment: env.ENVIRONMENT ?? "local",
      timestamp: new Date().toISOString(),
      policyVersion: POLICY_VERSION,
      // How many organization actions this build knows. A deployment older than
      // its policy engine shows a smaller number (and denies the newer actions).
      organizationActions: ORGANIZATION_ACTIONS.length,
    },
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    },
  );
}
