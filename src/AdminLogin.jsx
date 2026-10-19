import { useState } from 'react';
import { MessageCircle, ShieldCheck, Eye, EyeOff, ArrowRight, LoaderCircle } from 'lucide-react';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event, forcePasswordSignIn = false) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const verifyingOtp = requiresOtp && !forcePasswordSignIn;
    try {
      const response = await fetch(verifyingOtp ? '/api/auth/admin-otp-verify' : '/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyingOtp ? { identity: email.trim(), password, code } : { identity: email.trim(), password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = new Error(data.message || data.error || 'Administrator sign-in failed.');
        failure.code = data.error;
        throw failure;
      }
      if (data.requiresAdminOtp) {
        setRequiresOtp(true);
        setCode('');
        setError('');
        setSuccess(data.message || 'A verification code was sent to your administrator email.');
        return;
      }
      if (data.user) {
        if (data.user.role !== 'admin') {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
          throw new Error('This account is not an administrator account.');
        }
        window.location.replace('/admin.html');
        return;
      }
      throw new Error('Unexpected sign-in response. Please try again.');
    } catch (e) {
      setError(e.message || 'Could not sign in. Please try again.');
      setSuccess('');
      if (['OTP_EXPIRED_OR_MISSING', 'OTP_ALREADY_USED', 'OTP_ATTEMPT_LIMIT'].includes(e.code)) {
        setCode('');
        setError(e.code === 'OTP_ATTEMPT_LIMIT'
          ? 'Too many incorrect attempts. Request a fresh code to continue.'
          : 'This code is no longer valid. Request a fresh code to continue.');
      }
    } finally {
      setBusy(false);
    }
  }

  return <main className="app-shell admin-login-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="MS Chat home"><span className="brand-mark"><MessageCircle size={21}/></span><span>ms<span className="brand-light">chat</span><i>.</i></span></a>
      <a className="admin-login-back" href="/">Back to MS Chat</a>
    </header>
    <section className="admin-login-wrap">
      <section className="auth-card admin-login-card" aria-labelledby="admin-login-title">
        <div className="auth-inner">
          <div className="auth-icon"><ShieldCheck size={23}/></div>
          <p className="auth-kicker">RESTRICTED ACCESS</p>
          <h2 id="admin-login-title">Administrator sign in</h2>
          <p className="auth-description">Use the administrator credentials configured for this deployment.</p>
          <form onSubmit={submit}>
            <label>Administrator email<div className="input-wrap"><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@example.com" required maxLength={254} disabled={requiresOtp}/></div></label>
            <label>Password<div className="input-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Administrator password" required minLength={12} maxLength={128} disabled={requiresOtp}/><button className="show-password" type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label>
            {requiresOtp && <label>Email verification code<div className="input-wrap"><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="6-digit code" required pattern="[0-9]{6}" maxLength={6}/></div><span className="field-hint">Enter the code sent to your administrator email.</span></label>}
            {error && <div className="notice error" role="alert">{error}</div>}
            {success && <div className="notice success" role="status">{success}</div>}
            <button className="submit-btn" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={18}/> Please wait…</> : <>{requiresOtp ? 'Verify and continue' : 'Sign in securely'} <ArrowRight size={17}/></>}</button>
            {requiresOtp && <button className="admin-login-reset" type="button" onClick={event=>submit(event, true)} disabled={busy}>Send a fresh code</button>}
            {requiresOtp && <button className="admin-login-reset" type="button" onClick={()=>{setRequiresOtp(false);setCode('');setError('');setSuccess('')}} disabled={busy}>Use a different sign-in attempt</button>}
          </form>
          <div className="secure-foot"><ShieldCheck size={15}/><span>Admin access is verified server-side and requires email OTP.</span></div>
        </div>
      </section>
    </section>
  </main>;
}
