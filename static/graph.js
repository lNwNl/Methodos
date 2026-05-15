const params = new URLSearchParams(window.location.search);
const projectId = params.get('id');

const NODE_COLORS = { human: '#4F46E5', agent: '#0D9488', system: '#D97706' };

const { createApp, ref, onMounted, onBeforeUnmount, nextTick } = Vue;

createApp({
  setup() {
    const project = ref(null);
    const loading = ref(true);
    const error = ref('');
    const selected = ref(null);
    const showPushModal = ref(false);
    const pushNodes = ref([{ description: '' }]);
    const panelWidth = ref(Number(localStorage.getItem('methodos-panel-width') || 320));
    const layoutKey = ref(localStorage.getItem('methodos-layout') || 'dagre_tb');
    const graphReady = ref(false);
    let cy = null;

    const CY_THEME = {
      dark: {
        nodeBg: '#3A3E52', nodeBorder: '#2A2D3E', nodeText: '#CBD5E1',
        resultedLine: '#5B6E8A', resultedArrow: '#5B6E8A', resultedText: '#5B6E8A',
        pendingLine: '#3A3E52', pendingText: '#64748B',
        ghostBorder: '#3A3E52', tbg: '#1E2030',
      },
      light: {
        nodeBg: '#F1F5F9', nodeBorder: '#CBD5E1', nodeText: '#334155',
        resultedLine: '#6B7FA3', resultedArrow: '#6B7FA3', resultedText: '#6B7FA3',
        pendingLine: '#CBD5E1', pendingText: '#94A3B8',
        ghostBorder: '#CBD5E1', tbg: '#FFFFFF',
      },
    };

    function currentTheme() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }

    function toggleTheme() {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('methodos-theme', next);
      applyCyTheme(next);
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: next } }));
    }

    function applyCyTheme(theme) {
      if (!cy) return;
      var s = CY_THEME[theme] || CY_THEME.light;
      cy.style()
        .selector('node').style({
          'background-color': s.nodeBg,
          'border-color': s.nodeBorder,
          'color': s.nodeText,
        })
        .selector('.type-human').style({
          'background-color': NODE_COLORS.human,
          'border-color': '#3730A3',
          'color': '#FFFFFF',
          'font-weight': '500',
        })
        .selector('.type-agent').style({
          'background-color': NODE_COLORS.agent,
          'border-color': '#0F766E',
          'color': '#FFFFFF',
          'font-weight': '500',
        })
        .selector('.type-system').style({
          'background-color': NODE_COLORS.system,
          'border-color': '#B45309',
          'color': '#FFFFFF',
          'font-weight': '500',
        })
        .selector('.resulted').style({
          'line-color': s.resultedLine,
          'target-arrow-color': s.resultedArrow,
          'color': s.resultedText,
          'text-background-color': s.tbg,
        })
        .selector('.pending').style({
          'line-color': s.pendingLine,
          'color': s.pendingText,
          'text-background-color': s.tbg,
        })
        .selector('.edge-running').style({
          'text-background-color': s.tbg,
        })
        .selector('.ghost').style({ 'border-color': s.ghostBorder })
        .update();
    }
    let timer = null;
    let eventsReady = false;
    let resizing = false;
    let resizeStartX = 0;
    let resizeStartW = 0;
    const draggedPositions = new Map();

    const TRANSIENT_CLASSES = new Set(['dimmed', 'focus', 'evidence']);

    const LAYOUT_NAMES = {
      dagre_tb: '从上到下',
      dagre_lr: '从左到右',
      breadthfirst: '广度优先',
      concentric: '同心圆',
      circle: '环形总览',
      cose: '力导向',
    };

    function layoutOpts(key) {
      const base = { fit: true, padding: 50 };
      switch (key) {
        case 'dagre_tb':
          return { ...base, name: 'dagre', rankDir: 'TB', spacingFactor: 1.4, nodeDimensionsIncludeLabels: true };
        case 'dagre_lr':
          return { ...base, name: 'dagre', rankDir: 'LR', spacingFactor: 1.4, nodeDimensionsIncludeLabels: true };
        case 'breadthfirst':
          return { ...base, name: 'breadthfirst', directed: true, spacingFactor: 1.4 };
        case 'concentric':
          return { ...base, name: 'concentric', concentric: (n) => n.degree(), minNodeSpacing: 50 };
        case 'circle':
          return { ...base, name: 'circle' };
        case 'cose':
          return { ...base, name: 'cose', idealEdgeLength: 200, nodeRepulsion: 400000, nodeOverlap: 50, componentSpacing: 100, numIter: 2500, randomize: false, gravity: 0.1 };
        default:
          return { ...base, name: 'dagre', rankDir: 'TB', spacingFactor: 1.4, nodeDimensionsIncludeLabels: true };
      }
    }

    function setLayout(key) {
      if (!cy) return;
      layoutKey.value = key;
      localStorage.setItem('methodos-layout', key);
      cy.layout(layoutOpts(key)).run();
      setTimeout(() => { restoreDragged(); cy.fit(undefined, 50); }, 50);
    }

    function runLayout() {
      if (!cy) return;
      cy.layout(layoutOpts(layoutKey.value)).run();
      setTimeout(() => restoreDragged(), 50);
    }

    function statusInfo(p) {
      if (p.status === 'active' && !p.last_plan_at && p.edges.length === 0) {
        return { cls: 'badge-planning', label: '推理中' };
      }
      const m = {
        active: { cls: 'badge-active', label: '活跃' },
        completed: { cls: 'badge-completed', label: '完成' },
        failed: { cls: 'badge-failed', label: '失败' },
        stopped: { cls: 'badge-stopped', label: '暂停' },
      };
      return m[p.status] || m.active;
    }

    async function fetchProject() {
      try {
        let data;
        if (window.__preload) {
          data = await window.__preload;
          window.__preload = null;
        } else {
          const r = await fetch(`/projects/${projectId}`);
          if (!r.ok) throw new Error(String(r.status));
          data = await r.json();
        }
        project.value = data;
        error.value = '';
        loading.value = false;
        await nextTick();
        renderGraph();
        graphReady.value = true;
      } catch (e) {
        error.value = `无法加载: ${e.message}`;
        loading.value = false;
      }
    }

    // ---- Build desired element map from project data ----

    function buildDesired(p) {
      const desired = new Map();
      const existingNodeIds = new Set(p.nodes.map(n => n.id));
      const isCompleted = p.status === 'completed';

      for (const n of p.nodes) {
        var cls = '';
        if (n.created_by === 'human') cls = 'type-human';
        else if (n.created_by === 'agent') cls = 'type-agent';
        else if (n.created_by === 'system') cls = 'type-system';
        desired.set(`n${n.id}`, {
          group: 'nodes',
          data: { id: `n${n.id}`, label: trunc(n.description, 55), description: n.description, createdBy: n.created_by, nodeId: n.id },
          classes: cls,
        });
      }

      for (const e of p.edges) {
        const ok = e.to_node_ids.length > 0;
        const running = !ok && e.claimed_at !== null;

        for (const f of e.from_node_ids) {
          if (ok) {
            for (const t of e.to_node_ids) {
              desired.set(`e${e.id}_${f}_${t}`, {
                group: 'edges',
                data: { id: `e${e.id}_${f}_${t}`, source: `n${f}`, target: `n${t}`, label: trunc(e.direction_description, 35), description: e.direction_description, edgeId: e.id, failureCount: e.failure_count },
                classes: 'resulted',
              });
            }
          } else {
            const ghostId = `ghost_e${e.id}_${f}`;
            desired.set(ghostId, {
              group: 'nodes',
              data: { id: ghostId, label: '', ghost: true, edgeId: e.id, running },
              classes: running ? 'ghost-running' : 'ghost',
            });
            desired.set(`e${e.id}_${f}_pending`, {
              group: 'edges',
              data: { id: `e${e.id}_${f}_pending`, source: `n${f}`, target: ghostId, label: trunc(e.direction_description, 35), description: e.direction_description, edgeId: e.id, pending: true, running },
              classes: running ? 'edge-running' : 'pending',
            });
          }
        }
      }

      if (isCompleted) {
        const evidenceIds = (p.evidence_node_ids || []).filter(id => existingNodeIds.has(id));
        desired.set('complete_node', {
          group: 'nodes',
          data: { id: 'complete_node', label: '✓ 探索完成', complete: true, summary: p.summary, evidenceIds },
          classes: 'complete-node',
        });
        for (const nid of evidenceIds) {
          desired.set(`conc_${nid}`, {
            group: 'edges',
            data: { id: `conc_${nid}`, source: `n${nid}`, target: 'complete_node', label: '', conclusion: true },
            classes: 'conclusion',
          });
        }
      }

      return desired;
    }

    // ---- Core render ----

    function renderGraph() {
      const p = project.value;
      if (!p) return;
      const container = document.getElementById('graph');
      if (!container) return;

      const desired = buildDesired(p);

      if (!cy) {
        initGraph(container, desired, p);
      } else {
        updateGraph(desired, p);
      }
    }

    function initGraph(container, desired, p) {
      var theme = currentTheme();
      var s = CY_THEME[theme] || CY_THEME.light;

      const elements = [];
      for (const [, spec] of desired) {
        elements.push({ group: spec.group, data: spec.data, classes: spec.classes || '' });
      }

      cy = cytoscape({
        container,
        elements,
        style: [
          { selector: 'node', style: { 'label': 'data(label)', 'background-color': s.nodeBg, 'border-width': 1.5, 'border-color': s.nodeBorder, 'font-size': '11px', 'text-wrap': 'wrap', 'text-max-width': '180px', 'text-valign': 'center', 'text-halign': 'center', 'color': s.nodeText, 'padding': '8px', 'shape': 'round-rectangle', 'font-family': 'Inter, sans-serif', 'transition-property': 'opacity', 'transition-duration': 300 } },
          { selector: '.type-human',  style: { 'background-color': NODE_COLORS.human, 'border-color': '#3730A3', 'color': '#FFFFFF', 'font-weight': '500' } },
          { selector: '.type-agent',  style: { 'background-color': NODE_COLORS.agent, 'border-color': '#0F766E', 'color': '#FFFFFF', 'font-weight': '500' } },
          { selector: '.type-system', style: { 'background-color': NODE_COLORS.system, 'border-color': '#B45309', 'color': '#FFFFFF', 'font-weight': '500' } },
          { selector: '.resulted', style: { 'width': 1.5, 'line-color': s.resultedLine, 'target-arrow-color': s.resultedArrow, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '9px', 'color': s.resultedText, 'text-rotation': 'autorotate', 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.pending', style: { 'width': 1.2, 'line-color': s.pendingLine, 'line-style': 'dashed', 'curve-style': 'bezier', 'font-size': '9px', 'color': s.pendingText, 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.edge-running', style: { 'width': 1.5, 'line-color': '#6366F1', 'line-style': 'dashed', 'target-arrow-color': '#6366F1', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '9px', 'color': '#6366F1', 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.conclusion', style: { 'width': 2.5, 'line-color': '#3C5DFF', 'target-arrow-color': '#3C5DFF', 'target-arrow-shape': 'triangle', 'curve-style': 'straight', 'line-style': 'solid' } },
          { selector: '.ghost', style: { 'width': 8, 'height': 8, 'background-color': 'transparent', 'border-width': 1.5, 'border-color': s.ghostBorder, 'border-style': 'dashed', 'border-opacity': 0.35 } },
          { selector: '.ghost-running', style: { 'width': 9, 'height': 9, 'background-color': '#3C5DFF', 'background-opacity': 0.15, 'border-width': 1.5, 'border-color': '#3C5DFF', 'border-style': 'dashed', 'border-opacity': 0.5 } },
          { selector: '.complete-node', style: { 'shape': 'round-rectangle', 'background-color': '#3C5DFF', 'border-width': 1.5, 'border-color': '#3C5DFF', 'font-size': '11px', 'font-weight': '600', 'color': '#FFFFFF', 'text-wrap': 'wrap', 'text-max-width': '160px', 'text-valign': 'center', 'text-halign': 'center', 'padding': '8px', 'font-family': 'Inter, sans-serif' } },
          { selector: '.evidence', style: { 'border-color': '#F59E0B', 'border-width': 2.5 } },
          { selector: '.dimmed', style: { 'opacity': 0.18 } },
          { selector: '.focus', style: { 'border-color': '#F59E0B', 'border-width': 2.5 } },
        ],
        layout: layoutOpts(layoutKey.value),
      });

      applyEvidence(p);
      registerEvents();
    }

    function updateGraph(desired, p) {
      const current = new Set(cy.elements().map(el => el.id()));
      const newIds = new Set();

      // Remove stale elements
      cy.elements().forEach(el => {
        if (!desired.has(el.id())) cy.remove(el);
      });

      // Add new and sync classes/data for existing
      for (const [id, spec] of desired) {
        if (!current.has(id)) {
          cy.add({ group: spec.group, data: spec.data, classes: spec.classes || '' });
          newIds.add(id);
        } else {
          const el = cy.getElementById(id);
          if (!el.length) continue;

          if (spec.classes !== undefined) {
            const cur = el.classes().filter(c => !TRANSIENT_CLASSES.has(c)).sort().join(' ');
            const des = (spec.classes || '').split(' ').filter(Boolean).sort().join(' ');
            if (cur !== des) {
              el.classes().filter(c => !TRANSIENT_CLASSES.has(c)).forEach(c => el.removeClass(c));
              (spec.classes || '').split(' ').filter(Boolean).forEach(c => {
                if (!el.hasClass(c)) el.addClass(c);
              });
            }
          }

          if (spec.data) el.data(spec.data);
        }
      }

      applyEvidence(p);

      if (newIds.size > 0) {
        cy.layout(layoutOpts(layoutKey.value)).run();
        restoreDragged();
        const fresh = cy.elements().filter(el => newIds.has(el.id()));
        if (fresh.length) {
          fresh.style('opacity', 0);
          setTimeout(() => {
            fresh.animate({ style: { opacity: 1 } }, { duration: 350, easing: 'ease-in-out-cubic' });
          }, 30);
        }
      }
    }

    function applyEvidence(p) {
      if (!cy) return;
      const evidenceSet = new Set((p.evidence_node_ids || []).map(id => `n${id}`));
      cy.nodes().forEach(n => {
        if (evidenceSet.has(n.id())) {
          if (!n.hasClass('evidence')) n.addClass('evidence');
        } else {
          if (n.hasClass('evidence')) n.removeClass('evidence');
        }
      });
    }

    // ---- Events ----

    function registerEvents() {
      if (!cy || eventsReady) return;
      eventsReady = true;

      cy.on('tap', 'node', e => {
        const d = e.target.data();
        if (d.ghost) {
          selected.value = { type: 'ghost', edgeId: d.edgeId, status: d.running ? '执行中' : '待执行' };
          highlightNode(e.target);
        } else if (d.complete) {
          selected.value = { type: 'complete', summary: d.summary, evidenceIds: d.evidenceIds || [] };
          highlightNode(e.target);
        } else {
          selected.value = { type: 'node', nodeId: d.nodeId, createdBy: d.createdBy, description: d.description, data: d };
          highlightNode(e.target);
        }
      });

      cy.on('tap', 'edge', e => {
        const d = e.target.data();
        if (d.conclusion) {
          selected.value = { type: 'conclusion', source: d.source };
        } else if (d.pending || d.running) {
          selected.value = { type: 'edge', edgeId: d.edgeId, pending: true, running: d.running, description: d.description, data: d };
        } else if (d.edgeId) {
          selected.value = { type: 'edge', edgeId: d.edgeId, failureCount: d.failureCount, description: d.description, data: d };
        }
        highlightEdge(e.target);
      });

      cy.on('tap', e => {
        if (e.target === cy) {
          selected.value = null;
          clearHighlight();
        }
      });

      cy.on('free', 'node', e => {
        const node = e.target;
        const pos = node.position();
        draggedPositions.set(node.id(), { x: pos.x, y: pos.y });
      });
    }

    // ---- Highlight helpers ----

    function highlightNode(node) {
      if (!cy) return;
      cy.elements().addClass('dimmed');
      node.removeClass('dimmed').addClass('focus');
      node.neighborhood().removeClass('dimmed');
    }

    function highlightEdge(edge) {
      if (!cy) return;
      cy.elements().addClass('dimmed');
      edge.removeClass('dimmed');
      edge.source().removeClass('dimmed').addClass('focus');
      edge.target().removeClass('dimmed').addClass('focus');
    }

    function clearHighlight() {
      if (!cy) return;
      cy.elements().removeClass('dimmed').removeClass('focus');
    }

    function restoreDragged() {
      for (const [id, pos] of draggedPositions) {
        const node = cy.getElementById(id);
        if (node.length) node.position(pos);
      }
    }

    // ---- Panel resize ----

    function startPanelResize(e) {
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartW = panelWidth.value;
      document.addEventListener('mousemove', onPanelResize);
      document.addEventListener('mouseup', stopPanelResize);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }

    function onPanelResize(e) {
      if (!resizing) return;
      panelWidth.value = Math.max(240, Math.min(640, resizeStartW + (resizeStartX - e.clientX)));
      localStorage.setItem('methodos-panel-width', panelWidth.value);
      if (cy) { cy.resize(); setTimeout(() => cy.fit(undefined, 50), 50); }
    }

    function stopPanelResize() {
      resizing = false;
      document.removeEventListener('mousemove', onPanelResize);
      document.removeEventListener('mouseup', stopPanelResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    // ---- Zoom ----

    function zoomIn() { if (cy) { cy.zoom(cy.zoom() * 1.2); } }
    function zoomOut() { if (cy) { cy.zoom(cy.zoom() / 1.2); } }
    function zoomFit() { if (cy) { cy.fit(undefined, 50); } }

    // ---- Actions ----

    async function stopProject() {
      try { await fetch(`/projects/${projectId}/stop`, { method: 'POST' }); fetchProject(); } catch { }
    }

    async function confirmPush() {
      const nodes = pushNodes.value.filter(n => n.description.trim()).map(n => ({ description: n.description.trim() }));
      try {
        await fetch(`/projects/${projectId}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes }) });
        showPushModal.value = false;
        pushNodes.value = [{ description: '' }];
        fetchProject();
      } catch { }
    }

    function addNode() { pushNodes.value.push({ description: '' }); }

    function trunc(s, max) {
      if (!s) return '';
      return s.length > max ? s.slice(0, max) + '...' : s;
    }

    function evidenceNodesDesc(ids) {
      if (!ids || !ids.length) return [];
      const ns = (project.value?.nodes || []);
      return ids.map(id => {
        const node = ns.find(n => n.id === id);
        return node ? { id, desc: trunc(node.description, 40) } : { id, desc: '' };
      });
    }

    // ---- Lifecycle ----

    onMounted(() => {
      fetchProject();
      timer = setInterval(fetchProject, 2000);
    });
    onBeforeUnmount(() => {
      clearInterval(timer);
      if (cy) { cy.destroy(); cy = null; eventsReady = false; }
    });

    return {
      project, loading, error, selected, showPushModal, pushNodes, panelWidth, layoutKey, LAYOUT_NAMES, graphReady,
      stopProject, confirmPush, addNode, statusInfo, zoomIn, zoomOut, zoomFit, trunc, evidenceNodesDesc,
      startPanelResize, setLayout, toggleTheme,
    };
  },

  template: `
  <div style="display:flex;flex-direction:column;height:100vh;padding:0.75rem 1rem;gap:0.5rem">
      <div class="flex items-center justify-between shrink-0">
      <a href="/" class="back-link">&larr; 返回</a>
      <div v-if="project" class="flex items-center gap-2">
        <button class="theme-toggle" @click="toggleTheme" title="切换主题">◐</button>
        <span :class="'badge ' + statusInfo(project).cls">{{ statusInfo(project).label }}</span>
        <button v-if="project.status === 'active'" class="btn btn-warning btn-sm" @click="stopProject">暂停</button>
        <button v-if="project.status !== 'active'" class="btn btn-primary btn-sm" @click="showPushModal = true">推进</button>
      </div>
    </div>

    <div v-if="loading" class="empty-state flex-1"><span class="spinner"></span> 加载中...</div>
    <div v-else-if="error" class="empty-state flex-1" style="color:var(--danger)">{{ error }}</div>

    <template v-else-if="project">
      <div v-if="project.status === 'completed' && project.summary" class="summary-bar">
        <span class="badge badge-completed" style="margin-right:0.5rem">完成</span>
        {{ project.summary }}
      </div>

      <div class="flex flex-1 min-h-0" style="flex:1;min-height:0;gap:0">
        <div class="graph-container flex-1" style="flex:1;min-width:0;border-right:none;position:relative">
          <div v-if="!graphReady" class="graph-loading-overlay">
            <span class="spinner"></span>
          </div>
          <div class="graph-toolbar">
            <button class="btn" @click="zoomOut" title="缩小">−</button>
            <button class="btn" @click="zoomIn"  title="放大">+</button>
            <button class="btn" @click="zoomFit" title="适配屏幕">⊡</button>
            <select class="layout-select" :value="layoutKey" @change="setLayout($event.target.value)">
              <option v-for="(label, key) in LAYOUT_NAMES" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div id="graph" class="w-full h-full"></div>
        </div>

        <div class="panel-resize-handle" @mousedown="startPanelResize"></div>

        <div class="detail-panel" :style="{ width: panelWidth + 'px', flexShrink: '0' }">
          <template v-if="selected">
            <template v-if="selected.type === 'ghost'">
              <div class="detail-title">探索点 #{{ selected.edgeId }}</div>
              <div class="detail-field">
                <div class="detail-label">状态</div>
                <div class="detail-value" :style="{ color: selected.status === '执行中' ? 'var(--primary)' : 'var(--text-dim)' }">{{ selected.status }}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">说明</div>
                <div class="detail-value" style="color:var(--text-dim)">目标节点尚未生成，等待 Agent 执行中...</div>
              </div>
            </template>

            <template v-else-if="selected.type === 'complete'">
              <div class="detail-title" style="color:var(--primary)">✓ 探索完成</div>
              <div class="detail-field" v-if="selected.summary">
                <div class="detail-label">总结</div>
                <div class="detail-value">{{ selected.summary }}</div>
              </div>
              <div class="detail-field" v-if="selected.evidenceIds.length">
                <div class="detail-label">支撑节点</div>
                <div class="detail-value">
                  <div v-for="ev in evidenceNodesDesc(selected.evidenceIds)" :key="ev.id" style="margin-bottom:3px;display:flex;align-items:center;gap:0.35rem">
                    <span style="flex-shrink:0;font-size:0.65rem;font-weight:600;color:var(--primary);border:1px solid var(--primary);border-radius:3px;padding:0px 4px">#{{ ev.id }}</span>
                    <span style="font-size:0.7rem;color:var(--text-dim)">{{ ev.desc }}</span>
                  </div>
                </div>
              </div>
              <div class="detail-field" v-else>
                <div class="detail-value" style="color:var(--text-dim)">所有探索任务已完成。</div>
              </div>
            </template>

            <template v-else-if="selected.type === 'node'">
              <div class="detail-title">节点 #{{ selected.nodeId }}</div>
              <div class="detail-field">
                <div class="detail-label">来源</div>
                <div class="detail-value">{{ selected.createdBy }}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">描述</div>
                <div class="detail-value">{{ selected.description }}</div>
              </div>
            </template>

            <template v-else-if="selected.type === 'conclusion'">
              <div class="detail-title" style="color:var(--primary)">结论</div>
              <div class="detail-field">
                <div class="detail-label">来源</div>
                <div class="detail-value">{{ selected.source }}</div>
              </div>
              <div class="detail-field">
                <div class="detail-value" style="color:var(--text-dim)">该节点的发现确立了最终结论。</div>
              </div>
            </template>

            <template v-else-if="selected.type === 'edge'">
              <div class="detail-title">探索方向 #{{ selected.edgeId }}</div>
              <div class="detail-field">
                <div class="detail-label">状态</div>
                <div class="detail-value">
                  <span v-if="selected.pending && selected.running" style="color:var(--primary)">执行中</span>
                  <span v-else-if="selected.pending" style="color:var(--text-dim)">待执行</span>
                  <span v-else>已完成</span>
                </div>
              </div>
              <div v-if="selected.failureCount > 0" class="detail-field">
                <div class="detail-label">失败次数</div>
                <div class="detail-value" style="color:var(--danger)">{{ selected.failureCount }}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">探索方向</div>
                <div class="detail-value">{{ selected.description }}</div>
              </div>
            </template>
          </template>
          <div v-else class="detail-panel-empty">
            点击节点或边<br>查看详细信息
          </div>
        </div>
      </div>
    </template>

    <Transition name="fade">
    <div v-if="showPushModal" class="modal-backdrop" @click.self="showPushModal = false">
      <div class="modal-panel">
        <h2 class="modal-title">推进项目</h2>
        <form @submit.prevent="confirmPush">
          <div v-for="(n,i) in pushNodes" :key="i" class="form-group">
            <textarea v-model="n.description" class="textarea" rows="2" placeholder="输入新的信息..."></textarea>
          </div>
          <button type="button" class="btn btn-sm" @click="addNode" style="color:var(--primary);border-color:var(--primary)">+ 添加信息</button>
          <div class="form-actions">
            <button type="button" class="btn" @click="showPushModal = false">取消</button>
            <button type="submit" class="btn btn-primary">提交</button>
          </div>
        </form>
      </div>
    </div>
    </Transition>
  </div>
  `,
}).mount('#app');
