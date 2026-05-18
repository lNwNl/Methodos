const { createApp, ref, reactive, onMounted, computed } = Vue;

const PROVIDERS = {
  '302.ai': '302.AI',
  'amazon-bedrock': 'Amazon Bedrock',
  'anthropic': 'Anthropic',
  'atomic-chat': 'Atomic Chat',
  'azure': 'Azure OpenAI',
  'azure-cognitive': 'Azure Cognitive Services',
  'baseten': 'Baseten',
  'cerebras': 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers': 'Cloudflare Workers AI',
  'cortecs': 'Cortecs',
  'deepseek': 'DeepSeek',
  'deep-infra': 'Deep Infra',
  'digitalocean': 'DigitalOcean',
  'elevenlabs': 'ElevenLabs',
  'fal': 'Fal',
  'fireworks': 'Fireworks AI',
  'frogbot': 'FrogBot',
  'github-copilot': 'GitHub Copilot',
  'gitlab': 'GitLab Duo',
  'google': 'Google Vertex AI',
  'groq': 'Groq',
  'helicone': 'Helicone',
  'huggingface': 'Hugging Face',
  'io-net': 'IO.NET',
  'llama.cpp': 'llama.cpp',
  'llmgateway': 'LLM Gateway',
  'lmstudio': 'LM Studio',
  'minimax': 'MiniMax',
  'moonshot': 'Moonshot AI',
  'nebius': 'Nebius Token Factory',
  'nvidia': 'NVIDIA',
  'ollama': 'Ollama',
  'ollama-cloud': 'Ollama Cloud',
  'openai': 'OpenAI',
  'opencode-zen': 'OpenCode Zen',
  'openrouter': 'OpenRouter',
  'ovhcloud': 'OVHcloud AI Endpoints',
  'replicate': 'Replicate',
  'requesty': 'Requesty',
  'samba': 'SambaNova',
  'sap-ai-core': 'SAP AI Core',
  'scaleway': 'Scaleway',
  'silicon': 'Silicon Flow',
  'stackit': 'STACKIT',
  'switchpoint': 'Switchpoint',
  'targon': 'Targon',
  'together': 'Together AI',
  'upstage': 'Upstage',
  'v0': 'V0',
  'venice': 'Venice AI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  'voyage': 'Voyage AI',
  'walmart': 'Walmart',
  'xai': 'xAI',
  'zai': 'Z.AI',
  'zenmux': 'ZenMux',
};

