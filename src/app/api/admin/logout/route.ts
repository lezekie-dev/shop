import { NextResponse, type NextRequest } from "next/server";
import {
  clearSessionCookieOnResponse,
  deleteSessionByToken,
  getSessionFromRequest,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session) {
    await deleteSessionByToken(session.session.token);
  }
  const res = new NextResponse(null, { status: 204 });
  clearSessionCookieOnResponse(res);
  return res;
}
