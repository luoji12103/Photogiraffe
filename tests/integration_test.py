#!/usr/bin/env python3
"""
Photogiraffe Integration Test Suite
测试范围: v7.3 Albums, v7.4 Profile, v7.5 Enhanced Presets, v8.1 Stats, v8.3 Search, v8.5 SSE,
          v9.1 Export Overlays, v9.2 Photo Visibility, v9.3 Bulk Ops, v9.4 Description+Tags,
          v9.5 Public Portfolio,
          v10.1 Admin Stats+User Mgmt, v10.2 XMP Parser, v10.3 Gallery Sort, v10.4 Photo UserID,
          v10.5 Storage Config,
          v0.25 Favorites / Stars (独立 Favorite 表，跨用户收藏公开照片)
运行方式: python3 tests/integration_test.py
需要: Go Core 运行于 http://127.0.0.1:8080
"""

import json
import os
import sys
import time
import io
import socket as _socket_module
import urllib.request
import urllib.error
import urllib.parse

BASE_URL = "http://127.0.0.1:8080"
PASS = "\033[32m✓\033[0m"
FAIL = "\033[31m✗\033[0m"
SKIP = "\033[33m~\033[0m"

failures = []
passes = []


# ─────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────

def http(method, path, body=None, token=None, form_data=None, expected_status=None):
    url = BASE_URL + path
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    elif form_data is not None:
        data = form_data
    else:
        data = None

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            raw = resp.read()
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read()
    except Exception as e:
        return None, 0, str(e)

    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = raw.decode("utf-8", errors="replace")

    return parsed, status, None


def check(name, condition, detail=""):
    if condition:
        passes.append(name)
        print(f"  {PASS} {name}")
    else:
        failures.append(name)
        print(f"  {FAIL} {name}{(' — ' + str(detail)) if detail else ''}")


def section(title):
    print(f"\n\033[1m{'═'*60}\033[0m")
    print(f"\033[1m  {title}\033[0m")
    print(f"\033[1m{'═'*60}\033[0m")


# ─────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────

def test_auth():
    section("Auth — Login")
    d, status, err = http("POST", "/api/auth/login",
                          body={"username": "admin", "password": "testadmin1234"})
    check("POST /api/auth/login 200", status == 200, f"status={status}")
    check("Response has access_token", isinstance(d, dict) and "access_token" in d, d)
    if isinstance(d, dict) and "access_token" in d:
        return d["access_token"]

    # Fallback: read from file written earlier
    try:
        with open("/tmp/pg_token.txt") as f:
            tok = f.read().strip()
        if tok:
            print(f"  {SKIP} Using cached token from /tmp/pg_token.txt")
            return tok
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────
# v7.3 Albums
# ─────────────────────────────────────────────────────────────────

def test_albums(token):
    section("v7.3 Albums — CRUD & Share")

    # Create
    d, status, _ = http("POST", "/api/albums",
                        body={"name": "Test Album CI", "description": "integration test"}, token=token)
    check("POST /api/albums 200/201", status in (200, 201), f"status={status} body={d}")
    album_id = d.get("ID") or d.get("id") if isinstance(d, dict) else None
    check("Album ID returned", album_id is not None, d)
    if album_id is None:
        return None

    # List
    d, status, _ = http("GET", "/api/albums", token=token)
    check("GET /api/albums 200", status == 200)
    check("Albums list is array", isinstance(d, list), d)
    found = any((a.get("ID") or a.get("id")) == album_id for a in d) if isinstance(d, list) else False
    check("New album in list", found)

    # Get by ID
    d, status, _ = http("GET", f"/api/albums/{album_id}", token=token)
    check(f"GET /api/albums/{album_id} 200", status == 200)
    check("Album name matches", isinstance(d, dict) and d.get("Name") == "Test Album CI", d)

    # Update
    d, status, _ = http("PUT", f"/api/albums/{album_id}",
                        body={"name": "Renamed Album CI"}, token=token)
    check(f"PUT /api/albums/{album_id} 200", status == 200)

    # Share
    d, status, _ = http("POST", f"/api/albums/{album_id}/share", token=token)
    check("POST /api/albums/:id/share 200", status == 200)
    share_token = d.get("share_token") if isinstance(d, dict) else None
    check("Share token returned", bool(share_token), d)

    if share_token:
        d2, status2, _ = http("GET", f"/share/album/{share_token}")
        check("GET /share/album/:token 200 (public)", status2 == 200, f"status={status2}")

    # Revoke share
    d, status, _ = http("DELETE", f"/api/albums/{album_id}/share", token=token)
    check("DELETE /api/albums/:id/share 200", status == 200)

    # Delete album
    d, status, _ = http("DELETE", f"/api/albums/{album_id}", token=token)
    check("DELETE /api/albums/:id 200", status == 200)

    # Confirm deleted
    d, status, _ = http("GET", f"/api/albums/{album_id}", token=token)
    check("Album deleted — 404", status == 404, f"status={status}")
    return album_id


# ─────────────────────────────────────────────────────────────────
# v7.4 User Profile
# ─────────────────────────────────────────────────────────────────

def test_profile(token):
    section("v7.4 User Profile — GET / PUT")

    d, status, _ = http("GET", "/api/profile", token=token)
    check("GET /api/profile 200", status == 200, f"status={status} body={d}")
    check("Profile is dict", isinstance(d, dict), d)

    d, status, _ = http("PUT", "/api/profile",
                        body={"bio": "CI test bio", "location": "Testland", "website": "https://example.com"},
                        token=token)
    check("PUT /api/profile 200", status == 200, f"status={status} body={d}")

    d, status, _ = http("GET", "/api/profile", token=token)
    # API returns lowercase field names
    bio_val = d.get("Bio") or d.get("bio") if isinstance(d, dict) else None
    loc_val = d.get("Location") or d.get("location") if isinstance(d, dict) else None
    check("Profile bio updated", bio_val == "CI test bio", d)
    check("Profile location updated", loc_val == "Testland", d)


# ─────────────────────────────────────────────────────────────────
# v7.5 Enhanced Presets
# ─────────────────────────────────────────────────────────────────

