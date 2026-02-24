import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://go-core:8080";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const res = await fetch(`${INTERNAL_API}/api/photos/bulk-album`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.get("Authorization") ?? "",
      },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("bulk-album proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
