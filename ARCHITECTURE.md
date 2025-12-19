# Architecture & Data Flow

## Overview

This project uses a **direct database access pattern** where the frontend reads directly from Supabase, while the backend handles all writes and crawling operations.

## Data Flow Diagram

```
┌─────────────┐
│   Frontend  │
│  (Next.js)  │
└──────┬──────┘
       │
       ├─────────────────────────────────┐
       │                                 │
       ▼                                 ▼
┌──────────────┐                  ┌─────────────┐
│   Supabase   │                  │   Backend   │
│  PostgreSQL  │◄─────────────────│  (FastAPI) │
│              │                   │             │
│  - pages     │                   │  - Crawler │
│  - links     │                   │  - API     │
│  - page_fetch│                   └──────┬──────┘
└──────────────┘                          │
       ▲                                  │
       │                                  │
       └──────────────────────────────────┘
              (Real-time subscriptions)
```

## Detailed Flow

### 1. Reading Data (Frontend → Supabase)

**Graph Data:**
```
Frontend → Supabase Client → pages table
                          → links table
```

**Jobs:**
```
Frontend → Supabase Client → page_fetch table
```

**Real-time Updates:**
```
Backend writes to Supabase → Supabase triggers change
                          → Frontend subscription receives update
                          → UI updates automatically
```

### 2. Writing Data (Frontend → Backend → Supabase)

**Enqueueing a Page:**
```
1. Frontend → POST /api/admin/enqueue
2. Backend → Resolves Wikipedia title to page_id
3. Backend → Inserts into pages table
4. Backend → Inserts into page_fetch table (status: 'queued')
5. Backend → Returns page info to frontend
6. Supabase → Notifies frontend via real-time subscription
7. Frontend → UI updates with new job
```

**Crawling Process:**
```
1. Backend crawler → Claims job from page_fetch (status: 'running')
2. Backend crawler → Fetches ALL outbound links from Wikipedia API
3. Backend crawler → Batch resolves link titles to page_ids
4. Backend crawler → Upserts pages into pages table
5. Backend crawler → Inserts links into links table
6. Backend crawler → Updates page_fetch (status: 'done')
7. Supabase → Notifies frontend via real-time subscription
8. Frontend → UI updates with completed job
```

## Why This Architecture?

### ✅ Benefits

1. **Performance**: Frontend reads directly from database (no API hop)
2. **Real-time**: Supabase subscriptions provide instant updates
3. **Scalability**: Backend focuses on crawling, frontend handles reads
4. **Simplicity**: No need to proxy all reads through backend API

### 🔒 Security

- **Backend**: Uses direct PostgreSQL connection (service role equivalent)
- **Frontend**: Uses Supabase anon key (Row Level Security can be added)
- **API**: Only used for enqueueing (can add auth if needed)

## Environment Variables

### Backend
- `SUPABASE_DB_URL` - Direct PostgreSQL connection (writes)

### Frontend
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (reads)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key (reads)
- `NEXT_PUBLIC_API_URL` - Backend API URL (enqueueing only)

## Database Tables

### `pages`
- Stores all Wikipedia pages we've seen
- Fields: `page_id`, `title`, `namespace`, `out_degree`, `in_degree`

### `links`
- Stores directed links between pages
- Fields: `from_page_id`, `to_page_id`

### `page_fetch`
- Tracks crawl jobs
- Fields: `page_id`, `status`, `priority`, `last_error`

## API Endpoints

### Backend API (FastAPI)

**POST `/api/admin/enqueue`**
- Enqueues a page for crawling
- Called by frontend
- Returns page info

**GET `/api/admin/jobs`** (legacy - not used by frontend)
- Returns job list
- Frontend now reads directly from Supabase

**GET `/api/graph/ego`** (legacy - not used by frontend)
- Returns ego graph
- Frontend now queries Supabase directly

### Frontend Functions

**`fetchEgoGraph(pageId, limitNeighbors)`**
- Queries Supabase: `pages` + `links` tables
- Builds graph structure client-side

**`fetchJobs()`**
- Queries Supabase: `page_fetch` + `pages` tables
- Returns job list with page details

**`enqueuePage(title, priority)`**
- Calls backend API: `POST /api/admin/enqueue`
- Triggers crawler process

## Real-time Subscriptions

The frontend subscribes to changes on the `page_fetch` table:

```typescript
supabase
  .channel('page_fetch_changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'page_fetch',
  }, () => {
    refreshJobs() // Update UI
  })
  .subscribe()
```

This means:
- When backend updates a job status → Frontend updates immediately
- No polling needed
- Better user experience