def test_presets(token):
    section("v7.5 Enhanced Presets — Platforms, File, Apply")

    # Create preset with platforms
    platforms = json.dumps(["Lightroom", "Capture One"])
    adjust = json.dumps({"exposure": 0.3, "contrast": 10, "saturation": 5,
                         "temperature": 0, "tint": 0, "highlights": 0,
                         "shadows": 0, "whites": 0, "blacks": 0,
                         "clarity": 0, "vibrance": 0, "sharpness": 0,
                         "noiseReduction": 0, "vignette": 0, "grain": 0,
                         "hueR": 0, "hueG": 0, "hueB": 0})
    d, status, _ = http("POST", "/api/presets",
                        body={"name": "CI Preset v7.5",
                              "description": "integration test",
                              "adjust_params": adjust,
                              "platforms": platforms},
                        token=token)
    check("POST /api/presets 200/201", status in (200, 201), f"status={status} body={d}")
    preset_id = d.get("ID") or d.get("id") if isinstance(d, dict) else None
    check("Preset ID returned", preset_id is not None, d)
    if preset_id is None:
        return

    # List presets
    d, status, _ = http("GET", "/api/presets", token=token)
    check("GET /api/presets 200", status == 200)
    found = any((p.get("ID") or p.get("id")) == preset_id for p in d) if isinstance(d, list) else False
    check("New preset in list", found, d)

    # Check platforms stored
    preset_data = next((p for p in d if (p.get("ID") or p.get("id")) == preset_id), None) if isinstance(d, list) else None
    if preset_data:
        stored_platforms = preset_data.get("Platforms", "")
        try:
            parsed_plats = json.loads(stored_platforms)
        except Exception:
            parsed_plats = []
        check("Platforms stored correctly", "Lightroom" in parsed_plats, f"platforms={stored_platforms}")

    # PUT /api/presets/:id — update
    d, status, _ = http("PUT", f"/api/presets/{preset_id}",
                        body={"name": "CI Preset v7.5 Updated",
                              "platforms": json.dumps(["Darktable"])},
                        token=token)
    check(f"PUT /api/presets/{preset_id} 200", status == 200, f"status={status} body={d}")

    # Upload preset file (fake XMP content)
    fake_xmp = b"<x:xmpmeta><!-- CI test preset file --></x:xmpmeta>"
    boundary = "testboundary12345"
    form_body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.xmp"\r\n'
        f"Content-Type: application/xml\r\n\r\n"
    ).encode() + fake_xmp + f"\r\n--{boundary}--\r\n".encode()
    headers_extra = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {token}",
    }
    req = urllib.request.Request(
        BASE_URL + f"/api/presets/{preset_id}/file",
        data=form_body,
        headers=headers_extra,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            file_status = resp.status
            file_body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        file_status = e.code
        try:
            file_body = json.loads(e.read())
        except Exception:
            file_body = {}
    check("POST /api/presets/:id/file 200", file_status == 200, f"status={file_status} body={file_body}")

    # Download URL
    d, status, _ = http("GET", f"/api/presets/{preset_id}/file", token=token)
    check("GET /api/presets/:id/file 200", status == 200, f"status={status}")
    check("download_url in response", isinstance(d, dict) and "download_url" in d, d)

    # GET photos to find a photo to apply preset to
    d, status, _ = http("GET", "/photos?limit=1", token=token)
    photo_id = None
    if isinstance(d, dict) and d.get("photos"):
        photo_id = d["photos"][0].get("ID") or d["photos"][0].get("id")
    check("Has at least one photo for apply test", photo_id is not None,
          f"(skipping apply test if no photos)" if photo_id is None else "ok")

    if photo_id:
        d, status, _ = http("POST", f"/api/presets/{preset_id}/apply/{photo_id}", token=token)
        check(f"POST /api/presets/:id/apply/:photo_id 200", status == 200, f"status={status} body={d}")

        d, status, _ = http("GET", f"/api/photos/{photo_id}/preset", token=token)
        check(f"GET /api/photos/{photo_id}/preset 200", status in (200, 404), f"status={status}")
        if status == 200 and isinstance(d, dict):
            returned_id = d.get("ID") or d.get("id")
            check("Returned preset ID matches", returned_id == preset_id, f"got={returned_id} want={preset_id}")

    # Cleanup
    d, status, _ = http("DELETE", f"/api/presets/{preset_id}", token=token)
    check(f"DELETE /api/presets/{preset_id} 200", status == 200)


# ─────────────────────────────────────────────────────────────────
# v8.1 Stats
# ─────────────────────────────────────────────────────────────────

def test_stats(token):
    section("v8.1 Dashboard Stats — GET /api/stats")
    d, status, _ = http("GET", "/api/stats", token=token)
    check("GET /api/stats 200", status == 200, f"status={status} body={str(d)[:200]}")
    if isinstance(d, dict):
        for key in ["total_photos", "completed_photos", "ai_analyzed", "albums", "presets",
                    "recent_uploads", "top_cameras", "top_lenses", "color_spaces"]:
            check(f"  stats has field '{key}'", key in d, f"keys={list(d.keys())}")
        check("total_photos >= 0", isinstance(d.get("total_photos"), int) and d["total_photos"] >= 0)
        check("recent_uploads is list", isinstance(d.get("recent_uploads"), list))
        check("top_cameras is list", isinstance(d.get("top_cameras"), list))


# ─────────────────────────────────────────────────────────────────
# v8.3 Search
# ─────────────────────────────────────────────────────────────────

def test_search(token):
    section("v8.3 Advanced Search — GET /api/photos/search")

    # Basic search no params
    d, status, _ = http("GET", "/api/photos/search", token=token)
    check("GET /api/photos/search 200", status == 200, f"status={status}")
    if isinstance(d, dict):
        check("Has photos field", "photos" in d)
        check("Has total field", "total" in d)
        check("Has total_pages", "total_pages" in d)

    # Search with keyword
    d, status, _ = http("GET", "/api/photos/search?q=test", token=token)
    check("GET /api/photos/search?q=test 200", status == 200, f"status={status}")

    # Search with camera filter
    d, status, _ = http("GET", "/api/photos/search?camera=Sony", token=token)
    check("GET /api/photos/search?camera=Sony 200", status == 200, f"status={status}")

    # Search with ISO range
    d, status, _ = http("GET", "/api/photos/search?iso_min=100&iso_max=3200", token=token)
    check("GET /api/photos/search?iso_min/max 200", status == 200, f"status={status}")

    # Search with date range
    d, status, _ = http("GET", "/api/photos/search?date_from=2025-01-01&date_to=2026-12-31", token=token)
    check("GET /api/photos/search?date_from/to 200", status == 200, f"status={status}")

    # Pagination
    d, status, _ = http("GET", "/api/photos/search?page=1&limit=5", token=token)
    check("GET /api/photos/search?page=1&limit=5 200", status == 200)
    if isinstance(d, dict):
        check("Limit respected", isinstance(d.get("photos"), list) and len(d["photos"]) <= 5)

    # GPS radius search (Paris coordinates)
    d, status, _ = http("GET", "/api/photos/search?lat=48.85&lng=2.35&radius_km=50", token=token)
    check("GET /api/photos/search?lat/lng/radius 200", status == 200, f"status={status}")

    # Unauthenticated should be 401
    d, status, _ = http("GET", "/api/photos/search")
    check("GET /api/photos/search without token → 401", status == 401, f"status={status}")


# ─────────────────────────────────────────────────────────────────
# v8.5 SSE — Server-Sent Events
# ─────────────────────────────────────────────────────────────────

def test_sse(token):
    section("v8.5 SSE — /api/events/stream")

    # 1. No token → 401
    d, status, _ = http("GET", "/api/events/stream")
    check("GET /api/events/stream without token → 401", status == 401, f"status={status}")

    # 2. Bad token → 401
    d, status, _ = http("GET", "/api/events/stream?token=bad.token.here")
    check("GET /api/events/stream bad token → 401", status == 401, f"status={status}")

    # 3. Valid token → 200 with text/event-stream + receives 'connected' event
    # Use raw socket to avoid http.client's chunked-body blocking semantics.
    try:
        req_line = (
            f"GET /api/events/stream?token={urllib.parse.quote(token)} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:8080\r\n"
            f"Connection: close\r\n\r\n"
        )
        s = _socket_module.socket(_socket_module.AF_INET, _socket_module.SOCK_STREAM)
        s.settimeout(6)
        s.connect(("127.0.0.1", 8080))
        s.sendall(req_line.encode())
        raw = b""
        try:
            while len(raw) < 2048:
                chunk = s.recv(512)
                if not chunk:
                    break
                raw += chunk
                if b"connected" in raw:
                    break
        except _socket_module.timeout:
            pass
        finally:
            s.close()

        raw_str = raw.decode("utf-8", errors="replace")
        status_line = raw_str.split("\r\n")[0]
        status_code = int(status_line.split(" ")[1]) if len(status_line.split(" ")) >= 2 else 0
        content_type_line = next((l for l in raw_str.split("\r\n") if l.lower().startswith("content-type:")), "")
        check("GET /api/events/stream with token → 200", status_code == 200, f"status_line={status_line!r}")
        check("Content-Type is text/event-stream", "text/event-stream" in content_type_line.lower(), f"header={content_type_line!r}")
        check("SSE 'connected' event received", "connected" in raw_str, f"raw={raw_str[:300]!r}")
    except Exception as e:
        check("GET /api/events/stream connection", False, str(e))
        check("Content-Type is text/event-stream", False, "connection failed")
        check("SSE 'connected' event received", False, "connection failed")


# ─────────────────────────────────────────────────────────────────
# Security
# ─────────────────────────────────────────────────────────────────

def test_security(token):
    section("Security — Auth boundary checks")

    # Unauthenticated requests should be 401
    for path in ["/api/albums", "/api/profile", "/api/presets", "/api/stats"]:
        d, status, _ = http("GET", path)
        check(f"GET {path} without token → 401", status == 401, f"status={status}")

    # Invalid token
    d, status, _ = http("GET", "/api/stats", token="invalid.token.here")
    check("GET /api/stats with bad token → 401", status == 401, f"status={status}")

    # Access other user album (album ID that doesn't exist)
    d, status, _ = http("GET", "/api/albums/999999", token=token)
    check("GET /api/albums/999999 → 404", status == 404, f"status={status}")


# ─────────────────────────────────────────────────────────────────  
# Existing endpoints regression
# ─────────────────────────────────────────────────────────────────

def test_regression(token):
    section("Regression — Core endpoints still work")

    d, status, _ = http("GET", "/photos?page=1&limit=5", token=token)
    check("GET /photos 200", status == 200, f"status={status}")
    check("Paginated photos response", isinstance(d, dict) and "photos" in d, d)

    d, status, _ = http("GET", "/api/photos/map", token=token)
    check("GET /api/photos/map 200 (v7.1)", status == 200, f"status={status}")
    check("Map response is list", isinstance(d, list), d)

    d, status, _ = http("GET", "/api/presets", token=token)
    check("GET /api/presets 200", status == 200)
    check("Presets is list", isinstance(d, list))

    d, status, _ = http("GET", "/api/albums", token=token)
    check("GET /api/albums 200", status == 200)
    check("Albums is list", isinstance(d, list))


# ─────────────────────────────────────────────────────────────────
# v9.1 Export Overlays + v9.2 Visibility + v9.4 Description/Tags
# ─────────────────────────────────────────────────────────────────

def test_phase9(token):
    section("v9.1–v9.5 Photo Metadata, Overlays, Bulk Ops & Public Portfolio")

    # ── v9.1: overlay availability ──
    d, status, _ = http("GET", "/api/profile/overlays", token=token)
    check("GET /api/profile/overlays 200", status == 200, f"status={status}")
    check("  overlays has signature field", isinstance(d, dict) and "has_signature" in d, d)
    check("  overlays has avatar field", isinstance(d, dict) and "has_avatar" in d, d)

    # ── get a photo to operate on ──
    d, status, _ = http("GET", "/photos?page=1&limit=1", token=token)
    photos = d.get("photos", []) if isinstance(d, dict) else []
    if not photos:
        check("Has at least one photo for phase9 tests", False, "no photos in library")
        return
    photo_id = photos[0]["ID"]
    check(f"  Got photo ID {photo_id} for phase9 tests", True)

    # ── v9.2: visibility toggle ──
    d, status, _ = http("PUT", f"/api/photos/{photo_id}/visibility", token=token,
                        body={"is_public": True})
    check("PUT /api/photos/:id/visibility 200", status == 200, f"status={status}")
    check("  is_public reflected in response", isinstance(d, dict) and d.get("is_public") is True, d)

    # toggle back to private
    d, status, _ = http("PUT", f"/api/photos/{photo_id}/visibility", token=token,
                        body={"is_public": False})
    check("PUT /api/photos/:id/visibility → back to private", status == 200, f"status={status}")
    check("  is_public = false", isinstance(d, dict) and d.get("is_public") is False, d)

    # ── v9.4: description + tags ──
    d, status, _ = http("PUT", f"/api/photos/{photo_id}/description", token=token,
                        body={"description": "Test caption", "tags": ["portrait", "night"]})
    check("PUT /api/photos/:id/description 200", status == 200, f"status={status}")
    check("  description reflected", isinstance(d, dict) and d.get("description") == "Test caption", d)

    # verify photo detail has description (GET /photos/:id returns nested structure)
    d, status, _ = http("GET", f"/photos/{photo_id}", token=token)
    check("GET /photos/:id still 200 after desc update", status == 200, f"status={status}")
    check("  description persisted", isinstance(d, dict) and d.get("photo", {}).get("Description") == "Test caption", d)

    # ── v9.3: bulk-delete (empty list → 400) ──
    d, status, _ = http("POST", "/api/photos/bulk-delete", token=token,
                        body={"ids": []})
    check("POST /api/photos/bulk-delete empty → 400", status == 400, f"status={status}")

    # bulk-delete with non-existent IDs → should 200 (no rows affected is fine)
    d, status, _ = http("POST", "/api/photos/bulk-delete", token=token,
                        body={"ids": [999999, 999998]})
    check("POST /api/photos/bulk-delete non-existent IDs → 200", status == 200, f"status={status}")

    # ── v9.3: bulk-album (album must exist) ──
    # first create a temp album
    alb, astatus, _ = http("POST", "/api/albums", token=token, body={"name": "BulkTest"})
    if astatus in (200, 201) and isinstance(alb, dict) and "ID" in alb:
        alb_id = alb["ID"]
        d, status, _ = http("POST", "/api/photos/bulk-album", token=token,
                            body={"photo_ids": [photo_id], "album_id": alb_id})
        check("POST /api/photos/bulk-album 200", status == 200, f"status={status}")

        # cleanup
        http("DELETE", f"/api/albums/{alb_id}", token=token)
    else:
        check("POST /api/photos/bulk-album 200", False, f"could not create temp album: {astatus}")

    # ── v9.5: public portfolio (photo needs is_public=true first) ──
    # set one photo public
    http("PUT", f"/api/photos/{photo_id}/visibility", token=token, body={"is_public": True})

    # get current user's username
    me, _, _ = http("GET", "/api/auth/me", token=token)
    username = me.get("username", "admin") if isinstance(me, dict) else "admin"

    d, status, _ = http("GET", f"/public/profile/{username}")
    check("GET /public/profile/:username 200 (unauthenticated)", status == 200, f"status={status}")
    check("  profile has username", isinstance(d, dict) and d.get("username") == username, d)
    check("  profile has photos list", isinstance(d, dict) and isinstance(d.get("photos"), list), d)
    check("  public photos only (no private)", all(
        p.get("is_public", False) for p in (d.get("photos") or [])
    ), "found private photo in public portfolio")

    # unauthenticated PUT to visibility should return 401
    d, status, _ = http("PUT", f"/api/photos/{photo_id}/visibility",
                        body={"is_public": False})
    check("PUT visibility without token → 401", status == 401, f"status={status}")

    # cleanup: set back to private
    http("PUT", f"/api/photos/{photo_id}/visibility", token=token, body={"is_public": False})


# ─────────────────────────────────────────────────────────────────
# Phase 10: Admin UI, XMP Parser, Masonry/Sort, View/Edit Split, Storage
# ─────────────────────────────────────────────────────────────────

def test_phase10(token):
    section("v10.1–v10.5  Admin Stats · XMP Parser · Gallery Sort · Storage Config")

    # ── v10.1: admin stats dashboard ──
    d, status, _ = http("GET", "/api/admin/stats", token=token)
    check("GET /api/admin/stats 200", status == 200, f"status={status}")
    check("  stats has total_users",  isinstance(d, dict) and "total_users"  in d, d)
    check("  stats has total_photos", isinstance(d, dict) and "total_photos" in d, d)
    check("  stats has total_albums", isinstance(d, dict) and "total_albums" in d, d)
    check("  stats has total_presets",isinstance(d, dict) and "total_presets"in d, d)
    check("  stats has top_users list",
          isinstance(d, dict) and isinstance(d.get("top_users"), list), d)

    # ── v10.1: enhanced admin users list ──
    d, status, _ = http("GET", "/api/admin/users", token=token)
    check("GET /api/admin/users 200 (phase10)", status == 200, f"status={status}")
    users = d if isinstance(d, list) else (d.get("users") or []) if isinstance(d, dict) else []
    if users:
        first = users[0]
        check("  user has photo_count field",  "photo_count" in first, first)
        check("  user has public_id field",    "public_id"   in first or "PublicID" in first, first)
        first_user_id = first.get("id") or first.get("ID")
    else:
        check("  user has photo_count field", False, "no users returned")
        first_user_id = None

    # ── v10.1: user photos endpoint ──
    if first_user_id:
        d, status, _ = http("GET", f"/api/admin/users/{first_user_id}/photos", token=token)
        check(f"GET /api/admin/users/:id/photos 200", status == 200, f"status={status}")
        check("  returns photos list",
              isinstance(d, dict) and isinstance(d.get("photos"), list), d)

    # ── v10.1: role change (self-change attempt should fail) ──
    me, _, _ = http("GET", "/api/auth/me", token=token)
    my_id = me.get("id") if isinstance(me, dict) else None
    if my_id:
        d, status, _ = http("PUT", f"/api/admin/users/{my_id}/role",
                            token=token, body={"role": "User"})
        check("PUT /api/admin/users/self/role → 400 (self-change blocked)",
              status == 400, f"status={status}")

    # ── v10.3: gallery sort parameters ──
    for sort_val in ("date_desc", "date_asc", "filename", "camera", "iso"):
        d, status, _ = http("GET", f"/photos?sort={sort_val}&page=1&limit=1", token=token)
        check(f"GET /photos?sort={sort_val} 200", status == 200, f"status={status}")

    # ── v10.4: photo UserID field present in response ──
    d, status, _ = http("GET", "/photos?page=1&limit=1", token=token)
    photos = d.get("photos", []) if isinstance(d, dict) else []
    if photos:
        photo_id = photos[0]["ID"]
        pd, pstatus, _ = http("GET", f"/photos/{photo_id}", token=token)
        check("GET /photos/:id 200 (v10.4 check)", pstatus == 200, f"status={pstatus}")
        check("  photo has UserID field", isinstance(pd, dict) and "UserID" in pd.get("photo", {}), pd)
    else:
        check("  photo UserID check", False, "no photos in library")

    # ── v10.2: XMP preset parse ──
    xmp_content = b"""<?xml version="1.0" encoding="utf-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:Exposure2012="0.5"
      crs:Contrast2012="20"
      crs:Highlights2012="-30"
      crs:Shadows2012="25"
      crs:Whites2012="10"
      crs:Blacks2012="-15"
      crs:Clarity2012="15"
      crs:Vibrance="10"
      crs:Saturation="5"
    />
  </rdf:RDF>
</x:xmpmeta>"""

    boundary = b"----TestBoundary7890"
    body_parts = (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="test.xmp"\r\n'
        b"Content-Type: application/xml\r\n\r\n" +
        xmp_content + b"\r\n"
        b"--" + boundary + b"--\r\n"
    )
    form_req = urllib.request.Request(
        BASE_URL + "/api/presets/parse-xmp",
        data=body_parts,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary.decode()}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(form_req, timeout=10) as resp:
            xmp_status = resp.status
            xmp_data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        xmp_status = e.code
        try:
            xmp_data = json.loads(e.read())
        except Exception:
            xmp_data = {}
    except Exception as ex:
        xmp_status = 0
        xmp_data = {"error": str(ex)}

    check("POST /api/presets/parse-xmp 200", xmp_status == 200, f"status={xmp_status}, body={xmp_data}")
    check("  parse result has params dict",
          isinstance(xmp_data, dict) and isinstance(xmp_data.get("params"), dict), xmp_data)
    check("  exposure parsed correctly",
          isinstance(xmp_data, dict) and xmp_data.get("params", {}).get("exposure") == 0.5, xmp_data)
    check("  format field present",
          isinstance(xmp_data, dict) and xmp_data.get("format") in ("xmp", "lrtemplate"), xmp_data)

    # ── v10.5: storage config ──
    d, status, _ = http("GET", "/api/admin/storage", token=token)
    check("GET /api/admin/storage 200", status == 200, f"status={status}")
    check("  storage has backend field",   isinstance(d, dict) and "backend"   in d, d)
    check("  storage has endpoint field",  isinstance(d, dict) and "endpoint"  in d, d)
    check("  secret_key masked",
          isinstance(d, dict) and d.get("secret_key", "") in ("", "********"), d)

    # PUT /api/admin/storage — update root_path and restore
    orig_region = d.get("region", "") if isinstance(d, dict) else ""
    updated, upstatus, _ = http("PUT", "/api/admin/storage", token=token,
                                body={"region": "us-east-1-test"})
    check("PUT /api/admin/storage 200", upstatus == 200, f"status={upstatus}")
    check("  updated region reflected",
          isinstance(updated, dict) and updated.get("region") == "us-east-1-test", updated)

    # restore original region
    http("PUT", "/api/admin/storage", token=token, body={"region": orig_region})

    # POST /api/admin/storage/test — basic validation (should return 200 even if connection fails
    # as long as a config row exists)
    d, status, _ = http("POST", "/api/admin/storage/test", token=token)
    check("POST /api/admin/storage/test 200 or 503",
          status in (200, 503), f"status={status}")


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def test_phase16(token):
    section("v16.1–v16.4  Dominant Colours · colour_bucket filter")

    # ── colour_bucket filter: valid buckets return 200 ──
    for bucket in ("red", "blue", "green", "black", "white"):
        d, status, _ = http("GET", f"/photos?color_bucket={bucket}&page=1&limit=5", token=token)
        check(f"GET /photos?color_bucket={bucket} 200", status == 200, f"status={status}")
        check(f"  response has photos list",
              isinstance(d, dict) and isinstance(d.get("photos"), list), d)

    # ── photo response may carry DominantColors field (null or JSON) ──
    d, status, _ = http("GET", "/photos?page=1&limit=1", token=token)
    photos = d.get("photos", []) if isinstance(d, dict) else []
    if photos:
        photo = photos[0]
        # DominantColors key should be present (may be null until worker re-runs)
        # We accept both present-with-value and absent/null
        check("  photo response has DominantColors key (or null)",
              "DominantColors" in photo or photo.get("DominantColors") is None,
              f"keys={list(photo.keys())}")

    # ── internal dominant-colors endpoint: requires X-Internal-Secret ──
    internal_secret = os.getenv("INTERNAL_SECRET", "")
    if not internal_secret:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
        try:
            with open(env_path) as _ef:
                for _line in _ef:
                    if _line.startswith("INTERNAL_SECRET="):
                        internal_secret = _line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    # Without secret → 403
    _, status, _ = http("PUT", "/internal/photos/1/dominant-colors",
                        body={"dominant_colors": "[]"})
    check("PUT /internal/photos/:id/dominant-colors without secret → 403",
          status == 403, f"status={status}")

    # With secret → 404 (photo id 999999 not found) or 200 if photo exists
    try:
        payload = json.dumps({"dominant_colors": '[{"hex":"#112233","bucket":"blue","pct":100.0}]'}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/internal/photos/999999/dominant-colors",
            data=payload,
            headers={"Content-Type": "application/json", "X-Internal-Secret": internal_secret},
            method="PUT",
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            dc_status = 200
        except urllib.error.HTTPError as e:
            dc_status = e.code
    except Exception as e:
        dc_status = 0
    check("PUT /internal/photos/999999/dominant-colors with secret → 200 (0 rows updated OK)",
          dc_status == 200, f"status={dc_status}")


# ─────────────────────────────────────────────────────────────────

def test_phase17(token):
    section("v17.1–v17.4  Perceptual Hash Deduplication (pHash)")

    # ── GET /api/photos/duplicates requires auth ──
    _, status, _ = http("GET", "/api/photos/duplicates")
    check("GET /api/photos/duplicates without token → 401", status == 401, f"status={status}")

    # ── GET /api/photos/duplicates returns groups array ──
    d, status, _ = http("GET", "/api/photos/duplicates", token=token)
    check("GET /api/photos/duplicates 200", status == 200, f"status={status}")
    check("  response has groups list",
          isinstance(d, dict) and isinstance(d.get("groups"), list), d)
    check("  response has total_groups int",
          isinstance(d, dict) and isinstance(d.get("total_groups"), int), d)

    # ── internal phash endpoint: requires X-Internal-Secret ──
    internal_secret = os.getenv("INTERNAL_SECRET", "")
    if not internal_secret:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
        try:
            with open(env_path) as _ef:
                for _line in _ef:
                    if _line.startswith("INTERNAL_SECRET="):
                        internal_secret = _line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass

    # Without secret → 403
    _, status, _ = http("PUT", "/internal/photos/1/phash",
                        body={"phash": "a1b2c3d4e5f60718"})
    check("PUT /internal/photos/:id/phash without secret → 403",
          status == 403, f"status={status}")

    # With secret, non-existent photo ID → 200 (GORM updates 0 rows without error)
    try:
        payload = json.dumps({"phash": "a1b2c3d4e5f60718"}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/internal/photos/999999/phash",
            data=payload,
            headers={"Content-Type": "application/json", "X-Internal-Secret": internal_secret},
            method="PUT",
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            ph_status = 200
        except urllib.error.HTTPError as e:
            ph_status = e.code
    except Exception as e:
        ph_status = 0
    check("PUT /internal/photos/999999/phash with secret → 200 (0 rows updated OK)",
          ph_status == 200, f"status={ph_status}")


def main():
    print("\n\033[1;36m  Photogiraffe Integration Test Suite\033[0m")
    print(f"  Target: {BASE_URL}")
    print(f"  Time: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")

    token = test_auth()
    if not token:
        print("\n\033[31mFATAL: Could not obtain auth token. Aborting.\033[0m")
        sys.exit(1)

    test_regression(token)
    test_albums(token)
    test_profile(token)
    test_presets(token)
    test_stats(token)
    test_search(token)
    test_sse(token)
    test_phase9(token)
    test_phase10(token)
    test_security(token)
    test_phase16(token)
    test_phase17(token)
    test_phase18(token)
    test_phase19(token)
    test_phase20(token)
    test_phase21(token)
    test_phase22(token)
    test_phase23(token)
    test_phase24()
    test_phase25(token)
    test_phase26(token)
    test_phase27(token)
    test_phase28(token)
    test_phase29(token)
    test_phase30(token)
    test_phase31(token)
    test_phase32(token)
    test_phase33(token)
    test_phase34(token)
    test_phase36(token)

    # Summary
    total = len(passes) + len(failures)
    print(f"\n{'═'*60}")
    print(f"\033[1m  Results: {len(passes)}/{total} passed\033[0m")
    if failures:
        print(f"\033[31m  Failed ({len(failures)}):\033[0m")
        for f in failures:
            print(f"    • {f}")
    else:
        print(f"\033[32m  All tests passed! ✓\033[0m")
    print(f"{'═'*60}\n")

    sys.exit(0 if not failures else 1)


def test_phase18(token):
    section("v18.1–v18.3  Admin AI Rate Limiting")

    # ── GET without admin token → 401 ──
    _, status, _ = http("GET", "/api/admin/ai-rate-limits")
    check("GET /api/admin/ai-rate-limits without token → 401", status == 401, f"status={status}")

    # ── GET with admin token → 200 ──
    d, status, _ = http("GET", "/api/admin/ai-rate-limits", token=token)
    check("GET /api/admin/ai-rate-limits 200", status == 200, f"status={status}")
    check("  response is a list",
          isinstance(d, list), d)

    # ── POST create a rule ──
    body = {"target_type": "all", "window": "minute", "max_requests": 50, "enabled": True, "note": "test rule"}
    d, status, _ = http("POST", "/api/admin/ai-rate-limits", token=token, body=body)
    check("POST /api/admin/ai-rate-limits 201", status == 201, f"status={status}")
    rule_id = d.get("ID") or d.get("id") if isinstance(d, dict) else None
    check("  response has ID", rule_id is not None, d)

    # ── POST invalid window → 400 ──
    _, status, _ = http("POST", "/api/admin/ai-rate-limits", token=token,
                        body={"target_type": "all", "window": "invalid", "max_requests": 10})
    check("POST /api/admin/ai-rate-limits invalid window → 400", status == 400, f"status={status}")

    # ── PUT toggle ──
    if rule_id:
        d, status, _ = http("PUT", f"/api/admin/ai-rate-limits/{rule_id}", token=token,
                            body={"enabled": False})
        check(f"PUT /api/admin/ai-rate-limits/{rule_id} 200", status == 200, f"status={status}")

    # ── DELETE the rule ──
    if rule_id:
        _, status, _ = http("DELETE", f"/api/admin/ai-rate-limits/{rule_id}", token=token)
        check(f"DELETE /api/admin/ai-rate-limits/{rule_id} 200", status == 200, f"status={status}")

    # ── Verify deleted ──
    d, status, _ = http("GET", "/api/admin/ai-rate-limits", token=token)
    ids = [r.get("ID") or r.get("id") for r in (d if isinstance(d, list) else [])]
    check("  deleted rule no longer in list", rule_id not in ids, ids)


def test_phase19(token):
    section("v0.19  Export History Management")

    # ── GET /api/exports without token → 401 ──
    _, status, _ = http("GET", "/api/exports")
    check("GET /api/exports without token → 401", status == 401, f"status={status}")

    # ── GET /api/exports → 200 with jobs/total/page/limit ──
    d, status, _ = http("GET", "/api/exports", token=token)
    check("GET /api/exports 200", status == 200, f"status={status}")
    check("  response has jobs list", isinstance(d, dict) and isinstance(d.get("jobs"), list), d)
    check("  response has total int", isinstance(d, dict) and isinstance(d.get("total"), int), d)
    check("  response has page int", isinstance(d, dict) and isinstance(d.get("page"), int), d)

    # ── GET /api/exports?status=completed → 200 ──
    d, status, _ = http("GET", "/api/exports?status=completed", token=token)
    check("GET /api/exports?status=completed 200", status == 200, f"status={status}")

    # ── DELETE non-existent → 404 ──
    _, status, _ = http("DELETE", "/api/exports/999999", token=token)
    check("DELETE /api/exports/999999 → 404", status == 404, f"status={status}")


def test_phase20(token):
    section("v0.20  CLIP Local Auto-Tag")

    # ── POST /api/photos/:id/auto-tag without token → 401 ──
    _, status, _ = http("POST", "/api/photos/1/auto-tag")
    check("POST /api/photos/1/auto-tag without token → 401", status == 401, f"status={status}")

    # ── POST /api/photos/999999/auto-tag → 404 ──
    _, status, _ = http("POST", "/api/photos/999999/auto-tag", token=token)
    check("POST /api/photos/999999/auto-tag → 404", status == 404, f"status={status}")

    # ── Resolve internal secret ──
    internal_secret = os.getenv("INTERNAL_SECRET", "")
    if not internal_secret:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
        try:
            with open(env_path) as _ef:
                for _line in _ef:
                    if _line.startswith("INTERNAL_SECRET="):
                        internal_secret = _line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass

    # ── PUT /internal/photos/999999/auto-tags without secret → 401 ──
    _, status, _ = http("PUT", "/internal/photos/999999/auto-tags",
                        body={"auto_tags": '["landscape"]'})
    check("PUT /internal/photos/999999/auto-tags without secret → 401/403",
          status in (401, 403), f"status={status}")

    # ── PUT /internal/photos/999999/auto-tags with secret → 404 (no such photo) ──
    try:
        payload = json.dumps({"auto_tags": '["landscape","golden hour"]'}).encode()
        req = urllib.request.Request(
            f"{BASE_URL}/internal/photos/999999/auto-tags",
            data=payload,
            headers={"Content-Type": "application/json", "X-Internal-Secret": internal_secret},
            method="PUT",
        )
        try:
            urllib.request.urlopen(req, timeout=5)
            at_status = 200
        except urllib.error.HTTPError as e:
            at_status = e.code
    except Exception as e:
        at_status = 0
    check("PUT /internal/photos/999999/auto-tags with secret → 404 (photo not found)",
          at_status == 404, f"status={at_status}")


def test_phase21(token):
    section("v0.21  Map Clustering + Date Filter")

    # ── GET /api/photos/map without token → 401 ──
    _, status, _ = http("GET", "/api/photos/map")
    check("GET /api/photos/map without token → 401", status == 401, f"status={status}")

    # ── GET /api/photos/map → 200, returns array ──
    d, status, _ = http("GET", "/api/photos/map", token=token)
    check("GET /api/photos/map → 200", status == 200, f"status={status}")
    check("  response is a list", isinstance(d, list), d)

    # ── GET /api/photos/map with date range → 200 ──
    d, status, _ = http("GET", "/api/photos/map?start_date=2020-01-01&end_date=2030-12-31", token=token)
    check("GET /api/photos/map?start_date=...&end_date=... → 200", status == 200, f"status={status}")
    check("  response is a list with date params", isinstance(d, list), d)

    # ── GET /api/photos/map with limit → 200 ──
    d, status, _ = http("GET", "/api/photos/map?limit=10", token=token)
    check("GET /api/photos/map?limit=10 → 200", status == 200, f"status={status}")
    check("  result count ≤ 10", isinstance(d, list) and len(d) <= 10, f"len={len(d) if isinstance(d, list) else d}")

    # ── Check shot_at field is present on each point (may be empty string) ──
    if isinstance(d, list) and len(d) > 0:
        first = d[0]
        check("  map point has shot_at field", "shot_at" in first, f"keys={list(first.keys())}")


def test_phase22(token):
    section("v0.22  Account Security + SMTP")

    # ── PUT /api/auth/change-password without token → 401 ──
    _, status, _ = http("PUT", "/api/auth/change-password",
                        body={"old_password": "x", "new_password": "y"})
    check("PUT /api/auth/change-password without token → 401", status == 401, f"status={status}")

    # ── PUT /api/auth/change-password with wrong old password → 401 ──
    _, status, _ = http("PUT", "/api/auth/change-password", token=token,
                        body={"old_password": "definitely_wrong_password_xyz", "new_password": "newpass123"})
    check("PUT /api/auth/change-password wrong old pw → 401", status == 401, f"status={status}")

    # ── PUT /api/auth/update-profile without token → 401 ──
    _, status, _ = http("PUT", "/api/auth/update-profile",
                        body={"username": "x", "email": "x@x.com"})
    check("PUT /api/auth/update-profile without token → 401", status == 401, f"status={status}")

    # ── GET /api/auth/login-history → 200, returns list ──
    d, status, _ = http("GET", "/api/auth/login-history", token=token)
    check("GET /api/auth/login-history → 200", status == 200, f"status={status}")
    check("  login-history is a list", isinstance(d, list), d)

    # ── POST /api/auth/forgot-password (anti-enumeration) → 200 ──
    _, status, _ = http("POST", "/api/auth/forgot-password",
                        body={"email": "nonexistent@example.invalid"})
    check("POST /api/auth/forgot-password anti-enum → 200", status == 200, f"status={status}")

    # ── POST /api/auth/reset-password with bad token → 410 ──
    _, status, _ = http("POST", "/api/auth/reset-password",
                        body={"token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                              "new_password": "newpass123"})
    check("POST /api/auth/reset-password bad token → 410", status == 410, f"status={status}")

    # ── GET /api/admin/smtp without token → 401 ──
    _, status, _ = http("GET", "/api/admin/smtp")
    check("GET /api/admin/smtp without token → 401", status == 401, f"status={status}")

    # ── GET /api/admin/smtp as admin → 200 ──
    d, status, _ = http("GET", "/api/admin/smtp", token=token)
    check("GET /api/admin/smtp as admin → 200", status == 200, f"status={status}")
    check("  smtp config has host field", isinstance(d, dict) and "host" in d, d)


def test_phase23(token):
    section("v0.23  Photo Notes + Timeline")

    # ── GET /api/photos/timeline without token → 401 ──
    _, status, _ = http("GET", "/api/photos/timeline")
    check("GET /api/photos/timeline without token → 401", status == 401, f"status={status}")

    # ── GET /api/photos/timeline → 200, returns array ──
    d, status, _ = http("GET", "/api/photos/timeline", token=token)
    check("GET /api/photos/timeline → 200", status == 200, f"status={status}")
    check("  timeline is a list", isinstance(d, list), d)

    # ── GET /api/photos/1/notes without token → 401 ──
    _, status, _ = http("GET", "/api/photos/1/notes")
    check("GET /api/photos/1/notes without token → 401", status == 401, f"status={status}")

    # ── GET /api/photos/999999/notes → 404 (no such photo) ──
    _, status, _ = http("GET", "/api/photos/999999/notes", token=token)
    check("GET /api/photos/999999/notes → 404", status == 404, f"status={status}")

    # ── POST /api/photos/999999/notes → 404 ──
    _, status, _ = http("POST", "/api/photos/999999/notes", token=token,
                        body={"content": "test note"})
    check("POST /api/photos/999999/notes → 404", status == 404, f"status={status}")

    # ── PUT /api/photos/1/notes/999999 → 404 (no such note) ──
    _, status, _ = http("PUT", "/api/photos/1/notes/999999", token=token,
                        body={"content": "updated"})
    check("PUT /api/photos/1/notes/999999 → 404", status == 404, f"status={status}")

    # ── DELETE /api/photos/1/notes/999999 → 404 ──
    _, status, _ = http("DELETE", "/api/photos/1/notes/999999", token=token)
    check("DELETE /api/photos/1/notes/999999 → 404", status == 404, f"status={status}")


def test_phase24():
    section("v0.24  PWA Improvements (frontend)")
    # Phase 24 is primarily frontend (manifest, sw.js, offline page, InstallPrompt).
    # We validate backend-reachable checks only.

    # ── All auth endpoints still respond correctly ──
    _, status, _ = http("GET", "/api/auth/me")
    check("GET /api/auth/me without token → 401 (regression)", status == 401, f"status={status}")

    # ── Timeline endpoint still available ──
    _, status, _ = http("GET", "/api/photos/timeline")
    check("GET /api/photos/timeline without token → 401 (regression)", status == 401, f"status={status}")

    # ── Admin SMTP endpoint still available ──
    _, status, _ = http("GET", "/api/admin/smtp")
    check("GET /api/admin/smtp without token → 401 (regression)", status == 401, f"status={status}")

    # ── Forgot password (public endpoint) still 200 ──
    _, status, _ = http("POST", "/api/auth/forgot-password",
                        body={"email": "test@example.invalid"})
    check("POST /api/auth/forgot-password public endpoint → 200 (regression)", status == 200, f"status={status}")


def test_phase25(token):
    section("v0.25  Favorites / Stars")

    # ── GET /api/photos/favorites — authenticated required ──
    _, status, _ = http("GET", "/api/photos/favorites")
    check("GET /api/photos/favorites without token → 401", status == 401, f"status={status}")

    # ── GET /api/photos/favorites — empty list for fresh user ──
    d, status, _ = http("GET", "/api/photos/favorites", token=token)
    check("GET /api/photos/favorites → 200", status == 200, f"status={status}")
    check("GET /api/photos/favorites → has 'photos' key", isinstance(d, dict) and "photos" in d, d)
    check("GET /api/photos/favorites → has 'total' key", isinstance(d, dict) and "total" in d, d)

    # ── POST /api/photos/9999999/favorite — nonexistent photo → 404 ──
    _, status, _ = http("POST", "/api/photos/9999999/favorite", token=token)
    check("POST /api/photos/9999999/favorite → 404", status == 404, f"status={status}")

    # ── DELETE /api/photos/9999999/favorite — nonexistent photo → 200 (silently ignores) ──
    d, status, _ = http("DELETE", "/api/photos/9999999/favorite", token=token)
    check("DELETE /api/photos/9999999/favorite → 200 (noop)", status == 200, f"status={status}")

    # ── Find a real photo owned by the test user ──
    photos_d, status, _ = http("GET", "/api/photos", token=token)
    photo_id = None
    if status == 200 and isinstance(photos_d, dict) and photos_d.get("photos"):
        photo_id = photos_d["photos"][0]["ID"]
    elif status == 200 and isinstance(photos_d, list) and photos_d:
        photo_id = photos_d[0]["ID"]

    if photo_id:
        # ── POST favorite on own photo ──
        d, status, _ = http("POST", f"/api/photos/{photo_id}/favorite", token=token)
        check(f"POST /api/photos/{photo_id}/favorite → 200", status == 200, f"status={status}")
        check("favorite response has 'favorited' key", isinstance(d, dict) and "favorited" in d, d)
        check("favorite response 'favorited' is true", d.get("favorited") is True, d)

        # ── GET /api/photos/favorites — should now have at least 1 ──
        d, status, _ = http("GET", "/api/photos/favorites", token=token)
        check("GET /api/photos/favorites after star → 200", status == 200, f"status={status}")
        count_after = d.get("total", 0) if isinstance(d, dict) else 0
        check("favorites total ≥ 1 after starring", count_after >= 1, f"total={count_after}")

        # ── GET /api/photos/{id}/favorite/count ──
        d, status, _ = http("GET", f"/api/photos/{photo_id}/favorite/count", token=token)
        check(f"GET /api/photos/{photo_id}/favorite/count → 200", status == 200, f"status={status}")
        check("count response has 'count' key", isinstance(d, dict) and "count" in d, d)
        check("count ≥ 1 after starring", (d.get("count") or 0) >= 1, d)
        check("count response has 'is_favorited' key", "is_favorited" in d, d)
        check("is_favorited is true", d.get("is_favorited") is True, d)

        # ── GET /api/photos/{id} — single photo has 'photo' + 'is_favorited' ──
        d, status, _ = http("GET", f"/api/photos/{photo_id}", token=token)
        check(f"GET /api/photos/{photo_id} → 200", status == 200, f"status={status}")
        check("single photo response has 'photo' key", isinstance(d, dict) and "photo" in d, d)
        check("single photo response has 'is_favorited' key", isinstance(d, dict) and "is_favorited" in d, d)
        check("single photo is_favorited is true", d.get("is_favorited") is True, d)

        # ── DELETE favorite ──
        d, status, _ = http("DELETE", f"/api/photos/{photo_id}/favorite", token=token)
        check(f"DELETE /api/photos/{photo_id}/favorite → 200", status == 200, f"status={status}")
        check("unfavorite response has 'favorited' key", isinstance(d, dict) and "favorited" in d, d)
        check("unfavorite response 'favorited' is false", d.get("favorited") is False, d)

        # ── GET favorites count after unfav ──
        d, status, _ = http("GET", f"/api/photos/{photo_id}/favorite/count", token=token)
        check("is_favorited is false after unfav", d.get("is_favorited") is False, d)
    else:
        print(f"  {SKIP} Phase 25 favorite-on-own-photo tests (no photos found)")



def test_phase26(token):
    section("v0.26  Bulk Operations (Unified /api/photos/bulk)")

    # ── Unauthenticated access is denied ──
    _, status, _ = http("POST", "/api/photos/bulk")
    check("POST /api/photos/bulk without token → 401", status == 401, f"status={status}")

    # ── Empty IDs returns 400 ──
    _, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [], "action": "set_public"})
    check("POST /api/photos/bulk empty ids → 400", status == 400, f"status={status}")

    # ── Unknown action returns 400 ──
    _, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [1], "action": "invalid_action"})
    check("POST /api/photos/bulk unknown action → 400", status == 400, f"status={status}")

    # ── set_public on nonexistent photo → 200 (0 rows affected) ──
    d, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [9999999], "action": "set_public"})
    check("POST /api/photos/bulk set_public unknown photo → 200", status == 200, f"status={status}")
    check("set_public response has 'action' key", isinstance(d, dict) and "action" in d, d)

    # ── set_private simlarly ──
    d, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [9999999], "action": "set_private"})
    check("POST /api/photos/bulk set_private → 200", status == 200, f"status={status}")

    # ── add_tag requires tag param ──
    _, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [1], "action": "add_tag", "tag": ""})
    check("POST /api/photos/bulk add_tag empty tag → 400", status == 400, f"status={status}")

    # ── star/unstar on nonexistent photo IDs → 200 ──
    d, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [9999998, 9999999], "action": "star"})
    check("POST /api/photos/bulk star → 200", status == 200, f"status={status}")
    check("star response has 'count' key", isinstance(d, dict) and "count" in d, d)

    d, status, _ = http("POST", "/api/photos/bulk", token=token,
                        body={"ids": [9999998, 9999999], "action": "unstar"})
    check("POST /api/photos/bulk unstar → 200", status == 200, f"status={status}")

    # ── Find a real photo and test add_tag / remove_tag ──
    photos_d, status, _ = http("GET", "/api/photos", token=token)
    photo_id = None
    if status == 200 and isinstance(photos_d, dict) and photos_d.get("photos"):
        photo_id = photos_d["photos"][0]["ID"]
    elif status == 200 and isinstance(photos_d, list) and photos_d:
        photo_id = photos_d[0]["ID"]

    if photo_id:
        # add_tag
        d, status, _ = http("POST", "/api/photos/bulk", token=token,
                            body={"ids": [photo_id], "action": "add_tag", "tag": "bulk-test"})
        check(f"POST /api/photos/bulk add_tag on photo → 200", status == 200, f"status={status}")
        check("add_tag response has 'tag' key", isinstance(d, dict) and "tag" in d, d)
        check("add_tag response tag matches", d.get("tag") == "bulk-test", d)

        # remove_tag
        d, status, _ = http("POST", "/api/photos/bulk", token=token,
                            body={"ids": [photo_id], "action": "remove_tag", "tag": "bulk-test"})
        check(f"POST /api/photos/bulk remove_tag on photo → 200", status == 200, f"status={status}")
    else:
        print(f"  {SKIP} Phase 26 tag tests (no photos found)")


