"""Full admin review lifecycle; no real secrets or provider requests."""

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from islamtrove.core.settings import Settings
from islamtrove.main import create_app

CODE = "example-admin-test-code-2026"


def test_secure_login_and_review_commit_across_restart(tmp_path: Path) -> None:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    provider = httpx.MockTransport(lambda _request: httpx.Response(503))
    with TestClient(
        create_app(settings=settings, transport=provider), base_url="http://127.0.0.1:8000"
    ) as client:
        route = "/api/admin/surahs/55/reviews"
        original = client.get("/api/quran/surahs/55/continuous-recitation").json()
        assert len(original["timings"]) == 78
        reviews = client.get(route)
        assert reviews.status_code == 200
        assert reviews.headers["cache-control"] == "no-store"
        flags = {x["ayah"]: x for x in reviews.json()}
        assert flags[6]["status"] == "needs-review"
        assert flags[7]["status"] == "needs-review"  # tmp file has no prior reviews
        start = original["timings"][5]["fromMs"]

        assert (
            client.post("/api/admin/ayahs/verify", json={"surahId": 55, "ayah": 6}).status_code
            == 401
        )
        bad = client.post("/api/admin/verify", json={"code": "incorrect"})
        assert bad.status_code == 401
        assert "admin" not in bad.cookies
        valid = client.post("/api/admin/verify", json={"code": CODE})
        assert valid.status_code == 200
        assert valid.json()["authorized"] is True
        assert valid.json()["expiresIn"] == 1800
        assert "islamtrove_admin_session" in valid.cookies
        cookie = valid.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=strict" in cookie
        assert "path=/api/admin" in cookie
        csrf = valid.json()["csrfToken"]
        assert len(csrf) > 30
        assert (
            client.post("/api/admin/ayahs/verify", json={"surahId": 55, "ayah": 6}).status_code
            == 403
        )
        headers = {"x-csrf-token": csrf}
        wrong_origin = {**headers, "origin": "https://untrusted.example"}
        assert (
            client.post(
                "/api/admin/ayahs/verify", json={"surahId": 55, "ayah": 6}, headers=wrong_origin
            ).status_code
            == 403
        )
        ok = client.post(
            "/api/admin/ayahs/verify",
            json={"surahId": 55, "ayah": 6, "expectedStartMs": start},
            headers=headers,
        )
        assert ok.status_code == 200, ok.text
        assert {r["ayah"]: r for r in ok.json()}[6]["status"] == "verified"

        corrected = start + 350
        update = client.post(
            "/api/admin/ayahs/correct",
            json={
                "surahId": 55,
                "ayah": 6,
                "startMs": corrected,
                "expectedStartMs": start,
            },
            headers=headers,
        )
        assert update.status_code == 200, update.text
        entry = {r["ayah"]: r for r in update.json()}[6]
        assert entry["estimatedStartMs"] == corrected
        assert entry["status"] == "corrected"

        applied = client.get("/api/quran/surahs/55/continuous-recitation").json()
        assert applied["timings"][5]["fromMs"] == corrected
        assert applied["timings"][4]["toMs"] == corrected
        assert applied["timings"][6]["fromMs"] == original["timings"][6]["fromMs"]
        assert applied["endMs"] == original["endMs"]

        stale = client.post(
            "/api/admin/ayahs/correct",
            json={
                "surahId": 55,
                "ayah": 6,
                "startMs": corrected + 100,
                "expectedStartMs": start,
            },
            headers=headers,
        )
        assert stale.status_code == 409
        impossible = client.post(
            "/api/admin/ayahs/correct",
            json={
                "surahId": 55,
                "ayah": 6,
                "startMs": original["timings"][6]["fromMs"] + 1,
            },
            headers=headers,
        )
        assert impossible.status_code == 409
        assert (
            client.post(
                "/api/admin/ayahs/correct",
                json={
                    "surahId": 55,
                    "ayah": 1,
                    "startMs": 200,
                },
                headers=headers,
            ).status_code
            == 409
        )

        file = tmp_path / "055.json"
        stored = json.loads(file.read_text())
        assert stored["reviews"]["6"]["startMs"] == corrected
        assert len(stored["audit"]) == 2
        assert (
            stored["audioSha256"]
            == json.loads(
                (
                    Path(__file__).resolve().parents[1] / "src/islamtrove/data/alignments/055.json"
                ).read_text()
            )["audioSha256"]
        )

    with TestClient(
        create_app(settings=settings, transport=provider), base_url="http://127.0.0.1:8000"
    ) as restarted:
        revised = restarted.get("/api/quran/surahs/55/continuous-recitation").json()
        assert revised["timings"][5]["fromMs"] == corrected
        assert {r["ayah"]: r for r in restarted.get(route).json()}[6]["status"] == "corrected"
        assert (
            restarted.post("/api/admin/ayahs/verify", json={"surahId": 55, "ayah": 6}).status_code
            == 401
        )


