import os
from pathlib import Path
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()


class Config:
    """报告生成模块配置"""

    # LLM 配置
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "openai")

    # OpenAI 配置
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

    # Anthropic 配置
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    # Ollama 配置
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    # 模型配置
    MODEL_NAME: str = os.getenv("MODEL_NAME", "gpt-4o")
    TEMPERATURE: float = float(os.getenv("TEMPERATURE", "0.7"))

    # 服务配置
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8001"))

    # 数据库默认路径
    DEFAULT_DB_PATH: str = os.getenv("DEFAULT_DB_PATH", "data/methodos.db")

    @classmethod
    def get_llm(cls):
        """根据配置获取 LLM 实例"""
        provider = cls.LLM_PROVIDER.lower()

        if provider == "openai":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=cls.MODEL_NAME,
                temperature=cls.TEMPERATURE,
                api_key=cls.OPENAI_API_KEY,
                base_url=cls.OPENAI_BASE_URL,
            )
        elif provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=cls.MODEL_NAME,
                temperature=cls.TEMPERATURE,
                api_key=cls.ANTHROPIC_API_KEY,
            )
        elif provider == "ollama":
            from langchain_ollama import ChatOllama
            return ChatOllama(
                model=cls.MODEL_NAME,
                temperature=cls.TEMPERATURE,
                base_url=cls.OLLAMA_BASE_URL,
            )
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")


config = Config()
