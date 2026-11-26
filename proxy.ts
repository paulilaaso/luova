import { type NextRequest, NextResponse } from "next/server";

/**
 * Projects live in browser storage, which is per-origin: localhost:3000 and
 * 127.0.0.1:3000 would be two separate workspaces. Send the page to one
 * canonical origin — 127.0.0.1, the address the server binds to and the one
 * ChatGPT sign-in requires. Only the page is matched; API routes are not
 * (proxy would buffer their request bodies).
 */
export function proxy(request: NextRequest) {
  // Read the Host header: nextUrl reports every loopback address
  // (127.0.0.1, [::1]) as "localhost", which would redirect in a loop.
  const host = request.headers.get("host") ?? "";
  const match = /^localhost(:\d+)?$/i.exec(host);
  if (!match) return NextResponse.next();
  const { protocol, pathname, search } = request.nextUrl;
  return NextResponse.redirect(
    `${protocol}//127.0.0.1${match[1] ?? ""}${pathname}${search}`,
    307
  );
}

export const config = {
  matcher: "/",
};
