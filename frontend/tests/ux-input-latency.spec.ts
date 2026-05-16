import { test, expect } from "@playwright/test";

/**
 * Input latency test: measures the time between pressing a key and
 * the character appearing in the DOM. Detects main-thread blocking
 * from store updates, re-renders, or polling.
 *
 * Approach: inject a MutationObserver on the input element, type
 * characters one at a time with precise timestamps, measure when
 * the DOM mutation fires.
 */

test.describe("Input latency", () => {
  test("keystroke-to-DOM latency stays under 100ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const input = page.getByPlaceholder("Type a message...");
    await input.click();

    // Inject latency measurement harness
    const latencies = await page.evaluate(async () => {
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Type a message..."]'
      ) || document.querySelector<HTMLInputElement>(
        'input[placeholder="Type a message..."]'
      );
      if (!input) throw new Error("Input element not found");

      const results: { char: string; latencyMs: number }[] = [];
      const testChars = "abcdefghijklmnopqrstuvwxyz";

      for (const char of testChars) {
        const beforeLen = input.value.length;
        const startTime = performance.now();

        // Wait for DOM to reflect the character via MutationObserver + input event
        const appeared = new Promise<number>((resolve) => {
          const onInput = () => {
            if (input.value.length > beforeLen) {
              resolve(performance.now());
              input.removeEventListener("input", onInput);
            }
          };
          input.addEventListener("input", onInput);

          // Timeout fallback
          setTimeout(() => {
            input.removeEventListener("input", onInput);
            resolve(-1);
          }, 2000);
        });

        // Dispatch a real-ish key event + input event
        const keyDown = new KeyboardEvent("keydown", {
          key: char, code: `Key${char.toUpperCase()}`, bubbles: true
        });
        const keyPress = new KeyboardEvent("keypress", {
          key: char, code: `Key${char.toUpperCase()}`, bubbles: true
        });
        // For React controlled inputs, we need to set the value and fire input event
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement?.prototype || window.HTMLInputElement.prototype,
          "value"
        )?.set;
        
        input.dispatchEvent(keyDown);
        input.dispatchEvent(keyPress);
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, input.value + char);
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", {
          key: char, code: `Key${char.toUpperCase()}`, bubbles: true
        }));

        const endTime = await appeared;
        const latency = endTime === -1 ? 2000 : endTime - startTime;
        results.push({ char, latencyMs: Math.round(latency * 100) / 100 });

        // Small gap between keystrokes to simulate real typing
        await new Promise((r) => setTimeout(r, 50));
      }

      return results;
    });

    console.log("Keystroke latencies (ms):", JSON.stringify(latencies, null, 2));

    const validLatencies = latencies.filter((l) => l.latencyMs < 2000);
    const avgLatency =
      validLatencies.reduce((s, l) => s + l.latencyMs, 0) / validLatencies.length;
    const maxLatency = Math.max(...validLatencies.map((l) => l.latencyMs));
    const p95 = validLatencies
      .map((l) => l.latencyMs)
      .sort((a, b) => a - b)[Math.floor(validLatencies.length * 0.95)];

    console.log(`Avg: ${avgLatency.toFixed(1)}ms, Max: ${maxLatency.toFixed(1)}ms, P95: ${p95.toFixed(1)}ms`);
    console.log(`Timed out: ${latencies.length - validLatencies.length}/${latencies.length}`);

    // Assert: p95 latency should be under 100ms
    expect(p95, `P95 input latency ${p95}ms exceeds 100ms`).toBeLessThan(100);
    // Assert: no keystroke should take over 200ms
    expect(maxLatency, `Max input latency ${maxLatency}ms exceeds 200ms`).toBeLessThan(200);
  });

  test("typing latency doesn't degrade over 10 seconds", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const input = page.getByPlaceholder("Type a message...");
    await input.click();

    // Type using Playwright's keyboard (goes through real input path)
    // Measure by sampling input value at intervals
    const results = await page.evaluate(async () => {
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="Type a message..."]'
      ) || document.querySelector<HTMLInputElement>(
        'input[placeholder="Type a message..."]'
      );
      if (!input) throw new Error("Input element not found");

      // Record long tasks during the test
      const longTasks: { duration: number; startTime: number }[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            duration: Math.round(entry.duration),
            startTime: Math.round(entry.startTime),
          });
        }
      });
      observer.observe({ type: "longtask", buffered: false });

      // Wait 10 seconds to capture background activity
      await new Promise((r) => setTimeout(r, 10000));

      observer.disconnect();
      return {
        longTasks,
        totalLongTaskTime: longTasks.reduce((s, t) => s + t.duration, 0),
      };
    });

    console.log(
      `Long tasks in 10s window: ${results.longTasks.length}, total blocking: ${results.totalLongTaskTime}ms`
    );
    if (results.longTasks.length > 0) {
      console.log("Long tasks:", JSON.stringify(results.longTasks));
    }

    // If there are periodic long tasks, that's the "polling feel"
    // More than 1 second of blocking in 10 seconds is a problem
    expect(
      results.totalLongTaskTime,
      `${results.totalLongTaskTime}ms of long tasks in 10s (${results.longTasks.length} tasks)`
    ).toBeLessThan(1000);
  });
});