def test_origin_policy_accepts_matching_host_and_denies_cross_origin(tmp_path: Path) -> None:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(create_app(settings=settings), base_url="https://islamtrove.com") as client:
        allowed = client.post("/api/admin/verify", json={"code": CODE},
                              headers={"Origin": "https://islamtrove.com"})
        assert allowed.status_code == 200
        assert "secure" in allowed.headers["set-cookie"].lower()
        wrong = client.post("/api/admin/verify", json={"code": CODE},
                            headers={"Origin": "https://example.org"})
        assert wrong.status_code == 403
        downgraded = client.post("/api/admin/verify", json={"code": CODE},
                                 headers={"Origin": "http://islamtrove.com"})
        assert downgraded.status_code == 403

    # Angular's dev proxy must preserve the browser-facing Host (localhost:4200),
    # rather than forwarding the backend's internal 127.0.0.1:8000 Host.
    with TestClient(create_app(settings=settings), base_url="http://localhost:4200") as dev:
        allowed_dev = dev.post(
            "/api/admin/verify", json={"code": CODE}, headers={"Origin": "http://localhost:4200"}
        )
        assert allowed_dev.status_code == 200
        denied_dev = dev.post(
            "/api/admin/verify", json={"code": CODE}, headers={"Origin": "http://localhost:8000"}
        )
        assert denied_dev.status_code == 403

    # Explicit standard HTTPS ports are equivalent to the canonical Origin.
    with TestClient(create_app(settings=settings), base_url="https://islamtrove.com:443") as prod:
        standard_port = prod.post(
            "/api/admin/verify", json={"code": CODE},
            headers={"Origin": "https://islamtrove.com"},
        )
        assert standard_port.status_code == 200
        for illegal_origin in (
            "https://islamtrove.com.evil.example",
            "https://islamtrove.com:444",
            "https://islamtrove.com@evil.example",
        ):
            denied = prod.post(
                "/api/admin/verify", json={"code": CODE},
                headers={"Origin": illegal_origin},
            )
            assert denied.status_code == 403


def test_wrong_code_is_rate_limited_and_no_config_rejects_login(tmp_path: Path) -> None:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(create_app(settings=settings), base_url="http://127.0.0.1:8000") as client:
        for _ in range(5):
            assert client.post("/api/admin/verify", json={"code": "not-valid"}).status_code == 401
        assert client.post("/api/admin/verify", json={"code": CODE}).status_code == 429
    with TestClient(
        create_app(settings=Settings(admin_code="", review_data_dir=str(tmp_path))),
        base_url="http://127.0.0.1:8000",
    ) as client:
        assert client.post("/api/admin/verify", json={"code": CODE}).status_code == 503
        assert len(client.get("/api/admin/surahs/112/reviews").json()) == 4


def test_source_mismatch_fails_closed_and_never_mutates_review_file(tmp_path: Path) -> None:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(create_app(settings=settings), base_url="http://127.0.0.1:8000") as client:
        auth = client.post("/api/admin/verify", json={"code": CODE}).json()
        headers = {"X-CSRF-Token": auth["csrfToken"]}
        forged = {
            "schemaVersion": 1,
            "surahId": 55,
            "audioSha256": "0" * 64,
            "reviews": {},
            "audit": [],
        }
        (tmp_path / "055.json").write_text(json.dumps(forged))
        assert client.get("/api/admin/surahs/55/reviews").status_code == 409
        assert (
            client.post(
                "/api/admin/ayahs/verify", json={"surahId": 55, "ayah": 6}, headers=headers
            ).status_code
            == 409
        )
        assert json.loads((tmp_path / "055.json").read_text()) == forged
        assert client.get("/api/quran/surahs/55/continuous-recitation").status_code == 500


