# -*- coding: utf-8 -*-
"""Yoki の X 用告知画像を PNG に書き出す。

    uv run --project trpg-tool/udonarium-recorder python trpg-tool/session-scheduler/広報/export_png.py

HTML は 1600×900 で組んであり、2 倍（3200×1800）で image/ に出す。
フォントは Google Fonts から読むので、書き出しにはネット接続が要る。
"""
import pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
PAGES = {"Yoki_X用.html": ROOT / "image" / "Yoki_X用.png"}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=2)
    for name, out in PAGES.items():
        page.goto((HERE / name).as_uri())
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(800)
        page.screenshot(path=str(out))
        print(out, out.stat().st_size // 1024, "KB")
    browser.close()
