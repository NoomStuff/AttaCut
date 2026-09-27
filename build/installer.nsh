!macro customInstall
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\video\shell\AttaCut" "" "Edit with AttaCut"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\video\shell\AttaCut" "Icon" "$INSTDIR\AttaCut.exe,0"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\video\shell\AttaCut\command" "" '"$INSTDIR\AttaCut.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\video\shell\AttaCut"
!macroend
