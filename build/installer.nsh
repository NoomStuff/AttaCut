!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var AttaCutDesktopShortcutCheckbox
Var AttaCutCreateDesktopShortcut

!macro customPageAfterChangeDir
  Page custom AttaCutShortcutPageCreate AttaCutShortcutPageLeave
!macroend

Function AttaCutShortcutPageCreate
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

!macro RegisterAttaCutEditVerb EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\AttaCut" "" "Edit with AttaCut"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\AttaCut" "Icon" "$INSTDIR\AttaCut.exe,0"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\AttaCut\command" "" '$\"$INSTDIR\AttaCut.exe$\" $\"%1$\"'
!macroend

!macro UnregisterAttaCutEditVerb EXT
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\AttaCut"
!macroend

!macro customInstall
  ${If} $AttaCutCreateDesktopShortcut == "0"
    Delete "$newDesktopLink"
  ${EndIf}

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