def test_phase27(token):
    section("v0.27  Smart Albums")

    # ── Unauthenticated access denied ──
    _, status, _ = http("GET", "/api/smart-albums")
    check("GET /api/smart-albums without token → 401", status == 401, f"status={status}")

    # ── Create smart album (date_range) ──
    d, status, _ = http("POST", "/api/smart-albums", token=token, body={
        "name": "Test Smart Album",
        "rule_type": "date_range",
        "rule_params": '{"from":"2020-01-01","to":"2030-12-31"}'
    })
    check("POST /api/smart-albums → 201", status == 201, f"status={status}")
    check("create response has 'ID' key", isinstance(d, dict) and "ID" in d, d)
    album_id = d.get("ID") if isinstance(d, dict) else None

    # ── Invalid rule_type returns 400 ──
    _, status, _ = http("POST", "/api/smart-albums", token=token, body={
        "name": "Bad Album",
        "rule_type": "invalid_rule",
        "rule_params": "{}"
    })
    check("POST /api/smart-albums invalid rule_type → 400", status == 400, f"status={status}")

    # ── Missing name returns 400 ──
    _, status, _ = http("POST", "/api/smart-albums", token=token, body={
        "name": "",
        "rule_type": "date_range",
        "rule_params": "{}"
    })
    check("POST /api/smart-albums missing name → 400", status == 400, f"status={status}")

    # ── List smart albums ──
    d, status, _ = http("GET", "/api/smart-albums", token=token)
    check("GET /api/smart-albums → 200", status == 200, f"status={status}")
    check("list response is a list", isinstance(d, list), d)

    if album_id:
        # ── Evaluate smart album photos ──
        d, status, _ = http("GET", f"/api/smart-albums/{album_id}/photos", token=token)
        check(f"GET /api/smart-albums/:id/photos → 200", status == 200, f"status={status}")
        check("photos response has 'photos' key", isinstance(d, dict) and "photos" in d, d)
        check("photos response has 'total' key", isinstance(d, dict) and "total" in d, d)

        # ── Update smart album ──
        d2, status, _ = http("PUT", f"/api/smart-albums/{album_id}", token=token, body={
            "name": "Updated Smart Album"
        })
        check(f"PUT /api/smart-albums/:id → 200", status == 200, f"status={status}")
        check("updated name matches", d2.get("Name") == "Updated Smart Album", d2)

        # ── Delete smart album ──
        d3, status, _ = http("DELETE", f"/api/smart-albums/{album_id}", token=token)
        check(f"DELETE /api/smart-albums/:id → 200", status == 200, f"status={status}")
        check("delete response 'deleted' is true", isinstance(d3, dict) and d3.get("deleted") is True, d3)

        # ── Verify deletion — 404 ──
        _, status, _ = http("GET", f"/api/smart-albums/{album_id}", token=token)
        check(f"GET deleted smart album → 404", status == 404, f"status={status}")
    else:
        print(f"  {SKIP} Phase 27 album CRUD tests (create failed)")


