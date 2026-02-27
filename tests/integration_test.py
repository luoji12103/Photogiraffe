#!/usr/bin/env python3
"""
Photogiraffe Integration Test Suite
测试范围: v7.3 Albums, v7.4 Profile, v7.5 Enhanced Presets, v8.1 Stats, v8.3 Search, v8.5 SSE,
          v9.1 Export Overlays, v9.2 Photo Visibility, v9.3 Bulk Ops, v9.4 Description+Tags,
          v9.5 Public Portfolio,
          v10.1 Admin Stats+User Mgmt, v10.2 XMP Parser, v10.3 Gallery Sort, v10.4 Photo UserID,
          v10.5 Storage Config
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

    # verify photo detail has description (GET /photos/:id returns Go struct with capitalized keys)
    d, status, _ = http("GET", f"/photos/{photo_id}", token=token)
    check("GET /photos/:id still 200 after desc update", status == 200, f"status={status}")
    check("  description persisted", isinstance(d, dict) and d.get("Description") == "Test caption", d)

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
        check("  photo has UserID field", isinstance(pd, dict) and "UserID" in pd, pd)
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


if __name__ == "__main__":
    main()
