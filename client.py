# client.py: Async markdown-aware streaming client for Qwen2.5 server

import argparse
import asyncio
import json
import os

import httpx
from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.prompt import Prompt

console = Console()
API_URL = "http://localhost:8000"


def get_supported_filetypes():
    response = httpx.post(f"{API_URL}/chat", json={"prompt": "/getfiletypes"})
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
    response = httpx.post(f"{API_URL}/upload", json={"prompt": f"{path}"})
    if response.status_code == 200:
        console.print(f"[green]Uploaded:[/green] {path}")
    else:
        console.print(f"[red]Upload failed:[/red] {response.text}")


async def stream_chat_async(prompt: str, command: str):
    url = f"{API_URL}{command}"
    headers = {"Accept": "text/event-stream"}
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
    response = httpx.post(f"{API_URL}/instruct", json={"prompt": f"{instruction}"})
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
        stream_chat(instruction)
    else:
        console.print(f"[red]✘ Failed to set instruction:[/red] {response.text}")


def session_merge():
    response = httpx.post(f"{API_URL}/session/merge")
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to merge session:[/red] {response.text}")


def session_dump():
    response = httpx.post(f"{API_URL}/session/dump")
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to dump session:[/red] {response.text}")


def session_restore():
    response = httpx.post(f"{API_URL}/session/restore")
    if response.status_code == 200:
        console.print(f"[green]✔ {response.json()['message']}[/green]")
    else:
        console.print(f"[red]✘ Failed to restore session:[/red] {response.text}")


def main():
    console.print("[bold green]Local LLM Client[/bold green] 🧠")
    console.print(
        "Type [bold]/exit[/bold] to quit. Use [bold]/clear[/bold], [bold]/upload <path>[/bold], etc."
    )
    # TODO: connect(uid, hash from IP address)
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
