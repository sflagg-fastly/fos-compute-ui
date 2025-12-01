# Fastly Object Storage UI (Compute)

Minimal Fastly Compute app that provides a simple web UI for **Fastly Object Storage (FOS)** using its S3‑compatible API.

## What it does

- Runs on **Fastly Compute** with `@fastly/expressly`
- Signs S3‑style requests using **`aws4fetch`**
- Parses XML responses with **`fast-xml-parser`**
- Lets you from a browser:
  - Save FOS credentials (region, access key, secret key) in `localStorage`
  - List, create, and delete buckets
  - List objects in a bucket
  - Upload and view/download files

> ⚠️ For demo/admin use only. Credentials are stored in the browser and sent to the service; do not use this as‑is for multi‑tenant or internet‑facing production.

## Quick start

```bash
# install deps
npm install

# build WASM
npm run build

# run locally
fastly compute serve
```

Then open `http://127.0.0.1:7676/` in your browser.

## Deploy

1. Set `service_id` in `fastly.toml` (or create a new Compute service).
2. Build & publish:

```bash
npm run build
fastly compute publish
```

Point a hostname at the service and browse to `/`.

## Tech stack

- Fastly Compute (JavaScript)
- `@fastly/expressly`
- `aws4fetch` (SigV4 signing)
- `fast-xml-parser`
- Tailwind via CDN for basic styling
```