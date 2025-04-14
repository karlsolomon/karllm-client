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
API_URL = "http://chat.ezevals.com:34199"
ALGORITHM = "EdDSA"
SESSION_ID = None
last_interaction = time.time()
client_config = None


def load_jwt_token():
    global client_config
    config_path = (
        Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")).expanduser()
        / "karllm"
        / "karllm.conf"
    )
    if not config_path.exists():
        raise RuntimeError(f"Missing client config at {config_path}")

    with open(config_path, "r") as f:
        client_config = yaml.safe_load(f)

    username = client_config.get("username")
    private_key_path = client_config.get("secret")

    if not username or not private_key_path:
        raise RuntimeError("Config must include 'username' and 'secret' fields")

    private_key_path = Path(private_key_path).expanduser()
    if not private_key_path.exists():
        raise RuntimeError(f"Private key file not found: {private_key_path}")

    with open(private_key_path, "r") as f:
        jwk = JsonWebKey.import_key(f.read(), {"kty": "OKP"})
    header = {"alg": ALGORITHM}

    payload = {
        "sub": username,
        "exp": int((datetime.now(timezone.utc) + timedelta(hours=10)).timestamp()),
    }

    return jwt.encode(header, payload, jwk).decode("utf-8")


JWT_TOKEN = load_jwt_token()


def connect_and_get_session():
    """Establish a session with the server using JWT authentication."""
    global SESSION_ID
    try:
        response = httpx.post(
            f"{API_URL}/connect",
            headers={"Authorization": f"Bearer {JWT_TOKEN}"},
            json={"saveInteractions": client_config.get("saveInteractions", False)},
        )
        response.raise_for_status()
        SESSION_ID = response.json()["session_id"]
    except Exception as e:
        console.print(f"[red]✘ Auth failed: {e}[/red]")
        exit(1)


def keep_alive():
    """Send periodic keep-alive pings to prevent session expiry."""
    global SESSION_ID, last_interaction
    while True:
        time.sleep(30)
        if SESSION_ID and ((time.time() - last_interaction) > (60 * 29)):
            try:
                httpx.post(
                    f"{API_URL}/keepalive",
                    headers={"X-Session-Token": SESSION_ID},
                    timeout=5,
                )
                last_interaction = time.time()
            except Exception as e:
                console.print(f"[yellow]⚠ Keep-alive failed: {e}[/yellow]")


connect_and_get_session()
threading.Thread(target=keep_alive, daemon=True).start()
AUTH_HEADERS = lambda: {"X-Session-Token": SESSION_ID}


def get_auth_headers():
    return {"X-Session-Token": SESSION_ID}


def get_supported_filetypes():
    """Query server for supported file extensions."""
    response = httpx.get(f"{API_URL}/filetypes", headers=get_auth_headers())
    try:
        return response.text.strip().split(",")
    except:
        return [".txt"]


async def stream_chat_async(prompt: str, command: str):
    """Stream chat response from the server as markdown."""
    global last_interaction
    url = f"{API_URL}{command}"
    headers = {"Accept": "text/event-stream", **get_auth_headers()}
    data = {"prompt": prompt}
    text_accum = ""
    is_first_chunk = True

    try:
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", url, headers=headers, json=data, timeout=None
            ) as response:
                if response.status_code != 200:
                    console.print(f"[red]✘ Error:[/red] {await response.aread()}")
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
                                    if decoded.strip() == "[DONE]":
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
    except Exception as e:
        console.print(f"[red]✘ Stream failed:[/red] {e}")


def session_action(endpoint: str):
    """Utility for handling session endpoint responses."""
    try:
        response = httpx.post(f"{API_URL}{endpoint}", headers=get_auth_headers())
        msg = response.json().get("message", response.text)
        if response.status_code == 200:
            console.print(f"[green]✔ {msg}[/green]")
        else:
            console.print(f"[red]✘ {msg}[/red]")
    except Exception as e:
        console.print(f"[red]✘ Session request failed: {e}[/red]")


def main():
    """Interactive command-line client loop."""
    console.print("[bold green]Local LLM Client[/bold green] 🧠")
    console.print(
        "Type [bold]/exit[/bold] to quit. Use [bold]/upload <path>[/bold], etc."
    )
    while True:
        user_input = Prompt.ask("[yellow]You[/yellow]")
        if user_input.strip() == "/exit":
            break
        elif user_input.startswith("/"):
            asyncio.run(stream_chat_async("", user_input))
        else:
            asyncio.run(stream_chat_async(user_input, "/stream"))


if __name__ == "__main__":
    main()
