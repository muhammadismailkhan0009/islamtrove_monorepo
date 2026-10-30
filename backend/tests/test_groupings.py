"""Published grouping catalog and single-Surah administration regression tests."""

from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from islamtrove.core.settings import Settings
from islamtrove.main import create_app

CODE = "grouping-test-secret"


def app_client(tmp_path: Path) -> TestClient:
    settings = Settings(admin_code=CODE, review_data_dir=str(tmp_path))
    return TestClient(
        create_app(settings=settings, transport=httpx.MockTransport(lambda _: httpx.Response(503))),
        base_url="http://127.0.0.1:8000",
    )


def test_surah_publication_preserves_other_surahs_and_survives_restart(tmp_path: Path) -> None:
    route = "/api/admin/groupings/surahs"
    first = {"expectedRevision": 0, "boundaries": [10, 26, 110]}
    verification_only = {"surahId": 55, "boundaries": [15, 78]}
    with app_client(tmp_path) as client:
        original = client.get("/api/quran/groupings")
        assert original.status_code == 200
        assert original.json() == {"schemaVersion": 1, "revision": 0, "groupings": []}
        assert original.headers["cache-control"] == "no-store"

        assert client.post(f"{route}/18", json=first).status_code == 401
        login = client.post("/api/admin/verify", json={"code": CODE})
        assert login.status_code == 200
        csrf = login.json()["csrfToken"]
        headers = {"x-csrf-token": csrf}
        assert client.post(f"{route}/18", json=first).status_code == 403
        assert client.post(
            f"{route}/18", json=first,
            headers={**headers, "origin": "https://attacker.example"},
        ).status_code == 403

        first_result = client.post(f"{route}/18", json=first, headers=headers)
        assert first_result.status_code == 200, first_result.text
        assert first_result.json()["revision"] == 1
        assert first_result.json()["groupings"] == [
            {"surahId": 18, "boundaries": first["boundaries"]}
        ]
        assert (tmp_path / "groupings.json").is_file()

        second = client.post(
            f"{route}/55",
            json={"expectedRevision": 1, "boundaries": verification_only["boundaries"]},
            headers=headers,
        )
        assert second.status_code == 200, second.text
        assert second.json()["revision"] == 2
        assert len(second.json()["groupings"]) == 2

        updated = client.post(
            f"{route}/18",
            json={"expectedRevision": 2, "boundaries": [20, 110]},
            headers=headers,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 3
        assert updated.json()["groupings"] == [
            {"surahId": 18, "boundaries": [20, 110]},
            verification_only,
        ]
        assert client.get("/api/quran/groupings").json()["groupings"][1] == verification_only

        # The deprecated bulk-write endpoint cannot erase the published catalog.
        assert client.post(
            "/api/admin/groupings", json={"expectedRevision": 3, "groupings": []},
            headers=headers,
        ).status_code in (404, 405)
        assert client.get("/api/quran/groupings").json()["revision"] == 3

        invalid_boundaries = [
            [26, 10, 110],
            [10, 26],
            [110, 110],
            [False, 110],
            [111],
            [],
        ]
        for invalid in invalid_boundaries:
            result = client.post(
                f"{route}/18",
                json={"expectedRevision": 3, "boundaries": invalid},
                headers=headers,
            )
            assert result.status_code in (409, 422), result.text
            assert client.get("/api/quran/groupings").json()["groupings"][1] == verification_only
        impossible = client.post(
            f"{route}/114", json={"expectedRevision": 3, "boundaries": [1, 7]},
            headers=headers,
        )
        assert impossible.status_code == 409

        stale = client.post(
            f"{route}/18", json={"expectedRevision": 2, "boundaries": [110]},
            headers=headers,
        )
        assert stale.status_code == 409

    with app_client(tmp_path) as restarted:
        result = restarted.get("/api/quran/groupings")
        assert result.json()["revision"] == 3
        assert result.json()["groupings"][1] == verification_only
        assert restarted.post(f"{route}/18", json=first).status_code == 401


def test_corrupted_grouping_file_is_not_silently_replaced(tmp_path: Path) -> None:
    (tmp_path / "groupings.json").write_text('{"schemaVersion":9}')
    with app_client(tmp_path) as client:
        assert client.get("/api/quran/groupings").status_code == 500
