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


def handle_upload(path, newname=None):
    file_path = Path(path).expanduser()
    if not file_path.exists():
        console.print(f"[red]File not found: {file_path}[/red]")
        return

    with open(file_path, "rb") as f:
        files = {"file": (file_path.name, f)}
        data = {"newfilename": newname} if newname else {}
        headers = get_auth_headers()

        response = httpx.post(
            f"{API_URL}/upload", files=files, data=data, headers=headers
        )
        if response.status_code == 200:
            console.print(f"[green]\u2714 {response.json()['message']}[/green]")
        else:
            console.print(f"[red]\u2718 Upload failed: {response.text}[/red]")


def handle_read(filename):
    headers = get_auth_headers()
    response = httpx.post(
        f"{API_URL}/read", json={"filename": filename}, headers=headers
    )
    if response.status_code == 200:
        console.print(f"[green]\u2714 {response.json()['message']}[/green]")
    else:
        console.print(f"[red]\u2718 Read failed: {response.text}[/red]")


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


def handle_get_response(command: str):
    """Send a GET request and print response in markdown block."""
    url = f"{API_URL}{command}"
    headers = get_auth_headers()
    try:
        response = httpx.get(url, headers=headers)
        if response.status_code == 200:
            try:
                parsed = response.json()
                # If /help returns a markdown table in 'help'
                if isinstance(parsed, dict):
                    content = parsed.get("help", json.dumps(parsed, indent=2))
                    console.print(Markdown(content))
                else:
                    console.print(Markdown(str(parsed)))
            except Exception:
                console.print(f"[red]✘ Failed to parse response[/red]\n{response.text}")
        else:
            console.print(f"[red]✘ {response.status_code}:[/red] {response.text}")
    except Exception as e:
        console.print(f"[red]✘ GET request failed: {e}[/red]")


async def handle_post_stream(prompt: str, command: str):
    """Send a POST request and stream response from the server as markdown."""
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
        elif user_input.startswith("/upload "):
            parts = user_input.split()
            handle_upload(parts[1], parts[2] if len(parts) > 2 else None)
        elif user_input.startswith("/read "):
            handle_read(user_input.split()[1])
        elif user_input.startswith("/"):
            if user_input in ["/help", "/filetypes", "/convo/list"]:
                handle_get_response(user_input)
            else:
                asyncio.run(handle_post_stream("", user_input))
        else:
            asyncio.run(handle_post_stream(user_input, "/stream"))


if __name__ == "__main__":
    main()
