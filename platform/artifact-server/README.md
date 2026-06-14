# @gitcade/artifact-server — serves built games (Phase 4A)

The ONLY path by which a built game reaches a browser (Locked Decision: Artifact
serving). Streams artifacts from the S3/MinIO bucket with load-bearing security
headers.

```
GET /artifacts/{game}/{branch}/{path}   → object {game}/{branch}/{path} from the bucket
GET /artifacts/{game}/{branch}/         → index.html
GET /healthz                            → ok
```

Every response sets:
- **Correct `Content-Type`** by extension (NOT trusting whatever was stored).
- **The strict game CSP**: `default-src 'none'` + an explicit allow-list,
  `connect-src 'none'` (no network exfiltration), `frame-ancestors 'self'
  <platform>` (only the platform may embed it). The storage bridge is postMessage
  (not CSP-governed).
- **Immutable caching** for hashed assets (`max-age=31536000, immutable`);
  `no-cache` for HTML entry points so rebuilds surface.
- `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`.

**No presigned URLs** (they break relative asset paths) and **no raw bucket
exposure** (it can't set the CSP).

## Run / test
```bash
npm start         # listens on ARTIFACT_SERVER_PORT (3001)
npm test          # header-assertion test: fetches index.html + an asset, asserts
                  # CSP + content-type + cache (round-trips through real MinIO)
```

## Env (repo-root `.env`)
`ARTIFACT_SERVER_PORT`, `S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY`,
`S3_FORCE_PATH_STYLE`, `PLATFORM_ORIGIN` (frame-ancestors; defaults to
`NEXTAUTH_URL` → `http://localhost:3000`).
