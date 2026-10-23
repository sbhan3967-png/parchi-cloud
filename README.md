# Parchi Cloud 📒

Phone PWA for the parchi book — photograph a karigar/wholesaler parchi,
verify the math, and access it anytime, anywhere. Data lives in Supabase.

## Setup (one time)

1. **Supabase**: create a free project at supabase.com, then run `supabase.sql`
   in Dashboard → SQL Editor (creates tables + photo bucket + security rules).
2. **Connect**: put your Project URL + anon key (Settings → API) into
   `js/config.js`.
3. **Deploy**: host this folder (GitHub Pages / Vercel / any static host).
4. **Phone**: open the site in Chrome → ⋮ menu → **Add to Home screen**.
   It installs like an app, with camera upload.

## Use

- **+ New Parchi** → party name, bill no, date, Silver/Gold-Diamond kind,
  metal rate → 📷 Camera or 🖼 Gallery → Save.
- Tap a parchi → **+ Add Row**, type the weights/rates — wastage, labour,
  totals and flags calculate live (same logic as the desktop Parchi Reader).
- **Save** syncs everything to Supabase. Search parties from home.

## Notes

- Photos go to the private `parchi-photos` bucket under your user id.
- Row Level Security: each login sees only their own parchis.
- AI auto-read from photo is phase 2 (desktop Parchi Reader does the
  99%-accurate reading today); phone v1 is capture + smart verify + cloud.
