import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const GO_CORE =
  process.env.GO_CORE_URL ?? process.env.INTERNAL_API_URL ?? "http://go-core:8080";

async function proxyGet(path: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value ?? "";
  const res = await fetch(`${GO_CORE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "summary";
  const validTypes = ["monthly", "camera", "focal-length", "iso", "summary"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  return proxyGet(`/api/analytics/${type}`);
}
