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

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/jobs');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setJobs(data.jobs || []);
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
    { accessorKey: 'title', header: 'Title' },
    { 
      accessorKey: 'status', 
      header: 'Status',
      cell: ({ getValue }) => (
        <span className="badge">{getValue()}</span>
      )
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

  const crawled = jobs.filter(j => j.status === 'done');
  const discovered = jobs.filter(j => j.status === 'discovered');
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
        <div style={{ marginBottom: '16px' }}>
          <button onClick={fetchJobs} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
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
              {createTable(activeJobs)}
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </section>
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);

