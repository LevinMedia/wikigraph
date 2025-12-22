const { useState, useEffect } = React;
const { createRoot } = ReactDOM;

// Simple Tab component following Headless UI patterns
function Tab({ children, className, selected, onClick }) {
  const baseClassName = className || 'tab-button';
  const fullClassName = selected ? `${baseClassName} active` : baseClassName;
  return (
    <button
      className={fullClassName}
      onClick={onClick}
      role="tab"
      aria-selected={selected}
    >
      {children}
    </button>
  );
}

function TabGroup({ children, defaultIndex = 0 }) {
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const childrenArray = React.Children.toArray(children);
  const tabList = childrenArray.find(child => child.type === TabList);
  const tabPanels = childrenArray.find(child => child.type === TabPanels);
  
  return (
    <div>
      {tabList && React.cloneElement(tabList, { selectedIndex, setSelectedIndex })}
      {tabPanels && React.cloneElement(tabPanels, { selectedIndex })}
    </div>
  );
}

function TabList({ children, selectedIndex, setSelectedIndex }) {
  const tabs = React.Children.toArray(children);
  return (
    <div className="tabs">
      {tabs.map((tab, index) =>
        React.cloneElement(tab, {
          key: index,
          selected: selectedIndex === index,
          onClick: () => setSelectedIndex(index)
        })
      )}
    </div>
  );
}

function TabPanels({ children, selectedIndex }) {
  const panels = React.Children.toArray(children);
  return (
    <div>
      {panels.map((panel, index) => (
        <div key={index} style={{ display: selectedIndex === index ? 'block' : 'none' }}>
          {panel}
        </div>
      ))}
    </div>
  );
}

function TabPanel({ children }) {
  return <div>{children}</div>;
}

