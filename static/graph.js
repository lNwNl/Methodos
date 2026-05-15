const params = new URLSearchParams(window.location.search);
const projectId = params.get('id');

const NODE_COLORS = { human: '#3C5DFF', agent: '#22C55E', system: '#EF4444' };

const { createApp, ref, reactive, onMounted, onBeforeUnmount, nextTick } = Vue;

createApp({
  setup() {
    const project = ref(null);
    const loading = ref(true);
    const error = ref('');
    const selected = ref(null);
    const showPushModal = ref(false);
    const pushNodes = ref([{ description: '' }]);
    let cy = null;
    let timer = null;

    function statusInfo(p) {
      if (p.status === 'active' && !p.last_plan_at && p.edges.length === 0) {
        return { cls: 'badge-planning', label: '推理中' };
      }
      const m = {
        active:    { cls: 'badge-active',    label: '活跃' },
        completed: { cls: 'badge-completed', label: '完成' },
        failed:    { cls: 'badge-failed',    label: '失败' },
        stopped:   { cls: 'badge-stopped',   label: '暂停' },
      };
      return m[p.status] || m.active;
    }

    async function fetchProject() {
      try {
        const r = await fetch(`/projects/${projectId}`);
        if (!r.ok) throw new Error(String(r.status));
        project.value = await r.json();
        error.value = '';
        await nextTick();
        renderGraph();
      } catch (e) {
        error.value = `无法加载: ${e.message}`;
      } finally {
        loading.value = false;
      }
    }

    function renderGraph() {
      const p = project.value;
      if (!p) return;
      const container = document.getElementById('graph');
      if (!container) return;

      const elements = [];
      const isCompleted = p.status === 'completed';
      const existingNodeIds = new Set(p.nodes.map(n => n.id));

      // Real nodes
      for (const n of p.nodes) {
        elements.push({
          data: { id: `n${n.id}`, label: trunc(n.description, 55), description: n.description, createdBy: n.created_by, nodeId: n.id },
        });
      }

      // Edges
      for (const e of p.edges) {
        const ok = e.to_node_ids.length > 0;
        const running = !ok && e.claimed_at !== null;

        for (const f of e.from_node_ids) {
          if (ok) {
            for (const t of e.to_node_ids) {
              elements.push({
                data: { id: `e${e.id}_${f}_${t}`, source: `n${f}`, target: `n${t}`, label: trunc(e.direction_description, 35), description: e.direction_description, edgeId: e.id, failureCount: e.failure_count },
                classes: 'resulted',
              });
            }
          } else {
            const ghostId = `ghost_e${e.id}_${f}`;
            elements.push({
              data: { id: ghostId, label: '', ghost: true, edgeId: e.id, running },
              classes: running ? 'ghost-running' : 'ghost',
            });
            elements.push({
              data: { id: `e${e.id}_${f}_pending`, source: `n${f}`, target: ghostId, label: trunc(e.direction_description, 35), description: e.direction_description, edgeId: e.id, pending: true, running },
              classes: running ? 'edge-running' : 'pending',
            });
          }
        }
      }

      // Synthetic COMPLETE node + conclusion edges from evidence nodes
      if (isCompleted) {
        const evidenceIds = (p.evidence_node_ids || []).filter(id => existingNodeIds.has(id));

        elements.push({
          data: { id: 'complete_node', label: '✓ 探索完成', complete: true, summary: p.summary, evidenceIds },
          classes: 'complete-node',
        });

        for (const nid of evidenceIds) {
          elements.push({
            data: { id: `conc_${nid}`, source: `n${nid}`, target: 'complete_node', label: '', conclusion: true },
            classes: 'conclusion',
          });
        }
      }

      if (cy) cy.destroy();

      cy = cytoscape({
        container,
        elements,
        style: [
          { selector: 'node', style: { 'label': 'data(label)', 'background-color': '#3A3E52', 'border-width': 1.5, 'border-color': '#2A2D3E', 'font-size': '10px', 'text-wrap': 'wrap', 'text-max-width': '160px', 'text-valign': 'center', 'text-halign': 'center', 'color': '#CBD5E1', 'padding': '8px', 'shape': 'round-rectangle', 'font-family': 'Inter, sans-serif' } },
          { selector: 'node[createdBy="human"]',  style: { 'background-color': NODE_COLORS.human, 'border-color': '#3C5DFF' } },
          { selector: 'node[createdBy="agent"]',  style: { 'background-color': NODE_COLORS.agent, 'border-color': '#22C55E' } },
          { selector: 'node[createdBy="system"]', style: { 'background-color': NODE_COLORS.system, 'border-color': '#EF4444' } },
          { selector: '.resulted', style: { 'width': 1.5, 'line-color': '#4A4E62', 'target-arrow-color': '#4A4E62', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '8px', 'color': '#64748B', 'text-rotation': 'autorotate', 'font-family': 'Inter, sans-serif' } },
          { selector: '.pending', style: { 'width': 1.2, 'line-color': '#3A3E52', 'line-style': 'dashed', 'curve-style': 'bezier', 'font-size': '8px', 'color': '#64748B', 'font-family': 'Inter, sans-serif' } },
          { selector: '.edge-running', style: { 'width': 1.5, 'line-color': '#3C5DFF', 'line-style': 'dashed', 'target-arrow-color': '#3C5DFF', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '8px', 'color': '#3C5DFF', 'font-family': 'Inter, sans-serif' } },
          { selector: '.conclusion', style: { 'width': 2.5, 'line-color': '#3C5DFF', 'target-arrow-color': '#3C5DFF', 'target-arrow-shape': 'triangle', 'curve-style': 'straight', 'line-style': 'solid' } },
          { selector: '.ghost', style: { 'width': 8, 'height': 8, 'background-color': 'transparent', 'border-width': 1.5, 'border-color': '#3A3E52', 'border-style': 'dashed', 'border-opacity': 0.35 } },
          { selector: '.ghost-running', style: { 'width': 9, 'height': 9, 'background-color': '#3C5DFF', 'background-opacity': 0.15, 'border-width': 1.5, 'border-color': '#3C5DFF', 'border-style': 'dashed', 'border-opacity': 0.5 } },
          { selector: '.complete-node', style: { 'shape': 'round-rectangle', 'background-color': '#3C5DFF', 'border-width': 1.5, 'border-color': '#3C5DFF', 'font-size': '10px', 'font-weight': '600', 'color': '#FFFFFF', 'text-wrap': 'wrap', 'text-max-width': '160px', 'text-valign': 'center', 'text-halign': 'center', 'padding': '8px', 'font-family': 'Inter, sans-serif' } },
          { selector: '.evidence', style: { 'border-color': '#F59E0B', 'border-width': 2.5 } },
        ],
        layout: { name: 'dagre', rankDir: 'TB', spacingFactor: 1.4, nodeDimensionsIncludeLabels: true },
      });

      for (const id of (p.evidence_node_ids || [])) {
        const n = cy.getElementById(`n${id}`);
        if (n.length) n.addClass('evidence');
      }

      // Tap: node
      cy.on('tap', 'node', e => {
        const d = e.target.data();
        if (d.ghost) {
          const status = d.running ? '执行中' : '待执行';
          selected.value = { type: 'ghost', edgeId: d.edgeId, status };
        } else if (d.complete) {
          selected.value = { type: 'complete', summary: d.summary, evidenceIds: d.evidenceIds || [] };
        } else {
          selected.value = { type: 'node', nodeId: d.nodeId, createdBy: d.createdBy, description: d.description, data: d };
        }
      });

      // Tap: edge
      cy.on('tap', 'edge', e => {
        const d = e.target.data();
        if (d.conclusion) {
          selected.value = { type: 'conclusion', source: d.source };
        } else if (d.pending || d.running) {
          selected.value = { type: 'edge', edgeId: d.edgeId, pending: true, running: d.running, description: d.description, data: d };
        } else if (d.edgeId) {
          selected.value = { type: 'edge', edgeId: d.edgeId, failureCount: d.failureCount, description: d.description, data: d };
        }
      });
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
        return node ? { id, desc: trunc(node.description, 40) } : { id, desc: '' };
      });
    }

    function zoomIn()  { if (cy) cy.zoom(cy.zoom() * 1.2); }
    function zoomOut() { if (cy) cy.zoom(cy.zoom() / 1.2); }
    function zoomFit() { if (cy) cy.fit(undefined, 50); }

    async function stopProject() {
      try { await fetch(`/projects/${projectId}/stop`, { method: 'POST' }); fetchProject(); } catch {}
    }

    async function confirmPush() {
      const nodes = pushNodes.value.filter(n => n.description.trim()).map(n => ({ description: n.description.trim() }));
      try {
        await fetch(`/projects/${projectId}/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes }) });
        showPushModal.value = false;
        pushNodes.value = [{ description: '' }];
        fetchProject();
      } catch {}
    }

    function addNode() { pushNodes.value.push({ description: '' }); }

    onMounted(() => { fetchProject(); timer = setInterval(fetchProject, 2000); });
    onBeforeUnmount(() => { clearInterval(timer); if (cy) cy.destroy(); });

    return {
      project, loading, error, selected, showPushModal, pushNodes,
      stopProject, confirmPush, addNode, statusInfo, zoomIn, zoomOut, zoomFit, trunc, evidenceNodesDesc,
    };
  },

  template: `
  <div style="display:flex;flex-direction:column;height:100vh;padding:0.75rem 1rem;gap:0.5rem">
    <!-- Top bar -->
    <div class="flex items-center justify-between shrink-0">
      <a href="/" class="back-link">&larr; 返回</a>
      <div v-if="project" class="flex items-center gap-2">
        <span :class="'badge ' + statusInfo(project).cls">{{ statusInfo(project).label }}</span>
        <button v-if="project.status === 'active'" class="btn btn-warning btn-sm" @click="stopProject">暂停</button>
        <button v-if="project.status !== 'active'" class="btn btn-primary btn-sm" @click="showPushModal = true">推进</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="empty-state flex-1"><span class="spinner"></span> 加载中...</div>

    <!-- Error -->
    <div v-else-if="error" class="empty-state flex-1" style="color:var(--danger)">{{ error }}</div>

    <!-- Content -->
    <template v-else-if="project">
      <div v-if="project.status === 'completed' && project.summary" class="summary-bar">
        <span class="badge badge-completed" style="margin-right:0.5rem">完成</span>
        {{ project.summary }}
      </div>

      <div class="flex gap-2 flex-1 min-h-0" style="flex:1;min-height:0">
        <!-- Graph -->
        <div class="graph-container flex-1" style="flex:1;min-width:0">
          <div class="graph-toolbar">
            <button class="btn" @click="zoomOut" title="缩小">−</button>
            <button class="btn" @click="zoomIn"  title="放大">+</button>
            <button class="btn" @click="zoomFit" title="适配屏幕">⊡</button>
          </div>
          <div id="graph" class="w-full h-full"></div>
        </div>

        <!-- Side panel -->
        <div class="detail-panel" style="width:320px">
          <template v-if="selected">

            <!-- Ghost placeholder -->
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

            <!-- Complete node -->
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

            <!-- Real node -->
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

            <!-- Conclusion edge -->
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

            <!-- Edge -->
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

    <!-- Push modal -->
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
