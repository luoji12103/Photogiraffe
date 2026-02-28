import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const res = await fetch(`${GO_CORE}/api/backup/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const res = await fetch(`${GO_CORE}/api/backup/export`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
