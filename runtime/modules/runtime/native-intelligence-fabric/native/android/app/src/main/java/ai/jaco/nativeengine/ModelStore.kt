package ai.jaco.nativeengine

import android.content.Context
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

class ModelStore(context: Context) {
    private val root = File(context.filesDir, "models").apply { mkdirs() }
    fun pathFor(id: String): File { val safe=id.replace(Regex("[^A-Za-z0-9._-]"), "_"); return File(root, if(safe.endsWith(".litertlm")) safe else "$safe.litertlm") }
    fun list(): List<Map<String, Any>> = root.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.map { mapOf("id" to it.name.removeSuffix(".litertlm"), "path" to it.absolutePath, "sizeBytes" to it.length(), "sha256" to sha256(it)) } ?: emptyList()
    fun sha256(file: File): String { val digest = MessageDigest.getInstance("SHA-256"); file.inputStream().use { input -> val buf=ByteArray(1024*1024); while(true){ val n=input.read(buf); if(n<=0)break; digest.update(buf,0,n) } }; return digest.digest().joinToString("") { "%02x".format(it) } }
    private fun allowed(uri:URI):Boolean { if(uri.scheme!="https")return false;val h=(uri.host?:"").lowercase();return h=="huggingface.co"||h.endsWith(".huggingface.co")||h.endsWith(".hf.co")||h.endsWith(".xethub.hf.co") }
    fun install(id:String,sourceUrl:String,expectedSha256:String):Map<String,Any>{
        require(expectedSha256.matches(Regex("[a-fA-F0-9]{64}"))){"A full SHA-256 is required for native model installation"}
        val target=pathFor(id);val part=File(target.absolutePath+".part");var current=URL(sourceUrl);var redirects=0
        while(true){
            require(allowed(current.toURI())){"Model source host is not approved: ${current.host}"}
            val c=(current.openConnection() as HttpURLConnection).apply{instanceFollowRedirects=false;connectTimeout=15000;readTimeout=60000;setRequestProperty("User-Agent","JACO-Native-Engine/0.1");if(part.exists()&&part.length()>0)setRequestProperty("Range","bytes=${part.length()}-")}
            val code=c.responseCode
            if(code in 300..399){require(redirects++<8){"Too many model download redirects"}; val location=c.getHeaderField("Location")?:error("Redirect missing Location"); current=URL(current,location);c.disconnect();continue}
            require(code==200||code==206){"Model download HTTP $code"}
            val append=code==206&&part.exists();c.inputStream.use{input->part.outputStream().use{out->if(append)out.channel.position(part.length());val buf=ByteArray(1024*1024);while(true){val n=input.read(buf);if(n<=0)break;out.write(buf,0,n)}}};c.disconnect();break
        }
        val digest=sha256(part);require(digest.equals(expectedSha256,true)){part.delete();"Model SHA-256 mismatch"};if(target.exists())target.delete();require(part.renameTo(target)){"Atomic model install rename failed"};return mapOf("id" to id,"path" to target.absolutePath,"sizeBytes" to target.length(),"sha256" to digest)
    }
    fun remove(id:String):Boolean=pathFor(id).delete()
}
