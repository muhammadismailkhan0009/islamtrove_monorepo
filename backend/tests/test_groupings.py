"""Published grouping catalog and all-or-nothing authenticated administration."""

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


def test_groupings_publish_validated_atomic_persistent_and_csrf_protected(tmp_path: Path) -> None:
    groups = [
        {"surahId": 18, "boundaries": [10, 26, 110]},
        {"surahId": 55, "boundaries": [15, 78]},
    ]
    route = "/api/admin/groupings"
    with app_client(tmp_path) as client:
        original = client.get("/api/quran/groupings")
        assert original.status_code == 200
        assert original.json() == {"schemaVersion": 1, "revision": 0, "groupings": []}
        assert original.headers["cache-control"] == "no-store"
        denied = client.post(route, json={"expectedRevision": 0, "groupings": groups})
        assert denied.status_code == 401
        login = client.post("/api/admin/verify", json={"code": CODE})
        assert login.status_code == 200
        csrf = login.json()["csrfToken"]
        no_csrf = client.post(route, json={"expectedRevision": 0, "groupings": groups})
        assert no_csrf.status_code == 403
        headers = {"x-csrf-token": csrf}
        cross_origin = client.post(
            route, json={"expectedRevision": 0, "groupings": groups},
            headers={**headers, "origin": "https://attacker.example"},
        )
        assert cross_origin.status_code == 403
        published = client.post(route, json={"expectedRevision": 0, "groupings": groups},
                                headers=headers)
        assert published.status_code == 200, published.text
        assert published.json()["revision"] == 1
        assert published.json()["groupings"] == groups
        assert (tmp_path / "groupings.json").is_file()

        invalid_groups = [
            [{"surahId": 18, "boundaries": [26, 10, 110]}],
            [{"surahId": 18, "boundaries": [10, 26]}],
            [{"surahId": 18, "boundaries": [110, 110]}],
            [{"surahId": 18, "boundaries": [False, 110]}],
            [{"surahId": 55, "boundaries": [15, 78]}] * 2,
            [{"surahId": 114, "boundaries": [1, 7]}],  # An-Nas has six Ayahs
        ]
        for invalid in invalid_groups:
            result = client.post(route, json={"expectedRevision": 1, "groupings": invalid},
                                 headers=headers)
            assert result.status_code in (409, 422), result.text
            assert client.get("/api/quran/groupings").json()["groupings"] == groups

        stale = client.post(route, json={"expectedRevision": 0, "groupings": []},
                            headers=headers)
        assert stale.status_code == 409
        assert client.get("/api/quran/groupings").json()["revision"] == 1
        emptied = client.post(route, json={"expectedRevision": 1, "groupings": []},
                              headers=headers)
        assert emptied.status_code == 200
        assert emptied.json()["groupings"] == []

    with app_client(tmp_path) as restarted:
        result = restarted.get("/api/quran/groupings")
        assert result.json()["revision"] == 2
        assert result.json()["groupings"] == []
        denied = restarted.post(route, json={"expectedRevision": 2, "groupings": groups})
        assert denied.status_code == 401


def test_corrupted_grouping_file_is_not_silently_replaced(tmp_path: Path) -> None:
    (tmp_path / "groupings.json").write_text('{"schemaVersion":9}')
    with app_client(tmp_path) as client:
        assert client.get("/api/quran/groupings").status_code == 500
