// Explicit customer approval: the Google account is the sole tenant authority.
// A link code proves possession of the PC pairing attempt, not account ownership.
const $=id=>document.getElementById(id),code=new URLSearchParams(location.search).get('code')||'';
const valid=/^[A-Za-z0-9_-]{18,28}$/.test(code);
$('paircode').textContent=valid?'Parkopplingskod: '+code:'Parkopplingskoden saknas eller är ogiltig.';
const next='/link/connect.html?code='+encodeURIComponent(code);
async function run(){
  if(!valid){$('account').textContent='Starta parkopplingen från JACO på Windows.';return;}
  try{
    const r=await fetch('/link/v1/me',{credentials:'same-origin',cache:'no-store'});
    if(r.status===401){
      $('account').textContent='Logga in med ditt befintliga JACO-konto.';
      const link=document.createElement('a');link.href='/auth/google?next='+encodeURIComponent(next);link.textContent='Logga in med Google';
      $('account').append(' ',link);return;
    }
    if(!r.ok)throw Error('KONTO_OTILLGÄNGLIGT');
    const data=await r.json();
    $('account').textContent='Inloggad som '+data.email;
    $('authorize').disabled=false;
  }catch(e){$('account').textContent='Kunde inte kontrollera kontot: '+e.message;}
}
$('authorize').addEventListener('click',async()=>{
  $('authorize').disabled=true;
  try{
    const r=await fetch('/link/v1/claim',{
      method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
      body:JSON.stringify({code}),
    });
    const result=await r.json();
    if(!r.ok)throw Error(result.error||'PARKOPPLING_MISSLYCKADES');
    $('response').textContent='Godkänd. Windows-datorn ansluter automatiskt. Öppna nu JACO Remote på mobilen med samma konto.';
  }catch(e){$('response').textContent='Parkopplingen kunde inte bekräftas: '+e.message;$('authorize').disabled=false;}
});
void run();
