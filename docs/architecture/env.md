# Environment variables

Document **names only** here. Never commit secrets.

## Conventions

- The SDK is local-first. No server secrets are required to record or score a trip.
- If a host attaches an `UploadAdapter`, that host owns its own env vars.
- Public client vars in Expo hosts use the platform prefix (`EXPO_PUBLIC_*`).

## Variables

| Name | Used by | Required | Description |
|------|---------|----------|-------------|
| `EXPO_PUBLIC_UPLOAD_URL` | host apps (optional) | no | Example destination for an HTTP upload adapter. The SDK does not read this; the host passes it into `setUploadAdapter`. |

Add rows only for variables this SDK repository itself consumes. Do not put values in this doc.
