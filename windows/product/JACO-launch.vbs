Option Explicit
Dim shell, fso, root, command, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Chr(34) & root & "\Start-JACO.ps1" & Chr(34)
code = shell.Run(command, 0, True)
If code <> 0 Then
  MsgBox "JACO could not start. See %LOCALAPPDATA%\JACO\logs\startup\launcher.log for the reason.", vbExclamation, "JACO CODE"
End If
