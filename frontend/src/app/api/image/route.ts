import { NextRequest, NextResponse } from "next/server";
import { Client } from "minio";

// Lazily initialized MinIO client (server-side only)
let _client: Client | null = null;
function getClient(): Client {
  if (!_client) {
    const endpoint = process.env.MINIO_INTERNAL_URL || "http://minio:9000";
    const url = new URL(endpoint);
    _client = new Client({
      endPoint: url.hostname,
      port: url.port ? parseInt(url.port) : (url.protocol === "https:" ? 443 : 9000),
      useSSL: url.protocol === "https:",
      accessKey: process.env.MINIO_ACCESS_KEY || "admin",
      secretKey: process.env.MINIO_SECRET_KEY || "admin12345",
    });
  }
  return _client;
}

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return new NextResponse("Missing path parameter", { status: 400 });
  }

  // Prevent path traversal
  if (path.includes("..") || path.startsWith("/")) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  try {
    const client = getClient();
    const stream = await client.getObject("photos", path);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);
    const contentType = path.endsWith(".webp") ? "image/webp" :
                        path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" :
                        path.endsWith(".png") ? "image/png" : "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "NoSuchKey" || code === "NotFound") {
      return new NextResponse("Image not found", { status: 404 });
    }
    console.error("Image proxy error:", err);
    return new NextResponse("Failed to fetch image from storage", { status: 502 });
  }
}
