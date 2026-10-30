# syntax=docker/dockerfile:1.7
# Build from repository root: docker build -f backend/Dockerfile .
FROM python:3.13-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /usr/local/bin/
ENV UV_PYTHON_DOWNLOADS=0 UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY backend/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

FROM builder AS test
# Pyright is a Node.js-based type checker; supply Node only to the CI test stage.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY backend/tests ./tests
COPY backend/review-data/ ./review-data/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable \
    && uv run --no-sync pytest -q \
    && uv run --no-sync ruff check . \
    && uv run --no-sync pyright

FROM python:3.13-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    ISLAMTROVE_REVIEW_DATA_DIR="/data/reviews"
WORKDIR /app
RUN groupadd --system --gid 10001 islamtrove \
    && useradd --system --uid 10001 --gid islamtrove --home-dir /app islamtrove
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
# Seed only MISSING reviewed files; live host corrections must not be replaced.
COPY --chown=10001:10001 backend/review-data/ /app/review-seed/
COPY --chmod=755 backend/docker-entrypoint.sh /usr/local/bin/islamtrove-entrypoint
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c 'from urllib.request import urlopen; urlopen("http://127.0.0.1:8000/health", timeout=3).close()' || exit 1
ENTRYPOINT ["islamtrove-entrypoint"]
CMD ["uvicorn", "islamtrove.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
