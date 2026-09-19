"""
AI chatbot endpoint, powered by the Claude API.

Requires an ANTHROPIC_API_KEY environment variable — get one at
https://console.anthropic.com/settings/keys. Locally, put it in a .env
file (already gitignored); on Render, add it under the service's
Environment tab. The endpoint degrades gracefully (503, not a crash)
if the key isn't set.
"""
import os
from typing import List, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/chat", tags=["chat"])

SYSTEM_PROMPT = (
    "You are the Oikos AI assistant, embedded in a real-estate sales & "
    "marketing dashboard. You help the person using the dashboard "
    "(a sales/marketing manager) understand leads, bookings, funnel "
    "performance, and general real-estate sales strategy. Be concise "
    "and concrete. You do not have live access to the dashboard's "
    "database in this conversation, so if asked about specific current "
    "numbers, say you don't have that in front of you rather than "
    "guessing, and suggest they check the relevant dashboard tab."
)

MODEL = "claude-sonnet-5"
MAX_TOKENS = 600
MAX_HISTORY_MESSAGES = 20  # keep request size/cost bounded


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str


@router.post("", response_model=ChatResponse)
def chat(req: ChatRequest):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "The chatbot isn't configured yet — set the "
                "ANTHROPIC_API_KEY environment variable on the server."
            ),
        )
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message cannot be empty")

    try:
        import anthropic  # imported lazily so the app still boots without the package installed
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="The chatbot dependency (anthropic) isn't installed on the server.",
        )

    messages = [
        {"role": m.role, "content": m.content}
        for m in req.history[-MAX_HISTORY_MESSAGES:]
    ]
    messages.append({"role": "user", "content": req.message})

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        reply_text = "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
        if not reply_text:
            reply_text = "I didn't get a text response back — try rephrasing that?"
        return ChatResponse(reply=reply_text)
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chatbot request failed: {e}")
