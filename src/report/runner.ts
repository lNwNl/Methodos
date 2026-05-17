import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { access, mkdir } from 'node:fs/promises';

const REPORT_DIR = join(process.cwd(), 'report');

// 报告配置 key 映射：数据库 key -> 环境变量名
const REPORT_ENV_MAP: Record<string, string> = {
  'report.llm_provider':  'REPORT_LLM_PROVIDER',
  'report.openai_api_key':    'REPORT_OPENAI_API_KEY',
  'report.openai_base_url':   'REPORT_OPENAI_BASE_URL',
  'report.anthropic_api_key': 'REPORT_ANTHROPIC_API_KEY',
  'report.ollama_base_url':   'REPORT_OLLAMA_BASE_URL',
  'report.model_name':   'REPORT_MODEL_NAME',
  'report.temperature':  'REPORT_TEMPERATURE',
};

// 从 settings 中提取报告相关配置，转为环境变量
export function buildReportEnv(settings: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [dbKey, envKey] of Object.entries(REPORT_ENV_MAP)) {
    const val = settings[dbKey];
    if (val !== undefined && val !== '') {
      env[envKey] = val;
    }
  }
  return env;
}

// 检查并初始化 Python 环境
export async function ensurePythonEnv(): Promise<void> {
  const venvPath = join(REPORT_DIR, '.venv');
  try {
    await access(venvPath);
  } catch {
    // .venv 不存在，运行 uv sync
    console.log('Initializing Python environment...');
    await execCommand('uv', ['sync'], REPORT_DIR);
    console.log('Python environment ready.');
  }
}

// 生成报告（异步）
export async function generateReport(params: {
  projectId: number;
  reportId: number;
  dbPath: string;
  env?: Record<string, string>;
  onComplete: (filePath: string) => void;
  onError: (error: string) => void;
}): Promise<void> {
  const { projectId, reportId, dbPath, env: extraEnv, onComplete, onError } = params;

  const outputDir = join(process.cwd(), 'data', 'reports', String(projectId));
  await mkdir(outputDir, { recursive: true });

  const outputFile = join(outputDir, `report_${reportId}.md`);

  const child = spawn('uv', [
    'run', 'methodos-report',
    '--project-id', String(projectId),
    '--output', outputFile,
    '--db-path', dbPath,
  ], {
    cwd: REPORT_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv },
  });

  let stderr = '';

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    if (code === 0) {
      onComplete(outputFile);
    } else {
      onError(stderr || 'Report generation failed');
    }
  });

  child.on('error', (err) => {
    onError(err.message);
  });
}

// 辅助函数
function execCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    child.on('error', reject);
  });
}
