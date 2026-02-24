import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.INTERNAL_API_URL || "http://localhost:8080";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${BACKEND}/api/photos/search${searchParams ? "?" + searchParams : ""}`;
  const res = await fetch(url, {
    headers: { authorization: req.headers.get("authorization") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
