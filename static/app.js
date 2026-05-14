const STATUS = {
  active:  { cls: 'bg-emerald-900/50 text-emerald-400 border-emerald-800', label: '活跃' },
  completed: { cls: 'bg-blue-900/50 text-blue-400 border-blue-800',    label: '完成' },
  failed:   { cls: 'bg-red-900/50 text-red-400 border-red-800',        label: '失败' },
  stopped:  { cls: 'bg-gray-800 text-gray-400 border-gray-700',        label: '已暂停' },
};

const { createApp } = Vue;

createApp({
  data() {
    return {
      projects: [],
      loading: true,
      error: '',
      showModal: false,
      form: { title: '', agent_type: 'mock' },
      submitting: false,
      agents: [],
    };
  },

  async mounted() {
    await this.fetchMode();
    this.fetchProjects();
    this._timer = setInterval(() => this.fetchProjects(), 2000);
  },

  beforeUnmount() {
    clearInterval(this._timer);
  },

  methods: {
    async fetchMode() {
      try {
        const r = await fetch('/mode');
        const { docker } = await r.json();
        this.agents = docker
          ? [{ value: 'opencode', label: 'OpenCode' }, { value: 'mock', label: 'Mock（测试）' }]
          : [{ value: 'mock', label: 'Mock（测试）' }];
        this.form.agent_type = this.agents[0].value;
      } catch {}
    },

    async fetchProjects() {
      try {
        const r = await fetch('/projects');
        if (!r.ok) throw new Error(r.status);
        this.projects = await r.json();
        this.error = '';
      } catch (e) {
        this.error = '无法加载项目列表';
      } finally {
        this.loading = false;
      }
    },

    async createProject() {
      if (!this.form.title.trim()) return;
      this.submitting = true;
      try {
        const r = await fetch('/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: this.form.title, agent_type: this.form.agent_type }),
        });
        if (!r.ok) {
          const { error } = await r.json();
          throw new Error(error || r.status);
        }
        this.showModal = false;
        this.form.title = '';
        this.fetchProjects();
      } catch (e) {
        alert(`创建失败: ${e.message}`);
      } finally {
        this.submitting = false;
      }
    },

    async stopProject(id) {
      try {
        await fetch(`/projects/${id}/stop`, { method: 'POST' });
        this.fetchProjects();
      } catch (e) {
        alert(`暂停失败: ${e.message}`);
      }
    },

    async pushProject(id) {
      try {
        await fetch(`/projects/${id}/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: [] }),
        });
        this.fetchProjects();
      } catch (e) {
        alert(`推进失败: ${e.message}`);
      }
    },

    isPlanning(p) {
      return p.status === 'active' && !p.last_plan_at && p.edge_total === 0;
    },

    statusLabel(p) {
      if (this.isPlanning(p)) return '推理中';
      return (STATUS[p.status] || STATUS.active).label;
    },

    statusClass(p) {
      const base = (STATUS[p.status] || STATUS.active).cls;
      return `${base}${this.isPlanning(p) ? ' animate-pulse' : ''}`;
    },

    formatTitle(s) {
      return (s || '').length > 60 ? s.slice(0, 60) + '...' : s;
    },
  },

  template: `
  <div class="max-w-5xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-bold tracking-tight">Methodos</h1>
      <button @click="showModal = true"
        class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
        + 新建项目
      </button>
    </div>

    <!-- Create modal -->
    <Transition name="fade">
    <div v-if="showModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showModal = false">
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4">
        <h2 class="text-lg font-semibold mb-4">新建项目</h2>
        <form @submit.prevent="createProject">
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">描述</label>
              <textarea v-model="form.title" rows="2" required
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
                placeholder="帮我拿到 flag。https://hackme.com"></textarea>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Agent 类型</label>
              <select v-model="form.agent_type" required
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                <option v-for="a in agents" :key="a.value" :value="a.value">{{ a.label }}</option>
              </select>
            </div>
          </div>
          <div class="flex justify-end gap-3 mt-6">
            <button type="button" @click="showModal = false"
              class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">取消</button>
            <button type="submit" :disabled="submitting"
              class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              {{ submitting ? '创建中...' : '创建' }}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Transition>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-gray-500 py-12">
      <div class="inline-block w-5 h-5 border-2 border-gray-600 border-t-emerald-400 rounded-full animate-spin mr-2 align-middle"></div>
      加载中...
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center text-red-400 py-12">{{ error }}</div>

    <!-- Project list -->
    <div v-else class="space-y-3">
      <div v-if="projects.length === 0" class="text-center text-gray-500 py-12">暂无项目，点击上方按钮创建</div>

      <div v-for="p in projects" :key="p.id"
        class="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <a :href="'/project.html?id=' + p.id" class="text-base font-medium hover:text-emerald-400 truncate block">
              {{ formatTitle(p.title) }}
            </a>
            <div class="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-500">
              <span :class="'px-2 py-0.5 rounded-full text-xs border ' + statusClass(p)">{{ statusLabel(p) }}</span>
              <span>Nodes: {{ p.node_count }}</span>
              <span>Edges: {{ p.edge_total }}</span>
              <span v-if="p.edge_unresulted > 0" class="text-amber-400">待处理: {{ p.edge_unresulted }}</span>
              <span v-if="p.edge_inflight > 0" class="text-blue-400">执行中: {{ p.edge_inflight }}</span>
            </div>
          </div>
          <div class="flex gap-2 ml-4 shrink-0">
            <button v-if="p.status === 'active'" @click="stopProject(p.id)"
              class="px-3 py-1.5 text-xs rounded-lg bg-amber-900/50 text-amber-400 hover:bg-amber-900 border border-amber-800 transition-colors">
              暂停
            </button>
            <button v-if="p.status !== 'active'" @click="pushProject(p.id)"
              class="px-3 py-1.5 text-xs rounded-lg bg-blue-900/50 text-blue-400 hover:bg-blue-900 border border-blue-800 transition-colors">
              推进
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
}).mount('#app');
