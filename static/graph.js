const params = new URLSearchParams(window.location.search);
const projectId = params.get('id');

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
        const layoutKey = ref(localStorage.getItem('methodos-layout') || 'dagre_lr');
        const panelTab = ref(selected.value ? 'detail' : 'log');
        const graphReady = ref(false);
        const latestReport = ref(null);
        const reportGenerating = ref(false);
        let completedSelected = false;
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
        resultedLine: '#4B5E7C', resultedArrow: '#4B5E7C', resultedText: '#334155',
        pendingLine: '#94A3B8', pendingText: '#475569',
        ghostBorder: '#CBD5E1', tbg: '#F1F5F9',
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

    function nodeInlineStyle(createdBy, theme) {
      var s = CY_THEME[theme] || CY_THEME.light;
      var bg, fg, bd, fw;
      var light = theme === 'light';
      if (createdBy === 'human')       { bg = light ? '#EEF2FF' : '#4F46E5'; bd = light ? '#C7D2FE' : '#3730A3'; fg = light ? '#1E293B' : '#FFFFFF'; fw = light ? '600' : '500'; }
      else if (createdBy === 'agent')  { bg = light ? '#F0FDFA' : '#0D9488'; bd = light ? '#CCFBF1' : '#0F766E'; fg = light ? '#134E4A' : '#FFFFFF'; fw = light ? '600' : '500'; }
      else if (createdBy === 'system') { bg = light ? '#F5F5F4' : '#78716C'; bd = light ? '#D6D3D1' : '#57534E'; fg = light ? '#1C1917' : '#FFFFFF'; fw = light ? '600' : '500'; }
      else                             { bg = s.nodeBg;  bd = s.nodeBorder; fg = s.nodeText; fw = '400'; }
      return { 'background-color': bg, 'border-color': bd, 'color': fg, 'font-weight': fw };
    }

    function startNodeStyle(theme) {
      var light = theme === 'light';
      if (light) return { 'background-color': '#EDE9FE', 'border-color': '#C4B5FD', 'color': '#4C1D95', 'font-weight': '600' };
      return { 'background-color': '#7C3AED', 'border-color': '#6D28D9', 'color': '#FFFFFF', 'font-weight': '600' };
    }

    function endNodeStyle(theme) {
      var light = theme === 'light';
      if (light) return { 'background-color': '#D1FAE5', 'border-color': '#6EE7B7', 'color': '#064E3B', 'font-weight': '600' };
      return { 'background-color': '#047857', 'border-color': '#065F46', 'color': '#FFFFFF', 'font-weight': '600' };
    }

    function completeNodeStyle(theme) {
      var light = theme === 'light';
      if (light) return { 'background-color': '#DBEAFE', 'border-color': '#93C5FD', 'color': '#1E3A5F', 'font-weight': '600' };
      return { 'background-color': '#3C5DFF', 'border-color': '#3C5DFF', 'color': '#FFFFFF', 'font-weight': '600' };
    }

    function applyNodeInlineStyles(theme) {
      if (!cy) return;
      cy.nodes().forEach(function(node) {
        if (node.data('ghost')) return;
        if (node.data('complete')) {
          node.style(completeNodeStyle(theme));
        } else if (node.data('isStart')) {
          node.style(startNodeStyle(theme));
        } else if (node.data('isEnd')) {
          node.style(endNodeStyle(theme));
        } else {
          var cb = node.data('createdBy');
          if (cb) node.style(nodeInlineStyle(cb, theme));
        }
      });
    }

    function applyCyTheme(theme) {
      if (!cy) return;
      var s = CY_THEME[theme] || CY_THEME.light;
      applyNodeInlineStyles(theme);
      cy.style()
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
    const TRANSIENT_CLASSES = new Set(['dimmed', 'focus', 'evidence']);

    const LAYOUT_NAMES = {
      dagre_lr: '从左到右',
      dagre_tb: '从上到下',
      breadthfirst: '广度优先',
      concentric: '同心圆',
      circle: '环形总览',
      cose: '力导向',
    };

    function layoutOpts(key) {
      const base = { fit: true, padding: 50 };
      const edgeLen = 150;
      switch (key) {
        case 'dagre_tb':
          return { ...base, name: 'dagre', rankDir: 'TB', rankSep: edgeLen, nodeSep: 50, edgeSep: 20, nodeDimensionsIncludeLabels: true };
        case 'dagre_lr':
          return { ...base, name: 'dagre', rankDir: 'LR', rankSep: edgeLen, nodeSep: 50, edgeSep: 20, nodeDimensionsIncludeLabels: true };
        case 'breadthfirst':
          return { ...base, name: 'breadthfirst', directed: true, spacingFactor: 1.15, avoidOverlap: true };
        case 'concentric':
          return { ...base, name: 'concentric', concentric: (n) => n.degree(), minNodeSpacing: 60, equidistant: true };
        case 'circle':
          return { ...base, name: 'circle', radius: edgeLen };
        case 'cose':
          return { ...base, name: 'cose', idealEdgeLength: edgeLen, nodeRepulsion: 200000, nodeOverlap: 50, componentSpacing: 100, numIter: 2500, randomize: false, gravity: 0.1 };
        default:
          return { ...base, name: 'dagre', rankDir: 'TB', rankSep: edgeLen, nodeSep: 50, edgeSep: 20, nodeDimensionsIncludeLabels: true };
      }
    }

    function setLayout(key) {
      if (!cy) return;
      layoutKey.value = key;
      localStorage.setItem('methodos-layout', key);
      cy.layout(layoutOpts(key)).run();
      setTimeout(() => cy.fit(undefined, 50), 50);
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
        if (data.status === 'completed' && !selected.value && !completedSelected) {
          completedSelected = true;
          const evIds = (data.evidence_node_ids || []).filter(id => data.nodes.some(n => n.id === id));
          selected.value = { type: 'complete', summary: data.summary, evidenceIds: evIds };
          if (cy) {
            const cn = cy.getElementById('complete_node');
            if (cn.length) highlightNode(cn);
          }
        }
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

      const sourceIds = new Set();
      const targetIds = new Set();
      for (const e of p.edges) {
        for (const f of e.from_node_ids) sourceIds.add(f);
        for (const t of e.to_node_ids) targetIds.add(t);
      }

      for (const n of p.nodes) {
        var cls = '';
        if (n.created_by === 'human') cls = 'type-human';
        else if (n.created_by === 'agent') cls = 'type-agent';
        else if (n.created_by === 'system') cls = 'type-system';
        const label = n.title || trunc(n.description, 10);
        const isStart = !targetIds.has(n.id);
        const isEnd = !sourceIds.has(n.id);
        desired.set(`n${n.id}`, {
          group: 'nodes',
          data: { id: `n${n.id}`, label: label, title: n.title, description: n.description, createdBy: n.created_by, nodeId: n.id, isStart, isEnd },
          classes: cls,
        });
      }

      for (const e of p.edges) {
        const ok = e.to_node_ids.length > 0;
        const running = !ok && e.claimed_at !== null;

        for (const f of e.from_node_ids) {
          if (ok) {
            for (const t of e.to_node_ids) {
              const edgeLabel = e.title || trunc(e.direction_description, 10);
              desired.set(`e${e.id}_${f}_${t}`, {
                group: 'edges',
                data: { id: `e${e.id}_${f}_${t}`, source: `n${f}`, target: `n${t}`, label: edgeLabel, title: e.title, description: e.direction_description, edgeId: e.id, failureCount: e.failure_count },
                classes: 'resulted',
              });
            }
          } else {
            const ghostId = `ghost_e${e.id}_${f}`;
            const edgeLabel = e.title || trunc(e.direction_description, 10);
            desired.set(ghostId, {
              group: 'nodes',
              data: { id: ghostId, label: '', ghost: true, edgeId: e.id, running },
              classes: running ? 'ghost-running' : 'ghost',
            });
            desired.set(`e${e.id}_${f}_pending`, {
              group: 'edges',
              data: { id: `e${e.id}_${f}_pending`, source: `n${f}`, target: ghostId, label: edgeLabel, title: e.title, description: e.direction_description, edgeId: e.id, pending: true, running },
              classes: running ? 'edge-running' : 'pending',
            });
          }
        }
      }

      if (isCompleted) {
        const evidenceIds = (p.evidence_node_ids || []).filter(id => existingNodeIds.has(id));
        desired.set('complete_node', {
          group: 'nodes',
          data: { id: 'complete_node', label: '收束', complete: true, summary: p.summary, evidenceIds },
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
          { selector: 'node', style: { 'label': 'data(label)', 'border-width': 1.5, 'font-size': '13px', 'text-wrap': 'wrap', 'text-max-width': '120px', 'text-valign': 'center', 'text-halign': 'center', 'padding': '8px', 'shape': 'round-rectangle', 'font-family': 'Inter, sans-serif', 'transition-property': 'opacity', 'transition-duration': 300 } },
          { selector: '.resulted', style: { 'label': 'data(label)', 'width': 1.5, 'line-color': s.resultedLine, 'target-arrow-color': s.resultedArrow, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '10px', 'color': s.resultedText, 'text-rotation': 'autorotate', 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.pending', style: { 'label': 'data(label)', 'width': 1.2, 'line-color': s.pendingLine, 'line-style': 'dashed', 'curve-style': 'bezier', 'font-size': '10px', 'color': s.pendingText, 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.edge-running', style: { 'label': 'data(label)', 'width': 1.5, 'line-color': '#6366F1', 'line-style': 'dashed', 'target-arrow-color': '#6366F1', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '10px', 'color': '#6366F1', 'font-family': 'Inter, sans-serif', 'text-background-color': s.tbg, 'text-background-opacity': 0.85, 'text-background-padding': '2px', 'text-background-shape': 'round-rectangle' } },
          { selector: '.conclusion', style: { 'width': 2.5, 'line-color': '#3C5DFF', 'target-arrow-color': '#3C5DFF', 'target-arrow-shape': 'triangle', 'curve-style': 'straight', 'line-style': 'solid' } },
          { selector: '.ghost', style: { 'width': 8, 'height': 8, 'background-color': 'transparent', 'border-width': 1.5, 'border-color': s.ghostBorder, 'border-style': 'dashed', 'border-opacity': 0.35 } },
          { selector: '.ghost-running', style: { 'width': 9, 'height': 9, 'background-color': '#3C5DFF', 'background-opacity': 0.15, 'border-width': 1.5, 'border-color': '#3C5DFF', 'border-style': 'dashed', 'border-opacity': 0.5 } },
          { selector: '.complete-node', style: { 'shape': 'round-rectangle', 'background-color': '#3C5DFF', 'border-width': 1.5, 'border-color': '#3C5DFF', 'font-size': '13px', 'font-weight': '600', 'color': '#FFFFFF', 'text-wrap': 'wrap', 'text-max-width': '180px', 'text-valign': 'center', 'text-halign': 'center', 'padding': '8px', 'font-family': 'Inter, sans-serif' } },
          { selector: '.evidence', style: { 'border-color': '#F59E0B', 'border-width': 2.5 } },
          { selector: '.dimmed', style: { 'opacity': 0.18 } },
          { selector: '.focus', style: { 'border-color': '#F59E0B', 'border-width': 2.5 } },
        ],
        layout: layoutOpts(layoutKey.value),
      });

      applyNodeInlineStyles(theme);
      applyEvidence(p);
      registerEvents();
    }

    function updateGraph(desired, p) {
      const current = new Set(cy.elements().map(el => el.id()));
      const newIds = new Set();

      const ghostBySource = new Map();
      cy.nodes().forEach(n => {
        if (n.data('ghost')) {
          const gid = n.id();
          const m = gid.match(/^ghost_e\d+_(\d+)$/);
          if (m) {
            const srcId = `n${m[1]}`;
            if (!ghostBySource.has(srcId)) ghostBySource.set(srcId, []);
            ghostBySource.get(srcId).push({ x: n.position().x, y: n.position().y });
          }
        }
      });

      // Remove stale elements
      cy.elements().forEach(el => {
        if (!desired.has(el.id())) cy.remove(el);
      });

      // Add new and sync classes/data for existing
      for (const [id, spec] of desired) {
        if (!current.has(id)) {
          let pos = undefined;
          if (spec.group === 'nodes' && !spec.data.ghost && spec.data.isEnd) {
            const fromIds = p.edges.filter(e => e.to_node_ids.includes(spec.data.nodeId)).flatMap(e => e.from_node_ids);
            for (const fid of fromIds) {
              const ghosts = ghostBySource.get(`n${fid}`);
              if (ghosts && ghosts.length) { pos = ghosts.shift(); break; }
            }
          }
          const added = cy.add({ group: spec.group, data: spec.data, classes: spec.classes || '', position: pos });
          newIds.add(id);
          if (spec.group === 'nodes' && !spec.data.ghost) {
            if (spec.data.complete) {
              added.style(completeNodeStyle(currentTheme()));
            } else if (spec.data.isStart) {
              added.style(startNodeStyle(currentTheme()));
            } else if (spec.data.isEnd) {
              added.style(endNodeStyle(currentTheme()));
            } else if (spec.data.createdBy) {
              added.style(nodeInlineStyle(spec.data.createdBy, currentTheme()));
            }
          }
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

          if (spec.data) {
            el.data(spec.data);
            if (el.isNode() && !el.data('ghost') && !el.data('complete')) {
              if (el.data('isStart')) {
                el.style(startNodeStyle(currentTheme()));
              } else if (el.data('isEnd')) {
                el.style(endNodeStyle(currentTheme()));
              } else if (el.data('createdBy')) {
                el.style(nodeInlineStyle(el.data('createdBy'), currentTheme()));
              }
            }
          }
        }
      }

      applyEvidence(p);

      if (newIds.size > 0) {
        cy.layout(layoutOpts(layoutKey.value)).run();

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
        panelTab.value = 'detail';
        if (d.ghost) {
          selected.value = { type: 'ghost', edgeId: d.edgeId, status: d.running ? '执行中' : '待执行' };
          highlightNode(e.target);
        } else if (d.complete) {
          selected.value = { type: 'complete', summary: d.summary, evidenceIds: d.evidenceIds || [] };
          highlightNode(e.target);
        } else {
          selected.value = { type: 'node', nodeId: d.nodeId, createdBy: d.createdBy, title: d.title, description: d.description, data: d };
          highlightNode(e.target);
        }
      });

      cy.on('tap', 'edge', e => {
        const d = e.target.data();
        panelTab.value = 'detail';
        if (d.conclusion) {
          selected.value = { type: 'conclusion', source: d.source };
        } else if (d.pending || d.running) {
          selected.value = { type: 'edge', edgeId: d.edgeId, pending: true, running: d.running, title: d.title, description: d.description, data: d };
        } else if (d.edgeId) {
          selected.value = { type: 'edge', edgeId: d.edgeId, failureCount: d.failureCount, title: d.title, description: d.description, data: d };
        }
        highlightEdge(e.target);
      });

      cy.on('tap', e => {
        if (e.target === cy) {
          selected.value = null;
          clearHighlight();
        }
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

    async function fetchLatestReport() {
      try {
        const r = await fetch(`/projects/${projectId}/report/latest`);
        if (r.ok) {
          const data = await r.json();
          latestReport.value = data;
          if (data && (data.status === 'pending' || data.status === 'generating')) {
            reportGenerating.value = true;
          } else {
            reportGenerating.value = false;
          }
        }
      } catch {}
    }

    async function generateReport() {
      try {
        reportGenerating.value = true;
        await fetch(`/projects/${projectId}/report`, { method: 'POST' });
        fetchLatestReport();
      } catch {}
    }

    function trunc(s, max) {
      if (!s) return '';
      return s.length > max ? s.slice(0, max) + '...' : s;
    }

    function evidenceNodesDesc(ids) {
      if (!ids || !ids.length) return [];
      const ns = (project.value?.nodes || []);
      return ids.map(id => {
        const node = ns.find(n => n.id === id);
        return node ? { id, title: node.title || trunc(node.description, 30) } : { id, title: '' };
      });
    }

    function formatTime(iso) {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        const pad = n => String(n).padStart(2, '0');
        const mon = pad(d.getMonth() + 1);
        const day = pad(d.getDate());
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        return mon + '-' + day + ' ' + hh + ':' + mm + ':' + ss;
      } catch { return iso; }
    }

    function formatDuration(ms) {
      if (!ms || ms < 0) return '';
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      var m = Math.floor(s / 60);
      s = s % 60;
      if (m < 60) return m + 'm' + String(s).padStart(2, '0') + 's';
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + 'h' + String(m).padStart(2, '0') + 'm';
    }

    function computeEdgeTimings() {
      const p = project.value;
      if (!p) return [];
      const nodeMap = new Map();
      for (const n of p.nodes) nodeMap.set(n.id, n);
      const timings = [];
      for (const e of p.edges) {
        const created = e.created_at ? new Date(e.created_at).getTime() : 0;
        const claimed = e.claimed_at ? new Date(e.claimed_at).getTime() : 0;
        var execEnd = 0;
        if (e.to_node_ids.length > 0) {
          const rn = nodeMap.get(e.to_node_ids[0]);
          if (rn) execEnd = new Date(rn.created_at).getTime();
        }
        var waitMs = (claimed && created) ? claimed - created : 0;
        var execMs = (execEnd && claimed) ? execEnd - claimed : 0;
        var totalMs = waitMs + execMs;
        timings.push({
          edgeId: e.id,
          title: e.title || (e.direction_description ? e.direction_description.slice(0, 15) : ''),
          waitMs: waitMs,
          execMs: execMs,
          totalMs: totalMs,
          completed: e.to_node_ids.length > 0,
        });
      }
      return timings;
    }

    const edgeTimings = Vue.computed(function() { return computeEdgeTimings(); });
    const edgeTimingsDone = Vue.computed(function() {
      return edgeTimings.value.filter(function(t) { return t.completed; }).length;
    });

    function buildTimeline() {
      var p = project.value;
      if (!p) return [];
      var projStart = p.created_at ? new Date(p.created_at).getTime() : 0;
      if (!projStart) return [];

      var nodeMap = new Map();
      for (var i = 0; i < p.nodes.length; i++) nodeMap.set(p.nodes[i].id, p.nodes[i]);

      var items = [];

      // Plan rounds: infer from edge creation batches
      var edgeGroups = [];
      for (var i = 0; i < p.edges.length; i++) {
        var e = p.edges[i];
        var t = e.created_at ? new Date(e.created_at).getTime() : 0;
        if (!t) continue;
        var placed = false;
        for (var j = 0; j < edgeGroups.length; j++) {
          if (Math.abs(t - edgeGroups[j].time) < 2000) {
            edgeGroups[j].time = Math.max(edgeGroups[j].time, t);
            placed = true;
            break;
          }
        }
        if (!placed) edgeGroups.push({ time: t });
      }

      // Plan timing from DB (latest round)
      var planDbStart = p.plan_started_at ? new Date(p.plan_started_at).getTime() : 0;
      var planDbEnd = p.plan_completed_at ? new Date(p.plan_completed_at).getTime() : 0;

      for (var i = 0; i < edgeGroups.length; i++) {
        var planStart, planEnd;
        if (i === edgeGroups.length - 1 && planDbStart && planDbEnd) {
          planStart = planDbStart;
          planEnd = planDbEnd;
        } else {
          planEnd = edgeGroups[i].time;
          planStart = i === 0 ? projStart : edgeGroups[i - 1].time;
        }
        items.push({
          type: 'plan',
          round: i + 1,
          id: null,
          startMs: planStart - projStart,
          durationMs: Math.max(planEnd - planStart, 0),
          status: 'done',
        });
      }

      // Acts
      for (var i = 0; i < p.edges.length; i++) {
        var e = p.edges[i];
        var claimed = e.claimed_at ? new Date(e.claimed_at).getTime() : 0;
        if (!claimed) continue;

        var actEnd = 0;
        var status = 'running';
        if (e.to_node_ids.length > 0) {
          var rn = nodeMap.get(e.to_node_ids[0]);
          if (rn) {
            actEnd = new Date(rn.created_at).getTime();
            status = 'done';
          }
        }
        if (!actEnd) actEnd = Date.now();

        items.push({
          type: 'act',
          round: null,
          id: e.id,
          startMs: claimed - projStart,
          durationMs: Math.max(actEnd - claimed, 0),
          status: status,
        });
      }

      items.sort(function(a, b) { return a.startMs - b.startMs; });
      return items;
    }

    var timeline = Vue.computed(function() { return buildTimeline(); });
    var timelineMax = Vue.computed(function() {
      var arr = timeline.value;
      if (!arr.length) return 1;
      var max = 0;
      for (var i = 0; i < arr.length; i++) {
        var end = arr[i].startMs + arr[i].durationMs;
        if (end > max) max = end;
      }
      return max > 0 ? max : 1;
    });

    function buildLog() {
      const p = project.value;
      if (!p) return [];
      const log = [];
      const edgeMap = new Map();
      for (const e of p.edges) edgeMap.set(e.id, e);
      for (const n of p.nodes) {
        const edge = n.edge_id ? edgeMap.get(n.edge_id) : null;
        const fromDesc = edge ? edge.title || trunc(edge.direction_description, 20) : '';
        const isTimeout = n.created_by === 'system' && n.description && n.description.includes('超时');
        var duration = 0;
        if (edge && edge.claimed_at && n.created_at) {
          duration = new Date(n.created_at).getTime() - new Date(edge.claimed_at).getTime();
        }
        log.push({
          type: 'node',
          createdBy: n.created_by,
          title: n.title || trunc(n.description, 15),
          description: n.description,
          time: n.created_at,
          nodeId: n.id,
          edgeId: n.edge_id,
          fromDesc,
          isTimeout,
          duration: duration,
        });
      }
      for (const e of p.edges) {
        let status = 'planned';
        let outcome = '';
        if (e.to_node_ids.length > 0) { status = 'completed'; outcome = 'success'; }
        else if (e.claimed_at) status = 'running';
        if (e.failure_count > 0) outcome = 'failed';
        var edgeDuration = 0;
        if (e.claimed_at && e.to_node_ids.length > 0) {
          const rn = p.nodes.find(function(nd) { return nd.id === e.to_node_ids[0]; });
          if (rn) edgeDuration = new Date(rn.created_at).getTime() - new Date(e.claimed_at).getTime();
        }
        log.push({
          type: 'edge',
          status,
          outcome,
          title: e.title || trunc(e.direction_description, 15),
          description: e.direction_description,
          time: e.created_at,
          edgeId: e.id,
          failureCount: e.failure_count,
          duration: edgeDuration,
        });
      }
      log.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      if (p.status === 'completed') {
        log.push({
          type: 'complete',
          summary: p.summary || '',
          title: '收束',
          time: p.updated_at || '',
          evidenceNodeIds: p.evidence_node_ids || [],
          duration: 0,
        });
      }
      return log;
    }

    function selectLogEntry(entry) {
      const p = project.value;
      if (!p) return;
      if (entry.type === 'complete') {
        const evIds = (p.evidence_node_ids || []).filter(id => (p.nodes || []).some(n => n.id === id));
        selected.value = { type: 'complete', summary: p.summary, evidenceIds: evIds };
        nextTick(() => {
          const el = cy.getElementById('complete_node');
          if (el.length) { clearHighlight(); highlightNode(el); }
        });
      } else if (entry.type === 'node') {
        const n = (p.nodes || []).find(nd => nd.id === entry.nodeId);
        if (n) {
          selected.value = { type: 'node', nodeId: n.id, createdBy: n.created_by, title: n.title, description: n.description, data: {} };
          nextTick(() => {
            const el = cy.getElementById('n' + n.id);
            if (el.length) { clearHighlight(); highlightNode(el); }
          });
        }
      } else if (entry.type === 'edge') {
        const e = (p.edges || []).find(ed => ed.id === entry.edgeId);
        if (e) {
          const pending = e.to_node_ids.length === 0;
          selected.value = { type: 'edge', edgeId: e.id, pending, failureCount: e.failure_count, title: e.title, description: e.direction_description, data: {} };
          nextTick(() => {
            if (e.from_node_ids.length > 0 && e.to_node_ids.length > 0) {
              const edgeEl = cy.getElementById('e' + e.id + '_' + e.from_node_ids[0] + '_' + e.to_node_ids[0]);
              if (edgeEl.length) { clearHighlight(); highlightEdge(edgeEl); }
            }
          });
        }
      }
    }

    // ---- Lifecycle ----

    onMounted(() => {
      fetchProject();
      fetchLatestReport();
      timer = setInterval(() => {
        fetchProject();
        if (reportGenerating.value) {
          fetchLatestReport();
        }
      }, 2000);
    });
    onBeforeUnmount(() => {
      clearInterval(timer);
      if (cy) { cy.destroy(); cy = null; eventsReady = false; }
    });

    return {
      project, loading, error, selected, showPushModal, pushNodes, panelWidth, layoutKey, panelTab, LAYOUT_NAMES, graphReady,
      latestReport, reportGenerating,
      edgeTimings, edgeTimingsDone, timeline, timelineMax,
      stopProject, confirmPush, addNode, statusInfo, zoomIn, zoomOut, zoomFit, trunc, formatTime, formatDuration, evidenceNodesDesc, buildLog, selectLogEntry,
      startPanelResize, setLayout, toggleTheme, generateReport,
    };
  },

  template: `
    <div style="display:flex;flex-direction:column;height:100vh;padding:0.75rem 1rem;gap:0.5rem">
      <div class="flex items-center justify-between shrink-0">
      <a href="/" class="back-link">&larr; 返回</a>
      <div v-if="project" class="flex items-center gap-2">
        <template v-if="project.status === 'completed'">
          <div class="report-actions">
            <button
              v-if="!reportGenerating && (!latestReport || latestReport.status === 'completed' || latestReport.status === 'failed')"
              class="btn btn-report"
              @click="generateReport"
            >
              <span class="report-icon">📄</span> 生成报告
            </button>
            <button
              v-else-if="reportGenerating"
              class="btn btn-report-generating"
              disabled
            >
              <span class="spinner"></span> 生成中...
            </button>
            <a
              v-if="latestReport && latestReport.status === 'completed'"
              :href="'/reports/' + latestReport.id + '/download'"
              class="btn btn-report-download"
              target="_blank"
            >
              ↓ 下载
            </a>
            <span v-if="latestReport && latestReport.status === 'failed'" class="report-error" title="上次生成失败">
              ✕ 失败
            </span>
          </div>
        </template>
        <button class="theme-toggle" @click="toggleTheme" title="切换主题">◐</button>
        <span :class="'badge ' + statusInfo(project).cls">{{ statusInfo(project).label }}</span>
        <button v-if="project.status === 'active'" class="btn btn-warning btn-sm" @click="stopProject">暂停</button>
        <button v-if="project.status !== 'active'" class="btn btn-primary btn-sm" @click="showPushModal = true">推进</button>
      </div>
    </div>

    <div v-if="loading" class="empty-state flex-1"><span class="spinner"></span> 加载中...</div>
    <div v-else-if="error" class="empty-state flex-1" style="color:var(--danger)">{{ error }}</div>

    <template v-else-if="project">
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
          <div class="panel-tabs">
            <button class="panel-tab" :class="{ active: panelTab === 'detail' }" @click="panelTab = 'detail'">详情</button>
            <button class="panel-tab" :class="{ active: panelTab === 'log' }" @click="panelTab = 'log'">日志</button>
            <button class="panel-tab" :class="{ active: panelTab === 'timing' }" @click="panelTab = 'timing'">耗时</button>
          </div>

          <template v-if="panelTab === 'detail'">
          <template v-if="selected">
            <template v-if="selected.type === 'ghost'">
              <div class="detail-title">探索点</div>
              <div class="detail-field">
                <div class="detail-label">编号</div>
                <div class="detail-value">Edge {{ selected.edgeId }}</div>
              </div>
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
              <div class="detail-title" style="color:var(--primary)">收束</div>
              <div class="detail-field" v-if="selected.summary">
                <div class="detail-label">总结</div>
                <div class="detail-value">{{ selected.summary }}</div>
              </div>
              <div class="detail-field" v-if="selected.evidenceIds.length">
                <div class="detail-label">支撑节点</div>
                <div class="detail-value">
                  <div v-for="ev in evidenceNodesDesc(selected.evidenceIds)" :key="ev.id" style="margin-bottom:3px;display:flex;align-items:center;gap:0.35rem">
                    <span style="flex-shrink:0;font-size:0.7rem;font-weight:600;color:var(--primary);border:1px solid var(--primary);border-radius:3px;padding:0px 4px">Node {{ ev.id }}</span>
                    <span style="font-size:0.75rem;color:var(--text)">{{ ev.title }}</span>
                  </div>
                </div>
              </div>
              <div class="detail-field" v-else>
                <div class="detail-value" style="color:var(--text-dim)">所有探索任务已完成。</div>
              </div>
            </template>

            <template v-else-if="selected.type === 'node'">
              <div class="detail-title">{{ selected.title || '节点' }}</div>
              <div class="detail-field">
                <div class="detail-label">编号</div>
                <div class="detail-value">Node {{ selected.nodeId }}</div>
              </div>
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
              <div class="detail-title">{{ selected.title || '探索方向' }}</div>
              <div class="detail-field">
                <div class="detail-label">编号</div>
                <div class="detail-value">Edge {{ selected.edgeId }}</div>
              </div>
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
                <div class="detail-label">描述</div>
                <div class="detail-value">{{ selected.description }}</div>
              </div>
            </template>
          </template>
          <div v-else class="detail-panel-empty">
            点击节点或边<br>查看详细信息
          </div>
          </template>

          <template v-else-if="panelTab === 'log'">
          <div class="log-list" v-if="buildLog().length">
            <div v-for="entry in buildLog()" :key="entry.type + '_' + (entry.nodeId || entry.edgeId) + '_' + entry.time" class="log-entry" @click="selectLogEntry(entry)">
              <div class="log-dot" :style="{ background: entry.type === 'complete' ? 'var(--primary)' : entry.type === 'node' ? (entry.isTimeout ? 'var(--danger)' : entry.createdBy === 'human' ? '#4F46E5' : entry.createdBy === 'agent' ? '#0D9488' : '#78716C') : entry.outcome === 'success' ? 'var(--success)' : entry.outcome === 'failed' ? 'var(--danger)' : entry.status === 'running' ? 'var(--primary)' : 'var(--text-dim)' }"></div>
              <div class="log-content">
                <div class="log-header">
                  <span class="log-title">{{ entry.title }}</span>
                  <span v-if="entry.type === 'node'" style="flex-shrink:0;font-size:0.65rem;font-weight:600;color:var(--text-dim);border:1px solid var(--border);border-radius:3px;padding:0px 3px">Node {{ entry.nodeId }}</span>
                  <span v-else-if="entry.type === 'edge'" style="flex-shrink:0;font-size:0.65rem;font-weight:600;color:var(--text-dim);border:1px solid var(--border);border-radius:3px;padding:0px 3px">Edge {{ entry.edgeId }}</span>
                  <span v-if="entry.type === 'complete'" class="log-tag" :style="{ background: 'rgba(60,93,255,0.12)', color: 'var(--primary)' }">结束</span>
                  <span v-else-if="entry.type === 'node'" class="log-tag" :style="{ background: entry.isTimeout ? 'rgba(239,68,68,0.12)' : entry.createdBy === 'human' ? 'rgba(79,70,229,0.12)' : entry.createdBy === 'agent' ? 'rgba(13,148,136,0.12)' : 'rgba(120,113,108,0.12)', color: entry.isTimeout ? 'var(--danger)' : entry.createdBy === 'human' ? '#4F46E5' : entry.createdBy === 'agent' ? '#0D9488' : '#78716C' }">{{ entry.isTimeout ? '超时' : entry.createdBy }}</span>
                  <span v-else class="log-tag" :style="{ background: entry.outcome === 'success' ? 'rgba(34,197,94,0.12)' : entry.outcome === 'failed' ? 'rgba(239,68,68,0.12)' : entry.status === 'running' ? 'rgba(60,93,255,0.12)' : 'rgba(148,163,184,0.12)', color: entry.outcome === 'success' ? 'var(--success)' : entry.outcome === 'failed' ? 'var(--danger)' : entry.status === 'running' ? 'var(--primary)' : 'var(--text-dim)' }">{{ entry.outcome === 'success' ? '成功' : entry.outcome === 'failed' ? '失败' : entry.status === 'running' ? '执行中' : '新方向' }}</span>
                  <span v-if="entry.duration > 0" class="log-duration">{{ formatDuration(entry.duration) }}</span>
                </div>
                <div class="log-desc" v-if="entry.type === 'complete' && entry.summary">{{ entry.summary }}</div>
                <div class="log-desc" v-else-if="entry.type !== 'complete'">{{ entry.description }}</div>
                <div v-if="entry.fromDesc" class="log-desc" style="font-size:0.7rem;opacity:0.6">来自: {{ entry.fromDesc }}</div>
                <div v-if="entry.failureCount > 0" class="log-desc" style="color:var(--danger);font-size:0.7rem">失败 {{ entry.failureCount }} 次</div>
                <div class="log-time">{{ formatTime(entry.time) }}</div>
              </div>
            </div>
          </div>
          <div v-else class="detail-panel-empty">暂无日志</div>
          </template>

          <template v-if="panelTab === 'timing'">
            <template v-if="timeline.length">
              <div class="tl-header">
                <span class="tl-header-item">项目 <b>{{ formatDuration(project.updated_at && project.created_at ? new Date(project.updated_at) - new Date(project.created_at) : 0) }}</b></span>
                <span class="tl-header-item">Plan <b>{{ project.plan_round || 0 }} 轮</b></span>
                <span class="tl-header-item">完成 <b>{{ edgeTimingsDone }}/{{ edgeTimings.length }}</b></span>
              </div>
              <div class="tl-ruler">
                <span>0</span>
                <span>{{ formatDuration(timelineMax / 2) }}</span>
                <span>{{ formatDuration(timelineMax) }}</span>
              </div>
              <div class="tl-list">
                <div v-for="(item, idx) in timeline" :key="item.type + '_' + (item.id || item.round) + '_' + idx" class="tl-row">
                  <div class="tl-label">
                    <span v-if="item.type === 'plan'" class="tl-tag tl-tag-plan">Plan</span>
                    <span v-else class="tl-tag tl-tag-act">Act</span>
                    <span class="tl-name">{{ item.type === 'plan' ? '第 ' + item.round + ' 轮' : 'Edge ' + item.id }}</span>
                  </div>
                  <div class="tl-bar-track">
                    <div class="tl-bar-spacer" :style="{ flex: item.startMs }"></div>
                    <div :class="['tl-bar', item.type === 'plan' ? 'tl-bar-plan' : (item.status === 'done' ? 'tl-bar-act-done' : 'tl-bar-act-running')]" :style="{ flex: Math.max(item.durationMs, timelineMax * 0.005) }"></div>
                    <div class="tl-bar-spacer" :style="{ flex: Math.max(timelineMax - item.startMs - item.durationMs, 0) }"></div>
                  </div>
                  <div class="tl-time">{{ formatDuration(item.durationMs) || '<1s' }}</div>
                </div>
              </div>
              <div class="tl-legend">
                <span class="tl-legend-item"><span class="tl-legend-dot tl-bar-plan"></span>Plan</span>
                <span class="tl-legend-item"><span class="tl-legend-dot tl-bar-act-done"></span>已完成</span>
                <span class="tl-legend-item"><span class="tl-legend-dot tl-bar-act-running"></span>进行中</span>
              </div>
            </template>
            <div v-else class="timing-empty">暂无耗时数据</div>
          </template>
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
