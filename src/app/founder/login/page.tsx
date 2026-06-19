import { LockKeyhole } from "lucide-react";

export default function FounderLoginPage({ searchParams }: { searchParams: { next?: string } }) {
  return (
    <main className="login-screen">
      <form className="login-panel" action="/api/founder/session" method="post">
        <div className="toolbar"><LockKeyhole size={18} /><strong>Founder access</strong></div>
        <input type="hidden" name="next" value={searchParams.next ?? "/founder"} />
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="btn primary" type="submit">Open console</button>
      </form>
    </main>
  );
}
