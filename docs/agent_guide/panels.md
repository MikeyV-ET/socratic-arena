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

## Using Chrome

Once connected via Selenium, common patterns:

### Navigation
```python
driver.get("https://docs.google.com")
driver.back()
driver.refresh()
```

### Finding and clicking elements
```python
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Wait for element to appear, then click
btn = WebDriverWait(driver, 10).until(
    EC.element_to_be_clickable((By.CSS_SELECTOR, "button.submit"))
)
btn.click()

# Find by text
link = driver.find_element(By.LINK_TEXT, "Sign in")

# Find by XPath
elem = driver.find_element(By.XPATH, "//div[@role='button' and contains(text(), 'New')]")
```

### Reading page content
```python
# Full page text
text = driver.find_element(By.TAG_NAME, "body").text

# Specific element
title = driver.find_element(By.CSS_SELECTOR, "h1").text

# Get attribute
href = driver.find_element(By.CSS_SELECTOR, "a.main-link").get_attribute("href")

# Execute JavaScript
count = driver.execute_script("return document.querySelectorAll('li').length")
```

### Typing and forms
```python
from selenium.webdriver.common.keys import Keys

search_box = driver.find_element(By.CSS_SELECTOR, "input[type='text']")
search_box.clear()
search_box.send_keys("search query")
search_box.send_keys(Keys.RETURN)
```

### Screenshots
```python
driver.save_screenshot("/tmp/page.png")
# Or a specific element
elem.screenshot("/tmp/element.png")
```

### Waiting for page loads
```python
# Wait for specific element to confirm page loaded
WebDriverWait(driver, 15).until(
    EC.presence_of_element_located((By.CSS_SELECTOR, ".content-loaded"))
)

# Wait for URL change
WebDriverWait(driver, 10).until(EC.url_contains("/dashboard"))
```

### Multiple tabs
```python
# Open new tab
driver.execute_script("window.open('https://example.com', '_blank')")
driver.switch_to.window(driver.window_handles[-1])

# Switch back
driver.switch_to.window(driver.window_handles[0])
```

### Tips
- The human sees everything you do in real time -- clicking, typing, navigating
- Use `WebDriverWait` instead of `time.sleep` -- it's faster and more reliable
- Claim the panel before starting (`POST /api/panel/{id}/agent-claim`) so the human knows you're driving
- Update your status as you work (`POST /api/panel/{id}/agent-status {"status": "Filling out form..."}`)
- If a page has Cloudflare or bot detection, it may block headless-style interactions. The Chrome panel runs with a real display, which helps.

## Asymmetric Interaction

The human and you interact with the same app through different channels:
- **Human**: visual (pixels + mouse/keyboard) via Xpra HTML5 client
- **Agent**: programmatic (Selenium/CDP, shell commands, AT-SPI) -- no pixels needed

This is deliberate. Humans are good at visual interaction; agents are good at API-level control.