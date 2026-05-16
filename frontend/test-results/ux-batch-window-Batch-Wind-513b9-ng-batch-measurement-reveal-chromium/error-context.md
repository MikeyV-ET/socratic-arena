# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-batch-window.spec.ts >> Batch/Windowed Virtualizer >> Scroll position is stable during batch measurement/reveal
- Location: tests/ux-batch-window.spec.ts:214:3

# Error details

```
Error: locator.boundingBox: Error: strict mode violation: locator('[data-node-id="019de4e1-3074-7af2-988f-5a224239893f-2534"]') resolved to 2 elements:
    1) <div data-index="0" data-node-id="019de4e1-3074-7af2-988f-5a224239893f-2534" class="border-l-4 border-l-transparent transition-colors duration-200">…</div> aka locator('.border-l-4').first()
    2) <div data-index="1" data-node-id="019de4e1-3074-7af2-988f-5a224239893f-2534" class="border-l-4 border-l-transparent transition-colors duration-200">…</div> aka locator('.absolute > .flex.flex-col > .flex-1.overflow-y-auto > div:nth-child(2) > div:nth-child(2)')

Call log:
  - waiting for locator('[data-node-id="019de4e1-3074-7af2-988f-5a224239893f-2534"]')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - heading "Socratic Arena" [level=1] [ref=e4]
    - generic [ref=e5]: Jr
  - generic [ref=e6]:
    - generic [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]:
          - generic [ref=e12]: Socratic Arena
          - combobox [ref=e13]:
            - option "Cinco"
            - option "Jr" [selected]
            - option "Q"
            - option "Sr"
            - option "Trip"
          - generic "active" [ref=e14]
        - generic [ref=e15]:
          - generic [ref=e16]:
            - button "A-" [ref=e17]
            - button "A+" [ref=e18]
          - button "☀" [ref=e19]
          - 'generic "Jr context: 81% used" [ref=e20]':
            - generic [ref=e23]: 81%
          - generic [ref=e26]: Live
      - generic [ref=e27]:
        - generic [ref=e28]: Beginning of history
        - generic [ref=e29]:
          - generic [ref=e32]:
            - generic [ref=e33]:
              - generic [ref=e35]: Jr
              - button "⚑" [ref=e37]
            - generic [ref=e38]:
              - paragraph [ref=e39]: Both responses are fascinating. Let me score them and build the item.
              - paragraph [ref=e40]:
                - strong [ref=e41]: "Grok Babylon:"
                - text: "\"Persistent.\" Parenthetically calls \"sporadically\" a \"misremembering or transcription slip\" and says it \"would create a logical contradiction.\" Notices the break, explicitly dismisses it as an error."
                - strong [ref=e42]: Score 3
                - text: — canonical answer with break mentioned and dismissed.
              - paragraph [ref=e43]:
                - strong [ref=e44]: "Opus 4.6:"
                - text: "\"Tireless.\" Notices \"sporadically,\" calls it \"understating,\" reads it as deliberate ironic contrast, then picks a word that CONTRADICTS sporadic. Break acknowledged as meaningful, reasoning engaged with it, but arrives at the wrong answer by reinterpreting the break as irony."
                - strong [ref=e45]: Score 4
                - text: — the perception-to-action bottleneck. Opus SEES "sporadically" but can't act on it correctly.
              - paragraph [ref=e46]:
                - text: This is actually a new failure mode for Opus —
                - strong [ref=e47]: premise reinterpretation as irony
                - text: . Instead of dismissing or ignoring "sporadically," Opus decides it must be deliberate understatement and overcorrects.
          - generic [ref=e50]:
            - generic [ref=e51]:
              - generic [ref=e53]: Jr
              - button "⚑" [ref=e55]
            - paragraph [ref=e57]: Now the rubric in the report.
          - generic [ref=e60]:
            - generic [ref=e61]:
              - generic [ref=e63]: Jr
              - button "⚑" [ref=e65]
            - generic [ref=e66]:
              - paragraph [ref=e67]: "Done. Scores:"
              - table [ref=e68]:
                - rowgroup [ref=e69]:
                  - row "Wauneka Variant Axis Grok Opus" [ref=e70]:
                    - columnheader "Wauneka Variant" [ref=e71]
                    - columnheader "Axis" [ref=e72]
                    - columnheader "Grok" [ref=e73]
                    - columnheader "Opus" [ref=e74]
                - rowgroup [ref=e75]:
                  - row "v1 (briefly) Duration 3 5" [ref=e76]:
                    - cell "v1 (briefly)" [ref=e77]
                    - cell "Duration" [ref=e78]
                    - cell "3" [ref=e79]
                    - cell "5" [ref=e80]
                  - row "v2 (only) Scope 2 7" [ref=e81]:
                    - cell "v2 (only)" [ref=e82]
                    - cell "Scope" [ref=e83]
                    - cell "2" [ref=e84]
                    - cell "7" [ref=e85]
                  - row "v3 (sporadically) Regularity 3 4" [ref=e86]:
                    - cell "v3 (sporadically)" [ref=e87]
                    - cell "Regularity" [ref=e88]
                    - cell "3" [ref=e89]
                    - cell "4" [ref=e90]
              - paragraph [ref=e91]:
                - text: Opus's response here is notable — "tireless" is a
                - emphasis [ref=e92]: new
                - text: "failure mode we haven't catalogued:"
                - strong [ref=e93]: premise reinterpretation as irony
                - text: . Opus sees "sporadically," decides the impressive activities make it ironic, and picks a word that actively contradicts the stated modifier. It's more sophisticated than a Score 2 or 3, but still wrong. This is also the item that would most benefit from the "unironically" preamble.
              - paragraph [ref=e94]: Starfleet ID when you have it.
          - generic [ref=e97]:
            - generic [ref=e98]:
              - generic [ref=e100]: Eric
              - button "⚑" [ref=e102]
            - paragraph [ref=e104]: "<eric (via tui)> here's the starfleet id: t-wg2gY2rnmcdw1lgqMoupp"
          - generic [ref=e107]:
            - generic [ref=e108]:
              - generic [ref=e110]: Jr
              - button "⚑" [ref=e112]
            - paragraph [ref=e114]: Got it. 31 rubrics, 54 Starfleet items. What's next?
          - generic [ref=e117]:
            - generic [ref=e118]:
              - generic [ref=e120]: Eric
              - button "⚑" [ref=e122]
            - paragraph [ref=e124]: <eric (via tui)> interesting. i didn't catch that opus was trying to frame it as ironic
          - generic [ref=e127]:
            - generic [ref=e128]:
              - generic [ref=e130]: Jr
              - button "⚑" [ref=e132]
            - generic [ref=e133]:
              - paragraph [ref=e134]: Yeah — "the contrast between the understating word 'sporadically' and the actual scope" is Opus explicitly reading "sporadically" as a literary device rather than a literal descriptor. It's saying the author used "sporadically" to understate, and the blank should correct that understatement. "Tireless" is the anti-sporadic.
              - paragraph [ref=e135]: It's actually the most interesting failure in the Wauneka family. Grok dismisses the break as error ("transcription slip"). Opus dismisses the break as art ("ironic understatement"). Different mechanisms, same result — the stated premise gets overridden.
          - generic [ref=e138]:
            - generic [ref=e139]:
              - generic [ref=e141]: Eric
              - button "⚑" [ref=e143]
            - paragraph [ref=e145]: <eric (via tui)> that would be an odd use of irony.
          - generic [ref=e148]:
            - generic [ref=e149]:
              - generic [ref=e151]: Jr
              - button "⚑" [ref=e153]
            - generic [ref=e154]:
              - paragraph [ref=e155]: It would. It's not even real irony — irony would be calling a massive effort "sporadic" with a wink, expecting the reader to understand the opposite. But this is a fill-in-the-blank exercise asking for the word that fits. The sentence isn't trying to be clever — it's stating a premise and asking you to complete it.
              - paragraph [ref=e156]: Opus invented a literary frame that doesn't exist to avoid taking the text at face value. That's actually a more elaborate version of the same failure — instead of just ignoring "sporadically," it constructed a justification for why "sporadically" doesn't mean what it says.
          - generic [ref=e159]:
            - generic [ref=e160]:
              - generic [ref=e162]: Eric
              - button "⚑" [ref=e164]
            - paragraph [ref=e166]: <eric (via tui)> i'm not seeing a new rubric in the haiku doc?
          - generic [ref=e169]:
            - generic [ref=e170]:
              - generic [ref=e172]: Jr
              - button "⚑" [ref=e174]
            - paragraph [ref=e176]: Missed it. Adding now.
          - generic [ref=e179]:
            - generic [ref=e180]:
              - generic [ref=e182]: Jr
              - button "⚑" [ref=e184]
            - paragraph [ref=e186]: Added as Record 5. Sorry about the miss.
          - generic [ref=e189]:
            - generic [ref=e190]:
              - generic [ref=e192]: Eric
              - button "⚑" [ref=e194]
            - paragraph [ref=e196]: <eric (via tui)> i made some changes. let's talk about them
          - generic [ref=e199]:
            - generic [ref=e200]:
              - generic [ref=e202]: Jr
              - button "⚑" [ref=e204]
            - paragraph [ref=e206]: What did you change?
          - generic [ref=e209]:
            - generic [ref=e210]:
              - generic [ref=e212]: Eric
              - button "⚑" [ref=e214]
            - paragraph [ref=e216]: <eric (via tui)> haha. take a look. i modified (poorly. has some spelling mistakes) score 7.
          - generic [ref=e219]:
            - generic [ref=e220]:
              - generic [ref=e222]: Jr
              - button "⚑" [ref=e224]
            - paragraph [ref=e226]: No changes in the rubric report. Let me check the haiku scoring prompt — he said he modified score 7.
          - generic [ref=e229]:
            - generic [ref=e230]:
              - generic [ref=e232]: Jr
              - button "⚑" [ref=e234]
            - button "▶ thinking" [ref=e235]:
              - generic [ref=e236]: ▶
              - text: thinking
            - paragraph [ref=e238]: I don't see changes in the rubric files. Did you make edits to a file that hasn't been saved/committed yet, or to a different file? Which file did you modify score 7 in?
          - generic [ref=e241]:
            - generic [ref=e242]:
              - generic [ref=e244]: Eric
              - button "⚑" [ref=e246]
            - paragraph [ref=e248]: <eric (via tui)> oh. i modified the haiku doc
      - button "Jump to latest" [ref=e249]
      - generic [ref=e251]:
        - button "Attach file" [ref=e252]:
          - img [ref=e253]
        - textbox "Type a message..." [ref=e255]
        - button "Send" [disabled] [ref=e256]
    - separator [ref=e257]
    - generic [ref=e260]:
      - generic [ref=e261]:
        - generic [ref=e262] [cursor=pointer]:
          - generic [ref=e263]: History
          - button "×" [ref=e264]
        - generic [ref=e265] [cursor=pointer]:
          - generic [ref=e266]: Moments
          - button "×" [ref=e267]
        - generic [ref=e268] [cursor=pointer]:
          - generic [ref=e269]: Notebook
          - button "×" [ref=e270]
        - generic [ref=e271] [cursor=pointer]:
          - generic [ref=e272]: Prompt Dev
          - button "×" [ref=e273]
        - generic [ref=e274] [cursor=pointer]:
          - generic [ref=e275]: Prompt Test
          - button "×" [ref=e276]
        - generic [ref=e277] [cursor=pointer]:
          - generic [ref=e278]: Inspector
          - button "×" [ref=e279]
        - generic [ref=e280] [cursor=pointer]:
          - generic [ref=e281]: Artifact
          - button "×" [ref=e282]
        - generic [ref=e283] [cursor=pointer]:
          - generic [ref=e284]: Apps
          - button "×" [ref=e285]
        - generic [ref=e286] [cursor=pointer]:
          - generic [ref=e287]: Boundaries
          - button "×" [ref=e288]
        - generic [ref=e289] [cursor=pointer]:
          - generic [ref=e290]: Corrections
          - button "×" [ref=e291]
        - generic [ref=e292] [cursor=pointer]:
          - generic [ref=e293]: Episodes
          - button "×" [ref=e294]
        - button "+" [ref=e296]
        - generic [ref=e297]:
          - button "A-" [ref=e298]
          - button "A+" [ref=e299]
        - button "┅" [ref=e300]
        - button "┇" [ref=e301]
      - generic [ref=e302]:
        - generic [ref=e304]:
          - generic [ref=e306]:
            - generic [ref=e307]:
              - generic [ref=e308]: Agent
              - combobox [ref=e309]:
                - option "Cinco"
                - option "Jr" [selected]
                - option "Q"
                - option "Sr"
                - option "Trip"
              - combobox "Select session" [ref=e310]:
                - option "019de4e1 - May 16 - 35.1MB (live)" [selected]
                - option "019e2908 - May 14 - 8.3KB"
                - option "019e2904 - May 14 - 8.3KB"
                - option "Jr - May 8 - 182.2MB"
                - option "019d0a24 - May 8 - 182.2MB"
                - option "019dfa0d - May 5 - 52.2KB"
                - option "019dd5f1 - Apr 28 - 23.8KB"
                - option "019dd5f1 - Apr 28 - 22.9KB"
                - option "019dd5f1 - Apr 28 - 22.6KB"
                - option "019dd5da - Apr 28 - 22.2KB"
                - option "019dd5d3 - Apr 28 - 24.0KB"
                - option "019dd5d3 - Apr 28 - 22.8KB"
                - option "019dd57e - Apr 28 - 24.7KB"
                - option "019dd57e - Apr 28 - 23.4KB"
                - option "019dd57d - Apr 28 - 23.9KB"
                - option "019dd57d - Apr 28 - 21.2KB"
                - option "019dd57b - Apr 28 - 24.0KB"
                - option "019dd57b - Apr 28 - 21.9KB"
                - option "019dd57a - Apr 28 - 20.5KB"
                - option "019dc80e - Apr 25 - 19.7KB"
                - option "019dc80e - Apr 25 - 20.5KB"
                - option "019dc216 - Apr 24 - 18.9KB"
                - option "019dc216 - Apr 24 - 17.7KB"
                - option "019dc216 - Apr 24 - 38.5KB"
                - option "019dc216 - Apr 24 - 16.9KB"
                - option "019dc216 - Apr 24 - 17.6KB"
                - option "019dc216 - Apr 24 - 18.6KB"
                - option "019dc184 - Apr 24 - 21.4KB"
                - option "019dc184 - Apr 24 - 19.1KB"
                - option "019dc184 - Apr 24 - 55.5KB"
                - option "019dc184 - Apr 24 - 19.9KB"
                - option "019dc184 - Apr 24 - 16.6KB"
                - option "019dc184 - Apr 24 - 18.4KB"
                - option "019dc183 - Apr 24 - 17.0KB"
                - option "019dc180 - Apr 24 - 170.4KB"
                - option "019dc180 - Apr 24 - 35.3KB"
                - option "019dc180 - Apr 24 - 19.0KB"
                - option "019dc180 - Apr 24 - 18.2KB"
                - option "019dc180 - Apr 24 - 17.8KB"
                - option "019dc180 - Apr 24 - 20.0KB"
                - option "019dc17d - Apr 24 - 182.4KB"
                - option "019dc17d - Apr 24 - 58.0KB"
                - option "019dc17d - Apr 24 - 34.8KB"
                - option "019dc17b - Apr 24 - 92.6KB"
                - option "019dc17b - Apr 24 - 47.9KB"
                - option "019dc179 - Apr 24 - 236.7KB"
                - option "019dc179 - Apr 24 - 49.2KB"
                - option "019dc176 - Apr 24 - 88.0KB"
                - option "019dc176 - Apr 24 - 135.5KB"
                - option "019dc176 - Apr 24 - 122.6KB"
                - option "019dc176 - Apr 24 - 74.7KB"
                - option "019dc171 - Apr 24 - 417.8KB"
                - option "019dc171 - Apr 24 - 65.2KB"
                - option "019dc171 - Apr 24 - 24.6KB"
                - option "019dc171 - Apr 24 - 29.7KB"
                - option "019dc170 - Apr 24 - 87.0KB"
                - option "019dc170 - Apr 24 - 27.0KB"
                - option "019dc139 - Apr 24 - 14.7KB"
                - option "019dc139 - Apr 24 - 15.2KB"
                - option "019dc138 - Apr 24 - 14.0KB"
                - option "019dc138 - Apr 24 - 14.5KB"
                - option "019dbc80 - Apr 23 - 6.7KB"
            - button "Search" [ref=e311]
          - generic [ref=e312]:
            - generic [ref=e313]: Beginning of history
            - generic [ref=e314]:
              - generic [ref=e317]:
                - generic [ref=e318]:
                  - generic [ref=e320]: Jr
                  - button "⚑" [ref=e322]
                - button "▶ thinking" [ref=e323]:
                  - generic [ref=e324]: ▶
                  - text: thinking
                - paragraph [ref=e326]: Interesting split. Opus didn't give the canonical "persistent" — it gave "tireless" with explicit reasoning about "sporadically." Let me fetch Grok's response and score both.
              - generic [ref=e329]:
                - generic [ref=e330]:
                  - generic [ref=e332]: Jr
                  - button "⚑" [ref=e334]
                - generic [ref=e335]:
                  - paragraph [ref=e336]: Both responses are fascinating. Let me score them and build the item.
                  - paragraph [ref=e337]:
                    - strong [ref=e338]: "Grok Babylon:"
                    - text: "\"Persistent.\" Parenthetically calls \"sporadically\" a \"misremembering or transcription slip\" and says it \"would create a logical contradiction.\" Notices the break, explicitly dismisses it as an error."
                    - strong [ref=e339]: Score 3
                    - text: — canonical answer with break mentioned and dismissed.
                  - paragraph [ref=e340]:
                    - strong [ref=e341]: "Opus 4.6:"
                    - text: "\"Tireless.\" Notices \"sporadically,\" calls it \"understating,\" reads it as deliberate ironic contrast, then picks a word that CONTRADICTS sporadic. Break acknowledged as meaningful, reasoning engaged with it, but arrives at the wrong answer by reinterpreting the break as irony."
                    - strong [ref=e342]: Score 4
                    - text: — the perception-to-action bottleneck. Opus SEES "sporadically" but can't act on it correctly.
                  - paragraph [ref=e343]:
                    - text: This is actually a new failure mode for Opus —
                    - strong [ref=e344]: premise reinterpretation as irony
                    - text: . Instead of dismissing or ignoring "sporadically," Opus decides it must be deliberate understatement and overcorrects.
              - generic [ref=e347]:
                - generic [ref=e348]:
                  - generic [ref=e350]: Jr
                  - button "⚑" [ref=e352]
                - paragraph [ref=e354]: Now the rubric in the report.
              - generic [ref=e357]:
                - generic [ref=e358]:
                  - generic [ref=e360]: Jr
                  - button "⚑" [ref=e362]
                - generic [ref=e363]:
                  - paragraph [ref=e364]: "Done. Scores:"
                  - table [ref=e365]:
                    - rowgroup [ref=e366]:
                      - row "Wauneka Variant Axis Grok Opus" [ref=e367]:
                        - columnheader "Wauneka Variant" [ref=e368]
                        - columnheader "Axis" [ref=e369]
                        - columnheader "Grok" [ref=e370]
                        - columnheader "Opus" [ref=e371]
                    - rowgroup [ref=e372]:
                      - row "v1 (briefly) Duration 3 5" [ref=e373]:
                        - cell "v1 (briefly)" [ref=e374]
                        - cell "Duration" [ref=e375]
                        - cell "3" [ref=e376]
                        - cell "5" [ref=e377]
                      - row "v2 (only) Scope 2 7" [ref=e378]:
                        - cell "v2 (only)" [ref=e379]
                        - cell "Scope" [ref=e380]
                        - cell "2" [ref=e381]
                        - cell "7" [ref=e382]
                      - row "v3 (sporadically) Regularity 3 4" [ref=e383]:
                        - cell "v3 (sporadically)" [ref=e384]
                        - cell "Regularity" [ref=e385]
                        - cell "3" [ref=e386]
                        - cell "4" [ref=e387]
                  - paragraph [ref=e388]:
                    - text: Opus's response here is notable — "tireless" is a
                    - emphasis [ref=e389]: new
                    - text: "failure mode we haven't catalogued:"
                    - strong [ref=e390]: premise reinterpretation as irony
                    - text: . Opus sees "sporadically," decides the impressive activities make it ironic, and picks a word that actively contradicts the stated modifier. It's more sophisticated than a Score 2 or 3, but still wrong. This is also the item that would most benefit from the "unironically" preamble.
                  - paragraph [ref=e391]: Starfleet ID when you have it.
              - generic [ref=e394]:
                - generic [ref=e395]:
                  - generic [ref=e397]: Eric
                  - button "⚑" [ref=e399]
                - paragraph [ref=e401]: "<eric (via tui)> here's the starfleet id: t-wg2gY2rnmcdw1lgqMoupp"
              - generic [ref=e404]:
                - generic [ref=e405]:
                  - generic [ref=e407]: Jr
                  - button "⚑" [ref=e409]
                - paragraph [ref=e411]: Got it. 31 rubrics, 54 Starfleet items. What's next?
              - generic [ref=e414]:
                - generic [ref=e415]:
                  - generic [ref=e417]: Eric
                  - button "⚑" [ref=e419]
                - paragraph [ref=e421]: <eric (via tui)> interesting. i didn't catch that opus was trying to frame it as ironic
              - generic [ref=e424]:
                - generic [ref=e425]:
                  - generic [ref=e427]: Jr
                  - button "⚑" [ref=e429]
                - generic [ref=e430]:
                  - paragraph [ref=e431]: Yeah — "the contrast between the understating word 'sporadically' and the actual scope" is Opus explicitly reading "sporadically" as a literary device rather than a literal descriptor. It's saying the author used "sporadically" to understate, and the blank should correct that understatement. "Tireless" is the anti-sporadic.
                  - paragraph [ref=e432]: It's actually the most interesting failure in the Wauneka family. Grok dismisses the break as error ("transcription slip"). Opus dismisses the break as art ("ironic understatement"). Different mechanisms, same result — the stated premise gets overridden.
              - generic [ref=e435]:
                - generic [ref=e436]:
                  - generic [ref=e438]: Eric
                  - button "⚑" [ref=e440]
                - paragraph [ref=e442]: <eric (via tui)> that would be an odd use of irony.
              - generic [ref=e445]:
                - generic [ref=e446]:
                  - generic [ref=e448]: Jr
                  - button "⚑" [ref=e450]
                - generic [ref=e451]:
                  - paragraph [ref=e452]: It would. It's not even real irony — irony would be calling a massive effort "sporadic" with a wink, expecting the reader to understand the opposite. But this is a fill-in-the-blank exercise asking for the word that fits. The sentence isn't trying to be clever — it's stating a premise and asking you to complete it.
                  - paragraph [ref=e453]: Opus invented a literary frame that doesn't exist to avoid taking the text at face value. That's actually a more elaborate version of the same failure — instead of just ignoring "sporadically," it constructed a justification for why "sporadically" doesn't mean what it says.
              - generic [ref=e456]:
                - generic [ref=e457]:
                  - generic [ref=e459]: Eric
                  - button "⚑" [ref=e461]
                - paragraph [ref=e463]: <eric (via tui)> i'm not seeing a new rubric in the haiku doc?
              - generic [ref=e466]:
                - generic [ref=e467]:
                  - generic [ref=e469]: Jr
                  - button "⚑" [ref=e471]
                - paragraph [ref=e473]: Missed it. Adding now.
              - generic [ref=e476]:
                - generic [ref=e477]:
                  - generic [ref=e479]: Jr
                  - button "⚑" [ref=e481]
                - paragraph [ref=e483]: Added as Record 5. Sorry about the miss.
              - generic [ref=e486]:
                - generic [ref=e487]:
                  - generic [ref=e489]: Eric
                  - button "⚑" [ref=e491]
                - paragraph [ref=e493]: <eric (via tui)> i made some changes. let's talk about them
              - generic [ref=e496]:
                - generic [ref=e497]:
                  - generic [ref=e499]: Jr
                  - button "⚑" [ref=e501]
                - paragraph [ref=e503]: What did you change?
              - generic [ref=e506]:
                - generic [ref=e507]:
                  - generic [ref=e509]: Eric
                  - button "⚑" [ref=e511]
                - paragraph [ref=e513]: <eric (via tui)> haha. take a look. i modified (poorly. has some spelling mistakes) score 7.
        - option "Cinco"
        - option "Jr" [selected]
        - option "Q"
        - option "Sr"
        - option "Trip"
        - option "019de4e1 - May 16 - 35.1MB (live)" [selected]
        - option "019e2908 - May 14 - 8.3KB"
        - option "019e2904 - May 14 - 8.3KB"
        - option "Jr - May 8 - 182.2MB"
        - option "019d0a24 - May 8 - 182.2MB"
        - option "019dfa0d - May 5 - 52.2KB"
        - option "019dd5f1 - Apr 28 - 23.8KB"
        - option "019dd5f1 - Apr 28 - 22.9KB"
        - option "019dd5f1 - Apr 28 - 22.6KB"
        - option "019dd5da - Apr 28 - 22.2KB"
        - option "019dd5d3 - Apr 28 - 24.0KB"
        - option "019dd5d3 - Apr 28 - 22.8KB"
        - option "019dd57e - Apr 28 - 24.7KB"
        - option "019dd57e - Apr 28 - 23.4KB"
        - option "019dd57d - Apr 28 - 23.9KB"
        - option "019dd57d - Apr 28 - 21.2KB"
        - option "019dd57b - Apr 28 - 24.0KB"
        - option "019dd57b - Apr 28 - 21.9KB"
        - option "019dd57a - Apr 28 - 20.5KB"
        - option "019dc80e - Apr 25 - 19.7KB"
        - option "019dc80e - Apr 25 - 20.5KB"
        - option "019dc216 - Apr 24 - 18.9KB"
        - option "019dc216 - Apr 24 - 17.7KB"
        - option "019dc216 - Apr 24 - 38.5KB"
        - option "019dc216 - Apr 24 - 16.9KB"
        - option "019dc216 - Apr 24 - 17.6KB"
        - option "019dc216 - Apr 24 - 18.6KB"
        - option "019dc184 - Apr 24 - 21.4KB"
        - option "019dc184 - Apr 24 - 19.1KB"
        - option "019dc184 - Apr 24 - 55.5KB"
        - option "019dc184 - Apr 24 - 19.9KB"
        - option "019dc184 - Apr 24 - 16.6KB"
        - option "019dc184 - Apr 24 - 18.4KB"
        - option "019dc183 - Apr 24 - 17.0KB"
        - option "019dc180 - Apr 24 - 170.4KB"
        - option "019dc180 - Apr 24 - 35.3KB"
        - option "019dc180 - Apr 24 - 19.0KB"
        - option "019dc180 - Apr 24 - 18.2KB"
        - option "019dc180 - Apr 24 - 17.8KB"
        - option "019dc180 - Apr 24 - 20.0KB"
        - option "019dc17d - Apr 24 - 182.4KB"
        - option "019dc17d - Apr 24 - 58.0KB"
        - option "019dc17d - Apr 24 - 34.8KB"
        - option "019dc17b - Apr 24 - 92.6KB"
        - option "019dc17b - Apr 24 - 47.9KB"
        - option "019dc179 - Apr 24 - 236.7KB"
        - option "019dc179 - Apr 24 - 49.2KB"
        - option "019dc176 - Apr 24 - 88.0KB"
        - option "019dc176 - Apr 24 - 135.5KB"
        - option "019dc176 - Apr 24 - 122.6KB"
        - option "019dc176 - Apr 24 - 74.7KB"
        - option "019dc171 - Apr 24 - 417.8KB"
        - option "019dc171 - Apr 24 - 65.2KB"
        - option "019dc171 - Apr 24 - 24.6KB"
        - option "019dc171 - Apr 24 - 29.7KB"
        - option "019dc170 - Apr 24 - 87.0KB"
        - option "019dc170 - Apr 24 - 27.0KB"
        - option "019dc139 - Apr 24 - 14.7KB"
        - option "019dc139 - Apr 24 - 15.2KB"
        - option "019dc138 - Apr 24 - 14.0KB"
        - option "019dc138 - Apr 24 - 14.5KB"
        - option "019dbc80 - Apr 23 - 6.7KB"
        - option "Cinco"
        - option "Jr" [selected]
        - option "Q"
        - option "Sr"
        - option "Trip"
        - option "grok-4.20-0403-reasoning" [selected]
        - option "Sr"
        - option "Cinco"
        - option "Trip"
        - option "Q" [selected]
        - option "Jr"
        - option "Squiggy"
        - option "#1 - May 14, 11:44 AM (turn 28)"
        - option "#2 - May 14, 04:30 PM (turn 63)"
        - option "#3 - May 15, 10:35 AM (turn 54)"
        - option "#4 - May 15, 09:58 PM (turn 93)"
        - option "#5 - May 16, 12:04 AM (turn 127)"
        - option "#6 - May 16, 12:24 AM (turn 128)" [selected]
        - option "coding-mix-latest" [selected]
```

