import "server-only";

import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand
} from "@aws-sdk/client-cognito-identity-provider";

const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "2ruog68jh83frp7unduufbvgm2";
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "";
const REGION = USER_POOL_ID.split("_")[0] || "us-east-1";

const client = new CognitoIdentityProviderClient({ region: REGION });

export function getCognitoErrorName(error: unknown): string {
  return typeof error === "object" && error && "name" in error ? String((error as { name: unknown }).name) : "";
}

/** SignUp / alias conflict — an account already uses this email in the user pool. */
export function isDuplicateCognitoUsernameError(error: unknown): boolean {
  const name = getCognitoErrorName(error);
  return name === "UsernameExistsException" || name === "AliasExistsException";
}

export function cognitoErrorMessage(error: unknown, fallback: string): string {
  const name = getCognitoErrorName(error);
  if (name === "NotAuthorizedException") return "Incorrect email or password";
  if (name === "UserNotFoundException") return "No account found with that email";
  if (name === "UserNotConfirmedException") return "Please verify your email first. Check your inbox.";
  if (name === "LimitExceededException" || name === "TooManyRequestsException") {
    return "Too many attempts. Please try again later.";
  }
  if (name === "UsernameExistsException" || name === "AliasExistsException") {
    return "An account with this email already exists";
  }
  if (name === "InvalidPasswordException") return "Password does not meet requirements";
  if (name === "CodeMismatchException" || name === "ExpiredCodeException") {
    return "Invalid or expired code. Please try again.";
  }
  return fallback;
}

export async function signUp(email: string, password: string): Promise<void> {
  await client.send(
    new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }]
    })
  );
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await client.send(
    new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code
    })
  );
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await client.send(
    new ResendConfirmationCodeCommand({
      ClientId: CLIENT_ID,
      Username: email
    })
  );
}

export async function signIn(email: string, password: string): Promise<{
  idToken?: string;
  challengeName?: string;
  challengeSession?: string;
}> {
  const response = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    })
  );
  return {
    idToken: response.AuthenticationResult?.IdToken,
    challengeName: response.ChallengeName,
    challengeSession: response.Session
  };
}

export async function forgotPassword(email: string): Promise<void> {
  await client.send(
    new ForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: email
    })
  );
}

export async function confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
  await client.send(
    new ConfirmForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword
    })
  );
}

export async function respondToNewPasswordChallenge(
  session: string,
  newPassword: string,
  email: string
): Promise<{ idToken?: string }> {
  const response = await client.send(
    new RespondToAuthChallengeCommand({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      ClientId: CLIENT_ID,
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword
      }
    })
  );
  return { idToken: response.AuthenticationResult?.IdToken };
}
