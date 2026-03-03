import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE = process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

async function getToken() {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? "";
}

/** GET /api/tags — list all tags with count */
export async function GET() {
  const token = await getToken();
  const res = await fetch(`${GO_CORE}/api/tags`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** PUT /api/tags — rename a tag */
export async function PUT(req: NextRequest) {
  const token = await getToken();
  const body = await req.json();
  const res = await fetch(`${GO_CORE}/api/tags/rename`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** POST /api/tags — merge tags */
export async function POST(req: NextRequest) {
  const token = await getToken();
  const body = await req.json();
  const res = await fetch(`${GO_CORE}/api/tags/merge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
