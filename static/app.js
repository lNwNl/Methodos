const { createApp, ref, onMounted, onBeforeUnmount, computed } = Vue;

createApp({
  setup() {
    const projects = ref([]);
    const loading = ref(true);
    const error = ref('');
    const showModal = ref(false);
    const form = ref({ title: '', agent_type: 'mock' });
    const submitting = ref(false);
    const agents = ref([{ value: 'mock', label: 'Mock（测试）' }]);
    let timer = null;

    function currentTheme() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }

    function toggleTheme() {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('methodos-theme', next);
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: next } }));
    }

    async function fetchMode() {
      try {
        const r = await fetch('/mode');
        const { docker } = await r.json();
        agents.value = docker
          ? [{ value: 'opencode', label: 'OpenCode' }, { value: 'mock', label: 'Mock（测试）' }]
          : [{ value: 'mock', label: 'Mock（测试）' }];
        form.value.agent_type = agents.value[0].value;
      } catch {}
    }

    async function fetchProjects() {
      try {
        const r = await fetch('/projects');
        if (!r.ok) throw new Error(String(r.status));
        projects.value = await r.json();
        error.value = '';
      } catch (e) {
        error.value = `无法加载: ${e.message}`;
      } finally {
        loading.value = false;
      }
    }

    async function createProject() {
      const t = form.value.title.trim();
      if (!t) return;
      submitting.value = true;
      try {
        const r = await fetch('/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: t, agent_type: form.value.agent_type }),
        });
        if (!r.ok) {
          const b = await r.json();
          throw new Error(b.error || String(r.status));
        }
        showModal.value = false;
        form.value.title = '';
        fetchProjects();
      } catch (e) {
        alert(`创建失败: ${e.message}`);
      } finally {
        submitting.value = false;
      }
    }

    async function stopProject(id) {
      try {
        await fetch(`/projects/${id}/stop`, { method: 'POST' });
        fetchProjects();
      } catch (e) {
        alert(`操作失败: ${e.message}`);
      }
    }

    async function pushProject(id) {
      try {
        await fetch(`/projects/${id}/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: [] }),
        });
        fetchProjects();
      } catch (e) {
        alert(`操作失败: ${e.message}`);
      }
    }

    function statusInfo(p) {
      if (p.status === 'active' && !p.last_plan_at && p.edge_total === 0) {
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

    onMounted(() => {
      fetchMode().then(fetchProjects);
      timer = setInterval(fetchProjects, 2000);
    });
    onBeforeUnmount(() => clearInterval(timer));

    return {
      projects, loading, error, showModal, form, submitting, agents,
      createProject, stopProject, pushProject, statusInfo, toggleTheme,
    };
  },

  template: `
  <div class="app-shell">
    <div class="app-header">
      <div class="app-header-left">
        <h1><span>M</span>ETHODOS</h1>
        <p>渗透测试自动化</p>
      </div>
      <div class="app-header-right">
        <button class="theme-toggle" @click="toggleTheme" title="切换主题">◐</button>
        <button class="btn btn-primary" @click="showModal = true">+ 新建项目</button>
      </div>
    </div>

    <Transition name="fade">
    <div v-if="showModal" class="modal-backdrop" @click.self="showModal = false">
      <div class="modal-panel">
        <h2 class="modal-title">新建项目</h2>
        <form @submit.prevent="createProject">
          <div class="form-group">
            <label class="form-label">描述</label>
            <textarea v-model="form.title" class="textarea" rows="2" placeholder="帮我拿到 flag。https://hackme.com"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Agent 类型</label>
            <select v-model="form.agent_type" class="select">
              <option v-for="a in agents" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="btn" @click="showModal = false">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting">{{ submitting ? '创建中...' : '创建' }}</button>
          </div>
        </form>
      </div>
    </div>
    </Transition>

    <div v-if="loading" class="empty-state"><span class="spinner"></span> 加载中...</div>
    <div v-else-if="error" class="empty-state" style="color:var(--danger)">{{ error }}</div>

    <div v-else-if="projects.length === 0" class="empty-state">
      <span>暂无项目</span>
      <button class="btn btn-primary" @click="showModal = true">+ 新建项目</button>
    </div>

    <div v-else class="flex flex-col gap-1">
      <div v-for="p in projects" :key="p.id" class="card">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <a :href="'/project.html?id=' + p.id" class="truncate" style="font-size:0.92rem;font-weight:500;color:var(--text-bright);text-decoration:none;display:block">
              {{ p.title.length > 80 ? p.title.slice(0,80)+'...' : p.title }}
            </a>
            <div class="stats-row">
              <span :class="'badge ' + statusInfo(p).cls">{{ statusInfo(p).label }}</span>
              <span class="stat">Nodes <span class="stat-val">{{ p.node_count }}</span></span>
              <span class="stat">Edges <span class="stat-val">{{ p.edge_total }}</span></span>
              <span v-if="p.edge_unresulted > 0" class="stat" style="color:var(--warning)">待处理 <span class="stat-val" style="color:var(--warning)">{{ p.edge_unresulted }}</span></span>
              <span v-if="p.edge_inflight > 0" class="stat" style="color:var(--primary)">执行中 <span class="stat-val" style="color:var(--primary)">{{ p.edge_inflight }}</span></span>
            </div>
          </div>
          <div class="flex gap-1 shrink-0" style="margin-left:0.75rem">
            <button v-if="p.status === 'active'" class="btn btn-warning btn-sm" @click="stopProject(p.id)">暂停</button>
            <button v-if="p.status !== 'active'" class="btn btn-primary btn-sm" @click="pushProject(p.id)">推进</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
}).mount('#app');
