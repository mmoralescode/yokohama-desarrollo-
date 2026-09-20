import { NextRequest, NextResponse } from "next/server";
import { localRequestOrigin } from "./lib/local-security";

export function proxy(request: NextRequest) {
  if (!localRequestOrigin(request.headers.get("host"))) {
    return new NextResponse("MVP local: el acceso público está deshabilitado.", {status: 403});
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
