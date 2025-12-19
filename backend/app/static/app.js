async function json(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'className') n.className = v;
    else if (k === 'onclick') n.onclick = v;
    else if (k === 'style' && typeof v === 'object') {
      Object.assign(n.style, v);
    } else {
      n[k] = v;
    }
  });
  children.forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return n;
}

function formatProgress(cursor) {
  if (!cursor || !cursor.stage) return "";
  const stage = cursor.stage;
  const count = cursor.count || 0;
  const stageNames = {
    "crawling_initial_page": "Crawling initial page...",
    "fetching_outbound_links": "Fetching outbound links...",
    "fetching_inbound_links": "Fetching inbound links (backlinks)...",
    "fetching_links": "Fetching links...",
    "links_fetched": `Found ${count} links`,
    "resolving_titles": `Resolving ${count} titles...`,
    "titles_resolved": `Resolved ${count} titles`,
    "inserting_pages": `Inserting pages (${count})...`,
    "inserting_links": `Inserting ${count} links...`,
    "computing_degrees": "Computing degrees...",
    "enqueueing_neighbors": `Enqueueing ${count} neighbors for sequential crawl...`,
    "done": `Complete: ${count} links`
  };
  return stageNames[stage] || stage;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function createTable(containerId, data, columns) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  if (!data || data.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">No data</div>';
    return;
  }
  
  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, columns.map(col => el('th', {}, [col.header])))
    ]),
    el('tbody', {}, data.map(row => 
      el('tr', {}, columns.map(col => {
        const cellValue = col.accessor(row);
        const rendered = col.render ? col.render(cellValue, row) : cellValue;
        const td = el('td', {}, []);
        if (rendered && rendered.nodeType) {
          td.appendChild(rendered);
        } else {
          td.textContent = rendered || '';
        }
        return td;
      }))
    ))
  ]);
  
  container.appendChild(table);
}

function refreshJobs() {
  json("/api/admin/jobs").then(data => {
    const jobs = data.jobs || [];
    
    // Filter by status
    const crawled = jobs.filter(j => j.status === 'done');
    const discovered = jobs.filter(j => j.status === 'discovered');
    const activeJobs = jobs.filter(j => ['queued', 'running', 'error', 'paused'].includes(j.status));
    
    // Define columns
    const columns = [
      { id: 'page_id', header: 'Page ID', accessor: (row) => row.page_id },
      { id: 'title', header: 'Title', accessor: (row) => row.title },
      { id: 'status', header: 'Status', accessor: (row) => row.status, render: (val) => {
        const badge = el('span', { className: 'badge' }, [val]);
        return badge;
      }},
      { id: 'priority', header: 'Priority', accessor: (row) => row.priority },
      { id: 'out_degree', header: 'Out Degree', accessor: (row) => row.out_degree },
      { id: 'in_degree', header: 'In Degree', accessor: (row) => row.in_degree },
      { id: 'started_at', header: 'Started', accessor: (row) => row.started_at, render: formatDate },
      { id: 'finished_at', header: 'Finished', accessor: (row) => row.finished_at, render: formatDate },
      { id: 'error', header: 'Error', accessor: (row) => row.last_error || '-', render: (val) => val.length > 50 ? val.substring(0, 50) + '...' : val },
      { id: 'actions', header: 'Actions', accessor: (row) => row, render: (row) => {
        if (row.status === 'running' || row.status === 'queued') {
          const btn = el('button', {
            className: 'cancel-btn',
            style: { padding: '2px 8px', fontSize: '11px', background: '#dc2626', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' },
            onclick: () => cancelJob(row.page_id)
          }, ['Cancel']);
          return btn;
        }
        return '-';
      }}
    ];
    
    // Create tables for each tab
    createTable('crawled-table-container', crawled, columns);
    createTable('discovered-table-container', discovered, columns);
    createTable('jobs-table-container', activeJobs, columns);
  }).catch(err => {
    console.error('Error refreshing jobs:', err);
    document.getElementById('crawled-table-container').innerHTML = 'Error loading data';
    document.getElementById('discovered-table-container').innerHTML = 'Error loading data';
    document.getElementById('jobs-table-container').innerHTML = 'Error loading data';
  });
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const tabName = button.dataset.tab;
    
    // Update button states
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    // Update pane visibility
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// Extract title from Wikipedia URL or use as-is
function extractTitle(input) {
  input = input.trim();
  const urlMatch = input.match(/wikipedia\.org\/wiki\/([^?#]+)/);
  if (urlMatch) {
    return decodeURIComponent(urlMatch[1].replace(/_/g, ' '));
  }
  return input;
}

document.querySelector("#enqueue").addEventListener("click", async () => {
  const input = document.querySelector("#title").value.trim();
  if (!input) {
    document.querySelector("#enqueueResult").textContent = "Error: Please enter a title or URL";
    return;
  }
  
  const title = extractTitle(input);
  const priority = parseInt(document.querySelector("#priority").value || "0", 10);
  const box = document.querySelector("#enqueueResult");
  box.textContent = "Enqueuing…";
  try {
    const res = await fetch("/api/admin/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, priority, link_direction: "outbound", auto_crawl_neighbors: false }),
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
    box.textContent = `Queued: ${data.page.title} (page_id ${data.page.page_id})`;
    refreshJobs();
  } catch (e) {
    box.textContent = `Error: ${e.message}`;
  }
});

document.querySelector("#refresh").addEventListener("click", refreshJobs);

async function cancelJob(pageId) {
  if (!confirm(`Cancel job ${pageId}?`)) return;
  try {
    await json(`/api/admin/jobs/${pageId}/cancel`, { method: "POST" });
    alert("Job cancelled!");
    refreshJobs();
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}

document.querySelector("#fetchEgo").addEventListener("click", async () => {
  const pageId = document.querySelector("#pageId").value.trim();
  const out = document.querySelector("#egoOut");
  out.textContent = "Loading…";
  try {
    const data = await json(`/api/graph/ego?page_id=${encodeURIComponent(pageId)}&limit_neighbors=200`);
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    out.textContent = `Error: ${e.message}`;
  }
});

refreshJobs();
