# Backend tooling — Python reference for Java developers

| Python tool | Role | Closest Java/Spring analogy |
| --- | --- | --- |
| FastAPI | ASGI HTTP framework and routers | Spring Web MVC/WebFlux controllers |
| Pydantic 2 | Typed request/response schemas | Bean Validation + Jackson DTOs |
| Pydantic Settings | Environment-based config | Spring `@ConfigurationProperties` |
| HTTPX | Async outbound HTTP client | Spring `WebClient` |
| uv | Python/version/dependency lock + run | Maven/Gradle wrapper + toolchain manager |
| Ruff | Format + lint | Spotless + Checkstyle + import sorting |
| Pyright | Static type analysis | Java compiler/static analysis |
| pytest | Tests, fixtures, assertions | JUnit 5 |
| pytest-asyncio | Async test support | Async JUnit extensions |
| testcontainers-python | Real Docker dependencies during tests | Testcontainers Java |
| FastAPI TestClient | In-process ASGI HTTP tests | MockMvc/WebTestClient |

## Basic commands

```sh
uv sync --group dev
uv run uvicorn islamtrove.main:app --reload
uv run pytest -q
uv run ruff check .
uv run ruff format .
uv run pyright
uv add some-package
uv add --dev some-test-package
```

The `uv.lock` file pins the dependency resolution. Run `uv sync` after pulling changes.

## Python architecture terms

- `Protocol` defines a structural interface (comparable to a Java interface). Our `QuranSource` is a protocol implemented by the Al Quran Cloud adapter.
- `async def` declares a coroutine. `await` suspends execution without blocking the event loop. Our outbound HTTP uses HTTPX AsyncClient.
- FastAPI's `Depends` is lightweight dependency injection. Lifespan constructs and closes the shared HTTP client.
- `@pytest.fixture` injects test dependencies and handles teardown. A fixture with `yield` is analogous to setup/teardown or a JUnit extension.
- `httpx.MockTransport` intercepts outbound HTTP in tests without reaching the real provider.
- Pydantic `BaseModel` validates JSON and serializes safe fields.
- `TestClient(create_app(...))` runs actual HTTP routes in-process, including lifespan in a `with` block.

## Future Testcontainers example

Only needed after PostgreSQL is introduced:

```python
import pytest
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="module")
def postgres_url():
    with PostgresContainer("postgres:17-alpine") as db:
        yield db.get_connection_url()
```

Requires Docker running. Then inject `postgres_url` into the repository adapter and run migrations before the tests. No PostgreSQL is used in the current milestone.
