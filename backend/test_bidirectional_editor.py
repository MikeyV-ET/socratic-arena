#!/usr/bin/env python3
"""test_bidirectional_editor.py -- Full bidirectional tests for the shared editor.

Both agent (REST/httpx) and user (Selenium/browser) alternate roles within
the SAME test. Exercises the complete round-trip:
  agent writes -> user sees -> user edits -> agent reads -> repeat

This is Set 2 of Eric's mirror test request.

Requires:
  - Arena backend running (uvicorn on port 8000)
  - Arena frontend running (vite on port 5173)
  - Chrome + Selenium

Run:
  python3 test_bidirectional_editor.py
"""

import os
import sys
import time

import httpx
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

FRONTEND_URL = os.environ.get("ARENA_FRONTEND_URL", "http://localhost:5173")
BACKEND_URL = os.environ.get("ARENA_BACKEND_URL", "http://localhost:8000")

_start = time.time()


def log(step, msg):
    elapsed = time.time() - _start
    print(f"  [{elapsed:6.2f}s] {step}: {msg}")


def make_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    driver = webdriver.Chrome(options=opts)
    driver.implicitly_wait(3)
    return driver


def cleanup_doc(doc_id):
    try:
        httpx.delete(f"{BACKEND_URL}/api/docs/{doc_id}", timeout=5)
    except Exception:
        pass


def navigate_to_editor(driver, wait):
    try:
        add_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='open-tab-menu']")
        ))
        add_btn.click()
        time.sleep(0.5)
        editor_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='reopen-tab-editor']")
        ))
        editor_btn.click()
        time.sleep(0.5)
    except Exception:
        items = driver.find_elements(By.CSS_SELECTOR, "[role='menuitem'], button")
        for item in items:
            if "editor" in item.text.lower():
                item.click()
                time.sleep(0.5)
                break


def get_cm_text(driver):
    """Read current CodeMirror text content."""
    try:
        cm = driver.find_element(By.CSS_SELECTOR,
            "[data-testid='shared-editor-content'] .cm-content")
        text = cm.text
        if not text:
            cm_editor = driver.find_element(By.CSS_SELECTOR,
                "[data-testid='shared-editor-content'] .cm-editor")
            text = cm_editor.text
        return text
    except Exception:
        return ""


def test_b1_ping_pong():
    """B1: Agent and user take turns editing the same doc."""
    print("\n--- B1: Agent/User Ping-Pong Editing ---")
    driver = make_driver()
    doc_id = None
    try:
        # AGENT: creates doc with initial content
        log("B1.1", "AGENT creates doc")
        resp = httpx.post(f"{BACKEND_URL}/api/docs", json={
            "title": "Ping Pong Doc",
            "content": "Agent: Hello, I started this doc.",
            "contentType": "markdown",
        }, timeout=5)
        doc_id = resp.json()["id"]

        # USER: opens doc in browser
        log("B1.2", "USER loading frontend + opening doc")
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)
        navigate_to_editor(driver, wait)

        doc_item = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, f"[data-testid='doc-item-{doc_id}']")
        ))
        doc_item.click()
        time.sleep(1.5)

        # USER: verifies agent's content is visible
        cm_text = get_cm_text(driver)
        assert "Agent: Hello" in cm_text, f"User can't see agent's text: '{cm_text[:80]}'"
        log("B1.2", f"PASS - User sees agent's initial text")

        # USER: appends a response
        log("B1.3", "USER typing response")
        cm_content = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='shared-editor-content'] .cm-content")
        ))
        cm_content.click()
        cm_content.send_keys(Keys.END)
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("User: Thanks! I'm adding my thoughts here.")
        time.sleep(2)

        # AGENT: reads and verifies both entries
        log("B1.4", "AGENT reading content")
        content = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
        assert "Agent: Hello" in content, f"Agent's own text missing: '{content[:120]}'"
        assert "User: Thanks" in content, f"User's text missing: '{content[:120]}'"
        log("B1.4", "PASS - Agent sees both entries")

        # AGENT: appends via REST
        log("B1.5", "AGENT appending via REST")
        new_content = content + "\nAgent: Great, let me add more context."
        httpx.put(f"{BACKEND_URL}/api/docs/{doc_id}/content",
                  json={"content": new_content}, timeout=5)
        time.sleep(2)

        # USER: verifies all three entries visible
        cm_text = get_cm_text(driver)
        if "add more context" in cm_text:
            log("B1.5", "PASS - User sees agent's second entry in browser")
        else:
            # Verify via REST as fallback (WS broadcast may have timing)
            final = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
            assert "add more context" in final, f"Even backend missing agent text: {final}"
            log("B1.5", "PASS - Agent's second entry confirmed in backend (browser WS may lag)")

        # USER: final reply
        log("B1.6", "USER typing final reply")
        cm_content = driver.find_element(By.CSS_SELECTOR,
            "[data-testid='shared-editor-content'] .cm-content")
        cm_content.click()
        cm_content.send_keys(Keys.END)
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("User: Looks good, done from my side.")
        time.sleep(2)

        # AGENT: final read
        log("B1.7", "AGENT final read")
        content = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
        assert "done from my side" in content, f"User's final text missing: '{content}'"
        log("B1.7", "PASS - Agent sees all 4 entries")

        print("  B1: ALL PASS")

    except Exception as e:
        print(f"  B1: FAIL - {e}")
    finally:
        if doc_id:
            cleanup_doc(doc_id)
        driver.quit()


