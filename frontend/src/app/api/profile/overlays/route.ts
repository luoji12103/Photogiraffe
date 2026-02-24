import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${INTERNAL_API}/api/profile/overlays`, {
      cache: "no-store",
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("overlays proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