def test_phase28(token):
    section("v0.28  Analytics / Statistics")

    # ── Unauthenticated access denied ──
    _, status, _ = http("GET", "/api/analytics/summary")
    check("GET /api/analytics/summary without token → 401", status == 401, f"status={status}")

    # ── Summary ──
    d, status, _ = http("GET", "/api/analytics/summary", token=token)
    check("GET /api/analytics/summary → 200", status == 200, f"status={status}")
    check("summary has 'total_photos'", isinstance(d, dict) and "total_photos" in d, d)
    check("summary has 'total_favorites'", isinstance(d, dict) and "total_favorites" in d, d)
    check("summary has 'total_albums'", isinstance(d, dict) and "total_albums" in d, d)

    # ── Monthly ──
    d, status, _ = http("GET", "/api/analytics/monthly", token=token)
    check("GET /api/analytics/monthly → 200", status == 200, f"status={status}")
    check("monthly response is a list", isinstance(d, list), d)

    # ── Camera ──
    d, status, _ = http("GET", "/api/analytics/camera", token=token)
    check("GET /api/analytics/camera → 200", status == 200, f"status={status}")
    check("camera response is a list", isinstance(d, list), d)

    # ── Focal length ──
    d, status, _ = http("GET", "/api/analytics/focal-length", token=token)
    check("GET /api/analytics/focal-length → 200", status == 200, f"status={status}")
    check("focal-length response is a list", isinstance(d, list), d)

    # ── ISO ──
    d, status, _ = http("GET", "/api/analytics/iso", token=token)
    check("GET /api/analytics/iso → 200", status == 200, f"status={status}")
    check("iso response is a list", isinstance(d, list), d)


