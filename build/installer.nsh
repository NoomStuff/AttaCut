!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var AttaCutDesktopShortcutCheckbox
Var AttaCutCreateDesktopShortcut
Var AttaCutUpgrade

!macro customInit
  StrCpy $AttaCutUpgrade "0"
  ReadRegStr $0 SHCTX "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\AttaCut.exe"
    StrCpy $AttaCutUpgrade "1"
    StrCpy $INSTDIR $0
    ${IfNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      StrCpy $AttaCutCreateDesktopShortcut "0"
    ${EndIf}
  ${EndIf}
  ; Two installed scopes need an explicit choice. Updater-provided scope flags
  ; already disambiguate these variables in initMultiUser.
  ${If} $hasPerUserInstallation == "1"
  ${AndIf} $hasPerMachineInstallation == "1"
    StrCpy $AttaCutUpgrade "0"
  ${EndIf}
  ${If} ${isUpdated}
    StrCpy $AttaCutUpgrade "1"
  ${EndIf}
!macroend

!macro customInstallMode
  ${If} $AttaCutUpgrade == "1"
    ${If} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

; Use builder's existing upgrade behavior for manual installer upgrades too.
; Keep --updated support for installs launched by electron-updater.
!macroundef _isUpdated
!macro _isUpdated _a _b _t _f
  ${StdUtils.TestParameter} $R9 "updated"
  StrCmp $AttaCutUpgrade "1" 0 +2
  StrCpy $R9 "true"
  StrCmp "$R9" "true" `${_t}` `${_f}`
!macroend

!macro customPageAfterChangeDir
  Page custom AttaCutShortcutPageCreate AttaCutShortcutPageLeave
  !ifdef allowToChangeInstallationDirectory
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE AttaCutInstallFilesPre
  !endif
!macroend

!ifdef allowToChangeInstallationDirectory
Function AttaCutInstallFilesPre
  ${If} $AttaCutUpgrade != "1"
    ; Retain builder's app-subfolder protection for first installs. An upgrade
    ; must instead keep the exact registered path, including a generic folder.
    Call instFilesPre
  ${EndIf}
FunctionEnd
!endif

Function AttaCutShortcutPageCreate
  ${If} $AttaCutUpgrade == "1"
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Choose which shortcuts Setup should create."
  Pop $0
  ${NSD_CreateCheckbox} 0 32u 100% 12u "Create a desktop shortcut"
  Pop $AttaCutDesktopShortcutCheckbox
  ${NSD_Check} $AttaCutDesktopShortcutCheckbox
  StrCpy $AttaCutCreateDesktopShortcut "1"

  nsDialogs::Show
FunctionEnd

Function AttaCutShortcutPageLeave
  ${NSD_GetState} $AttaCutDesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $AttaCutCreateDesktopShortcut "1"
  ${Else}
    StrCpy $AttaCutCreateDesktopShortcut "0"
  ${EndIf}
FunctionEnd
!endif

; Test packages use a unique app identity and must not touch production verbs.
!if "${APP_ID}" == "dev.attacut.app"
  !define ATTACUT_SHELL_VERB "AttaCut"
!else
  !define ATTACUT_SHELL_VERB "${APP_ID}"
!endif

!macro RegisterAttaCutEditVerb EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ATTACUT_SHELL_VERB}" "" "Edit with AttaCut"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ATTACUT_SHELL_VERB}" "Icon" "$INSTDIR\AttaCut.exe,0"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ATTACUT_SHELL_VERB}\command" "" '$\"$INSTDIR\AttaCut.exe$\" $\"%1$\"'
!macroend

