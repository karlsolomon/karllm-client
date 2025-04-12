# client.py: Async markdown-aware streaming client for Qwen2.5 server with JWT and session keep-alive

import asyncio
import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import yaml
from authlib.jose import JsonWebKey, jwt
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.prompt import Prompt

console = Console()
# API_URL = "http://chat.ezevals.com:34199"
API_URL = "http://10.0.0.90:34199"
ALGORITHM = "EdDSA"
SESSION_ID = None
last_interaction = time.time()


def load_jwt_token():
    config_path = (
        Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser()
        / "karllm"
        / "karllm.conf"
    )
    if not config_path.exists():
        raise RuntimeError(f"Missing client config at {config_path}")

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    username = config.get("username")
    private_key_path = config.get("secret")

    if not username or not private_key_path:
        raise RuntimeError("Config must include 'username' and 'secret' fields")

    private_key_path = Path(private_key_path).expanduser()
    if not private_key_path.exists():
        raise RuntimeError(f"Private key file not found: {private_key_path}")

    with open(private_key_path, "r") as f:
        jwk = JsonWebKey.import_key(f.read(), {"kty": "OKP"})
    header = {"alg": "EdDSA"}

    payload = {
        "sub": username,
        "exp": int((datetime.now(timezone.utc) + timedelta(minutes=10)).timestamp()),
    }

    return jwt.encode(header, payload, jwk).decode("utf-8")


JWT_TOKEN = load_jwt_token()


def connect_and_get_session():
    global SESSION_ID
    token_response = httpx.post(
        f"{API_URL}/connect", headers={"Authorization": f"Bearer {JWT_TOKEN}"}
    )
    if token_response.status_code == 200:
        SESSION_ID = token_response.json()["session_id"]
    else:
        console.print(f"[red]✘ Auth failed: {token_response.text}[/red]")
        exit(1)


def keep_alive():
    global SESSION_ID
    while True:
        time.sleep(30)
        if SESSION_ID and time.time() - last_interaction > 25:
            try:
                httpx.post(
                    f"{API_URL}/keepalive", headers={"X-Session-Token": SESSION_ID}
                )
            except:
                pass


connect_and_get_session()
threading.Thread(target=keep_alive, daemon=True).start()
AUTH_HEADERS = lambda: {"X-Session-Token": SESSION_ID}


def get_supported_filetypes():
    response = httpx.get(f"{API_URL}/filetypes", headers=AUTH_HEADERS())
    return response.text.strip().split(",")


def upload_file(path):
    if not os.path.isfile(path):
        console.print(f"[red]File not found:[/red] {path}")
        return
    filetypes = get_supported_filetypes()
    ext = os.path.splitext(path)[1]
    if ext not in filetypes:
        console.print(f"[red]Unsupported file type:[/red] {ext}")
        return
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    response = httpx.post(
        f"{API_URL}/upload", json={"prompt": f"{path}"}, headers=AUTH_HEADERS()
    )
    if response.status_code == 200:
        console.print(f"[green]Uploaded:[/green] {path}")
    else:
        console.print(f"[red]Upload failed:[/red] {response.text}")


async def stream_chat_async(prompt: str, command: str):
    global last_interaction
    url = f"{API_URL}{command}"
    headers = {"Accept": "text/event-stream", **AUTH_HEADERS()}
    data = {"prompt": prompt}
    text_accum = ""
    is_first_chunk = True

    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST", url, headers=headers, json=data, timeout=None
        ) as response:
            if response.status_code != 200:
                console.print(f"[red]Error:[/red] {await response.aread()}")
                return

            with Live(Markdown(""), refresh_per_second=20, console=console) as live:
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        if block.startswith("data:"):
                            try:
                                payload = json.loads(block[len("data:") :])
                                decoded = payload.get("text", "")
                                if isinstance(decoded, list):
                                    decoded = "".join(decoded)
                                if (
                                    isinstance(decoded, str)
                                    and decoded.strip() == "[DONE]"
                                ):
                                    live.update(Markdown(text_accum))
                                    last_interaction = time.time()
                                    return
                                if is_first_chunk:
                                    decoded = decoded.lstrip()
                                    is_first_chunk = False
                                text_accum += decoded
                                live.update(Markdown(text_accum))
                            except json.JSONDecodeError:
                                continue


def stream_chat(prompt: str):
    asyncio.run(stream_chat_async(prompt, "/stream"))


def command(prompt: str, command: str):
    asyncio.run(stream_chat_async(prompt, command))


def add_instruction(instruction: str):
    response = httpx.post(
        f"{API_URL}/instruct", json={"prompt": instruction}, headers=AUTH_HEADERS()
    )
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
        stream_chat(instruction)
    else:
        console.print(f"[red]✘ Failed to set instruction:[/red] {response.text}")


def session_merge():
    response = httpx.post(f"{API_URL}/session/merge", headers=AUTH_HEADERS())
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to merge session:[/red] {response.text}")


def session_dump():
    response = httpx.post(f"{API_URL}/session/dump", headers=AUTH_HEADERS())
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to dump session:[/red] {response.text}")


def session_restore():
    response = httpx.post(f"{API_URL}/session/restore", headers=AUTH_HEADERS())
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to restore session:[/red] {response.text}")


def main():
    console.print("[bold green]Local LLM Client[/bold green] 🧠")
    console.print(
        "Type [bold]/exit[/bold] to quit. Use [bold]/clear[/bold], [bold]/upload <path>[/bold], etc."
    )
    while True:
        user_input = Prompt.ask("[yellow]You[/yellow]")
        if user_input.strip() == "/exit":
            break
        elif user_input.startswith("/upload"):
            _, path = user_input.split(maxsplit=1)
            upload_file(path.strip())
        elif user_input.startswith("/instruct"):
            _, instruction = user_input.split(maxsplit=1)
            add_instruction(instruction)
        elif user_input.strip() == "/session/dump":
            session_dump()
        elif user_input.strip() == "/session/restore":
            session_restore()
        elif user_input.strip() == "/session/merge":
            session_merge()
        elif user_input.startswith("/"):
            command("", user_input)
        else:
            stream_chat(user_input)


if __name__ == "__main__":
    main()