def test_an_unflagged_ayah_can_still_be_checked_when_listener_spots_issue(tmp_path: Path) -> None:
    """No warning marker is not a barrier to administrator correction."""
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(create_app(settings=settings), base_url="http://127.0.0.1:8000") as client:
        rows = client.get("/api/admin/surahs/55/reviews").json()
        plain = {row["ayah"]: row for row in rows}[14]
        assert plain["status"] == "unflagged"
        auth = client.post("/api/admin/verify", json={"code": CODE})
        assert auth.status_code == 200
        headers = {"X-CSRF-Token": auth.json()["csrfToken"]}
        saved = client.post(
            "/api/admin/ayahs/verify",
            json={
                "surahId": 55,
                "ayah": 14,
                "expectedStartMs": plain["estimatedStartMs"],
            },
            headers=headers,
        )
        assert saved.status_code == 200
        assert {row["ayah"]: row for row in saved.json()}[14]["status"] == "verified"
        assert {row["ayah"]: row for row in client.get("/api/admin/surahs/55/reviews").json()}[14][
            "status"
        ] == "verified"


def test_context_passage_bulk_review_is_atomic_and_keeps_corrections(tmp_path: Path) -> None:
    """One review operation covers the selected passage, not a fixed group size."""
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(
        create_app(settings=settings), base_url="http://127.0.0.1:8000"
    ) as client:
        original = client.get("/api/quran/surahs/55/continuous-recitation").json()
        login = client.post("/api/admin/verify", json={"code": CODE})
        headers = {"X-CSRF-Token": login.json()["csrfToken"]}
        start_ayah, end_ayah = 11, 45  # 35 Ayahs, deliberately > former fixed 10/30.
        boundaries = [
            {"ayah": ayah, "expectedStartMs": original["timings"][ayah - 1]["fromMs"]}
            for ayah in range(start_ayah, end_ayah + 1)
        ]
        offset = original["timings"][21]["fromMs"] + 150
        corrected = client.post(
            "/api/admin/ayahs/correct",
            json={"surahId": 55, "ayah": 22, "startMs": offset},
            headers=headers,
        )
        assert corrected.status_code == 200
        # Reject a stale bulk selection without mutating any reviews.
        stale = client.post(
            "/api/admin/blocks/verify",
            json={"surahId": 55, "boundaries": boundaries},
            headers=headers,
        )
        assert stale.status_code == 409
        assert "11" not in json.loads((tmp_path / "055.json").read_text())["reviews"]

        boundaries[11]["expectedStartMs"] = offset
        result = client.post(
            "/api/admin/blocks/verify",
            json={"surahId": 55, "boundaries": boundaries},
            headers=headers,
        )
        assert result.status_code == 200, result.text
        approved = {row["ayah"]: row for row in result.json()}
        assert all(
            approved[i]["status"] in ("verified", "corrected")
            for i in range(start_ayah, end_ayah + 1)
        )
        assert approved[22]["status"] == "corrected"
        assert approved[10]["status"] != "verified"
        assert approved[46]["status"] != "verified"
        audit = json.loads((tmp_path / "055.json").read_text())["audit"]
        assert len(audit) == 2
        assert audit[-1]["operation"] == "verify-block"
        assert audit[-1]["startAyah"] == 11 and audit[-1]["endAyah"] == 45


def test_full_surah_context_is_a_valid_bulk_review(tmp_path: Path) -> None:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(
        create_app(settings=settings), base_url="http://127.0.0.1:8000"
    ) as client:
        original = client.get("/api/quran/surahs/2/continuous-recitation").json()
        assert len(original["timings"]) == 286
        login = client.post("/api/admin/verify", json={"code": CODE})
        headers = {"X-CSRF-Token": login.json()["csrfToken"]}
        result = client.post(
            "/api/admin/blocks/verify",
            json={
                "surahId": 2,
                "boundaries": [
                    {"ayah": item["ayah"], "expectedStartMs": item["fromMs"]}
                    for item in original["timings"]
                ],
            },
            headers=headers,
        )
        assert result.status_code == 200, result.text
        assert len(result.json()) == 286
        assert all(row["status"] in ("verified", "corrected") for row in result.json())


