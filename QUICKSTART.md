# Quick Start Guide

## Prerequisites

- Python 3.10+
- Node.js 18+
- Supabase account (free tier works)

## Step 1: Set Up Supabase Database

1. Create a new Supabase project at https://supabase.com
2. Go to **SQL Editor**
3. Copy and paste the contents of `backend/scripts/create_tables.sql`
4. Click **Run**
5. **Enable Realtime** (required for auto-updating admin dashboard):
   - Go to **Database** → **Replication**
   - Find the `page_fetch` table
   - Toggle the switch to enable Realtime for `page_fetch`
   - (Optional: Enable for `pages` and `links` if you want realtime graph updates)
6. Go to **Settings** → **Database** → **Connection string** → **URI**
7. Copy the connection string (you'll need it for the backend `.env`)
8. Go to **Settings** → **API** and copy:
   - Project URL (for frontend `NEXT_PUBLIC_SUPABASE_URL` and backend `SUPABASE_URL`)
   - `anon` `public` key (for frontend `NEXT_PUBLIC_SUPABASE_ANON_KEY` and backend `SUPABASE_ANON_KEY`)

## Step 2: Set Up Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` (copy from `backend/env.example`):
```env
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@[YOUR-PROJECT-REF].supabase.co:5432/postgres
WIKI_API_BASE=https://en.wikipedia.org/w/api.php
CRAWLER_CONCURRENCY=6
CRAWLER_POLL_SECONDS=1.0
MAX_LINKS_PER_PAGE=0
ALLOW_NAMESPACES=0
USER_AGENT=WikiGraphExplorer/0.1
```

Run the backend:
```bash
uvicorn app.main:app --reload
```

Backend will be at `http://localhost:8000`

## Step 3: Set Up Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local` (copy from `frontend/env.local.example`):
```env
# REQUIRED: Supabase keys - frontend reads directly from Supabase
# Get these from Supabase Dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**Note:** The Next.js frontend is **completely disconnected** from the backend. It only needs Supabase keys. To enqueue pages, use the FastAPI dashboard at `http://localhost:8000`.

Run the frontend:
```bash
npm run dev
```

Frontend will be at `http://localhost:3000`

## Step 4: Test It Out

1. Open `http://localhost:3000` in your browser
2. In the control panel, enter a Wikipedia title like "Pipeline (surfing)"
3. Click "Enqueue" to start crawling
4. Wait a few seconds, then check the jobs list
5. Once a job is "done", enter the page ID and click "Load Graph"
6. Explore the 3D visualization!

## Troubleshooting

### Backend won't start
- Check that your `.env` file has the correct Supabase connection string
- Make sure you've run the SQL migration in Supabase
- Check that all Python dependencies are installed

### Frontend can't connect to backend
- Make sure backend is running on port 8000
- Check `NEXT_PUBLIC_API_URL` in `.env.local`
- Check browser console for CORS errors (backend should handle CORS automatically)

### No graph appears
- Make sure the page has been crawled (status = "done")
- Check that the page ID is correct
- Look at browser console for errors

## Next Steps

- Deploy backend to Railway/Render
- Deploy frontend to Vercel
- Customize the graph visualization
- Add more features!

