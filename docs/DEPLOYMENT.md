# IslamTrove Docker and Woodpecker deployment

This deployment follows the independent Docker-host-socket Woodpecker pipeline pattern in `mcp-registry`. **No GitHub credentials, Git automation, or database are required inside IslamTrove.**

## Architecture

- `.woodpecker/backend-pipeline.yml` builds and deploys FastAPI as `islamtrove_backend`.
- `.woodpecker/frontend-pipeline.yml` builds and deploys the compiled Angular application with unprivileged Nginx as `islamtrove_frontend`.
- Both containers join the private `islamtrove_private` Docker network. Only the frontend is bound to host **127.0.0.1:3055**. Nginx forwards `/api/` to the backend over Docker DNS.
- Your **existing host reverse proxy** terminates HTTPS and forwards requests to `http://127.0.0.1:3055`. The backend is *not* publicly exposed. The browser uses a fixed same-origin `/api/*` path, never a separate API domain or Docker hostname. The backend hardcodes localhost-only CORS access for read-only development previews; production does not require a CORS environment variable. The one IslamTrove application Nginx config is `frontend/nginx.conf`.
- Git-controlled base Ayah timings are copied into the backend image from `backend/src/islamtrove/data/alignments/`.
- The administrator's **per-Ayah verified/corrected reviews** reside in `/srv/islamtrove/review-data/` on the Docker host, bind-mounted to `/data/reviews` inside the backend. They **survive all normal container/image replacements**.
- The versioned `backend/review-data/*.json` files in the image are *initial seed data only*. The entrypoint copies a given file to the host-mounted directory **only when that specific file does not already exist**. Existing reviewed timestamps and audit history are never overwritten by a deployment.

Only approved review JSON files should be synced back to Git manually, from the **host terminal**. Review data in the persistent directory is the live source of truth; the versioned Git copy is the public published snapshot.

## One-time production host setup

Docker and a Woodpecker agent with authorized Docker-socket access are required. **Treat Docker-socket access as host-root-equivalent and restrict who can modify pipeline files or trigger deployment.** Do not enable these pipelines for untrusted pull requests. Pipelines run only on pushes to `main`.

On the **Docker host**, provision the persistent review directory:

```sh
sudo install -d -m 0750 -o 10001 -g 10001 /srv/islamtrove/review-data
```

Configure the **single Woodpecker repository secret** below. Its name is a placeholder in `.woodpecker/backend-pipeline.yml`; never place the real value in source control:

| Woodpecker secret | Value |
| --- | --- |
| `ISLAMTROVE_ADMIN_CODE` | Your chosen strong administrator password (plain secret value; never commit it) |

**Set the password directly as a Woodpecker repository secret**, not as a
hash. Woodpecker injects it only into the backend deployment step and the
running container through `docker run -e ISLAMTROVE_ADMIN_CODE`, so it is not
included in an image layer or the frontend. Do not echo it in pipeline logs or
write it to the Git repository. The backend compares the provided login code
using constant-time comparison and retains the existing rate limits, CSRF
protection, and short-lived sessions. Privileged Docker-host users can inspect
container environment variables, so restrict access to the host and CI secrets.

Remove any old `ISLAMTROVE_ADMIN_CODE_HASH` secret after switching the backend
to `ISLAMTROVE_ADMIN_CODE`.

To migrate an existing server, **restore its live `review-data` files into the persistent directory before the initial deployment**. Ownership and permissions must permit UID 10001 to read/write them:

```sh
sudo chown -R 10001:10001 /srv/islamtrove/review-data
sudo chmod 0750 /srv/islamtrove/review-data
```

Keep the original recordings separate; the backend streams approved remote recordings and does not package full MP3s into the image.

## Host HTTPS reverse proxy

Use your existing Nginx/Caddy/Traefik TLS setup. For host Nginx, the proxying portion is:

```nginx
location / {
    proxy_pass http://127.0.0.1:3055;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 180s;
    proxy_buffering off;
}
```

The app's internal Nginx passes the incoming HTTPS scheme through to Uvicorn, so the administrator session is issued as a **Secure cookie**. Service workers and persistent browser caching need HTTPS (or local `localhost`). Do not publicly expose backend port 8000 or publish internal Docker network ports.

## Woodpecker setup

As in `mcp-registry`, the pipelines use `image: docker:latest` with `/var/run/docker.sock` mounted. The CI runner must operate on (or have direct Docker-socket access to) the **deployment host**; the image is built in that host's Docker daemon.

The Woodpecker inline deployment commands use these fixed settings:

