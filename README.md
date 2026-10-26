# BASEGA backend deployment and news API

## Production deployment

1. Back up the production database before changing code or schema.
2. Deploy this backend repository to the API host. Use a supported Node.js LTS
   version and run `npm ci` followed by `npm start`.
3. Configure the host's environment variables from `.env.example`. Never commit
   `.env` or put backend secrets in the frontend repository. Set at least:
   `NODE_ENV=production`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`,
   `DB_PASSWORD`, `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, and `FRONTEND_URLS`.
   Use a long, unique JWT secret. `FRONTEND_URLS` is a comma-separated list of
   exact HTTPS origins, for example `https://basega.example.com,https://www.basega.example.com`
   (no path or trailing slash).
4. For a TLS database such as Aiven, set `DB_SSL=true` and provide its CA
   certificate as a file available to the backend, then set `DB_SSL_CA` to that
   file's path. Certificate verification is enabled; do not disable it.
5. Configure the backend host/domain for HTTPS. If it is behind exactly one
   trusted reverse proxy, set `TRUST_PROXY=true`; otherwise leave it false.
6. Set the frontend host's `VITE_API_URL` to the HTTPS API origin, then rebuild
   and deploy the frontend. The frontend value is public configuration, not a
   secret. Configure the custom domain and HTTPS certificate at the hosting
   provider before directing production traffic to it.
7. Verify `https://<api-domain>/api/health`, then test login and the news admin
   form. Configure the frontend's exact domain(s) in backend `FRONTEND_URLS`.

## News fields and database mapping

The admin form posts JSON to authenticated `POST /api/news`. The names on the
wire are camelCase where needed; the backend maps them to MySQL column names:

| Admin/API JSON field | MySQL `news` column | Requirement |
| --- | --- | --- |
| `title` | `title` | Required; up to 250 characters |
| `excerpt` | `excerpt` | Optional; up to 5,000 characters |
| `body` | `body` | Required; up to 100,000 characters |
| `category` | `category` | Optional; defaults to `General`; up to 100 characters |
| `imageUrl` | `image_url` | Optional; HTTPS URL or `/uploads/...`; up to 255 characters |
| `videoUrl1` | `video_url_1` | Optional HTTPS URL; up to 1,000 characters |
| `videoUrl2` | `video_url_2` | Optional HTTPS URL; up to 1,000 characters |
| `images` | `news_media` rows (`media_type = 'image'`) | Optional array of up to 20 HTTPS URLs or `/uploads/...` paths; each up to 1,000 characters |
| `videos` | `news_media` rows (`media_type = 'video'`) | Optional array of up to 20 HTTPS URLs; each up to 1,000 characters |
| `status` | `status` | `published` or `draft`; defaults to `published` |

The frontend sends API names, not database column names. `videoUrl1` and
`videoUrl2` remain supported for older clients; newer clients can send any
number of videos in the `videos` array (up to 20). Public article responses
include `images` and `videos` arrays. The authenticated request also needs
`Authorization: Bearer <admin-token>`.

### Bring an existing database up to date

The initial schema in `database.sql` contains the legacy video columns and the
`news_media` table. For an existing database, run the media migration before
deploying the updated API. From the backend project, using the production
database credentials (keep them private):

```powershell
node migrations/run.js 004_news_media.sql
```

The command uses `.env` in this project, including `DB_SSL` and `DB_SSL_CA`.
For an existing database, run migrations rather than rerunning the entire
`database.sql` seed script. Back up first. This migration creates the media
table and is safe to rerun.

Confirm the schema in MySQL:

```sql
SHOW TABLES LIKE 'news_media';
DESCRIBE news_media;
```

Run the migration first, then deploy the updated backend. Publish a test
article with multiple images and videos from Admin; verify they appear on the
public article page. Draft articles remain hidden from public endpoints.
