import { NextRequest, NextResponse } from "next/server";
import { localRequestOrigin } from "./lib/local-security";
import { proposalMode } from "./lib/proposal-mode";

export function proxy(request: NextRequest) {
  if (proposalMode) {
    // The shareable proposal never forwards requests to a private fleet API.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({detail: "La propuesta utiliza datos de ejemplo guardados en este navegador."}, {status: 404});
    }
    return NextResponse.next();
  }
  if (!localRequestOrigin(request.headers.get("host"))) {
    return new NextResponse("MVP local: el acceso público está deshabilitado.", {status: 403});
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
