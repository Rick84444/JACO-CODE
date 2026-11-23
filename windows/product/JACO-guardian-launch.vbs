' Run the already installed JACO health supervisor on Windows user logon.
' No prompts, second mission runtime, credentials, or elevated process.
Option Explicit
Dim shell, fso, env, root, node, guardian, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
node = fso.BuildPath(root, "tools\node\node.exe")
guardian = fso.BuildPath(root, "agents\lib\health-guardian.mjs")
If Not fso.FileExists(node) Or Not fso.FileExists(guardian) Then
  WScript.Quit 0
End If
Set env = shell.Environment("PROCESS")
env("JACO_INSTALLED") = "1"
env("JACO_DATA_DIR") = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\JACO"
env("JACO_START_MODE") = "production"
env("JACO_NODE_EXECUTABLE") = node
shell.CurrentDirectory = root
command = Chr(34) & node & Chr(34) & " " & Chr(34) & guardian & Chr(34)
shell.Run command, 0, False
