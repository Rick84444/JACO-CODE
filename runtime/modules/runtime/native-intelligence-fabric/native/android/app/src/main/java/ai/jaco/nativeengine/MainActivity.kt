package ai.jaco.nativeengine

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity: Activity() {
    private lateinit var statusView:TextView
    override fun onCreate(state:Bundle?){
        super.onCreate(state)
        SessionToken.get(this)
        startForegroundService(Intent(this,JacoNativeEngineService::class.java))
        render()
        autoPairWithJaco()
    }
    private fun render(){
        val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(36,48,36,36)}
        root.addView(TextView(this).apply{text="JACO Native Intelligence Engine\nLiteRT-LM local runtime\nLoopback: 127.0.0.1:37621";textSize=20f})
        statusView=TextView(this).apply{text="Pairing with the local JACO runtime…";setPadding(0,32,0,16)};root.addView(statusView)
        root.addView(Button(this).apply{text="Open Accessibility settings";setOnClickListener{startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))}})
        root.addView(TextView(this).apply{text="Android requires one explicit Accessibility consent for Hands-Off. Pairing itself is automatic and remains on localhost.";setPadding(0,24,0,16)})
        root.addView(Button(this).apply{text="Recovery: copy pairing token";setOnClickListener{val t=SessionToken.get(this@MainActivity);(getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("JACO native token",t));statusView.text="Recovery token copied. Normal installs should not need this."}})
        root.addView(Button(this).apply{text="Rotate pairing token";setOnClickListener{SessionToken.rotate(this@MainActivity);stopService(Intent(this@MainActivity,JacoNativeEngineService::class.java));startForegroundService(Intent(this@MainActivity,JacoNativeEngineService::class.java));statusView.text="Token rotated. Re-pairing…";autoPairWithJaco()}})
        setContentView(root)
    }
    private fun autoPairWithJaco(){
        statusView.text="Pairing with the local JACO runtime…"
        Thread {
            try {
                Thread.sleep(900)
                val challengeBody=postJson("http://127.0.0.1:3000/api/startup/native/pair/challenge", JSONObject())
                val challenge=challengeBody.getJSONObject("challenge")
                val payload=JSONObject().apply{
                    put("id",challenge.getString("id")); put("nonce",challenge.getString("nonce")); put("token",SessionToken.get(this@MainActivity))
                }
                val completed=postJson("http://127.0.0.1:3000/api/startup/native/pair/complete",payload)
                val ok=completed.optBoolean("success",false)
                runOnUiThread{statusView.text=if(ok)"JACO paired automatically ✓" else "Automatic pairing did not verify. Open JACO and retry."}
            } catch (t:Throwable){ runOnUiThread{statusView.text="JACO runtime not reachable yet. Pairing will retry next time this app opens.\n${t.message ?: ""}"} }
        }.start()
    }
    private fun postJson(url:String,payload:JSONObject):JSONObject{
        val connection=(URL(url).openConnection() as HttpURLConnection).apply{
            requestMethod="POST";connectTimeout=2500;readTimeout=4000;doOutput=true;setRequestProperty("Content-Type","application/json")
        }
        connection.outputStream.use{it.write(payload.toString().toByteArray(Charsets.UTF_8))}
        val stream=if(connection.responseCode in 200..299)connection.inputStream else connection.errorStream
        val body=stream.bufferedReader().use{it.readText()}; val code=connection.responseCode;connection.disconnect()
        if(code !in 200..299) throw IllegalStateException("JACO pairing HTTP $code: $body")
        return JSONObject(body)
    }
}