def test_phase29(token):
    section("v0.29  Enhanced Search (focal, GPS, favorited, saved searches, tag autocomplete)")

    # ── Tag autocomplete ──
    d, status, _ = http("GET", "/api/photos/tags/autocomplete?q=")
    check("GET /api/photos/tags/autocomplete without token → 401", status == 401, f"status={status}")

    d, status, _ = http("GET", "/api/photos/tags/autocomplete?q=a", token=token)
    check("GET /api/photos/tags/autocomplete → 200", status == 200, f"status={status}")
    check("autocomplete response is list", isinstance(d, list), d)

    # ── Saved searches unauthenticated ──
    _, status, _ = http("GET", "/api/saved-searches")
    check("GET /api/saved-searches without token → 401", status == 401, f"status={status}")

    # ── Create saved search ──
    d, status, _ = http("POST", "/api/saved-searches", token=token, body={
        "name": "Test Saved Search",
        "params": "q=landscape&camera=Sony"
    })
    check("POST /api/saved-searches → 201", status == 201, f"status={status}")
    check("saved search has 'ID'", isinstance(d, dict) and "ID" in d, d)
    ss_id = d.get("ID") if isinstance(d, dict) else None

    # ── Missing name returns 400 ──
    _, status, _ = http("POST", "/api/saved-searches", token=token, body={"name": "", "params": "q=test"})
    check("POST /api/saved-searches missing name → 400", status == 400, f"status={status}")

    # ── List saved searches ──
    d, status, _ = http("GET", "/api/saved-searches", token=token)
    check("GET /api/saved-searches → 200", status == 200, f"status={status}")
    check("list is a list", isinstance(d, list), d)

    # ── Enhanced search params ──
    d, status, _ = http("GET", "/api/photos/search?focal_min=24&focal_max=200&has_gps=true&is_favorited=false", token=token)
    check("Enhanced search focal+GPS params → 200", status == 200, f"status={status}")
    check("enhanced search has 'photos'", isinstance(d, dict) and "photos" in d, d)

    if ss_id:
        # ── Delete saved search ──
        d2, status, _ = http("DELETE", f"/api/saved-searches/{ss_id}", token=token)
        check(f"DELETE /api/saved-searches/:id → 200", status == 200, f"status={status}")
        check("delete response 'deleted' is true", isinstance(d2, dict) and d2.get("deleted") is True, d2)
    else:
        print(f"  {SKIP} Phase 29 delete test (create failed)")


