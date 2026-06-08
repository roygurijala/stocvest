export type SessionStatus = "authenticated" | "anonymous";

export interface AuthSession {
  token: string;
  subject: string;
  expiresAtUnix: number;
  email?: string;
  /** Cognito `given_name` (or first token of `name`) when present in the ID token. */
  firstName?: string;
}