def test_overlap_after_resegmenting_preserves_existing_per_ayah_reviews(tmp_path: Path) -> None:
    """Changing listening passages must never reset/rewrite an Ayah's review state."""
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    with TestClient(
        create_app(settings=settings), base_url="http://127.0.0.1:8000"
    ) as client:
        route = "/api/admin/surahs/55/reviews"
        times = client.get("/api/quran/surahs/55/continuous-recitation").json()["timings"]
        auth = client.post("/api/admin/verify", json={"code": CODE}).json()
        headers = {"X-CSRF-Token": auth["csrfToken"]}
        path = tmp_path / "055.json"

        def verify_passage(start: int, end: int) -> None:
            # The frontend passes the selected recitation passage's Ayahs.
            # The backend stores each Ayah independently, not its passage ID.
            current = {row["ayah"]: row for row in client.get(route).json()}
            response = client.post(
                "/api/admin/blocks/verify",
                json={
                    "surahId": 55,
                    "boundaries": [
                        {"ayah": ayah, "expectedStartMs": current[ayah]["estimatedStartMs"]}
                        for ayah in range(start, end + 1)
                    ],
                },
                headers=headers,
            )
            assert response.status_code == 200, response.text

        # A previously verified Ayah and corrected Ayah belong to the first passage.
        individually_verified = client.post(
            "/api/admin/ayahs/verify",
            json={"surahId": 55, "ayah": 12},
            headers=headers,
        )
        assert individually_verified.status_code == 200
        new_start = times[17]["fromMs"] + 200
        corrected = client.post(
            "/api/admin/ayahs/correct",
            json={"surahId": 55, "ayah": 18, "startMs": new_start},
            headers=headers,
        )
        assert corrected.status_code == 200
        existing = json.loads(path.read_text())["reviews"]
        initial_12 = existing["12"].copy()
        initial_18 = existing["18"].copy()

        verify_passage(11, 26)
        first = json.loads(path.read_text())
        assert first["reviews"]["12"] == initial_12
        assert first["reviews"]["18"] == initial_18
        assert first["reviews"]["11"]["status"] == "verified"
        assert first["reviews"]["26"]["status"] == "verified"
        assert first["audit"][-1]["ayahs"] == [
            ayah for ayah in range(11, 27) if ayah not in (12, 18)
        ]
        first_20 = first["reviews"]["20"].copy()
        first_26 = first["reviews"]["26"].copy()

        # Edit listening breakpoints: the next passage now overlaps 20–26.
        # Approving it only verifies the previously unreviewed 27–35.
        verify_passage(20, 35)
        second = json.loads(path.read_text())
        assert second["reviews"]["12"] == initial_12
        assert second["reviews"]["18"] == initial_18
        assert second["reviews"]["20"] == first_20
        assert second["reviews"]["26"] == first_26
        assert second["audit"][-1]["ayahs"] == list(range(27, 36))
        assert all(second["reviews"][str(n)]["status"] == "verified" for n in range(27, 36))
        assert "19" in second["reviews"]
        assert "36" not in second["reviews"]

        # Reconfirming an entirely reviewed passage is a true no-op:
        # no altered reviewedAt, no new audit item, no disk write.
        before = path.read_bytes()
        verify_passage(20, 35)
        assert path.read_bytes() == before

        # Verification and corrections are durable across app restart.
    with TestClient(
        create_app(settings=settings), base_url="http://127.0.0.1:8000"
    ) as restarted:
        rows = {row["ayah"]: row for row in restarted.get(route).json()}
        assert rows[12]["status"] == "verified"
        assert rows[18]["status"] == "corrected"
        assert rows[18]["estimatedStartMs"] == new_start
        assert rows[20]["status"] == "verified"
        assert rows[35]["status"] == "verified"
        assert rows[36]["status"] != "verified"
