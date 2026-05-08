# Hosted Application Panels

SA can host desktop applications (Chrome, terminals, file managers) in panels. The human sees the app visually via Xpra. You control it programmatically.

## Launching a Panel

```
POST /api/panel/launch
{"preset": "chrome", "url": "https://example.com"}
```

Presets:
- `chrome` -- Google Chrome in app mode (no browser chrome). Specify `url`.
- `terminal` -- xterm terminal emulator
- `files` -- pcmanfm file manager

Response includes `panel_id` and `cdp_port` (for Chrome panels).

## Controlling Chrome via Selenium

Chrome panels get a CDP debugging port (93xx range). Connect with Selenium:

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts = Options()
opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{cdp_port}")
driver = webdriver.Chrome(options=opts)

# Now you control the same browser the human sees
driver.get("https://example.com")
title = driver.title
elements = driver.find_elements(By.CSS_SELECTOR, "h1")
```

The human sees every action in real time in their panel.

## Panel Lifecycle

| Endpoint | Purpose |
|----------|---------|
| `GET /api/panel/list` | List active panels |
| `GET /api/panel/presets` | Available panel types |
| `POST /api/panel/launch` | Start a panel |
| `DELETE /api/panel/{id}` | Stop a panel |
| `POST /api/panel/{id}/agent-claim` | Claim panel for agent control |
| `POST /api/panel/{id}/agent-release` | Release agent control |
| `POST /api/panel/{id}/agent-status` | Update agent status text |

## Claiming a Panel

Before controlling a panel, claim it so the human sees an indicator:
```
POST /api/panel/{id}/agent-claim
{"agent": "Q", "task": "Navigating to search results"}
```

Release when done:
```
POST /api/panel/{id}/agent-release
```

## Asymmetric Interaction

The human and you interact with the same app through different channels:
- **Human**: visual (pixels + mouse/keyboard) via Xpra HTML5 client
- **Agent**: programmatic (Selenium/CDP, shell commands, AT-SPI) -- no pixels needed

This is deliberate. Humans are good at visual interaction; agents are good at API-level control.