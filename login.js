document.querySelector('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const error=document.querySelector('#error');error.classList.add('hidden');
 try{
  const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#email').value,password:document.querySelector('#password').value})});
  const j=await r.json();if(!r.ok)throw new Error(j.error||'Sikertelen bejelentkezés.');
  location.href=j.redirect;
 }catch(err){error.textContent=err.message;error.classList.remove('hidden')}
});