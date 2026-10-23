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
| `status` | `status` | `published` or `draft`; defaults to `published` |

The frontend must send the API names (`imageUrl`, `videoUrl1`, `videoUrl2`),
not the database names (`image_url`, `video_url_1`, `video_url_2`). The backend
performs that mapping. The authenticated request also needs
`Authorization: Bearer <admin-token>`.

### Bring an existing database up to date

The initial schema in `database.sql` already contains both video columns. If
the deployed database was created before video links were added, run the
one-time migration from the backend project using the production database
credentials (keep them private):

```powershell
node migrations/run.js 003_news_video_links.sql
```

The command uses `.env` in this project, including `DB_SSL` and `DB_SSL_CA`.
For an existing database, run migrations rather than rerunning the entire
`database.sql` seed script. Back up first. The migration runner reports columns
that already exist as skipped.

Confirm the schema in MySQL:

```sql
SHOW COLUMNS FROM news LIKE 'video_url_%';
```

After deploying the updated backend and running the migration, publish a
test article from Admin. Check the returned `201` response and verify the
article and optional video URLs appear on the public News page. Draft articles
remain hidden from public endpoints.
