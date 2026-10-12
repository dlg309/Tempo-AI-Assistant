import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase";
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code");
  if (code) {
    try {
      const db = await userClient();
      const { error } = await db.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL("/", url.origin));
    } catch {
      /* Login page provides recovery instructions. */
    }
  }
  return NextResponse.redirect(
    new URL("/login?error=confirmation", url.origin),
  );
}
