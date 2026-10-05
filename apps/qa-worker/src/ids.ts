import { hexToUuid, uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

export function generateRequestId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let hex = "";
  for (let i = 0; i < buf.length; i++) hex += buf[i]!.toString(16).padStart(2, "0");
  return `req_${hex}`;
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function parseOrgPublicId(publicId: string): Uuid | null {
  return uuidFromPublicId(publicId, "org");
}

export type PublicPrefix = "hub" | "area" | "feat" | "edge" | "scn" | "run" | "res" | "rec";

export const toPublic = (prefix: "org" | PublicPrefix, uuid: string): string => `${prefix}_${uuidToHex(uuid)}`;

export function fromPublic(prefix: PublicPrefix, publicId: string | null | undefined): string | null {
  if (!publicId || !publicId.startsWith(`${prefix}_`)) return null;
  return hexToUuid(publicId.slice(prefix.length + 1));
}
