import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/lib/i18n/routing";

const PUBLIC_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/login$/,
  /^\/signup$/,
  /^\/auth(\/.*)?$/,
];

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/(da|en)(?=\/|$)/, "") || "/";
}

function isPublicPath(pathname: string): boolean {
  const stripped = stripLocale(pathname);
  return PUBLIC_PATTERNS.some((p) => p.test(stripped));
}

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes manage their own auth/verification.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 1) i18n: rewrites / locale negotiation. Produces the base response.
  const response = intlMiddleware(request);

  // 2) Refresh Supabase session and forward updated cookies on the response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 3) Gate non-public routes.
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // 4) Bounce signed-in users away from /login and /signup.
  if (user) {
    const stripped = stripLocale(pathname);
    if (stripped === "/login" || stripped === "/signup") {
      const url = request.nextUrl.clone();
      url.pathname = pathname.startsWith("/en") ? "/en/leads" : "/leads";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
