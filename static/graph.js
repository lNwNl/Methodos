const params = new URLSearchParams(window.location.search);
const projectId = params.get('id');

const NODE_COLORS = { human: '#3b82f6', agent: '#10b981', system: '#ef4444' };
const STATUS_MAP = {
  active:    { cls: 'bg-emerald-900/50 text-emerald-400 border-emerald-800', label: '活跃' },
  completed: { cls: 'bg-blue-900/50 text-blue-400 border-blue-800',    label: '完成' },
  failed:    { cls: 'bg-red-900/50 text-red-400 border-red-800',        label: '失败' },
  stopped:   { cls: 'bg-gray-800 text-gray-400 border-gray-700',        label: '已暂停' },
};

const { createApp, ref, onMounted, onBeforeUnmount, nextTick } = Vue;

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

    async function fetchProject() {
      try {
        const r = await fetch(`/projects/${projectId}`);
        if (!r.ok) throw new Error(r.status);
        project.value = await r.json();
        error.value = '';
        await nextTick();
        renderGraph();
      } catch (e) {
        error.value = `无法加载项目: ${e.message}`;
      } finally {
        loading.value = false;
      }
    }

    function renderGraph() {
      const data = project.value;
      if (!data) return;
      const container = document.getElementById('graph');
      if (!container) return;

      const elements = [];

      for (const node of data.nodes) {
        elements.push({
          data: {
            id: `n${node.id}`,
            label: truncate(node.description, 60),
            createdBy: node.created_by,
            nodeId: node.id,
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

      if (cy) cy.destroy();

      cy = cytoscape({
        container,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'label': 'data(label)',
              'background-color': '#6b7280',
              'border-width': 2,
              'border-color': '#1f2937',
              'font-size': '11px',
              'text-wrap': 'wrap',
              'text-max-width': '180px',
              'text-valign': 'center',
              'text-halign': 'center',
              'color': '#d1d5db',
              'padding': '10px',
              'shape': 'round-rectangle',
            },
          },
          { selector: 'node[createdBy="human"]',  style: { 'background-color': NODE_COLORS.human } },
          { selector: 'node[createdBy="agent"]',  style: { 'background-color': NODE_COLORS.agent } },
          { selector: 'node[createdBy="system"]', style: { 'background-color': NODE_COLORS.system } },
          {
            selector: '.resulted',
            style: { 'width': 2, 'line-color': '#4b5563', 'target-arrow-color': '#4b5563', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'font-size': '9px', 'color': '#6b7280', 'text-rotation': 'autorotate' },
          },
          {
            selector: '.pending',
            style: { 'width': 1.5, 'line-color': '#6b7280', 'line-style': 'dashed', 'curve-style': 'bezier', 'font-size': '9px', 'color': '#6b7280' },
          },
          { selector: '.evidence', style: { 'border-color': '#fbbf24', 'border-width': 3 } },
        ],
        layout: { name: 'dagre', rankDir: 'TB', spacingFactor: 1.5, nodeDimensionsIncludeLabels: true },
      });

      const evidenceIds = data.evidence_node_ids || [];
      for (const id of evidenceIds) {
        const node = cy.getElementById(`n${id}`);
        if (node.length) node.addClass('evidence');
      }

      cy.on('tap', 'node', (evt) => {
        const d = evt.target.data();
        selected.value = { type: 'node', data: d };
      });
      cy.on('tap', 'edge', (evt) => {
        const d = evt.target.data();
        selected.value = { type: 'edge', data: d };
      });
    }

    function truncate(text, max) {
      if (!text) return '';
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    async function stopProject() {
      try {
        await fetch(`/projects/${projectId}/stop`, { method: 'POST' });
        fetchProject();
      } catch {}
    }

    async function confirmPush() {
      const nodes = pushNodes.value.filter(n => n.description.trim()).map(n => ({ description: n.description.trim() }));
      try {
        await fetch(`/projects/${projectId}/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes }),
        });
        showPushModal.value = false;
        pushNodes.value = [{ description: '' }];
        fetchProject();
      } catch {}
    }

    function addPushNode() {
      pushNodes.value.push({ description: '' });
    }

    onMounted(() => {
      fetchProject();
      timer = setInterval(fetchProject, 2000);
    });

    onBeforeUnmount(() => {
      clearInterval(timer);
      if (cy) cy.destroy();
    });

    return {
      project, loading, error, selected, showPushModal, pushNodes,
      stopProject, confirmPush, addPushNode, truncate, STATUS_MAP,
    };
  },

  template: `
  <div class="max-w-7xl mx-auto px-4 py-4">
    <!-- Header bar -->
    <div class="flex items-center justify-between mb-4">
      <a href="/" class="text-gray-400 hover:text-white text-sm">&larr; 返回</a>
      <div class="flex items-center gap-3">
        <span v-if="project" :class="'px-2.5 py-1 rounded-full text-xs font-medium border ' + ((STATUS_MAP[project.status]||STATUS_MAP.active).cls)"
          :class="{'animate-pulse': project.status === 'active' && project.edges.length === 0 && !project.last_plan_at}">
          {{ project.status === 'active' && project.edges.length === 0 && !project.last_plan_at ? '▊ Plan 推理中…' : (STATUS_MAP[project.status]||STATUS_MAP.active).label }}
        </span>
        <button v-if="project && project.status === 'active'" @click="stopProject"
          class="px-3 py-1.5 text-xs rounded-lg bg-amber-900/50 text-amber-400 hover:bg-amber-900 border border-amber-800 transition-colors">
          暂停
        </button>
        <button v-if="project && project.status !== 'active'" @click="showPushModal = true"
          class="px-3 py-1.5 text-xs rounded-lg bg-blue-900/50 text-blue-400 hover:bg-blue-900 border border-blue-800 transition-colors">
          推进
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center h-64 text-gray-500">
      <div class="inline-block w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin mr-2"></div>
      加载中...
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center justify-center h-64 text-red-400">{{ error }}</div>

    <template v-else-if="project">
      <!-- Summary bar -->
      <div v-if="project.status === 'completed' && project.summary" class="bg-gray-900 border border-emerald-800 rounded-xl p-4 mb-4">
        <div class="flex items-start gap-3">
          <span class="text-emerald-400 font-bold text-sm shrink-0">完成</span>
          <p class="text-sm text-gray-300">{{ project.summary }}</p>
        </div>
      </div>

      <div class="flex gap-4" style="height: 70vh">
        <div class="flex-1 min-w-0 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div id="graph" style="width:100%;height:100%"></div>
        </div>

        <!-- Detail panel -->
        <div v-if="selected" class="w-80 shrink-0 bg-gray-900 border border-gray-700 rounded-xl p-4 overflow-y-auto">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-sm">{{ selected.type === 'node' ? 'Node #' + selected.data.nodeId : 'Edge #' + selected.data.edgeId }}</h3>
            <button @click="selected = null" class="text-gray-500 hover:text-white text-lg leading-none">&times;</button>
          </div>
          <div class="text-sm text-gray-400 space-y-1">
            <template v-if="selected.type === 'node'">
              <p><span class="text-gray-500">来源:</span> {{ selected.data.createdBy }}</p>
              <p class="whitespace-pre-wrap">{{ selected.data.label }}</p>
            </template>
            <template v-else>
              <p><span class="text-gray-500">状态:</span>
                <span :class="selected.data.pending ? 'text-amber-400' : 'text-gray-400'">{{ selected.data.pending ? '待执行' : '已完成' }}</span>
              </p>
              <p v-if="selected.data.failureCount > 0" class="text-red-400">失败次数: {{ selected.data.failureCount }}</p>
              <p class="whitespace-pre-wrap">{{ selected.data.label }}</p>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Push modal -->
    <Transition name="fade">
    <div v-if="showPushModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showPushModal = false">
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
        <h2 class="text-lg font-semibold mb-4">推进项目</h2>
        <form @submit.prevent="confirmPush">
          <div class="space-y-3">
            <div v-for="(n, i) in pushNodes" :key="i">
              <textarea v-model="n.description" rows="2"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none mb-2"
                placeholder="输入新的信息..."></textarea>
            </div>
            <button type="button" @click="addPushNode"
              class="text-xs text-emerald-400 hover:text-emerald-300">+ 添加信息</button>
          </div>
          <div class="flex justify-end gap-3 mt-6">
            <button type="button" @click="showPushModal = false"
              class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">取消</button>
            <button type="submit"
              class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">提交</button>
          </div>
        </form>
      </div>
    </div>
    </Transition>
  </div>
  `,
}).mount('#app');
