const params = new URLSearchParams(window.location.search);
const projectId = params.get('id');

if (!projectId) {
  document.body.innerHTML = '<div class="flex items-center justify-center min-h-screen text-gray-400">缺少项目 ID</div>';
  throw new Error('Missing project id');
}

const COLORS = {
  human: '#3b82f6',
  agent: '#10b981',
  system: '#ef4444',
};

let cy;

async function loadProject() {
  const res = await fetch(`/projects/${projectId}`);
  if (!res.ok) {
    document.body.innerHTML = '<div class="flex items-center justify-center min-h-screen text-gray-400">项目不存在</div>';
    return;
  }
  const data = await res.json();
  render(data);
  setupButtons(data);
}

function setupButtons(data) {
  const stopBtn = document.getElementById('stop-btn');
  const pushBtn = document.getElementById('push-btn');
  const summaryBar = document.getElementById('summary-bar');

  if (data.status === 'active') {
    stopBtn.classList.remove('hidden');
    stopBtn.setAttribute('hx-post', `/projects/${projectId}/stop`);
    pushBtn.classList.add('hidden');
  } else if (data.status === 'stopped' || data.status === 'failed') {
    pushBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  } else if (data.status === 'completed') {
    summaryBar.classList.remove('hidden');
    document.getElementById('summary-text').textContent = data.summary || '';
    pushBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
}

function render(data) {
  const elements = [];

  const nodeIdsInEdges = new Set();
  for (const edge of data.edges) {
    for (const nid of edge.from_node_ids) nodeIdsInEdges.add(nid);
    for (const nid of edge.to_node_ids) nodeIdsInEdges.add(nid);
  }

  for (const node of data.nodes) {
    elements.push({
      data: {
        id: `n${node.id}`,
        label: truncate(node.description, 60),
        createdBy: node.created_by,
        nodeId: node.id,
      },
      style: {
        'background-color': COLORS[node.created_by] || '#6b7280',
        'border-width': 2,
        'border-color': '#1f2937',
        'font-size': '11px',
        'text-wrap': 'wrap',
        'text-max-width': '180px',
        'text-valign': 'center',
        'text-halign': 'center',
        'color': '#d1d5db',
        'width': 'label',
        'height': 'label',
        'padding': '10px',
        'shape': 'round-rectangle',
      },
    });
  }

  for (const edge of data.edges) {
    const isResulted = edge.to_node_ids.length > 0;
    for (const fromId of edge.from_node_ids) {
      for (const toId of edge.to_node_ids) {
        elements.push({
          data: {
            id: `e${edge.id}_${fromId}_${toId}`,
            source: `n${fromId}`,
            target: `n${toId}`,
            label: truncate(edge.direction_description, 40),
            edgeId: edge.id,
            failureCount: edge.failure_count,
          },
          classes: isResulted ? 'resulted' : 'pending',
        });
      }
      if (!isResulted) {
        elements.push({
          data: {
            id: `e${edge.id}_pending`,
            source: `n${fromId}`,
            target: `n${fromId}`,
            label: truncate(edge.direction_description, 40),
            edgeId: edge.id,
            failureCount: edge.failure_count,
            pending: true,
          },
          classes: 'pending',
        });
      }
    }
  }

  const evidenceIds = data.evidence_node_ids || [];
  const evidenceSet = new Set(evidenceIds.map(id => `n${id}`));

  if (cy) cy.destroy();

  cy = cytoscape({
    container: document.getElementById('graph'),
    elements,
    style: [
      {
        selector: 'node',
        style: { 'label': 'data(label)' },
      },
      {
        selector: '.resulted',
        style: {
          'width': 2,
          'line-color': '#4b5563',
          'target-arrow-color': '#4b5563',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'font-size': '9px',
          'color': '#6b7280',
          'text-rotation': 'autorotate',
        },
      },
      {
        selector: '.pending',
        style: {
          'width': 1.5,
          'line-color': '#6b7280',
          'line-style': 'dashed',
          'curve-style': 'bezier',
          'font-size': '9px',
          'color': '#6b7280',
        },
      },
      {
        selector: '.evidence',
        style: {
          'border-color': '#fbbf24',
          'border-width': 3,
        },
      },
    ],
    layout: {
      name: 'dagre',
      rankDir: 'TB',
      spacingFactor: 1.5,
      nodeDimensionsIncludeLabels: true,
    },
  });

  for (const id of evidenceSet) {
    const node = cy.getElementById(id);
    if (node.length) node.addClass('evidence');
  }

  cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    showDetail('node', node.data());
  });

  cy.on('tap', 'edge', (evt) => {
    const edge = evt.target;
    showDetail('edge', edge.data());
  });

  setTimeout(() => loadProject(), 5000);
}

function showDetail(type, data) {
  const panel = document.getElementById('detail-panel');
  const title = document.getElementById('detail-title');
  const body = document.getElementById('detail-body');

  panel.classList.remove('hidden');

  if (type === 'node') {
    title.innerHTML = `<span class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${COLORS[data.createdBy] || '#6b7280'}"></span>Node #${data.nodeId}`;
    body.innerHTML = `
      <p class="mb-1"><span class="text-gray-500">来源:</span> ${data.createdBy}</p>
      <p class="whitespace-pre-wrap">${data.label}</p>
    `;
  } else if (type === 'edge') {
    const style = data.pending ? 'text-amber-400' : 'text-gray-400';
    title.textContent = `Edge #${data.edgeId}`;
    body.innerHTML = `
      <p class="mb-1"><span class="text-gray-500">状态:</span> <span class="${style}">${data.pending ? '待执行' : '已完成'}</span></p>
      ${data.failureCount > 0 ? `<p class="mb-1 text-red-400">失败次数: ${data.failureCount}</p>` : ''}
      <p class="whitespace-pre-wrap">${data.label}</p>
    `;
  }

  setTimeout(() => {
    if (cy) { cy.resize(); cy.fit(); }
  }, 50);
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function showPushModal() {
  document.getElementById('push-modal').classList.remove('hidden');
  document.getElementById('push-nodes').innerHTML = `
    <div class="push-node-field">
      <textarea name="description" rows="2"
        class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none mb-2"
        placeholder="输入新的信息..."></textarea>
    </div>
  `;
}

function addPushNode() {
  const container = document.getElementById('push-nodes');
  const div = document.createElement('div');
  div.className = 'push-node-field';
  div.innerHTML = `
    <textarea name="description" rows="2"
      class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none mb-2"
      placeholder="输入新的信息..."></textarea>
  `;
  container.appendChild(div);
}

document.getElementById('push-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textareas = document.querySelectorAll('#push-nodes textarea');
  const nodes = [];
  for (const ta of textareas) {
    if (ta.value.trim()) {
      nodes.push({ description: ta.value.trim() });
    }
  }

  await fetch(`/projects/${projectId}/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes }),
  });

  document.getElementById('push-modal').classList.add('hidden');
  loadProject();
});

loadProject();
