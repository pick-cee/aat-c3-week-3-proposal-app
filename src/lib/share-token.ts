import { randomBytes } from "node:crypto";

export function generateShareToken(): string {
  return randomBytes(20).toString("base64url");
}
