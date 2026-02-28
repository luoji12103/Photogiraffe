import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const res = await fetch(
    `${GO_CORE}/api/photos/tags/autocomplete?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
