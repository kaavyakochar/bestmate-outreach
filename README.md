# BestMate Outreach

A dashboard (`index.html`) plus server routes (`api/`) that find, score and track outreach leads.

## Set up, in order

1. **Supabase**: create a project, open the SQL editor, paste `supabase/schema.sql`, run it.
2. **Vercel**: run `npx vercel` in this folder, then add the environment variables below under Settings -> Environment Variables, then run `npx vercel --prod`.
3. **Dashboard**: open the site, click "Connected" in the sidebar, enter your `ADMIN_KEY`.
4. **First campaign**: Campaigns -> New campaign -> Run -> Find leads on Google.

## Environment variables

| Name | What it is | Needed for |
|---|---|---|
| `ADMIN_KEY` | Any long random string you choose; the dashboard asks for it | Everything in Connected mode |
| `SUPABASE_URL` | Project URL from Supabase -> Settings -> API | Everything in Connected mode |
| `SUPABASE_SERVICE_ROLE_KEY` | The service role key from the same page. Keep it secret | Everything in Connected mode |
| `GOOGLE_PLACES_KEY` | Google Cloud key with "Places API (New)" enabled | Find leads |
| `HUNTER_API_KEY` | Hunter API key | Find owner emails |
| `SENDER` | `smartlead` or `instantly` | Push to sender |
| `SENDER_API_KEY` | API key from that tool | Push to sender |
| `WEBHOOK_SECRET` | Any long random string | Receiving replies |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `ALLOWED_RECIPIENTS` | Gmail address, app password, approved test recipients | The one-off "Send now" button only |

## Routes

| Route | Does |
|---|---|
| `GET/POST/PATCH /api/campaigns` | List, create and update campaigns |
| `GET/PATCH /api/leads` | List leads; change status, owner, add a note |
| `POST /api/discover` | Pull businesses from Google Places for a campaign, score them, save new ones |
| `POST /api/enrich` | Look up owner emails on Hunter for qualified leads with a website |
| `POST /api/push` | Send the day's batch of qualified leads to Smartlead or Instantly |
| `POST /api/webhook?secret=...` | Called by the sending tool on sent, reply and bounce events |
| `POST /api/send` | Send one email through Gmail to an approved recipient |

## Sending tool

- Write the sequence inside Smartlead or Instantly. Available variables: first name, company name, `trade`, `signal_line`.
- Copy that campaign's ID into the dashboard: Campaigns -> Run -> Set sending-tool campaign ID.
- Point the tool's webhook (reply, sent, bounce events) at `https://YOUR-SITE.vercel.app/api/webhook?secret=YOUR_WEBHOOK_SECRET`.

## Not verified yet

The Smartlead, Instantly and Hunter calls and the webhook field names were written from their public API documentation as remembered, without live keys. Run one lead through each before trusting them.