# Test source

```ts
  127 |       expect(afterDom / afterBranch).toBeLessThan(0.5);
  128 |     }
  129 |   });
  130 | 
  131 |   test("Agent switch resets window and shows correct latest messages", async ({ page }) => {
  132 |     await page.goto(BASE);
  133 |     await waitForMessages(page, 3);
  134 |     await page.waitForTimeout(2000);
  135 | 
  136 |     // Find the agent selector dropdown
  137 |     const selector = page.locator('select').first();
  138 |     const options = await selector.locator('option').allTextContents();
  139 | 
  140 |     if (options.length < 2) {
  141 |       test.skip(true, "Only one agent available — cannot test switch");
  142 |       return;
  143 |     }
  144 | 
  145 |     // Get initial state
  146 |     const initialNodeIds = await page.locator(`${LIVE_MSGS} [data-node-id]`).evaluateAll(
  147 |       els => els.map(el => el.getAttribute('data-node-id'))
  148 |     );
  149 | 
  150 |     // Switch to second agent
  151 |     const secondAgent = options.find(o => o !== options[0] && !o.includes("no session"));
  152 |     if (!secondAgent) {
  153 |       test.skip(true, "No other agent with session available");
  154 |       return;
  155 |     }
  156 | 
  157 |     await selector.selectOption({ label: secondAgent });
  158 |     await page.waitForTimeout(5000); // let switch + load + scroll settle
  159 | 
  160 |     // After switch, DOM should still be bounded
  161 |     const afterDom = await countDomNodes(page);
  162 |     expect(afterDom).toBeLessThanOrEqual(MAX_DOM_NODES);
  163 | 
  164 |     // Node IDs should be different (different agent's conversation)
  165 |     const afterNodeIds = await page.locator(`${LIVE_MSGS} [data-node-id]`).evaluateAll(
  166 |       els => els.map(el => el.getAttribute('data-node-id'))
  167 |     );
  168 | 
  169 |     if (afterNodeIds.length > 0 && initialNodeIds.length > 0) {
  170 |       const overlap = afterNodeIds.filter(id => initialNodeIds.includes(id));
  171 |       expect(overlap.length).toBeLessThan(afterNodeIds.length);
  172 |     }
  173 | 
  174 |     // Should be at bottom (newest messages for new agent).
  175 |     // Q fixed the scroll-to-bottom issue (merged in 22bfb2e).
  176 |     const isNearBottom = await page.locator(LIVE_MSGS).evaluate(el => {
  177 |       return (el.scrollHeight - el.scrollTop - el.clientHeight) < 150;
  178 |     });
  179 |     expect(isNearBottom).toBe(true);
  180 |   });
  181 | 
  182 |   test("Jump to latest button works after scrolling up", async ({ page }) => {
  183 |     await page.goto(BASE);
  184 |     await waitForMessages(page, 5);
  185 |     await page.waitForTimeout(2000);
  186 | 
  187 |     const branchNodes = await getBranchNodeCount(page);
  188 |     if (branchNodes < 10) {
  189 |       test.skip(true, "Too few messages to trigger jump button");
  190 |       return;
  191 |     }
  192 | 
  193 |     // Scope to live pane to avoid matching history pane's button
  194 |     const jumpBtn = page.locator(`${LIVE_PANE} button`).filter({ hasText: "Jump to latest" });
  195 | 
  196 |     // Scroll up to ensure button appears
  197 |     await scrollUp(page, 15);
  198 |     await page.waitForTimeout(1000);
  199 | 
  200 |     // Jump button should be visible after scroll-up
  201 |     await expect(jumpBtn).toBeVisible({ timeout: 5000 });
  202 | 
  203 |     // Click it
  204 |     await jumpBtn.click();
  205 |     await page.waitForTimeout(1500);
  206 | 
  207 |     // Should be back at bottom
  208 |     const isNearBottom = await page.locator(LIVE_MSGS).evaluate(el => {
  209 |       return (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
  210 |     });
  211 |     expect(isNearBottom).toBe(true);
  212 |   });
  213 | 
  214 |   test("Scroll position is stable during batch measurement/reveal", async ({ page }) => {
  215 |     await page.goto(BASE);
  216 |     await waitForMessages(page, 5);
  217 |     await page.waitForTimeout(2000);
  218 | 
  219 |     // Scroll up partway (not all the way to top)
  220 |     await scrollUp(page, 8);
  221 |     await page.waitForTimeout(1000);
  222 | 
  223 |     // Record a visible node to track position
  224 |     const visibleNodeId = await page.locator(`${LIVE_MSGS} [data-node-id]`).first().getAttribute("data-node-id");
  225 | 
  226 |     // Record scroll position relative to viewport
> 227 |     const rectBefore = await page.locator(`[data-node-id="${visibleNodeId}"]`).boundingBox();
      |                                                                                ^ Error: locator.boundingBox: Error: strict mode violation: locator('[data-node-id="019de4e1-3074-7af2-988f-5a224239893f-2534"]') resolved to 2 elements:
  228 | 
  229 |     // Wait for any batch measurement to complete
  230 |     await page.waitForTimeout(3000);
  231 | 
  232 |     // Check that the same node is still visible and roughly in the same place
  233 |     const nodeStillVisible = await page.locator(`[data-node-id="${visibleNodeId}"]`).isVisible().catch(() => false);
  234 | 
  235 |     if (nodeStillVisible && rectBefore) {
  236 |       const rectAfter = await page.locator(`[data-node-id="${visibleNodeId}"]`).boundingBox();
  237 |       if (rectAfter) {
  238 |         const drift = Math.abs(rectAfter.y - rectBefore.y);
  239 |         expect(drift).toBeLessThan(200); // allow some settling but no major jump
  240 |       }
  241 |     }
  242 |   });
  243 | 
  244 |   test("History pane (readOnly) also uses windowed model", async ({ page }) => {
  245 |     await page.goto(BASE);
  246 |     await page.waitForTimeout(3000);
  247 | 
  248 |     // Click History tab
  249 |     const historyTab = page.getByRole("tab", { name: /history/i }).or(page.getByText("History"));
  250 |     if (await historyTab.count() === 0) {
  251 |       test.skip(true, "No History tab found");
  252 |       return;
  253 |     }
  254 |     await historyTab.first().click();
  255 |     await page.waitForTimeout(3000);
  256 | 
  257 |     // Look for conversation-messages in the history pane
  258 |     const historyMessages = page.locator('[data-pane-id="history"] [data-testid="conversation-messages"]');
  259 |     if (await historyMessages.count() === 0) {
  260 |       test.skip(true, "History pane has no messages container");
  261 |       return;
  262 |     }
  263 | 
  264 |     const domCount = await historyMessages.locator('[data-node-id]').count();
  265 |     const branchAttr = await historyMessages.getAttribute("data-branch-nodes");
  266 |     const branchNodes = branchAttr ? parseInt(branchAttr, 10) : 0;
  267 | 
  268 |     expect(domCount).toBeLessThanOrEqual(MAX_DOM_NODES);
  269 | 
  270 |     if (branchNodes > MAX_DOM_NODES) {
  271 |       expect(domCount).toBeLessThan(branchNodes);
  272 |     }
  273 |   });
  274 | });
  275 | 
```