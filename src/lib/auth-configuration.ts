// Error messages deliberately exclude URLs, keys and provider response bodies.
export function supabaseConfigurationError(
  url: string | undefined,
  key: string | undefined,
): string | null {
  if (
    !url ||
    !key ||
    url.includes("your-project") ||
    key.includes("your-publishable")
  )
    return "Set the Supabase project API URL and publishable key in .env.local.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL must be a valid project API URL.";
  }
  if (
    ["supabase.com", "www.supabase.com", "app.supabase.com"].includes(
      parsed.hostname,
    ) ||
    parsed.pathname.startsWith("/dashboard")
  )
    return "NEXT_PUBLIC_SUPABASE_URL must be your project API URL (https://<project-ref>.supabase.co), not a Supabase dashboard URL.";
  if (!["https:", "http:"].includes(parsed.protocol))
    return "Use an HTTP or HTTPS Supabase project API URL.";
  if (key.startsWith("sb_secret_"))
    return "Use the Supabase publishable key for NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Secret keys belong only in server settings.";
  return null;
}
const signupMessages: Record<string, string> = {
  signup_disabled:
    "Account signup is disabled. Enable new-user signup in Supabase Authentication settings.",
  email_provider_disabled:
    "Email signup is disabled. Enable the Email provider in Supabase Authentication settings.",
  email_address_not_authorized:
    "Supabase’s default email sender only supports organization-member addresses. Use a member email for testing or configure custom SMTP in Supabase.",
  over_email_send_rate_limit:
    "Supabase’s confirmation-email rate limit was reached. Wait before retrying or configure custom SMTP.",
  over_request_rate_limit:
    "Signup is temporarily rate limited. Please wait before trying again.",
  weak_password:
    "This password does not meet your Supabase project’s password policy. Choose a stronger password.",
  email_address_invalid:
    "Supabase rejected this email address. Use a valid email address you can receive mail at.",
  captcha_failed:
    "Signup requires CAPTCHA, which this form does not support yet. Check your development project’s Auth CAPTCHA settings.",
};
export function signupFailure(error: {
  code?: string;
  status?: number;
  name?: string;
}) {
  const code =
    error.code && /^[a-z_]{1,80}$/.test(error.code) ? error.code : "unknown";
  const unavailable =
    error.name === "AuthRetryableFetchError" ||
    (error.status !== undefined && error.status >= 500);
  const status =
    error.status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
      ? 429
      : unavailable
        ? 503
        : 400;
  return {
    code,
    status,
    message:
      signupMessages[code] ||
      (unavailable
        ? "Supabase authentication is unavailable. Check the project status and try again shortly."
        : "Account creation failed. Check Supabase Authentication logs for the reason, then try again."),
  };
}