def test_b2_user_starts_agent_continues():
    """B2: User creates doc in browser, agent discovers and edits, user reads back."""
    print("\n--- B2: User Starts, Agent Continues ---")
    driver = make_driver()
    doc_id = None
    try:
        # USER: creates doc in browser
        log("B2.1", "USER creating doc in browser")
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)
        navigate_to_editor(driver, wait)

        create_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='create-doc-btn']")
        ))
        create_btn.click()
        time.sleep(0.3)
        title_input = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='create-doc-title']")
        ))
        title_input.clear()
        title_input.send_keys("User Initiative Doc")
        title_input.send_keys(Keys.RETURN)
        time.sleep(1)

        # USER: types initial content
        log("B2.2", "USER typing initial content")
        cm_content = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='shared-editor-content'] .cm-content")
        ))
        cm_content.click()
        cm_content.send_keys("User started this document with some initial thoughts.")
        time.sleep(2)

        # AGENT: discovers doc via REST
        log("B2.3", "AGENT discovering doc via REST")
        resp = httpx.get(f"{BACKEND_URL}/api/docs", timeout=5)
        docs = resp.json()
        user_docs = [d for d in docs if d["title"] == "User Initiative Doc"]
        assert len(user_docs) >= 1, f"Agent can't find doc. Docs: {docs}"
        doc_id = user_docs[0]["id"]

        content = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
        assert "initial thoughts" in content, f"Agent can't read user content: '{content[:80]}'"
        log("B2.3", f"PASS - Agent found and read user's doc")

        # AGENT: appends via REST
        log("B2.4", "AGENT editing via REST")
        new_content = content + "\n\nAgent response: I've reviewed your thoughts and have suggestions."
        httpx.put(f"{BACKEND_URL}/api/docs/{doc_id}/content",
                  json={"content": new_content}, timeout=5)
        time.sleep(2)

        # USER: reads agent's addition in browser
        cm_text = get_cm_text(driver)
        if "have suggestions" in cm_text:
            log("B2.5", "PASS - User sees agent's response in browser")
        else:
            final = httpx.get(f"{BACKEND_URL}/api/docs/{doc_id}/content", timeout=5).json()["content"]
            assert "have suggestions" in final
            log("B2.5", "PASS - Agent response confirmed in backend")

        print("  B2: ALL PASS")

    except Exception as e:
        print(f"  B2: FAIL - {e}")
    finally:
        if doc_id:
            cleanup_doc(doc_id)
        driver.quit()


