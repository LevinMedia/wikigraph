# Environment Variables Setup

## Architecture Overview

This project has **two separate applications**:

1. **Backend (FastAPI)** - Crawler + Admin Dashboard
   - Has its own HTML/CSS/JS dashboard UI at `/`
   - Writes to Supabase (crawls pages, stores links)
   - Provides API for enqueueing pages
   - Deployed separately (Railway, Render, etc.)

2. **Frontend (Next.js)** - Visualization Tool
   - **Completely separate** from backend
   - **Only reads from Supabase** (no backend API calls)
   - 3D graph visualization
   - Deployed on Vercel

They are **totally disconnected** - the Next.js app only needs Supabase keys.

- **Backend (FastAPI)**: 
  - Writes to Supabase (crawls pages, stores links)
  - Provides API for enqueueing pages (triggers crawler)
  
- **Frontend (Next.js)**: 
  - **Reads directly from Supabase** (graph data, jobs)
  - **Writes through backend API** (enqueueing pages)
  - Uses Supabase real-time subscriptions for live updates

## Required Environment Variables

### Backend (`backend/.env`)

**Required:**
- `SUPABASE_DB_URL` - Direct PostgreSQL connection string
  - Get from: Supabase Dashboard → Settings → Database → Connection string → URI
  - Format: `postgresql://postgres:[PASSWORD]@[PROJECT-REF].supabase.co:5432/postgres`

**Optional (have defaults):**
- `WIKI_API_BASE` - Wikipedia API URL (default: `https://en.wikipedia.org/w/api.php`)
- `CRAWLER_CONCURRENCY` - Number of concurrent crawlers (default: `6`)
- `CRAWLER_POLL_SECONDS` - Polling interval (default: `1.0`)
- `MAX_LINKS_PER_PAGE` - Max links per page, 0 = unlimited (default: `0`)
- `ALLOW_NAMESPACES` - Comma-separated namespace IDs (default: `0` = main articles only)
- `USER_AGENT` - User agent string for Wikipedia API

### Frontend (`frontend/.env.local`)

**Not needed!** The Next.js frontend is completely disconnected from the backend. It only reads from Supabase.

**Required (for reading from database):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
  - Get from: Supabase Dashboard → Settings → API → Project URL
  - Format: `https://[PROJECT-REF].supabase.co`
  - **Required**: Frontend reads graph data and jobs directly from Supabase

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous/public key
  - Get from: Supabase Dashboard → Settings → API → `anon` `public` key
  - This is safe to expose in client-side code
  - **Required**: Frontend needs this to query Supabase

## What Each Key Does

### Backend Keys

| Key | Purpose |
|-----|---------|
| `SUPABASE_DB_URL` | Direct PostgreSQL connection for asyncpg. Used for all database operations. |

### Frontend Keys

| Key | Purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required**. Frontend reads graph data and jobs directly from Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required**. Authenticates Supabase client requests for database reads. |

## Data Flow

### Reading Data (Frontend → Supabase)
- **Graph data**: Frontend queries `pages` and `links` tables directly
- **Jobs**: Frontend queries `page_fetch` table directly
- **Real-time**: Supabase subscriptions notify frontend when data changes
- **No backend API calls** for reading data

### Writing Data (Frontend → Backend → Supabase)
- **Enqueueing pages**: Frontend calls backend API `/api/admin/enqueue`
- **Backend**: Resolves title, creates page record, enqueues job
- **Crawler**: Backend worker processes jobs and writes to Supabase
- **Frontend**: Gets notified via Supabase real-time subscriptions

## Getting Your Keys

### Step 1: Supabase Database URL (Backend)

1. Go to Supabase Dashboard
2. Select your project
3. Go to **Settings** → **Database**
4. Scroll to **Connection string**
5. Select **URI** tab
6. Copy the connection string
7. Replace `[YOUR-PASSWORD]` with your database password

### Step 2: Supabase API Keys (Frontend - Optional)

1. Go to Supabase Dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Security Notes

✅ **Safe to expose in frontend:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key is public by design)

❌ **Never expose:**
- `SUPABASE_DB_URL` (contains password - backend only!)
- Service role keys (if you add them later)

## Example Files

- `backend/env.example` - Template for backend `.env`
- `frontend/env.local.example` - Template for frontend `.env.local`

Copy these files and fill in your values.

