"""Shared Azure OpenAI chat call for API routes."""

from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

load_dotenv()

AZURE_FOUNDRY_KEY = os.getenv("AZURE_FOUNDRY_KEY")
AZURE_FOUNDRY_ENDPOINT = os.getenv("AZURE_FOUNDRY_ENDPOINT")
AZURE_DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION") or "2024-10-21"


def call_azure_llm(prompt: str, timeout: int = 120) -> str:
    if not AZURE_FOUNDRY_ENDPOINT or not AZURE_FOUNDRY_KEY or not AZURE_DEPLOYMENT_NAME:
        raise ValueError(
            "Azure LLM config missing. Set AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_KEY, "
            "and AZURE_DEPLOYMENT_NAME."
        )
    endpoint = AZURE_FOUNDRY_ENDPOINT.rstrip("/")
    deployment = AZURE_DEPLOYMENT_NAME.strip()
    api_version = AZURE_OPENAI_API_VERSION.strip()
    url = (
        f"{endpoint}/openai/deployments/{deployment}/chat/completions"
        f"?api-version={api_version}"
    )
    headers = {"Content-Type": "application/json", "api-key": AZURE_FOUNDRY_KEY}
    payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "top_p": 0.7,
        "max_tokens": 3072,
        "stream": False,
    }
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()