createApp({
  setup() {
    const engine = reactive({
      actTimeoutMs: 10,
      concludeTimeoutMs: 5,
      planTimeoutMs: 10,
      claimedExpiryMs: 30,
      tickIntervalMs: 1,
      maxFailures: 3,
      maxActConcurrency: 3,
    });

    const plan = reactive({
      planTriggerMode: 'edge_drain',
      snapshotMaxNodes: 100,
      snapshotMaxEdges: 200,
    });

    const agent = reactive({
      agentProvider: '',
      agentApiKey: '',
      agentBaseURL: '',
      agentModel: '',
    });

    const report = reactive({
      llm_provider: 'openai',
      openai_api_key: '',
      openai_base_url: 'https://api.openai.com/v1',
      anthropic_api_key: '',
      ollama_base_url: 'http://localhost:11434',
      model_name: 'gpt-4o',
      temperature: '0.7',
    });

    const engineSaving = ref(false);
    const agentSaving = ref(false);
    const reportSaving = ref(false);
    const agentLoading = ref(false);
    const reportLoading = ref(false);

    const providerOptions = computed(() =>
      Object.entries(PROVIDERS).map(([id, name]) => ({ id, name }))
    );

    const showApiKey = computed(() => {
      const p = agent.agentProvider;
      return p && p !== 'ollama' && p !== 'llama.cpp' && p !== 'lmstudio' && p !== 'atomic-chat';
    });

    const showBaseURL = computed(() => {
      const p = agent.agentProvider;
      return p && p !== 'github-copilot' && p !== 'gitlab' && p !== 'opencode-zen';
    });

    const baseURLPlaceholder = computed(() => {
      const p = agent.agentProvider;
      if (p === 'ollama' || p === 'ollama-cloud') return 'http://localhost:11434/v1';
      if (p === 'lmstudio') return 'http://127.0.0.1:1234/v1';
      if (p === 'llama.cpp') return 'http://127.0.0.1:8080/v1';
      if (p === 'atomic-chat') return 'http://127.0.0.1:1337/v1';
      return '可选';
    });

    const apiKeyLabel = computed(() => {
      const p = agent.agentProvider;
      if (p === 'amazon-bedrock') return 'AWS Bearer Token';
      if (p === 'azure' || p === 'azure-cognitive') return 'Azure API Key';
      if (p === 'github-copilot') return 'GitHub Token';
      if (p === 'gitlab') return 'GitLab Token';
      if (p === 'google') return 'Google Cloud Credentials';
      if (p === 'sap-ai-core') return 'Service Key JSON';
      return 'API Key';
    });

    function currentTheme() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }

    function toggleTheme() {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('methodos-theme', next);
    }

    async function fetchEngine() {
      try {
        const r = await fetch('/settings');
        const data = await r.json();
        engine.actTimeoutMs = Math.round((parseInt(data.actTimeoutMs) || 600000) / 60000);
        engine.concludeTimeoutMs = Math.round((parseInt(data.concludeTimeoutMs) || 300000) / 60000);
        engine.planTimeoutMs = Math.round((parseInt(data.planTimeoutMs) || 600000) / 60000);
        engine.claimedExpiryMs = Math.round((parseInt(data.claimedExpiryMs) || 1800000) / 60000);
        engine.tickIntervalMs = Math.round((parseInt(data.tickIntervalMs) || 1000) / 1000);
        engine.maxFailures = parseInt(data.maxFailures) || 3;
        engine.maxActConcurrency = parseInt(data.maxActConcurrency) || 3;
        plan.planTriggerMode = data.planTriggerMode || 'edge_drain';
        plan.snapshotMaxNodes = parseInt(data.snapshotMaxNodes) || 100;
        plan.snapshotMaxEdges = parseInt(data.snapshotMaxEdges) || 200;
      } catch (e) {
        console.error('Failed to load engine settings:', e);
      }
    }

    async function saveEngine() {
      engineSaving.value = true;
      try {
        const body = {
          actTimeoutMs: engine.actTimeoutMs * 60000,
          concludeTimeoutMs: engine.concludeTimeoutMs * 60000,
          planTimeoutMs: engine.planTimeoutMs * 60000,
          claimedExpiryMs: engine.claimedExpiryMs * 60000,
          tickIntervalMs: engine.tickIntervalMs * 1000,
          maxFailures: engine.maxFailures,
          maxActConcurrency: engine.maxActConcurrency,
          planTriggerMode: plan.planTriggerMode,
          snapshotMaxNodes: plan.snapshotMaxNodes,
          snapshotMaxEdges: plan.snapshotMaxEdges,
        };
        const r = await fetch('/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error || String(r.status));
      } catch (e) {
        alert(`保存失败: ${e.message}`);
      } finally {
        engineSaving.value = false;
      }
    }

    async function fetchAgent() {
      agentLoading.value = true;
      try {
        const r = await fetch('/settings/agent');
        const data = await r.json();
        agent.agentProvider = data.agentProvider || '';
        agent.agentApiKey = data.agentApiKey || '';
        agent.agentBaseURL = data.agentBaseURL || '';
        agent.agentModel = data.agentModel || '';
      } catch (e) {
        console.error('Failed to load agent settings:', e);
      } finally {
        agentLoading.value = false;
      }
    }

    async function saveAgent() {
      agentSaving.value = true;
      try {
        const body = {
          agentProvider: agent.agentProvider,
          agentApiKey: agent.agentApiKey,
          agentBaseURL: agent.agentBaseURL,
          agentModel: agent.agentModel,
        };
        const r = await fetch('/settings/agent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error || String(r.status));
        const data = await r.json();
        agent.agentApiKey = data.agentApiKey || '';
      } catch (e) {
        alert(`保存失败: ${e.message}`);
      } finally {
        agentSaving.value = false;
      }
    }

    async function fetchReport() {
      reportLoading.value = true;
      try {
        const r = await fetch('/settings/report');
        const data = await r.json();
        report.llm_provider = data['report.llm_provider'] || 'openai';
        report.openai_api_key = data['report.openai_api_key'] || '';
        report.openai_base_url = data['report.openai_base_url'] || 'https://api.openai.com/v1';
        report.anthropic_api_key = data['report.anthropic_api_key'] || '';
        report.ollama_base_url = data['report.ollama_base_url'] || 'http://localhost:11434';
        report.model_name = data['report.model_name'] || 'gpt-4o';
        report.temperature = data['report.temperature'] || '0.7';
      } catch (e) {
        console.error('Failed to load report settings:', e);
      } finally {
        reportLoading.value = false;
      }
    }

    async function saveReport() {
      reportSaving.value = true;
      try {
        const body = {
          'report.llm_provider': report.llm_provider,
          'report.openai_api_key': report.openai_api_key,
          'report.openai_base_url': report.openai_base_url,
          'report.anthropic_api_key': report.anthropic_api_key,
          'report.ollama_base_url': report.ollama_base_url,
          'report.model_name': report.model_name,
          'report.temperature': report.temperature,
        };
        const r = await fetch('/settings/report', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error((await r.json()).error || String(r.status));
        const data = await r.json();
        report.openai_api_key = data['report.openai_api_key'] || '';
        report.anthropic_api_key = data['report.anthropic_api_key'] || '';
      } catch (e) {
        alert(`保存失败: ${e.message}`);
      } finally {
        reportSaving.value = false;
      }
    }

    onMounted(() => {
      fetchEngine();
      fetchAgent();
      fetchReport();
    });

    return {
      engine, plan, agent, report,
      engineSaving, agentSaving, reportSaving, agentLoading, reportLoading,
      providerOptions, showApiKey, showBaseURL, baseURLPlaceholder, apiKeyLabel,
      currentTheme, toggleTheme,
      saveEngine, saveAgent, saveReport,
    };
  },

  template: `
  <div class="app-shell">
    <div class="app-header">
      <div class="app-header-left">
        <a href="/" class="back-link">&larr; 返回</a>
        <h1 style="font-size:1.25rem">设置</h1>
      </div>
      <div class="app-header-right">
        <button class="btn btn-icon" @click="toggleTheme" title="切换主题">◐</button>
      </div>
    </div>

    <div class="settings-grid">
      <!-- 左列 -->
      <div class="settings-column">
        <!-- 执行引擎 -->
        <div class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">执行引擎</h3>
          </div>
          <form class="settings-card" @submit.prevent="saveEngine">
            <div class="form-group">
              <label class="form-label">Act 超时（分钟）</label>
              <input type="number" v-model.number="engine.actTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Conclude 超时（分钟）</label>
              <input type="number" v-model.number="engine.concludeTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Plan 超时（分钟）</label>
              <input type="number" v-model.number="engine.planTimeoutMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">边认领过期（分钟）</label>
              <input type="number" v-model.number="engine.claimedExpiryMs" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">Tick 间隔（秒）</label>
              <input type="number" v-model.number="engine.tickIntervalMs" class="input" min="0.1" step="0.1">
            </div>
            <div class="form-group">
              <label class="form-label">最大失败次数</label>
              <input type="number" v-model.number="engine.maxFailures" class="input" min="1" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">最大并行 Act 数</label>
              <input type="number" v-model.number="engine.maxActConcurrency" class="input" min="1" step="1">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" :disabled="engineSaving">{{ engineSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>

        <!-- Plan 策略 -->
        <div class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">Plan 策略</h3>
          </div>
          <form class="settings-card" @submit.prevent="saveEngine">
            <div class="form-group">
              <label class="form-label">触发模式</label>
              <select v-model="plan.planTriggerMode" class="input">
                <option value="edge_drain">所有边完成后触发</option>
                <option value="node_created">新节点产生后触发</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">快照最大节点数</label>
              <input type="number" v-model.number="plan.snapshotMaxNodes" class="input" min="10" step="1">
            </div>
            <div class="form-group">
              <label class="form-label">快照最大边数</label>
              <input type="number" v-model.number="plan.snapshotMaxEdges" class="input" min="10" step="1">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" :disabled="engineSaving">{{ engineSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>
      </div>

      <!-- 右列 -->
      <div class="settings-column">
        <!-- Agent 配置 -->
        <div class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">Agent 配置</h3>
            <span class="badge badge-info">容器内 opencode 使用</span>
          </div>
          <div v-if="agentLoading" class="settings-card"><div class="empty-state"><span class="spinner"></span></div></div>
          <form v-else class="settings-card" @submit.prevent="saveAgent">
            <div class="form-group">
              <label class="form-label">Provider</label>
              <select v-model="agent.agentProvider" class="input">
                <option value="">未配置</option>
                <option v-for="p in providerOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div class="form-group" v-if="showApiKey">
              <label class="form-label">{{ apiKeyLabel }}</label>
              <input type="password" v-model="agent.agentApiKey" class="input" placeholder="sk-...">
            </div>
            <div class="form-group" v-if="showBaseURL">
              <label class="form-label">Base URL</label>
              <input type="text" v-model="agent.agentBaseURL" class="input" :placeholder="baseURLPlaceholder">
            </div>
            <div class="form-group">
              <label class="form-label">模型</label>
              <input type="text" v-model="agent.agentModel" class="input" placeholder="例: anthropic/claude-sonnet-4-5">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" :disabled="agentSaving">{{ agentSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>

        <!-- 报告生成 -->
        <div class="settings-section">
          <div class="settings-section-header">
            <h3 class="settings-section-title">报告生成</h3>
          </div>
          <div v-if="reportLoading" class="settings-card"><div class="empty-state"><span class="spinner"></span></div></div>
          <form v-else class="settings-card" @submit.prevent="saveReport">
            <div class="form-group">
              <label class="form-label">LLM 提供商</label>
              <select v-model="report.llm_provider" class="input">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            <div class="form-group" v-if="report.llm_provider === 'openai'">
              <label class="form-label">OpenAI API Key</label>
              <input type="password" v-model="report.openai_api_key" class="input" placeholder="sk-...">
            </div>
            <div class="form-group" v-if="report.llm_provider === 'openai'">
              <label class="form-label">OpenAI Base URL</label>
              <input type="text" v-model="report.openai_base_url" class="input">
            </div>
            <div class="form-group" v-if="report.llm_provider === 'anthropic'">
              <label class="form-label">Anthropic API Key</label>
              <input type="password" v-model="report.anthropic_api_key" class="input" placeholder="sk-ant-...">
            </div>
            <div class="form-group" v-if="report.llm_provider === 'ollama'">
              <label class="form-label">Ollama URL</label>
              <input type="text" v-model="report.ollama_base_url" class="input">
            </div>
            <div class="form-group">
              <label class="form-label">模型名称</label>
              <input type="text" v-model="report.model_name" class="input" placeholder="gpt-4o">
            </div>
            <div class="form-group">
              <label class="form-label">Temperature</label>
              <input type="number" v-model="report.temperature" class="input" min="0" max="2" step="0.1">
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" :disabled="reportSaving">{{ reportSaving ? '保存中...' : '保存' }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
  `
}).mount('#app');
