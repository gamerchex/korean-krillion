#!/usr/bin/env python3
"""End-to-end test: plays a complete seven-prompt daily dive in headless Chromium.

    npm run build && python3 scripts/e2e.py [--shots DIR]
    python3 scripts/e2e.py --url http://localhost:8787/   # against the reference server

Checks: the home screen loads; an API key can be saved for AI checking (standalone); a daily
dive starts; the prompt and the answer field sit in a compact centred column (350-500 px) and
the timer counts down; common, rare and Hangul answers are accepted; a wrong answer is a wrong
try with a short label and the prompt stays open; an answer the bank doesn't know is accepted
by the AI judge; a prompt times out; feedback is one short line with no answer key, no lists and
no explanations; prompts advance by themselves (and Enter skips the wait); nothing scrolls on
desktop or phone; the results total matches the points shown; a rejected answer can be sent for
review from the results; a reload keeps the finished daily (no replay) and the streak; a practice
dive resumes after a reload and can be passed when untimed; the menu switches the language; the
phone layout keeps the prompt and the field in the top half of the screen (clear of the
keyboard); and the page logs no errors. Exit code 0 = pass.

The Claude API is never called: in standalone mode requests to api.anthropic.com are answered
by a local fake (route below); against the server, start it with ANTHROPIC_BASE_URL pointing at
scripts/mock-claude.mjs. The fake accepts answers containing "zzvalid" (or "즈발리드").
"""

import asyncio
import json
import os
import subprocess
import sys

from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = 'file://' + os.path.join(ROOT, 'dist', 'index.html')
SERVER = False
if '--url' in sys.argv:
    PAGE = sys.argv[sys.argv.index('--url') + 1]
    SERVER = True
SHOTS = None
if '--shots' in sys.argv:
    SHOTS = sys.argv[sys.argv.index('--shots') + 1]
    os.makedirs(SHOTS, exist_ok=True)

answers = json.loads(
    subprocess.run(['node', '--import', 'tsx', 'scripts/answer-map.ts'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
)

failures = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        failures.append(msg)


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, name))


async def current_prompt(page):
    return (await page.locator('h1.prompt-text').inner_text()).strip()


async def submit(page, text):
    box = page.locator('#answer')
    await box.fill(text)
    await box.press('Enter')
    await page.wait_for_selector('.result', timeout=8000)


async def submit_try(page, text):
    """Submit an answer expected to be rejected: the prompt stays open with a short label."""
    box = page.locator('#answer')
    await box.fill(text)
    await box.press('Enter')
    await page.wait_for_selector('.aline-miss', timeout=8000)


async def no_scroll(page):
    return await page.evaluate("""() => {
        const d = document.documentElement;
        return { v: d.scrollHeight - d.clientHeight, h: d.scrollWidth - d.clientWidth };
    }""")


def fake_verdict(answer):
    ok = 'zzvalid' in answer.lower() or '즈발리드' in answer
    if ok:
        return {'verdict': 'valid', 'canonical': 'Zzvalid', 'hangul': '즈발리드', 'familiarity': 2,
                'reason_en': 'A real answer that fits.', 'reason_ko': '맞는 답입니다.'}
    return {'verdict': 'invalid', 'canonical': '', 'hangul': '', 'familiarity': 1,
            'reason_en': 'That is not a real thing in this category.', 'reason_ko': '이 분야에 실제로 있는 것이 아닙니다.'}


async def fake_claude(route):
    """Stand-in for the Claude Messages API (standalone mode)."""
    req = route.request
    cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS'}
    if req.method == 'OPTIONS':
        await route.fulfill(status=204, headers=cors)
        return
    body = json.loads(req.post_data or '{}')
    content = body.get('messages', [{}])[0].get('content', '')
    marker = "Player's answer (JSON string): "
    answer = json.loads(content.split(marker, 1)[1].splitlines()[0]) if marker in content else ''
    reply = {'content': [{'type': 'text', 'text': json.dumps(fake_verdict(answer), ensure_ascii=False)}], 'stop_reason': 'end_turn'}
    await route.fulfill(status=200, headers={**cors, 'content-type': 'application/json'}, body=json.dumps(reply))