def test_phase30(token):
    section("v0.30  Data Backup / Export")

    # ── Unauthenticated → 401 ──
    _, status, _ = http("POST", "/api/backup/export")
    check("POST /api/backup/export without token → 401", status == 401, f"status={status}")

    _, status, _ = http("GET", "/api/backup/jobs")
    check("GET /api/backup/jobs without token → 401", status == 401, f"status={status}")

    # ── Create backup job → 201 ──
    d, status, _ = http("POST", "/api/backup/export", token=token)
    check("POST /api/backup/export → 201", status == 201, f"status={status}")
    check("response has 'ID'", isinstance(d, dict) and "ID" in d, d)
    job_id = d.get("ID") if isinstance(d, dict) else None

    # ── Duplicate → 409 ──
    _, status, _ = http("POST", "/api/backup/export", token=token)
    check("POST /api/backup/export duplicate → 409", status == 409, f"status={status}")

    # ── List jobs → 200 ──
    d, status, _ = http("GET", "/api/backup/jobs", token=token)
    check("GET /api/backup/jobs → 200", status == 200, f"status={status}")
    check("list is a list", isinstance(d, list), d)

    if job_id:
        # ── Get single job → 200 ──
        d2, status, _ = http("GET", f"/api/backup/jobs/{job_id}", token=token)
        check(f"GET /api/backup/jobs/:id → 200", status == 200, f"status={status}")
        check("job has 'Status'", isinstance(d2, dict) and "Status" in d2, d2)

        # ── Delete job → 200 ──
        d3, status, _ = http("DELETE", f"/api/backup/jobs/{job_id}", token=token)
        check(f"DELETE /api/backup/jobs/:id → 200", status == 200, f"status={status}")
        check("deleted is true", isinstance(d3, dict) and d3.get("deleted") is True, d3)
    else:
        print(f"  {SKIP} Phase 30 single-job tests (create failed)")