function App() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enqueueTitle, setEnqueueTitle] = useState('');
  const [enqueuePriority, setEnqueuePriority] = useState(0);
  const [enqueueResult, setEnqueueResult] = useState('');
  const [pagination, setPagination] = useState({ total: 0, limit: 10000, offset: 0, has_more: false });
  const [counts, setCounts] = useState({ active: 0, done: 0, discovered: 0, total: 0 });
  const [estimateTitle, setEstimateTitle] = useState('');
  const [estimateResult, setEstimateResult] = useState(null);
  const [estimating, setEstimating] = useState(false);

  // Initialize Supabase client if available
  const supabase = React.useMemo(() => {
    try {
      if (window.SUPABASE_CONFIG?.url && window.SUPABASE_CONFIG?.anonKey && window.supabase) {
        return window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
      }
    } catch (err) {
      console.error('Error initializing Supabase client:', err);
    }
    return null;
  }, []);

  const fetchJobs = async (limit = 10000, offset = 0) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/jobs?limit=${limit}&offset=${offset}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setJobs(data.jobs || []);
      setPagination(data.pagination || { total: 0, limit: 10000, offset: 0, has_more: false });
      setCounts(data.counts || { active: 0, done: 0, discovered: 0, total: 0 });
    } catch (err) {
      console.error('Error fetching jobs:', err);
      setJobs([]); // Set empty array on error to prevent infinite loading
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchJobs();

    // Set up realtime subscription if Supabase is available
    if (supabase) {
      console.log('Setting up Supabase realtime subscription for page_fetch table');
      
      const channel = supabase
        .channel('page_fetch_changes', {
          config: {
            broadcast: { self: true }
          }
        })
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'page_fetch'
          },
          (payload) => {
            console.log('Realtime update received:', payload);
            // Small delay to ensure database has updated
            setTimeout(() => {
              fetchJobs();
            }, 100);
          }
        )
        .subscribe((status) => {
          console.log('Subscription status:', status);
          if (status === 'SUBSCRIBED') {
            console.log('✅ Successfully subscribed to page_fetch changes');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('❌ Channel subscription error - check if Realtime is enabled on page_fetch table');
            console.error('Go to: Supabase Dashboard → Database → Replication → Enable for page_fetch');
          } else if (status === 'TIMED_OUT') {
            console.error('❌ Subscription timed out');
          } else if (status === 'CLOSED') {
            console.warn('⚠️ Subscription closed');
          }
        });

      // Cleanup subscription on unmount
      return () => {
        console.log('Cleaning up Supabase realtime subscription');
        if (supabase) {
          supabase.removeChannel(channel);
        }
      };
    } else {
      console.warn('Supabase not configured - realtime updates disabled. Add SUPABASE_URL and SUPABASE_ANON_KEY to backend .env');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const handleEnqueue = async () => {
    if (!enqueueTitle.trim()) {
      setEnqueueResult('Error: Please enter a title or URL');
      return;
    }

    // Extract title from Wikipedia URL or use as-is
    let title = enqueueTitle.trim();
    const urlMatch = title.match(/wikipedia\.org\/wiki\/([^?#]+)/);
    if (urlMatch) {
      title = decodeURIComponent(urlMatch[1].replace(/_/g, ' '));
    }

    setEnqueueResult('Enqueuing…');
    try {
      const res = await fetch('/api/admin/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          title, 
          priority: enqueuePriority, 
          link_direction: 'outbound', 
          auto_crawl_neighbors: false 
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.detail || errorJson.message || errorText;
        } catch {
          errorMsg = errorText.substring(0, 200);
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      setEnqueueResult(`Queued: ${data.page.title} (page_id ${data.page.page_id})`);
      setEnqueueTitle('');
      fetchJobs();
    } catch (e) {
      setEnqueueResult(`Error: ${e.message}`);
    }
  };

  const handleCancelJob = async (pageId) => {
    if (!confirm(`Cancel job ${pageId}?`)) return;
    try {
      await fetch(`/api/admin/jobs/${pageId}/cancel`, { method: 'POST' });
      alert('Job cancelled!');
      fetchJobs();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleEstimateBlastRadius = async () => {
    if (!estimateTitle.trim()) {
      setEstimateResult({ error: 'Please enter a title or URL' });
      return;
    }

    setEstimating(true);
    setEstimateResult(null);
    try {
      const res = await fetch(`/api/admin/estimate-blast-radius?title=${encodeURIComponent(estimateTitle.trim())}`);
      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.detail || errorJson.message || errorText;
        } catch {
          errorMsg = errorText.substring(0, 200);
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      setEstimateResult(data);
    } catch (e) {
      setEstimateResult({ error: e.message });
    } finally {
      setEstimating(false);
    }
  };


  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const formatError = (error) => {
    if (!error) return '-';
    return error.length > 50 ? error.substring(0, 50) + '...' : error;
  };

  const columns = [
    { accessorKey: 'page_id', header: 'Page ID' },
    { 
      accessorKey: 'title', 
      header: 'Title',
      cell: ({ row }) => {
        const degree = row.original.degree;
        const indent = degree === 0 ? 0 : degree === 1 ? 20 : degree === 2 ? 40 : 0;
        const prefix = degree === 0 ? '🌳 ' : degree === 1 ? '  └─ ' : degree === 2 ? '    └─ ' : '';
        return (
          <span style={{ paddingLeft: `${indent}px`, display: 'inline-block' }}>
            {prefix}{row.original.title}
          </span>
        );
      }
    },
    { 
      accessorKey: 'degree', 
      header: 'Degree',
      cell: ({ getValue }) => {
        const degree = getValue();
        if (degree === null || degree === undefined) return '-';
        return degree === 0 ? 'Root' : `Degree ${degree}`;
      }
    },
    { 
      accessorKey: 'root_page_id', 
      header: 'Root',
      cell: ({ getValue, row }) => {
        const rootId = getValue();
        if (!rootId) return '-';
        // Find root title if available
        const rootJob = jobs.find(j => j.page_id === rootId);
        return rootJob ? `${rootJob.title} (${rootId})` : `Page ${rootId}`;
      }
    },
    { 
      accessorKey: 'status', 
      header: 'Status',
      cell: ({ getValue, row }) => {
        const status = getValue();
        const progressStage = row.original.progress_stage;
        const progressCount = row.original.progress_count;
        
        let statusDisplay = <span className="badge">{status}</span>;
        
        // Add progress indicator for running jobs
        if (status === 'running' && progressStage) {
          const stageNames = {
            'fetching_outbound_links': 'Fetching outbound links...',
            'fetching_inbound_links': 'Fetching inbound links...',
            'links_fetched': `Links fetched: ${progressCount || 0}`,
            'resolving_titles': 'Resolving titles...',
            'titles_resolved': `Titles resolved: ${progressCount || 0}`,
            'inserting_pages': `Inserting pages: ${progressCount || 0}`,
            'inserting_links': `Inserting links: ${progressCount || 0}`,
            'computing_degrees': 'Computing degrees...',
            'crawling_degree_0': 'Crawling (root)...',
            'crawling_degree_1': 'Crawling (first-degree)...',
            'crawling_degree_2': 'Crawling (second-degree)...',
          };
          const stageDisplay = stageNames[progressStage] || progressStage;
          statusDisplay = (
            <div>
              <span className="badge">{status}</span>
              <span style={{ marginLeft: '8px', fontSize: '12px', opacity: 0.7 }}>
                {stageDisplay}
              </span>
            </div>
          );
        }
        
        return statusDisplay;
      }
    },
    { accessorKey: 'priority', header: 'Priority' },
    { accessorKey: 'out_degree', header: 'Out Degree' },
    { accessorKey: 'in_degree', header: 'In Degree' },
    { 
      accessorKey: 'started_at', 
      header: 'Started',
      cell: ({ getValue }) => formatDate(getValue())
    },
    { 
      accessorKey: 'finished_at', 
      header: 'Finished',
      cell: ({ getValue }) => formatDate(getValue())
    },
    { 
      accessorKey: 'last_error', 
      header: 'Error',
      cell: ({ getValue }) => formatError(getValue())
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const status = row.original.status;
        if (status === 'running' || status === 'queued') {
          return (
            <button
              onClick={() => handleCancelJob(row.original.page_id)}
              style={{
                padding: '2px 8px',
                fontSize: '11px',
                background: '#dc2626',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          );
        }
        return '-';
      }
    }
  ];

  // Sort crawled jobs by finished_at (ascending - earliest first)
  // This ensures root page (finished first) appears first, then first-degree in order
  const crawled = jobs
    .filter(j => j.status === 'done')
    .sort((a, b) => {
      const aTime = a.finished_at ? new Date(a.finished_at).getTime() : 0;
      const bTime = b.finished_at ? new Date(b.finished_at).getTime() : 0;
      return aTime - bTime; // Ascending order
    });
  
  // Discovered: second-degree nodes that weren't crawled (status = 'discovered')
  const discovered = jobs.filter(j => j.status === 'discovered');
  
  // Active jobs: group by root_page_id for better visualization
  const activeJobs = jobs.filter(j => ['queued', 'running', 'error', 'paused'].includes(j.status));
  
  // Debug: log counts
  React.useEffect(() => {
    console.log('Job counts:', { 
      total: jobs.length, 
      crawled: crawled.length, 
      discovered: discovered.length, 
      active: activeJobs.length 
    });
  }, [jobs.length, crawled.length, discovered.length, activeJobs.length]);

  const createTable = (data) => {
    if (!data || data.length === 0) {
      return (
        <div style={{ padding: '20px', textAlign: 'center', opacity: 0.7 }}>
          No jobs found
        </div>
      );
    }
    
    return (
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th key={idx}>{col.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col, colIdx) => {
                  let value;
                  if (col.accessorKey) {
                    value = row[col.accessorKey];
                  } else if (col.cell) {
                    value = col.cell({ 
                      getValue: () => row[col.accessorKey], 
                      row: { original: row } 
                    });
                  } else {
                    value = '';
                  }
                  
                  // Handle React elements
                  if (React.isValidElement(value)) {
                    return <td key={colIdx}>{value}</td>;
                  }
                  
                  // Handle formatted values
                  if (col.accessorKey === 'started_at' || col.accessorKey === 'finished_at') {
                    value = formatDate(value);
                  } else if (col.accessorKey === 'last_error') {
                    value = formatError(value);
                  } else if (col.accessorKey === 'status') {
                    value = <span className="badge">{value || ''}</span>;
                  } else if (col.id === 'actions') {
                    const status = row.status;
                    if (status === 'running' || status === 'queued') {
                      value = (
                        <button
                          onClick={() => handleCancelJob(row.page_id)}
                          style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            background: '#dc2626',
                            border: 'none',
                            borderRadius: '4px',
                            color: 'white',
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      );
                    } else {
                      value = '-';
                    }
                  }
                  
                  return (
                    <td key={colIdx}>
                      {React.isValidElement(value) ? value : String(value || '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.7 }}>
            No data
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="wrap">
      <header>
        <h1>Wiki Graph Crawler</h1>
        <p className="sub">Enqueue pages to fetch ALL outbound and inbound links, store into Supabase, and serve ego graphs.</p>
      </header>

      <section className="card">
        <h2>Enqueue</h2>
        <div className="row">
          <input
            value={enqueueTitle}
            onChange={(e) => setEnqueueTitle(e.target.value)}
            placeholder="Wikipedia title or URL"
          />
          <input
            type="number"
            value={enqueuePriority}
            onChange={(e) => setEnqueuePriority(parseInt(e.target.value) || 0)}
            placeholder="Priority"
            title="Higher priority jobs are processed first"
          />
          <button onClick={handleEnqueue}>Enqueue</button>
        </div>
        <div className="small">{enqueueResult}</div>
      </section>

      <section className="card" style={{ border: '1px solid #4ecdc4' }}>
        <h2 style={{ color: '#4ecdc4' }}>📊 Estimate Blast Radius</h2>
        <p className="small" style={{ marginBottom: '12px', opacity: 0.8 }}>
          Get a quick estimate of how many pages will be scraped for a given URL (doesn't actually crawl)
        </p>
        <div className="row">
          <input
            value={estimateTitle}
            onChange={(e) => setEstimateTitle(e.target.value)}
            placeholder="Wikipedia title or URL"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleEstimateBlastRadius();
              }
            }}
          />
          <button 
            onClick={handleEstimateBlastRadius} 
            disabled={estimating}
            style={{ background: '#4ecdc4', color: 'white' }}
          >
            {estimating ? 'Estimating...' : 'Estimate'}
          </button>
        </div>
        {estimateResult && (
          <div style={{ marginTop: '16px', padding: '12px', background: '#0f1120', borderRadius: '4px', border: '1px solid #22263a' }}>
            {estimateResult.error ? (
              <div style={{ color: '#dc2626' }}>Error: {estimateResult.error}</div>
            ) : (
              <div>
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#4ecdc4' }}>{estimateResult.root?.title}</strong>
                  <span style={{ marginLeft: '8px', opacity: 0.7, fontSize: '14px' }}>
                    (ID: {estimateResult.root?.page_id})
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>Root Pages</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#eaf0ff' }}>
                      {estimateResult.estimates?.root_pages || 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>First-Degree to Crawl</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ecdc4' }}>
                      {estimateResult.estimates?.first_degree_to_crawl || 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>Second-Degree to Discover</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#a78bfa' }}>
                      {estimateResult.estimates?.second_degree_to_discover || 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', opacity: 0.7 }}>Total Pages</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#eaf0ff' }}>
                      {estimateResult.estimates?.total_pages || 0}
                    </div>
                  </div>
                </div>
                {estimateResult.breakdown && (
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.7, marginBottom: '8px' }}>
                      View Breakdown
                    </summary>
                    <div style={{ fontSize: '12px', opacity: 0.8, lineHeight: '1.6' }}>
                      <div>Outbound links: {estimateResult.breakdown.outbound_links}</div>
                      <div>Inbound links: {estimateResult.breakdown.inbound_links}</div>
                      <div>First-degree sampled: {estimateResult.breakdown.first_degree_sampled} / {estimateResult.breakdown.first_degree_total}</div>
                      <div>Second-degree titles found: {estimateResult.breakdown.second_degree_titles_found}</div>
                      <div>Estimated second-degree unique: {estimateResult.breakdown.estimated_second_degree_unique}</div>
                    </div>
                  </details>
                )}
                {estimateResult.note && (
                  <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.6, fontStyle: 'italic' }}>
                    {estimateResult.note}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card" style={{ border: '2px solid #dc2626' }}>
        <h2 style={{ color: '#dc2626' }}>⚠️ Danger Zone (Testing Only)</h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              if (!confirm('Kill all running/queued jobs? This will pause all active crawls.')) return;
              try {
                const res = await fetch('/api/admin/kill-all-running', { method: 'POST' });
                const data = await res.json();
                alert(`✅ ${data.message}`);
                fetchJobs();
              } catch (e) {
                alert(`❌ Error: ${e.message}`);
              }
            }}
            style={{
              background: '#dc2626',
              border: 'none',
              color: 'white',
              fontWeight: 'bold'
            }}
          >
            Kill All Running Jobs
          </button>
          <button
            onClick={async () => {
              if (!confirm('Stop the crawler loop? It will restart on next server restart.')) return;
              try {
                const res = await fetch('/api/admin/stop-crawler', { method: 'POST' });
                const data = await res.json();
                alert(`✅ ${data.message}`);
              } catch (e) {
                alert(`❌ Error: ${e.message}`);
              }
            }}
            style={{
              background: '#b91c1c',
              border: 'none',
              color: 'white',
              fontWeight: 'bold'
            }}
          >
            Stop Crawler Loop
          </button>
          <button
            onClick={async () => {
              if (!confirm('⚠️ DELETE ALL DATA from the database? This will delete ALL pages, links, and jobs. This cannot be undone!')) return;
              if (!confirm('Are you ABSOLUTELY SURE? This will delete everything!')) return;
              try {
                const res = await fetch('/api/admin/delete-all-data', { method: 'POST' });
                const data = await res.json();
                alert(`✅ ${data.message}`);
                fetchJobs();
              } catch (e) {
                alert(`❌ Error: ${e.message}`);
              }
            }}
            style={{
              background: '#991b1b',
              border: 'none',
              color: 'white',
              fontWeight: 'bold'
            }}
          >
            🗑️ Delete All Data
          </button>
        </div>
        <div className="small" style={{ marginTop: '8px', opacity: 0.7 }}>
          Use with caution - these actions cannot be undone
        </div>
      </section>

      <section className="card">
        <h2>Jobs</h2>
        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button onClick={() => fetchJobs()} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>
            Total: {counts.total} | Active: {counts.active} | Done: {counts.done} | Discovered: {counts.discovered}
            {pagination.has_more && ` (Showing ${pagination.offset + jobs.length} of ${pagination.total})`}
          </div>
        </div>
        
        <TabGroup defaultIndex={0}>
          <TabList>
            <Tab className="tab-button">Crawled</Tab>
            <Tab className="tab-button">Discovered</Tab>
            <Tab className="tab-button">Jobs</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              {createTable(crawled)}
            </TabPanel>
            <TabPanel>
              {createTable(discovered)}
            </TabPanel>
            <TabPanel>
              {activeJobs.length > 0 ? (
                <div>
                  <div style={{ marginBottom: '16px', fontSize: '14px', opacity: 0.7 }}>
                    Showing {activeJobs.length} active job(s) - grouped by root page
                  </div>
                  {createTable(activeJobs.sort((a, b) => {
                    // Sort by root_page_id first, then by degree, then by status priority
                    const aRoot = a.root_page_id || a.page_id;
                    const bRoot = b.root_page_id || b.page_id;
                    if (aRoot !== bRoot) return aRoot - bRoot;
                    
                    const aDegree = a.degree ?? 999;
                    const bDegree = b.degree ?? 999;
                    if (aDegree !== bDegree) return aDegree - bDegree;
                    
                    const statusOrder = { 'running': 0, 'queued': 1, 'error': 2, 'paused': 3 };
                    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
                  }))}
                </div>
              ) : (
                createTable(activeJobs)
              )}
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);

