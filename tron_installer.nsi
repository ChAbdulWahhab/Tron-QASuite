; TRON QA Suite — NSIS installer with proper upgrade/silent-install support
;
; Build steps (run from Tron-Software directory):
;   1. npm run build
;   2. pyinstaller --noconfirm tron.spec
;   3. npx electron-builder --win --dir
;   4. makensis tron_installer.nsi
;
; Output: TRONSetup-v{VERSION}.exe (repo root)
; Requires: release\win-unpacked\ from electron-builder --dir

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef TRON_PACK_DIR
  !define TRON_PACK_DIR "release"
!endif

!define APP_NAME "TRONQA"
!define APP_FRIENDLY_NAME "TRON QA Suite"
!define COMPANY_NAME "Systemset Co."
!define MAIN_EXE "TRON QA Suite.exe"
!define UNINST_EXE "Uninstall.exe"

!define REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define REG_INSTALLDIR "Software\${APP_NAME}"

VIProductVersion "3.1.1.0"
VIAddVersionKey "ProductName" "${APP_FRIENDLY_NAME}"
VIAddVersionKey "CompanyName" "${COMPANY_NAME}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2024 ${COMPANY_NAME}"
VIAddVersionKey "FileDescription" "TRON QA Suite Installer"
VIAddVersionKey "FileVersion" "3.1.1"
VIAddVersionKey "ProductVersion" "3.1.1"

Name "${APP_FRIENDLY_NAME}"
OutFile "TRONSetup-v3.1.1.exe"
Icon "branding\tron-app.ico"
UninstallIcon "branding\tron-app.ico"
BrandingText "${APP_FRIENDLY_NAME}"

InstallDir "$PROGRAMFILES64\${APP_FRIENDLY_NAME}"

RequestExecutionLevel admin

ShowInstDetails show
ShowUninstDetails show

!define MUI_ICON "branding\tron-app.ico"
!define MUI_UNICON "branding\tron-app.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "branding\tron-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "branding\tron-sidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${MAIN_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_FRIENDLY_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Var PREVIOUS_VERSION
Var IS_UPGRADE

Function .onInit
  ; Check if already installed — read version from registry
  ReadRegStr $PREVIOUS_VERSION HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion"
  ${If} $PREVIOUS_VERSION != ""
    StrCpy $IS_UPGRADE "1"
  ${Else}
    StrCpy $IS_UPGRADE "0"
  ${EndIf}

  ; Support /S silent install flag
  ${GetParameters} $R0
  ${GetOptions} $R0 "/S" $R1
  IfErrors 0 silent_mode
  goto not_silent_mode

  silent_mode:
    SetSilent silent

  not_silent_mode:
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"

  ; Upgrade: kill running instance so files can be overwritten
  ${If} $IS_UPGRADE == "1"
    nsExec::ExecToLog 'taskkill /F /IM "TRON QA Suite.exe"'
    Sleep 1500
  ${EndIf}

  ; Copy all app files
  File /r "${TRON_PACK_DIR}\win-unpacked\*.*"
  File "branding\tron-app.ico"

  ; Ensure PyInstaller engine is in resources\pyengine
  SetOutPath "$INSTDIR\resources\pyengine"
  File /r "dist\tron_engine\*.*"

  SetOutPath "$INSTDIR"

  ; Generate fresh install uid — preserves user data path per install
  ExecWait `powershell -NoProfile -ExecutionPolicy Bypass -Command "[guid]::NewGuid().ToString() | Set-Content -LiteralPath '$INSTDIR\.tron_install_uid' -Encoding ascii -NoNewline"` $0

  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  ; Upgrade: preserve user data by NOT wiping AppData (app itself handles install identity sync)
  WriteRegStr HKLM "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  WriteRegStr HKLM "${REG_KEY}" "DisplayName" "${APP_FRIENDLY_NAME}"
  WriteRegStr HKLM "${REG_KEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr HKLM "${REG_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegStr HKLM "${REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "DisplayIcon" "$INSTDIR\tron-app.ico"
  WriteRegStr HKLM "${REG_KEY}" "Publisher" "${COMPANY_NAME}"
  WriteRegStr HKLM "${REG_KEY}" "DisplayVersion" "3.1.1"
  WriteRegDWORD HKLM "${REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REG_KEY}" "NoRepair" 1

  ; Estimate install size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REG_KEY}" "EstimatedSize" "$0"

  CreateDirectory "$SMPROGRAMS\${APP_FRIENDLY_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_FRIENDLY_NAME}\${APP_FRIENDLY_NAME}.lnk" "$INSTDIR\${MAIN_EXE}" "" "$INSTDIR\tron-app.ico" 0
  CreateShortcut "$DESKTOP\${APP_FRIENDLY_NAME}.lnk" "$INSTDIR\${MAIN_EXE}" "" "$INSTDIR\tron-app.ico" 0
SectionEnd

Section "Uninstall"
  ; Kill running instance
  nsExec::ExecToLog 'taskkill /F /IM "TRON QA Suite.exe"'
  Sleep 1000

  ; Remove app files — leave user data in AppData intact
  RMDir /r "$INSTDIR"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${APP_FRIENDLY_NAME}\${APP_FRIENDLY_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_FRIENDLY_NAME}"
  Delete "$DESKTOP\${APP_FRIENDLY_NAME}.lnk"

  ; Remove registry entries
  DeleteRegKey HKLM "${REG_KEY}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