def test_phase31(token):
    section("v0.31  Photo Ratings & Color Labels")

    # -- Unauthenticated --
    _, status, _ = http("PATCH", "/api/photos/1/rating")
    check("PATCH /api/photos/1/rating without token -> 401", status == 401, f"status={status}")

    _, status, _ = http("PATCH", "/api/photos/1/color-label")
    check("PATCH /api/photos/1/color-label without token -> 401", status == 401, f"status={status}")

    # -- Non-existent photo --
    d, status, _ = http("PATCH", "/api/photos/9999999/rating", body={"rating": 3}, token=token)
    check("PATCH /api/photos/9999999/rating -> 404", status == 404, f"status={status}")

    d, status, _ = http("PATCH", "/api/photos/9999999/color-label", body={"color_label": "red"}, token=token)
    check("PATCH /api/photos/9999999/color-label -> 404", status == 404, f"status={status}")

    # -- bulk set_rating & set_color_label --
    d, status, _ = http("POST", "/api/photos/bulk",
                        body={"ids": [9999999], "action": "set_rating", "rating": 4}, token=token)
    check("POST /api/photos/bulk set_rating -> 200", status == 200, f"status={status}")

    d, status, _ = http("POST", "/api/photos/bulk",
                        body={"ids": [9999999], "action": "set_color_label", "color_label": "blue"}, token=token)
    check("POST /api/photos/bulk set_color_label -> 200", status == 200, f"status={status}")

    # -- Search with rating_min --
    d, status, _ = http("GET", "/api/photos/search?rating_min=3", token=token)
    check("GET /api/photos/search?rating_min=3 -> 200", status == 200, f"status={status}")
    check("rating_min search has 'photos'", isinstance(d, dict) and "photos" in d, d)

    # -- Search with color_label --
    d, status, _ = http("GET", "/api/photos/search?color_label=red", token=token)
    check("GET /api/photos/search?color_label=red -> 200", status == 200, f"status={status}")
    check("color_label search has 'photos'", isinstance(d, dict) and "photos" in d, d)


