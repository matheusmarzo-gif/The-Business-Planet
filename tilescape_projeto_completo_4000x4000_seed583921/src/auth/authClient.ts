import { createInternalNeonAuth } from '@neon/auth';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;

if (!authUrl) {
  throw new Error('Configure NEON_AUTH_BASE_URL para usar o Neon Auth.');
}

const neonAuth = createInternalNeonAuth(authUrl);

export const authClient = neonAuth.adapter;

interface EmailOtpVerificationClient {
  emailOtp: {
    verifyEmail(input: { email: string; otp: string }): Promise<{ error: unknown }>;
  };
}

export async function verifyEmailCode(email: string, otp: string): Promise<void> {
  const client = authClient as typeof authClient & EmailOtpVerificationClient;
  const { error } = await client.emailOtp.verifyEmail({ email, otp });
  if (error) throw error;
}

export async function getAccessToken(): Promise<string> {
  const token = await neonAuth.getJWTToken();
  if (!token) throw new Error('Entre na sua conta para acessar o mundo.');
  return token;
}
