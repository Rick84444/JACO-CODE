package ai.jaco.nativeengine

import android.app.*
import android.content.Intent
import android.os.IBinder
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

class JacoNativeEngineService : Service() {
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default);private lateinit var host:LiteRtEngineHost;private lateinit var models:ModelStore;private lateinit var handsOff:HandsOffController;private lateinit var server:JsonLineServer
    override fun onCreate(){super.onCreate();startForegroundRuntime();host=LiteRtEngineHost(this);models=ModelStore(this);handsOff=HandsOffController(this);server=JsonLineServer(37621,{SessionToken.get(this)}){method,params->route(method,params)};server.start(scope)}
    private fun startForegroundRuntime(){val channelId="jaco-native-engine";val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager;nm.createNotificationChannel(NotificationChannel(channelId,"JACO Native Engine",NotificationManager.IMPORTANCE_LOW));val n=Notification.Builder(this,channelId).setContentTitle("JACO Native Intelligence").setContentText("Local LiteRT-LM engine active").setSmallIcon(android.R.drawable.stat_sys_download_done).build();startForeground(37621,n)}
    private suspend fun route(method:String,params:JsonObject):JsonElement=when(method){
        "health"->buildJsonObject{put("product","JACO Native Engine");put("serviceHealthy",true);host.status().forEach{(k,v)->when(v){is Boolean->put(k,v);is String->put(k,v);null->put(k,JsonNull);else->put(k,v.toString())}};put("latencyMs",0);put("runtimeVersion","0.16.0-zero-friction-startup");put("handsOff",handsOff.status())}
        "models.list"->JsonArray(models.list().map{row->buildJsonObject{row.forEach{(k,v)->when(v){is Number->put(k,v.toLong());else->put(k,v.toString())}}}})
        "model.install"->{val id=params["modelId"]!!.jsonPrimitive.content;val url=params["sourceUrl"]!!.jsonPrimitive.content;val sha=params["sha256"]!!.jsonPrimitive.content;val installed=withContext(Dispatchers.IO){models.install(id,url,sha)};buildJsonObject{installed.forEach{(k,v)->when(v){is Number->put(k,v.toLong());else->put(k,v.toString())}}}}
        "model.remove"->buildJsonObject{put("removed",models.remove(params["modelId"]!!.jsonPrimitive.content))}
        "model.load"->{val id=params["modelId"]!!.jsonPrimitive.content;val backend=params["backend"]?.jsonPrimitive?.contentOrNull?:"auto";val file=models.pathFor(id);require(file.exists()){ "Model $id not installed in native app storage"};host.load(id,file.absolutePath,backend);buildJsonObject{put("loaded",true);put("modelId",id);put("backend",host.status()["backend"]?.toString()?:backend)}}
        "completion.create"->{val request=params["request"]!!.jsonObject;val messages=request["messages"]?.jsonArray?:JsonArray(emptyList());val system=messages.firstOrNull{it.jsonObject["role"]?.jsonPrimitive?.content=="system"}?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull;val prompt=messages.filter{it.jsonObject["role"]?.jsonPrimitive?.content!="system"}.joinToString("\n"){it.jsonObject["content"]?.jsonPrimitive?.content?:""};val tools=request["tools"]?.jsonArray?.map{it.jsonObject}?:emptyList();val result=host.complete(system,prompt,tools,request["temperature"]?.jsonPrimitive?.doubleOrNull);buildJsonObject{put("text",result.text);put("modelId",host.status()["modelId"]?.toString()?:"");put("evidenceId","android-litert-${System.nanoTime()}");put("toolCalls",JsonArray(result.toolCalls.map{(name,args)->buildJsonObject{put("name",name);put("arguments",try{Json.parseToJsonElement(args)}catch(_:Throwable){buildJsonObject{put("raw",args)}})}}))}}
        "hands_off.status"->handsOff.status()
        "hands_off.configure"->handsOff.configure(params)
        "hands_off.action"->handsOff.action(params)
        else->error("Unknown method $method")
    }
    override fun onDestroy(){server.close();host.close();scope.cancel();super.onDestroy()};override fun onBind(intent:Intent?):IBinder?=null
}