| Item | Path / value |
| --- | --- |
| Backend container | `islamtrove_backend` |
| Frontend container | `islamtrove_frontend` |
| Private Docker network | `islamtrove_private` |
| Frontend host binding | `127.0.0.1:3055` |
| Live review files | `/srv/islamtrove/review-data/` |
| Backend admin password | Woodpecker secret `ISLAMTROVE_ADMIN_CODE` |

A push to `main` with backend changes (including `backend/review-data/` or `backend/src/islamtrove/data/alignments/`) builds/deploys the backend image. Frontend changes independently build/deploy the frontend. Shared `.dockerignore` updates trigger both. No tests run during Woodpecker deployment. Docker `test` targets are retained only for optional local development.

Each pipeline directly removes its old container and starts the commit-SHA-tagged image, as in `mcp-registry`. The images keep Docker health checks, but the pipeline does **not** perform automatic health-check rollback. A failed start requires operator intervention and a deployment causes a brief interruption. After the new container starts successfully, the pipeline deletes older images for that component, retaining the newly deployed commit-SHA image (matching the registry project).

A new host's empty review directory gets the reviewed JSON files seeded from the image. **Never copy Git review files over existing host files during a deployment**—that would discard newer on-server corrections.

## Local Docker builds and optional tests

Woodpecker builds **only** the runtime images. From the project root:

```sh
DOCKER_BUILDKIT=1 docker build -f backend/Dockerfile -t islamtrove_backend:local .
DOCKER_BUILDKIT=1 docker build -f frontend/Dockerfile -t islamtrove_frontend:local .
```

For **optional local development tests**, use:

```sh
DOCKER_BUILDKIT=1 docker build --target test -f backend/Dockerfile .
DOCKER_BUILDKIT=1 docker build --target test -f frontend/Dockerfile .
```

To test a deployment with the actual backend and persistent reviews, use the same Docker network and mounts as the inline Woodpecker commands, **but with disposable names/ports** to avoid interfering with the live service. The backend's `/health` endpoint and frontend's `/healthz` endpoint are monitored by Docker healthchecks. `http://127.0.0.1:3055/api/quran/surahs/55/continuous-recitation` checks proxying through the frontend.

## Syncing server-side admin changes to GitHub (manual, simplest method)

Admin-reviewed Ayah files and published groupings are saved in
`/srv/islamtrove/review-data/`. Their Git snapshots belong in
`backend/review-data/`. **Do not put GitHub credentials in the app/container.**

One-time: have a **separate Git checkout** on the deployment host
(e.g. `~/islamtrove-sync`). If necessary, clone your actual GitHub repository
using its SSH URL:

```sh
git clone git@github.com:OWNER/REPOSITORY.git ~/islamtrove-sync
```

Replace `OWNER/REPOSITORY` with your real GitHub repository. The host-side
Git account or repo-scoped SSH deploy key needs write access. This setup
is on the host, not in a Docker image or Woodpecker secret.

Whenever you approve a new batch of groupings or Ayah corrections, run on
the **deployment host**:

```sh
cd ~/islamtrove-sync
git pull --ff-only
sudo cp /srv/islamtrove/review-data/*.json backend/review-data/
sudo chown "$(id -u):$(id -g)" backend/review-data/*.json
git add backend/review-data/
git diff --cached --stat
git diff --cached  # Review actual JSON changes before publishing
git commit -m "Publish Quran groupings and Ayah reviews"
git push origin main
```

If `git diff --cached --stat` is empty, there is nothing to commit; skip
the final two commands. The glob copies both **`groupings.json` and
`NNN.json` reviewed Ayah files**. Check that only intended public JSON
appears before pushing. The resulting `main` push may redeploy the backend,
but the host-mounted live files remain authoritative and **are never
overwritten by the Git snapshot**.

A host bind mount protects files through container replacement, not host
loss; back up the data directory separately. Avoid any automated Git push
for now—the reviewed data should enter the repository only when you approve it.

## Production checklist

1. All 114 canonical alignment JSON files and intended versioned reviews committed to the public repo.
2. Woodpecker secret `ISLAMTROVE_ADMIN_CODE` is configured with a strong administrator password.
3. Persistent host review-data directory exists and is writable by UID 10001.
4. The frontend and backend share one HTTPS origin. The browser accesses only `/api/*` and the backend compares admin-request Origin to the incoming scheme/host. No CORS environment variable is required.
5. Host HTTPS routing points to `127.0.0.1:3055`; backend port 8000 is not published. Only containers joined to the private application network can reach it.
6. Woodpecker uses trusted main-branch pushes and has the Docker socket.
7. Confirm cross-passage audio, per-Ayah approvals, browser cache, retries, and public source licensing.
8. Backups and manual Git synchronization procedure exercised.
