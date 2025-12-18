# Wiki Graph Crawler & Visualizer

A full-stack application for crawling Wikipedia pages, storing link relationships in Supabase, and visualizing them in an interactive 3D graph using Next.js and Three.js.

## Architecture

This project has **two separate, disconnected applications**:

- **Backend (FastAPI)**: Crawler + Admin Dashboard
  - Has its own HTML/CSS/JS dashboard UI at `/`
  - Writes to Supabase (crawls pages, stores links)
  - Provides API for enqueueing pages
  - Deployed separately (Railway, Render, etc.)

- **Frontend (Next.js)**: Visualization Tool
  - **Completely separate** from backend
  - **Only reads from Supabase** (no backend API calls)
  - 3D graph visualization with React Three Fiber
  - Uses Supabase real-time subscriptions for live updates
  - Deployed on Vercel
  
- **Database**: Supabase PostgreSQL
- **Deployment**: 
  - Backend: Can be deployed to any Python hosting (Railway, Render, etc.)
  - Frontend: Vercel

## Setup

### 1. Database Setup (Supabase)

1. Create a new Supabase project
2. Go to SQL Editor
3. Run the SQL script: `backend/scripts/create_tables.sql`
4. Get your database connection string from Supabase Settings → Database → Connection string (URI format)

### 2. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file:

```env
SUPABASE_DB_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
WIKI_API_BASE=https://en.wikipedia.org/w/api.php
CRAWLER_CONCURRENCY=6
CRAWLER_POLL_SECONDS=1.0
MAX_LINKS_PER_PAGE=0
ALLOW_NAMESPACES=0
USER_AGENT=WikiGraphExplorer/0.1 (contact: you@example.com)
```

Run the backend:

```bash
uvicorn app.main:app --reload
```

The backend will be available at `http://localhost:8000` with:
- Dashboard UI at `/`
- Graph API at `/api/graph/ego`
- Admin API at `/api/admin/enqueue` and `/api/admin/jobs`

### 3. Frontend Setup

```bash
cd frontend
npm install
```

Create a `.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

**Note:** The Next.js frontend is completely disconnected from the backend. It only needs Supabase keys to read data. To enqueue pages, use the FastAPI dashboard at your backend URL.

Run the frontend:

```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

## Usage

### Enqueueing Pages

1. Use the dashboard at `http://localhost:8000` or the frontend control panel
2. Enter a Wikipedia page title (e.g., "Pipeline (surfing)")
3. The crawler will fetch ALL outbound links for that page
4. Monitor progress in the jobs list

### Visualizing Graphs

1. In the frontend, enter a page ID (you can find this from the jobs list or by enqueueing a page)
2. Click "Load Graph" to see the 3D visualization
3. Use mouse to rotate, zoom, and pan the graph

## API Endpoints

### Graph API

- `GET /api/graph/ego?page_id={id}&limit_neighbors={n}` - Get ego graph for a page

### Admin API

- `POST /api/admin/enqueue` - Enqueue a page for crawling
  ```json
  {
    "title": "Pipeline (surfing)",
    "priority": 0,
    "requested_by": "user@example.com"
  }
  ```
- `GET /api/admin/jobs` - Get list of crawl jobs

## Deployment

### Backend (Railway/Render example)

1. Push backend code to GitHub
2. Connect to Railway/Render
3. Set environment variables
4. Deploy

### Frontend (Vercel)

1. Push frontend code to GitHub
2. Import to Vercel
3. Set `NEXT_PUBLIC_API_URL` to your backend URL
4. Deploy

## Features

- ✅ Crawls ALL outbound links for Wikipedia pages
- ✅ Stores relationships in Supabase PostgreSQL
- ✅ Real-time job status tracking
- ✅ 3D graph visualization with WebGL
- ✅ Node sizing based on degree
- ✅ Color coding (center node, in/out degree ratios)
- ✅ Interactive controls (rotate, zoom, pan)

## Next Steps

- Implement proper force-directed layout algorithm
- Add search by title functionality
- Add graph statistics and analytics
- Implement graph traversal (click to expand)
- Add edge weight visualization
- Optimize for large graphs (virtualization)

## License

MIT

