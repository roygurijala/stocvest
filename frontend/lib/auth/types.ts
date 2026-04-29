export type SessionStatus = "authenticated" | "anonymous";

export interface AuthSession {
  token: string;
  subject: string;
  expiresAtUnix: number;
  email?: string;
}