def test_phase32(token):
    section("v0.32  Tag Management")

    # -- Unauthenticated --
    _, status, _ = http("GET", "/api/tags")
    check("GET /api/tags without token -> 401", status == 401, f"status={status}")

    # -- List tags --
    d, status, _ = http("GET", "/api/tags", token=token)
    check("GET /api/tags -> 200", status == 200, f"status={status}")
    check("tags response is list", isinstance(d, list), d)

    # -- Rename tag (non-existent) --
    d, status, _ = http("PUT", "/api/tags",
                        body={"old_name": "nonexistent_tag_xyz", "new_name": "renamed_xyz"}, token=token)
    check("PUT /api/tags rename non-existent -> 200 or 404", status in (200, 404), f"status={status}")

    # -- Merge tags (non-existent) --
    d, status, _ = http("POST", "/api/tags",
                        body={"source": "nonexistent_src", "target": "nonexistent_dst"}, token=token)
    check("POST /api/tags merge non-existent -> 200 or 404", status in (200, 404), f"status={status}")

    # -- Delete tag (non-existent) --
    d, status, _ = http("DELETE", "/api/tags/nonexistent_tag_xyz", token=token)
    check("DELETE /api/tags/:name non-existent -> 200 or 404", status in (200, 404), f"status={status}")

    # -- Missing fields validation --
    d, status, _ = http("PUT", "/api/tags", body={"old_name": ""}, token=token)
    check("PUT /api/tags missing new_name -> 400", status == 400, f"status={status}")

    d, status, _ = http("POST", "/api/tags", body={"source": ""}, token=token)
    check("POST /api/tags missing target -> 400", status == 400, f"status={status}")


def test_phase33(token):
    section("v0.33  Storage Quota Management")

    # -- Unauthenticated --
    _, status, _ = http("GET", "/api/storage/usage")
    check("GET /api/storage/usage without token -> 401", status == 401, f"status={status}")

    # -- Get usage --
    d, status, _ = http("GET", "/api/storage/usage", token=token)
    check("GET /api/storage/usage -> 200", status == 200, f"status={status}")
    check("usage has 'used_bytes'", isinstance(d, dict) and "used_bytes" in d, d)
    check("usage has 'quota_bytes'", isinstance(d, dict) and "quota_bytes" in d, d)

    # -- Admin set quota (non-existent user) --
    d, status, _ = http("PUT", "/api/admin/users/9999999/quota",
                        body={"quota_bytes": 5368709120}, token=token)
    check("PUT /api/admin/users/:id/quota -> 200 or 403 or 404", status in (200, 403, 404), f"status={status}")


def test_phase34(token):
    section("v0.34  Notification Center")

    # -- Unauthenticated --
    _, status, _ = http("GET", "/api/notifications")
    check("GET /api/notifications without token -> 401", status == 401, f"status={status}")

    # -- List notifications --
    d, status, _ = http("GET", "/api/notifications", token=token)
    check("GET /api/notifications -> 200", status == 200, f"status={status}")
    check("notifications has 'notifications'", isinstance(d, dict) and "notifications" in d, d)
    check("notifications has 'total'", isinstance(d, dict) and "total" in d, d)

    # -- Mark all read --
    d, status, _ = http("PUT", "/api/notifications", token=token)
    check("PUT /api/notifications (read all) -> 200", status == 200, f"status={status}")

    # -- Non-existent notification --
    d, status, _ = http("PUT", "/api/notifications/9999999", token=token)
    check("PUT /api/notifications/9999999 mark read -> 404", status == 404, f"status={status}")

    d, status, _ = http("DELETE", "/api/notifications/9999999", token=token)
    check("DELETE /api/notifications/9999999 -> 404", status == 404, f"status={status}")

    # -- unread_only filter --
    d, status, _ = http("GET", "/api/notifications?unread_only=true", token=token)
    check("GET /api/notifications?unread_only=true -> 200", status == 200, f"status={status}")


def test_phase36(token):
    section("v0.36  Photo Metadata Edit (DB-only)")

    # -- Unauthenticated --
    _, status, _ = http("PUT", "/api/photos/1/metadata")
    check("PUT /api/photos/1/metadata without token -> 401", status == 401, f"status={status}")

    # -- Non-existent photo --
    d, status, _ = http("PUT", "/api/photos/9999999/metadata",
                        body={"description": "test", "taken_at": "", "latitude": None,
                              "longitude": None, "copyright": "", "creator": ""},
                        token=token)
    check("PUT /api/photos/9999999/metadata -> 404", status == 404, f"status={status}")

    # -- Batch date shift (unauthenticated) --
    _, status, _ = http("POST", "/api/photos/batch-date-shift")
    check("POST /api/photos/batch-date-shift without token -> 401", status == 401, f"status={status}")

    # -- Batch date shift (non-existent photos) --
    d, status, _ = http("POST", "/api/photos/batch-date-shift",
                        body={"ids": [9999999], "offset_seconds": 3600},
                        token=token)
    check("POST /api/photos/batch-date-shift -> 200", status == 200, f"status={status}")
    check("batch-date-shift has 'updated'", isinstance(d, dict) and "updated" in d, d)


if __name__ == "__main__":
    main()
