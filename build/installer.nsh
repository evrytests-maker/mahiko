; The Windows installer deliberately does not replace OMP itself. Mahiko's
; first-run screen performs the replacement after showing the exact detected
; path and receiving explicit user consent. Keeping the operation in the app
; lets one audited implementation verify the bundled checksum/version, perform
; an atomic file-only replacement and preserve every OMP data directory.

!macro customWelcomePage
  !insertMacro MUI_PAGE_WELCOME
!macroend