!macro UnregisterAttaCutEditVerb EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${ATTACUT_SHELL_VERB}"
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
  ${If} $AttaCutCreateDesktopShortcut == "0"
    Delete "$newDesktopLink"
  ${EndIf}
  !endif

  !insertmacro RegisterAttaCutEditVerb "mp4"
  !insertmacro RegisterAttaCutEditVerb "mov"
  !insertmacro RegisterAttaCutEditVerb "mkv"
  !insertmacro RegisterAttaCutEditVerb "webm"
  !insertmacro RegisterAttaCutEditVerb "avi"
  !insertmacro RegisterAttaCutEditVerb "m4v"
  !insertmacro RegisterAttaCutEditVerb "ts"
  !insertmacro RegisterAttaCutEditVerb "mts"
  !insertmacro RegisterAttaCutEditVerb "m2ts"
  !insertmacro RegisterAttaCutEditVerb "mpg"
  !insertmacro RegisterAttaCutEditVerb "mpeg"
  !insertmacro RegisterAttaCutEditVerb "m2v"
  !insertmacro RegisterAttaCutEditVerb "vob"
  !insertmacro RegisterAttaCutEditVerb "flv"
  !insertmacro RegisterAttaCutEditVerb "wmv"
  !insertmacro RegisterAttaCutEditVerb "asf"
  !insertmacro RegisterAttaCutEditVerb "ogv"
  !insertmacro RegisterAttaCutEditVerb "mxf"
  !insertmacro RegisterAttaCutEditVerb "3gp"
  !insertmacro RegisterAttaCutEditVerb "3g2"
  !insertmacro RegisterAttaCutEditVerb "f4v"
  !insertmacro RegisterAttaCutEditVerb "m1v"
  !insertmacro RegisterAttaCutEditVerb "mpe"
  !insertmacro RegisterAttaCutEditVerb "m2p"
  !insertmacro RegisterAttaCutEditVerb "m2t"
  !insertmacro RegisterAttaCutEditVerb "mod"
  !insertmacro RegisterAttaCutEditVerb "tod"
  !insertmacro RegisterAttaCutEditVerb "vro"
  !insertmacro RegisterAttaCutEditVerb "divx"
  !insertmacro RegisterAttaCutEditVerb "dv"
  !insertmacro RegisterAttaCutEditVerb "ogm"
  !insertmacro RegisterAttaCutEditVerb "wtv"
  !insertmacro RegisterAttaCutEditVerb "dvr-ms"
  !insertmacro RegisterAttaCutEditVerb "mjpg"
  !insertmacro RegisterAttaCutEditVerb "h264"
  !insertmacro RegisterAttaCutEditVerb "264"
  !insertmacro RegisterAttaCutEditVerb "h265"
  !insertmacro RegisterAttaCutEditVerb "265"
  !insertmacro RegisterAttaCutEditVerb "hevc"
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend

!macro customUnInstall
  !insertmacro UnregisterAttaCutEditVerb "mp4"
  !insertmacro UnregisterAttaCutEditVerb "mov"
  !insertmacro UnregisterAttaCutEditVerb "mkv"
  !insertmacro UnregisterAttaCutEditVerb "webm"
  !insertmacro UnregisterAttaCutEditVerb "avi"
  !insertmacro UnregisterAttaCutEditVerb "m4v"
  !insertmacro UnregisterAttaCutEditVerb "ts"
  !insertmacro UnregisterAttaCutEditVerb "mts"
  !insertmacro UnregisterAttaCutEditVerb "m2ts"
  !insertmacro UnregisterAttaCutEditVerb "mpg"
  !insertmacro UnregisterAttaCutEditVerb "mpeg"
  !insertmacro UnregisterAttaCutEditVerb "m2v"
  !insertmacro UnregisterAttaCutEditVerb "vob"
  !insertmacro UnregisterAttaCutEditVerb "flv"
  !insertmacro UnregisterAttaCutEditVerb "wmv"
  !insertmacro UnregisterAttaCutEditVerb "asf"
  !insertmacro UnregisterAttaCutEditVerb "ogv"
  !insertmacro UnregisterAttaCutEditVerb "mxf"
  !insertmacro UnregisterAttaCutEditVerb "3gp"
  !insertmacro UnregisterAttaCutEditVerb "3g2"
  !insertmacro UnregisterAttaCutEditVerb "f4v"
  !insertmacro UnregisterAttaCutEditVerb "m1v"
  !insertmacro UnregisterAttaCutEditVerb "mpe"
  !insertmacro UnregisterAttaCutEditVerb "m2p"
  !insertmacro UnregisterAttaCutEditVerb "m2t"
  !insertmacro UnregisterAttaCutEditVerb "mod"
  !insertmacro UnregisterAttaCutEditVerb "tod"
  !insertmacro UnregisterAttaCutEditVerb "vro"
  !insertmacro UnregisterAttaCutEditVerb "divx"
  !insertmacro UnregisterAttaCutEditVerb "dv"
  !insertmacro UnregisterAttaCutEditVerb "ogm"
  !insertmacro UnregisterAttaCutEditVerb "wtv"
  !insertmacro UnregisterAttaCutEditVerb "dvr-ms"
  !insertmacro UnregisterAttaCutEditVerb "mjpg"
  !insertmacro UnregisterAttaCutEditVerb "h264"
  !insertmacro UnregisterAttaCutEditVerb "264"
  !insertmacro UnregisterAttaCutEditVerb "h265"
  !insertmacro UnregisterAttaCutEditVerb "265"
  !insertmacro UnregisterAttaCutEditVerb "hevc"
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0x1000, i 0, i 0)'
!macroend