async def reveal_info(page):
    res = page.locator('.result')
    status = await res.get_attribute('data-status')
    pts = int(await res.get_attribute('data-points'))
    text = (await res.inner_text()).strip()
    return status, pts, text


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 860})
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_' not in m.text and 'fonts.g' not in m.text else None)

        if not SERVER:
            await ctx.route('https://api.anthropic.com/v1/messages', fake_claude)

        print('Home')
        await page.goto(PAGE)
        await page.wait_for_selector('.home-go')
        check(await page.locator('.home-go:has-text("Start dive")').count() == 1, 'start button visible')
        check((await no_scroll(page))['v'] <= 0, 'home fits the screen without scrolling')
        await shot(page, '01-home.png')

        print('AI answer checking')
        await page.click('[aria-label="Settings"]')
        await page.wait_for_selector('text=AI answer checking')
        if SERVER:
            check(await page.locator('text=This server checks unknown answers with Claude.').count() == 1, 'server says it checks answers with Claude')
        else:
            await page.fill('input[type=password]', 'sk-ant-e2e-fake-key')
            await page.click('text=Save key')
            await page.wait_for_selector('text=Uses your Anthropic API key', timeout=3000)
            check(True, 'API key saved; AI checking on')
        await page.click('.logo-btn')
        await page.wait_for_selector('.home-go')

        print('Daily dive')
        await page.click('.home-go')
        await page.wait_for_selector('h1.prompt-text')
        await page.wait_for_timeout(400)
        check(await page.locator('.topbar').count() == 0, 'no navigation bar during the dive')
        stage = await page.locator('.stage').bounding_box()
        check(350 <= stage['width'] <= 500, f"prompt and answer column is compact ({stage['width']:.0f} px)")
        qb = await page.locator('.qbox').bounding_box()
        field = await page.locator('.afield').bounding_box()
        check(0 <= field['y'] - (qb['y'] + qb['height']) <= 16, 'answer field sits directly under the prompt')
        check(await page.evaluate("document.activeElement && document.activeElement.id === 'answer'"), 'answer field has focus')
        t0 = int((await page.locator('.ring b').inner_text()).strip())
        await page.wait_for_timeout(1300)
        t1 = int((await page.locator('.ring b').inner_text()).strip())
        check(t1 < t0 <= 20, f'timer counts down ({t0} -> {t1})')
        await shot(page, '02-prompt.png')
        plan = ['common', 'rare', 'wrong', 'hangul', 'timeout', 'ai', 'common']
        seen = []
        total = 0
        ai_done = False
        for i, kind in enumerate(plan):
            text = await current_prompt(page)
            entry = answers.get(text)
            check(entry is not None, f'prompt {i + 1} found in content: {text}')
            if kind == 'ai' and entry['closed']:
                kind = 'rare'  # a closed list never takes new answers: try the next prompt
            if kind == 'common' and i == 6 and not ai_done and not entry['closed']:
                kind = 'ai'
            guess = None
            if kind == 'timeout':
                await page.wait_for_selector('.result', timeout=30000)
            else:
                if kind == 'wrong':
                    await submit_try(page, 'Zzyzx Qwerty')
                    await page.wait_for_timeout(300)
                    await shot(page, '03-wrong-try.png')
                    why = (await page.locator('.aline-miss').inner_text()).strip()
                    check('Invalid answer' in why and len(why) < 30, f'wrong answer is a wrong try with a short label ({why})')
                    check(await page.locator('.result').count() == 0 and await page.input_value('#answer') == 'Zzyzx Qwerty', 'the prompt stays open for another try')
                    check(await page.locator('.penalty').count() == 1, 'the wrong try costs time (-2s shown)')
                    guess = next((a for a in entry['common'] if a not in seen), entry['common'][0])
                elif kind == 'ai':
                    guess = 'Zzvalid answer' if entry['en'] else '즈발리드'
                    ai_done = True
                elif kind == 'hangul' and entry['hangul']:
                    guess = next((h for h in entry['hangul'] if h not in seen), entry['hangul'][0])
                elif kind == 'rare':
                    guess = next((a for a in reversed(entry['rare']) if a not in seen), entry['rare'][-1])
                else:
                    guess = next((a for a in entry['common'] if a not in seen), entry['common'][0])
                seen.append(guess)
                await submit(page, guess)
            status, pts, shown = await reveal_info(page)
            total += pts
            # Feedback is the answer, its points and a rarity mark: nothing else.
            # Everything on screen except the prompt itself and the result row (which names the
            # player's own answer): no other valid answer may appear anywhere.
            dive_text = await page.evaluate("""() => {
                const c = document.querySelector('.dive').cloneNode(true);
                c.querySelectorAll('.qbox, .result, .sr-only').forEach((n) => n.remove());
                return c.textContent;
            }""")
            others = [a for a in (entry['common'][:4] + entry['rare'][-4:]) if a != guess and a.lower() not in text.lower() and len(a) > 3]
            leaked = [a for a in others if a.lower() in dive_text.lower()]
            lists = await page.locator('.dive ul, .dive ol, .dive li').count()
            check(len(shown) <= 60 and not leaked and lists == 0, f'feedback is short, no answer key ({shown!r}{", leaked " + str(leaked) if leaked else ""})')
            if kind == 'wrong':
                check(status == 'accepted' and pts >= 1, f'second try accepted: "{seen[-1]}" -> {pts} pts')
            elif kind == 'timeout':
                check(status == 'timeout' and pts == 0 and "Time's up" in shown, f'timer expiry recorded ({shown})')
            elif kind == 'ai':
                check(status == 'accepted' and 'Zzvalid' in shown, f'answer the bank does not know accepted by the AI judge -> {pts} pts')
            else:
                check(status == 'accepted' and pts >= 1, f'{kind} answer accepted: "{seen[-1]}" -> {pts} pts')
            scroll = await no_scroll(page)
            check(scroll['v'] <= 0 and scroll['h'] <= 0, f'prompt {i + 1}: nothing scrolls')
            if i == 1:
                await page.wait_for_timeout(450)
                await shot(page, '04-result.png')
            if kind == 'ai':
                await page.wait_for_timeout(450)
                await shot(page, '05-ai-result.png')
            if i == 0:
                # The next prompt opens by itself.
                await page.wait_for_selector('.result', state='detached', timeout=4000)
                check(await current_prompt(page) != text, 'the next prompt opens automatically')
            elif i < 6:
                await page.keyboard.press('Enter')  # Enter skips the wait
                await page.wait_for_selector('.result', state='detached', timeout=3000)
        await page.wait_for_selector('.results', timeout=6000)
        check(True, 'results open by themselves after the seventh prompt')
        shown_total = int((await page.locator('.res-score').get_attribute('aria-label')).split('/')[0].strip())
        check(shown_total == total, f'results total {shown_total} equals the sum of the points shown {total}')
        rows = await page.locator('.res-list li').count()
        check(rows == 7, f'results list all seven answers ({rows})')
        check(await page.locator('.res-list .rl-tag').count() >= 1, 'the AI-checked answer is marked on the results')
        share = await page.locator('#share-text').input_value()
        check('/700' in share and 'Zzyzx' not in share and 'Zzvalid' not in share and seen[0] not in share, 'share text has the score and no answers')
        await page.wait_for_timeout(1600)
        scroll = await no_scroll(page)
        check(scroll['v'] <= 0 and scroll['h'] <= 0, f'results fit the screen ({scroll})')
        await shot(page, '06-results.png')

        print('Report a rejected answer from the results')
        await page.click('text=Report an answer')
        await page.wait_for_selector('.report-list')
        await page.click('.report-list li:has-text("Zzyzx Qwerty") >> text=Send for review')
        await page.fill('.modal textarea', 'e2e test report')
        await page.click('.modal button.primary')
        await page.wait_for_selector('.report-list li:has-text("Zzyzx Qwerty") >> text=Sent', timeout=3000)
        check(True, 'wrong try sent to the review queue')
        await page.keyboard.press('Escape')

        print('Reload: the daily cannot be replayed')
        await page.reload()
        await page.wait_for_selector('.home-go')
        check(await page.locator('text=See your results').count() == 1, 'finished daily shows results, not start')
        check(await page.locator('.home-go:has-text("Start dive")').count() == 0, 'no way to restart the daily')
        streak = (await page.locator('.home-streak').inner_text()).strip()
        check(streak == '1', f'streak is 1 ({streak})')

        print('Practice resumes after reload; untimed prompts can be passed')
        await page.click('.home-links >> text=Practice')
        await page.click('.seg button:text-is("Off")')
        await page.click('text=Start practice')
        await page.wait_for_selector('h1.prompt-text')
        check(await page.locator('.ring').count() == 0, 'untimed practice shows no timer')
        text = await current_prompt(page)
        await submit(page, answers[text]['common'][0])
        await page.reload()
        await page.wait_for_selector('.home-go')
        check(await page.locator('.home-resume').count() == 1, 'unfinished practice offered for resume')
        await page.click('.home-resume >> text=Resume the dive')
        await page.wait_for_selector('h1.prompt-text')
        check(await page.locator('.stripes i').count() >= 3, 'practice dive restored')
        if await page.locator('.result').count():
            await page.keyboard.press('Enter')
            await page.wait_for_selector('.result', state='detached', timeout=3000)
        await page.click('.pass-btn')
        await page.wait_for_selector('.result', timeout=5000)
        status, pts, shown = await reveal_info(page)
        check('Passed' in shown and pts == 0, f'a prompt can be passed ({shown})')

        print('Menu: language and leaving')
        await page.click('[aria-label="Menu"]')
        await page.click('[aria-label="한국어로 보기"]')
        await page.wait_for_timeout(200)
        check(await page.locator('text=잠수 나가기').count() == 1, 'UI switches to Korean')
        await page.click('[aria-label="Switch to English"]')
        await page.click('text=Leave dive')
        await page.click('.mi-confirm button:text-is("Leave")')
        await page.wait_for_selector('.home-go')
        check(True, 'leaving the dive returns home')

        print('How to play, records, settings, archive, leaderboard, review')
        for label, sel in [('How to play', 'text=How points are calculated'), ('Records', 'text=Achievements'), ('Archive', '.archive-item'), ('Leaderboard', '.board tr.me' if SERVER else 'text=Leaderboards need shared storage'), ('My reports', 'text=Zzyzx Qwerty')]:
            await page.click(f'.home-links >> text={label}')
            ok = True
            try:
                await page.wait_for_selector(sel, timeout=3000)
            except Exception:
                ok = await page.locator(sel).count() > 0
            check(ok, f'{label} screen renders')
            if label == 'How to play':
                await shot(page, '07-howto.png')
            await page.click('.logo-btn')
            await page.wait_for_selector('.home-go')

        print('Phone layout')
        mob = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = await mob.new_page()
        mp.on('pageerror', lambda e: errors.append(str(e)))
        await mp.goto(PAGE)
        await mp.wait_for_selector('.home-go')
        check((await no_scroll(mp))['v'] <= 0, 'phone home fits without scrolling')
        await shot(mp, '08-phone-home.png')
        await mp.click('.home-go')
        await mp.wait_for_selector('h1.prompt-text')
        await mp.wait_for_timeout(400)
        scroll = await no_scroll(mp)
        check(scroll['h'] <= 0 and scroll['v'] <= 0, f'no scrolling on a phone ({scroll})')
        field = await mp.locator('.afield').bounding_box()
        ring = await mp.locator('.ring').bounding_box()
        check(field['y'] + field['height'] < 844 * 0.5 and ring['y'] + ring['height'] < 844 * 0.5, 'prompt, field and timer sit in the top half (clear of the keyboard)')
        await shot(mp, '09-phone-dive.png')
        text = await current_prompt(mp)
        await submit(mp, answers[text]['rare'][-1])
        await mp.wait_for_timeout(450)
        res = await mp.locator('.result').bounding_box()
        check(res['x'] >= 0 and res['x'] + res['width'] <= 390, 'result fits the phone width')
        await shot(mp, '10-phone-result.png')

        check(not errors, 'no page errors: ' + ('; '.join(errors[:5]) if errors else 'none'))
        await browser.close()

    if failures:
        print(f'\n{len(failures)} check(s) failed')
        sys.exit(1)
    print('\nAll end-to-end checks passed')


asyncio.run(main())
