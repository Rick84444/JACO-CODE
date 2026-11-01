Option Explicit
Dim message
message = "JACO could not start."
If WScript.Arguments.Count > 0 Then message = message & vbCrLf & vbCrLf & "Startup log: " & WScript.Arguments(0)
MsgBox message, vbExclamation, "JACO"