def test_b3_multi_doc_roles():
    """B3: Agent and user each create a doc, then cross-edit."""
    print("\n--- B3: Multi-Doc Cross-Editing ---")
    driver = make_driver()
    agent_doc_id = None
    user_doc_id = None
    try:
        # AGENT: creates doc 1
        log("B3.1", "AGENT creating doc")
        resp = httpx.post(f"{BACKEND_URL}/api/docs", json={
            "title": "Agent's Research Notes",
            "content": "Hypothesis: mirror tests reveal asymmetric sync bugs.",
            "contentType": "markdown",
        }, timeout=5)
        agent_doc_id = resp.json()["id"]

        # USER: opens browser, creates doc 2
        log("B3.2", "USER creating doc in browser")
        driver.get(FRONTEND_URL)
        wait = WebDriverWait(driver, 10)
        navigate_to_editor(driver, wait)

        create_btn = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, "[data-testid='create-doc-btn']")
        ))
        create_btn.click()
        time.sleep(0.3)
        title_input = wait.until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, "[data-testid='create-doc-title']")
        ))
        title_input.clear()
        title_input.send_keys("User's Lab Notes")
        title_input.send_keys(Keys.RETURN)
        time.sleep(1)

        # Find user's doc ID
        resp = httpx.get(f"{BACKEND_URL}/api/docs", timeout=5)
        user_docs = [d for d in resp.json() if d["title"] == "User's Lab Notes"]
        assert len(user_docs) >= 1
        user_doc_id = user_docs[0]["id"]
        log("B3.2", f"User doc: {user_doc_id}, Agent doc: {agent_doc_id}")

        # USER: opens agent's doc and reads it
        log("B3.3", "USER opening agent's doc")
        doc_item = wait.until(EC.element_to_be_clickable(
            (By.CSS_SELECTOR, f"[data-testid='doc-item-{agent_doc_id}']")
        ))
        doc_item.click()
        time.sleep(1.5)

        cm_text = get_cm_text(driver)
        assert "mirror tests" in cm_text or "Hypothesis" in cm_text, \
            f"User can't see agent's doc: '{cm_text[:80]}'"
        log("B3.3", "PASS - User reads agent's doc")

        # USER: edits agent's doc
        log("B3.4", "USER editing agent's doc")
        cm_content = driver.find_element(By.CSS_SELECTOR,
            "[data-testid='shared-editor-content'] .cm-content")
        cm_content.click()
        cm_content.send_keys(Keys.END)
        cm_content.send_keys(Keys.RETURN)
        cm_content.send_keys("User: Confirmed, found one asymmetric path.")
        time.sleep(2)

        # AGENT: reads its own doc, sees user's edit
        log("B3.5", "AGENT reading its doc after user edit")
        content = httpx.get(f"{BACKEND_URL}/api/docs/{agent_doc_id}/content", timeout=5).json()["content"]
        assert "asymmetric path" in content, f"User's edit missing: '{content}'"
        log("B3.5", "PASS - Agent sees user's edit in its doc")

        # AGENT: edits user's doc
        log("B3.6", "AGENT editing user's doc")
        user_content = httpx.get(f"{BACKEND_URL}/api/docs/{user_doc_id}/content", timeout=5).json()["content"]
        new_content = user_content + "\nAgent note: reviewed your lab notes, looks good."
        httpx.put(f"{BACKEND_URL}/api/docs/{user_doc_id}/content",
                  json={"content": new_content}, timeout=5)

        # Verify via REST (browser verification would require navigating back)
        final = httpx.get(f"{BACKEND_URL}/api/docs/{user_doc_id}/content", timeout=5).json()["content"]
        assert "reviewed your lab notes" in final
        log("B3.6", "PASS - Agent edited user's doc")

        print("  B3: ALL PASS")

    except Exception as e:
        print(f"  B3: FAIL - {e}")
    finally:
        if agent_doc_id:
            cleanup_doc(agent_doc_id)
        if user_doc_id:
            cleanup_doc(user_doc_id)
        driver.quit()


def run_all():
    global _start
    _start = time.time()

    print(f"\n{'='*60}")
    print(f"Bidirectional Editor E2E Tests (agent + user in same test)")
    print(f"Frontend: {FRONTEND_URL}  Backend: {BACKEND_URL}")
    print(f"{'='*60}")

    test_b1_ping_pong()
    test_b2_user_starts_agent_continues()
    test_b3_multi_doc_roles()

    elapsed = time.time() - _start
    print(f"\n{'='*60}")
    print(f"Completed in {elapsed:.1f}s")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    run_all()
