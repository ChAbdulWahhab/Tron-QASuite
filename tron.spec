# -*- mode: python ; coding: utf-8 -*-
# Run from repo root: pyinstaller tron.spec
# Output: dist/tron_engine/tron_engine.exe (+ onedir)

from PyInstaller.building.build_main import Analysis, PYZ, EXE, COLLECT
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

a = Analysis(
    ['pyengine/tron_engine.py'],
    pathex=['.'],
    binaries=[],
    # Must land next to tron_engine.exe (COLLECT root), NOT under a "pyengine/" subfolder —
    # otherwise pytest gets "file not found" for join(exe_dir, "tron_engine.py").
    datas=[
        ('pyengine/conftest.py', '.'),
        ('pyengine/tron_engine.py', '.'),
    ],
    hiddenimports=[
        'pytest',
        '_pytest',
        'pytest_timeout',
        'pytest_jsonreport',
        'pytest_jsonreport.plugin',
        'certifi',
        'requests',
        'urllib3',
        'bs4',
        'selenium',
        'selenium.webdriver',
        'selenium.webdriver.chrome',
        'selenium.webdriver.chrome.options',
        'selenium.webdriver.chrome.service',
        'selenium.webdriver.common',
        'selenium.webdriver.common.by',
        'selenium.webdriver.common.keys',
        'selenium.webdriver.support',
        'selenium.webdriver.support.ui',
        'webdriver_manager',
        'webdriver_manager.chrome',
    ]
    + collect_submodules('pytest')
    + collect_submodules('_pytest')
    + collect_submodules('selenium'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='tron_engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='tron_engine',
)
