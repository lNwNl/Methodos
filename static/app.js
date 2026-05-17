const { createApp, ref, reactive, onMounted, onBeforeUnmount, computed } = Vue;

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

    const showSettings = ref(false);
    const settingsTab = ref('general');
    const settingsLoading = ref(false);
    const settingsSaving = ref(false);
    const settings = reactive({
      actTimeoutMs: 10,
      concludeTimeoutMs: 5,
      planTimeoutMs: 10,
      claimedExpiryMs: 30,
      tickIntervalMs: 1,
      maxFailures: 3,
      maxActConcurrency: 3,
      snapshotMaxNodes: 100,
      snapshotMaxEdges: 200,
    });

    const reportSettings = reactive({
      llm_provider: 'openai',
      openai_api_key: '',
      openai_base_url: 'https://api.openai.com/v1',
      anthropic_api_key: '',
      ollama_base_url: 'http://localhost:11434',
      model_name: 'gpt-4o',
      temperature: '0.7',
    });
    const reportSettingsLoading = ref(false);
    const reportSettingsSaving = ref(false);

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

    async function fetchSettings() {
      settingsLoading.value = true;
      try {
        const r = await fetch('/settings');
        const data = await r.json();
        settings.actTimeoutMs = Math.round((parseInt(data.actTimeoutMs) || 600000) / 60000);
        settings.concludeTimeoutMs = Math.round((parseInt(data.concludeTimeoutMs) || 300000) / 60000);
        settings.planTimeoutMs = Math.round((parseInt(data.planTimeoutMs) || 600000) / 60000);
        settings.claimedExpiryMs = Math.round((parseInt(data.claimedExpiryMs) || 1800000) / 60000);
        settings.tickIntervalMs = Math.round((parseInt(data.tickIntervalMs) || 1000) / 1000);
        settings.maxFailures = parseInt(data.maxFailures) || 3;
        settings.maxActConcurrency = parseInt(data.maxActConcurrency) || 3;
        settings.snapshotMaxNodes = parseInt(data.snapshotMaxNodes) || 100;
        settings.snapshotMaxEdges = parseInt(data.snapshotMaxEdges) || 200;
      } catch (e) {
        alert(`加载设置失败: ${e.message}`);
      } finally {
        settingsLoading.value = false;
      }
    }

    async function saveSettings() {
      settingsSaving.value = true;
      try {
        const body = {
          actTimeoutMs: settings.actTimeoutMs * 60000,
          concludeTimeoutMs: settings.concludeTimeoutMs * 60000,
          planTimeoutMs: settings.planTimeoutMs * 60000,
          claimedExpiryMs: settings.claimedExpiryMs * 60000,
          tickIntervalMs: settings.tickIntervalMs * 1000,
          maxFailures: settings.maxFailures,
          maxActConcurrency: settings.maxActConcurrency,
          snapshotMaxNodes: settings.snapshotMaxNodes,
          snapshotMaxEdges: settings.snapshotMaxEdges,
        };
        const r = await fetch('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const b = await r.json();
          throw new Error(b.error || String(r.status));
        }
        showSettings.value = false;
      } catch (e) {
        alert(`保存设置失败: ${e.message}`);
      } finally {
        settingsSaving.value = false;
      }
    }

    function openSettings() {
      showSettings.value = true;
      settingsTab.value = 'general';
      fetchSettings();
      fetchReportSettings();
    }

    async function fetchReportSettings() {
      reportSettingsLoading.value = true;
      try {
        const r = await fetch('/settings/report');
        const data = await r.json();
        reportSettings.llm_provider = data['report.llm_provider'] || 'openai';
        reportSettings.openai_api_key = data['report.openai_api_key'] || '';
        reportSettings.openai_base_url = data['report.openai_base_url'] || 'https://api.openai.com/v1';
        reportSettings.anthropic_api_key = data['report.anthropic_api_key'] || '';
        reportSettings.ollama_base_url = data['report.ollama_base_url'] || 'http://localhost:11434';
        reportSettings.model_name = data['report.model_name'] || 'gpt-4o';
        reportSettings.temperature = data['report.temperature'] || '0.7';
      } catch (e) {
        console.error('Failed to load report settings:', e);
      } finally {
        reportSettingsLoading.value = false;
      }
    }

    async function saveReportSettings() {
      reportSettingsSaving.value = true;
      try {
        const body = {
          'report.llm_provider': reportSettings.llm_provider,
          'report.openai_api_key': reportSettings.openai_api_key,
          'report.openai_base_url': reportSettings.openai_base_url,
          'report.anthropic_api_key': reportSettings.anthropic_api_key,
          'report.ollama_base_url': reportSettings.ollama_base_url,
          'report.model_name': reportSettings.model_name,
          'report.temperature': reportSettings.temperature,
        };
        const r = await fetch('/settings/report', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const b = await r.json();
          throw new Error(b.error || String(r.status));
        }
        // 重新获取脱敏后的值
        await fetchReportSettings();
        showSettings.value = false;
      } catch (e) {
        alert(`保存报告配置失败: ${e.message}`);
      } finally {
        reportSettingsSaving.value = false;
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
      showSettings, settingsTab, settingsLoading, settingsSaving, settings, openSettings, saveSettings,
      reportSettings, reportSettingsLoading, reportSettingsSaving, fetchReportSettings, saveReportSettings,
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
        <button class="btn" @click="openSettings" title="设置">⚙</button>
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
            <textarea v-model="form.title" class="textarea" rows="5" placeholder="帮我拿到 flag。https://hackme.com"></textarea>
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

    <Transition name="fade">
    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <div class="modal-panel" style="max-width:520px">
        <h2 class="modal-title">设置</h2>
        <div class="settings-tabs">
          <button class="settings-tab" :class="{ active: settingsTab === 'general' }" @click="settingsTab = 'general'">通用</button>
          <button class="settings-tab" :class="{ active: settingsTab === 'report' }" @click="settingsTab = 'report'">报告</button>
        </div>

        <!-- 通用设置 -->
        <div v-if="settingsTab === 'general'">
          <div v-if="settingsLoading" class="empty-state"><span class="spinner"></span></div>
          <form v-else @submit.prevent="saveSettings">
            <div class="form-group">
              <label class="form-label">Act 超时（分钟）</label>
              <input type="number" v-model.number="settings.actTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Conclude 超时（分钟）</label>
              <input type="number" v-model.number="settings.concludeTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Plan 超时（分钟）</label>
              <input type="number" v-model.number="settings.planTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">边认领过期（分钟）</label>
              <input type="number" v-model.number="settings.claimedExpiryMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Tick 间隔（秒）</label>
              <input type="number" v-model.number="settings.tickIntervalMs" class="input" min="0.1" step="0.1">
            </div>
            <div class="form-group">
              <label class="form-label">最大失败次数</label>
              <input type="number" v-model.number="settings.maxFailures" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">最大并行 Act 数</label>
              <input type="number" v-model.number="settings.maxActConcurrency" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">快照最大节点数</label>
              <input type="number" v-model.number="settings.snapshotMaxNodes" class="input" min="10" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">快照最大边数</label>
              <input type="number" v-model.number="settings.snapshotMaxEdges" class="input" min="10" step="1">
            </div>
            <div class="form-actions">
              <button type="button" class="btn" @click="showSettings = false">取消</button>
              <button type="submit" class="btn btn-primary" :disabled="settingsSaving">{{ settingsSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>

        <!-- 报告设置 -->
        <div v-if="settingsTab === 'report'">
          <div v-if="reportSettingsLoading" class="empty-state"><span class="spinner"></span></div>
          <form v-else @submit.prevent="saveReportSettings">
            <div class="form-group">
              <label class="form-label">LLM 提供商</label>
              <select v-model="reportSettings.llm_provider" class="select">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama（本地）</option>
              </select>
            </div>

            <template v-if="reportSettings.llm_provider === 'openai'">
              <div class="form-group">
                <label class="form-label">API Key</label>
                <input type="password" v-model="reportSettings.openai_api_key" class="input" placeholder="sk-..." autocomplete="off">
              </div>
              <div class="form-group">
                <label class="form-label">Base URL</label>
                <input type="text" v-model="reportSettings.openai_base_url" class="input" placeholder="https://api.openai.com/v1">
              </div>
            </template>

            <template v-if="reportSettings.llm_provider === 'anthropic'">
              <div class="form-group">
                <label class="form-label">API Key</label>
                <input type="password" v-model="reportSettings.anthropic_api_key" class="input" placeholder="sk-ant-..." autocomplete="off">
              </div>
            </template>

            <template v-if="reportSettings.llm_provider === 'ollama'">
              <div class="form-group">
                <label class="form-label">Ollama URL</label>
                <input type="text" v-model="reportSettings.ollama_base_url" class="input" placeholder="http://localhost:11434">
              </div>
            </template>

            <div class="form-group">
              <label class="form-label">模型名称</label>
              <input type="text" v-model="reportSettings.model_name" class="input" placeholder="gpt-4o">
            </div>
            <div class="form-group">
              <label class="form-label">Temperature</label>
              <input type="number" v-model="reportSettings.temperature" class="input" min="0" max="2" step="0.1">
            </div>
            <div class="form-actions">
              <button type="button" class="btn" @click="showSettings = false">取消</button>
              <button type="submit" class="btn btn-primary" :disabled="reportSettingsSaving">{{ reportSettingsSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>
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
