"""Read-only acceptance checks against a running Aura runtime.
Run: python3 scripts/verify_mobile_workspace.py http://127.0.0.1:3000
Requires Python Playwright and Chromium. No model calls or project writes.
"""
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000'
output = Path(os.environ.get('JACO_UI_CHECK_OUTPUT', '/tmp/jaco-mobile-check'))
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    for width, height in [(320, 740), (390, 844), (430, 932)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        failures = []
        page.on('pageerror', lambda error: failures.append(str(error)))
        page.goto(base, wait_until='domcontentloaded')
        nav = page.get_by_role('navigation', name='Mobilnavigation')
        nav.wait_for()
        page.get_by_label('Öppna projekt:', exact=False).wait_for()
        logo = page.locator('.cognitive-brand .jaco-wordmark, .cognitive-brand img')
        page.wait_for_load_state('load')
        assert logo.is_visible()
        assert logo.evaluate("(el)=>el.tagName === 'IMG' ? el.naturalWidth > 0 : el.textContent === 'JACO'")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal document overflow'
        for button in nav.get_by_role('button').all():
            bounds = button.bounding_box()
            assert bounds['height'] >= 44 and bounds['width'] >= 44
        composer = page.locator('.cognitive-input-box textarea')
        composer.fill('Utkast som ska finnas kvar vid navigering')
        nav.get_by_role('button', name='Agenter', exact=True).click()
        page.locator('.cognitive-canvas-bar').filter(has_text='Agenter').wait_for()
        nav.get_by_role('button', name='Arbete', exact=True).click()
        page.get_by_role('region', name='Granska agentens ändringar').wait_for()
        nav.get_by_role('button', name='Filer', exact=True).click()
        page.locator('.cognitive-sidebar').wait_for()
        assert page.locator('.cognitive-sidebar').bounding_box()['width'] == width
        nav.get_by_role('button', name='Samtal', exact=True).click()
        assert composer.input_value() == 'Utkast som ska finnas kvar vid navigering'
        nav.get_by_role('button', name='Fler funktioner').click()
        menu = page.get_by_role('dialog', name='Din arbetsyta')
        menu.wait_for()
        page.keyboard.press('Escape')
        assert not menu.is_visible()
        assert nav.get_by_role('button', name='Fler funktioner').evaluate('(el)=>el === document.activeElement')
        nav.get_by_role('button', name='Fler funktioner').click()
        menu.get_by_role('button', name='Anslutningar', exact=True).click()
        page.get_by_role('heading', name='Anslutningar', exact=True).wait_for()
        assert not menu.is_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        nav.get_by_role('button', name='Samtal', exact=True).click()
        page.get_by_role('button', name='Visa kostnad live', exact=True).click()
        cost = page.get_by_role('dialog', name='Kostnad live', exact=True)
        bounds = cost.bounding_box()
        assert bounds['x'] >= 0 and bounds['x'] + bounds['width'] <= width
        page.get_by_role('button', name='Visa kostnad live', exact=True).click()
        composer.fill('')
        page.screenshot(path=str(output / f'aura-{width}.png'))
        page.set_viewport_size({'width': width, 'height': 480})
        composer.focus()
        assert composer.bounding_box()['y'] + composer.bounding_box()['height'] <= 480
        assert nav.bounding_box()['y'] + nav.bounding_box()['height'] <= 480
        assert not failures, failures
        print(f'PASS {width}px: navigation, project panel, draft retention, menu focus, integrations, cost, short viewport; no JS errors')
        page.close()
    desktop = browser.new_page(viewport={'width': 1440, 'height': 900})
    desktop.goto(base, wait_until='domcontentloaded')
    desktop.locator('.cognitive-rail').wait_for()
    assert not desktop.get_by_role('navigation', name='Mobilnavigation').is_visible()
    assert desktop.evaluate('document.documentElement.scrollWidth <= innerWidth')
    print('PASS desktop: original navigation remains available')
    browser.close()
